var express = require('express');
var http = require('http');
var { Server } = require('socket.io');
var path = require('path');
var LobbyManager = require('./src/lobby/LobbyManager');
var setupSocketHandlers = require('./src/socket/socketHandler');

var app = express();
var server = http.createServer(app);
var io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
var lobbyManager = new LobbyManager();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: list available custom sounds per category
app.get('/api/sounds', function(req, res) {
  var fs = require('fs');
  var assetsDir = path.join(__dirname, 'public', 'assets');
  var categories = ['Call-Raise', 'Win', 'Fold', 'Check-Limp', 'Special'];
  var result = {};
  categories.forEach(function(cat) {
    var dir = path.join(assetsDir, cat);
    try {
      var files = fs.readdirSync(dir).filter(function(f) {
        return /\.(mp3|wav|ogg|m4a)$/i.test(f);
      });
      result[cat] = files;
    } catch (e) {
      result[cat] = [];
    }
  });
  res.json(result);
});

// Routes
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/game/:roomCode', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// Socket.IO
setupSocketHandlers(io, lobbyManager);

// Start server
var PORT = process.env.PORT || 3030;
server.listen(PORT, function() {
  console.log('PokerCal server running on http://localhost:' + PORT);
});
