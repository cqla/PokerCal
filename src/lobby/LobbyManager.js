var Game = require('../game/Game');
var constants = require('../game/constants');

function LobbyManager() {
  this.rooms = {};
}

LobbyManager.prototype.createRoom = function(settings) {
  var roomCode = this.generateRoomCode();
  this.rooms[roomCode] = new Game(roomCode, settings);
  return roomCode;
};

LobbyManager.prototype.getRoom = function(roomCode) {
  return this.rooms[roomCode] || null;
};

LobbyManager.prototype.destroyRoom = function(roomCode) {
  delete this.rooms[roomCode];
};

LobbyManager.prototype.generateRoomCode = function() {
  var code;
  do {
    code = '';
    for (var i = 0; i < constants.ROOM_CODE_LENGTH; i++) {
      code += constants.ROOM_CODE_CHARS.charAt(
        Math.floor(Math.random() * constants.ROOM_CODE_CHARS.length)
      );
    }
  } while (this.rooms[code]);
  return code;
};

LobbyManager.prototype.getRoomCount = function() {
  return Object.keys(this.rooms).length;
};

module.exports = LobbyManager;
