import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  interface GameRoom {
    players: string[];
    board: (string | null)[];
    turn: number;
    status: 'waiting' | 'playing' | 'finished';
  }

  const rooms = new Map<string, GameRoom>();

  function generateRoomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  function checkWinner(board: (string | null)[]): string | null | 'draw' {
    const winPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];
    for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    if (!board.includes(null)) return 'draw';
    return null;
  }

  // Socket.io Logic
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', () => {
      const roomCode = generateRoomCode();
      rooms.set(roomCode, {
        players: [socket.id],
        board: Array(9).fill(null),
        turn: 0,
        status: 'waiting'
      });
      socket.join(roomCode);
      socket.emit('roomCreated', roomCode);
      socket.emit('playerSymbol', 'X');
    });

    socket.on('joinRoom', (roomCode: string) => {
      const room = rooms.get(roomCode);
      if (!room) return socket.emit('error', 'Xona topilmadi');
      if (room.players.length >= 2) return socket.emit('error', 'Xona to\'la');
      if (room.players.includes(socket.id)) return;

      room.players.push(socket.id);
      socket.join(roomCode);
      socket.emit('playerSymbol', 'O');
      
      if (room.players.length === 2) {
        room.status = 'playing';
        io.to(roomCode).emit('gameStart', {
          players: room.players,
          board: room.board,
          turn: room.players[room.turn]
        });
      }
    });

    socket.on('makeMove', ({ roomCode, index }: { roomCode: string, index: number }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'playing') return;

      const currentPlayerId = room.players[room.turn];
      if (socket.id !== currentPlayerId) return;

      if (room.board[index] === null) {
        const symbol = room.turn === 0 ? 'X' : 'O';
        room.board[index] = symbol;
        const result = checkWinner(room.board);
        
        if (result) {
          room.status = 'finished';
          io.to(roomCode).emit('gameOver', {
            board: room.board,
            winner: result === 'draw' ? 'draw' : socket.id
          });
        } else {
          room.turn = (room.turn + 1) % 2;
          io.to(roomCode).emit('gameUpdate', {
            board: room.board,
            turn: room.players[room.turn]
          });
        }
      }
    });

    socket.on('resetGame', (roomCode: string) => {
      const room = rooms.get(roomCode);
      if (room && room.status === 'finished') {
        room.board = Array(9).fill(null);
        room.turn = 0; // X starts always for simplicity
        room.status = 'playing';
        io.to(roomCode).emit('gameStart', {
          players: room.players,
          board: room.board,
          turn: room.players[room.turn]
        });
      }
    });

    socket.on('disconnect', () => {
      for (const [code, room] of rooms.entries()) {
        if (room.players.includes(socket.id)) {
          io.to(code).emit('opponentLeft');
          rooms.delete(code);
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
