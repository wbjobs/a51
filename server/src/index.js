const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');
const meetingsRouter = require('./routes/meetings');
const uploadsRouter = require('./routes/uploads');
const setupWhiteboardSocket = require('./sockets/whiteboard');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

initDatabase();

app.use('/api/meetings', meetingsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

setupWhiteboardSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
