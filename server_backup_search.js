const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const adapter = new JSONFile("db.json");
const db = new Low(adapter, {
  users: [],
  messages: []
});

async function initDB() {
  await db.read();

  db.data ||= {
    users: [],
    messages: []
  };

  db.data.users ||= [];
  db.data.messages ||= [];

  await db.write();
}

function publicUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username
  };
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function getChatId(userA, userB) {
  const users = [normalizeUsername(userA), normalizeUsername(userB)].sort();
  return `${users[0]}__${users[1]}`;
}

initDB();

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Dark Messenger server is working"
  });
});

app.post("/api/register", async (req, res) => {
  await db.read();

  const { displayName, username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: "Введите логин и пароль"
    });
  }

  const cleanUsername = normalizeUsername(username);
  const cleanDisplayName = displayName ? String(displayName).trim() : cleanUsername;

  const exists = db.data.users.find((user) => user.username === cleanUsername);

  if (exists) {
    return res.status(400).json({
      success: false,
      error: "Пользователь уже существует"
    });
  }

  const user = {
    id: Date.now(),
    displayName: cleanDisplayName,
    username: cleanUsername,
    password: String(password)
  };

  db.data.users.push(user);
  await db.write();

  res.json({
    success: true,
    user: publicUser(user)
  });
});

app.post("/api/login", async (req, res) => {
  await db.read();

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: "Введите логин и пароль"
    });
  }

  const cleanUsername = normalizeUsername(username);

  const user = db.data.users.find(
    (user) => user.username === cleanUsername && user.password === String(password)
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Неверный логин или пароль"
    });
  }

  res.json({
    success: true,
    user: publicUser(user)
  });
});

app.get("/api/users", async (req, res) => {
  await db.read();

  const me = normalizeUsername(req.query.me);
  const q = normalizeUsername(req.query.q);

  let users = db.data.users
    .filter((user) => user.username !== me)
    .map(publicUser);

  if (q) {
    users = users.filter((user) => {
      return (
        user.username.toLowerCase().includes(q) ||
        user.displayName.toLowerCase().includes(q)
      );
    });
  }

  res.json({
    success: true,
    users
  });
});

app.get("/api/messages", async (req, res) => {
  await db.read();

  const me = normalizeUsername(req.query.me);
  const withUser = normalizeUsername(req.query.with);

  if (!me || !withUser) {
    return res.status(400).json({
      success: false,
      error: "Не указан пользователь"
    });
  }

  const chatId = getChatId(me, withUser);

  const messages = db.data.messages.filter((message) => message.chatId === chatId);

  res.json({
    success: true,
    messages
  });
});

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("user_online", (data) => {
    const username = normalizeUsername(data && data.username);

    if (!username) return;

    socket.username = username;
    socket.join(`user:${username}`);

    console.log("Online:", username);
  });

  socket.on("open_chat", async (data) => {
    await db.read();

    const me = normalizeUsername(data && data.me);
    const withUser = normalizeUsername(data && data.with);

    if (!me || !withUser) return;

    const chatId = getChatId(me, withUser);
    socket.join(`chat:${chatId}`);

    const messages = db.data.messages.filter((message) => message.chatId === chatId);

    socket.emit("load_messages", messages);
  });

  socket.on("send_message", async (data) => {
    await db.read();

    const from = normalizeUsername(data && data.from);
    const to = normalizeUsername(data && data.to);
    const text = String((data && (data.text || data.message)) || "").trim();

    if (!from || !to || !text) return;

    const sender = db.data.users.find((user) => user.username === from);
    const receiver = db.data.users.find((user) => user.username === to);

    if (!sender || !receiver) return;

    const chatId = getChatId(from, to);

    const message = {
      id: Date.now(),
      chatId,
      from,
      to,
      username: from,
      displayName: sender.displayName,
      text,
      message: text,
      created_at: new Date().toISOString()
    };

    db.data.messages.push(message);
    await db.write();

    io.to(`user:${from}`).emit("new_message", message);
    io.to(`user:${to}`).emit("new_message", message);
    io.to(`chat:${chatId}`).emit("new_message", message);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Dark Messenger server started");
  console.log("Server started on port", PORT);
});