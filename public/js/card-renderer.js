var CardRenderer = (function() {
  var SUIT_SYMBOLS = {
    h: '\u2665',
    d: '\u2666',
    c: '\u2663',
    s: '\u2660'
  };

  var RANK_DISPLAY = {
    '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
    '7': '7', '8': '8', '9': '9', 'T': '10',
    'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A'
  };

  function createCard(cardData, options) {
    options = options || {};
    var div = document.createElement('div');
    div.className = 'card';

    if (!cardData || options.faceDown) {
      div.classList.add('face-down');
      return div;
    }

    var isRed = cardData.suit === 'h' || cardData.suit === 'd';
    div.classList.add(isRed ? 'red' : 'black');

    if (options.dealing) {
      div.classList.add('dealing');
    }

    if (options.winner) {
      div.classList.add('winner-card');
    }

    var rankSpan = document.createElement('span');
    rankSpan.className = 'card-rank';
    rankSpan.textContent = RANK_DISPLAY[cardData.rank] || cardData.rank;

    var suitSpan = document.createElement('span');
    suitSpan.className = 'card-suit';
    suitSpan.textContent = SUIT_SYMBOLS[cardData.suit] || cardData.suit;

    div.appendChild(rankSpan);
    div.appendChild(suitSpan);

    return div;
  }

  function createCardGroup(cards, options) {
    var container = document.createDocumentFragment();
    for (var i = 0; i < cards.length; i++) {
      container.appendChild(createCard(cards[i], options));
    }
    return container;
  }

  return {
    createCard: createCard,
    createCardGroup: createCardGroup
  };
})();
