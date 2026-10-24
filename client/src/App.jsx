import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users, MessageSquare } from 'lucide-react';

const SOCKET_SERVER_URL = 'http://localhost:5000';

export default function App() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [peers, setPeers] = useState({});
  
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef({});

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startMeeting = async (e) => {
    e.preventDefault();
    if (!roomId || !userName) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      socketRef.current = io(SOCKET_SERVER_URL);
      
      socketRef.current.emit('join-room', { roomId, userName });

      socketRef.current.on('user-connected', async ({ userId, userName: remoteName }) => {
        createPeerConnection(userId, remoteName, stream, true);
      });

      socketRef.current.on('offer', async ({ senderId, offer }) => {
        const pc = createPeerConnection(senderId, 'Participant', stream, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.emit('answer', { targetId: senderId, answer });
      });

      socketRef.current.on('answer', async ({ senderId, answer }) => {
        const pc = peersRef.current[senderId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      socketRef.current.on('ice-candidate', async ({ senderId, candidate }) => {
        const pc = peersRef.current[senderId];
        if (pc && candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socketRef.current.on('user-disconnected', (userId) => {
        if (peersRef.current[userId]) {
          peersRef.current[userId].close();
          delete peersRef.current[userId];
        }
        setPeers(prev => {
          const newPeers = { ...prev };
          delete newPeers[userId];
          return newPeers;
        });
      });

      setInRoom(true);
    } catch (err) {
      console.error('Failed to get media devices', err);
      alert('Camera or microphone permissions denied or unavailable.');
    }
  };

  const createPeerConnection = (userId, remoteName, stream, isInitiator) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { targetId: userId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      setPeers(prev => ({
        ...prev,
        [userId]: { stream: event.streams[0], name: remoteName }
      }));
    };

    if (isInitiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socketRef.current.emit('offer', { targetId: userId, offer });
      });
    }

    peersRef.current[userId] = pc;
    return pc;
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoMuted(!videoTrack.enabled);
      }
    }
  };

  const leaveCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    window.location.reload();
  };

  if (!inRoom) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <form onSubmit={startMeeting} className="bg-gray-800 p-8 rounded-xl shadow-2xl w-96 space-y-6 border border-gray-700">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-blue-400">Video Conferencing</h1>
            <p className="text-sm text-gray-400 mt-1">Join a secure meeting room</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase text-gray-400 font-semibold mb-1">Your Name</label>
              <input
                type="text"
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-xs uppercase text-gray-400 font-semibold mb-1">Room ID</label>
              <input
                type="text"
                required
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white"
                placeholder="room-123"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-white transition duration-200 shadow-lg"
          >
            Join Meeting
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden">
      {/* Top Header */}
      <header className="flex justify-between items-center px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center space-x-2">
          <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
          <span className="font-semibold text-gray-200">Room: {roomId}</span>
        </div>
        <div className="text-sm text-gray-400">Logged in as: <span className="text-white font-medium">{userName}</span></div>
      </header>

      {/* Video Grid Area */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 items-center justify-center overflow-y-auto">
        {/* Local Video */}
        <div className="relative bg-gray-900 rounded-xl overflow-hidden shadow-lg border border-gray-800 aspect-video flex items-center justify-center">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100" />
          <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-md text-xs font-medium text-white backdrop-blur-sm">
            {userName} (You) {isAudioMuted && ' (Muted)'}
          </div>
        </div>

        {/* Remote Peers */}
        {Object.entries(peers).map(([id, peer]) => (
          <div key={id} className="relative bg-gray-900 rounded-xl overflow-hidden shadow-lg border border-gray-800 aspect-video flex items-center justify-center">
            <video
              autoPlay
              playsInline
              ref={node => {
                if (node) node.srcObject = peer.stream;
              }}
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-md text-xs font-medium text-white backdrop-blur-sm">
              {peer.name}
            </div>
          </div>
        ))}
      </div>

      {/* Control Footer */}
      <footer className="flex justify-center items-center py-4 bg-gray-900 border-t border-gray-800 space-x-4">
        <button
          onClick={toggleAudio}
          className={`p-3 rounded-full ${isAudioMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'} text-white transition`}
          title={isAudioMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isAudioMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        <button
          onClick={toggleVideo}
          className={`p-3 rounded-full ${isVideoMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'} text-white transition`}
          title={isVideoMuted ? 'Start Video' : 'Stop Video'}
        >
          {isVideoMuted ? <VideoOff size={20} /> : <VideoVideoIcon={Video} />}
        </button>

        <button
          onClick={leaveCall}
          className="px-5 py-3 bg-red-600 hover:bg-red-700 rounded-full font-semibold text-white transition shadow-lg flex items-center space-x-2"
        >
          <PhoneOff size={20} />
          <span>Leave Room</span>
        </button>
      </footer>
    </div>
  );
}