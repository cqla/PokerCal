(function() {
  var socket = io();
  var playerName = localStorage.getItem('playerName') || '';
  var roomCode = window.location.pathname.split('/').pop();
  var myId = null;
  var isSeated = false;
  var isApproved = false;
  var lastState = null;
  var lastHandNumber = 0;
  var timerInterval = null;
  var lastSevenTwoWinner = null;
  var lastCommunityCount = 0;
  var lastPhase = null;
  var wasMyTurn = false;
  var timerWarnedAt = 0; // track which second we last warned at

  // Pre-action queue
  var queuedAction = null; // null, 'checkfold', 'call', or 'fold'
  var queuedCallAmount = null; // the toCall amount when call was queued
  var queuedHighestBet = null; // track the bet level when action was queued

  // If no player name, prompt for one
  if (!playerName) {
    playerName = prompt('Enter your name:');
    if (!playerName) {
      window.location.href = '/';
      return;
    }
    localStorage.setItem('playerName', playerName);
  }

  // Initialize modules
  Chat.init(socket);
  Controls.init(function(action, amount) {
    clearQueue();
    socket.emit('player-action', { action: action, amount: amount });
    // Play sound for own action
    if (action === 'fold') Sounds.fold();
    else if (action === 'check') Sounds.check();
    else if (action === 'call') Sounds.call();
    else if (action === 'raise') Sounds.raise();
    else if (action === 'allin') Sounds.allIn();
  });

  // Join the room
  socket.emit('join-room', { roomCode: roomCode, playerName: playerName });

  // ==================== Socket Events ====================

  socket.on('room-joined', function(data) {
    if (!data.gameState) return;
    myId = socket.id;
    isApproved = true;

    document.getElementById('waiting-approval').style.display = 'none';

    // Check if already seated
    var state = data.gameState;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].isYou) {
        isSeated = true;
        break;
      }
    }

    renderState(state);

    if (data.reconnected) {
      addSystemMessage('Reconnected to game');
    }
  });

  socket.on('name-changed', function(data) {
    // Server assigned a different name to avoid collision
    playerName = data.name;
    localStorage.setItem('playerName', data.name);
    addSystemMessage('Name "' + data.original + '" was taken — you joined as "' + data.name + '"');
  });

  socket.on('join-requested', function(data) {
    // Show waiting for approval overlay
    document.getElementById('waiting-approval').style.display = 'flex';
  });

  socket.on('join-approved', function(data) {
    isApproved = true;
    myId = socket.id;
    document.getElementById('waiting-approval').style.display = 'none';

    if (data.gameState) {
      renderState(data.gameState);
    }
    addSystemMessage('You have been approved to join!');
  });

  socket.on('join-denied', function(data) {
    document.getElementById('waiting-approval').style.display = 'none';
    alert(data.message || 'Your request to join was denied.');
    window.location.href = '/';
  });

  socket.on('kicked', function(data) {
    alert(data.message || 'You were kicked from the game.');
    window.location.href = '/';
  });

  socket.on('game-state', function(state) {
    myId = socket.id;

    // Sync sound configuration from host settings
    Sounds.updateConfig(state.settings);

    // Check if we became seated
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].isYou) {
        isSeated = true;
        break;
      }
    }

    // === Sound effects for game events ===

    // New hand started
    if (state.phase === 'preflop' && lastPhase === 'waiting') {
      Sounds.newHand();
    }

    // Community cards dealt (flop/turn/river)
    var ccCount = state.communityCards ? state.communityCards.length : 0;
    if (ccCount > lastCommunityCount && ccCount > 0) {
      Sounds.communityCard();
    }
    lastCommunityCount = ccCount;
    if (state.phase === 'waiting') lastCommunityCount = 0;

    // Other player actions — detect via lastAction changes
    // Skip action sounds when the hand just ended (avoids overlap with win/special sounds)
    var handJustEnded = state.phase === 'waiting' && lastState && lastState.phase !== 'waiting';
    if (!handJustEnded && lastState && state.currentPlayerId !== (lastState.currentPlayerId)) {
      // Action happened, find who acted (the previous current player)
      if (lastState.currentPlayerIndex >= 0 && lastState.currentPlayerIndex < state.players.length) {
        var actedPlayer = state.players[lastState.currentPlayerIndex];
        if (actedPlayer && !actedPlayer.isYou && actedPlayer.lastAction) {
          var act = actedPlayer.lastAction.toLowerCase();
          if (act.indexOf('fold') === 0) Sounds.fold();
          else if (act.indexOf('check') === 0) Sounds.check();
          else if (act.indexOf('call') === 0) Sounds.call();
          else if (act.indexOf('raise') === 0) Sounds.raise();
          else if (act.indexOf('all-in') === 0 || act.indexOf('all in') === 0) Sounds.allIn();
        }
      }
    }

    // It's now my turn
    var isMyTurn = state.validActions && state.currentPlayerId === myId;
    if (isMyTurn && !wasMyTurn) {
      Sounds.yourTurn();
    }
    wasMyTurn = isMyTurn;

    // Hand ended — win sound or special event sound
    if (handJustEnded) {
      var playedSpecial = false;
      // Special event sounds take priority
      if (state.specialEvent) {
        Sounds.special(state.specialEvent);
        playedSpecial = true;
      }
      // Win sound (if no special played)
      if (state.lastHandResults && !playedSpecial) {
        for (var r = 0; r < state.lastHandResults.length; r++) {
          var winners = state.lastHandResults[r].winners;
          for (var w = 0; w < winners.length; w++) {
            if (winners[w].id === myId) {
              Sounds.win();
              r = state.lastHandResults.length; // break outer
              break;
            }
          }
        }
      }
    }

    // Special event that arrives mid-waiting (e.g. bluff after show-cards)
    if (state.phase === 'waiting' && !handJustEnded && state.specialEvent &&
        lastState && !lastState.specialEvent) {
      Sounds.special(state.specialEvent);
    }

    lastPhase = state.phase;

    // === Pre-action queue ===
    // Clear call queue if someone raised (toCall amount changed)
    if (queuedAction === 'call' && isMyTurn && state.validActions) {
      if (state.validActions.toCall !== queuedCallAmount) {
        clearQueue(); // Raise happened — don't auto-call the new amount
      }
    }
    // Execute queued action if it's now my turn
    if (isMyTurn && queuedAction) {
      executeQueuedAction(state);
    }

    // Show hand results when a hand ends
    if (state.lastHandResults && state.phase === 'waiting' &&
        lastState && (lastState.phase !== 'waiting')) {
      if (state.runItTwiceData) {
        // Delay result overlay until RIT cards finish dealing
        var ritNewCards = 5 - (state.runItTwiceData.existingCards || 0);
        var ritDealTime = 600 + ritNewCards * 800 + 400 + ritNewCards * 800 + 400 + 600;
        setTimeout(function() {
          TableRenderer.renderHandResult(state.lastHandResults);
        }, ritDealTime);
      } else {
        TableRenderer.renderHandResult(state.lastHandResults);
      }
    }

    renderState(state);
  });

  socket.on('chat-message', function(data) {
    Chat.addMessage(data);
  });

  socket.on('player-reconnected', function(data) {
    addSystemMessage(data.name + ' reconnected');
  });

  socket.on('error-msg', function(data) {
    addSystemMessage('Error: ' + data.message);
  });

  socket.on('disconnect', function() {
    addSystemMessage('Disconnected from server. Trying to reconnect...');
  });

  // Socket.IO 4.x: 'connect' fires on reconnection too
  var hasConnectedOnce = false;
  socket.on('connect', function() {
    if (hasConnectedOnce) {
      // This is a reconnection
      socket.emit('join-room', { roomCode: roomCode, playerName: playerName });
    }
    hasConnectedOnce = true;
  });

  // ==================== Timer Countdown ====================

  function startTimerCountdown(state) {
    stopTimerCountdown();

    if (!state.turnDeadline || state.phase === 'waiting' || state.phase === 'showdown' || state.currentPlayerIndex < 0 || state.isPaused) {
      return;
    }

    var totalSeconds = state.settings.turnTimer || 60;
    // Use duration (turnTimeRemainingMs) rather than absolute server timestamp
    // to be immune to client/server clock skew. Anchor a local deadline at the
    // moment we receive this state.
    var localDeadline = Date.now() + (typeof state.turnTimeRemainingMs === 'number'
      ? state.turnTimeRemainingMs
      : Math.max(0, state.turnDeadline - Date.now()));

    function tick() {
      var remaining = Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000));
      var pct = Math.min(100, (remaining / totalSeconds) * 100);

      var fill = document.getElementById('turn-timer-fill');
      var text = document.getElementById('turn-timer-text');
      var bar = document.getElementById('turn-timer-bar');
      var secEl = document.getElementById('turn-timer-seconds');

      if (remaining <= 0) {
        bar.style.display = 'none';
        if (secEl) secEl.style.display = 'none';
        stopTimerCountdown();
        return;
      }

      bar.style.display = 'block';
      fill.style.width = pct + '%';
      if (secEl) {
        secEl.style.display = 'inline-flex';
        secEl.textContent = remaining + 's';
        if (remaining <= 10) secEl.classList.add('low-time');
        else secEl.classList.remove('low-time');
      }

      // Last 10 seconds → yellow "crunch time" (matches when time bank becomes available)
      if (remaining <= 10) {
        bar.classList.add('low-time');
        fill.style.background = '';
      } else {
        bar.classList.remove('low-time');
        if (pct > 50) {
          fill.style.background = 'var(--accent-green)';
        } else {
          fill.style.background = 'var(--accent-gold)';
        }
      }

      // Time Bank floating button — visible while it's your turn & you have a bank
      var tbFab = document.getElementById('time-bank-btn');
      if (tbFab) {
        if (state.currentPlayerId === myId && state.myTimeBank > 0) {
          tbFab.style.display = 'flex';
          var lbl = document.getElementById('time-bank-fab-label');
          if (lbl) lbl.textContent = state.myTimeBank + 's';
          if (remaining <= 10) {
            tbFab.classList.add('active');
            tbFab.disabled = false;
          } else {
            tbFab.classList.remove('active');
            tbFab.disabled = true;
          }
        } else {
          tbFab.style.display = 'none';
        }
      }

      // Find current player name
      var currentName = '';
      if (state.currentPlayerIndex >= 0 && state.currentPlayerIndex < state.players.length) {
        currentName = state.players[state.currentPlayerIndex].name;
      }

      text.textContent = currentName + ' - ' + remaining + 's';

      // Timer warning sound at 10s and 5s (only for current player's own turn)
      if (state.currentPlayerId === myId && remaining <= 10 && remaining > 0 && remaining !== timerWarnedAt) {
        if (remaining === 10 || remaining === 5) {
          Sounds.timerWarning();
        }
        timerWarnedAt = remaining;
      }

    }
    tick(); // run immediately so the counter resets to 60 without a 1s delay
    timerInterval = setInterval(tick, 250);
  }

  function stopTimerCountdown() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    var bar = document.getElementById('turn-timer-bar');
    if (bar) bar.style.display = 'none';
    var secEl = document.getElementById('turn-timer-seconds');
    if (secEl) secEl.style.display = 'none';
  }

  // ==================== Rendering ====================

  function renderState(state) {
    lastState = state;

    // Top bar
    TableRenderer.updateTopBar(state);

    // Pending joins (host only)
    TableRenderer.renderPendingJoins(state, socket);

    // Table
    TableRenderer.renderSeats(state, myId, function(seatIndex) {
      if (!isSeated && isApproved) {
        socket.emit('take-seat', { seatIndex: seatIndex });
      }
    });

    // Community cards
    TableRenderer.renderCommunityCards(state.communityCards);

    // Pot
    TableRenderer.renderPot(state.pot);

    // My cards + hand strength
    var myCards = null;
    var myPlayer = null;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].isYou) {
        myPlayer = state.players[i];
        myCards = state.players[i].holeCards;
        break;
      }
    }
    TableRenderer.renderMyCards(myCards, state.myHand, state.gameMode);

    // Dealer button
    TableRenderer.renderDealerButton(state);

    // Game log
    TableRenderer.renderGameLog(state.gameLog);

    // Player chips list in settings modal (host only)
    TableRenderer.renderPlayerChipsList(state, socket);

    // Ledger
    TableRenderer.renderLedger(state.ledger);

    // Turn timer - use client-side countdown
    TableRenderer.renderTurnTimer(state);
    startTimerCountdown(state);

    // Rabbit cards
    TableRenderer.renderRabbitCards(state.rabbitCards);

    // Run it twice
    TableRenderer.renderRunItTwice(state);
    TableRenderer.renderRunItTwicePrompt(state, socket);

    // 7-2 Bounty banner
    if (state.sevenTwoWinner && (!lastSevenTwoWinner || lastSevenTwoWinner !== state.sevenTwoWinner)) {
      TableRenderer.renderSevenTwoBanner(state.sevenTwoWinner);
    }
    lastSevenTwoWinner = state.sevenTwoWinner;

    // Special event banner
    if (state.phase === 'waiting' && state.specialEvent) {
      TableRenderer.renderSpecialEvent(state);
    } else if (state.phase !== 'waiting') {
      TableRenderer.resetSpecialEvent();
    }

    // Controls
    if (state.validActions && state.currentPlayerId === myId) {
      Controls.show(state.validActions);
      Controls.hideWaiting();

      // Time Bank floating button — visible whenever it's your turn and you have a bank.
      // Greyed-out until the last 10 seconds; becomes active (yellow, clickable) at ≤10s.
      var tbFabShow = document.getElementById('time-bank-btn');
      if (tbFabShow) {
        if (state.myTimeBank > 0) {
          tbFabShow.style.display = 'flex';
          var lbl = document.getElementById('time-bank-fab-label');
          if (lbl) lbl.textContent = state.myTimeBank + 's';
          var lowOnTime = state.turnTimeRemaining !== null && state.turnTimeRemaining !== undefined && state.turnTimeRemaining <= 10;
          if (lowOnTime) {
            tbFabShow.classList.add('active');
            tbFabShow.disabled = false;
          } else {
            tbFabShow.classList.remove('active');
            tbFabShow.disabled = true;
          }
        } else {
          tbFabShow.style.display = 'none';
        }
      }
    } else {
      Controls.hide();
      var tbFabHide = document.getElementById('time-bank-btn');
      if (tbFabHide) tbFabHide.style.display = 'none';

      if (state.phase === 'waiting' && isSeated) {
        // Only the host can deal cards
        var canStart = state.isHost && state.players.filter(function(p) {
          return !p.isSittingOut && p.isConnected && p.chips > 0;
        }).length >= 2;

        var canRebuy = myPlayer && myPlayer.chips <= 0;
        // Cash-out is no longer rendered in the main waiting bar
        Controls.showWaiting(canStart, canRebuy, false);
      } else {
        Controls.hideWaiting();
      }
    }

    // Cash-out button (in Settings modal) — visible to any seated player with chips
    var cashOutBtn = document.getElementById('cash-out-btn');
    var cashOutNote = document.getElementById('cash-out-note');
    if (cashOutBtn) {
      if (myPlayer && myPlayer.chips > 0 && isSeated) {
        cashOutBtn.style.display = '';
        if (myPlayer.pendingCashOut) {
          cashOutBtn.textContent = 'Cancel Cash Out (queued)';
          cashOutBtn.classList.add('pending');
          if (cashOutNote) cashOutNote.textContent = 'You will cash out automatically when this hand resolves. Tap to cancel.';
        } else {
          cashOutBtn.textContent = (state.phase !== 'waiting') ? 'Cash Out After Hand' : 'Cash Out';
          cashOutBtn.classList.remove('pending');
          if (cashOutNote) cashOutNote.textContent = 'Cash out to leave the table. If you cash out during a hand, it will take effect after the hand resolves.';
        }
      } else {
        cashOutBtn.style.display = 'none';
      }
    }

    // Show Cards button visibility — available to ANY player with hole cards at hand end
    var showCardsBtn = document.getElementById('show-cards-btn');
    var hasHoleCards = myPlayer && myPlayer.holeCards && myPlayer.holeCards.length > 0;
    var alreadyShown = myPlayer && myPlayer.showCards;
    if (state.phase === 'waiting' && state.lastHandResults && myPlayer && state.handNumber > 0 && hasHoleCards && !alreadyShown) {
      showCardsBtn.style.display = '';
    } else {
      showCardsBtn.style.display = 'none';
    }

    // Host controls — pause/stop/resume in top bar, bomb pot in bottom bar
    var hostControls = document.getElementById('host-controls');
    var pauseBtn = document.getElementById('pause-btn');
    var resumeBtn = document.getElementById('resume-btn');
    var stopBtn = document.getElementById('stop-btn');
    var bombPotBtn = document.getElementById('bomb-pot-btn');

    if (state.isHost && state.handNumber > 0) {
      pauseBtn.style.display = state.isPaused ? 'none' : 'flex';
      resumeBtn.style.display = state.isPaused ? 'flex' : 'none';
      stopBtn.style.display = state.isPaused ? 'none' : 'flex';
    } else {
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'none';
      stopBtn.style.display = 'none';
    }

    // Pre-action queue buttons — show when not your turn but in an active hand
    var preactionArea = document.getElementById('preaction-area');
    var isInHand = myPlayer && !myPlayer.isFolded && !myPlayer.isAllIn && !myPlayer.isSittingOut && myPlayer.hasCards;
    var isActiveBetting = state.phase !== 'waiting' && state.phase !== 'showdown' && state.currentPlayerIndex >= 0;
    var showPreaction = isSeated && isActiveBetting && isInHand && state.currentPlayerId !== myId;

    if (showPreaction) {
      preactionArea.style.display = 'flex';
      updatePreactionButtons(state);
    } else {
      preactionArea.style.display = 'none';
      // Clear queue when hand ends or it becomes your turn
      if (!isActiveBetting || !isInHand) {
        clearQueue();
      }
    }

    // Bomb pot button — host can call it any time when bomb pots are enabled
    if (state.isHost && state.settings.bombPotEnabled && !state.isBombPot) {
      hostControls.style.display = 'flex';
      bombPotBtn.style.display = '';
    } else {
      bombPotBtn.style.display = 'none';
    }

  }

  // ==================== Pre-Action Queue ====================

  function clearQueue() {
    queuedAction = null;
    queuedCallAmount = null;
    queuedHighestBet = null;
    updatePreactionHighlight();
  }

  function setQueue(action, callAmount) {
    if (queuedAction === action) {
      // Toggle off
      clearQueue();
      return;
    }
    queuedAction = action;
    queuedCallAmount = callAmount || null;
    updatePreactionHighlight();
  }

  function updatePreactionHighlight() {
    var checkfoldBtn = document.getElementById('preaction-checkfold');
    var callBtn = document.getElementById('preaction-call');
    var foldBtn = document.getElementById('preaction-fold');
    if (checkfoldBtn) checkfoldBtn.classList.toggle('preaction-active', queuedAction === 'checkfold');
    if (callBtn) callBtn.classList.toggle('preaction-active', queuedAction === 'call');
    if (foldBtn) foldBtn.classList.toggle('preaction-active', queuedAction === 'fold');
  }

  function updatePreactionButtons(state) {
    var callBtn = document.getElementById('preaction-call');
    // Update the call button text with current call amount
    // Find current highest bet to estimate what calling would cost
    if (state.players && myId) {
      var myP = null;
      for (var i = 0; i < state.players.length; i++) {
        if (state.players[i].isYou) { myP = state.players[i]; break; }
      }
      if (myP) {
        // Estimate call amount from what we can see
        var highestBet = 0;
        for (var i = 0; i < state.players.length; i++) {
          if (state.players[i].currentBet > highestBet) {
            highestBet = state.players[i].currentBet;
          }
        }
        var toCall = highestBet - (myP.currentBet || 0);
        if (toCall > 0) {
          callBtn.textContent = 'Call ' + TableRenderer.formatChips(toCall);
          callBtn.style.display = '';
        } else {
          callBtn.style.display = 'none';
          // If we had call queued but there's nothing to call, clear it
          if (queuedAction === 'call') clearQueue();
        }
      }
    }
    updatePreactionHighlight();
  }

  function executeQueuedAction(state) {
    if (!state.validActions) { clearQueue(); return; }
    var actions = state.validActions.actions;
    var action = queuedAction;
    clearQueue();

    if (action === 'checkfold') {
      if (actions.indexOf('check') >= 0) {
        socket.emit('player-action', { action: 'check' });
        Sounds.check();
      } else {
        socket.emit('player-action', { action: 'fold' });
        Sounds.fold();
      }
    } else if (action === 'call') {
      if (actions.indexOf('call') >= 0) {
        socket.emit('player-action', { action: 'call' });
        Sounds.call();
      }
      // If call is no longer valid (raise happened), queue was already cleared
    } else if (action === 'fold') {
      socket.emit('player-action', { action: 'fold' });
      Sounds.fold();
    }
  }

  // ==================== UI Handlers ====================

  // Start button
  document.getElementById('start-btn').addEventListener('click', function() {
    Sounds.stopActive(); // cut off win sound immediately
    socket.emit('start-game');
  });

  // Rebuy button
  document.getElementById('rebuy-btn').addEventListener('click', function() {
    socket.emit('rebuy');
  });

  // Cash out button (lives in the Settings modal)
  document.getElementById('cash-out-btn').addEventListener('click', function() {
    var myPlayer = lastState && lastState.players && lastState.players.find(function(p){ return p.isYou; });
    var midHand = lastState && lastState.phase !== 'waiting';
    if (myPlayer && myPlayer.pendingCashOut) {
      // Toggle off — cancel the queued cash-out
      socket.emit('cash-out');
      return;
    }
    var msg = midHand
      ? 'Cash out after this hand resolves? You will not be dealt into the next hand.'
      : 'Cash out? Your chips will be recorded in the ledger.';
    if (confirm(msg)) {
      socket.emit('cash-out');
    }
  });

  // Pause / Resume / Stop buttons (host only)
  document.getElementById('pause-btn').addEventListener('click', function() {
    socket.emit('pause-game');
  });

  document.getElementById('resume-btn').addEventListener('click', function() {
    socket.emit('resume-game');
  });

  document.getElementById('stop-btn').addEventListener('click', function() {
    if (confirm('Stop the game? The current hand will end and cards will be cleared.')) {
      socket.emit('stop-game');
    }
  });

  // Show cards button
  document.getElementById('show-cards-btn').addEventListener('click', function() {
    socket.emit('show-cards');
    this.style.display = 'none';
  });

  // Bomb pot button (host only)
  document.getElementById('bomb-pot-btn').addEventListener('click', function() {
    socket.emit('trigger-bomb-pot');
  });

  // Give time bank buttons (host only, in settings modal)
  var giveTimeBtns = document.querySelectorAll('.give-time-btn');
  for (var g = 0; g < giveTimeBtns.length; g++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var amount = parseInt(btn.getAttribute('data-amount')) || 30;
        socket.emit('give-time-bank', { amount: amount });
        addSystemMessage('Gave +' + amount + 's time bank to all players');
      });
    })(giveTimeBtns[g]);
  }

  // Run it twice buttons
  document.getElementById('rit-agree-btn').addEventListener('click', function() {
    socket.emit('agree-run-it-twice');
    this.style.display = 'none';
    document.getElementById('rit-decline-btn').style.display = 'none';
    document.getElementById('rit-waiting').style.display = 'block';
  });

  document.getElementById('rit-decline-btn').addEventListener('click', function() {
    socket.emit('decline-run-it-twice');
  });

  // Time Bank floating button
  document.getElementById('time-bank-btn').addEventListener('click', function() {
    socket.emit('use-time-bank');
  });

  // Pre-action queue buttons
  document.getElementById('preaction-checkfold').addEventListener('click', function() {
    setQueue('checkfold');
  });

  document.getElementById('preaction-call').addEventListener('click', function() {
    // Store the estimated call amount so we can detect raises
    var callAmount = null;
    if (lastState && lastState.players) {
      var highestBet = 0;
      var myBet = 0;
      for (var i = 0; i < lastState.players.length; i++) {
        if (lastState.players[i].currentBet > highestBet) highestBet = lastState.players[i].currentBet;
        if (lastState.players[i].isYou) myBet = lastState.players[i].currentBet || 0;
      }
      callAmount = highestBet - myBet;
    }
    setQueue('call', callAmount);
  });

  document.getElementById('preaction-fold').addEventListener('click', function() {
    setQueue('fold');
  });

  // Mute toggle
  document.getElementById('mute-btn').addEventListener('click', function() {
    var isMuted = Sounds.toggleMute();
    this.textContent = isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    this.title = isMuted ? 'Unmute' : 'Mute';
  });
  // Set initial mute button state
  (function() {
    var muteBtn = document.getElementById('mute-btn');
    if (Sounds.isMuted()) {
      muteBtn.textContent = '\uD83D\uDD07';
      muteBtn.title = 'Unmute';
    }
  })();

  // Copy room code
  document.getElementById('copy-code-btn').addEventListener('click', function() {
    var code = document.getElementById('room-code').textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
    } else {
      var ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    this.textContent = 'Copied!';
    var btn = this;
    setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
  });

  // Settings modal
  document.getElementById('settings-btn').addEventListener('click', function() {
    document.getElementById('settings-modal').style.display = 'flex';
  });

  document.getElementById('close-settings').addEventListener('click', function() {
    document.getElementById('settings-modal').style.display = 'none';
  });

  document.getElementById('close-settings-viewer').addEventListener('click', function() {
    document.getElementById('settings-modal').style.display = 'none';
  });

  document.getElementById('save-settings').addEventListener('click', function() {
    socket.emit('update-settings', {
      smallBlind: document.getElementById('set-sb').value,
      bigBlind: document.getElementById('set-bb').value,
      startingChips: document.getElementById('set-chips').value,
      turnTimer: document.getElementById('set-turn-timer').value,
      timeBankTotal: document.getElementById('set-time-bank').value,
      gameMode: document.getElementById('set-game-mode').value,
      rabbitHunting: document.getElementById('set-rabbit-hunting').checked,
      runItTwice: document.getElementById('set-run-it-twice').checked,
      sevenTwoBounty: document.getElementById('set-seven-two-bounty').checked,
      sevenTwoBountyAmount: document.getElementById('set-seven-two-amount').value,
      bombPotEnabled: document.getElementById('set-bomb-pot').checked,
      bombPotAnte: document.getElementById('set-bomb-pot-ante').value,
      bombPotFrequency: document.getElementById('set-bomb-pot-freq').value,
      soundCallRaise: document.getElementById('set-sound-callraise').value,
      soundWin: document.getElementById('set-sound-win').value,
      soundFold: document.getElementById('set-sound-fold').value,
      soundCheckLimp: document.getElementById('set-sound-checklimp').value,
      soundSpecial: document.getElementById('set-sound-special').value
    });
    document.getElementById('settings-modal').style.display = 'none';
  });

  // Settings checkbox toggles for conditional sub-options
  document.getElementById('set-seven-two-bounty').addEventListener('change', function() {
    document.getElementById('seven-two-amount-group').style.display = this.checked ? '' : 'none';
  });
  document.getElementById('set-bomb-pot').addEventListener('change', function() {
    document.getElementById('bomb-pot-options').style.display = this.checked ? '' : 'none';
  });

  // ==================== Sound dropdown population ====================

  var soundDropdownsPopulated = false;

  function populateSoundDropdowns(andThenSync) {
    var sounds = Sounds.getAvailableSounds();
    var mapping = [
      { selectId: 'set-sound-callraise', category: 'Call-Raise' },
      { selectId: 'set-sound-checklimp', category: 'Check-Limp' },
      { selectId: 'set-sound-fold', category: 'Fold' },
      { selectId: 'set-sound-win', category: 'Win' },
      { selectId: 'set-sound-special', category: 'Special' }
    ];
    mapping.forEach(function(m) {
      var sel = document.getElementById(m.selectId);
      if (!sel) return;
      // Remove old custom options (keep default + random)
      while (sel.options.length > 2) sel.remove(2);
      var files = sounds[m.category] || [];
      files.forEach(function(f) {
        var opt = document.createElement('option');
        opt.value = f;
        // Display name: strip extension, replace hyphens/underscores with spaces
        opt.textContent = f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        sel.appendChild(opt);
      });
    });
    soundDropdownsPopulated = true;
    if (andThenSync) syncSoundDropdownValues();
  }

  function syncSoundDropdownValues() {
    var cfg = Sounds.getConfig();
    var selCR = document.getElementById('set-sound-callraise');
    var selCL = document.getElementById('set-sound-checklimp');
    var selFo = document.getElementById('set-sound-fold');
    var selWi = document.getElementById('set-sound-win');
    var selSp = document.getElementById('set-sound-special');
    if (selCR) selCR.value = cfg.soundCallRaise;
    if (selCL) selCL.value = cfg.soundCheckLimp;
    if (selFo) selFo.value = cfg.soundFold;
    if (selWi) selWi.value = cfg.soundWin;
    if (selSp) selSp.value = cfg.soundSpecial;
  }

  // Sync dropdown values when settings modal opens — ensure files are loaded first
  document.getElementById('settings-btn').addEventListener('click', function() {
    Sounds.fetchSoundList(function() {
      populateSoundDropdowns(true);
    });
    // If already fetched, populate immediately too
    if (soundDropdownsPopulated) {
      populateSoundDropdowns(true);
    }
  });

  // Preview: play sound when dropdown value changes
  var soundDropdownMap = [
    { selectId: 'set-sound-callraise', category: 'Call-Raise' },
    { selectId: 'set-sound-checklimp', category: 'Check-Limp' },
    { selectId: 'set-sound-fold', category: 'Fold' },
    { selectId: 'set-sound-win', category: 'Win' },
    { selectId: 'set-sound-special', category: 'Special' }
  ];

  function previewSoundFromSelect(category, val) {
    Sounds.stopActive();
    if (val === 'default') return; // no preview for default synth
    var url;
    if (val === 'random') {
      var files = (Sounds.getAvailableSounds()[category]) || [];
      if (files.length > 0) {
        url = '/assets/' + category + '/' + files[Math.floor(Math.random() * files.length)];
      }
    } else {
      url = '/assets/' + category + '/' + val;
    }
    if (url) {
      var audio = new Audio(url);
      audio.volume = 0.3;
      audio.play();
      // Track so stopActive can kill it
      audio.addEventListener('ended', function() {
        if (previewAudio === audio) previewAudio = null;
      });
      previewAudio = audio;
    }
  }

  var previewAudio = null;
  // Patch stopActive to also stop preview audio
  var origStop = Sounds.stopActive;
  Sounds.stopActive = function() {
    origStop();
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.currentTime = 0;
      previewAudio = null;
    }
  };

  soundDropdownMap.forEach(function(m) {
    var sel = document.getElementById(m.selectId);
    if (sel) {
      sel.addEventListener('change', function() {
        previewSoundFromSelect(m.category, sel.value);
      });
    }
  });

  // Preview button — plays all non-default sounds in sequence
  document.getElementById('preview-sound-btn').addEventListener('click', function() {
    var delays = [0, 2000, 4000, 6000, 8000];
    var idx = 0;
    soundDropdownMap.forEach(function(m) {
      var sel = document.getElementById(m.selectId);
      if (sel && sel.value !== 'default') {
        (function(cat, val, delay) {
          setTimeout(function() {
            previewSoundFromSelect(cat, val);
          }, delay);
        })(m.category, sel.value, delays[idx]);
        idx++;
      }
    });
    if (idx === 0) {
      // All default — just play default check
      Sounds.check();
    }
  });

  // Close modal on overlay click
  document.getElementById('settings-modal').addEventListener('click', function(e) {
    if (e.target === this) {
      this.style.display = 'none';
    }
  });

  // ==================== Helpers ====================

  function addSystemMessage(text) {
    Chat.addMessage({ name: 'System', text: text });
  }
})();
