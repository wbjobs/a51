const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

const router = express.Router();
const db = getDb();

function findAvailableRoom(capacity, startTime, endTime) {
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.capacity
    FROM rooms r
    WHERE r.capacity >= ?
    AND r.id NOT IN (
      SELECT m.room_id
      FROM meetings m
      WHERE m.status != 'ended'
      AND m.start_time < ?
      AND m.end_time > ?
    )
    ORDER BY r.capacity ASC
    LIMIT 1
  `).get(capacity, endTime, startTime);

  return rooms || null;
}

router.post('/', (req, res) => {
  const { title, organizer, participantCount, startTime, endTime } = req.body;

  if (!title || !organizer || !participantCount || !startTime || !endTime) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (start >= end) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }

  if (participantCount < 1) {
    return res.status(400).json({ error: '参会人数至少为1人' });
  }

  const room = findAvailableRoom(participantCount, startTime, endTime);

  if (!room) {
    return res.status(409).json({ error: '没有符合条件的可用会议室' });
  }

  const meetingId = uuidv4();

  db.prepare(`
    INSERT INTO meetings (id, room_id, title, organizer, participant_count, start_time, end_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
  `).run(meetingId, room.id, title, organizer, participantCount, startTime, endTime);

  const meeting = db.prepare(`
    SELECT m.*, r.name as room_name, r.capacity as room_capacity
    FROM meetings m
    JOIN rooms r ON m.room_id = r.id
    WHERE m.id = ?
  `).get(meetingId);

  res.status(201).json(meeting);
});

router.get('/', (req, res) => {
  const { status } = req.query;

  let query = `
    SELECT m.*, r.name as room_name, r.capacity as room_capacity
    FROM meetings m
    JOIN rooms r ON m.room_id = r.id
  `;

  const params = [];
  if (status) {
    query += ' WHERE m.status = ?';
    params.push(status);
  }

  query += ' ORDER BY m.start_time DESC';

  const meetings = db.prepare(query).all(...params);
  res.json(meetings);
});

router.get('/:id', (req, res) => {
  const { id } = req.params;

  const meeting = db.prepare(`
    SELECT m.*, r.name as room_name, r.capacity as room_capacity
    FROM meetings m
    JOIN rooms r ON m.room_id = r.id
    WHERE m.id = ?
  `).get(id);

  if (!meeting) {
    return res.status(404).json({ error: '会议不存在' });
  }

  res.json(meeting);
});

router.post('/:id/start', (req, res) => {
  const { id } = req.params;

  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);

  if (!meeting) {
    return res.status(404).json({ error: '会议不存在' });
  }

  if (meeting.status === 'ended') {
    return res.status(400).json({ error: '会议已结束' });
  }

  db.prepare("UPDATE meetings SET status = 'active' WHERE id = ?").run(id);

  const updatedMeeting = db.prepare(`
    SELECT m.*, r.name as room_name, r.capacity as room_capacity
    FROM meetings m
    JOIN rooms r ON m.room_id = r.id
    WHERE m.id = ?
  `).get(id);

  res.json(updatedMeeting);
});

router.post('/:id/end', (req, res) => {
  const { id } = req.params;

  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);

  if (!meeting) {
    return res.status(404).json({ error: '会议不存在' });
  }

  if (meeting.status === 'ended') {
    return res.status(400).json({ error: '会议已经结束' });
  }

  db.prepare("UPDATE meetings SET status = 'ended' WHERE id = ?").run(id);

  const updatedMeeting = db.prepare(`
    SELECT m.*, r.name as room_name, r.capacity as room_capacity
    FROM meetings m
    JOIN rooms r ON m.room_id = r.id
    WHERE m.id = ?
  `).get(id);

  res.json(updatedMeeting);
});

router.get('/rooms/available', (req, res) => {
  const { capacity, startTime, endTime } = req.query;

  if (!capacity || !startTime || !endTime) {
    return res.status(400).json({ error: '缺少查询参数' });
  }

  const rooms = db.prepare(`
    SELECT r.id, r.name, r.capacity
    FROM rooms r
    WHERE r.capacity >= ?
    AND r.id NOT IN (
      SELECT m.room_id
      FROM meetings m
      WHERE m.status != 'ended'
      AND m.start_time < ?
      AND m.end_time > ?
    )
    ORDER BY r.capacity ASC
  `).all(Number(capacity), endTime, startTime);

  res.json(rooms);
});

module.exports = router;
