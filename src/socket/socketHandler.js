function setupSocketHandlers(io, lobbyManager) {
  io.on('connection', function(socket) {
    var currentRoom = null;
    var playerName = null;
    var isApproved = false;

    // ==================== Lobby Events ====================

    socket.on('create-room', function(data) {
      var settings = data || {};
      var roomCode = lobbyManager.createRoom(settings);
      var game = lobbyManager.getRoom(roomCode);
      // Store creator name so we can match them when they join on the game page
      game.hostCreatorName = (data && data.creatorName) || null;
      socket.emit('room-created', { roomCode: roomCode });
    });

    socket.on('join-room', function(data) {
      if (!data || !data.roomCode || !data.playerName) {
        socket.emit('error-msg', { message: 'Room code and player name required' });
        return;
      }

      var roomCode = data.roomCode.toUpperCase();
      var game = lobbyManager.getRoom(roomCode);

      if (!game) {
        socket.emit('error-msg', { message: 'Room not found' });
        return;
      }

      // Deduplicate name: if someone else already has this name, append a number
      var requestedName = data.playerName.trim().substring(0, 20);
      var resolvedName = requestedName;
      var counter = 2;
      var nameInUse = function(name) {
        for (var i = 0; i < game.players.length; i++) {
          if (game.players[i].name === name) return true;
        }
        for (var i = 0; i < game.pendingJoins.length; i++) {
          if (game.pendingJoins[i].name === name) return true;
        }
        return false;
      };
      // Check if this is a reconnecting player (same name, seated in the game)
      var isReconnecting = false;
      for (var i = 0; i < game.players.length; i++) {
        if (game.players[i].name === requestedName) {
          isReconnecting = true;
          break;
        }
      }
      if (!isReconnecting && nameInUse(requestedName)) {
        while (nameInUse(resolvedName)) {
          resolvedName = requestedName + counter;
          counter++;
        }
      }

      playerName = resolvedName;
      currentRoom = roomCode;
      socket.join(roomCode);

      // Notify client of their resolved name if it changed
      if (resolvedName !== requestedName) {
        socket.emit('name-changed', { original: requestedName, name: resolvedName });
      }

      // Check if reconnecting (already seated player)
      var existingPlayer = game.addPlayer(socket.id, resolvedName);

      if (existingPlayer) {
        isApproved = true;
        // If host socket is gone, make this reconnecting player the host
        if (!isSocketConnected(io, game.hostId)) {
          game.setHost(socket.id);
        }
        socket.emit('room-joined', {
          roomCode: roomCode,
          gameState: game.getStateForPlayer(socket.id),
          reconnected: true
        });
        io.to(roomCode).emit('player-reconnected', { name: resolvedName });

        // If the game is mid-hand and it's this player's turn, restart the
        // turn timer from existing deadline (don't reset — keep time as-is).
        // If they were disconnected, the timer was using the short grace period,
        // so extend back to full turn time from now.
        if (game.phase !== 'waiting' && game.phase !== 'showdown' &&
            game.currentPlayerIndex >= 0) {
          var currentTurnPlayer = game.players[game.currentPlayerIndex];
          if (currentTurnPlayer && currentTurnPlayer.id === socket.id) {
            // Give them full turn time since they just reconnected
            startTurnTimer(game);
          }
        }

        broadcastState(game, roomCode);
        return;
      }

      // AUTO-HOST: If no host is set, or the host socket is gone,
      // or no players have seated yet, the first joiner becomes host.
      // This handles the case where the creator navigates from lobby to game page
      // (different socket connection).
      var hostConnected = game.hostId && isSocketConnected(io, game.hostId);
      var noPlayersYet = game.players.length === 0;

      if (!hostConnected || noPlayersYet) {
        game.setHost(socket.id);
        isApproved = true;
        socket.emit('room-joined', {
          roomCode: roomCode,
          gameState: game.getStateForPlayer(socket.id),
          reconnected: false
        });
        broadcastState(game, roomCode);
        return;
      }

      // Otherwise, add to pending joins and notify host
      game.addPendingJoin(socket.id, resolvedName);
      socket.emit('join-requested', { roomCode: roomCode, message: 'Waiting for host to approve...' });

      // Notify host
      broadcastState(game, roomCode);
    });

    // ==================== Host: Approve / Deny Joins ====================

    socket.on('approve-join', function(data) {
      var game = getGame();
      if (!game || !game.isHost(socket.id)) return;
      if (!data || !data.name) return;

      var pending = game.getPendingJoin(data.name);
      if (!pending) return;

      game.removePendingJoin(data.name);

      // Notify the approved player
      var approvedSocket = io.sockets.connected[pending.socketId];
      if (approvedSocket) {
        approvedSocket.emit('join-approved', {
          roomCode: currentRoom,
          gameState: game.getStateForPlayer(pending.socketId)
        });
      }

      game.addLog(data.name + ' was approved to join');
      broadcastState(game, currentRoom);
    });

    socket.on('deny-join', function(data) {
      var game = getGame();
      if (!game || !game.isHost(socket.id)) return;
      if (!data || !data.name) return;

      var pending = game.getPendingJoin(data.name);
      if (!pending) return;

      game.removePendingJoin(data.name);

      // Notify the denied player
      var deniedSocket = io.sockets.connected[pending.socketId];
      if (deniedSocket) {
        deniedSocket.emit('join-denied', { message: 'The host denied your request to join.' });
      }

      broadcastState(game, currentRoom);
    });

    // ==================== Seat / Player Events ====================

    socket.on('take-seat', function(data) {
      var game = getGame();
      if (!game) return;

      var buyIn = (data && data.buyIn) || game.settings.startingChips;
      var seatIndex = data && data.seatIndex;

      if (seatIndex === undefined || seatIndex === null) {
        socket.emit('error-msg', { message: 'Seat index required' });
        return;
      }

      var player = game.seatPlayer(socket.id, playerName, seatIndex, buyIn);
      if (!player) {
        socket.emit('error-msg', { message: 'Seat is taken or invalid' });
        return;
      }

      // If joining mid-hand, sit out until next hand
      if (game.phase !== 'waiting') {
        player.isSittingOut = true;
        game.addLog(playerName + ' will join next hand');
      }

      // Track buy-in in ledger
      game.recordLedgerEvent(playerName, 'buy-in', buyIn);

      broadcastState(game, currentRoom);
    });

    socket.on('sit-out', function() {
      var game = getGame();
      if (!game) return;
      var player = game.getPlayer(socket.id);
      if (player) {
        player.isSittingOut = true;
        game.addLog(player.name + ' is sitting out');
        broadcastState(game, currentRoom);
      }
    });

    socket.on('sit-in', function() {
      var game = getGame();
      if (!game) return;
      var player = game.getPlayer(socket.id);
      if (player) {
        player.isSittingOut = false;
        game.addLog(player.name + ' is back');
        broadcastState(game, currentRoom);
      }
    });

    // ==================== Game Events ====================

    socket.on('start-game', function() {
      var game = getGame();
      if (!game) return;

      if (!game.canStartHand()) {
        socket.emit('error-msg', { message: 'Cannot start: need at least 2 players with chips' });
        return;
      }

      game.startHand();
      broadcastState(game, currentRoom);
      startTurnTimer(game);
    });

    socket.on('player-action', function(data) {
      var game = getGame();
      if (!game) return;

      if (!data || !data.action) {
        socket.emit('error-msg', { message: 'Action required' });
        return;
      }

      var result = game.processAction(socket.id, data.action, data.amount);
      if (!result.success) {
        socket.emit('error-msg', { message: result.error });
        return;
      }

      broadcastState(game, currentRoom);

      // Reset turn timer for next player
      clearTurnTimer(game);
      if (game.phase !== 'waiting' && game.phase !== 'showdown' && game.currentPlayerIndex >= 0) {
        startTurnTimer(game);
      }

      // Auto-start next hand after a delay if in waiting phase
      if (game.phase === 'waiting' && game.canStartHand() && game.handNumber > 0) {
        setTimeout(function() {
          if (game.phase === 'waiting' && game.canStartHand() && !game.isPaused) {
            game.startHand();
            broadcastState(game, currentRoom);
            startTurnTimer(game);
          }
        }, 8000);
      }
    });

    // ==================== Time Bank ====================

    socket.on('use-time-bank', function() {
      var game = getGame();
      if (!game) return;
      var player = game.getPlayer(socket.id);
      if (!player) return;
      if (game.currentPlayerIndex < 0 || game.players[game.currentPlayerIndex].id !== socket.id) return;

      if (player.timeBank > 0) {
        var extension = Math.min(player.timeBank, 30);
        player.timeBank -= extension;
        game.turnDeadline = (game.turnDeadline || Date.now()) + extension * 1000;
        game.addLog(player.name + ' uses ' + extension + 's time bank (' + player.timeBank + 's left)');
        broadcastState(game, currentRoom);

        // Restart timer with new deadline
        clearTurnTimer(game);
        startTurnTimerFromDeadline(game);
      } else {
        socket.emit('error-msg', { message: 'No time bank remaining' });
      }
    });

    // ==================== Give Time Bank (Host Only) ====================

    socket.on('give-time-bank', function(data) {
      var game = getGame();
      if (!game) return;
      if (!game.isHost(socket.id)) {
        socket.emit('error-msg', { message: 'Only the host can give time bank' });
        return;
      }
      var amount = (data && parseInt(data.amount)) || 30;
      if (amount < 1 || amount > 300) amount = 30;
      for (var i = 0; i < game.players.length; i++) {
        game.players[i].timeBank = (game.players[i].timeBank || 0) + amount;
      }
      game.addLog('Host gave ' + amount + 's time bank to all players');
      broadcastState(game, currentRoom);
    });

    // ==================== Pause / Resume / Stop (Host Only) ====================

    socket.on('pause-game', function() {
      var game = getGame();
      if (!game || !game.isHost(socket.id)) return;
      if (game.isPaused) return;
      game.isPaused = true;
      // Freeze the turn timer — save remaining time and stop countdown
      if (game.turnDeadline && game.currentPlayerIndex >= 0) {
        game.pausedTimeRemaining = Math.max(0, game.turnDeadline - Date.now());
        game.turnDeadline = null; // stop client-side countdown
        clearTurnTimer(game);
      }
      game.addLog('--- Game paused by host ---');
      broadcastState(game, currentRoom);
    });

    socket.on('resume-game', function() {
      var game = getGame();
      if (!game || !game.isHost(socket.id)) return;
      if (!game.isPaused) return;
      game.isPaused = false;
      game.addLog('--- Game resumed by host ---');
      // Restore frozen turn timer
      if (game.pausedTimeRemaining && game.currentPlayerIndex >= 0) {
        game.turnDeadline = Date.now() + game.pausedTimeRemaining;
        game.pausedTimeRemaining = null;
        startTurnTimerFromDeadline(game);
      }
      broadcastState(game, currentRoom);
      // Auto-start if in waiting phase
      if (game.phase === 'waiting' && game.canStartHand()) {
        setTimeout(function() {
          if (game.phase === 'waiting' && game.canStartHand() && !game.isPaused) {
            game.startHand();
            broadcastState(game, currentRoom);
            startTurnTimer(game);
          }
        }, 3000);
      }
    });

    socket.on('stop-game', function() {
      var game = getGame();
      if (!game || !game.isHost(socket.id)) return;
      // Always end any active hand immediately and return to lobby state
      game.phase = 'waiting';
      game.currentPlayerIndex = -1;
      game.communityCards = [];
      game.potManager.reset();
      for (var i = 0; i < game.players.length; i++) {
        game.players[i].resetForNewHand();
      }
      game.isPaused = true;
      clearTurnTimer(game);
      game.addLog('--- Game stopped by host ---');
      broadcastState(game, currentRoom);
    });

    // ==================== Run It Twice ====================

    socket.on('agree-run-it-twice', function() {
      var game = getGame();
      if (!game) return;
      if (!game.canRunItTwice() && !game.runItTwicePending) return;

      var player = game.getPlayer(socket.id);
      if (!player) return;

      game.runItTwiceAgreed[socket.id] = true;
      game.runItTwicePending = true;
      game.addLog(player.name + ' agrees to run it twice');

      // Check if all active players have agreed
      var activePlayers = game.getActivePlayers();
      var allAgreed = true;
      for (var i = 0; i < activePlayers.length; i++) {
        if (!game.runItTwiceAgreed[activePlayers[i].id]) {
          allAgreed = false;
          break;
        }
      }

      if (allAgreed && activePlayers.length >= 2) {
        clearTurnTimer(game);
        game.executeRunItTwice();
      }

      broadcastState(game, currentRoom);
    });

    socket.on('decline-run-it-twice', function() {
      var game = getGame();
      if (!game) return;
      var player = game.getPlayer(socket.id);
      if (!player) return;

      game.runItTwicePending = false;
      game.runItTwiceAgreed = {};
      game.addLog(player.name + ' declined run it twice');

      // Continue with normal run-out
      game.runOutBoard();
      broadcastState(game, currentRoom);
    });

    // ==================== Bomb Pot (Host Only) ====================

    socket.on('trigger-bomb-pot', function() {
      var game = getGame();
      if (!game || !game.isHost(socket.id)) return;
      game.isBombPot = true;
      // If mid-hand, it will take effect next hand
      var suffix = game.phase !== 'waiting' ? ' (next hand)' : '';
      game.addLog('Host triggered a BOMB POT!' + suffix);
      broadcastState(game, currentRoom);
    });

    // ==================== Show Cards (after hand ends) ====================

    socket.on('show-cards', function() {
      var game = getGame();
      if (!game) return;
      var player = game.getPlayer(socket.id);
      if (!player) return;
      if (player.holeCards.length < 2) return;

      // Mark this player as wanting to show cards
      player.showCards = true;
      game.addLog(player.name + ' shows [' + player.holeCards.map(function(c) { return c.toShort(); }).join(' ') + ']');
      broadcastState(game, currentRoom);
    });

    // ==================== Chat ====================

    socket.on('chat-message', function(data) {
      if (!currentRoom || !playerName || !data || !data.text) return;
      io.to(currentRoom).emit('chat-message', {
        name: playerName,
        text: data.text.substring(0, 500),
        time: Date.now()
      });
    });

    // ==================== Settings (Host Only) ====================

    socket.on('update-settings', function(data) {
      var game = getGame();
      if (!game) return;
      if (!game.isHost(socket.id)) {
        socket.emit('error-msg', { message: 'Only the host can change settings' });
        return;
      }
      // Settings take effect immediately; if mid-hand, blind/chip changes apply next hand
      if (data.smallBlind) game.settings.smallBlind = parseInt(data.smallBlind) || 10;
      if (data.bigBlind) game.settings.bigBlind = parseInt(data.bigBlind) || 20;
      if (data.startingChips) game.settings.startingChips = parseInt(data.startingChips) || 1000;
      if (data.turnTimer) game.settings.turnTimer = parseInt(data.turnTimer) || 60;
      if (data.timeBankTotal) game.settings.timeBankTotal = parseInt(data.timeBankTotal) || 120;
      // Feature toggles
      if (data.rabbitHunting !== undefined) game.settings.rabbitHunting = !!data.rabbitHunting;
      if (data.runItTwice !== undefined) game.settings.runItTwice = !!data.runItTwice;
      if (data.sevenTwoBounty !== undefined) game.settings.sevenTwoBounty = !!data.sevenTwoBounty;
      if (data.sevenTwoBountyAmount !== undefined) game.settings.sevenTwoBountyAmount = parseInt(data.sevenTwoBountyAmount) || 0;
      if (data.bombPotEnabled !== undefined) game.settings.bombPotEnabled = !!data.bombPotEnabled;
      if (data.bombPotAnte !== undefined) game.settings.bombPotAnte = parseInt(data.bombPotAnte) || 0;
      if (data.bombPotFrequency !== undefined) game.settings.bombPotFrequency = parseInt(data.bombPotFrequency) || 0;
      if (data.gameMode !== undefined && (data.gameMode === 'nlh' || data.gameMode === 'plo5')) {
        if (game.settings.gameMode !== data.gameMode) {
          game.settings.gameMode = data.gameMode;
          game.addLog('Game mode changed to ' + (data.gameMode === 'plo5' ? 'PLO-5' : 'No Limit Hold\'em') + ' (takes effect next hand)');
        }
      }
      game.addLog('Host updated game settings');
      broadcastState(game, currentRoom);
    });

    // ==================== Set Player Chips (Host Only) ====================

    socket.on('set-player-chips', function(data) {
      var game = getGame();
      if (!game) return;
      if (!game.isHost(socket.id)) {
        socket.emit('error-msg', { message: 'Only the host can modify chips' });
        return;
      }
      if (!data || !data.playerName || data.amount === undefined) {
        socket.emit('error-msg', { message: 'Player name and amount required' });
        return;
      }
      var amount = parseInt(data.amount);
      if (isNaN(amount) || amount < 0) {
        socket.emit('error-msg', { message: 'Invalid chip amount' });
        return;
      }
      game.setPlayerChips(data.playerName, amount);
      broadcastState(game, currentRoom);
    });

    // ==================== Kick Player (Host Only) ====================

    socket.on('kick-player', function(data) {
      var game = getGame();
      if (!game) return;
      if (!game.isHost(socket.id)) return;
      if (!data || !data.playerName) return;

      for (var i = 0; i < game.players.length; i++) {
        if (game.players[i].name === data.playerName) {
          var kicked = game.players[i];
          var kickedSocket = io.sockets.connected[kicked.id];

          // Record buy-out in ledger before removing
          game.recordLedgerEvent(kicked.name, 'buy-out', kicked.chips);
          game.removePlayer(kicked.id);
          game.addLog(data.playerName + ' was kicked by host');

          if (kickedSocket) {
            kickedSocket.emit('kicked', { message: 'You were kicked by the host.' });
          }

          broadcastState(game, currentRoom);
          return;
        }
      }
    });

    // ==================== Rebuy ====================

    socket.on('rebuy', function(data) {
      var game = getGame();
      if (!game) return;
      var player = game.getPlayer(socket.id);
      if (!player) return;
      if (player.chips > 0 && game.phase !== 'waiting') {
        socket.emit('error-msg', { message: 'Can only rebuy when you have no chips' });
        return;
      }
      var amount = (data && data.amount) || game.settings.startingChips;
      player.chips += amount;
      // If mid-hand, keep sitting out until next hand
      if (game.phase !== 'waiting') {
        player.isSittingOut = true;
        game.addLog(player.name + ' rebuys for ' + amount + ' (takes effect next hand)');
      } else {
        player.isSittingOut = false;
        game.addLog(player.name + ' rebuys for ' + amount);
      }
      game.recordLedgerEvent(player.name, 'buy-in', amount);
      broadcastState(game, currentRoom);
    });

    // ==================== Cash Out ====================

    socket.on('cash-out', function() {
      var game = getGame();
      if (!game) return;
      var player = game.getPlayer(socket.id);
      if (!player) return;
      if (game.phase !== 'waiting') {
        socket.emit('error-msg', { message: 'Can only cash out between hands' });
        return;
      }
      game.recordLedgerEvent(player.name, 'buy-out', player.chips);
      player.chips = 0;
      player.isSittingOut = true;
      game.addLog(player.name + ' cashed out');
      broadcastState(game, currentRoom);
    });

    // ==================== Disconnect ====================

    socket.on('disconnect', function() {
      if (!currentRoom) return;
      var game = lobbyManager.getRoom(currentRoom);
      if (!game) return;

      // Remove from pending joins
      if (playerName) {
        game.removePendingJoin(playerName);
      }

      // Check if this player already reconnected on a new socket.
      var player = game.getPlayer(socket.id);
      if (!player) {
        return;
      }

      // Mark the player as disconnected.
      player.isConnected = false;
      game.addLog(player.name + ' disconnected');

      if (game.phase === 'waiting') {
        // In waiting phase, mark as sitting out so hands can still start.
        player.isSittingOut = true;
      } else if (game.phase !== 'showdown') {
        // Mid-hand: player stays in the hand. If it's currently their turn,
        // restart the timer with the shorter disconnect grace period.
        var playerIdx = -1;
        for (var pi = 0; pi < game.players.length; pi++) {
          if (game.players[pi] === player) { playerIdx = pi; break; }
        }
        if (playerIdx >= 0 && game.currentPlayerIndex === playerIdx) {
          // startTurnTimer detects isConnected=false and uses DISCONNECT_GRACE_MS
          startTurnTimer(game);
        }
      }

      broadcastState(game, currentRoom);

      // Clean up: check if ALL players are disconnected for an extended time
      var roomToCheck = currentRoom;
      setTimeout(function() {
        var g = lobbyManager.getRoom(roomToCheck);
        if (!g) return;
        // Check if all players are disconnected
        var anyConnected = false;
        for (var i = 0; i < g.players.length; i++) {
          if (g.players[i].isConnected) {
            anyConnected = true;
            break;
          }
        }
        if (!anyConnected && g.pendingJoins.length === 0) {
          lobbyManager.destroyRoom(roomToCheck);
        }
      }, 300000); // 5 minutes before destroying empty room
    });

    // ==================== Turn Timer Helpers ====================

    function clearTurnTimer(game) {
      if (!game) {
        // Legacy: try to get game from currentRoom
        game = currentRoom ? lobbyManager.getRoom(currentRoom) : null;
      }
      if (game && game._turnTimerId) {
        clearTimeout(game._turnTimerId);
        game._turnTimerId = null;
      }
    }

    // Auto-act for a player (disconnected or timed out): check if possible, else fold
    function autoActPlayer(game, player, reason) {
      var validActions = game.getValidActions(player.id);
      var canCheck = validActions && validActions.actions.indexOf('check') >= 0;

      if (canCheck) {
        game.addLog(player.name + ' ' + reason + ' (auto-check)');
        game.processAction(player.id, 'check');
      } else {
        game.addLog(player.name + ' ' + reason + ' (auto-fold)');
        game.processAction(player.id, 'fold');
      }
    }

    // After auto-acting, continue the game
    function afterTurnAction(game) {
      // Continue timer for next player
      if (game.phase !== 'waiting' && game.phase !== 'showdown' && game.currentPlayerIndex >= 0) {
        startTurnTimer(game);
      }

      // Auto-start next hand
      if (game.phase === 'waiting' && game.canStartHand() && game.handNumber > 0) {
        setTimeout(function() {
          if (game.phase === 'waiting' && game.canStartHand()) {
            game.startHand();
            broadcastState(game, currentRoom);
            startTurnTimer(game);
          }
        }, 3000);
      }
    }

    var DISCONNECT_GRACE_MS = 15000; // 15 seconds to reconnect before auto-fold

    function startTurnTimer(game) {
      clearTurnTimer(game);
      if (game.currentPlayerIndex < 0) return;

      var currentPlayer = game.players[game.currentPlayerIndex];
      if (!currentPlayer || !currentPlayer.canAct()) return;

      // Disconnected players get a shorter grace period to reconnect
      var timerMs = currentPlayer.isConnected
        ? (game.settings.turnTimer || 60) * 1000
        : DISCONNECT_GRACE_MS;

      game.turnDeadline = Date.now() + timerMs;

      game._turnTimerId = setTimeout(function() {
        if (!game || game.currentPlayerIndex < 0) return;
        var timedOutPlayer = game.players[game.currentPlayerIndex];
        if (!timedOutPlayer || !timedOutPlayer.canAct()) return;

        var reason = timedOutPlayer.isConnected ? 'timed out' : 'disconnected';
        autoActPlayer(game, timedOutPlayer, reason);
        broadcastState(game, currentRoom);
        afterTurnAction(game);
      }, timerMs);
    }

    function startTurnTimerFromDeadline(game) {
      clearTurnTimer(game);
      if (!game.turnDeadline || game.currentPlayerIndex < 0) return;

      var currentPlayer = game.players[game.currentPlayerIndex];
      if (!currentPlayer || !currentPlayer.canAct()) return;

      var remaining = game.turnDeadline - Date.now();
      if (remaining <= 0) remaining = 100;

      game._turnTimerId = setTimeout(function() {
        if (!game || game.currentPlayerIndex < 0) return;
        var timedOutPlayer = game.players[game.currentPlayerIndex];
        if (!timedOutPlayer || !timedOutPlayer.canAct()) return;

        var reason = timedOutPlayer.isConnected ? 'timed out' : 'disconnected';
        autoActPlayer(game, timedOutPlayer, reason);
        broadcastState(game, currentRoom);
        afterTurnAction(game);
      }, remaining);
    }

    // ==================== Helpers ====================

    function getGame() {
      if (!currentRoom) {
        socket.emit('error-msg', { message: 'Not in a room' });
        return null;
      }
      var game = lobbyManager.getRoom(currentRoom);
      if (!game) {
        socket.emit('error-msg', { message: 'Room not found' });
        return null;
      }
      return game;
    }

    function broadcastState(game, roomCode) {
      var sockets = io.sockets.adapter.rooms[roomCode];
      if (!sockets) return;

      var socketIds = Object.keys(sockets.sockets || sockets);
      for (var i = 0; i < socketIds.length; i++) {
        var sid = socketIds[i];
        var s = io.sockets.connected[sid];
        if (s) {
          s.emit('game-state', game.getStateForPlayer(sid));
        }
      }
    }

    function isSocketConnected(ioRef, socketId) {
      return !!(ioRef.sockets.connected[socketId]);
    }
  });
}

module.exports = setupSocketHandlers;
