var Controls = (function() {
  var currentActions = null;
  var onAction = null;

  function init(actionCallback) {
    onAction = actionCallback;

    document.getElementById('fold-btn').addEventListener('click', function() {
      if (onAction) onAction('fold');
    });

    document.getElementById('check-btn').addEventListener('click', function() {
      if (onAction) onAction('check');
    });

    document.getElementById('call-btn').addEventListener('click', function() {
      if (onAction) onAction('call');
    });

    document.getElementById('raise-btn').addEventListener('click', function() {
      var amount = parseInt(document.getElementById('bet-input').value);
      if (onAction && amount) onAction('raise', amount);
    });

    document.getElementById('allin-btn').addEventListener('click', function() {
      if (onAction) onAction('allin');
    });

    // Slider / input sync
    var slider = document.getElementById('bet-slider');
    var input = document.getElementById('bet-input');

    slider.addEventListener('input', function() {
      input.value = slider.value;
      updateRaiseButtonLabel();
    });

    input.addEventListener('input', function() {
      var val = parseInt(input.value) || 0;
      if (val < parseInt(slider.min)) val = parseInt(slider.min);
      if (val > parseInt(slider.max)) val = parseInt(slider.max);
      slider.value = val;
      updateRaiseButtonLabel();
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
        updateRaiseButtonLabel();
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.target.tagName === 'INPUT') return;
      if (!currentActions) return;

      switch(e.key.toLowerCase()) {
        case 'f':
          if (onAction) onAction('fold');
          break;
        case 'c':
          if (currentActions.actions.indexOf('check') >= 0) {
            if (onAction) onAction('check');
          } else if (currentActions.actions.indexOf('call') >= 0) {
            if (onAction) onAction('call');
          }
          break;
        case 'r':
          var amount = parseInt(document.getElementById('bet-input').value);
          if (onAction && amount) onAction('raise', amount);
          break;
        case 'a':
          if (onAction) onAction('allin');
          break;
      }
    });
  }

  function updateRaiseButtonLabel() {
    var input = document.getElementById('bet-input');
    var raiseBtn = document.getElementById('raise-btn');
    var val = parseInt(input.value) || 0;
    raiseBtn.textContent = 'Raise ' + TableRenderer.formatChips(val);
  }

  function show(validActions) {
    currentActions = validActions;
    var area = document.getElementById('controls-area');
    var checkBtn = document.getElementById('check-btn');
    var callBtn = document.getElementById('call-btn');
    var raiseBtn = document.getElementById('raise-btn');
    var sliderRow = document.getElementById('bet-slider-row');
    var presetsRow = document.getElementById('bet-presets');
    var amountDisplay = document.getElementById('bet-amount-display');

    if (!validActions) {
      area.style.display = 'none';
      return;
    }

    area.style.display = 'block';

    // Check vs Call
    if (validActions.actions.indexOf('check') >= 0) {
      checkBtn.style.display = '';
      callBtn.style.display = 'none';
    } else {
      checkBtn.style.display = 'none';
      callBtn.style.display = '';
      callBtn.textContent = 'Call ' + TableRenderer.formatChips(validActions.toCall);
    }

    // Raise slider
    if (validActions.actions.indexOf('raise') >= 0) {
      raiseBtn.style.display = '';
      sliderRow.style.display = 'flex';
      presetsRow.style.display = 'flex';
      amountDisplay.style.display = 'flex';

      var slider = document.getElementById('bet-slider');
      var input = document.getElementById('bet-input');

      slider.min = validActions.minRaise;
      slider.max = validActions.maxRaise;
      slider.value = validActions.minRaise;
      input.min = validActions.minRaise;
      input.max = validActions.maxRaise;
      input.value = validActions.minRaise;

      // Update labels
      document.getElementById('slider-min-label').textContent = TableRenderer.formatChips(validActions.minRaise);
      document.getElementById('slider-max-label').textContent = TableRenderer.formatChips(validActions.maxRaise);

      updateRaiseButtonLabel();
    } else {
      raiseBtn.style.display = 'none';
      sliderRow.style.display = 'none';
      presetsRow.style.display = 'none';
      amountDisplay.style.display = 'none';
    }
  }

  function hide() {
    currentActions = null;
    document.getElementById('controls-area').style.display = 'none';
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
