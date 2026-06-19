import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { v4 as uuidv4 } from 'uuid'
import Whiteboard from '../components/Whiteboard'

const API_BASE = 'http://localhost:3001/api'
const SOCKET_URL = 'http://localhost:3001'

function MeetingRoom() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [meeting, setMeeting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [userCount, setUserCount] = useState(0)
  const [isReadOnly, setIsReadOnly] = useState(false)
  const [socketReady, setSocketReady] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const notifRef = useRef(null)
  const socketRef = useRef(null)
  const [userName] = useState(() => {
    const saved = localStorage.getItem('userName')
    return saved || `用户${Math.floor(Math.random() * 1000)}`
  })
  const userIdRef = useRef(uuidv4())
  const unreadCount = notifications.filter(n => !n.isRead).length

  useEffect(() => {
    fetchMeeting()
  }, [id])

  const fetchMeeting = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/meetings/${id}`)
      if (!res.ok) {
        throw new Error('会议不存在')
      }
      const data = await res.json()
      setMeeting(data)
      setIsReadOnly(data.status === 'ended')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!meeting) return

    const socket = io(SOCKET_URL, {
      withCredentials: true,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('join-meeting', {
        meetingId: id,
        userId: userIdRef.current,
        userName,
      })
      setSocketReady(true)
    })

    socket.on('user-count', ({ count }) => {
      setUserCount(count)
    })

    socket.on('online-users', ({ users }) => {
      setOnlineUsers(users)
    })

    socket.on('notification', (notif) => {
      setNotifications(prev => [notif, ...prev])
    })

    socket.on('notification-read', ({ notificationId }) => {
      setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n))
    })

    socket.on('all-notifications-read', () => {
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    })

    socket.on('whiteboard-init', (data) => {
      if (data.unreadNotifications) {
        setNotifications(data.unreadNotifications)
      }
      if (data.onlineUsers) {
        setOnlineUsers(data.onlineUsers)
      }
    })

    socket.on('error', (err) => {
      console.error('Socket错误:', err)
    })

    return () => {
      socket.disconnect()
      setSocketReady(false)
    }
  }, [meeting, id, userName])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const markAllRead = () => {
    if (socketRef.current) {
      socketRef.current.emit('mark-all-notifications-read')
    }
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
  }

  const endMeeting = async () => {
    if (!confirm('确定要结束会议吗？结束后白板将变为只读状态。')) return

    try {
      const res = await fetch(`${API_BASE}/meetings/${id}/end`, {
        method: 'POST',
      })
      if (res.ok) {
        setIsReadOnly(true)
        fetchMeeting()
      }
    } catch (err) {
      console.error('结束会议失败:', err)
    }
  }

  const formatDateTime = (dateStr) => {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return <div className="loading">加载中...</div>
  }

  if (error) {
    return (
      <div className="card">
        <div className="error-message">{error}</div>
        <button className="btn-secondary" onClick={() => navigate('/')}>
          返回会议列表
        </button>
      </div>
    )
  }

  return (
    <div className="meeting-room-container">
      <div className="meeting-header">
        <div className="meeting-header-left">
          <div className="meeting-header-title">{meeting.title}</div>
          <div className="meeting-header-info">
            <span>📍 {meeting.room_name}</span>
            <span>👤 {meeting.organizer}</span>
            <span>🕐 {formatDateTime(meeting.start_time)} - {formatDateTime(meeting.end_time)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="user-count-badge" title={onlineUsers.map(u => u.userName).join(', ')}>
            <span>👥</span>
            <span>{userCount} 人在线</span>
          </div>

          <div className="notification-wrapper" ref={notifRef}>
            <button
              className="notification-btn"
              onClick={() => setShowNotifications(!showNotifications)}
              title="通知"
            >
              🔔
              {unreadCount > 0 && (
                <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>

            {showNotifications && (
              <div className="notification-panel">
                <div className="notification-header">
                  <span>通知</span>
                  {unreadCount > 0 && (
                    <button className="notification-mark-all" onClick={markAllRead}>
                      全部已读
                    </button>
                  )}
                </div>
                <div className="notification-list">
                  {notifications.length === 0 ? (
                    <div className="notification-empty">暂无通知</div>
                  ) : (
                    notifications.map(n => (
                      <div
                        key={n.id}
                        className={`notification-item ${n.isRead ? 'read' : 'unread'}`}
                      >
                        <div className="notification-dot"></div>
                        <div className="notification-content">
                          <div className="notification-from">{n.fromUser}</div>
                          <div className="notification-text">{n.content}</div>
                          <div className="notification-time">
                            {new Date(n.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {isReadOnly && (
            <div className="read-only-badge">
              📋 已归档（只读）
            </div>
          )}
          {!isReadOnly && meeting.status === 'active' && (
            <button className="btn-danger" onClick={endMeeting}>
              结束会议
            </button>
          )}
          <button className="btn-secondary" onClick={() => navigate('/')}>
            返回
          </button>
        </div>
      </div>

      <div className="whiteboard-wrapper">
        {(socketReady || isReadOnly) ? (
          <Whiteboard
            socket={socketRef.current}
            meetingId={id}
            isReadOnly={isReadOnly}
            userName={userName}
            onlineUsers={onlineUsers}
          />
        ) : (
          <div className="loading">连接中...</div>
        )}
      </div>
    </div>
  )
}

export default MeetingRoom
