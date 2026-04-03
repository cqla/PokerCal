var HandEvaluator = require('./HandEvaluator');

function PotManager() {
  this.pots = [];
}

PotManager.prototype.reset = function() {
  this.pots = [];
};

PotManager.prototype.collectBets = function(players) {
  // Get players with bets, sorted by bet amount ascending
  var bettors = [];
  for (var i = 0; i < players.length; i++) {
    if (players[i].currentBet > 0) {
      bettors.push(players[i]);
    }
  }

  if (bettors.length === 0) return;

  bettors.sort(function(a, b) { return a.currentBet - b.currentBet; });

  var previousLevel = 0;

  while (bettors.length > 0) {
    var currentLevel = bettors[0].currentBet;
    var contribution = currentLevel - previousLevel;

    if (contribution > 0) {
      // All active (non-folded) players at this level or above are eligible
      var eligible = [];
      for (var i = 0; i < bettors.length; i++) {
        if (!bettors[i].isFolded) {
          eligible.push(bettors[i].id);
        }
      }

      var potAmount = contribution * bettors.length;

      // Try to merge with existing pot that has same eligible players
      var merged = false;
      if (this.pots.length > 0) {
        var lastPot = this.pots[this.pots.length - 1];
        if (arraysEqual(lastPot.eligible, eligible)) {
          lastPot.amount += potAmount;
          merged = true;
        }
      }

      if (!merged) {
        this.pots.push({
          amount: potAmount,
          eligible: eligible
        });
      }
    }

    previousLevel = currentLevel;

    // Remove players at this bet level
    var remaining = [];
    for (var i = 0; i < bettors.length; i++) {
      if (bettors[i].currentBet > currentLevel) {
        remaining.push(bettors[i]);
      }
    }
    bettors = remaining;
  }

  // Reset current bets
  for (var i = 0; i < players.length; i++) {
    players[i].currentBet = 0;
  }
};

PotManager.prototype.getTotalPot = function() {
  var total = 0;
  for (var i = 0; i < this.pots.length; i++) {
    total += this.pots[i].amount;
  }
  return total;
};

PotManager.prototype.awardPots = function(players, communityCards, gameMode) {
  var results = [];
  var isPLO = gameMode === 'plo5';

  for (var p = 0; p < this.pots.length; p++) {
    var pot = this.pots[p];
    var bestScore = -1;
    var winners = [];

    // Find eligible players who haven't folded
    for (var i = 0; i < pot.eligible.length; i++) {
      var player = findPlayer(players, pot.eligible[i]);
      if (!player || player.isFolded) continue;

      var hand;
      if (isPLO) {
        hand = HandEvaluator.evaluateBestOmaha(player.holeCards, communityCards);
      } else {
        var allCards = player.holeCards.concat(communityCards);
        hand = HandEvaluator.evaluateBest(allCards);
      }

      if (hand.score > bestScore) {
        bestScore = hand.score;
        winners = [{ player: player, hand: hand }];
      } else if (hand.score === bestScore) {
        winners.push({ player: player, hand: hand });
      }
    }

    if (winners.length > 0) {
      var share = Math.floor(pot.amount / winners.length);
      var remainder = pot.amount - (share * winners.length);

      var winnerNames = [];
      for (var w = 0; w < winners.length; w++) {
        winners[w].player.chips += share;
        // Give remainder to first winner (closest to dealer)
        if (w === 0) winners[w].player.chips += remainder;
        winnerNames.push(winners[w].player.name);
      }

      results.push({
        potIndex: p,
        amount: pot.amount,
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
      });
    }
  }

  this.pots = [];
  return results;
};

PotManager.prototype.toJSON = function() {
  return this.pots.map(function(pot, i) {
    return {
      index: i,
      amount: pot.amount,
      eligible: pot.eligible
    };
  });
};

function findPlayer(players, id) {
  for (var i = 0; i < players.length; i++) {
    if (players[i].id === id) return players[i];
  }
  return null;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

module.exports = PotManager;
