var SUITS = ['h', 'd', 'c', 's'];
var SUIT_NAMES = { h: 'Hearts', d: 'Diamonds', c: 'Clubs', s: 'Spades' };
var SUIT_SYMBOLS = { h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660' };
var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
var RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};
var RANK_NAMES = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8',
  '9': '9', 'T': '10', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace'
};

var PHASES = {
  WAITING: 'waiting',
  PREFLOP: 'preflop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown'
};

var HAND_RANKS = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9
};

var HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush'
];

var ACTIONS = {
  FOLD: 'fold',
  CHECK: 'check',
  CALL: 'call',
  RAISE: 'raise',
  ALL_IN: 'allin'
};

var MAX_PLAYERS = 9;
var ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var ROOM_CODE_LENGTH = 6;

module.exports = {
  SUITS: SUITS,
  SUIT_NAMES: SUIT_NAMES,
  SUIT_SYMBOLS: SUIT_SYMBOLS,
  RANKS: RANKS,
  RANK_VALUES: RANK_VALUES,
  RANK_NAMES: RANK_NAMES,
  PHASES: PHASES,
  HAND_RANKS: HAND_RANKS,
  HAND_NAMES: HAND_NAMES,
  ACTIONS: ACTIONS,
  MAX_PLAYERS: MAX_PLAYERS,
  ROOM_CODE_CHARS: ROOM_CODE_CHARS,
  ROOM_CODE_LENGTH: ROOM_CODE_LENGTH
};
