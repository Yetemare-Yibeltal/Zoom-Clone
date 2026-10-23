const express = require("express");
const app = express();
const server = require("http").Server(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { v4: uuidv4 } = require("uuid");
const path = require("path");
// used to communicate with the server
const { ExpressPeerServer } = require("peer");
const peerServer = ExpressPeerServer(server, {
  debug: true,
});
app.use("/peerjs", peerServer);
// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "View"));

// Static files
app.use(express.static(path.join(__dirname, "Public")));

// Redirect to unique room
app.get("/", (req, res) => {
  res.redirect(`/${uuidv4()}`);
});

// Render room
app.get("/:room", (req, res) => {
  res.render("room", { roomId: req.params.room });
});

// Socket logic
io.on("connection", (socket) => {
  console.log("New socket connected:", socket.id);

  socket.on("join room", (roomId, userId) => {
    socket.join(roomId);
    socket.to(roomId).broadcast.emit("user-connected", userId);
    socket.roomId = roomId;
    socket.userId = userId;
  });
  socket.on("disconnect", () => {
    socket.to(roomId).broadcast.emit("user-disconnected", userId);
  });
});
// Start server
const PORT = process.env.PORT || 3000;



