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
  messages: [],
  groups: []
});

async function initDB() {
  await db.read();

  db.data ||= {
    users: [],
    messages: [],
    groups: []
  };

  db.data.users ||= [];
  db.data.messages ||= [];
  db.data.groups ||= [];

  await db.write();
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

function publicUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username
  };
}

function publicGroup(group) {
  return {
    id: group.id,
    name: group.name,
    owner: group.owner,
    members: group.members || [],
    created_at: group.created_at
  };
}

function getDirectChatId(userA, userB) {
  const users = [normalizeUsername(userA), normalizeUsername(userB)].sort();
  return `dm:${users[0]}__${users[1]}`;
}

function getGroupChatId(groupId) {
  return `group:${groupId}`;
}

async function ensureDB() {
  await db.read();

  db.data ||= {
    users: [],
    messages: [],
    groups: []
  };

  db.data.users ||= [];
  db.data.messages ||= [];
  db.data.groups ||= [];
}

initDB();

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Dark Messenger server is working"
  });
});

app.post("/api/register", async (req, res) => {
  await ensureDB();

  const { displayName, username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: "Введите логин и пароль"
    });
  }

  const cleanUsername = normalizeUsername(username);
  const cleanDisplayName = displayName ? String(displayName).trim() : cleanUsername;

  if (!cleanUsername) {
    return res.status(400).json({
      success: false,
      error: "Введите логин"
    });
  }

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
  await ensureDB();

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
  await ensureDB();

  const me = normalizeUsername(req.query.me);
  const q = normalizeUsername(req.query.q);

  if (!q) {
    return res.json({
      success: true,
      users: []
    });
  }

  const users = db.data.users
    .filter((user) => user.username !== me)
    .filter((user) => {
      return (
        user.username.toLowerCase().includes(q) ||
        user.displayName.toLowerCase().includes(q)
      );
    })
    .map(publicUser);

  res.json({
    success: true,
    users
  });
});

app.get("/api/messages", async (req, res) => {
  await ensureDB();

  const me = normalizeUsername(req.query.me);
  const withUser = normalizeUsername(req.query.with);

  if (!me || !withUser) {
    return res.status(400).json({
      success: false,
      error: "Не указан пользователь"
    });
  }

  const chatId = getDirectChatId(me, withUser);

  const messages = db.data.messages.filter((message) => message.chatId === chatId);

  res.json({
    success: true,
    messages
  });
});

app.get("/api/groups", async (req, res) => {
  await ensureDB();

  const me = normalizeUsername(req.query.me);

  if (!me) {
    return res.status(400).json({
      success: false,
      error: "Не указан пользователь"
    });
  }

  const groups = db.data.groups
    .filter((group) => (group.members || []).includes(me))
    .map(publicGroup);

  res.json({
    success: true,
    groups
  });
});

app.post("/api/groups", async (req, res) => {
  await ensureDB();

  const owner = normalizeUsername(req.body.owner);
  const name = String(req.body.name || "").trim();
  const membersRaw = Array.isArray(req.body.members) ? req.body.members : [];

  if (!owner || !name) {
    return res.status(400).json({
      success: false,
      error: "Введите название группы"
    });
  }

  const ownerUser = db.data.users.find((user) => user.username === owner);

  if (!ownerUser) {
    return res.status(404).json({
      success: false,
      error: "Создатель группы не найден"
    });
  }

  const normalizedMembers = membersRaw
    .map(normalizeUsername)
    .filter(Boolean);

  const members = Array.from(new Set([owner, ...normalizedMembers]));

  const missingUsers = members.filter((username) => {
    return !db.data.users.find((user) => user.username === username);
  });

  if (missingUsers.length) {
    return res.status(400).json({
      success: false,
      error: `Пользователи не найдены: ${missingUsers.map((u) => "@" + u).join(", ")}`
    });
  }

  const group = {
    id: String(Date.now()),
    name,
    owner,
    members,
    created_at: new Date().toISOString()
  };

  db.data.groups.push(group);
  await db.write();

  res.json({
    success: true,
    group: publicGroup(group)
  });
});

app.post("/api/groups/:id/invite", async (req, res) => {
  await ensureDB();

  const groupId = String(req.params.id);
  const me = normalizeUsername(req.body.me);
  const membersRaw = Array.isArray(req.body.members) ? req.body.members : [];

  const group = db.data.groups.find((group) => group.id === groupId);

  if (!group) {
    return res.status(404).json({
      success: false,
      error: "Группа не найдена"
    });
  }

  if (!(group.members || []).includes(me)) {
    return res.status(403).json({
      success: false,
      error: "Вы не участник этой группы"
    });
  }

  const newMembers = membersRaw
    .map(normalizeUsername)
    .filter(Boolean);

  const missingUsers = newMembers.filter((username) => {
    return !db.data.users.find((user) => user.username === username);
  });

  if (missingUsers.length) {
    return res.status(400).json({
      success: false,
      error: `Пользователи не найдены: ${missingUsers.map((u) => "@" + u).join(", ")}`
    });
  }

  group.members = Array.from(new Set([...(group.members || []), ...newMembers]));

  await db.write();

  res.json({
    success: true,
    group: publicGroup(group)
  });
});

app.get("/api/groups/:id/messages", async (req, res) => {
  await ensureDB();

  const groupId = String(req.params.id);
  const me = normalizeUsername(req.query.me);

  const group = db.data.groups.find((group) => group.id === groupId);

  if (!group) {
    return res.status(404).json({
      success: false,
      error: "Группа не найдена"
    });
  }

  if (!(group.members || []).includes(me)) {
    return res.status(403).json({
      success: false,
      error: "Вы не участник этой группы"
    });
  }

  const chatId = getGroupChatId(groupId);

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
    await ensureDB();

    const me = normalizeUsername(data && data.me);
    const withUser = normalizeUsername(data && data.with);

    if (!me || !withUser) return;

    const chatId = getDirectChatId(me, withUser);
    socket.join(`chat:${chatId}`);

    const messages = db.data.messages.filter((message) => message.chatId === chatId);

    socket.emit("load_messages", messages);
  });

  socket.on("open_group", async (data) => {
    await ensureDB();

    const me = normalizeUsername(data && data.me);
    const groupId = String((data && data.groupId) || "");

    const group = db.data.groups.find((group) => group.id === groupId);

    if (!group || !(group.members || []).includes(me)) return;

    const chatId = getGroupChatId(groupId);

    socket.join(`chat:${chatId}`);

    const messages = db.data.messages.filter((message) => message.chatId === chatId);

    socket.emit("load_messages", messages);
  });

  socket.on("send_message", async (data) => {
    await ensureDB();

    const from = normalizeUsername(data && data.from);
    const to = normalizeUsername(data && data.to);
    const text = String((data && (data.text || data.message)) || "").trim();

    if (!from || !to || !text) return;

    const sender = db.data.users.find((user) => user.username === from);
    const receiver = db.data.users.find((user) => user.username === to);

    if (!sender || !receiver) return;

    const chatId = getDirectChatId(from, to);

    const message = {
      id: Date.now(),
      type: "direct",
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

  socket.on("send_group_message", async (data) => {
    await ensureDB();

    const from = normalizeUsername(data && data.from);
    const groupId = String((data && data.groupId) || "");
    const text = String((data && (data.text || data.message)) || "").trim();

    if (!from || !groupId || !text) return;

    const sender = db.data.users.find((user) => user.username === from);
    const group = db.data.groups.find((group) => group.id === groupId);

    if (!sender || !group || !(group.members || []).includes(from)) return;

    const chatId = getGroupChatId(groupId);

    const message = {
      id: Date.now(),
      type: "group",
      chatId,
      groupId,
      from,
      username: from,
      displayName: sender.displayName,
      text,
      message: text,
      created_at: new Date().toISOString()
    };

    db.data.messages.push(message);
    await db.write();

    io.to(`chat:${chatId}`).emit("new_group_message", message);

    (group.members || []).forEach((member) => {
      io.to(`user:${member}`).emit("new_group_message", message);
    });
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