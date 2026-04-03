var Chat = (function() {
  var socket = null;

  function init(sock) {
    socket = sock;

    var sendBtn = document.getElementById('chat-send');
    var chatInput = document.getElementById('chat-input');

    sendBtn.addEventListener('click', send);
    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') send();
    });

    // Tab switching
    var tabs = document.querySelectorAll('.panel-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function() {
        var tabName = this.getAttribute('data-tab');
        for (var j = 0; j < tabs.length; j++) {
          tabs[j].classList.remove('active');
        }
        this.classList.add('active');
        document.getElementById('panel-chat').style.display = tabName === 'chat' ? '' : 'none';
        document.getElementById('panel-log').style.display = tabName === 'log' ? '' : 'none';
        document.getElementById('panel-ledger').style.display = tabName === 'ledger' ? '' : 'none';
      });
    }

    // Desktop: collapse/expand side panel
    var collapseBtn = document.getElementById('panel-collapse-btn');
    var panel = document.getElementById('side-panel');
    var toggleBtn = document.getElementById('panel-toggle');

    collapseBtn.addEventListener('click', function() {
      panel.classList.add('collapsed');
      toggleBtn.classList.add('visible');
    });

    // Panel toggle button (shows panel again - works on both desktop and mobile)
    toggleBtn.addEventListener('click', function() {
      var isMobile = window.innerWidth <= 700;
      if (isMobile) {
        // Mobile: toggle open/close
        if (panel.classList.contains('mobile-open')) {
          panel.classList.remove('mobile-open');
        } else {
          panel.classList.add('mobile-open');
        }
      } else {
        // Desktop: uncollapse
        panel.classList.remove('collapsed');
        toggleBtn.classList.remove('visible');
      }
    });
  }

  function send() {
    var input = document.getElementById('chat-input');
    var text = input.value.trim();
    if (!text || !socket) return;
    socket.emit('chat-message', { text: text });
    input.value = '';
  }

  function addMessage(data) {
    var container = document.getElementById('chat-messages');
    var msg = document.createElement('div');
    msg.className = 'chat-msg';

    var name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = data.name + ': ';

    var text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = data.text;

    msg.appendChild(name);
    msg.appendChild(text);
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  return {
    init: init,
    addMessage: addMessage
  };
})();
