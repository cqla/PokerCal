(function() {
  var socket = io();

  var createBtn = document.getElementById('create-btn');
  var joinBtn = document.getElementById('join-btn');
  var errorMsg = document.getElementById('error-msg');

  createBtn.addEventListener('click', function() {
    var name = document.getElementById('create-name').value.trim();
    if (!name) {
      showError('Please enter your name');
      return;
    }

    var settings = {
      smallBlind: parseInt(document.getElementById('small-blind').value) || 10,
      bigBlind: parseInt(document.getElementById('big-blind').value) || 20,
      startingChips: parseInt(document.getElementById('starting-chips').value) || 1000,
      gameMode: document.getElementById('game-mode').value || 'nlh'
    };

    localStorage.setItem('playerName', name);
    socket.emit('create-room', settings);
  });

  joinBtn.addEventListener('click', function() {
    var name = document.getElementById('join-name').value.trim();
    var roomCode = document.getElementById('room-code').value.trim().toUpperCase();

    if (!name) {
      showError('Please enter your name');
      return;
    }
    if (!roomCode || roomCode.length < 4) {
      showError('Please enter a valid room code');
      return;
    }

    localStorage.setItem('playerName', name);
    window.location.href = '/game/' + roomCode;
  });

  socket.on('room-created', function(data) {
    var name = document.getElementById('create-name').value.trim();
    localStorage.setItem('playerName', name);
    window.location.href = '/game/' + data.roomCode;
  });

  socket.on('error-msg', function(data) {
    showError(data.message);
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
    setTimeout(function() {
      errorMsg.style.display = 'none';
    }, 4000);
  }

  // Restore name from storage
  var savedName = localStorage.getItem('playerName');
  if (savedName) {
    document.getElementById('create-name').value = savedName;
    document.getElementById('join-name').value = savedName;
  }

  // Handle Enter key
  document.querySelectorAll('input').forEach(function(input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var section = input.closest('.lobby-card');
        if (section.id === 'create-section') createBtn.click();
        else joinBtn.click();
      }
    });
  });
})();
