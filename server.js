const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Room } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, Room>} */
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 문자 제외
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function broadcastState(room) {
  if (room.hostId) {
    io.to(room.hostId).emit('state', room.getState('host'));
  }
  if (room.playerId) {
    io.to(room.playerId).emit('state', room.getState('player'));
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', (rawStartingChips) => {
    let startingChips = parseInt(rawStartingChips, 10);
    if (!Number.isInteger(startingChips) || startingChips < 50000) {
      startingChips = 50000;
    }
    const code = generateRoomCode();
    const room = new Room(code, socket.id, startingChips);
    room.onUpdate = () => broadcastState(room);
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'host';
    socket.emit('roomCreated', { code });
    broadcastState(room);
  });

  socket.on('joinRoom', (rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('joinError', '존재하지 않는 방 코드입니다.');
      return;
    }
    if (room.playerId) {
      socket.emit('joinError', '이미 플레이어가 입장한 방입니다.');
      return;
    }
    room.playerJoined(socket.id);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'player';
    socket.emit('joinSuccess', { code });
    broadcastState(room);
  });

  socket.on('placeBet', (amount) => {
    const room = getRoomFor(socket, 'player');
    if (!room) return;
    const result = room.placeBet(Number(amount));
    if (!result.ok) {
      socket.emit('actionError', result.error);
      return;
    }
    broadcastState(room);
  });

  socket.on('hit', () => {
    const room = getRoomFor(socket, 'player');
    if (!room) return;
    const result = room.hit();
    if (!result.ok) {
      socket.emit('actionError', result.error);
      return;
    }
    broadcastState(room);
  });

  socket.on('stand', () => {
    const room = getRoomFor(socket, 'player');
    if (!room) return;
    const result = room.stand();
    if (!result.ok) {
      socket.emit('actionError', result.error);
      return;
    }
    broadcastState(room);
  });

  socket.on('doubleDown', () => {
    const room = getRoomFor(socket, 'player');
    if (!room) return;
    const result = room.doubleDown();
    if (!result.ok) {
      socket.emit('actionError', result.error);
      return;
    }
    broadcastState(room);
  });

  socket.on('cashOut', () => {
    const room = getRoomFor(socket, 'player');
    if (!room) return;
    const result = room.cashOut();
    if (!result.ok) {
      socket.emit('actionError', result.error);
      return;
    }
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.role === 'host') {
      if (room.playerId) {
        io.to(room.playerId).emit('roomClosed', '방장이 나가서 방이 종료되었습니다.');
      }
      rooms.delete(code);
    } else if (socket.data.role === 'player') {
      room.playerId = null;
      room.phase = 'waiting';
      room.message = '플레이어를 기다리는 중...';
      if (room.hostId) {
        io.to(room.hostId).emit('info', '플레이어가 나갔습니다.');
        broadcastState(room);
      }
    }
  });

  function getRoomFor(sock, expectedRole) {
    const code = sock.data.roomCode;
    if (!code) return null;
    const room = rooms.get(code);
    if (!room) return null;
    if (sock.data.role !== expectedRole) return null;
    return room;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`블랙잭 서버 실행 중: http://localhost:${PORT}`);
});
