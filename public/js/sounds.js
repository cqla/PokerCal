var Sounds = (function() {
  var muted = localStorage.getItem('pokerSoundsMuted') === 'true';
  var ctx = null;
  var volume = 0.3;

  function getCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    return ctx;
  }

  // Resume audio context on first user interaction (browser policy)
  function ensureResumed() {
    var c = getCtx();
    if (c && c.state === 'suspended') {
      c.resume();
    }
  }

  document.addEventListener('click', ensureResumed, { once: true });
  document.addEventListener('keydown', ensureResumed, { once: true });

  function playTone(freq, duration, type, vol) {
    if (muted) return;
    var c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();

    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);

    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.value = (vol !== undefined ? vol : volume) * 0.5;

    // Quick fade out to avoid clicks
    gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration);
  }

  function playNoise(duration, vol) {
    if (muted) return;
    var c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();

    var bufferSize = c.sampleRate * duration;
    var buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }

    var source = c.createBufferSource();
    source.buffer = buffer;

    var gain = c.createGain();
    var filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);

    gain.gain.value = (vol !== undefined ? vol : volume) * 0.4;
    gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

    source.start(c.currentTime);
    source.stop(c.currentTime + duration);
  }

  // === Sound Effects ===

  function check() {
    // Double tap sound
    playTone(800, 0.06, 'sine', volume);
    setTimeout(function() {
      playTone(800, 0.06, 'sine', volume);
    }, 80);
  }

  function call() {
    // Single chip toss
    playTone(600, 0.08, 'triangle', volume);
    playNoise(0.05, volume * 0.3);
  }

  function raise() {
    // Chip stack push — ascending
    playTone(500, 0.06, 'triangle', volume);
    setTimeout(function() {
      playTone(700, 0.06, 'triangle', volume);
      playNoise(0.06, volume * 0.4);
    }, 60);
    setTimeout(function() {
      playTone(900, 0.08, 'triangle', volume);
    }, 120);
  }

  function fold() {
    // Soft card toss
    playNoise(0.12, volume * 0.5);
  }

  function allIn() {
    // Dramatic chip push
    playTone(400, 0.08, 'sawtooth', volume * 0.6);
    setTimeout(function() {
      playTone(600, 0.08, 'sawtooth', volume * 0.6);
      playNoise(0.1, volume * 0.5);
    }, 80);
    setTimeout(function() {
      playTone(800, 0.12, 'sawtooth', volume * 0.7);
      playNoise(0.15, volume * 0.6);
    }, 160);
  }

  function deal() {
    // Card dealing — quick flick sounds
    playNoise(0.04, volume * 0.4);
    setTimeout(function() { playNoise(0.04, volume * 0.35); }, 120);
  }

  function yourTurn() {
    // Gentle notification chime
    playTone(523, 0.1, 'sine', volume * 0.6);
    setTimeout(function() {
      playTone(659, 0.1, 'sine', volume * 0.6);
    }, 120);
    setTimeout(function() {
      playTone(784, 0.15, 'sine', volume * 0.7);
    }, 240);
  }

  function timerWarning() {
    // Urgent tick
    playTone(1000, 0.05, 'square', volume * 0.4);
  }

  function win() {
    // Victory chime
    playTone(523, 0.12, 'sine', volume * 0.7);
    setTimeout(function() { playTone(659, 0.12, 'sine', volume * 0.7); }, 150);
    setTimeout(function() { playTone(784, 0.12, 'sine', volume * 0.7); }, 300);
    setTimeout(function() { playTone(1047, 0.2, 'sine', volume * 0.8); }, 450);
  }

  function newHand() {
    // Shuffle/deal — multiple quick flicks
    for (var i = 0; i < 4; i++) {
      (function(delay) {
        setTimeout(function() {
          playNoise(0.035, volume * 0.3);
        }, delay);
      })(i * 80);
    }
  }

  function communityCard() {
    // Single card flip
    playNoise(0.06, volume * 0.45);
    playTone(350, 0.04, 'sine', volume * 0.3);
  }

  // === Mute Toggle ===

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('pokerSoundsMuted', muted);
    return muted;
  }

  function isMuted() {
    return muted;
  }

  function setMuted(val) {
    muted = !!val;
    localStorage.setItem('pokerSoundsMuted', muted);
  }

  return {
    check: check,
    call: call,
    raise: raise,
    fold: fold,
    allIn: allIn,
    deal: deal,
    yourTurn: yourTurn,
    timerWarning: timerWarning,
    win: win,
    newHand: newHand,
    communityCard: communityCard,
    toggleMute: toggleMute,
    isMuted: isMuted,
    setMuted: setMuted
  };
})();
