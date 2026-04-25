const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());

// 📦 База данных
const db = new sqlite3.Database("messages.db");

// Создание таблиц
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});


// 🔐 Регистрация
app.post("/register", (req, res) => {
  const { username, password } = req.body;

  db.run(
    "INSERT INTO users (username, password) VALUES (?, ?)",
    [username, password],
    function (err) {
      if (err) {
        return res.json({ success: false, error: "Пользователь уже существует" });
      }
      res.json({ success: true });
    }
  );
});


// 🔐 Логин
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT * FROM users WHERE username = ? AND password = ?",
    [username, password],
    (err, row) => {
      if (row) {
        res.json({ success: true });
      } else {
        res.json({ success: false, error: "Неверный логин или пароль" });
      }
    }
  );
});


// 💬 WebSocket чат
io.on("connection", (socket) => {
  console.log("Пользователь подключился");

  // отправка старых сообщений
  db.all("SELECT * FROM messages ORDER BY id ASC", (err, rows) => {
    socket.emit("load_messages", rows);
  });

  // новое сообщение
  socket.on("send_message", (data) => {
    const { username, message } = data;

    db.run(
      "INSERT INTO messages (username, message) VALUES (?, ?)",
      [username, message]
    );

    io.emit("new_message", {
      username,
      message
    });
  });

  socket.on("disconnect", () => {
    console.log("Пользователь отключился");
  });
});


// 🚀 Запуск сервера
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("Dark Messenger server started");
  console.log("PORT:", PORT);
});