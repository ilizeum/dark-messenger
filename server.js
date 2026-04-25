const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// 📦 база (JSON файл)
const adapter = new JSONFile("db.json");
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data ||= { users: [], messages: [] };
  await db.write();
}
initDB();

// 🔐 регистрация
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  const exists = db.data.users.find(u => u.username === username);
  if (exists) {
    return res.json({ success: false, error: "Пользователь уже существует" });
  }

  db.data.users.push({ username, password });
  await db.write();

  res.json({ success: true });
});

// 🔐 логин
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = db.data.users.find(
    u => u.username === username && u.password === password
  );

  if (user) {
    res.json({ success: true });
  } else {
    res.json({ success: false, error: "Неверный логин или пароль" });
  }
});

// 💬 чат
io.on("connection", (socket) => {
  socket.emit("load_messages", db.data.messages);

  socket.on("send_message", async (data) => {
    db.data.messages.push(data);
    await db.write();

    io.emit("new_message", data);
  });
});

// 🚀 запуск
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("Server started on port", PORT);
});