var constants = require('./constants');
var HAND_RANKS = constants.HAND_RANKS;

// Generate all C(n, k) combinations
function combinations(arr, k) {
  var results = [];
  function combine(start, combo) {
    if (combo.length === k) {
      results.push(combo.slice());
      return;
    }
    for (var i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return results;
}

// Evaluate a 5-card hand, returns { rank, score, name }
function evaluate5(cards) {
  var values = cards.map(function(c) { return c.value; }).sort(function(a, b) { return b - a; });
  var suits = cards.map(function(c) { return c.suit; });

  // Check flush
  var isFlush = suits.every(function(s) { return s === suits[0]; });

  // Check straight
  var isStraight = false;
  var straightHigh = 0;

  // Normal straight check
  var unique = [];
  for (var i = 0; i < values.length; i++) {
    if (unique.indexOf(values[i]) === -1) unique.push(values[i]);
  }

  if (unique.length === 5 && unique[0] - unique[4] === 4) {
    isStraight = true;
    straightHigh = unique[0];
  }

  // Ace-low straight (A-2-3-4-5)
  if (!isStraight && unique.length === 5) {
    var sorted = unique.slice().sort(function(a, b) { return a - b; });
    if (sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14) {
      isStraight = true;
      straightHigh = 5; // 5-high straight
    }
  }

  // Count rank frequencies
  var freq = {};
  for (var i = 0; i < values.length; i++) {
    freq[values[i]] = (freq[values[i]] || 0) + 1;
  }

  var counts = [];
  var keys = Object.keys(freq);
  for (var i = 0; i < keys.length; i++) {
    counts.push({ value: parseInt(keys[i]), count: freq[keys[i]] });
  }
  // Sort by count desc, then value desc
  counts.sort(function(a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value;
  });

  var rank, score;

  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      rank = HAND_RANKS.ROYAL_FLUSH;
      score = rank * 1e10 + straightHigh;
    } else {
      rank = HAND_RANKS.STRAIGHT_FLUSH;
      score = rank * 1e10 + straightHigh;
    }
  } else if (counts[0].count === 4) {
    rank = HAND_RANKS.FOUR_OF_A_KIND;
    score = rank * 1e10 + counts[0].value * 1e8 + counts[1].value;
  } else if (counts[0].count === 3 && counts[1].count === 2) {
    rank = HAND_RANKS.FULL_HOUSE;
    score = rank * 1e10 + counts[0].value * 1e8 + counts[1].value * 1e6;
  } else if (isFlush) {
    rank = HAND_RANKS.FLUSH;
    score = rank * 1e10 + values[0] * 1e8 + values[1] * 1e6 + values[2] * 1e4 + values[3] * 1e2 + values[4];
  } else if (isStraight) {
    rank = HAND_RANKS.STRAIGHT;
    score = rank * 1e10 + straightHigh;
  } else if (counts[0].count === 3) {
    rank = HAND_RANKS.THREE_OF_A_KIND;
    score = rank * 1e10 + counts[0].value * 1e8 + counts[1].value * 1e4 + counts[2].value;
  } else if (counts[0].count === 2 && counts[1].count === 2) {
    rank = HAND_RANKS.TWO_PAIR;
    var highPair = Math.max(counts[0].value, counts[1].value);
    var lowPair = Math.min(counts[0].value, counts[1].value);
    score = rank * 1e10 + highPair * 1e8 + lowPair * 1e6 + counts[2].value;
  } else if (counts[0].count === 2) {
    rank = HAND_RANKS.PAIR;
    var kickers = [];
    for (var i = 1; i < counts.length; i++) kickers.push(counts[i].value);
    kickers.sort(function(a, b) { return b - a; });
    score = rank * 1e10 + counts[0].value * 1e8 + kickers[0] * 1e6 + kickers[1] * 1e4 + kickers[2] * 1e2;
  } else {
    rank = HAND_RANKS.HIGH_CARD;
    score = rank * 1e10 + values[0] * 1e8 + values[1] * 1e6 + values[2] * 1e4 + values[3] * 1e2 + values[4];
  }

  return {
    rank: rank,
    score: score,
    name: constants.HAND_NAMES[rank]
  };
}

// Find the best 5-card hand from 7 cards
function evaluateBest(sevenCards) {
  var combos = combinations(sevenCards, 5);
  var best = null;

  for (var i = 0; i < combos.length; i++) {
    var result = evaluate5(combos[i]);
    if (!best || result.score > best.score) {
      best = result;
      best.cards = combos[i];
    }
  }

  return best;
}

// Find the best Omaha hand: must use exactly 2 hole cards + 3 community cards
function evaluateBestOmaha(holeCards, communityCards) {
  var holeCombos = combinations(holeCards, 2);
  var boardCombos = combinations(communityCards, 3);
  var best = null;

  for (var h = 0; h < holeCombos.length; h++) {
    for (var b = 0; b < boardCombos.length; b++) {
      var hand = holeCombos[h].concat(boardCombos[b]);
      var result = evaluate5(hand);
      if (!best || result.score > best.score) {
        best = result;
        best.cards = hand;
      }
    }
  }

  return best;
}

// Compare two hand results, returns 1 if a wins, -1 if b wins, 0 if tie
function compareHands(a, b) {
  if (a.score > b.score) return 1;
  if (a.score < b.score) return -1;
  return 0;
}

module.exports = {
  evaluate5: evaluate5,
  evaluateBest: evaluateBest,
  evaluateBestOmaha: evaluateBestOmaha,
  compareHands: compareHands,
  combinations: combinations
};
