import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Users,
  Copy
} from 'lucide-react'
import './App.css'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

export default function App () {
  const [roomId, setRoomId] = useState('')
  const [userName, setUserName] = useState('')
  const [joined, setJoined] = useState(false)
  const [participants, setParticipants] = useState({})
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [status, setStatus] = useState('Enter a room to start')

  const localVideoRef = useRef(null)
  const localStreamRef = useRef(null)
  const socketRef = useRef(null)
  const peersRef = useRef({})
  const candidatesRef = useRef({})
  const namesRef = useRef({})
  const joiningRef = useRef(false)

  const createPeer = useCallback(peerId => {
    if (peersRef.current[peerId]) {
      return peersRef.current[peerId]
    }

    const socket = socketRef.current
    const stream = localStreamRef.current
    if (!socket || !stream) throw new Error('Meeting is not ready')

    const pc = new RTCPeerConnection(ICE_SERVERS)
    peersRef.current[peerId] = pc
    candidatesRef.current[peerId] = []

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream)
    })

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          targetId: peerId,
          candidate
        })
      }
    }

    pc.ontrack = ({ streams }) => {
      if (!streams[0]) return

      setParticipants(current => ({
        ...current,
        [peerId]: {
          name: namesRef.current[peerId] || 'Participant',
          stream: streams[0]
        }
      }))
    }

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        pc.close()
        delete peersRef.current[peerId]
        delete candidatesRef.current[peerId]
        setParticipants(current => {
          const next = { ...current }
          delete next[peerId]
          return next
        })
      }
    }

    return pc
  }, [])

  const flushCandidates = useCallback(async (peerId, pc) => {
    const queued = candidatesRef.current[peerId] || []
    candidatesRef.current[peerId] = []

    for (const candidate of queued) {
      await pc.addIceCandidate(candidate)
    }
  }, [])

  const makeOffer = useCallback(
    async peerId => {
      const pc = createPeer(peerId)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      socketRef.current.emit('offer', {
        targetId: peerId,
        offer: pc.localDescription
      })
    },
    [createPeer]
  )

  const leaveMeeting = useCallback(() => {
    joiningRef.current = false

    Object.values(peersRef.current).forEach(pc => pc.close())
    peersRef.current = {}
    candidatesRef.current = {}
    namesRef.current = {}

    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }

    setParticipants({})
    setJoined(false)
    setMuted(false)
    setCameraOff(false)
    setStatus('You left the meeting')
  }, [])

  useEffect(() => {
    return () => {
      Object.values(peersRef.current).forEach(pc => pc.close())
      socketRef.current?.disconnect()
      localStreamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  const joinMeeting = async event => {
    event.preventDefault()
    if (joiningRef.current) return

    const cleanName = userName.trim()
    const cleanRoom = roomId.trim()

    if (!cleanName || !cleanRoom) {
      setStatus('Enter your name and a room ID.')
      return
    }

    joiningRef.current = true
    setStatus('Connecting to your camera and microphone...')

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires HTTPS or localhost.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      })

      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      const socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling']
      })
      socketRef.current = socket

      socket.on('connect', () => {
        socket.emit('join-room', {
          roomId: cleanRoom,
          userName: cleanName
        })
      })

      socket.on('room-users', async (users = []) => {
        for (const user of users) {
          if (user.userId === socket.id) continue
          namesRef.current[user.userId] = user.userName
          setParticipants(current => ({
            ...current,
            [user.userId]: {
              name: user.userName,
              stream: current[user.userId]?.stream || null
            }
          }))

          try {
            await makeOffer(user.userId)
          } catch (error) {
            console.error('Could not start peer connection:', error)
          }
        }

        setJoined(true)
        setStatus('Connected to meeting')
      })

      socket.on('user-connected', ({ userId, userName: name }) => {
        namesRef.current[userId] = name || 'Participant'
        setParticipants(current => ({
          ...current,
          [userId]: {
            name: name || 'Participant',
            stream: current[userId]?.stream || null
          }
        }))
      })

      socket.on('offer', async ({ senderId, offer }) => {
        try {
          const pc = createPeer(senderId)
          await pc.setRemoteDescription(offer)
          await flushCandidates(senderId, pc)

          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)

          socket.emit('answer', {
            targetId: senderId,
            answer: pc.localDescription
          })
        } catch (error) {
          console.error('Could not process WebRTC offer:', error)
        }
      })

      socket.on('answer', async ({ senderId, answer }) => {
        try {
          const pc = peersRef.current[senderId]
          if (pc && !pc.remoteDescription) {
            await pc.setRemoteDescription(answer)
            await flushCandidates(senderId, pc)
          }
        } catch (error) {
          console.error('Could not process WebRTC answer:', error)
        }
      })

      socket.on('ice-candidate', async ({ senderId, candidate }) => {
        try {
          const pc = peersRef.current[senderId]
          if (!pc || !pc.remoteDescription) {
            ;(candidatesRef.current[senderId] ||= []).push(candidate)
            return
          }
          await pc.addIceCandidate(candidate)
        } catch (error) {
          console.error('Could not add ICE candidate:', error)
        }
      })

      socket.on('user-disconnected', peerId => {
        peersRef.current[peerId]?.close()
        delete peersRef.current[peerId]
        delete candidatesRef.current[peerId]
        delete namesRef.current[peerId]

        setParticipants(current => {
          const next = { ...current }
          delete next[peerId]
          return next
        })
      })

      socket.on('connect_error', error => {
        setStatus(`Server connection failed: ${error.message}`)
      })

      socket.on('error-message', message => {
        setStatus(message)
      })

      setRoomId(cleanRoom)
      setUserName(cleanName)
    } catch (error) {
      localStreamRef.current?.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
      joiningRef.current = false
      setStatus(error.message || 'Could not access camera or microphone.')
    }
  }

  const toggleMicrophone = () => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setCameraOff(!track.enabled)
  }

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
      setStatus('Room ID copied')
    } catch {
      setStatus(`Room ID: ${roomId}`)
    }
  }

  if (!joined) {
    return (
      <main className='join-page'>
        <form className='join-card' onSubmit={joinMeeting}>
          <div className='brand-mark'>Z</div>
          <p className='eyebrow'>VIDEO CONFERENCING</p>
          <h1>Meet face to face.</h1>
          <p className='muted'>Enter your details to join a video meeting.</p>

          <label htmlFor='userName'>Your name</label>
          <input
            id='userName'
            autoComplete='name'
            value={userName}
            onChange={event => setUserName(event.target.value)}
            placeholder='Enter your name'
            required
          />

          <label htmlFor='roomId'>Meeting room ID</label>
          <input
            id='roomId'
            value={roomId}
            onChange={event => setRoomId(event.target.value)}
            placeholder='Enter or create a room ID'
            required
          />

          <button className='primary-button' type='submit'>
            Join meeting
          </button>
          <p className='status-message' role='status'>
            {status}
          </p>
        </form>
      </main>
    )
  }

  return (
    <main className='meeting-page'>
      <header className='meeting-header'>
        <div>
          <div className='meeting-brand'>Zoom Clone</div>
          <span className='meeting-subtitle'>Live meeting</span>
        </div>
        <button className='room-id-button' onClick={copyRoomId} type='button'>
          Room: {roomId} <Copy size={15} />
        </button>
      </header>

      <section className='video-grid' aria-label='Meeting participants'>
        <article className='video-tile'>
          <video ref={localVideoRef} autoPlay playsInline muted />
          <span className='participant-label'>
            {userName} (You){muted ? ' · Muted' : ''}
          </span>
        </article>

        {Object.entries(participants).map(([id, participant]) => (
          <article className='video-tile' key={id}>
            {participant.stream ? (
              <video
                autoPlay
                playsInline
                ref={node => {
                  if (node && node.srcObject !== participant.stream) {
                    node.srcObject = participant.stream
                  }
                }}
              />
            ) : (
              <div className='waiting-tile'>
                <Users size={30} />
                <span>Connecting video...</span>
              </div>
            )}
            <span className='participant-label'>{participant.name}</span>
          </article>
        ))}
      </section>

      <footer className='meeting-footer'>
        <div className='control-group'>
          <button
            className={`control-button ${muted ? 'control-off' : ''}`}
            onClick={toggleMicrophone}
            title={muted ? 'Unmute microphone' : 'Mute microphone'}
            type='button'
          >
            {muted ? <MicOff /> : <Mic />}
            <span>{muted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button
            className={`control-button ${cameraOff ? 'control-off' : ''}`}
            onClick={toggleCamera}
            title={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            type='button'
          >
            {cameraOff ? <VideoOff /> : <Video />}
            <span>{cameraOff ? 'Start video' : 'Stop video'}</span>
          </button>
          <button
            className='control-button leave-button'
            onClick={leaveMeeting}
            type='button'
          >
            <PhoneOff />
            <span>Leave</span>
          </button>
        </div>
        <p className='meeting-status' role='status'>
          {status}
        </p>
      </footer>
    </main>
  )
}
