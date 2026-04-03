function Player(id, name) {
  this.id = id;
  this.name = name;
  this.chips = 0;
  this.holeCards = [];
  this.seatIndex = -1;
  this.isSittingOut = false;
  this.isConnected = true;
  this.currentBet = 0;
  this.hasActed = false;
  this.isAllIn = false;
  this.isFolded = false;
  this.totalBetThisHand = 0;
  this.lastAction = null;
  this.disconnectTimer = null;
  this.timeBank = 120; // seconds of time bank available
}

Player.prototype.resetForNewHand = function() {
  this.holeCards = [];
  this.currentBet = 0;
  this.hasActed = false;
  this.isAllIn = false;
  this.isFolded = false;
  this.totalBetThisHand = 0;
  this.lastAction = null;
  this.showCards = false;
};

Player.prototype.bet = function(amount) {
  var actual = Math.min(amount, this.chips);
  this.chips -= actual;
  this.currentBet += actual;
  this.totalBetThisHand += actual;
  if (this.chips === 0) {
    this.isAllIn = true;
  }
  return actual;
};

Player.prototype.canAct = function() {
  return !this.isFolded && !this.isAllIn && !this.isSittingOut;
};

Player.prototype.isActive = function() {
  return !this.isFolded && !this.isSittingOut;
};

Player.prototype.toPublicJSON = function() {
  return {
    id: this.id,
    name: this.name,
    chips: this.chips,
    seatIndex: this.seatIndex,
    isSittingOut: this.isSittingOut,
    isConnected: this.isConnected,
    currentBet: this.currentBet,
    isAllIn: this.isAllIn,
    isFolded: this.isFolded,
    hasCards: this.holeCards.length > 0,
    lastAction: this.lastAction,
    timeBank: this.timeBank
  };
};

Player.prototype.toPrivateJSON = function() {
  var pub = this.toPublicJSON();
  pub.holeCards = this.holeCards.map(function(c) { return c.toJSON(); });
  return pub;
};

module.exports = Player;
