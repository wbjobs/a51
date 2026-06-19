const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'meeting.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      room_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      organizer TEXT NOT NULL,
      participant_count INTEGER NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS whiteboard_elements (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      type TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL,
      height REAL,
      color TEXT,
      stroke_width REAL,
      text TEXT,
      points TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_meetings_room_time ON meetings(room_id, start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_whiteboard_meeting ON whiteboard_elements(meeting_id);
  `);

  const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
  if (roomCount === 0) {
    const insertRoom = db.prepare('INSERT INTO rooms (name, capacity) VALUES (?, ?)');
    const rooms = [
      ['创新室 A', 10],
      ['协作室 B', 6],
      ['头脑风暴室 C', 15],
      ['小型讨论室 D', 4],
      ['大型会议室 E', 20],
    ];
    const insertMany = db.transaction((roomList) => {
      for (const [name, capacity] of roomList) {
        insertRoom.run(name, capacity);
      }
    });
    insertMany(rooms);
    console.log('初始化 5 个会议室');
  }
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb };
