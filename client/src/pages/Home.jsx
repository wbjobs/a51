import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'

const API_BASE = 'http://localhost:3001/api'

function Home() {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    title: '',
    organizer: '',
    participantCount: 5,
    startTime: '',
    endTime: '',
  })

  useEffect(() => {
    fetchMeetings()
  }, [])

  const fetchMeetings = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/meetings`)
      const data = await res.json()
      setMeetings(data)
    } catch (err) {
      console.error('获取会议列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'participantCount' ? parseInt(value) || 0 : value,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!formData.title || !formData.organizer || !formData.startTime || !formData.endTime) {
      setError('请填写所有必填字段')
      return
    }

    if (formData.participantCount < 1) {
      setError('参会人数至少为1人')
      return
    }

    try {
      const res = await fetch(`${API_BASE}/meetings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          startTime: new Date(formData.startTime).toISOString(),
          endTime: new Date(formData.endTime).toISOString(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || '预定失败')
      }

      setShowModal(false)
      setFormData({
        title: '',
        organizer: '',
        participantCount: 5,
        startTime: '',
        endTime: '',
      })
      fetchMeetings()
    } catch (err) {
      setError(err.message)
    }
  }

  const startMeeting = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/meetings/${id}/start`, {
        method: 'POST',
      })
      if (res.ok) {
        fetchMeetings()
        navigate(`/meeting/${id}`)
      }
    } catch (err) {
      console.error('开始会议失败:', err)
    }
  }

  const endMeeting = async (id) => {
    if (!confirm('确定要结束会议吗？结束后白板将变为只读状态。')) return

    try {
      const res = await fetch(`${API_BASE}/meetings/${id}/end`, {
        method: 'POST',
      })
      if (res.ok) {
        fetchMeetings()
      }
    } catch (err) {
      console.error('结束会议失败:', err)
    }
  }

  const getStatusText = (status) => {
    const map = {
      scheduled: '待开始',
      active: '进行中',
      ended: '已结束',
    }
    return map[status] || status
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

  return (
    <div className="home-container">
      <div className="page-header">
        <h1 className="page-title">会议列表</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + 预定会议
        </button>
      </div>

      {meetings.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-text">暂无会议，点击上方按钮预定一个吧</div>
        </div>
      ) : (
        <div className="meetings-grid">
          {meetings.map(meeting => (
            <div key={meeting.id} className={`meeting-card ${meeting.status}`}>
              <div className="meeting-title">{meeting.title}</div>
              <div className="meeting-info">
                <div className="meeting-info-item">
                  <span>📍</span>
                  <span>{meeting.room_name}（容纳{meeting.room_capacity}人）</span>
                </div>
                <div className="meeting-info-item">
                  <span>👤</span>
                  <span>组织者：{meeting.organizer}</span>
                </div>
                <div className="meeting-info-item">
                  <span>👥</span>
                  <span>{meeting.participant_count}人参会</span>
                </div>
                <div className="meeting-info-item">
                  <span>🕐</span>
                  <span>{formatDateTime(meeting.start_time)} - {formatDateTime(meeting.end_time)}</span>
                </div>
                <div>
                  <span className={`meeting-status status-${meeting.status}`}>
                    {getStatusText(meeting.status)}
                  </span>
                </div>
              </div>
              <div className="meeting-actions">
                {meeting.status === 'scheduled' && (
                  <button
                    className="btn-primary"
                    style={{ flex: 1, padding: '8px 16px', fontSize: '14px' }}
                    onClick={() => startMeeting(meeting.id)}
                  >
                    开始会议
                  </button>
                )}
                {meeting.status === 'active' && (
                  <>
                    <button
                      className="btn-secondary"
                      style={{ flex: 1, padding: '8px 16px', fontSize: '14px' }}
                      onClick={() => navigate(`/meeting/${meeting.id}`)}
                    >
                      进入白板
                    </button>
                    <button
                      className="btn-danger"
                      style={{ padding: '8px 16px', fontSize: '14px' }}
                      onClick={() => endMeeting(meeting.id)}
                    >
                      结束
                    </button>
                  </>
                )}
                {meeting.status === 'ended' && (
                  <button
                    className="btn-secondary"
                    style={{ flex: 1, padding: '8px 16px', fontSize: '14px' }}
                    onClick={() => navigate(`/meeting/${meeting.id}`)}
                  >
                    查看白板
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">预定会议室</h2>

            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">会议主题</label>
                <input
                  type="text"
                  name="title"
                  className="form-input"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="请输入会议主题"
                />
              </div>

              <div className="form-group">
                <label className="form-label">组织者</label>
                <input
                  type="text"
                  name="organizer"
                  className="form-input"
                  value={formData.organizer}
                  onChange={handleInputChange}
                  placeholder="请输入您的姓名"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">开始时间</label>
                  <input
                    type="datetime-local"
                    name="startTime"
                    className="form-input"
                    value={formData.startTime}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">结束时间</label>
                  <input
                    type="datetime-local"
                    name="endTime"
                    className="form-input"
                    value={formData.endTime}
                    onChange={handleInputChange}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">参会人数：{formData.participantCount}人</label>
                <input
                  type="range"
                  name="participantCount"
                  min="1"
                  max="20"
                  value={formData.participantCount}
                  onChange={handleInputChange}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  确认预定
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home
