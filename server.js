const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  },
  maxHttpBufferSize: 15 * 1024 * 1024
});

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.static("public"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? {
        rejectUnauthorized: false
      }
    : false
});

const MAX_MEDIA_LENGTH = 12 * 1024 * 1024;

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

function getDirectChatId(userA, userB) {
  const users = [normalizeUsername(userA), normalizeUsername(userB)].sort();
  return `dm:${users[0]}__${users[1]}`;
}

function getGroupChatId(groupId) {
  return `group:${groupId}`;
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: String(user.id),
    displayName: user.display_name,
    username: user.username,
    avatar: user.avatar || ""
  };
}

function publicGroup(group) {
  if (!group) return null;

  return {
    id: String(group.id),
    name: group.name,
    owner: group.owner,
    members: group.members || [],
    created_at: group.created_at
  };
}

function cleanMedia(media) {
  if (!media || typeof media !== "object") return null;

  const type = String(media.type || "");
  const url = String(media.url || "");
  const name = String(media.name || "file");

  if (!["image", "video", "audio"].includes(type)) return null;
  if (!url.startsWith("data:")) return null;
  if (url.length > MAX_MEDIA_LENGTH) return null;

  return {
    type,
    url,
    name
  };
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      display_name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      members TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      group_id TEXT,
      from_username TEXT NOT NULL,
      to_username TEXT,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      text TEXT DEFAULT '',
      media JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log("PostgreSQL tables are ready");
}

async function findUser(username) {
  const cleanUsername = normalizeUsername(username);

  const result = await pool.query(
    "SELECT * FROM users WHERE username = $1",
    [cleanUsername]
  );

  return result.rows[0] || null;
}

async function getMessagesByChatId(chatId) {
  const result = await pool.query(
    `
    SELECT
      id::text AS id,
      type,
      chat_id AS "chatId",
      group_id AS "groupId",
      from_username AS "from",
      to_username AS "to",
      username,
      display_name AS "displayName",
      avatar,
      text,
      text AS message,
      media,
      created_at
    FROM messages
    WHERE chat_id = $1
    ORDER BY id ASC
    `,
    [chatId]
  );

  return result.rows;
}

async function saveMessage(message) {
  const result = await pool.query(
    `
    INSERT INTO messages (
      type,
      chat_id,
      group_id,
      from_username,
      to_username,
      username,
      display_name,
      avatar,
      text,
      media
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING
      id::text AS id,
      type,
      chat_id AS "chatId",
      group_id AS "groupId",
      from_username AS "from",
      to_username AS "to",
      username,
      display_name AS "displayName",
      avatar,
      text,
      text AS message,
      media,
      created_at
    `,
    [
      message.type,
      message.chatId,
      message.groupId || null,
      message.from,
      message.to || null,
      message.username,
      message.displayName,
      message.avatar || "",
      message.text || "",
      message.media || null
    ]
  );

  return result.rows[0];
}

initDB().catch((error) => {
  console.error("Database init error:", error);
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "Dark Messenger server is working",
      database: "postgres"
    });
  } catch (error) {
    console.error("Health error:", error);

    res.status(500).json({
      success: false,
      error: "Database error"
    });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { displayName, username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Введите логин и пароль"
      });
    }

    const cleanUsername = normalizeUsername(username);
    const cleanDisplayName = displayName
      ? String(displayName).trim()
      : cleanUsername;

    if (!cleanUsername) {
      return res.status(400).json({
        success: false,
        error: "Введите логин"
      });
    }

    const exists = await findUser(cleanUsername);

    if (exists) {
      return res.status(400).json({
        success: false,
        error: "Пользователь уже существует"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO users (display_name, username, password, avatar)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [cleanDisplayName, cleanUsername, String(password), ""]
    );

    res.json({
      success: true,
      user: publicUser(result.rows[0])
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка регистрации"
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Введите логин и пароль"
      });
    }

    const cleanUsername = normalizeUsername(username);

    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1 AND password = $2",
      [cleanUsername, String(password)]
    );

    const user = result.rows[0];

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
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка входа"
    });
  }
});

app.post("/api/avatar", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const avatar = String(req.body.avatar || "");

    if (!username) {
      return res.status(400).json({
        success: false,
        error: "Не указан пользователь"
      });
    }

    if (
      avatar &&
      (!avatar.startsWith("data:image/") || avatar.length > MAX_MEDIA_LENGTH)
    ) {
      return res.status(400).json({
        success: false,
        error: "Неверный формат аватарки"
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET avatar = $1
      WHERE username = $2
      RETURNING *
      `,
      [avatar, username]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Пользователь не найден"
      });
    }

    res.json({
      success: true,
      user: publicUser(result.rows[0])
    });
  } catch (error) {
    console.error("Avatar error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка аватарки"
    });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const me = normalizeUsername(req.query.me);
    const q = normalizeUsername(req.query.q);

    if (!q) {
      return res.json({
        success: true,
        users: []
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE username <> $1
        AND (
          username ILIKE $2
          OR display_name ILIKE $2
        )
      ORDER BY username ASC
      LIMIT 20
      `,
      [me, `%${q}%`]
    );

    res.json({
      success: true,
      users: result.rows.map(publicUser)
    });
  } catch (error) {
    console.error("Users error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка поиска пользователей"
    });
  }
});

app.get("/api/messages", async (req, res) => {
  try {
    const me = normalizeUsername(req.query.me);
    const withUser = normalizeUsername(req.query.with);

    if (!me || !withUser) {
      return res.status(400).json({
        success: false,
        error: "Не указан пользователь"
      });
    }

    const chatId = getDirectChatId(me, withUser);
    const messages = await getMessagesByChatId(chatId);

    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error("Messages error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка загрузки сообщений"
    });
  }
});

app.get("/api/groups", async (req, res) => {
  try {
    const me = normalizeUsername(req.query.me);

    if (!me) {
      return res.status(400).json({
        success: false,
        error: "Не указан пользователь"
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM groups
      WHERE $1 = ANY(members)
      ORDER BY id DESC
      `,
      [me]
    );

    res.json({
      success: true,
      groups: result.rows.map(publicGroup)
    });
  } catch (error) {
    console.error("Groups error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка загрузки групп"
    });
  }
});

app.post("/api/groups", async (req, res) => {
  try {
    const owner = normalizeUsername(req.body.owner);
    const name = String(req.body.name || "").trim();
    const membersRaw = Array.isArray(req.body.members) ? req.body.members : [];

    if (!owner || !name) {
      return res.status(400).json({
        success: false,
        error: "Введите название группы"
      });
    }

    const ownerUser = await findUser(owner);

    if (!ownerUser) {
      return res.status(404).json({
        success: false,
        error: "Создатель группы не найден"
      });
    }

    const normalizedMembers = membersRaw.map(normalizeUsername).filter(Boolean);
    const members = Array.from(new Set([owner, ...normalizedMembers]));

    const usersResult = await pool.query(
      "SELECT username FROM users WHERE username = ANY($1::text[])",
      [members]
    );

    const foundUsers = usersResult.rows.map((row) => row.username);
    const missingUsers = members.filter(
      (username) => !foundUsers.includes(username)
    );

    if (missingUsers.length) {
      return res.status(400).json({
        success: false,
        error: `Пользователи не найдены: ${missingUsers
          .map((u) => "@" + u)
          .join(", ")}`
      });
    }

    const result = await pool.query(
      `
      INSERT INTO groups (name, owner, members)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [name, owner, members]
    );

    res.json({
      success: true,
      group: publicGroup(result.rows[0])
    });
  } catch (error) {
    console.error("Create group error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка создания группы"
    });
  }
});

app.post("/api/groups/:id/invite", async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const me = normalizeUsername(req.body.me);
    const membersRaw = Array.isArray(req.body.members) ? req.body.members : [];

    const groupResult = await pool.query(
      "SELECT * FROM groups WHERE id = $1",
      [groupId]
    );

    const group = groupResult.rows[0];

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

    const newMembers = membersRaw.map(normalizeUsername).filter(Boolean);

    const usersResult = await pool.query(
      "SELECT username FROM users WHERE username = ANY($1::text[])",
      [newMembers]
    );

    const foundUsers = usersResult.rows.map((row) => row.username);
    const missingUsers = newMembers.filter(
      (username) => !foundUsers.includes(username)
    );

    if (missingUsers.length) {
      return res.status(400).json({
        success: false,
        error: `Пользователи не найдены: ${missingUsers
          .map((u) => "@" + u)
          .join(", ")}`
      });
    }

    const members = Array.from(new Set([...(group.members || []), ...newMembers]));

    const result = await pool.query(
      `
      UPDATE groups
      SET members = $1
      WHERE id = $2
      RETURNING *
      `,
      [members, groupId]
    );

    res.json({
      success: true,
      group: publicGroup(result.rows[0])
    });
  } catch (error) {
    console.error("Invite group error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка добавления участников"
    });
  }
});

app.get("/api/groups/:id/messages", async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const me = normalizeUsername(req.query.me);

    const groupResult = await pool.query(
      "SELECT * FROM groups WHERE id = $1",
      [groupId]
    );

    const group = groupResult.rows[0];

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
    const messages = await getMessagesByChatId(chatId);

    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error("Group messages error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка загрузки сообщений группы"
    });
  }
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
    try {
      const me = normalizeUsername(data && data.me);
      const withUser = normalizeUsername(data && data.with);

      if (!me || !withUser) return;

      const chatId = getDirectChatId(me, withUser);
      socket.join(`chat:${chatId}`);

      const messages = await getMessagesByChatId(chatId);

      socket.emit("load_messages", messages);
    } catch (error) {
      console.error("Open chat error:", error);
    }
  });

  socket.on("open_group", async (data) => {
    try {
      const me = normalizeUsername(data && data.me);
      const groupId = String((data && data.groupId) || "");

      const groupResult = await pool.query(
        "SELECT * FROM groups WHERE id = $1",
        [groupId]
      );

      const group = groupResult.rows[0];

      if (!group || !(group.members || []).includes(me)) return;

      const chatId = getGroupChatId(groupId);

      socket.join(`chat:${chatId}`);

      const messages = await getMessagesByChatId(chatId);

      socket.emit("load_messages", messages);
    } catch (error) {
      console.error("Open group error:", error);
    }
  });

  socket.on("send_message", async (data) => {
    try {
      const from = normalizeUsername(data && data.from);
      const to = normalizeUsername(data && data.to);
      const text = String((data && (data.text || data.message)) || "").trim();
      const media = cleanMedia(data && data.media);

      if (!from || !to || (!text && !media)) return;

      const sender = await findUser(from);
      const receiver = await findUser(to);

      if (!sender || !receiver) return;

      const chatId = getDirectChatId(from, to);

      const savedMessage = await saveMessage({
        type: "direct",
        chatId,
        from,
        to,
        username: from,
        displayName: sender.display_name,
        avatar: sender.avatar || "",
        text,
        media
      });

      io.to(`user:${from}`).emit("new_message", savedMessage);
      io.to(`user:${to}`).emit("new_message", savedMessage);
      io.to(`chat:${chatId}`).emit("new_message", savedMessage);
    } catch (error) {
      console.error("Send message error:", error);
    }
  });

  socket.on("send_group_message", async (data) => {
    try {
      const from = normalizeUsername(data && data.from);
      const groupId = String((data && data.groupId) || "");
      const text = String((data && (data.text || data.message)) || "").trim();
      const media = cleanMedia(data && data.media);

      if (!from || !groupId || (!text && !media)) return;

      const sender = await findUser(from);

      const groupResult = await pool.query(
        "SELECT * FROM groups WHERE id = $1",
        [groupId]
      );

      const group = groupResult.rows[0];

      if (!sender || !group || !(group.members || []).includes(from)) return;

      const chatId = getGroupChatId(groupId);

      const savedMessage = await saveMessage({
        type: "group",
        chatId,
        groupId,
        from,
        username: from,
        displayName: sender.display_name,
        avatar: sender.avatar || "",
        text,
        media
      });

      io.to(`chat:${chatId}`).emit("new_group_message", savedMessage);

      (group.members || []).forEach((member) => {
        io.to(`user:${member}`).emit("new_group_message", savedMessage);
      });
    } catch (error) {
      console.error("Send group message error:", error);
    }
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