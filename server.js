const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const db = new Database(path.join(__dirname, 'messenger.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(from_user_id) REFERENCES users(id),
  FOREIGN KEY(to_user_id) REFERENCES users(id)
);
`);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.display_name };
}

function createToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    const data = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(data.id);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Неверный токен' });
  }
}

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim() || username;
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Логин: 3-20 символов, латиница/цифры/_' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)').run(username, displayName, passwordHash);
    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ token: createToken(user), user: publicUser(user) });
  } catch {
    res.status(409).json({ error: 'Такой логин уже занят' });
  }
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  res.json({ token: createToken(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name FROM users WHERE id != ? ORDER BY display_name').all(req.user.id);
  res.json({ users: users.map(publicUser) });
});

app.get('/api/messages/:userId', auth, (req, res) => {
  const otherId = Number(req.params.userId);
  const rows = db.prepare(`
    SELECT m.id, m.from_user_id, m.to_user_id, m.text, m.created_at,
           u1.username AS from_username, u1.display_name AS from_display_name
    FROM messages m
    JOIN users u1 ON u1.id = m.from_user_id
    WHERE (m.from_user_id = ? AND m.to_user_id = ?) OR (m.from_user_id = ? AND m.to_user_id = ?)
    ORDER BY m.id ASC
    LIMIT 300
  `).all(req.user.id, otherId, otherId, req.user.id);
  res.json({ messages: rows.map(row => ({
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    text: row.text,
    createdAt: row.created_at,
    fromUsername: row.from_username,
    fromDisplayName: row.from_display_name
  })) });
});

const onlineUsers = new Map();

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const data = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(data.id);
    if (!user) return next(new Error('Пользователь не найден'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Неверный токен'));
  }
});

function emitOnline() {
  io.emit('online-users', Array.from(onlineUsers.keys()));
}

io.on('connection', (socket) => {
  onlineUsers.set(socket.user.id, socket.id);
  socket.join(`user:${socket.user.id}`);
  emitOnline();

  socket.on('send-message', (payload, callback) => {
    try {
      const toUserId = Number(payload.toUserId);
      const text = String(payload.text || '').trim();
      if (!toUserId || !text) return callback?.({ ok: false, error: 'Пустое сообщение' });
      if (text.length > 2000) return callback?.({ ok: false, error: 'Слишком длинное сообщение' });
      const other = db.prepare('SELECT id FROM users WHERE id = ?').get(toUserId);
      if (!other) return callback?.({ ok: false, error: 'Пользователь не найден' });

      const info = db.prepare('INSERT INTO messages (from_user_id, to_user_id, text) VALUES (?, ?, ?)').run(socket.user.id, toUserId, text);
      const row = db.prepare('SELECT id, from_user_id, to_user_id, text, created_at FROM messages WHERE id = ?').get(info.lastInsertRowid);
      const message = {
        id: row.id,
        fromUserId: row.from_user_id,
        toUserId: row.to_user_id,
        text: row.text,
        createdAt: row.created_at,
        fromUsername: socket.user.username,
        fromDisplayName: socket.user.display_name
      };
      io.to(`user:${toUserId}`).emit('new-message', message);
      io.to(`user:${socket.user.id}`).emit('new-message', message);
      callback?.({ ok: true, message });
    } catch (e) {
      callback?.({ ok: false, error: 'Ошибка сервера' });
    }
  });

  socket.on('disconnect', () => {
    if (onlineUsers.get(socket.user.id) === socket.id) onlineUsers.delete(socket.user.id);
    emitOnline();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  console.log(`\nDark Messenger server started`);
  console.log(`Open on this PC: http://localhost:${PORT}`);
  for (const ip of addresses) console.log(`Open from same Wi-Fi: http://${ip}:${PORT}`);
  console.log('For internet access, host this server on VPS/Render/Railway and open the URL.\n');
});
