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

function parseElement(el) {
  return {
    ...el,
    points: el.points ? JSON.parse(el.points) : null,
    strokeWidth: el.stroke_width,
    createdBy: el.created_by,
    imageUrl: el.image_url,
    scale: el.scale || 1,
    mentionedUsers: el.mentioned_users ? JSON.parse(el.mentioned_users) : [],
  };
}

function setupWhiteboardSocket(io) {
  const meetingSockets = new Map();
  const meetingUsers = new Map();

  function getOnlineUsers(meetingId) {
    const users = meetingUsers.get(meetingId);
    if (!users) return [];
    return Array.from(users.values()).map(u => ({ userId: u.userId, userName: u.userName }));
  }

  function sendMentionNotifications(meetingId, element, fromUserName) {
    if (!element.mentionedUsers || element.mentionedUsers.length === 0) return;

    const users = meetingUsers.get(meetingId);
    if (!users) return;

    element.mentionedUsers.forEach(userName => {
      let targetSocketId = null;
      for (const [sid, user] of users.entries()) {
        if (user.userName === userName) {
          targetSocketId = sid;
          break;
        }
      }

      const notification = {
        id: Date.now() + Math.random(),
        meetingId,
        fromUser: fromUserName,
        type: 'mention',
        content: `${fromUserName} 在白板上@了你`,
        elementId: element.id,
        elementType: element.type,
        isRead: false,
        createdAt: new Date().toISOString(),
      };

      db.prepare(`
        INSERT INTO notifications (meeting_id, user_name, from_user, type, content, element_id, is_read)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(meetingId, userName, fromUserName, 'mention', notification.content, element.id);

      if (targetSocketId) {
        io.to(targetSocketId).emit('notification', notification);
      }
    });
  }

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

      if (!meetingUsers.has(meetingId)) {
        meetingUsers.set(meetingId, new Map());
      }
      meetingUsers.get(meetingId).set(socket.id, { userId, userName });

      const tx = db.transaction(() => {
        const vRow = db.prepare('SELECT version FROM meeting_versions WHERE meeting_id = ?').get(meetingId);
        const currentVersion = vRow ? vRow.version : 0;

        const elements = db.prepare(`
          SELECT * FROM whiteboard_elements
          WHERE meeting_id = ?
          ORDER BY created_at ASC
        `).all(meetingId);

        const parsedElements = elements.map(parseElement);

        const unreadNotifications = db.prepare(`
          SELECT * FROM notifications
          WHERE meeting_id = ? AND user_name = ? AND is_read = 0
          ORDER BY created_at DESC
        `).all(meetingId, userName).map(n => ({
          id: n.id,
          meetingId: n.meeting_id,
          fromUser: n.from_user,
          type: n.type,
          content: n.content,
          elementId: n.element_id,
          isRead: n.is_read === 1,
          createdAt: n.created_at,
        }));

        return { currentVersion, parsedElements, meeting, unreadNotifications };
      });

      const { currentVersion, parsedElements, meeting: meetingData, unreadNotifications } = tx();

      socket.emit('whiteboard-init', {
        meeting: meetingData,
        elements: parsedElements,
        serverVersion: currentVersion,
        isReadOnly: meetingData.status === 'ended',
        onlineUsers: getOnlineUsers(meetingId),
        unreadNotifications,
      });

      const userCount = meetingSockets.get(meetingId).size;
      io.to(meetingId).emit('user-count', { count: userCount });
      io.to(meetingId).emit('online-users', { users: getOnlineUsers(meetingId) });
    });

    socket.on('get-online-users', () => {
      const meetingId = socket.meetingId;
      if (!meetingId) return;
      socket.emit('online-users', { users: getOnlineUsers(meetingId) });
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
        const mentionedUsersStr = element.mentionedUsers ? JSON.stringify(element.mentionedUsers) : null;

        db.prepare(`
          INSERT INTO whiteboard_elements (id, meeting_id, type, x, y, width, height, color, stroke_width, text, points, image_url, scale, created_by, mentioned_users, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          element.imageUrl || null,
          element.scale || 1,
          socket.userName || socket.userId,
          mentionedUsersStr,
          version
        );

        return parseElement({
          ...elementWithUser,
          stroke_width: element.strokeWidth,
          created_by: socket.userName || socket.userId,
          image_url: element.imageUrl || null,
          scale: element.scale || 1,
          mentioned_users: mentionedUsersStr,
        });
      });

      const result = tx();

      if (result === null) {
        return;
      }

      if (opId) {
        markOpProcessed(meetingId, opId);
      }

      if (result.mentionedUsers && result.mentionedUsers.length > 0) {
        sendMentionNotifications(meetingId, result, socket.userName || socket.userId);
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
        const existing = db.prepare('SELECT version, mentioned_users FROM whiteboard_elements WHERE id = ? AND meeting_id = ?').get(element.id, meetingId);
        if (!existing) {
          return null;
        }

        const newVersion = getNextVersion(meetingId);
        const pointsStr = element.points ? JSON.stringify(element.points) : null;
        const mentionedUsersStr = element.mentionedUsers ? JSON.stringify(element.mentionedUsers) : null;

        const oldMentions = existing.mentioned_users ? JSON.parse(existing.mentioned_users) : [];
        const newMentions = element.mentionedUsers || [];
        const addedMentions = newMentions.filter(u => !oldMentions.includes(u));

        const info = db.prepare(`
          UPDATE whiteboard_elements
          SET x = ?, y = ?, width = ?, height = ?, color = ?, stroke_width = ?, text = ?, points = ?, image_url = ?, scale = ?, mentioned_users = ?, version = ?, updated_at = CURRENT_TIMESTAMP
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
          element.imageUrl || null,
          element.scale || 1,
          mentionedUsersStr,
          newVersion,
          element.id,
          meetingId
        );

        if (info.changes === 0) {
          return null;
        }

        const parsed = parseElement({
          ...element,
          stroke_width: element.strokeWidth,
          image_url: element.imageUrl,
          scale: element.scale || 1,
          mentioned_users: mentionedUsersStr,
          version: newVersion,
        });

        return { parsed, addedMentions };
      });

      const result = tx();

      if (result === null) {
        return;
      }

      if (opId) {
        markOpProcessed(meetingId, opId);
      }

      if (result.addedMentions.length > 0) {
        const elementForNotify = { ...result.parsed, mentionedUsers: result.addedMentions };
        sendMentionNotifications(meetingId, elementForNotify, socket.userName || socket.userId);
      }

      socket.emit('whiteboard-update-ack', { opId, version: result.parsed.version, elementId: result.parsed.id });

      socket.to(meetingId).emit('whiteboard-update', {
        opId,
        version: result.parsed.version,
        element: result.parsed,
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

    socket.on('mark-notification-read', ({ notificationId }) => {
      const meetingId = socket.meetingId;
      if (!meetingId || !socket.userName) return;

      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_name = ?').run(notificationId, socket.userName);

      socket.emit('notification-read', { notificationId });
    });

    socket.on('mark-all-notifications-read', () => {
      const meetingId = socket.meetingId;
      if (!meetingId || !socket.userName) return;

      db.prepare('UPDATE notifications SET is_read = 1 WHERE meeting_id = ? AND user_name = ?').run(meetingId, socket.userName);

      socket.emit('all-notifications-read');
    });

    socket.on('disconnect', () => {
      console.log('用户断开:', socket.id);
      const meetingId = socket.meetingId;

      if (meetingId && meetingSockets.has(meetingId)) {
        meetingSockets.get(meetingId).delete(socket.id);

        if (meetingUsers.has(meetingId)) {
          meetingUsers.get(meetingId).delete(socket.id);
        }

        const userCount = meetingSockets.get(meetingId).size;
        io.to(meetingId).emit('user-count', { count: userCount });
        io.to(meetingId).emit('online-users', { users: getOnlineUsers(meetingId) });

        if (userCount === 0) {
          meetingSockets.delete(meetingId);
          meetingUsers.delete(meetingId);
        }
      }
    });
  });
}

module.exports = setupWhiteboardSocket;
