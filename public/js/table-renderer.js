var TableRenderer = (function() {
  var MAX_SEATS = 9;

  // Chip colors by denomination tier
  var CHIP_COLORS = [
    { fill: '#e8e8e8', stroke: '#bbb', accent: '#ddd' },  // white (smallest)
    { fill: '#e74c3c', stroke: '#c0392b', accent: '#f06050' },  // red
    { fill: '#27ae60', stroke: '#1e8449', accent: '#2ecc71' },  // green
    { fill: '#2980b9', stroke: '#1f6fa3', accent: '#3498db' },  // blue
    { fill: '#1a1a2e', stroke: '#111', accent: '#333' },  // black
    { fill: '#8e44ad', stroke: '#6c3483', accent: '#a569bd' },  // purple
    { fill: '#f39c12', stroke: '#d68910', accent: '#f5b041' }   // gold (largest)
  ];

  function getChipBreakdown(amount) {
    // Returns array of { count, colorIndex } representing chip stacks
    if (amount <= 0) return [];
    var chips = [];
    // Determine chip denominations based on amount scale
    if (amount >= 10000) {
      if (amount >= 100000) chips.push({ count: Math.min(Math.floor(amount / 100000), 5), ci: 6 });
      if (amount >= 10000) chips.push({ count: Math.min(Math.floor((amount % 100000) / 10000), 5), ci: 5 });
      chips.push({ count: Math.min(Math.floor((amount % 10000) / 1000), 5), ci: 4 });
    } else if (amount >= 100) {
      chips.push({ count: Math.min(Math.floor(amount / 1000), 5), ci: 4 });
      chips.push({ count: Math.min(Math.floor((amount % 1000) / 100), 5), ci: 3 });
      chips.push({ count: Math.min(Math.floor((amount % 100) / 10), 5), ci: 1 });
    } else {
      chips.push({ count: Math.min(Math.floor(amount / 10), 5), ci: 1 });
      chips.push({ count: Math.min(Math.max(1, amount % 10), 5), ci: 0 });
    }
    return chips.filter(function(c) { return c.count > 0; });
  }

  function createChipStack(amount, compact) {
    var container = document.createElement('div');
    container.className = 'chip-stack' + (compact ? ' chip-stack-compact' : '');

    var breakdown = getChipBreakdown(amount);
    if (breakdown.length === 0) return container;

    for (var s = 0; s < breakdown.length; s++) {
      var stack = document.createElement('div');
      stack.className = 'chip-column';
      var count = breakdown[s].count;
      var color = CHIP_COLORS[breakdown[s].ci];

      for (var c = 0; c < count; c++) {
        var chip = document.createElement('div');
        chip.className = 'chip';
        chip.style.background = 'linear-gradient(180deg, ' + color.accent + ' 0%, ' + color.fill + ' 40%, ' + color.stroke + ' 100%)';
        chip.style.borderColor = color.stroke;
        chip.style.marginTop = c === 0 ? '0' : '-6px';
        stack.appendChild(chip);
      }
      container.appendChild(stack);
    }
    return container;
  }

  // Dealer button positions relative to seat (offset from seat center)
  var DEALER_OFFSETS = [
    { x: 0, y: 30 },    // seat 0 (top center)
    { x: -30, y: 20 },  // seat 1
    { x: -35, y: 0 },   // seat 2
    { x: -30, y: -20 }, // seat 3
    { x: 0, y: -30 },   // seat 4
    { x: 30, y: -20 },  // seat 5
    { x: 35, y: 0 },    // seat 6
    { x: 30, y: 20 },   // seat 7
    { x: 20, y: 30 }    // seat 8
  ];

  function renderSeats(state, myId, onSeatClick) {
    var container = document.getElementById('seat-positions');
    container.innerHTML = '';

    var seatedPlayers = {};
    for (var i = 0; i < state.players.length; i++) {
      seatedPlayers[state.players[i].seatIndex] = state.players[i];
    }

    for (var s = 0; s < MAX_SEATS; s++) {
      var seat = document.createElement('div');
      seat.className = 'seat';
      seat.setAttribute('data-seat', s);

      var player = seatedPlayers[s];

      if (player) {
        // Occupied seat
        if (player.id === state.currentPlayerId) {
          seat.classList.add('active-turn');
        }
        if (player.isYou) {
          seat.classList.add('is-you');
        }
        if (player.isFolded) {
          seat.classList.add('folded');
        }
        if (player.isSittingOut) {
          seat.classList.add('sitting-out');
        }

        var isPLO = state.gameMode === 'plo5';

        // Player cards
        var cardsDiv = document.createElement('div');
        cardsDiv.className = 'seat-cards' + (isPLO ? ' plo-seat-cards' : '');

        if (player.holeCards && player.holeCards.length > 0) {
          cardsDiv.appendChild(CardRenderer.createCardGroup(player.holeCards));
        } else if (player.hasCards && !player.isFolded) {
          // Show face-down cards (2 for NLH, 5 for PLO)
          var faceDownCount = isPLO ? 5 : 2;
          for (var fc = 0; fc < faceDownCount; fc++) {
            cardsDiv.appendChild(CardRenderer.createCard(null, { faceDown: true }));
          }
        }

        // Avatar
        var avatarDiv = document.createElement('div');
        avatarDiv.className = 'seat-avatar';
        avatarDiv.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

        // Player info
        var infoDiv = document.createElement('div');
        infoDiv.className = 'seat-info';

        var nameDiv = document.createElement('div');
        nameDiv.className = 'seat-name';
        nameDiv.textContent = player.name;
        if (player.isYou) nameDiv.textContent += ' (You)';

        // Host crown
        if (player.id === state.hostId) {
          var crown = document.createElement('span');
          crown.className = 'host-crown';
          crown.textContent = ' \u2605';
          crown.title = 'Host';
          nameDiv.appendChild(crown);
        }

        var chipsDiv = document.createElement('div');
        chipsDiv.className = 'seat-chips';
        chipsDiv.textContent = formatChips(player.chips);

        var actionDiv = document.createElement('div');
        actionDiv.className = 'seat-action';
        if (!player.isConnected) {
          seat.classList.add('disconnected');
          actionDiv.textContent = 'Disconnected';
          actionDiv.style.color = '#e74c3c';
        } else if (player.lastAction) {
          actionDiv.textContent = player.lastAction;
        } else if (player.isSittingOut) {
          actionDiv.textContent = 'Sitting out';
          actionDiv.style.color = 'var(--text-muted)';
        }

        // Hand description at showdown/waiting
        var handDescDiv = document.createElement('div');
        handDescDiv.className = 'seat-hand-desc';
        if (player.handDescription) {
          handDescDiv.textContent = player.handDescription;
          // Check if this player won
          var isWinner = false;
          if (state.lastHandResults) {
            for (var r = 0; r < state.lastHandResults.length; r++) {
              for (var w = 0; w < state.lastHandResults[r].winners.length; w++) {
                if (state.lastHandResults[r].winners[w].id === player.id) {
                  isWinner = true;
                }
              }
            }
          }
          if (isWinner) handDescDiv.classList.add('winner');
        }

        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(chipsDiv);
        infoDiv.appendChild(actionDiv);
        infoDiv.appendChild(handDescDiv);

        seat.appendChild(cardsDiv);
        seat.appendChild(avatarDiv);
        seat.appendChild(infoDiv);

        // Current bet with chip visuals
        if (player.currentBet > 0) {
          var betDiv = document.createElement('div');
          betDiv.className = 'seat-bet';
          betDiv.appendChild(createChipStack(player.currentBet, true));
          var betLabel = document.createElement('span');
          betLabel.className = 'bet-label';
          betLabel.textContent = formatChips(player.currentBet);
          betDiv.appendChild(betLabel);
          seat.appendChild(betDiv);
        }
      } else {
        // Empty seat
        var emptyDiv = document.createElement('div');
        emptyDiv.className = 'seat-empty';
        emptyDiv.textContent = '+';

        (function(seatIdx) {
          emptyDiv.addEventListener('click', function() {
            if (onSeatClick) onSeatClick(seatIdx);
          });
        })(s);

        seat.appendChild(emptyDiv);
      }

      container.appendChild(seat);
    }
  }

  var lastCommunityCardCount = 0;

  function renderCommunityCards(cards) {
    var container = document.getElementById('community-cards');

    if (!cards || cards.length === 0) {
      container.innerHTML = '';
      lastCommunityCardCount = 0;
      return;
    }

    // If fewer cards than before (new hand), reset everything
    if (cards.length < lastCommunityCardCount) {
      container.innerHTML = '';
      lastCommunityCardCount = 0;
    }

    // Only add cards that are new since last render
    if (cards.length > lastCommunityCardCount) {
      for (var i = lastCommunityCardCount; i < cards.length; i++) {
        var card = CardRenderer.createCard(cards[i], { dealing: true });
        container.appendChild(card);
      }
      lastCommunityCardCount = cards.length;
    }
    // If same count, do nothing — cards are already displayed
  }

  function renderPot(amount) {
    var potDisplay = document.getElementById('pot-display');
    potDisplay.innerHTML = '';
    if (amount > 0) {
      potDisplay.appendChild(createChipStack(amount, false));
      var potLabel = document.createElement('span');
      potLabel.className = 'pot-label';
      potLabel.textContent = 'Pot: ' + formatChips(amount);
      potDisplay.appendChild(potLabel);
    }
  }

  function renderMyCards(cards, handStrength, gameMode) {
    var area = document.getElementById('my-cards-area');
    var container = document.getElementById('my-cards');
    var strengthEl = document.getElementById('my-hand-strength');
    container.innerHTML = '';

    // Add PLO class for smaller cards when 5 hole cards
    if (gameMode === 'plo5') {
      container.classList.add('plo-cards');
    } else {
      container.classList.remove('plo-cards');
    }

    if (cards && cards.length > 0) {
      container.appendChild(CardRenderer.createCardGroup(cards));
      area.style.display = 'flex';

      if (handStrength) {
        strengthEl.textContent = handStrength;
        strengthEl.style.display = 'block';
      } else {
        strengthEl.textContent = '';
        strengthEl.style.display = 'none';
      }
    } else {
      area.style.display = 'none';
      strengthEl.textContent = '';
      strengthEl.style.display = 'none';
    }
  }

  function renderDealerButton(state) {
    var marker = document.getElementById('dealer-marker');
    if (state.dealerIndex < 0 || state.phase === 'waiting') {
      marker.style.display = 'none';
      return;
    }

    var dealerPlayer = null;
    for (var i = 0; i < state.players.length; i++) {
      if (i === state.dealerIndex) {
        dealerPlayer = state.players[i];
        break;
      }
    }

    if (!dealerPlayer) {
      marker.style.display = 'none';
      return;
    }

    var seatPositions = [
      { top: 2, left: 50 },
      { top: 15, left: 82 },
      { top: 50, left: 97 },
      { top: 85, left: 82 },
      { top: 98, left: 50 },
      { top: 85, left: 18 },
      { top: 50, left: 3 },
      { top: 15, left: 18 },
      { top: 2, left: 30 }
    ];

    var seatIdx = dealerPlayer.seatIndex;
    var pos = seatPositions[seatIdx];
    var offset = DEALER_OFFSETS[seatIdx];

    marker.style.display = 'flex';
    marker.style.top = 'calc(' + pos.top + '% + ' + offset.y + 'px)';
    marker.style.left = 'calc(' + pos.left + '% + ' + offset.x + 'px)';
  }

  function renderHandResult(results) {
    var resultEl = document.getElementById('hand-result');
    var contentEl = document.getElementById('hand-result-content');

    if (!results || results.length === 0) {
      resultEl.style.display = 'none';
      return;
    }

    var html = '';
    for (var r = 0; r < results.length; r++) {
      var result = results[r];
      for (var w = 0; w < result.winners.length; w++) {
        var winner = result.winners[w];
        html += '<div class="winner-name">' + escapeHtml(winner.name) + '</div>';
        html += '<div class="win-amount">wins ' + formatChips(result.share) + '</div>';
        if (winner.hand) {
          html += '<div class="win-hand">' + escapeHtml(winner.hand) + '</div>';
        }
      }
    }

    contentEl.innerHTML = html;
    resultEl.style.display = 'block';

    setTimeout(function() {
      resultEl.style.display = 'none';
    }, 3500);
  }

  function updateTopBar(state) {
    document.getElementById('room-code').textContent = state.roomCode;
    var modeLabel = state.gameMode === 'plo5' ? 'PLO5' : 'NLH';
    document.getElementById('blind-info').textContent =
      modeLabel + ' ' + state.settings.smallBlind + '/' + state.settings.bigBlind;

    // Host badge
    var hostBadge = document.getElementById('host-badge');
    if (state.isHost) {
      hostBadge.style.display = 'inline-block';
    } else {
      hostBadge.style.display = 'none';
    }

    // Settings modal values
    if (state.isHost) {
      document.getElementById('settings-host-section').style.display = '';
      document.getElementById('settings-viewer-section').style.display = 'none';
      document.getElementById('set-game-mode').value = state.settings.gameMode || 'nlh';
      document.getElementById('set-sb').value = state.settings.smallBlind;
      document.getElementById('set-bb').value = state.settings.bigBlind;
      document.getElementById('set-chips').value = state.settings.startingChips;
      document.getElementById('set-turn-timer').value = state.settings.turnTimer || 60;
      document.getElementById('set-time-bank').value = state.settings.timeBankTotal || 120;
      // Feature toggles
      document.getElementById('set-rabbit-hunting').checked = !!state.settings.rabbitHunting;
      document.getElementById('set-run-it-twice').checked = !!state.settings.runItTwice;
      document.getElementById('set-seven-two-bounty').checked = !!state.settings.sevenTwoBounty;
      document.getElementById('set-seven-two-amount').value = state.settings.sevenTwoBountyAmount || 0;
      document.getElementById('seven-two-amount-group').style.display = state.settings.sevenTwoBounty ? '' : 'none';
      document.getElementById('set-bomb-pot').checked = !!state.settings.bombPotEnabled;
      document.getElementById('set-bomb-pot-ante').value = state.settings.bombPotAnte || 0;
      document.getElementById('set-bomb-pot-freq').value = state.settings.bombPotFrequency || 0;
      document.getElementById('bomb-pot-options').style.display = state.settings.bombPotEnabled ? '' : 'none';
    } else {
      document.getElementById('settings-host-section').style.display = 'none';
      document.getElementById('settings-viewer-section').style.display = '';
      document.getElementById('view-sb').textContent = state.settings.smallBlind;
      document.getElementById('view-bb').textContent = state.settings.bigBlind;
      document.getElementById('view-chips').textContent = state.settings.startingChips;
      var viewMode = document.getElementById('view-mode');
      if (viewMode) viewMode.textContent = (state.settings.gameMode === 'plo5') ? 'Pot Limit Omaha 5' : 'No Limit Hold\'em';
    }
  }

  function renderPendingJoins(state, socket) {
    var bar = document.getElementById('pending-joins-bar');
    var list = document.getElementById('pending-joins-list');

    if (!state.isHost || !state.pendingJoins || state.pendingJoins.length === 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'block';
    list.innerHTML = '';

    for (var i = 0; i < state.pendingJoins.length; i++) {
      var pj = state.pendingJoins[i];
      var item = document.createElement('div');
      item.className = 'pending-join-item';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'pending-join-name';
      nameSpan.textContent = pj.name + ' wants to join';

      var approveBtn = document.createElement('button');
      approveBtn.className = 'pending-btn pending-btn-accept';
      approveBtn.textContent = 'Accept';

      var denyBtn = document.createElement('button');
      denyBtn.className = 'pending-btn pending-btn-deny';
      denyBtn.textContent = 'Deny';

      (function(name) {
        approveBtn.addEventListener('click', function() {
          socket.emit('approve-join', { name: name });
        });
        denyBtn.addEventListener('click', function() {
          socket.emit('deny-join', { name: name });
        });
      })(pj.name);

      item.appendChild(nameSpan);
      item.appendChild(approveBtn);
      item.appendChild(denyBtn);
      list.appendChild(item);
    }
  }

  function renderPlayerChipsList(state, socket) {
    var container = document.getElementById('player-chips-list');
    if (!container || !state.isHost) return;
    container.innerHTML = '';

    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      var row = document.createElement('div');
      row.className = 'player-chip-row';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'player-chip-name';
      nameSpan.textContent = p.name;

      var chipInput = document.createElement('input');
      chipInput.type = 'number';
      chipInput.className = 'player-chip-input';
      chipInput.value = p.chips;
      chipInput.min = '0';
      chipInput.step = '100';

      var setBtn = document.createElement('button');
      setBtn.className = 'btn btn-sm btn-primary player-chip-set';
      setBtn.textContent = 'Set';

      var kickBtn = document.createElement('button');
      kickBtn.className = 'btn btn-sm player-chip-kick';
      kickBtn.textContent = 'Kick';
      kickBtn.style.background = 'var(--danger)';
      kickBtn.style.color = 'white';

      // Don't show kick for yourself
      if (p.isYou) {
        kickBtn.style.display = 'none';
      }

      (function(playerName, input) {
        setBtn.addEventListener('click', function() {
          var amount = parseInt(input.value);
          if (!isNaN(amount) && amount >= 0) {
            socket.emit('set-player-chips', { playerName: playerName, amount: amount });
          }
        });
        kickBtn.addEventListener('click', function() {
          if (confirm('Kick ' + playerName + '?')) {
            socket.emit('kick-player', { playerName: playerName });
          }
        });
      })(p.name, chipInput);

      row.appendChild(nameSpan);
      row.appendChild(chipInput);
      row.appendChild(setBtn);
      row.appendChild(kickBtn);
      container.appendChild(row);
    }
  }

  function renderGameLog(log) {
    var container = document.getElementById('log-messages');
    container.innerHTML = '';

    for (var i = 0; i < log.length; i++) {
      var entry = document.createElement('div');
      entry.className = 'log-entry';
      if (log[i].message.indexOf('***') === 0 || log[i].message.indexOf('---') === 0) {
        entry.classList.add('highlight');
      }
      entry.textContent = log[i].message;
      container.appendChild(entry);
    }

    container.scrollTop = container.scrollHeight;
  }

  function renderLedger(ledger) {
    var container = document.getElementById('ledger-content');
    if (!container) return;
    container.innerHTML = '';

    if (!ledger || ledger.length === 0) {
      container.innerHTML = '<div class="ledger-empty">No transactions yet</div>';
      return;
    }

    var table = document.createElement('table');
    table.className = 'ledger-table';

    var header = document.createElement('tr');
    ['Player', 'Buy-in', 'Stack', 'Net'].forEach(function(h) {
      var th = document.createElement('th');
      th.textContent = h;
      header.appendChild(th);
    });
    table.appendChild(header);

    for (var i = 0; i < ledger.length; i++) {
      var entry = ledger[i];
      var row = document.createElement('tr');

      var nameCell = document.createElement('td');
      nameCell.textContent = entry.name;
      nameCell.className = 'ledger-name';

      var buyInCell = document.createElement('td');
      buyInCell.textContent = formatChips(entry.buyIns);

      var stackCell = document.createElement('td');
      stackCell.textContent = formatChips(entry.currentChips);

      var netCell = document.createElement('td');
      var net = entry.net;
      netCell.textContent = (net >= 0 ? '+' : '') + formatChips(net);
      netCell.className = net >= 0 ? 'ledger-positive' : 'ledger-negative';

      row.appendChild(nameCell);
      row.appendChild(buyInCell);
      row.appendChild(stackCell);
      row.appendChild(netCell);
      table.appendChild(row);
    }

    container.appendChild(table);
  }

  function renderTurnTimer(state) {
    var bar = document.getElementById('turn-timer-bar');
    var fill = document.getElementById('turn-timer-fill');
    var text = document.getElementById('turn-timer-text');

    if (!state.turnTimeRemaining || state.turnTimeRemaining <= 0 ||
        state.phase === 'waiting' || state.phase === 'showdown' ||
        state.currentPlayerIndex < 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'block';
    var total = state.settings.turnTimer || 60;
    var remaining = state.turnTimeRemaining;
    var pct = Math.min(100, (remaining / total) * 100);

    fill.style.width = pct + '%';

    if (pct > 50) {
      fill.style.background = 'var(--accent-green)';
    } else if (pct > 20) {
      fill.style.background = 'var(--accent-gold)';
    } else {
      fill.style.background = 'var(--danger)';
    }

    // Find current player name
    var currentName = '';
    if (state.currentPlayerIndex >= 0 && state.currentPlayerIndex < state.players.length) {
      currentName = state.players[state.currentPlayerIndex].name;
    }

    text.textContent = currentName + ' - ' + remaining + 's';
  }

  function formatChips(amount) {
    if (amount >= 1000000) return (amount / 1000000).toFixed(1) + 'M';
    if (amount >= 10000) return (amount / 1000).toFixed(1) + 'K';
    return amount.toString();
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderRabbitCards(rabbitCards) {
    var area = document.getElementById('rabbit-cards-area');
    var container = document.getElementById('rabbit-cards');

    if (!rabbitCards || rabbitCards.length === 0) {
      area.style.display = 'none';
      return;
    }

    area.style.display = 'flex';
    container.innerHTML = '';
    container.appendChild(CardRenderer.createCardGroup(rabbitCards));
  }

  var ritAnimationTimer = null;

  function renderRunItTwice(state) {
    var ritResults = document.getElementById('rit-results');
    var data = state.runItTwiceData;

    if (!data) {
      ritResults.style.display = 'none';
      if (ritAnimationTimer) { clearTimeout(ritAnimationTimer); ritAnimationTimer = null; }
      return;
    }

    // If already showing, don't re-animate
    if (ritResults.style.display === 'flex' || ritResults.style.display === 'block') return;

    ritResults.style.display = 'flex';
    var existingCount = data.existingCards || 0;

    var cards1El = document.getElementById('rit-cards-1');
    var cards2El = document.getElementById('rit-cards-2');
    var winner1El = document.getElementById('rit-winner-1');
    var winner2El = document.getElementById('rit-winner-2');
    cards1El.innerHTML = '';
    cards2El.innerHTML = '';
    winner1El.textContent = '';
    winner2El.textContent = '';

    // Show existing community cards immediately on both boards
    var i;
    for (i = 0; i < existingCount && i < data.board1.length; i++) {
      cards1El.appendChild(CardRenderer.createCard(data.board1[i]));
    }
    for (i = 0; i < existingCount && i < data.board2.length; i++) {
      cards2El.appendChild(CardRenderer.createCard(data.board2[i]));
    }

    // Reveal new cards one by one with dramatic delay
    var newCards1 = data.board1.slice(existingCount);
    var newCards2 = data.board2.slice(existingCount);
    var totalNew = Math.max(newCards1.length, newCards2.length);
    var delay = 800; // ms between each card

    function revealCard(index) {
      if (index >= totalNew) {
        // All cards revealed — show winners after a beat
        ritAnimationTimer = setTimeout(function() {
          if (data.results1 && data.results1.length > 0) {
            var w1 = data.results1[0].winners;
            var names1 = w1.map(function(w) { return w.name; }).join(', ');
            var hand1 = w1[0].hand ? ' (' + w1[0].hand + ')' : '';
            winner1El.textContent = names1 + ' wins ' + formatChips(data.results1[0].share) + hand1;
          }
          if (data.results2 && data.results2.length > 0) {
            var w2 = data.results2[0].winners;
            var names2 = w2.map(function(w) { return w.name; }).join(', ');
            var hand2 = w2[0].hand ? ' (' + w2[0].hand + ')' : '';
            winner2El.textContent = names2 + ' wins ' + formatChips(data.results2[0].share) + hand2;
          }
        }, 500);
        return;
      }

      // Reveal card on board 1
      if (index < newCards1.length) {
        var card1 = CardRenderer.createCard(newCards1[index]);
        card1.classList.add('rit-reveal');
        card1.style.animationDelay = '0ms';
        cards1El.appendChild(card1);
      }

      // Reveal card on board 2 slightly after board 1
      ritAnimationTimer = setTimeout(function() {
        if (index < newCards2.length) {
          var card2 = CardRenderer.createCard(newCards2[index]);
          card2.classList.add('rit-reveal');
          card2.style.animationDelay = '0ms';
          cards2El.appendChild(card2);
        }

        // Schedule next card
        ritAnimationTimer = setTimeout(function() {
          revealCard(index + 1);
        }, delay);
      }, 400);
    }

    // Start revealing after a short pause
    ritAnimationTimer = setTimeout(function() {
      revealCard(0);
    }, 600);
  }

  function renderRunItTwicePrompt(state, socket) {
    var prompt = document.getElementById('rit-prompt');

    if (!state.runItTwicePending || !state.canRunItTwice) {
      prompt.style.display = 'none';
      return;
    }

    prompt.style.display = 'block';

    // Show equities if available
    var equitiesEl = document.getElementById('rit-equities');
    equitiesEl.innerHTML = '';
    // Calculate equities from active players - server will compute when executing
    // For now just show the prompt
  }

  function renderSevenTwoBanner(sevenTwoWinner) {
    var banner = document.getElementById('seven-two-banner');
    var text = document.getElementById('seven-two-text');

    if (!sevenTwoWinner) {
      banner.style.display = 'none';
      return;
    }

    text.textContent = '7-2 BOUNTY! ' + sevenTwoWinner + ' wins with 7-2!';
    banner.style.display = 'block';

    setTimeout(function() {
      banner.style.display = 'none';
    }, 5000);
  }

  return {
    renderSeats: renderSeats,
    renderCommunityCards: renderCommunityCards,
    renderPot: renderPot,
    renderMyCards: renderMyCards,
    renderDealerButton: renderDealerButton,
    renderHandResult: renderHandResult,
    updateTopBar: updateTopBar,
    renderPendingJoins: renderPendingJoins,
    renderPlayerChipsList: renderPlayerChipsList,
    renderGameLog: renderGameLog,
    renderLedger: renderLedger,
    renderTurnTimer: renderTurnTimer,
    renderRabbitCards: renderRabbitCards,
    renderRunItTwice: renderRunItTwice,
    renderRunItTwicePrompt: renderRunItTwicePrompt,
    renderSevenTwoBanner: renderSevenTwoBanner,
    formatChips: formatChips
  };
})();
