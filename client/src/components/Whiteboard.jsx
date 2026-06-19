import { useState, useEffect, useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'

const TOOLS = {
  PEN: 'pen',
  LINE: 'line',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  TEXT: 'text',
  STICKY: 'sticky',
  IMAGE: 'image',
  MENTION: 'mention',
  ERASER: 'eraser',
  SELECT: 'select',
}

const COLORS = ['#1a1a2e', '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6']
const STICKY_COLORS = ['#fff59d', '#f8bbd0', '#90caf9', '#a5d6a7']
const STROKE_WIDTHS = [2, 4, 6, 8]

const API_BASE = 'http://localhost:3001/api'

function Whiteboard({ socket, meetingId, isReadOnly, userName, onlineUsers = [] }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const fileInputRef = useRef(null)
  const [tool, setTool] = useState(TOOLS.PEN)
  const [color, setColor] = useState('#1a1a2e')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0])
  const [elements, setElements] = useState([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentPath, setCurrentPath] = useState(null)
  const [startPoint, setStartPoint] = useState(null)
  const [selectedElement, setSelectedElement] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [resizing, setResizing] = useState(null)
  const [resizeStart, setResizeStart] = useState(null)
  const [showMentionPicker, setShowMentionPicker] = useState(false)
  const [mentionTargetId, setMentionTargetId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const elementsRef = useRef([])
  const serverVersionRef = useRef(0)
  const initializedRef = useRef(false)
  const processedOpIdsRef = useRef(new Set())
  const pendingLocalOpsRef = useRef(new Map())

  useEffect(() => {
    elementsRef.current = elements
  }, [elements])

  useEffect(() => {
    if (!socket) return

    const handleInit = (data) => {
      const serverElements = data.elements || []
      serverVersionRef.current = data.serverVersion || 0

      if (initializedRef.current) {
        setElements(prev => {
          const localIds = new Set(prev.map(el => el.id))
          const serverIds = new Set(serverElements.map(el => el.id))
          const merged = [
            ...prev.filter(el => !serverIds.has(el.id)),
            ...serverElements,
          ]
          elementsRef.current = merged
          return merged
        })
        return
      }

      initializedRef.current = true
      setElements(serverElements)
      elementsRef.current = serverElements
    }

    const handleAdd = ({ opId, element, version }) => {
      if (opId && processedOpIdsRef.current.has(opId)) {
        return
      }
      if (opId) {
        processedOpIdsRef.current.add(opId)
      }
      if (version !== undefined) {
        serverVersionRef.current = Math.max(serverVersionRef.current, version)
      }

      setElements(prev => {
        if (prev.some(el => el.id === element.id)) {
          return prev
        }
        const next = [...prev, element]
        return next
      })
    }

    const handleUpdate = ({ opId, element, version }) => {
      if (opId && processedOpIdsRef.current.has(opId)) {
        return
      }
      if (opId) {
        processedOpIdsRef.current.add(opId)
      }
      if (version !== undefined) {
        serverVersionRef.current = Math.max(serverVersionRef.current, version)
      }

      setElements(prev => {
        const idx = prev.findIndex(el => el.id === element.id)
        if (idx === -1) return prev
        const next = [...prev]
        next[idx] = element
        return next
      })
    }

    const handleDelete = ({ opId, elementId, version }) => {
      if (opId && processedOpIdsRef.current.has(opId)) {
        return
      }
      if (opId) {
        processedOpIdsRef.current.add(opId)
      }
      if (version !== undefined) {
        serverVersionRef.current = Math.max(serverVersionRef.current, version)
      }

      setElements(prev => prev.filter(el => el.id !== elementId))
    }

    const handleClear = ({ opId, version }) => {
      if (opId && processedOpIdsRef.current.has(opId)) {
        return
      }
      if (opId) {
        processedOpIdsRef.current.add(opId)
      }
      if (version !== undefined) {
        serverVersionRef.current = Math.max(serverVersionRef.current, version)
      }
      initializedRef.current = true
      setElements([])
    }

    const handleAck = ({ opId, elementId, version }) => {
      if (version !== undefined) {
        serverVersionRef.current = Math.max(serverVersionRef.current, version)
      }
      pendingLocalOpsRef.current.delete(opId)
    }

    socket.on('whiteboard-init', handleInit)
    socket.on('whiteboard-add', handleAdd)
    socket.on('whiteboard-update', handleUpdate)
    socket.on('whiteboard-delete', handleDelete)
    socket.on('whiteboard-clear', handleClear)
    socket.on('whiteboard-add-ack', handleAck)
    socket.on('whiteboard-update-ack', handleAck)
    socket.on('whiteboard-delete-ack', handleAck)
    socket.on('whiteboard-clear-ack', handleAck)

    return () => {
      socket.off('whiteboard-init', handleInit)
      socket.off('whiteboard-add', handleAdd)
      socket.off('whiteboard-update', handleUpdate)
      socket.off('whiteboard-delete', handleDelete)
      socket.off('whiteboard-clear', handleClear)
      socket.off('whiteboard-add-ack', handleAck)
      socket.off('whiteboard-update-ack', handleAck)
      socket.off('whiteboard-delete-ack', handleAck)
      socket.off('whiteboard-clear-ack', handleAck)
    }
  }, [socket])

  useEffect(() => {
    redrawCanvas()
  }, [elements, currentPath, startPoint, tool, color, strokeWidth])

  useEffect(() => {
    const resizeCanvas = () => {
      if (!canvasRef.current || !containerRef.current) return
      const canvas = canvasRef.current
      const container = containerRef.current
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
      redrawCanvas()
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [])

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const currentElements = elementsRef.current

    currentElements.forEach(el => {
      if (el.type === 'pen' || el.type === 'line') {
        if (!el.points || el.points.length < 2) return

        ctx.beginPath()
        ctx.strokeStyle = el.color
        ctx.lineWidth = el.strokeWidth
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        ctx.moveTo(el.points[0].x, el.points[0].y)
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.points[i].x, el.points[i].y)
        }
        ctx.stroke()
      } else if (el.type === 'rectangle') {
        ctx.strokeStyle = el.color
        ctx.lineWidth = el.strokeWidth
        ctx.strokeRect(el.x, el.y, el.width, el.height)
      } else if (el.type === 'circle') {
        ctx.strokeStyle = el.color
        ctx.lineWidth = el.strokeWidth
        ctx.beginPath()
        ctx.ellipse(
          el.x + el.width / 2,
          el.y + el.height / 2,
          Math.abs(el.width / 2),
          Math.abs(el.height / 2),
          0, 0, 2 * Math.PI
        )
        ctx.stroke()
      } else if (el.type === 'image' && el.imageUrl) {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.src = el.imageUrl.startsWith('http') ? el.imageUrl : `http://localhost:3001${el.imageUrl}`
        const scale = el.scale || 1
        const w = (el.width || 200) * scale
        const h = (el.height || 150) * scale
        if (img.complete) {
          ctx.drawImage(img, el.x, el.y, w, h)
        } else {
          img.onload = () => {
            ctx.drawImage(img, el.x, el.y, w, h)
          }
        }
      }
    })

    if (currentPath) {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = strokeWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (currentPath.points.length >= 2) {
        ctx.moveTo(currentPath.points[0].x, currentPath.points[0].y)
        for (let i = 1; i < currentPath.points.length; i++) {
          ctx.lineTo(currentPath.points[i].x, currentPath.points[i].y)
        }
      }
      ctx.stroke()
    }

    if (startPoint && (tool === TOOLS.RECTANGLE || tool === TOOLS.CIRCLE)) {
      ctx.strokeStyle = color
      ctx.lineWidth = strokeWidth
      ctx.setLineDash([5, 5])

      const endPoint = currentPath ? currentPath.points[currentPath.points.length - 1] : startPoint
      const x = Math.min(startPoint.x, endPoint.x)
      const y = Math.min(startPoint.y, endPoint.y)
      const w = Math.abs(endPoint.x - startPoint.x)
      const h = Math.abs(endPoint.y - startPoint.y)

      if (tool === TOOLS.RECTANGLE) {
        ctx.strokeRect(x, y, w, h)
      } else if (tool === TOOLS.CIRCLE) {
        ctx.beginPath()
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI)
        ctx.stroke()
      }

      ctx.setLineDash([])
    }
  }, [currentPath, startPoint, tool, color, strokeWidth])

  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  const emitWithOpId = (eventName, payload) => {
    const opId = uuidv4()
    processedOpIdsRef.current.add(opId)
    pendingLocalOpsRef.current.set(opId, payload)
    socket.emit(eventName, { opId, ...payload })
    return opId
  }

  const handleCanvasMouseDown = (e) => {
    if (isReadOnly) return

    const point = getCanvasPoint(e)

    if (tool === TOOLS.PEN) {
      setIsDrawing(true)
      setCurrentPath({
        id: uuidv4(),
        type: 'pen',
        points: [point],
        color,
        strokeWidth,
      })
    } else if (tool === TOOLS.LINE) {
      setIsDrawing(true)
      setStartPoint(point)
      setCurrentPath({
        id: uuidv4(),
        type: 'line',
        points: [point, point],
        color,
        strokeWidth,
      })
    } else if (tool === TOOLS.RECTANGLE || tool === TOOLS.CIRCLE) {
      setIsDrawing(true)
      setStartPoint(point)
      setCurrentPath({
        id: uuidv4(),
        points: [point],
      })
    } else if (tool === TOOLS.ERASER) {
      eraseAtPoint(point)
    } else if (tool === TOOLS.MENTION) {
      setMentionTargetId(null)
      setShowMentionPicker(true)
    }
  }

  const handleCanvasMouseMove = (e) => {
    if (isReadOnly) return

    const point = getCanvasPoint(e)

    if (tool === TOOLS.ERASER && isDrawing) {
      eraseAtPoint(point)
      return
    }

    if (!isDrawing || !currentPath) return

    if (tool === TOOLS.PEN) {
      setCurrentPath(prev => ({
        ...prev,
        points: [...prev.points, point],
      }))
    } else if (tool === TOOLS.LINE) {
      setCurrentPath(prev => ({
        ...prev,
        points: [prev.points[0], point],
      }))
    } else if (tool === TOOLS.RECTANGLE || tool === TOOLS.CIRCLE) {
      setCurrentPath(prev => ({
        ...prev,
        points: [prev.points[0], point],
      }))
    }
  }

  const handleCanvasMouseUp = () => {
    if (isReadOnly) return

    if (!isDrawing || !currentPath) {
      setIsDrawing(false)
      return
    }

    if (tool === TOOLS.PEN || tool === TOOLS.LINE) {
      if (currentPath.points.length >= 2) {
        const newElement = {
          id: currentPath.id,
          type: currentPath.type,
          x: currentPath.points[0].x,
          y: currentPath.points[0].y,
          points: currentPath.points,
          color,
          strokeWidth,
          createdBy: userName,
          mentionedUsers: [],
        }

        setElements(prev => {
          if (prev.some(el => el.id === newElement.id)) return prev
          return [...prev, newElement]
        })

        if (socket) {
          emitWithOpId('whiteboard-add', { element: newElement })
        }
      }
    } else if (tool === TOOLS.RECTANGLE || tool === TOOLS.CIRCLE) {
      const endPoint = currentPath.points[currentPath.points.length - 1]
      const x = Math.min(startPoint.x, endPoint.x)
      const y = Math.min(startPoint.y, endPoint.y)
      const w = Math.abs(endPoint.x - startPoint.x)
      const h = Math.abs(endPoint.y - startPoint.y)

      if (w > 5 && h > 5) {
        const newElement = {
          id: currentPath.id,
          type: tool,
          x,
          y,
          width: w,
          height: h,
          color,
          strokeWidth,
          createdBy: userName,
          mentionedUsers: [],
        }

        setElements(prev => {
          if (prev.some(el => el.id === newElement.id)) return prev
          return [...prev, newElement]
        })

        if (socket) {
          emitWithOpId('whiteboard-add', { element: newElement })
        }
      }
    }

    setIsDrawing(false)
    setCurrentPath(null)
    setStartPoint(null)
  }

  const eraseAtPoint = (point) => {
    const eraseRadius = 15
    const elementsToRemove = []
    const currentEls = elementsRef.current

    currentEls.forEach(el => {
      if (el.type === 'pen' || el.type === 'line') {
        for (const p of el.points) {
          const dist = Math.sqrt((p.x - point.x) ** 2 + (p.y - point.y) ** 2)
          if (dist < eraseRadius) {
            elementsToRemove.push(el.id)
            break
          }
        }
      } else if (el.type === 'rectangle' || el.type === 'circle' || el.type === 'image') {
        const w = el.type === 'image' ? (el.width || 200) * (el.scale || 1) : el.width
        const h = el.type === 'image' ? (el.height || 150) * (el.scale || 1) : el.height
        if (point.x >= el.x - eraseRadius && point.x <= el.x + w + eraseRadius &&
            point.y >= el.y - eraseRadius && point.y <= el.y + h + eraseRadius) {
          elementsToRemove.push(el.id)
        }
      }
    })

    if (elementsToRemove.length > 0) {
      setElements(prev => prev.filter(el => !elementsToRemove.includes(el.id)))

      if (socket) {
        elementsToRemove.forEach(id => {
          emitWithOpId('whiteboard-delete', { elementId: id })
        })
      }
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || isReadOnly) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('image', file)

      const res = await fetch(`${API_BASE}/uploads/image`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('上传失败')
      const data = await res.json()

      const img = new window.Image()
      img.src = data.url.startsWith('http') ? data.url : `http://localhost:3001${data.url}`

      img.onload = () => {
        const aspectRatio = img.width / img.height
        const maxW = 300
        const maxH = 300
        let w = img.width
        let h = img.height
        if (w > maxW) {
          w = maxW
          h = w / aspectRatio
        }
        if (h > maxH) {
          h = maxH
          w = h * aspectRatio
        }

        const newElement = {
          id: uuidv4(),
          type: 'image',
          x: 100 + Math.random() * 100,
          y: 100 + Math.random() * 100,
          width: w,
          height: h,
          imageUrl: data.url,
          scale: 1,
          createdBy: userName,
          mentionedUsers: [],
        }

        setElements(prev => {
          if (prev.some(el => el.id === newElement.id)) return prev
          return [...prev, newElement]
        })

        if (socket) {
          emitWithOpId('whiteboard-add', { element: newElement })
        }
      }
    } catch (err) {
      console.error('图片上传失败:', err)
      alert('图片上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const addStickyNote = () => {
    if (isReadOnly) return

    const newElement = {
      id: uuidv4(),
      type: 'sticky',
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      width: 150,
      height: 120,
      color: stickyColor,
      text: '',
      createdBy: userName,
      mentionedUsers: [],
    }

    setElements(prev => {
      if (prev.some(el => el.id === newElement.id)) return prev
      return [...prev, newElement]
    })

    if (socket) {
      emitWithOpId('whiteboard-add', { element: newElement })
    }
  }

  const addTextElement = () => {
    if (isReadOnly) return

    const newElement = {
      id: uuidv4(),
      type: 'text',
      x: 150 + Math.random() * 200,
      y: 150 + Math.random() * 200,
      width: 200,
      height: 40,
      color,
      text: '双击编辑文字',
      createdBy: userName,
      mentionedUsers: [],
    }

    setElements(prev => {
      if (prev.some(el => el.id === newElement.id)) return prev
      return [...prev, newElement]
    })

    if (socket) {
      emitWithOpId('whiteboard-add', { element: newElement })
    }
  }

  const updateElement = (element) => {
    setElements(prev => {
      const idx = prev.findIndex(el => el.id === element.id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = element
      return next
    })

    if (socket) {
      emitWithOpId('whiteboard-update', {
        element,
        baseVersion: serverVersionRef.current,
      })
    }
  }

  const deleteElement = (elementId) => {
    setElements(prev => prev.filter(el => el.id !== elementId))

    if (socket) {
      emitWithOpId('whiteboard-delete', { elementId })
    }
  }

  const clearBoard = () => {
    if (isReadOnly) return
    if (!confirm('确定要清空白板吗？此操作不可撤销。')) return

    setElements([])

    if (socket) {
      emitWithOpId('whiteboard-clear', {})
    }
  }

  const handleImageMouseDown = (e, element) => {
    if (isReadOnly) return
    e.preventDefault()
    e.stopPropagation()

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const scale = element.scale || 1
    const w = (element.width || 200) * scale
    const h = (element.height || 150) * scale

    if (x >= w - 15 && y >= h - 15) {
      setResizing(element.id)
      setResizeStart({
        startX: e.clientX,
        startY: e.clientY,
        startScale: scale,
        startWidth: element.width || 200,
        startHeight: element.height || 150,
      })
    } else {
      setDragging(element.id)
      setDragOffset({ x, y })
    }
    setSelectedElement(element.id)
  }

  const handleContainerMouseMove = (e) => {
    if (!dragging && !resizing) return
    if (isReadOnly) return

    const container = containerRef.current
    const rect = container.getBoundingClientRect()

    if (resizing) {
      const element = elementsRef.current.find(el => el.id === resizing)
      if (element && resizeStart) {
        const dx = e.clientX - resizeStart.startX
        const dy = e.clientY - resizeStart.startY
        const delta = Math.max(dx, dy)
        const newScale = Math.max(0.2, Math.min(5, resizeStart.startScale + delta / 200))
        const updated = { ...element, scale: newScale }
        setElements(prev => prev.map(el => el.id === resizing ? updated : el))
      }
    } else if (dragging) {
      const x = e.clientX - rect.left - dragOffset.x
      const y = e.clientY - rect.top - dragOffset.y
      const element = elementsRef.current.find(el => el.id === dragging)
      if (element) {
        const updated = { ...element, x: Math.max(0, x), y: Math.max(0, y) }
        setElements(prev => prev.map(el => el.id === dragging ? updated : el))
      }
    }
  }

  const handleContainerMouseUp = () => {
    if (resizing) {
      const element = elementsRef.current.find(el => el.id === resizing)
      if (element && socket) {
        emitWithOpId('whiteboard-update', {
          element,
          baseVersion: serverVersionRef.current,
        })
      }
      setResizing(null)
      setResizeStart(null)
    } else if (dragging) {
      const element = elementsRef.current.find(el => el.id === dragging)
      if (element && socket) {
        emitWithOpId('whiteboard-update', {
          element,
          baseVersion: serverVersionRef.current,
        })
      }
      setDragging(null)
    }
  }

  const handleStickyMouseDown = (e, element) => {
    if (isReadOnly) return
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return

    e.preventDefault()
    setDragging(element.id)
    const rect = e.currentTarget.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
    setSelectedElement(element.id)
  }

  const handleTextMouseDown = (e, element) => {
    if (isReadOnly) return
    if (e.target.tagName === 'INPUT' || e.target.contentEditable === 'true') return

    e.preventDefault()
    setDragging(element.id)
    const rect = e.currentTarget.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
    setSelectedElement(element.id)
  }

  const handleMentionSelect = (mentionedUserName) => {
    if (!selectedElement && !mentionTargetId) {
      const newNote = {
        id: uuidv4(),
        type: 'sticky',
        x: 150 + Math.random() * 100,
        y: 150 + Math.random() * 100,
        width: 180,
        height: 120,
        color: '#f8bbd0',
        text: `@${mentionedUserName} 请注意查看`,
        createdBy: userName,
        mentionedUsers: [mentionedUserName],
      }
      setElements(prev => {
        if (prev.some(el => el.id === newNote.id)) return prev
        return [...prev, newNote]
      })
      if (socket) {
        emitWithOpId('whiteboard-add', { element: newNote })
      }
    } else {
      const targetId = mentionTargetId || selectedElement
      const element = elementsRef.current.find(el => el.id === targetId)
      if (element) {
        const existingMentions = element.mentionedUsers || []
        if (!existingMentions.includes(mentionedUserName)) {
          const updated = {
            ...element,
            mentionedUsers: [...existingMentions, mentionedUserName],
          }
          updateElement(updated)
        }
      }
    }
    setShowMentionPicker(false)
    setMentionTargetId(null)
  }

  const imageElements = elements.filter(el => el.type === 'image')
  const stickyElements = elements.filter(el => el.type === 'sticky')
  const textElements = elements.filter(el => el.type === 'text')

  const otherUsers = onlineUsers.filter(u => u.userName !== userName)

  return (
    <div
      ref={containerRef}
      className="whiteboard-canvas-container"
      onMouseMove={handleContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onMouseLeave={handleContainerMouseUp}
    >
      <div className="whiteboard-toolbar">
        <button
          className={`tool-btn ${tool === TOOLS.PEN ? 'active' : ''}`}
          onClick={() => setTool(TOOLS.PEN)}
          title="画笔"
          disabled={isReadOnly}
        >
          ✏️
        </button>
        <button
          className={`tool-btn ${tool === TOOLS.LINE ? 'active' : ''}`}
          onClick={() => setTool(TOOLS.LINE)}
          title="直线"
          disabled={isReadOnly}
        >
          📏
        </button>
        <button
          className={`tool-btn ${tool === TOOLS.RECTANGLE ? 'active' : ''}`}
          onClick={() => setTool(TOOLS.RECTANGLE)}
          title="矩形"
          disabled={isReadOnly}
        >
          ⬜
        </button>
        <button
          className={`tool-btn ${tool === TOOLS.CIRCLE ? 'active' : ''}`}
          onClick={() => setTool(TOOLS.CIRCLE)}
          title="圆形"
          disabled={isReadOnly}
        >
          ⭕
        </button>
        <button
          className={`tool-btn ${tool === TOOLS.ERASER ? 'active' : ''}`}
          onClick={() => setTool(TOOLS.ERASER)}
          title="橡皮擦"
          disabled={isReadOnly}
        >
          🧹
        </button>

        <div className="tool-divider" />

        <button
          className={`tool-btn ${tool === TOOLS.TEXT ? 'active' : ''}`}
          onClick={() => {
            setTool(TOOLS.TEXT)
            addTextElement()
          }}
          title="文字"
          disabled={isReadOnly}
        >
          🅰️
        </button>
        <button
          className={`tool-btn ${tool === TOOLS.STICKY ? 'active' : ''}`}
          onClick={() => {
            setTool(TOOLS.STICKY)
            addStickyNote()
          }}
          title="便签"
          disabled={isReadOnly}
        >
          📝
        </button>
        <button
          className={`tool-btn ${tool === TOOLS.IMAGE ? 'active' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          title="上传图片"
          disabled={isReadOnly || uploading}
        >
          🖼️
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
        <button
          className={`tool-btn ${tool === TOOLS.MENTION ? 'active' : ''}`}
          onClick={() => {
            setTool(TOOLS.MENTION)
            setShowMentionPicker(true)
          }}
          title="@提醒"
          disabled={isReadOnly}
        >
          @
        </button>

        <div className="tool-divider" />

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {COLORS.map(c => (
            <button
              key={c}
              className={`color-picker ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              disabled={isReadOnly}
            />
          ))}
        </div>

        <div className="tool-divider" />

        <select
          className="stroke-width-select"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          disabled={isReadOnly}
        >
          {STROKE_WIDTHS.map(w => (
            <option key={w} value={w}>{w}px</option>
          ))}
        </select>

        <div className="tool-divider" />

        {tool === TOOLS.STICKY && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {STICKY_COLORS.map(c => (
              <button
                key={c}
                className={`color-picker ${stickyColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setStickyColor(c)}
              />
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button
          className="tool-btn"
          onClick={clearBoard}
          title="清空白板"
          disabled={isReadOnly}
          style={{ color: '#e74c3c' }}
        >
          🗑️
        </button>
      </div>

      {showMentionPicker && (
        <div className="mention-picker">
          <div className="mention-picker-header">选择要@的人</div>
          {otherUsers.length === 0 ? (
            <div className="mention-empty">暂无其他在线用户</div>
          ) : (
            otherUsers.map(u => (
              <div
                key={u.userId}
                className="mention-user-item"
                onClick={() => handleMentionSelect(u.userName)}
              >
                <span className="mention-user-avatar">👤</span>
                <span className="mention-user-name">{u.userName}</span>
              </div>
            ))
          )}
          <div className="mention-picker-footer">
            <button onClick={() => { setShowMentionPicker(false); setMentionTargetId(null) }}>
              取消
            </button>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="whiteboard-canvas"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        style={{ cursor: isReadOnly ? 'default' : tool === TOOLS.ERASER ? 'cell' : 'crosshair' }}
      />

      {imageElements.map(element => {
        const scale = element.scale || 1
        const w = (element.width || 200) * scale
        const h = (element.height || 150) * scale
        return (
          <div
            key={element.id}
            className={`whiteboard-image ${selectedElement === element.id ? 'selected' : ''}`}
            style={{
              left: element.x,
              top: element.y,
              width: w,
              height: h,
              border: selectedElement === element.id ? '2px dashed #667eea' : 'none',
            }}
            onMouseDown={(e) => handleImageMouseDown(e, element)}
          >
            <img
              src={element.imageUrl?.startsWith('http') ? element.imageUrl : `http://localhost:3001${element.imageUrl}`}
              alt=""
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
            />
            {!isReadOnly && selectedElement === element.id && (
              <>
                <div className="resize-handle resize-handle-br" />
                <button
                  className="sticky-note-delete"
                  onClick={(e) => { e.stopPropagation(); deleteElement(element.id) }}
                  title="删除图片"
                >
                  ✕
                </button>
                <button
                  className="mention-on-element"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMentionTargetId(element.id)
                    setShowMentionPicker(true)
                  }}
                  title="@提醒他人"
                >
                  @
                </button>
              </>
            )}
            {element.mentionedUsers && element.mentionedUsers.length > 0 && (
              <div className="element-mention-badge">
                @{element.mentionedUsers.length}
              </div>
            )}
          </div>
        )
      })}

      {textElements.map(element => (
        <TextElement
          key={element.id}
          element={element}
          isReadOnly={isReadOnly}
          isSelected={selectedElement === element.id}
          onMouseDown={(e) => handleTextMouseDown(e, element)}
          onUpdate={updateElement}
          onDelete={deleteElement}
          onMention={() => { setMentionTargetId(element.id); setShowMentionPicker(true) }}
        />
      ))}

      {stickyElements.map(element => (
        <StickyNote
          key={element.id}
          element={element}
          isReadOnly={isReadOnly}
          isSelected={selectedElement === element.id}
          onMouseDown={(e) => handleStickyMouseDown(e, element)}
          onUpdate={updateElement}
          onDelete={deleteElement}
          onMention={() => { setMentionTargetId(element.id); setShowMentionPicker(true) }}
        />
      ))}
    </div>
  )
}

function TextElement({ element, isReadOnly, isSelected, onMouseDown, onUpdate, onDelete, onMention }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(element.text)
  const inputRef = useRef(null)

  useEffect(() => {
    setText(element.text)
  }, [element.text])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleDoubleClick = (e) => {
    if (isReadOnly) return
    e.stopPropagation()
    setEditing(true)
  }

  const handleBlur = () => {
    setEditing(false)
    if (text !== element.text) {
      onUpdate({ ...element, text })
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBlur()
    }
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    onDelete(element.id)
  }

  return (
    <div
      className="text-element"
      style={{
        left: element.x,
        top: element.y,
        color: element.color,
        border: isSelected ? '2px dashed #667eea' : '2px solid transparent',
      }}
      onMouseDown={onMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            fontSize: '18px',
            fontWeight: '500',
            color: element.color,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            width: '100%',
            fontFamily: 'inherit',
          }}
        />
      ) : (
        text || '双击编辑文字'
      )}
      {!isReadOnly && isSelected && !editing && (
        <>
          <button
            className="sticky-note-delete"
            onClick={handleDelete}
            title="删除"
          >
            ✕
          </button>
          <button
            className="mention-on-element"
            onClick={(e) => { e.stopPropagation(); onMention() }}
            title="@提醒他人"
          >
            @
          </button>
        </>
      )}
      {element.mentionedUsers && element.mentionedUsers.length > 0 && (
        <div className="element-mention-badge">
          @{element.mentionedUsers.length}
        </div>
      )}
    </div>
  )
}

function StickyNote({ element, isReadOnly, isSelected, onMouseDown, onUpdate, onDelete, onMention }) {
  const [text, setText] = useState(element.text)
  const textareaRef = useRef(null)

  useEffect(() => {
    setText(element.text)
  }, [element.text])

  const handleTextChange = (e) => {
    setText(e.target.value)
  }

  const handleTextBlur = () => {
    if (text !== element.text) {
      onUpdate({ ...element, text })
    }
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    onDelete(element.id)
  }

  const colorClass = {
    '#fff59d': 'sticky-note-yellow',
    '#f8bbd0': 'sticky-note-pink',
    '#90caf9': 'sticky-note-blue',
    '#a5d6a7': 'sticky-note-green',
  }[element.color] || 'sticky-note-yellow'

  return (
    <div
      className={`sticky-note ${colorClass}`}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        border: isSelected ? '2px solid #667eea' : 'none',
      }}
      onMouseDown={onMouseDown}
    >
      {!isReadOnly && (
        <>
          <button
            className="sticky-note-delete"
            onClick={handleDelete}
            title="删除便签"
          >
            ✕
          </button>
          <button
            className="mention-on-element"
            onClick={(e) => { e.stopPropagation(); onMention() }}
            title="@提醒他人"
          >
            @
          </button>
        </>
      )}
      {element.mentionedUsers && element.mentionedUsers.length > 0 && (
        <div className="element-mention-badge">
          @{element.mentionedUsers.length}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="sticky-note-text"
        value={text}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
        placeholder="输入便签内容..."
        readOnly={isReadOnly}
      />
    </div>
  )
}

export default Whiteboard
