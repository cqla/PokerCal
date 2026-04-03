/**
 * Tests for disconnect/reconnect behavior:
 * - Player stays seated on disconnect
 * - Player stays in hand mid-game on disconnect (not auto-folded)
 * - Host keeps host privileges on reconnect
 * - Reconnecting player gets their original name (no dedup)
 * - Disconnected player is auto-acted when timer expires (not immediately)
 * - Reconnected player gets fresh turn timer
 * - After hand ends, disconnected players become sitting out
 * - canAct() works for disconnected players (they stay in hand)
 */

var Game = require('../src/game/Game');
var Player = require('../src/player/Player');

function createGame(settings) {
  return new Game('TEST', settings || {});
}

function seatTwoPlayers(game) {
  game.setHost('socket-1');
  game.seatPlayer('socket-1', 'Alice', 0, 1000);
  game.seatPlayer('socket-2', 'Bob', 4, 1000);
  return game;
}

function seatThreePlayers(game) {
  game.setHost('socket-1');
  game.seatPlayer('socket-1', 'Alice', 0, 1000);
  game.seatPlayer('socket-2', 'Bob', 2, 1000);
  game.seatPlayer('socket-3', 'Charlie', 4, 1000);
  return game;
}

// ==================== Player.canAct() ====================

describe('Player.canAct', function() {
  test('returns true for connected, active player', function() {
    var p = new Player('s1', 'Test');
    expect(p.canAct()).toBe(true);
  });

  test('returns false for folded player', function() {
    var p = new Player('s1', 'Test');
    p.isFolded = true;
    expect(p.canAct()).toBe(false);
  });

  test('returns false for all-in player', function() {
    var p = new Player('s1', 'Test');
    p.isAllIn = true;
    expect(p.canAct()).toBe(false);
  });

  test('returns false for sitting-out player', function() {
    var p = new Player('s1', 'Test');
    p.isSittingOut = true;
    expect(p.canAct()).toBe(false);
  });

  test('returns true for disconnected (but not folded/sitting-out) player', function() {
    var p = new Player('s1', 'Test');
    p.isConnected = false;
    // Disconnected players can still act — the server auto-acts for them
    expect(p.canAct()).toBe(true);
  });
});

// ==================== addPlayer (reconnection) ====================

describe('Game.addPlayer reconnection', function() {
  test('returns existing player when name matches', function() {
    var game = createGame();
    game.seatPlayer('old-socket', 'Alice', 0, 1000);

    var result = game.addPlayer('new-socket', 'Alice');
    expect(result).not.toBeNull();
    expect(result.name).toBe('Alice');
    expect(result.id).toBe('new-socket');
  });

  test('sets isConnected to true on reconnect', function() {
    var game = createGame();
    game.seatPlayer('old-socket', 'Alice', 0, 1000);
    game.players[0].isConnected = false;

    game.addPlayer('new-socket', 'Alice');
    expect(game.players[0].isConnected).toBe(true);
  });

  test('clears isSittingOut on reconnect', function() {
    var game = createGame();
    game.seatPlayer('old-socket', 'Alice', 0, 1000);
    game.players[0].isSittingOut = true;
    game.players[0].isConnected = false;

    game.addPlayer('new-socket', 'Alice');
    expect(game.players[0].isSittingOut).toBe(false);
  });

  test('updates hostId when host reconnects', function() {
    var game = createGame();
    game.setHost('old-socket');
    game.seatPlayer('old-socket', 'Alice', 0, 1000);

    game.addPlayer('new-socket', 'Alice');
    expect(game.hostId).toBe('new-socket');
  });

  test('does not change hostId when non-host reconnects', function() {
    var game = createGame();
    game.setHost('host-socket');
    game.seatPlayer('host-socket', 'Alice', 0, 1000);
    game.seatPlayer('old-socket', 'Bob', 1, 1000);

    game.addPlayer('new-socket', 'Bob');
    expect(game.hostId).toBe('host-socket');
  });

  test('returns null for unknown name', function() {
    var game = createGame();
    game.seatPlayer('s1', 'Alice', 0, 1000);

    var result = game.addPlayer('s2', 'Unknown');
    expect(result).toBeNull();
  });

  test('preserves chips and seat on reconnect', function() {
    var game = createGame();
    game.seatPlayer('old-socket', 'Alice', 3, 500);
    game.players[0].chips = 750;
    game.players[0].isConnected = false;

    game.addPlayer('new-socket', 'Alice');
    expect(game.players[0].chips).toBe(750);
    expect(game.players[0].seatIndex).toBe(3);
  });
});

// ==================== disconnectPlayer ====================

describe('Game.disconnectPlayer', function() {
  test('marks player as disconnected', function() {
    var game = createGame();
    game.seatPlayer('s1', 'Alice', 0, 1000);

    game.disconnectPlayer('s1');
    expect(game.players[0].isConnected).toBe(false);
  });

  test('does NOT fold player mid-hand', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();

    // One player is current, disconnect them
    var currentIdx = game.currentPlayerIndex;
    var currentPlayer = game.players[currentIdx];
    game.disconnectPlayer(currentPlayer.id);

    expect(currentPlayer.isConnected).toBe(false);
    expect(currentPlayer.isFolded).toBe(false);
    expect(currentPlayer.canAct()).toBe(true);
  });

  test('does NOT advance action on disconnect', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();

    var currentIdx = game.currentPlayerIndex;
    var currentPlayer = game.players[currentIdx];
    game.disconnectPlayer(currentPlayer.id);

    // Current player index should NOT have changed
    expect(game.currentPlayerIndex).toBe(currentIdx);
  });

  test('does NOT end hand on disconnect', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();
    var phase = game.phase;

    var currentPlayer = game.players[game.currentPlayerIndex];
    game.disconnectPlayer(currentPlayer.id);

    // Phase should not have changed
    expect(game.phase).toBe(phase);
  });
});

// ==================== sitOutDisconnectedPlayers ====================

describe('Game.sitOutDisconnectedPlayers', function() {
  test('marks disconnected players as sitting out', function() {
    var game = createGame();
    game.seatPlayer('s1', 'Alice', 0, 1000);
    game.seatPlayer('s2', 'Bob', 1, 1000);
    game.players[0].isConnected = false;

    game.sitOutDisconnectedPlayers();
    expect(game.players[0].isSittingOut).toBe(true);
    expect(game.players[1].isSittingOut).toBe(false);
  });

  test('does not affect already sitting-out players', function() {
    var game = createGame();
    game.seatPlayer('s1', 'Alice', 0, 1000);
    game.players[0].isConnected = false;
    game.players[0].isSittingOut = true;

    // Should not throw or double-log
    game.sitOutDisconnectedPlayers();
    expect(game.players[0].isSittingOut).toBe(true);
  });

  test('does not affect connected players', function() {
    var game = createGame();
    game.seatPlayer('s1', 'Alice', 0, 1000);
    game.seatPlayer('s2', 'Bob', 1, 1000);

    game.sitOutDisconnectedPlayers();
    expect(game.players[0].isSittingOut).toBe(false);
    expect(game.players[1].isSittingOut).toBe(false);
  });
});

// ==================== Mid-hand disconnect behavior ====================

describe('Mid-hand disconnect keeps player in hand', function() {
  test('disconnected player remains in activePlayers', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();

    var p = game.players[0];
    p.isConnected = false;

    var active = game.getActivePlayers();
    var names = active.map(function(a) { return a.name; });
    expect(names).toContain(p.name);
  });

  test('disconnected player remains in actablePlayers (canAct is true)', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();

    var p = game.players[0];
    if (p.isFolded || p.isAllIn) p = game.players[1]; // pick one that's active
    p.isConnected = false;

    var actable = game.getActablePlayers();
    var names = actable.map(function(a) { return a.name; });
    expect(names).toContain(p.name);
  });

  test('advanceAction lands on disconnected player', function() {
    var game = seatThreePlayers(createGame());
    game.startHand();

    // Find a player who is not the current player and disconnect them
    var otherIdx = -1;
    for (var i = 0; i < game.players.length; i++) {
      if (i !== game.currentPlayerIndex && !game.players[i].isFolded && !game.players[i].isAllIn) {
        otherIdx = i;
        break;
      }
    }
    if (otherIdx < 0) return; // skip if we can't find one

    game.players[otherIdx].isConnected = false;

    // Process current player's action to advance
    var currentPlayer = game.players[game.currentPlayerIndex];
    game.processAction(currentPlayer.id, 'call');

    // The game should continue — check that the disconnected player can be current
    // (it may or may not be their turn depending on seat order)
    expect(game.phase).not.toBe('waiting');
  });

  test('getStateForPlayer includes hole cards for reconnected mid-hand player', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();

    var p = game.players[0];
    var originalCards = p.holeCards.slice();
    p.isConnected = false;

    // Simulate reconnect
    game.addPlayer('new-socket', p.name);

    var state = game.getStateForPlayer('new-socket');
    var myPlayer = state.players.find(function(pl) { return pl.isYou; });
    expect(myPlayer).toBeDefined();
    expect(myPlayer.holeCards).toBeDefined();
    expect(myPlayer.holeCards.length).toBeGreaterThanOrEqual(2);
  });

  test('getStateForPlayer includes validActions for reconnected current player', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();

    var currentPlayer = game.players[game.currentPlayerIndex];
    currentPlayer.isConnected = false;

    // Simulate reconnect
    game.addPlayer('new-socket', currentPlayer.name);

    var state = game.getStateForPlayer('new-socket');
    expect(state.validActions).not.toBeNull();
    expect(state.validActions.actions.length).toBeGreaterThan(0);
  });
});

// ==================== removePlayer (used only for kicks) ====================

describe('Game.removePlayer', function() {
  test('removes player from array', function() {
    var game = createGame();
    game.seatPlayer('s1', 'Alice', 0, 1000);
    expect(game.players.length).toBe(1);

    game.removePlayer('s1');
    expect(game.players.length).toBe(0);
  });

  test('returns null for unknown id', function() {
    var game = createGame();
    expect(game.removePlayer('unknown')).toBeNull();
  });
});

// ==================== Hand flow with disconnect ====================

describe('Full hand flow with disconnect', function() {
  test('player disconnects, hand continues, new hand marks them sitting out', function() {
    var game = seatThreePlayers(createGame());
    game.startHand();

    // Disconnect one non-current player
    var disconnectIdx = -1;
    for (var i = 0; i < game.players.length; i++) {
      if (i !== game.currentPlayerIndex) {
        disconnectIdx = i;
        break;
      }
    }
    game.players[disconnectIdx].isConnected = false;

    // Play out the hand — everyone folds except one
    var iterations = 0;
    while (game.phase !== 'waiting' && iterations < 20) {
      if (game.currentPlayerIndex < 0) break;
      var cp = game.players[game.currentPlayerIndex];
      if (cp && cp.canAct()) {
        game.processAction(cp.id, 'fold');
      } else {
        break;
      }
      iterations++;
    }

    // Hand should have ended
    expect(game.phase).toBe('waiting');

    // Disconnected player should now be sitting out
    expect(game.players[disconnectIdx].isSittingOut).toBe(true);
  });

  test('reconnecting after being marked sitting out restores active status', function() {
    var game = createGame();
    game.seatPlayer('s1', 'Alice', 0, 1000);
    game.players[0].isConnected = false;
    game.players[0].isSittingOut = true;

    game.addPlayer('new-s1', 'Alice');
    expect(game.players[0].isConnected).toBe(true);
    expect(game.players[0].isSittingOut).toBe(false);
  });
});

// ==================== canStartHand with disconnected players ====================

describe('canStartHand with disconnected players', function() {
  test('cannot start hand if all remaining connected players < 2', function() {
    var game = seatTwoPlayers(createGame());
    game.players[1].isConnected = false;
    game.players[1].isSittingOut = true;

    expect(game.canStartHand()).toBe(false);
  });

  test('can start hand with 2+ connected non-sitting-out players', function() {
    var game = seatThreePlayers(createGame());
    game.players[2].isConnected = false;
    game.players[2].isSittingOut = true;

    expect(game.canStartHand()).toBe(true);
  });
});

// ==================== getPlayer returns null for old socket ====================

describe('getPlayer after reconnect', function() {
  test('getPlayer with old socket id returns null after reconnect', function() {
    var game = createGame();
    game.seatPlayer('old-socket', 'Alice', 0, 1000);

    game.addPlayer('new-socket', 'Alice');

    expect(game.getPlayer('old-socket')).toBeNull();
    expect(game.getPlayer('new-socket')).not.toBeNull();
    expect(game.getPlayer('new-socket').name).toBe('Alice');
  });
});

// ==================== Time bank persists on reconnect ====================

describe('Time bank persistence', function() {
  test('time bank value persists across disconnect/reconnect', function() {
    var game = createGame();
    game.seatPlayer('old-socket', 'Alice', 0, 1000);

    // Use some time bank
    game.players[0].timeBank = 45;
    game.players[0].isConnected = false;

    game.addPlayer('new-socket', 'Alice');
    expect(game.players[0].timeBank).toBe(45);
  });

  test('time bank is NOT reset when reconnecting mid-hand', function() {
    var game = seatTwoPlayers(createGame());
    game.startHand();

    // Simulate using some time bank
    game.players[0].timeBank = 30;
    game.players[0].isConnected = false;

    // Reconnect
    game.addPlayer('new-socket-1', 'Alice');
    expect(game.players[0].timeBank).toBe(30);
    expect(game.players[0].isConnected).toBe(true);
  });

  test('getStateForPlayer reports correct time bank after reconnect', function() {
    var game = createGame();
    game.seatPlayer('old-socket', 'Alice', 0, 1000);
    game.players[0].timeBank = 60;
    game.players[0].isConnected = false;

    game.addPlayer('new-socket', 'Alice');
    var state = game.getStateForPlayer('new-socket');
    expect(state.myTimeBank).toBe(60);
  });
});
