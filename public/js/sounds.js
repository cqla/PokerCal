var Sounds = (function() {
  var muted = localStorage.getItem('pokerSoundsMuted') === 'true';
  var ctx = null;
  var volume = 0.3;

  // Current active audio source — kept so we can cut it off
  var activeSource = null; // { node, gain, type } where type = 'buffer' | 'html'

  // Sound configuration: set from game state (host controls)
  var config = {
    soundCallRaise: 'default',
    soundWin: 'default',
    soundFold: 'default',
    soundCheckLimp: 'default',
    soundSpecial: 'default'
  };

  // Available sound files per category (fetched from server)
  var availableSounds = {};
  var soundsFetched = false;

  // Pre-decoded audio buffers cache
  var bufferCache = {};

  // Random picks for current round (reset each hand)
  var randomPicks = {};

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

  function ensureResumed() {
    var c = getCtx();
    if (c && c.state === 'suspended') {
      c.resume();
    }
  }

  document.addEventListener('click', ensureResumed, { once: true });
  document.addEventListener('keydown', ensureResumed, { once: true });

  // Safari suspends AudioContext when tab is backgrounded — resume on visibility change
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) ensureResumed();
  });

  // ==================== Cut-off logic ====================

  function stopActive() {
    if (!activeSource) return;
    try {
      if (activeSource.type === 'buffer') {
        activeSource.node.stop();
      } else if (activeSource.type === 'html') {
        activeSource.node.pause();
        activeSource.node.currentTime = 0;
      }
    } catch (e) { /* already stopped */ }
    activeSource = null;
  }

  // ==================== Fetch available sounds ====================

  var onFetchCallbacks = [];

  var fetchDone = false;

  function fetchSoundList(cb) {
    if (cb) onFetchCallbacks.push(cb);
    if (fetchDone) {
      // Already have data — fire callbacks immediately
      while (onFetchCallbacks.length) onFetchCallbacks.shift()();
      return;
    }
    if (soundsFetched) return; // request in flight, callbacks will fire on completion
    soundsFetched = true;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/sounds', true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          availableSounds = JSON.parse(xhr.responseText);
        } catch (e) { /* ignore */ }
      }
      fetchDone = true;
      while (onFetchCallbacks.length) onFetchCallbacks.shift()();
    };
    xhr.onerror = function() {
      fetchDone = true;
      while (onFetchCallbacks.length) onFetchCallbacks.shift()();
    };
    xhr.send();
  }

  // Fetch on load
  fetchSoundList();

  // ==================== Config / state sync ====================

  function updateConfig(settings) {
    if (!settings) return;
    config.soundCallRaise = settings.soundCallRaise || 'default';
    config.soundWin = settings.soundWin || 'default';
    config.soundFold = settings.soundFold || 'default';
    config.soundCheckLimp = settings.soundCheckLimp || 'default';
    config.soundSpecial = settings.soundSpecial || 'default';
  }

  // Called at each new hand — re-roll random picks
  function newRound() {
    randomPicks = {};
    var categories = {
      'Call-Raise': 'soundCallRaise',
      'Win': 'soundWin',
      'Fold': 'soundFold',
      'Check-Limp': 'soundCheckLimp',
      'Special': 'soundSpecial'
    };
    for (var cat in categories) {
      var settingKey = categories[cat];
      if (config[settingKey] === 'random') {
        var files = availableSounds[cat];
        if (files && files.length > 0) {
          randomPicks[cat] = files[Math.floor(Math.random() * files.length)];
        }
      }
    }
  }

  // ==================== Resolve which file to play ====================

  // Returns null for 'default' (use synth), or a URL string for custom
  function resolveSound(category, settingKey) {
    var val = config[settingKey];
    if (!val || val === 'default') return null;
    if (val === 'random') {
      var picked = randomPicks[category];
      if (!picked) return null;
      return '/assets/' + category + '/' + picked;
    }
    // Specific file
    return '/assets/' + category + '/' + val;
  }

  // ==================== Play custom MP3 (with cut-off) ====================

  function playCustom(url, cb) {
    if (muted) return;
    stopActive();
    var c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();

    // Check buffer cache
    if (bufferCache[url]) {
      playBuffer(bufferCache[url]);
      return;
    }

    // Fetch and decode
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function() {
      if (xhr.status !== 200) {
        if (cb) cb();
        return;
      }
      c.decodeAudioData(xhr.response, function(buffer) {
        bufferCache[url] = buffer;
        playBuffer(buffer);
      }, function() {
        if (cb) cb();
      });
    };
    xhr.onerror = function() { if (cb) cb(); };
    xhr.send();
  }

  function playBuffer(buffer) {
    var c = getCtx();
    if (!c) return;

    var source = c.createBufferSource();
    source.buffer = buffer;

    var gain = c.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(c.destination);

    source.start(0);
    activeSource = { node: source, gain: gain, type: 'buffer' };

    source.onended = function() {
      if (activeSource && activeSource.node === source) {
        activeSource = null;
      }
    };
  }

  // ==================== Default synth sounds ====================

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

  // ==================== Default synth implementations ====================

  function defaultCheck() {
    playTone(800, 0.06, 'sine', volume);
    setTimeout(function() {
      playTone(800, 0.06, 'sine', volume);
    }, 80);
  }

  function defaultCall() {
    playTone(600, 0.08, 'triangle', volume);
    playNoise(0.05, volume * 0.3);
  }

  function defaultRaise() {
    playTone(500, 0.06, 'triangle', volume);
    setTimeout(function() {
      playTone(700, 0.06, 'triangle', volume);
      playNoise(0.06, volume * 0.4);
    }, 60);
    setTimeout(function() {
      playTone(900, 0.08, 'triangle', volume);
    }, 120);
  }

  function defaultFold() {
    playNoise(0.12, volume * 0.5);
  }

  function defaultAllIn() {
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

  function defaultWin() {
    playTone(523, 0.12, 'sine', volume * 0.7);
    setTimeout(function() { playTone(659, 0.12, 'sine', volume * 0.7); }, 150);
    setTimeout(function() { playTone(784, 0.12, 'sine', volume * 0.7); }, 300);
    setTimeout(function() { playTone(1047, 0.2, 'sine', volume * 0.8); }, 450);
  }

  // ==================== Public sound functions ====================

  function check() {
    stopActive();
    var url = resolveSound('Check-Limp', 'soundCheckLimp');
    if (url) { playCustom(url); } else { defaultCheck(); }
  }

  function call() {
    stopActive();
    var url = resolveSound('Call-Raise', 'soundCallRaise');
    if (url) { playCustom(url); } else { defaultCall(); }
  }

  function raise() {
    stopActive();
    var url = resolveSound('Call-Raise', 'soundCallRaise');
    if (url) { playCustom(url); } else { defaultRaise(); }
  }

  function fold() {
    stopActive();
    var url = resolveSound('Fold', 'soundFold');
    if (url) { playCustom(url); } else { defaultFold(); }
  }

  function allIn() {
    stopActive();
    var url = resolveSound('Special', 'soundSpecial');
    if (url) { playCustom(url); } else { defaultAllIn(); }
  }

  function deal() {
    // Deal always uses default synth (quick flick sounds)
    playNoise(0.04, volume * 0.4);
    setTimeout(function() { playNoise(0.04, volume * 0.35); }, 120);
  }

  function yourTurn() {
    // Notification chime — always default
    playTone(523, 0.1, 'sine', volume * 0.6);
    setTimeout(function() {
      playTone(659, 0.1, 'sine', volume * 0.6);
    }, 120);
    setTimeout(function() {
      playTone(784, 0.15, 'sine', volume * 0.7);
    }, 240);
  }

  function timerWarning() {
    playTone(1000, 0.05, 'square', volume * 0.4);
  }

  function win() {
    stopActive();
    var url = resolveSound('Win', 'soundWin');
    if (url) { playCustom(url); } else { defaultWin(); }
  }

  function special(eventType) {
    stopActive();
    var url = resolveSound('Special', 'soundSpecial');
    if (url) {
      playCustom(url);
    } else {
      // Default special sound — dramatic stinger
      playTone(330, 0.15, 'sawtooth', volume * 0.5);
      setTimeout(function() { playTone(440, 0.15, 'sawtooth', volume * 0.6); }, 150);
      setTimeout(function() { playTone(550, 0.2, 'triangle', volume * 0.7); }, 300);
      setTimeout(function() { playTone(660, 0.3, 'sine', volume * 0.8); }, 500);
    }
  }

  function newHand() {
    stopActive(); // cut off any lingering win sound
    newRound();    // re-roll random picks for this hand
    for (var i = 0; i < 4; i++) {
      (function(delay) {
        setTimeout(function() {
          playNoise(0.035, volume * 0.3);
        }, delay);
      })(i * 80);
    }
  }

  function communityCard() {
    playNoise(0.06, volume * 0.45);
    playTone(350, 0.04, 'sine', volume * 0.3);
  }

  // ==================== Mute Toggle ====================

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('pokerSoundsMuted', muted);
    if (muted) stopActive();
    return muted;
  }

  function isMuted() {
    return muted;
  }

  function setMuted(val) {
    muted = !!val;
    localStorage.setItem('pokerSoundsMuted', muted);
    if (muted) stopActive();
  }

  // ==================== Accessors ====================

  function getAvailableSounds() {
    return availableSounds;
  }

  function getConfig() {
    return config;
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
    special: special,
    newHand: newHand,
    communityCard: communityCard,
    toggleMute: toggleMute,
    isMuted: isMuted,
    setMuted: setMuted,
    updateConfig: updateConfig,
    newRound: newRound,
    stopActive: stopActive,
    getAvailableSounds: getAvailableSounds,
    getConfig: getConfig,
    fetchSoundList: fetchSoundList
  };
})();
