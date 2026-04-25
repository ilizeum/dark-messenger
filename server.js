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

  const cleanUsername = String(username).trim().toLowerCase();
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
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username
    }
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

  const cleanUsername = String(username).trim().toLowerCase();

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
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username
    }
  });
});

app.get("/api/users", async (req, res) => {
  await db.read();

  const users = db.data.users.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    username: user.username
  }));

  res.json({
    success: true,
    users
  });
});

io.on("connection", async (socket) => {
  console.log("User connected");

  await db.read();

  socket.emit("load_messages", db.data.messages);

  socket.on("send_message", async (data) => {
    await db.read();

    const message = {
      id: Date.now(),
      username: data.username || "unknown",
      displayName: data.displayName || data.username || "unknown",
      message: data.message || data.text || "",
      text: data.text || data.message || "",
      to: data.to || null,
      from: data.from || data.username || null,
      created_at: new Date().toISOString()
    };

    db.data.messages.push(message);
    await db.write();

    io.emit("new_message", message);
    io.emit("message", message);
  });

  socket.on("message", async (data) => {
    await db.read();

    const message = {
      id: Date.now(),
      username: data.username || data.from || "unknown",
      displayName: data.displayName || data.username || data.from || "unknown",
      message: data.message || data.text || "",
      text: data.text || data.message || "",
      to: data.to || null,
      from: data.from || data.username || null,
      created_at: new Date().toISOString()
    };

    db.data.messages.push(message);
    await db.write();

    io.emit("new_message", message);
    io.emit("message", message);
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