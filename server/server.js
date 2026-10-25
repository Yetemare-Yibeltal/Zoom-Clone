const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const rooms = new Map();

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.json({ message: "Signaling server is running" });
});

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("join-room", ({ roomId, userName } = {}) => {
    if (
      typeof roomId !== "string" ||
      typeof userName !== "string" ||
      !roomId.trim() ||
      !userName.trim()
    ) {
      socket.emit("error-message", "Room ID and username are required.");
      return;
    }

    // Prevent one socket from joining multiple rooms.
    const previousRoom = socket.data.roomId;
    if (previousRoom) {
      socket.leave(previousRoom);
      rooms.get(previousRoom)?.delete(socket.id);
      socket.to(previousRoom).emit("user-disconnected", socket.id);
    }

    const cleanRoom = roomId.trim();
    const cleanName = userName.trim();

    if (!rooms.has(cleanRoom)) {
      rooms.set(cleanRoom, new Map());
    }

    const room = rooms.get(cleanRoom);
    const existingUsers = [...room.entries()].map(([userId, name]) => ({
      userId,
      userName: name,
    }));

    socket.join(cleanRoom);
    socket.data.roomId = cleanRoom;
    socket.data.userName = cleanName;
    room.set(socket.id, cleanName);

    // Tell the joining participant about peers already in the room.
    socket.emit("room-users", existingUsers);

    // Tell existing participants about the newcomer.
    socket.to(cleanRoom).emit("user-connected", {
      userId: socket.id,
      userName: cleanName,
    });

    console.log(`${cleanName} (${socket.id}) joined ${cleanRoom}`);
  });

  socket.on("offer", ({ targetId, offer } = {}) => {
    if (targetId && offer) {
      io.to(targetId).emit("offer", { senderId: socket.id, offer });
    }
  });

  socket.on("answer", ({ targetId, answer } = {}) => {
    if (targetId && answer) {
      io.to(targetId).emit("answer", { senderId: socket.id, answer });
    }
  });

  socket.on("ice-candidate", ({ targetId, candidate } = {}) => {
    if (targetId && candidate) {
      io.to(targetId).emit("ice-candidate", {
        senderId: socket.id,
        candidate,
      });
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      room?.delete(socket.id);

      socket.to(roomId).emit("user-disconnected", socket.id);

      if (room?.size === 0) {
        rooms.delete(roomId);
      }
    }

    console.log(`Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
