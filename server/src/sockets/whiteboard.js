const { getDb } = require('../database');

const db = getDb();

const meetingVersions = new Map();
const processedOpIds = new Map();

function getNextVersion(meetingId) {
  let v = meetingVersions.get(meetingId);
  if (v === undefined) {
    const row = db.prepare('SELECT version FROM meeting_versions WHERE meeting_id = ?').get(meetingId);
    v = row ? row.version : 0;
  }
  v += 1;
  meetingVersions.set(meetingId, v);
  db.prepare('INSERT OR REPLACE INTO meeting_versions (meeting_id, version) VALUES (?, ?)').run(meetingId, v);
  return v;
}

function isOpProcessed(meetingId, opId) {
  const set = processedOpIds.get(meetingId);
  if (!set) return false;
  return set.has(opId);
}

function markOpProcessed(meetingId, opId) {
  if (!processedOpIds.has(meetingId)) {
    processedOpIds.set(meetingId, new Set());
  }
  processedOpIds.get(meetingId).add(opId);
  if (processedOpIds.get(meetingId).size > 500) {
    const arr = Array.from(processedOpIds.get(meetingId));
    processedOpIds.set(meetingId, new Set(arr.slice(-250)));
  }
}

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

      const tx = db.transaction(() => {
        const vRow = db.prepare('SELECT version FROM meeting_versions WHERE meeting_id = ?').get(meetingId);
        const currentVersion = vRow ? vRow.version : 0;

        const elements = db.prepare(`
          SELECT * FROM whiteboard_elements
          WHERE meeting_id = ?
          ORDER BY created_at ASC
        `).all(meetingId);

        const parsedElements = elements.map(el => ({
          ...el,
          points: el.points ? JSON.parse(el.points) : null,
          strokeWidth: el.stroke_width,
          createdBy: el.created_by,
        }));

        return { currentVersion, parsedElements, meeting };
      });

      const { currentVersion, parsedElements, meeting: meetingData } = tx();

      socket.emit('whiteboard-init', {
        meeting: meetingData,
        elements: parsedElements,
        serverVersion: currentVersion,
        isReadOnly: meetingData.status === 'ended',
      });

      const userCount = meetingSockets.get(meetingId).size;
      io.to(meetingId).emit('user-count', { count: userCount });
    });

    socket.on('whiteboard-add', ({ opId, element }) => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      if (opId && isOpProcessed(meetingId, opId)) {
        return;
      }

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      const tx = db.transaction(() => {
        const existing = db.prepare('SELECT id FROM whiteboard_elements WHERE id = ?').get(element.id);
        if (existing) {
          return null;
        }

        const version = getNextVersion(meetingId);
        const elementWithUser = {
          ...element,
          version,
          created_by: socket.userName || socket.userId,
        };

        const pointsStr = element.points ? JSON.stringify(element.points) : null;

        db.prepare(`
          INSERT INTO whiteboard_elements (id, meeting_id, type, x, y, width, height, color, stroke_width, text, points, created_by, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          socket.userName || socket.userId,
          version
        );

        return { ...elementWithUser, strokeWidth: element.strokeWidth, createdBy: socket.userName || socket.userId };
      });

      const result = tx();

      if (result === null) {
        return;
      }

      if (opId) {
        markOpProcessed(meetingId, opId);
      }

      socket.emit('whiteboard-add-ack', { opId, version: result.version, elementId: result.id });

      socket.to(meetingId).emit('whiteboard-add', {
        opId,
        version: result.version,
        element: result,
      });
    });

    socket.on('whiteboard-update', ({ opId, element, baseVersion }) => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      if (opId && isOpProcessed(meetingId, opId)) {
        return;
      }

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      const tx = db.transaction(() => {
        const existing = db.prepare('SELECT version FROM whiteboard_elements WHERE id = ? AND meeting_id = ?').get(element.id, meetingId);
        if (!existing) {
          return null;
        }

        const newVersion = getNextVersion(meetingId);
        const pointsStr = element.points ? JSON.stringify(element.points) : null;

        const info = db.prepare(`
          UPDATE whiteboard_elements
          SET x = ?, y = ?, width = ?, height = ?, color = ?, stroke_width = ?, text = ?, points = ?, version = ?, updated_at = CURRENT_TIMESTAMP
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
          newVersion,
          element.id,
          meetingId
        );

        if (info.changes === 0) {
          return null;
        }

        return {
          ...element,
          version: newVersion,
          strokeWidth: element.strokeWidth,
        };
      });

      const result = tx();

      if (result === null) {
        return;
      }

      if (opId) {
        markOpProcessed(meetingId, opId);
      }

      socket.emit('whiteboard-update-ack', { opId, version: result.version, elementId: result.id });

      socket.to(meetingId).emit('whiteboard-update', {
        opId,
        version: result.version,
        element: result,
      });
    });

    socket.on('whiteboard-delete', ({ opId, elementId }) => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      if (opId && isOpProcessed(meetingId, opId)) {
        return;
      }

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      const tx = db.transaction(() => {
        const newVersion = getNextVersion(meetingId);
        db.prepare('DELETE FROM whiteboard_elements WHERE id = ? AND meeting_id = ?').run(elementId, meetingId);
        return newVersion;
      });

      const newVersion = tx();

      if (opId) {
        markOpProcessed(meetingId, opId);
      }

      socket.emit('whiteboard-delete-ack', { opId, version: newVersion, elementId });

      socket.to(meetingId).emit('whiteboard-delete', {
        opId,
        version: newVersion,
        elementId,
      });
    });

    socket.on('whiteboard-clear', ({ opId }) => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;

      if (opId && isOpProcessed(meetingId, opId)) {
        return;
      }

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (meeting.status === 'ended') {
        socket.emit('error', { message: '会议已结束，白板为只读状态' });
        return;
      }

      const tx = db.transaction(() => {
        const newVersion = getNextVersion(meetingId);
        db.prepare('DELETE FROM whiteboard_elements WHERE meeting_id = ?').run(meetingId);
        return newVersion;
      });

      const newVersion = tx();

      if (opId) {
        markOpProcessed(meetingId, opId);
      }

      socket.emit('whiteboard-clear-ack', { opId, version: newVersion });

      socket.to(meetingId).emit('whiteboard-clear', {
        opId,
        version: newVersion,
      });
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
