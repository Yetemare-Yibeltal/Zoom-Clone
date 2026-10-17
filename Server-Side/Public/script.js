const socket = io();
const peer = new Peer(undefined, {
  path: "/peerjs",
  host: "/",
  port: location.port || 3000,
});

const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
myVideo.muted = true;

let myVideoStream;
const peers = {}; // Track active peer connections

navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then((stream) => {
    myVideoStream = stream;
    addVideoStream(myVideo, stream);

    peer.on("call", (call) => {
      call.answer(stream);
      const video = document.createElement("video");
      call.on("stream", (userVideoStream) => {
        addVideoStream(video, userVideoStream);
      });
    });

    socket.on("user-connected", (userId) => {
      setTimeout(() => {
        connectToNewUser(userId, stream);
      }, 1000);
    });

    socket.on("user-disconnected", (userId) => {
      if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
      }
    });

    peer.on("open", (id) => {
      socket.emit("join room", ROOM_ID, id);
    });
  });

function connectToNewUser(userId, stream) {
  const call = peer.call(userId, stream);
  const video = document.createElement("video");

  call.on("stream", (userVideoStream) => {
    addVideoStream(video, userVideoStream);
  });

  call.on("close", () => {
    video.remove();
  });

  peers[userId] = call;
}

function addVideoStream(video, stream) {
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play();
  });
  videoGrid.append(video);
}