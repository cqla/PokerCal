var constants = require('./constants');

// ==================== Mersenne Twister PRNG ====================
// MT19937 implementation for cryptographically-better shuffling

function MersenneTwister(seed) {
  this.MT = new Array(624);
  this.index = 625;

  if (seed === undefined) {
    // Seed from current time + high-resolution performance counter
    seed = Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0);
  }
  this.seed(seed);
}

MersenneTwister.prototype.seed = function(seed) {
  this.MT[0] = seed >>> 0;
  for (var i = 1; i < 624; i++) {
    var s = this.MT[i - 1] ^ (this.MT[i - 1] >>> 30);
    this.MT[i] = (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) +
                  (s & 0x0000ffff) * 1812433253 + i) >>> 0;
  }
  this.index = 624;
};

MersenneTwister.prototype.generateNumbers = function() {
  for (var i = 0; i < 624; i++) {
    var y = (this.MT[i] & 0x80000000) | (this.MT[(i + 1) % 624] & 0x7fffffff);
    this.MT[i] = this.MT[(i + 397) % 624] ^ (y >>> 1);
    if (y & 1) {
      this.MT[i] ^= 2567483615;
    }
  }
  this.index = 0;
};

MersenneTwister.prototype.extractNumber = function() {
  if (this.index >= 624) {
    this.generateNumbers();
  }

  var y = this.MT[this.index++];
  y ^= (y >>> 11);
  y ^= (y << 7) & 2636928640;
  y ^= (y << 15) & 4022730752;
  y ^= (y >>> 18);

  return y >>> 0;
};

// Returns a random float in [0, 1)
MersenneTwister.prototype.random = function() {
  return this.extractNumber() / 4294967296;
};

// Returns a random integer in [0, max)
MersenneTwister.prototype.randomInt = function(max) {
  return Math.floor(this.random() * max);
};

// ==================== Card ====================

function Card(rank, suit) {
  this.rank = rank;
  this.suit = suit;
  this.value = constants.RANK_VALUES[rank];
}

Card.prototype.toString = function() {
  return constants.RANK_NAMES[this.rank] + ' of ' + constants.SUIT_NAMES[this.suit];
};

Card.prototype.toShort = function() {
  return this.rank + this.suit;
};

Card.prototype.toJSON = function() {
  return { rank: this.rank, suit: this.suit, value: this.value };
};

// ==================== Deck ====================

function Deck() {
  this.cards = [];
  this.mt = new MersenneTwister();
  this.reset();
}

Deck.prototype.reset = function() {
  this.cards = [];
  for (var s = 0; s < constants.SUITS.length; s++) {
    for (var r = 0; r < constants.RANKS.length; r++) {
      this.cards.push(new Card(constants.RANKS[r], constants.SUITS[s]));
    }
  }
  // Re-seed MT each shuffle for maximum entropy
  this.mt.seed(Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0));
  this.shuffle();
};

Deck.prototype.shuffle = function() {
  // Fisher-Yates shuffle using Mersenne Twister
  for (var i = this.cards.length - 1; i > 0; i--) {
    var j = this.mt.randomInt(i + 1);
    var temp = this.cards[i];
    this.cards[i] = this.cards[j];
    this.cards[j] = temp;
  }
};

Deck.prototype.deal = function() {
  if (this.cards.length === 0) {
    throw new Error('No cards left in deck');
  }
  return this.cards.pop();
};

Deck.prototype.burn = function() {
  this.deal(); // discard top card
};

module.exports = { Deck: Deck, Card: Card, MersenneTwister: MersenneTwister };
