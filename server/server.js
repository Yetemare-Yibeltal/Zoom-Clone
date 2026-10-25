const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.status(200).json({ message: "Signaling server is running" });
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join-room", ({ roomId, userName } = {}) => {
    if (!roomId || !userName) {
      socket.emit("error-message", "Room ID and username are required");
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    console.log(`${userName} (${socket.id}) joined room: ${roomId}`);

    socket.to(roomId).emit("user-connected", {
      userId: socket.id,
      userName,
    });
  });

  // Relay WebRTC offers to the intended peer.
  socket.on("offer", ({ targetId, offer } = {}) => {
    if (!targetId || !offer) return;

    io.to(targetId).emit("offer", {
      senderId: socket.id,
      offer,
    });
  });

  // Relay WebRTC answers to the intended peer.
  socket.on("answer", ({ targetId, answer } = {}) => {
    if (!targetId || !answer) return;

    io.to(targetId).emit("answer", {
      senderId: socket.id,
      answer,
    });
  });

  // Relay ICE candidates to the intended peer.
  socket.on("ice-candidate", ({ targetId, candidate } = {}) => {
    if (!targetId || !candidate) return;

    io.to(targetId).emit("ice-candidate", {
      senderId: socket.id,
      candidate,
    });
  });

  socket.on("disconnect", () => {
    const { roomId, userName } = socket.data;

    console.log(`User disconnected: ${socket.id}`);

    if (roomId) {
      socket.to(roomId).emit("user-disconnected", socket.id);
    }
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});