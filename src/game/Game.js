var Deck = require('./Deck');
var PotManager = require('./PotManager');
var HandEvaluator = require('./HandEvaluator');
var constants = require('./constants');
var PHASES = constants.PHASES;
var ACTIONS = constants.ACTIONS;

function Game(roomCode, settings) {
  this.roomCode = roomCode;
  this.players = [];
  this.phase = PHASES.WAITING;
  this.deck = new Deck.Deck();
  this.potManager = new PotManager();
  this.communityCards = [];
  this.dealerIndex = -1;
  this.currentPlayerIndex = -1;
  this.highestBet = 0;
  this.minRaise = 0;
  this.lastRaiseAmount = 0;
  this.handNumber = 0;
  this.gameLog = [];
  this.lastHandResults = null;
  this.autoStartTimer = null;
  this.hostId = null;
  this.hostCreatorName = null;
  this.pendingJoins = []; // { id, name, socketId }
  this.ledger = {}; // { playerName: { buyIns: number, buyOuts: number, net: number, events: [] } }
  this.turnDeadline = null; // timestamp when current turn expires
  this.isPaused = false;
  this.rabbitCards = []; // community cards that would have come (rabbit hunting)
  this.runItTwiceData = null; // { board1, board2, results1, results2, equities }
  this.runItTwicePending = false; // true when waiting for players to agree
  this.runItTwiceAgreed = {}; // { playerId: true }
  this.isBombPot = false;
  this.bombPotCounter = 0; // counts hands for frequency-based bomb pots
  this.sevenTwoWinner = null; // name of player who won with 7-2
  this.settings = {
    smallBlind: (settings && settings.smallBlind) || 10,
    bigBlind: (settings && settings.bigBlind) || 20,
    startingChips: (settings && settings.startingChips) || 1000,
    turnTimer: (settings && settings.turnTimer) || 60,
    timeBankTotal: (settings && settings.timeBankTotal) || 120,
    autoStart: true,
    rabbitHunting: false,
    runItTwice: false,
    sevenTwoBounty: false,
    sevenTwoBountyAmount: 0, // 0 = big blind amount
    bombPotEnabled: false,
    bombPotAnte: 0, // 0 = big blind amount
    bombPotFrequency: 5, // every N hands, 0 = manual only
    gameMode: 'nlh' // 'nlh' = No Limit Hold'em, 'plo5' = Pot Limit Omaha 5
  };
}

Game.prototype.isPLO = function() {
  return this.settings.gameMode === 'plo5';
};

Game.prototype.getHoleCardCount = function() {
  return this.isPLO() ? 5 : 2;
};

// ==================== Host Management ====================

Game.prototype.setHost = function(id) {
  this.hostId = id;
};

Game.prototype.isHost = function(id) {
  return this.hostId === id;
};

Game.prototype.addPendingJoin = function(socketId, name) {
  // Don't add duplicates
  for (var i = 0; i < this.pendingJoins.length; i++) {
    if (this.pendingJoins[i].name === name) {
      this.pendingJoins[i].socketId = socketId;
      return;
    }
  }
  this.pendingJoins.push({ socketId: socketId, name: name });
};

Game.prototype.removePendingJoin = function(name) {
  for (var i = 0; i < this.pendingJoins.length; i++) {
    if (this.pendingJoins[i].name === name) {
      this.pendingJoins.splice(i, 1);
      return;
    }
  }
};

Game.prototype.getPendingJoin = function(name) {
  for (var i = 0; i < this.pendingJoins.length; i++) {
    if (this.pendingJoins[i].name === name) return this.pendingJoins[i];
  }
  return null;
};

Game.prototype.setPlayerChips = function(playerName, amount) {
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].name === playerName) {
      this.players[i].chips = amount;
      this.addLog('Host set ' + playerName + '\'s chips to ' + amount);
      return true;
    }
  }
  return false;
};

// ==================== Session Ledger ====================

Game.prototype.recordLedgerEvent = function(playerName, type, amount) {
  if (!this.ledger[playerName]) {
    this.ledger[playerName] = { buyIns: 0, buyOuts: 0, net: 0, events: [] };
  }
  var entry = this.ledger[playerName];
  entry.events.push({ type: type, amount: amount, time: Date.now() });

  if (type === 'buy-in') {
    entry.buyIns += amount;
  } else if (type === 'buy-out') {
    entry.buyOuts += amount;
  }
  entry.net = entry.buyOuts - entry.buyIns;
};

Game.prototype.getLedgerSummary = function() {
  var summary = [];
  var self = this;
  var names = Object.keys(this.ledger);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var entry = this.ledger[name];
    // Find current chips if still seated (include chips currently bet in pot)
    var currentChips = 0;
    var isSeated = false;
    for (var j = 0; j < self.players.length; j++) {
      if (self.players[j].name === name) {
        currentChips = self.players[j].chips + (self.players[j].currentBet || 0);
        isSeated = true;
        break;
      }
    }
    summary.push({
      name: name,
      buyIns: entry.buyIns,
      buyOuts: entry.buyOuts,
      currentChips: currentChips,
      isSeated: isSeated,
      net: isSeated ? (currentChips - entry.buyIns) : (entry.buyOuts - entry.buyIns)
    });
  }
  return summary;
};

// ==================== Player Management ====================

Game.prototype.addPlayer = function(id, name) {
  // Check if player already exists (reconnecting)
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].name === name) {
      var oldId = this.players[i].id;
      this.players[i].id = id;
      this.players[i].isConnected = true;
      this.players[i].isSittingOut = false; // Reconnected — back in action
      if (this.players[i].disconnectTimer) {
        clearTimeout(this.players[i].disconnectTimer);
        this.players[i].disconnectTimer = null;
      }
      // If this player was host, update hostId to new socket
      if (this.hostId === oldId) {
        this.hostId = id;
      }
      return this.players[i];
    }
  }
  return null; // Player needs to take a seat
};

Game.prototype.seatPlayer = function(id, name, seatIndex, buyIn) {
  // Validate seat
  if (seatIndex < 0 || seatIndex >= constants.MAX_PLAYERS) return null;
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].seatIndex === seatIndex) return null;
  }

  var Player = require('../player/Player');
  var player = new Player(id, name);
  player.seatIndex = seatIndex;
  player.chips = buyIn || this.settings.startingChips;
  player.timeBank = this.settings.timeBankTotal || 120;
  player.pendingCashOut = false;
  this.players.push(player);

  this.addLog(name + ' joined the table (seat ' + (seatIndex + 1) + ')');
  return player;
};

Game.prototype.removePlayer = function(id) {
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].id === id) {
      var player = this.players[i];
      this.players.splice(i, 1);
      this.addLog(player.name + ' left the table');
      return player;
    }
  }
  return null;
};

// Called when a player disconnects mid-hand — marks as disconnected
// but keeps them in the hand. The turn timer will auto-check/fold if needed.
Game.prototype.disconnectPlayer = function(id) {
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].id === id) {
      var player = this.players[i];
      player.isConnected = false;
      return player;
    }
  }
  return null;
};

Game.prototype.getPlayer = function(id) {
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].id === id) return this.players[i];
  }
  return null;
};

Game.prototype.getActivePlayers = function() {
  return this.players.filter(function(p) { return p.isActive() && p.holeCards.length > 0; });
};

Game.prototype.getActablePlayers = function() {
  return this.players.filter(function(p) { return p.canAct(); });
};

Game.prototype.getSeatedPlayerCount = function() {
  return this.players.filter(function(p) { return !p.isSittingOut; }).length;
};

// After a hand ends, mark any disconnected players as sitting out
// so they don't block the next hand from starting
Game.prototype.sitOutDisconnectedPlayers = function() {
  for (var i = 0; i < this.players.length; i++) {
    if (!this.players[i].isConnected && !this.players[i].isSittingOut) {
      this.players[i].isSittingOut = true;
      this.addLog(this.players[i].name + ' is sitting out (disconnected)');
    }
  }
};

// ==================== Game Flow ====================

Game.prototype.canStartHand = function() {
  var eligible = this.players.filter(function(p) {
    return !p.isSittingOut && p.isConnected && p.chips > 0;
  });
  return eligible.length >= 2 && this.phase === PHASES.WAITING;
};

Game.prototype.startHand = function() {
  if (!this.canStartHand()) return false;

  this.handNumber++;
  this.communityCards = [];
  this.potManager.reset();
  this.lastHandResults = null;
  this.rabbitCards = [];
  this.runItTwiceData = null;
  this.runItTwicePending = false;
  this.runItTwiceAgreed = {};
  this.sevenTwoWinner = null;
  this.deck.reset();

  // Check if this should be a bomb pot
  this.bombPotCounter++;
  var forceBombPot = this.isBombPot; // set by trigger-bomb-pot
  var autoBombPot = this.settings.bombPotEnabled && this.settings.bombPotFrequency > 0 &&
                    this.bombPotCounter >= this.settings.bombPotFrequency;
  this.isBombPot = forceBombPot || autoBombPot;
  if (autoBombPot) this.bombPotCounter = 0;

  // Reset players
  var activePlayers = [];
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    p.resetForNewHand();
    if (!p.isSittingOut && p.isConnected && p.chips > 0) {
      activePlayers.push(p);
    } else {
      p.isFolded = true;
    }
  }

  // Advance dealer
  this.dealerIndex = this.nextActivePlayerIndex(this.dealerIndex);

  if (this.isBombPot) {
    return this.startBombPot(activePlayers);
  }

  this.phase = PHASES.PREFLOP;

  this.addLog('--- Hand #' + this.handNumber + ' ---');
  this.addLog(this.players[this.dealerIndex].name + ' is the dealer');

  // Post blinds
  this.postBlinds(activePlayers);

  // Deal hole cards
  this.dealHoleCards();

  // Set action to player after big blind
  var bbIndex;
  if (activePlayers.length === 2) {
    // Heads up: dealer is SB, other is BB, dealer acts first preflop
    bbIndex = this.nextActivePlayerIndex(this.dealerIndex);
    this.currentPlayerIndex = this.dealerIndex;
  } else {
    var sbIndex = this.nextActivePlayerIndex(this.dealerIndex);
    bbIndex = this.nextActivePlayerIndex(sbIndex);
    this.currentPlayerIndex = this.nextActivePlayerIndex(bbIndex);
  }

  this.highestBet = this.settings.bigBlind;
  this.minRaise = this.settings.bigBlind;
  this.lastRaiseAmount = this.settings.bigBlind;

  // Skip players who are already all-in from blinds
  if (!this.players[this.currentPlayerIndex].canAct()) {
    this.advanceAction();
  }

  return true;
};

// ==================== Bomb Pot ====================

Game.prototype.startBombPot = function(activePlayers) {
  var anteAmount = this.settings.bombPotAnte || this.settings.bigBlind;

  this.addLog('--- Hand #' + this.handNumber + ' (BOMB POT) ---');
  this.addLog('All players ante ' + anteAmount);

  // Everyone posts ante
  for (var i = 0; i < activePlayers.length; i++) {
    var p = activePlayers[i];
    var actual = p.bet(Math.min(anteAmount, p.chips));
    p.lastAction = 'Ante ' + actual;
  }

  // Collect antes into pot
  this.potManager.collectBets(this.players);

  // Deal hole cards
  this.dealHoleCards();

  // Deal flop immediately
  this.phase = PHASES.FLOP;
  this.deck.burn();
  this.communityCards.push(this.deck.deal());
  this.communityCards.push(this.deck.deal());
  this.communityCards.push(this.deck.deal());
  this.addLog('*** BOMB POT FLOP *** [' + this.communityCardsString() + ']');

  this.highestBet = 0;
  this.minRaise = this.settings.bigBlind;
  this.lastRaiseAmount = 0;

  // Action starts left of dealer
  this.currentPlayerIndex = this.nextActivePlayerIndex(this.dealerIndex);

  // Find first actable player (clockwise)
  if (!this.players[this.currentPlayerIndex].canAct()) {
    var next = this.nextActableIndex(this.currentPlayerIndex);
    if (next === this.currentPlayerIndex) {
      this.advancePhase();
    } else {
      this.currentPlayerIndex = next;
    }
  }

  this.isBombPot = false; // reset flag
  return true;
};

Game.prototype.postBlinds = function(activePlayers) {
  var sbIndex, bbIndex;

  if (activePlayers.length === 2) {
    // Heads up: dealer posts small blind
    sbIndex = this.dealerIndex;
    bbIndex = this.nextActivePlayerIndex(this.dealerIndex);
  } else {
    sbIndex = this.nextActivePlayerIndex(this.dealerIndex);
    bbIndex = this.nextActivePlayerIndex(sbIndex);
  }

  var sbPlayer = this.players[sbIndex];
  var sbAmount = sbPlayer.bet(this.settings.smallBlind);
  sbPlayer.lastAction = 'SB';
  this.addLog(sbPlayer.name + ' posts small blind ' + sbAmount);

  var bbPlayer = this.players[bbIndex];
  var bbAmount = bbPlayer.bet(this.settings.bigBlind);
  bbPlayer.lastAction = 'BB';
  this.addLog(bbPlayer.name + ' posts big blind ' + bbAmount);
};

Game.prototype.dealHoleCards = function() {
  var count = this.getHoleCardCount();
  for (var round = 0; round < count; round++) {
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (p.isActive() && !p.isSittingOut && p.isConnected) {
        p.holeCards.push(this.deck.deal());
      }
    }
  }
};

// ==================== Actions ====================

Game.prototype.getValidActions = function(playerId) {
  var player = this.getPlayer(playerId);
  if (!player || this.currentPlayerIndex === -1) return null;
  if (this.players[this.currentPlayerIndex].id !== playerId) return null;

  var actions = [ACTIONS.FOLD];
  var toCall = this.highestBet - player.currentBet;

  if (toCall <= 0) {
    actions.push(ACTIONS.CHECK);
  } else {
    actions.push(ACTIONS.CALL);
  }

  // Can raise if not all-in and has enough chips
  var minRaiseTotal = this.highestBet + this.minRaise;
  var maxRaiseTotal = player.chips + player.currentBet;

  // Pot-limit: max raise = pot + call amount + pot after call
  if (this.isPLO()) {
    var potTotal = this.potManager.getTotalPot() + this.getCurrentBetsTotal();
    var callCost = Math.min(toCall, player.chips);
    var potAfterCall = potTotal + callCost;
    maxRaiseTotal = Math.min(player.chips + player.currentBet, this.highestBet + potAfterCall);
  }

  if (player.chips + player.currentBet > this.highestBet) {
    actions.push(ACTIONS.RAISE);
  }

  actions.push(ACTIONS.ALL_IN);

  return {
    actions: actions,
    toCall: Math.min(toCall, player.chips),
    minRaise: Math.min(minRaiseTotal, player.chips + player.currentBet),
    maxRaise: maxRaiseTotal,
    pot: this.potManager.getTotalPot() + this.getCurrentBetsTotal()
  };
};

Game.prototype.processAction = function(playerId, action, amount) {
  var player = this.getPlayer(playerId);
  if (!player) return { success: false, error: 'Player not found' };
  if (this.currentPlayerIndex === -1) return { success: false, error: 'No active hand' };
  if (this.players[this.currentPlayerIndex].id !== playerId) {
    return { success: false, error: 'Not your turn' };
  }

  var toCall = this.highestBet - player.currentBet;

  switch (action) {
    case ACTIONS.FOLD:
      player.isFolded = true;
      player.lastAction = 'Fold';
      this.addLog(player.name + ' folds');
      break;

    case ACTIONS.CHECK:
      if (toCall > 0) return { success: false, error: 'Cannot check, must call ' + toCall };
      player.lastAction = 'Check';
      this.addLog(player.name + ' checks');
      break;

    case ACTIONS.CALL:
      if (toCall <= 0) {
        // Treat as check
        player.lastAction = 'Check';
        this.addLog(player.name + ' checks');
      } else {
        var callAmount = player.bet(toCall);
        player.lastAction = 'Call ' + callAmount;
        this.addLog(player.name + ' calls ' + callAmount);
      }
      break;

    case ACTIONS.RAISE:
      if (!amount) return { success: false, error: 'Raise amount required' };

      var raiseToTotal = amount; // Total bet amount (not additional)
      var raiseBy = raiseToTotal - this.highestBet;

      // Validate minimum raise (unless it's an all-in)
      if (raiseToTotal < this.highestBet + this.minRaise && raiseToTotal !== player.chips + player.currentBet) {
        return { success: false, error: 'Minimum raise is ' + (this.highestBet + this.minRaise) };
      }

      // Validate pot-limit max raise
      if (this.isPLO()) {
        var potTotal = this.potManager.getTotalPot() + this.getCurrentBetsTotal();
        var callCost = Math.min(this.highestBet - player.currentBet, player.chips);
        var potAfterCall = potTotal + callCost;
        var maxAllowed = this.highestBet + potAfterCall;
        if (raiseToTotal > maxAllowed && raiseToTotal !== player.chips + player.currentBet) {
          raiseToTotal = maxAllowed; // Cap at pot limit
        }
      }

      var additionalBet = raiseToTotal - player.currentBet;
      if (additionalBet > player.chips) {
        return { success: false, error: 'Not enough chips' };
      }

      player.bet(additionalBet);
      this.lastRaiseAmount = raiseBy;
      this.minRaise = Math.max(this.minRaise, raiseBy);
      this.highestBet = raiseToTotal;
      player.lastAction = 'Raise ' + raiseToTotal;
      this.addLog(player.name + ' raises to ' + raiseToTotal);

      // Reset hasActed for all other active players
      for (var i = 0; i < this.players.length; i++) {
        if (this.players[i].id !== playerId && !this.players[i].isFolded && !this.players[i].isAllIn) {
          this.players[i].hasActed = false;
        }
      }
      break;

    case ACTIONS.ALL_IN:
      var allInAmount = player.chips;
      var totalBet = player.currentBet + allInAmount;
      player.bet(allInAmount);

      if (totalBet > this.highestBet) {
        var raiseBy = totalBet - this.highestBet;
        if (raiseBy >= this.minRaise) {
          this.minRaise = raiseBy;
        }
        this.highestBet = totalBet;

        // Reset hasActed for all other active players
        for (var i = 0; i < this.players.length; i++) {
          if (this.players[i].id !== playerId && !this.players[i].isFolded && !this.players[i].isAllIn) {
            this.players[i].hasActed = false;
          }
        }
      }

      player.lastAction = 'All-in ' + totalBet;
      this.addLog(player.name + ' goes all-in for ' + totalBet);
      break;

    default:
      return { success: false, error: 'Invalid action' };
  }

  player.hasActed = true;
  this.advanceAction();
  return { success: true };
};

Game.prototype.advanceAction = function() {
  // Check if only one player remains
  var activePlayers = this.getActivePlayers();
  if (activePlayers.length <= 1) {
    this.endHand();
    return;
  }

  // Check if betting round is complete
  var actable = this.getActablePlayers();
  var allActed = true;
  for (var i = 0; i < actable.length; i++) {
    if (!actable[i].hasActed || actable[i].currentBet < this.highestBet) {
      allActed = false;
      break;
    }
  }

  if (actable.length === 0 || allActed) {
    this.advancePhase();
    return;
  }

  // Move to next player who can act (clockwise by seat)
  var next = this.nextActableIndex(this.currentPlayerIndex);
  if (next === this.currentPlayerIndex) {
    this.advancePhase();
    return;
  }
  this.currentPlayerIndex = next;
};

Game.prototype.advancePhase = function() {
  // Collect bets into pots
  this.potManager.collectBets(this.players);
  this.highestBet = 0;
  this.lastRaiseAmount = 0;
  this.minRaise = this.settings.bigBlind;

  // Reset hasActed for all players
  for (var i = 0; i < this.players.length; i++) {
    this.players[i].hasActed = false;
    this.players[i].lastAction = null;
  }

  var activePlayers = this.getActivePlayers();
  var actablePlayers = this.getActablePlayers();

  // If everyone is all-in (or only one can act), run out the board
  if (actablePlayers.length <= 1) {
    // Check if run-it-twice is available
    if (this.canRunItTwice() && activePlayers.length >= 2) {
      this.runItTwicePending = true;
      // Don't run out the board yet - wait for player agreement
      return;
    }
    this.runOutBoard();
    return;
  }

  switch (this.phase) {
    case PHASES.PREFLOP:
      this.phase = PHASES.FLOP;
      this.deck.burn();
      this.communityCards.push(this.deck.deal());
      this.communityCards.push(this.deck.deal());
      this.communityCards.push(this.deck.deal());
      this.addLog('*** FLOP *** [' + this.communityCardsString() + ']');
      break;
    case PHASES.FLOP:
      this.phase = PHASES.TURN;
      this.deck.burn();
      this.communityCards.push(this.deck.deal());
      this.addLog('*** TURN *** [' + this.communityCardsString() + ']');
      break;
    case PHASES.TURN:
      this.phase = PHASES.RIVER;
      this.deck.burn();
      this.communityCards.push(this.deck.deal());
      this.addLog('*** RIVER *** [' + this.communityCardsString() + ']');
      break;
    case PHASES.RIVER:
      this.endHand();
      return;
  }

  // Set first player to act (left of dealer)
  this.currentPlayerIndex = this.nextActivePlayerIndex(this.dealerIndex);

  // Find first actable player (clockwise by seat)
  if (!this.players[this.currentPlayerIndex].canAct()) {
    var next = this.nextActableIndex(this.currentPlayerIndex);
    if (next === this.currentPlayerIndex) {
      this.advancePhase();
      return;
    }
    this.currentPlayerIndex = next;
  }
};

Game.prototype.runOutBoard = function() {
  // Deal remaining community cards
  while (this.communityCards.length < 5) {
    this.deck.burn();
    this.communityCards.push(this.deck.deal());

    if (this.communityCards.length === 3) {
      this.phase = PHASES.FLOP;
      this.addLog('*** FLOP *** [' + this.communityCardsString() + ']');
    } else if (this.communityCards.length === 4) {
      this.phase = PHASES.TURN;
      this.addLog('*** TURN *** [' + this.communityCardsString() + ']');
    } else if (this.communityCards.length === 5) {
      this.phase = PHASES.RIVER;
      this.addLog('*** RIVER *** [' + this.communityCardsString() + ']');
    }
  }

  this.endHand();
};

Game.prototype.endHand = function() {
  // Collect any remaining bets
  this.potManager.collectBets(this.players);

  this.phase = PHASES.SHOWDOWN;
  this.currentPlayerIndex = -1;

  var activePlayers = this.getActivePlayers();

  if (activePlayers.length === 1) {
    // Everyone else folded
    var winner = activePlayers[0];
    var totalPot = this.potManager.getTotalPot();
    winner.chips += totalPot;

    this.lastHandResults = [{
      potIndex: 0,
      amount: totalPot,
      winners: [{
        id: winner.id,
        name: winner.name,
        hand: null,
        handRank: null,
        cards: []
      }],
      share: totalPot
    }];

    this.addLog(winner.name + ' wins ' + totalPot + ' (others folded)');
    this.potManager.reset();

    // Rabbit hunting - reveal what would have come
    if (this.settings.rabbitHunting && this.communityCards.length < 5) {
      this.rabbitCards = [];
      while (this.communityCards.length + this.rabbitCards.length < 5) {
        this.deck.burn();
        this.rabbitCards.push(this.deck.deal());
      }
      this.addLog('Rabbit: [' + this.rabbitCards.map(function(c) { return c.toShort(); }).join(' ') + ']');
    }
  } else {
    // Showdown
    this.lastHandResults = this.potManager.awardPots(this.players, this.communityCards, this.settings.gameMode);

    for (var r = 0; r < this.lastHandResults.length; r++) {
      var result = this.lastHandResults[r];
      var winnerNames = result.winners.map(function(w) { return w.name; }).join(', ');
      var handName = result.winners[0].hand || 'best hand';
      if (result.winners.length === 1) {
        this.addLog(winnerNames + ' wins ' + result.amount + ' with ' + handName);
      } else {
        this.addLog(winnerNames + ' split ' + result.amount + ' with ' + handName);
      }
    }
  }

  // 7-2 Bounty check (NLH only — doesn't apply to PLO)
  this.sevenTwoWinner = null;
  if (this.settings.sevenTwoBounty && this.lastHandResults && !this.isPLO()) {
    this.checkSevenTwoBounty();
  }

  // Remove players with no chips
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].chips <= 0 && !this.players[i].isSittingOut) {
      this.addLog(this.players[i].name + ' is out of chips');
    }
  }

  this.phase = PHASES.WAITING;
  // Hand is over — clear the turn deadline so the client stops ticking the timer
  this.turnDeadline = null;

  // Apply any cash-outs that were queued mid-hand
  for (var ci = 0; ci < this.players.length; ci++) {
    var p = this.players[ci];
    if (p.pendingCashOut) {
      this.recordLedgerEvent(p.name, 'buy-out', p.chips);
      p.chips = 0;
      p.isSittingOut = true;
      p.pendingCashOut = false;
      this.addLog(p.name + ' cashed out');
    }
  }

  // Mark disconnected players as sitting out now that the hand is over
  this.sitOutDisconnectedPlayers();
};

// ==================== Run It Twice ====================

Game.prototype.canRunItTwice = function() {
  if (!this.settings.runItTwice) return false;
  if (this.communityCards.length >= 5) return false;
  // Need at least 2 active players who are all-in (or only one can act)
  var active = this.getActivePlayers();
  var actable = this.getActablePlayers();
  return active.length >= 2 && actable.length <= 1;
};

Game.prototype.executeRunItTwice = function() {
  // Save current deck state by dealing two separate boards
  var cardsNeeded = 5 - this.communityCards.length;
  var board1Cards = [];
  var board2Cards = [];

  // Board 1
  for (var i = 0; i < cardsNeeded; i++) {
    this.deck.burn();
    board1Cards.push(this.deck.deal());
  }

  // Board 2 — continue dealing from the same shuffled deck
  for (var i = 0; i < cardsNeeded; i++) {
    this.deck.burn();
    board2Cards.push(this.deck.deal());
  }

  var fullBoard1 = this.communityCards.concat(board1Cards);
  var fullBoard2 = this.communityCards.concat(board2Cards);

  // Collect bets before awarding
  this.potManager.collectBets(this.players);
  var totalPot = this.potManager.getTotalPot();
  var halfPot = Math.floor(totalPot / 2);
  var otherHalf = totalPot - halfPot;

  // Evaluate each board — use copies of pot manager
  var results1 = this.evaluateBoard(fullBoard1, halfPot);
  var results2 = this.evaluateBoard(fullBoard2, otherHalf);

  // Calculate equity percentages
  var equities = this.calculateEquity();

  this.runItTwiceData = {
    board1: fullBoard1.map(function(c) { return c.toJSON(); }),
    board2: fullBoard2.map(function(c) { return c.toJSON(); }),
    existingCards: this.communityCards.length,
    results1: results1,
    results2: results2,
    equities: equities
  };

  // Award chips
  this.awardRunItTwice(results1);
  this.awardRunItTwice(results2);

  this.potManager.reset();
  this.addLog('*** RUN IT TWICE ***');

  for (var r = 0; r < results1.length; r++) {
    var names1 = results1[r].winners.map(function(w) { return w.name; }).join(', ');
    this.addLog('Board 1: ' + names1 + ' wins ' + results1[r].share);
  }
  for (var r = 0; r < results2.length; r++) {
    var names2 = results2[r].winners.map(function(w) { return w.name; }).join(', ');
    this.addLog('Board 2: ' + names2 + ' wins ' + results2[r].share);
  }

  this.phase = PHASES.WAITING;
  this.currentPlayerIndex = -1;
  this.lastHandResults = results1.concat(results2);

  // Mark disconnected players as sitting out now that the hand is over
  this.sitOutDisconnectedPlayers();
};

Game.prototype.evaluateBoard = function(communityCards, potAmount) {
  var activePlayers = this.getActivePlayers();
  var bestScore = -1;
  var winners = [];
  var isPLO = this.isPLO();

  for (var i = 0; i < activePlayers.length; i++) {
    var p = activePlayers[i];
    var hand;
    if (isPLO) {
      hand = HandEvaluator.evaluateBestOmaha(p.holeCards, communityCards);
    } else {
      var allCards = p.holeCards.concat(communityCards);
      hand = HandEvaluator.evaluateBest(allCards);
    }
    if (hand.score > bestScore) {
      bestScore = hand.score;
      winners = [{ player: p, hand: hand }];
    } else if (hand.score === bestScore) {
      winners.push({ player: p, hand: hand });
    }
  }

  if (winners.length === 0) return [];
  var share = Math.floor(potAmount / winners.length);

  return [{
    amount: potAmount,
    winners: winners.map(function(w) {
      return {
        id: w.player.id,
        name: w.player.name,
        hand: w.hand.name,
        handRank: w.hand.rank,
        cards: w.hand.cards ? w.hand.cards.map(function(c) { return c.toJSON(); }) : []
      };
    }),
    share: share
  }];
};

Game.prototype.awardRunItTwice = function(results) {
  for (var r = 0; r < results.length; r++) {
    var share = results[r].share;
    for (var w = 0; w < results[r].winners.length; w++) {
      var winnerId = results[r].winners[w].id;
      var player = this.getPlayer(winnerId);
      if (player) {
        player.chips += share;
        if (w === 0 && results[r].winners.length > 1) {
          // Remainder to first winner
          player.chips += results[r].amount - (share * results[r].winners.length);
        }
      }
    }
  }
};

Game.prototype.calculateEquity = function() {
  // Monte Carlo equity estimation for all-in players
  var activePlayers = this.getActivePlayers();
  if (activePlayers.length < 2) return {};

  var wins = {};
  for (var i = 0; i < activePlayers.length; i++) {
    wins[activePlayers[i].id] = 0;
  }

  var usedCards = {};
  for (var i = 0; i < activePlayers.length; i++) {
    for (var j = 0; j < activePlayers[i].holeCards.length; j++) {
      usedCards[activePlayers[i].holeCards[j].toShort()] = true;
    }
  }
  for (var i = 0; i < this.communityCards.length; i++) {
    usedCards[this.communityCards[i].toShort()] = true;
  }

  // Build remaining deck
  var remaining = [];
  for (var s = 0; s < constants.SUITS.length; s++) {
    for (var r = 0; r < constants.RANKS.length; r++) {
      var card = new Deck.Card(constants.RANKS[r], constants.SUITS[s]);
      if (!usedCards[card.toShort()]) {
        remaining.push(card);
      }
    }
  }

  var cardsNeeded = 5 - this.communityCards.length;
  var simulations = Math.min(1000, remaining.length > 10 ? 1000 : 500);
  var totalSims = 0;

  for (var sim = 0; sim < simulations; sim++) {
    // Shuffle remaining and pick cardsNeeded
    var shuffled = remaining.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    var simBoard = this.communityCards.concat(shuffled.slice(0, cardsNeeded));

    var bestScore = -1;
    var simWinners = [];
    var isPLO = this.isPLO();
    for (var p = 0; p < activePlayers.length; p++) {
      var hand;
      if (isPLO) {
        hand = HandEvaluator.evaluateBestOmaha(activePlayers[p].holeCards, simBoard);
      } else {
        var allCards = activePlayers[p].holeCards.concat(simBoard);
        hand = HandEvaluator.evaluateBest(allCards);
      }
      if (hand.score > bestScore) {
        bestScore = hand.score;
        simWinners = [activePlayers[p].id];
      } else if (hand.score === bestScore) {
        simWinners.push(activePlayers[p].id);
      }
    }

    for (var w = 0; w < simWinners.length; w++) {
      wins[simWinners[w]] += 1 / simWinners.length;
    }
    totalSims++;
  }

  var equities = {};
  for (var i = 0; i < activePlayers.length; i++) {
    var p = activePlayers[i];
    equities[p.id] = {
      name: p.name,
      equity: Math.round((wins[p.id] / totalSims) * 1000) / 10
    };
  }
  return equities;
};

// ==================== 7-2 Bounty ====================

Game.prototype.checkSevenTwoBounty = function() {
  if (!this.lastHandResults) return;

  for (var r = 0; r < this.lastHandResults.length; r++) {
    for (var w = 0; w < this.lastHandResults[r].winners.length; w++) {
      var winnerId = this.lastHandResults[r].winners[w].id;
      var player = this.getPlayer(winnerId);
      if (!player || player.holeCards.length < 2) continue;

      var v1 = player.holeCards[0].value;
      var v2 = player.holeCards[1].value;
      var s1 = player.holeCards[0].suit;
      var s2 = player.holeCards[1].suit;

      // Check for 7-2 (offsuit)
      var has72 = ((v1 === 7 && v2 === 2) || (v1 === 2 && v2 === 7)) && s1 !== s2;

      if (has72) {
        var bountyAmount = this.settings.sevenTwoBountyAmount || this.settings.bigBlind;
        this.sevenTwoWinner = player.name;
        this.addLog('*** 7-2 BOUNTY! ' + player.name + ' wins with 7-2 offsuit! ***');

        // Each other seated player pays the bounty
        for (var i = 0; i < this.players.length; i++) {
          var other = this.players[i];
          if (other.id !== winnerId && !other.isSittingOut && other.isConnected) {
            var payment = Math.min(bountyAmount, other.chips);
            other.chips -= payment;
            player.chips += payment;
            if (payment > 0) {
              this.addLog(other.name + ' pays ' + payment + ' bounty to ' + player.name);
            }
          }
        }
        return; // Only one bounty per hand
      }
    }
  }
};

Game.prototype.checkHandEnd = function() {
  if (this.phase === PHASES.WAITING || this.phase === PHASES.SHOWDOWN) return;

  var activePlayers = this.getActivePlayers();
  if (activePlayers.length <= 1) {
    this.endHand();
  }
};

// ==================== Utilities ====================

// Walks players in CLOCKWISE seat order (by seatIndex), not join order.
// Returns the array index of the next eligible player after the one at fromIndex.
Game.prototype.nextPlayerBySeat = function(fromIndex, predicate) {
  if (this.players.length === 0) return fromIndex;
  var startSeat = (fromIndex >= 0 && this.players[fromIndex]) ? this.players[fromIndex].seatIndex : -1;
  // Build seat-ordered list of array indices
  var order = this.players.map(function(_, i) { return i; }).sort(function(a, b) {
    return this.players[a].seatIndex - this.players[b].seatIndex;
  }.bind(this));
  // Find position of current in seat order
  var pos = -1;
  for (var i = 0; i < order.length; i++) {
    if (this.players[order[i]].seatIndex > startSeat) { pos = i; break; }
  }
  if (pos === -1) pos = 0; // wrap
  // Walk forward from pos until predicate passes
  for (var n = 0; n < order.length; n++) {
    var idx = order[(pos + n) % order.length];
    if (predicate(this.players[idx])) return idx;
  }
  return fromIndex;
};

Game.prototype.nextActivePlayerIndex = function(fromIndex) {
  return this.nextPlayerBySeat(fromIndex, function(p) {
    return !p.isSittingOut && p.isConnected && p.chips > 0;
  });
};

// Walks clockwise for players who canAct (used during betting rounds)
Game.prototype.nextActableIndex = function(fromIndex) {
  return this.nextPlayerBySeat(fromIndex, function(p) {
    return p.canAct && p.canAct();
  });
};

Game.prototype.getCurrentBetsTotal = function() {
  var total = 0;
  for (var i = 0; i < this.players.length; i++) {
    total += this.players[i].currentBet;
  }
  return total;
};

Game.prototype.communityCardsString = function() {
  return this.communityCards.map(function(c) { return c.toShort(); }).join(' ');
};

Game.prototype.addLog = function(message) {
  this.gameLog.push({
    time: Date.now(),
    message: message,
    handNumber: this.handNumber
  });
  // Keep last 200 entries
  if (this.gameLog.length > 200) {
    this.gameLog = this.gameLog.slice(-200);
  }
};

// ==================== State Serialization ====================

Game.prototype.evaluatePlayerHand = function(player) {
  var holeCount = this.getHoleCardCount();
  if (!player || player.holeCards.length < holeCount) return null;

  if (this.communityCards.length === 0) {
    if (this.isPLO()) {
      // PLO preflop: find best pair or high cards among 5 hole cards
      var bestPairVal = 0;
      var highVal = 0;
      for (var i = 0; i < player.holeCards.length; i++) {
        if (player.holeCards[i].value > highVal) highVal = player.holeCards[i].value;
        for (var j = i + 1; j < player.holeCards.length; j++) {
          if (player.holeCards[i].value === player.holeCards[j].value && player.holeCards[i].value > bestPairVal) {
            bestPairVal = player.holeCards[i].value;
          }
        }
      }
      if (bestPairVal > 0) return 'Pair of ' + this.valuePlural(bestPairVal);
      return 'High Card (' + this.valueToName(highVal) + ')';
    }
    // NLH preflop
    var c1 = player.holeCards[0];
    var c2 = player.holeCards[1];
    if (c1.value === c2.value) {
      return 'Pair of ' + this.rankPlural(c1.rank);
    }
    var highCard = c1.value > c2.value ? c1 : c2;
    return 'High Card (' + this.rankName(highCard.rank) + ')';
  }

  var result;
  if (this.isPLO()) {
    result = HandEvaluator.evaluateBestOmaha(player.holeCards, this.communityCards);
  } else {
    var allCards = player.holeCards.concat(this.communityCards);
    result = HandEvaluator.evaluateBest(allCards);
  }
  if (!result) return null;

  // Add detail to the hand name
  var name = result.name;
  var bestCards = result.cards;

  if (bestCards && bestCards.length > 0) {
    var freq = {};
    for (var i = 0; i < bestCards.length; i++) {
      var v = bestCards[i].value;
      freq[v] = (freq[v] || 0) + 1;
    }

    var counts = [];
    var keys = Object.keys(freq);
    for (var i = 0; i < keys.length; i++) {
      counts.push({ value: parseInt(keys[i]), count: freq[keys[i]] });
    }
    counts.sort(function(a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return b.value - a.value;
    });

    switch (result.rank) {
      case 0: // High Card
        name = 'High Card (' + this.valueToName(counts[0].value) + ')';
        break;
      case 1: // Pair
        name = 'Pair of ' + this.valuePlural(counts[0].value);
        break;
      case 2: // Two Pair
        var hi = Math.max(counts[0].value, counts[1].value);
        var lo = Math.min(counts[0].value, counts[1].value);
        name = 'Two Pair (' + this.valuePlural(hi) + ' & ' + this.valuePlural(lo) + ')';
        break;
      case 3: // Three of a Kind
        name = 'Three ' + this.valuePlural(counts[0].value);
        break;
      case 4: // Straight
        var vals = bestCards.map(function(c) { return c.value; }).sort(function(a, b) { return b - a; });
        name = 'Straight (' + this.valueToName(vals[0]) + ' high)';
        break;
      case 5: // Flush
        var vals = bestCards.map(function(c) { return c.value; }).sort(function(a, b) { return b - a; });
        name = 'Flush (' + this.valueToName(vals[0]) + ' high)';
        break;
      case 6: // Full House
        name = 'Full House (' + this.valuePlural(counts[0].value) + ' full of ' + this.valuePlural(counts[1].value) + ')';
        break;
      case 7: // Four of a Kind
        name = 'Four ' + this.valuePlural(counts[0].value);
        break;
      case 8: // Straight Flush
        var vals = bestCards.map(function(c) { return c.value; }).sort(function(a, b) { return b - a; });
        name = 'Straight Flush (' + this.valueToName(vals[0]) + ' high)';
        break;
      case 9: // Royal Flush
        name = 'Royal Flush';
        break;
    }
  }

  return name;
};

Game.prototype.valueToName = function(val) {
  var names = { 2:'Two', 3:'Three', 4:'Four', 5:'Five', 6:'Six', 7:'Seven', 8:'Eight', 9:'Nine', 10:'Ten', 11:'Jack', 12:'Queen', 13:'King', 14:'Ace' };
  return names[val] || val;
};

Game.prototype.valuePlural = function(val) {
  var plurals = { 2:'Twos', 3:'Threes', 4:'Fours', 5:'Fives', 6:'Sixes', 7:'Sevens', 8:'Eights', 9:'Nines', 10:'Tens', 11:'Jacks', 12:'Queens', 13:'Kings', 14:'Aces' };
  return plurals[val] || val;
};

Game.prototype.rankName = function(rank) {
  var names = { '2':'Two', '3':'Three', '4':'Four', '5':'Five', '6':'Six', '7':'Seven', '8':'Eight', '9':'Nine', 'T':'Ten', 'J':'Jack', 'Q':'Queen', 'K':'King', 'A':'Ace' };
  return names[rank] || rank;
};

Game.prototype.rankPlural = function(rank) {
  var plurals = { '2':'Twos', '3':'Threes', '4':'Fours', '5':'Fives', '6':'Sixes', '7':'Sevens', '8':'Eights', '9':'Nines', 'T':'Tens', 'J':'Jacks', 'Q':'Queens', 'K':'Kings', 'A':'Aces' };
  return plurals[rank] || rank;
};

Game.prototype.getStateForPlayer = function(playerId) {
  var self = this;
  var currentPlayer = this.currentPlayerIndex >= 0 ? this.players[this.currentPlayerIndex] : null;

  var playerStates = this.players.map(function(p) {
    var state = p.toPublicJSON();
    // Show own hole cards
    if (p.id === playerId) {
      state.holeCards = p.holeCards.map(function(c) { return c.toJSON(); });
      state.isYou = true;
      state.pendingCashOut = !!p.pendingCashOut;
    }
    // Show hole cards at showdown for active players
    if (self.phase === PHASES.SHOWDOWN && !p.isFolded && p.holeCards.length > 0) {
      state.holeCards = p.holeCards.map(function(c) { return c.toJSON(); });
      // Include hand description at showdown
      if (self.communityCards.length >= 3) {
        state.handDescription = self.evaluatePlayerHand(p);
      }
    }
    // Show hole cards from last hand results when waiting
    if (self.phase === PHASES.WAITING && self.lastHandResults) {
      var wasInShowdown = false;
      for (var r = 0; r < self.lastHandResults.length; r++) {
        for (var w = 0; w < self.lastHandResults[r].winners.length; w++) {
          if (self.lastHandResults[r].winners[w].id === p.id) {
            wasInShowdown = true;
          }
        }
      }
      if ((wasInShowdown || (!p.isFolded && p.holeCards.length > 0)) && self.getActivePlayers().length > 1) {
        state.holeCards = p.holeCards.map(function(c) { return c.toJSON(); });
        // Include hand description when showing cards in waiting phase
        if (self.communityCards.length >= 3) {
          state.handDescription = self.evaluatePlayerHand(p);
        }
      }
    }
    // Show cards if player chose to reveal
    if (p.showCards && p.holeCards.length > 0) {
      state.holeCards = p.holeCards.map(function(c) { return c.toJSON(); });
    }
    return state;
  });

  var validActions = null;
  if (currentPlayer && currentPlayer.id === playerId) {
    validActions = this.getValidActions(playerId);
  }

  // Evaluate requesting player's hand
  var myHandDescription = null;
  var myPlayer = this.getPlayer(playerId);
  if (myPlayer && myPlayer.holeCards.length >= 2 && !myPlayer.isFolded && this.phase !== PHASES.WAITING) {
    myHandDescription = this.evaluatePlayerHand(myPlayer);
  }

  // Time bank info for current player
  var turnTimeRemaining = null;
  if (this.turnDeadline && this.currentPlayerIndex >= 0) {
    turnTimeRemaining = Math.max(0, Math.ceil((this.turnDeadline - Date.now()) / 1000));
  }

  // Get this player's time bank
  var myTimeBank = 0;
  if (myPlayer) {
    myTimeBank = myPlayer.timeBank;
  }

  return {
    roomCode: this.roomCode,
    phase: this.phase,
    handNumber: this.handNumber,
    communityCards: this.communityCards.map(function(c) { return c.toJSON(); }),
    pot: this.potManager.getTotalPot() + this.getCurrentBetsTotal(),
    pots: this.potManager.toJSON(),
    players: playerStates,
    dealerIndex: this.dealerIndex,
    currentPlayerIndex: this.currentPlayerIndex,
    currentPlayerId: currentPlayer ? currentPlayer.id : null,
    validActions: validActions,
    settings: this.settings,
    lastHandResults: this.lastHandResults,
    gameLog: this.gameLog.slice(-50),
    hostId: this.hostId,
    isHost: playerId === this.hostId,
    isPaused: this.isPaused,
    pendingJoins: playerId === this.hostId ? this.pendingJoins.map(function(p) { return { name: p.name }; }) : [],
    myHand: myHandDescription,
    turnDeadline: this.turnDeadline,
    turnTimeRemaining: turnTimeRemaining,
    myTimeBank: myTimeBank,
    ledger: this.getLedgerSummary(),
    rabbitCards: this.rabbitCards.map(function(c) { return c.toJSON(); }),
    runItTwiceData: this.runItTwiceData,
    runItTwicePending: this.runItTwicePending,
    canRunItTwice: this.canRunItTwice() && !this.runItTwiceAgreed[playerId],
    sevenTwoWinner: this.sevenTwoWinner,
    isBombPot: this.isBombPot,
    gameMode: this.settings.gameMode
  };
};

module.exports = Game;
