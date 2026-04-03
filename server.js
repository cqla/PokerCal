var express = require('express');
var http = require('http');
var socketIO = require('socket.io');
var path = require('path');
var LobbyManager = require('./src/lobby/LobbyManager');
var setupSocketHandlers = require('./src/socket/socketHandler');

var app = express();
var server = http.createServer(app);
var io = socketIO(server);
var lobbyManager = new LobbyManager();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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
