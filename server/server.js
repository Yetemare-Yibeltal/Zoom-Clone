const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("join-room", ({ roomId, userName }) => {
    socket.join(roomId);
    console.log(`User ${userName} (${socket.id}) joined room: ${roomId}`);

    // Broadcast to existing room members that a new peer joined
    socket.to(roomId).emit("user-connected", { userId: socket.id, userName });

    socket.on("disconnect", () => {
      console.log(`User Disconnected: ${socket.id}`);
      socket.to(roomId).emit("user-disconnected", socket.id);
    });

    // Relay WebRTC signaling messages
    socket.on("offer", ({ targetId, offer }) => {
      io.to(targetId).emit("offer", { senderId: socket.id, offer });
    });

    socket.on("answer", ({ targetId, answer }) => {
      io.to(targetId).emit("answer", { senderId: socket.id, answer });
    });

    socket.on("ice-candidate", ({ targetId, candidate }) => {
      io.to(targetId).emit("ice-candidate", { senderId: socket.id, candidate });
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
