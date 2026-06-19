import { useState, useEffect, useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'

const TOOLS = {
  PEN: 'pen',
  LINE: 'line',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  TEXT: 'text',
  STICKY: 'sticky',
  ERASER: 'eraser',
  SELECT: 'select',
}

const COLORS = ['#1a1a2e', '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6']
const STICKY_COLORS = ['#fff59d', '#f8bbd0', '#90caf9', '#a5d6a7']
const STROKE_WIDTHS = [2, 4, 6, 8]

function Whiteboard({ socket, meetingId, isReadOnly, userName }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
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
  const elementsRef = useRef([])

  useEffect(() => {
    if (!socket) return

    const handleInit = (data) => {
      setElements(data.elements || [])
      elementsRef.current = data.elements || []
    }

    const handleAdd = (element) => {
      setElements(prev => {
        const next = [...prev, element]
        elementsRef.current = next
        return next
      })
    }

    const handleUpdate = (element) => {
      setElements(prev => {
        const next = prev.map(el => el.id === element.id ? element : el)
        elementsRef.current = next
        return next
      })
    }

    const handleDelete = ({ elementId }) => {
      setElements(prev => {
        const next = prev.filter(el => el.id !== elementId)
        elementsRef.current = next
        return next
      })
    }

    const handleClear = () => {
      setElements([])
      elementsRef.current = []
    }

    socket.on('whiteboard-init', handleInit)
    socket.on('whiteboard-add', handleAdd)
    socket.on('whiteboard-update', handleUpdate)
    socket.on('whiteboard-delete', handleDelete)
    socket.on('whiteboard-clear', handleClear)

    return () => {
      socket.off('whiteboard-init', handleInit)
      socket.off('whiteboard-add', handleAdd)
      socket.off('whiteboard-update', handleUpdate)
      socket.off('whiteboard-delete', handleDelete)
      socket.off('whiteboard-clear', handleClear)
    }
  }, [socket])

  useEffect(() => {
    redrawCanvas()
  }, [elements])

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
          created_by: userName,
        }

        setElements(prev => {
          const next = [...prev, newElement]
          elementsRef.current = next
          return next
        })

        if (socket) {
          socket.emit('whiteboard-add', newElement)
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
          created_by: userName,
        }

        setElements(prev => {
          const next = [...prev, newElement]
          elementsRef.current = next
          return next
        })

        if (socket) {
          socket.emit('whiteboard-add', newElement)
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

    elements.forEach(el => {
      if (el.type === 'pen' || el.type === 'line') {
        for (const p of el.points) {
          const dist = Math.sqrt((p.x - point.x) ** 2 + (p.y - point.y) ** 2)
          if (dist < eraseRadius) {
            elementsToRemove.push(el.id)
            break
          }
        }
      } else if (el.type === 'rectangle' || el.type === 'circle') {
        if (point.x >= el.x - eraseRadius && point.x <= el.x + el.width + eraseRadius &&
            point.y >= el.y - eraseRadius && point.y <= el.y + el.height + eraseRadius) {
          elementsToRemove.push(el.id)
        }
      }
    })

    if (elementsToRemove.length > 0) {
      setElements(prev => {
        const next = prev.filter(el => !elementsToRemove.includes(el.id))
        elementsRef.current = next
        return next
      })

      if (socket) {
        elementsToRemove.forEach(id => {
          socket.emit('whiteboard-delete', { elementId: id })
        })
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
      created_by: userName,
    }

    setElements(prev => {
      const next = [...prev, newElement]
      elementsRef.current = next
      return next
    })

    if (socket) {
      socket.emit('whiteboard-add', newElement)
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
      created_by: userName,
    }

    setElements(prev => {
      const next = [...prev, newElement]
      elementsRef.current = next
      return next
    })

    if (socket) {
      socket.emit('whiteboard-add', newElement)
    }
  }

  const updateElement = (element) => {
    setElements(prev => {
      const next = prev.map(el => el.id === element.id ? element : el)
      elementsRef.current = next
      return next
    })

    if (socket) {
      socket.emit('whiteboard-update', element)
    }
  }

  const deleteElement = (elementId) => {
    setElements(prev => {
      const next = prev.filter(el => el.id !== elementId)
      elementsRef.current = next
      return next
    })

    if (socket) {
      socket.emit('whiteboard-delete', { elementId })
    }
  }

  const clearBoard = () => {
    if (isReadOnly) return
    if (!confirm('确定要清空白板吗？此操作不可撤销。')) return

    setElements([])
    elementsRef.current = []

    if (socket) {
      socket.emit('whiteboard-clear')
    }
  }

  const handleStickyMouseDown = (e, element) => {
    if (isReadOnly) return
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return

    e.preventDefault()
    setDragging(element.id)
    const rect = e.currentTarget.getBoundingClientRect()
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
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
    setSelectedElement(element.id)
  }

  const handleContainerMouseMove = (e) => {
    if (!dragging || isReadOnly) return

    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left - dragOffset.x
    const y = e.clientY - rect.top - dragOffset.y

    const element = elements.find(el => el.id === dragging)
    if (element) {
      const updated = { ...element, x: Math.max(0, x), y: Math.max(0, y) }
      updateElement(updated)
    }
  }

  const handleContainerMouseUp = () => {
    setDragging(null)
  }

  const stickyElements = elements.filter(el => el.type === 'sticky')
  const textElements = elements.filter(el => el.type === 'text')

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

      <canvas
        ref={canvasRef}
        className="whiteboard-canvas"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        style={{ cursor: isReadOnly ? 'default' : tool === TOOLS.ERASER ? 'cell' : 'crosshair' }}
      />

      {textElements.map(element => (
        <TextElement
          key={element.id}
          element={element}
          isReadOnly={isReadOnly}
          isSelected={selectedElement === element.id}
          onMouseDown={(e) => handleTextMouseDown(e, element)}
          onUpdate={updateElement}
          onDelete={deleteElement}
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
        />
      ))}
    </div>
  )
}

function TextElement({ element, isReadOnly, isSelected, onMouseDown, onUpdate, onDelete }) {
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
        <button
          className="sticky-note-delete"
          onClick={handleDelete}
          title="删除"
        >
          ✕
        </button>
      )}
    </div>
  )
}

function StickyNote({ element, isReadOnly, isSelected, onMouseDown, onUpdate, onDelete }) {
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
        <button
          className="sticky-note-delete"
          onClick={handleDelete}
          title="删除便签"
        >
          ✕
        </button>
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
