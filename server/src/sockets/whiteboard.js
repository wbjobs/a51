const { getDb } = require('../database');

const db = getDb();

function setupWhiteboardSocket(io) {
  const meetingSockets = new Map();

  io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);

    socket.on('join-meeting', ({ meetingId, userId, userName }) => {
      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);

      if (!meeting) {
        socket.emit('error', { message: '会议不存在' });
        return;
      }

      socket.join(meetingId);
      socket.meetingId = meetingId;
      socket.userId = userId;
      socket.userName = userName;

      if (!meetingSockets.has(meetingId)) {
        meetingSockets.set(meetingId, new Set());
      }
      meetingSockets.get(meetingId).add(socket.id);

      const elements = db.prepare(`
        SELECT * FROM whiteboard_elements
        WHERE meeting_id = ?
        ORDER BY created_at ASC
      `).all(meetingId);

      const parsedElements = elements.map(el => ({
        ...el,
        points: el.points ? JSON.parse(el.points) : null,
      }));

      socket.emit('whiteboard-init', {
        meeting,
        elements: parsedElements,
        isReadOnly: meeting.status === 'ended',
      });

      const userCount = meetingSockets.get(meetingId).size;
      io.to(meetingId).emit('user-count', { count: userCount });
    });

    socket.on('whiteboard-add', (element) => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      const elementWithUser = {
        ...element,
        created_by: socket.userName || socket.userId,
      };

      const pointsStr = element.points ? JSON.stringify(element.points) : null;

      db.prepare(`
        INSERT INTO whiteboard_elements (id, meeting_id, type, x, y, width, height, color, stroke_width, text, points, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        element.id,
        meetingId,
        element.type,
        element.x,
        element.y,
        element.width || null,
        element.height || null,
        element.color || null,
        element.strokeWidth || null,
        element.text || null,
        pointsStr,
        socket.userName || socket.userId
      );

      socket.to(meetingId).emit('whiteboard-add', elementWithUser);
    });

    socket.on('whiteboard-update', (element) => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      const pointsStr = element.points ? JSON.stringify(element.points) : null;

      db.prepare(`
        UPDATE whiteboard_elements
        SET x = ?, y = ?, width = ?, height = ?, color = ?, stroke_width = ?, text = ?, points = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND meeting_id = ?
      `).run(
        element.x,
        element.y,
        element.width || null,
        element.height || null,
        element.color || null,
        element.strokeWidth || null,
        element.text || null,
        pointsStr,
        element.id,
        meetingId
      );

      socket.to(meetingId).emit('whiteboard-update', element);
    });

    socket.on('whiteboard-delete', ({ elementId }) => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      db.prepare('DELETE FROM whiteboard_elements WHERE id = ? AND meeting_id = ?').run(elementId, meetingId);

      socket.to(meetingId).emit('whiteboard-delete', { elementId });
    });

    socket.on('whiteboard-clear', () => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      db.prepare('DELETE FROM whiteboard_elements WHERE meeting_id = ?').run(meetingId);

      socket.to(meetingId).emit('whiteboard-clear');
    });

    socket.on('disconnect', () => {
      console.log('用户断开:', socket.id);
      const meetingId = socket.meetingId;

      if (meetingId && meetingSockets.has(meetingId)) {
        meetingSockets.get(meetingId).delete(socket.id);

        const userCount = meetingSockets.get(meetingId).size;
        io.to(meetingId).emit('user-count', { count: userCount });

        if (userCount === 0) {
          meetingSockets.delete(meetingId);
        }
      }
    });
  });
}

module.exports = setupWhiteboardSocket;
