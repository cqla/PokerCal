var Controls = (function() {
  var currentActions = null;
  var onAction = null;
  var betPanelOpen = false;

  function init(actionCallback) {
    onAction = actionCallback;

    document.getElementById('fold-btn').addEventListener('click', function() {
      closeBetPanel();
      if (onAction) onAction('fold');
    });

    document.getElementById('check-btn').addEventListener('click', function() {
      closeBetPanel();
      if (onAction) onAction('check');
    });

    document.getElementById('call-btn').addEventListener('click', function() {
      closeBetPanel();
      if (onAction) onAction('call');
    });

    // Raise button opens the bet panel
    document.getElementById('raise-btn').addEventListener('click', function() {
      openBetPanel();
    });

    // Back button closes the bet panel (returns to main action buttons)
    document.getElementById('bet-back-btn').addEventListener('click', function() {
      closeBetPanel();
    });

    // Raise confirm button (inside bet panel) submits the raise
    document.getElementById('raise-confirm-btn').addEventListener('click', function() {
      var amount = parseInt(document.getElementById('bet-input').value);
      if (onAction && amount) onAction('raise', amount);
      closeBetPanel();
    });

    document.getElementById('allin-btn').addEventListener('click', function() {
      closeBetPanel();
      if (onAction) onAction('allin');
    });

    // Slider / input sync
    var slider = document.getElementById('bet-slider');
    var input = document.getElementById('bet-input');

    slider.addEventListener('input', function() {
      input.value = slider.value;
      updateConfirmButtonLabel();
    });

    input.addEventListener('input', function() {
      var val = parseInt(input.value) || 0;
      if (val < parseInt(slider.min)) val = parseInt(slider.min);
      if (val > parseInt(slider.max)) val = parseInt(slider.max);
      slider.value = val;
      updateConfirmButtonLabel();
    });

    // Presets
    var presetBtns = document.querySelectorAll('.preset-btn');
    for (var i = 0; i < presetBtns.length; i++) {
      presetBtns[i].addEventListener('click', function() {
        if (!currentActions) return;
        var preset = this.getAttribute('data-preset');
        var amount;

        if (preset === 'min') {
          amount = currentActions.minRaise;
        } else if (preset === 'max') {
          amount = currentActions.maxRaise;
        } else {
          var multiplier = parseFloat(preset);
          amount = Math.max(
            currentActions.minRaise,
            Math.floor(currentActions.pot * multiplier)
          );
          amount = Math.min(amount, currentActions.maxRaise);
        }

        document.getElementById('bet-slider').value = amount;
        document.getElementById('bet-input').value = amount;
        updateConfirmButtonLabel();
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.target.tagName === 'INPUT') return;
      if (!currentActions) return;

      switch(e.key.toLowerCase()) {
        case 'f':
          if (onAction) onAction('fold');
          closeBetPanel();
          break;
        case 'c':
          if (currentActions.actions.indexOf('check') >= 0) {
            if (onAction) onAction('check');
          } else if (currentActions.actions.indexOf('call') >= 0) {
            if (onAction) onAction('call');
          }
          closeBetPanel();
          break;
        case 'r':
          if (betPanelOpen) {
            var amount = parseInt(document.getElementById('bet-input').value);
            if (onAction && amount) onAction('raise', amount);
            closeBetPanel();
          } else {
            openBetPanel();
          }
          break;
        case 'a':
          if (onAction) onAction('allin');
          closeBetPanel();
          break;
        case 'escape':
          closeBetPanel();
          break;
      }
    });
  }

  function openBetPanel() {
    if (!currentActions || currentActions.actions.indexOf('raise') < 0) return;
    betPanelOpen = true;
    document.getElementById('bet-panel').style.display = 'block';
    // Hide the primary action buttons — bet panel fully replaces them
    document.getElementById('action-buttons').style.display = 'none';
    document.body.classList.add('bet-panel-open');
    updateConfirmButtonLabel();
  }

  function closeBetPanel() {
    betPanelOpen = false;
    document.getElementById('bet-panel').style.display = 'none';
    // Restore primary action buttons
    var ab = document.getElementById('action-buttons');
    if (ab) ab.style.display = '';
    document.body.classList.remove('bet-panel-open');
  }

  function updateConfirmButtonLabel() {
    var input = document.getElementById('bet-input');
    var confirmBtn = document.getElementById('raise-confirm-btn');
    var val = parseInt(input.value) || 0;
    confirmBtn.textContent = 'Bet ' + TableRenderer.formatChips(val);
  }

  function show(validActions) {
    currentActions = validActions;
    var area = document.getElementById('controls-area');
    var checkBtn = document.getElementById('check-btn');
    var callBtn = document.getElementById('call-btn');
    var raiseBtn = document.getElementById('raise-btn');

    if (!validActions) {
      area.style.display = 'none';
      closeBetPanel();
      return;
    }

    area.style.display = 'block';

    // Always start with bet panel closed
    closeBetPanel();

    // Check vs Call
    if (validActions.actions.indexOf('check') >= 0) {
      checkBtn.style.display = '';
      callBtn.style.display = 'none';
    } else {
      checkBtn.style.display = 'none';
      callBtn.style.display = '';
      callBtn.textContent = 'Call ' + TableRenderer.formatChips(validActions.toCall);
    }

    // Raise availability
    if (validActions.actions.indexOf('raise') >= 0) {
      raiseBtn.style.display = '';
      raiseBtn.textContent = 'Bet';

      // Setup slider values (ready for when panel opens)
      var slider = document.getElementById('bet-slider');
      var input = document.getElementById('bet-input');

      slider.min = validActions.minRaise;
      slider.max = validActions.maxRaise;
      slider.value = validActions.minRaise;
      input.min = validActions.minRaise;
      input.max = validActions.maxRaise;
      input.value = validActions.minRaise;

      document.getElementById('slider-min-label').textContent = TableRenderer.formatChips(validActions.minRaise);
      document.getElementById('slider-max-label').textContent = TableRenderer.formatChips(validActions.maxRaise);
    } else {
      raiseBtn.style.display = 'none';
    }
  }

  function hide() {
    currentActions = null;
    betPanelOpen = false;
    document.getElementById('controls-area').style.display = 'none';
    document.getElementById('bet-panel').style.display = 'none';
    var ab = document.getElementById('action-buttons');
    if (ab) ab.style.display = '';
    document.body.classList.remove('bet-panel-open');
  }

  function showWaiting(canStart, canRebuy, canCashOut) {
    var waitingEl = document.getElementById('waiting-controls');
    var startBtn = document.getElementById('start-btn');
    var rebuyBtn = document.getElementById('rebuy-btn');
    var cashOutBtn = document.getElementById('cash-out-btn');

    waitingEl.style.display = 'flex';
    startBtn.style.display = canStart ? '' : 'none';
    rebuyBtn.style.display = canRebuy ? '' : 'none';
    cashOutBtn.style.display = canCashOut ? '' : 'none';
  }

  function hideWaiting() {
    document.getElementById('waiting-controls').style.display = 'none';
  }

  return {
    init: init,
    show: show,
    hide: hide,
    showWaiting: showWaiting,
    hideWaiting: hideWaiting
  };
})();
