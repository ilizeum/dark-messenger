const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

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
const BCRYPT_ROUNDS = 10;

const onlineUsers = new Map();

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

function cleanReplyTo(replyTo) {
  if (!replyTo || typeof replyTo !== "object") return null;

  const id = String(replyTo.id || "").trim();
  const text = String(replyTo.text || replyTo.message || "").trim();
  const username = normalizeUsername(replyTo.username || replyTo.from || "");
  const displayName = String(replyTo.displayName || replyTo.display_name || replyTo.authorName || "").trim();

  if (!id && !text) return null;

  return {
    id,
    text: text.slice(0, 500),
    username,
    displayName
  };
}

function isBcryptHash(value) {
  const text = String(value || "");
  return text.startsWith("$2a$") || text.startsWith("$2b$") || text.startsWith("$2y$");
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function verifyPassword(inputPassword, savedPassword, username) {
  const input = String(inputPassword || "");
  const saved = String(savedPassword || "");

  if (!saved) return false;

  if (isBcryptHash(saved)) {
    return bcrypt.compare(input, saved);
  }

  const isOldPasswordCorrect = input === saved;

  if (isOldPasswordCorrect && username) {
    const newHash = await hashPassword(input);

    await pool.query(
      "UPDATE users SET password = $1 WHERE username = $2",
      [newHash, username]
    );

    console.log(`Password migrated to bcrypt for @${username}`);
  }

  return isOldPasswordCorrect;
}

function setUserOnline(username, socketId) {
  const cleanUsername = normalizeUsername(username);

  if (!cleanUsername) return;

  const sockets = onlineUsers.get(cleanUsername) || new Set();
  sockets.add(socketId);
  onlineUsers.set(cleanUsername, sockets);

  io.emit("user_status", {
    username: cleanUsername,
    online: true
  });
}

function setUserOffline(username, socketId) {
  const cleanUsername = normalizeUsername(username);

  if (!cleanUsername) return;

  const sockets = onlineUsers.get(cleanUsername);

  if (!sockets) return;

  sockets.delete(socketId);

  if (sockets.size === 0) {
    onlineUsers.delete(cleanUsername);

    io.emit("user_status", {
      username: cleanUsername,
      online: false
    });
  } else {
    onlineUsers.set(cleanUsername, sockets);
  }
}

function isUserOnline(username) {
  return onlineUsers.has(normalizeUsername(username));
}

function moveOnlineUser(oldUsername, newUsername) {
  const oldClean = normalizeUsername(oldUsername);
  const newClean = normalizeUsername(newUsername);

  if (!oldClean || !newClean || oldClean === newClean) return;

  const oldSockets = onlineUsers.get(oldClean);

  if (!oldSockets) return;

  onlineUsers.delete(oldClean);
  onlineUsers.set(newClean, oldSockets);

  io.emit("user_status", {
    username: oldClean,
    online: false
  });

  io.emit("user_status", {
    username: newClean,
    online: true
  });
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
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT ''
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
      reply_to JSONB,
      edited BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS media JSONB
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS reply_to JSONB
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
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
      reply_to AS "replyTo",
      edited,
      updated_at AS "updatedAt",
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
      media,
      reply_to,
      edited
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      reply_to AS "replyTo",
      edited,
      updated_at AS "updatedAt",
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
      message.media || null,
      message.replyTo || null,
      false
    ]
  );

  return result.rows[0];
}

async function updateDirectChatIdsForUsername(client, username) {
  const cleanUsername = normalizeUsername(username);

  const result = await client.query(
    `
    SELECT id, from_username, to_username
    FROM messages
    WHERE type = 'direct'
      AND (from_username = $1 OR to_username = $1)
    `,
    [cleanUsername]
  );

  for (const message of result.rows) {
    const newChatId = getDirectChatId(message.from_username, message.to_username);

    await client.query(
      `
      UPDATE messages
      SET chat_id = $1
      WHERE id = $2
      `,
      [newChatId, message.id]
    );
  }
}

async function getMessageById(messageId) {
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
      reply_to AS "replyTo",
      edited,
      updated_at AS "updatedAt",
      created_at
    FROM messages
    WHERE id = $1
    `,
    [messageId]
  );

  return result.rows[0] || null;
}

async function editMessage({ messageId, me, text }) {
  const cleanMe = normalizeUsername(me);
  const cleanText = String(text || "").trim();

  if (!messageId || !cleanMe || !cleanText) {
    return {
      success: false,
      status: 400,
      error: "Не указано сообщение, пользователь или текст"
    };
  }

  const oldMessage = await getMessageById(messageId);

  if (!oldMessage) {
    return {
      success: false,
      status: 404,
      error: "Сообщение не найдено"
    };
  }

  if (oldMessage.from !== cleanMe) {
    return {
      success: false,
      status: 403,
      error: "Можно редактировать только свои сообщения"
    };
  }

  const result = await pool.query(
    `
    UPDATE messages
    SET text = $1,
        edited = TRUE,
        updated_at = NOW()
    WHERE id = $2
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
      reply_to AS "replyTo",
      edited,
      updated_at AS "updatedAt",
      created_at
    `,
    [cleanText, messageId]
  );

  return {
    success: true,
    message: result.rows[0]
  };
}

async function deleteMessageById({ messageId, me }) {
  const cleanMe = normalizeUsername(me);

  if (!messageId || !cleanMe) {
    return {
      success: false,
      status: 400,
      error: "Не указано сообщение или пользователь"
    };
  }

  const message = await getMessageById(messageId);

  if (!message) {
    return {
      success: false,
      status: 404,
      error: "Сообщение не найдено"
    };
  }

  if (message.from !== cleanMe) {
    return {
      success: false,
      status: 403,
      error: "Можно удалять только свои сообщения"
    };
  }

  await pool.query(
    `
    DELETE FROM messages
    WHERE id = $1
    `,
    [messageId]
  );

  return {
    success: true,
    message
  };
}

function emitEditedMessage(message) {
  const payload = {
    id: String(message.id),
    messageId: String(message.id),
    chatId: message.chatId,
    groupId: message.groupId,
    type: message.type,
    text: message.text,
    message: message.text,
    edited: true,
    updatedAt: message.updatedAt
  };

  io.to(`chat:${message.chatId}`).emit("message_edited", payload);
  io.to(`chat:${message.chatId}`).emit("message-edited", payload);

  if (message.type === "direct") {
    io.to(`user:${message.from}`).emit("message_edited", payload);
    io.to(`user:${message.to}`).emit("message_edited", payload);
    io.to(`user:${message.from}`).emit("message-edited", payload);
    io.to(`user:${message.to}`).emit("message-edited", payload);
  }

  if (message.type === "group") {
    io.to(`chat:${message.chatId}`).emit("group_message_edited", payload);
  }
}

function emitDeletedMessage(message) {
  const payload = {
    id: String(message.id),
    messageId: String(message.id),
    chatId: message.chatId,
    groupId: message.groupId,
    from: message.from,
    to: message.to,
    type: message.type
  };

  io.to(`chat:${message.chatId}`).emit("message_deleted", payload);
  io.to(`chat:${message.chatId}`).emit("message-deleted", payload);

  if (message.type === "direct") {
    io.to(`user:${message.from}`).emit("message_deleted", payload);
    io.to(`user:${message.to}`).emit("message_deleted", payload);
    io.to(`user:${message.from}`).emit("message-deleted", payload);
    io.to(`user:${message.to}`).emit("message-deleted", payload);
  }

  if (message.type === "group") {
    io.to(`chat:${message.chatId}`).emit("group_message_deleted", payload);
  }
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
      database: "postgres",
      passwords: "bcrypt",
      realtime: "online_typing",
      avatars: "enabled",
      deleteMessages: "enabled",
      editMessages: "enabled",
      replyMessages: "enabled",
      profileEdit: "enabled"
    });
  } catch (error) {
    console.error("Health error:", error);

    res.status(500).json({
      success: false,
      error: "Database error"
    });
  }
});

app.get("/api/status/:username", (req, res) => {
  const username = normalizeUsername(req.params.username);

  res.json({
    success: true,
    username,
    online: isUserOnline(username)
  });
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
    const cleanDisplayName = displayName ? String(displayName).trim() : cleanUsername;

    if (!cleanUsername) {
      return res.status(400).json({
        success: false,
        error: "Введите логин"
      });
    }

    if (String(password).length < 3) {
      return res.status(400).json({
        success: false,
        error: "Пароль слишком короткий"
      });
    }

    const exists = await findUser(cleanUsername);

    if (exists) {
      return res.status(400).json({
        success: false,
        error: "Пользователь уже существует"
      });
    }

    const hashedPassword = await hashPassword(password);

    const result = await pool.query(
      `
      INSERT INTO users (display_name, username, password, avatar)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [cleanDisplayName, cleanUsername, hashedPassword, ""]
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
      "SELECT * FROM users WHERE username = $1",
      [cleanUsername]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Неверный логин или пароль"
      });
    }

    const passwordOk = await verifyPassword(password, user.password, cleanUsername);

    if (!passwordOk) {
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

app.put("/api/profile", async (req, res) => {
  const client = await pool.connect();

  try {
    const oldUsername = normalizeUsername(req.body.oldUsername || req.body.username);
    const newUsername = normalizeUsername(req.body.newUsername || req.body.username);
    const displayName = String(req.body.displayName || "").trim();
    const avatar = String(req.body.avatar || "");

    if (!oldUsername) {
      return res.status(400).json({
        success: false,
        error: "Не указан текущий пользователь"
      });
    }

    if (!newUsername) {
      return res.status(400).json({
        success: false,
        error: "Введите username"
      });
    }

    if (!displayName) {
      return res.status(400).json({
        success: false,
        error: "Введите имя"
      });
    }

    if (!/^[a-z0-9_]{3,24}$/.test(newUsername)) {
      return res.status(400).json({
        success: false,
        error: "Username должен быть 3-24 символа: латиница, цифры или _"
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

    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT * FROM users WHERE username = $1",
      [oldUsername]
    );

    const user = userResult.rows[0];

    if (!user) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        error: "Пользователь не найден"
      });
    }

    if (oldUsername !== newUsername) {
      const existsResult = await client.query(
        "SELECT username FROM users WHERE username = $1",
        [newUsername]
      );

      if (existsResult.rows[0]) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          error: "Такой username уже занят"
        });
      }
    }

    const updatedUserResult = await client.query(
      `
      UPDATE users
      SET username = $1,
          display_name = $2,
          avatar = $3
      WHERE username = $4
      RETURNING *
      `,
      [newUsername, displayName, avatar, oldUsername]
    );

    await client.query(
      `
      UPDATE messages
      SET from_username = $1
      WHERE from_username = $2
      `,
      [newUsername, oldUsername]
    );

    await client.query(
      `
      UPDATE messages
      SET to_username = $1
      WHERE to_username = $2
      `,
      [newUsername, oldUsername]
    );

    await client.query(
      `
      UPDATE messages
      SET username = $1,
          display_name = $2,
          avatar = $3
      WHERE username = $4
      `,
      [newUsername, displayName, avatar, oldUsername]
    );

    await client.query(
      `
      UPDATE groups
      SET owner = $1
      WHERE owner = $2
      `,
      [newUsername, oldUsername]
    );

    await client.query(
      `
      UPDATE groups
      SET members = array_replace(members, $1, $2)
      WHERE $1 = ANY(members)
      `,
      [oldUsername, newUsername]
    );

    await updateDirectChatIdsForUsername(client, newUsername);

    await client.query("COMMIT");

    const updatedUser = publicUser(updatedUserResult.rows[0]);

    moveOnlineUser(oldUsername, newUsername);

    io.emit("profile_updated", {
      oldUsername,
      user: updatedUser
    });

    res.json({
      success: true,
      user: updatedUser
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Profile update error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка обновления профиля"
    });
  } finally {
    client.release();
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

    const updatedUser = publicUser(result.rows[0]);

    io.emit("profile_updated", {
      oldUsername: username,
      user: updatedUser
    });

    res.json({
      success: true,
      user: updatedUser
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

    const users = result.rows.map((user) => ({
      ...publicUser(user),
      online: isUserOnline(user.username)
    }));

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error("Users error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка поиска пользователей"
    });
  }
});

app.get("/api/chats", async (req, res) => {
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
      WITH direct_chats AS (
        SELECT
          CASE
            WHEN from_username = $1 THEN to_username
            ELSE from_username
          END AS other_username,
          MAX(id) AS last_message_id
        FROM messages
        WHERE type = 'direct'
          AND (from_username = $1 OR to_username = $1)
        GROUP BY other_username
      )
      SELECT
        u.id,
        u.display_name,
        u.username,
        u.avatar,
        m.text AS last_message_text,
        m.media AS last_message_media,
        m.created_at AS last_message_at
      FROM direct_chats dc
      JOIN users u ON u.username = dc.other_username
      JOIN messages m ON m.id = dc.last_message_id
      ORDER BY m.id DESC
      `,
      [me]
    );

    const chats = result.rows.map((row) => ({
      ...publicUser(row),
      online: isUserOnline(row.username),
      lastMessageText: row.last_message_text || "",
      lastMessageMedia: row.last_message_media || null,
      lastMessageAt: row.last_message_at
    }));

    res.json({
      success: true,
      chats
    });
  } catch (error) {
    console.error("Chats error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка загрузки личных чатов"
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

app.put("/api/messages/:id", async (req, res) => {
  try {
    const messageId = String(req.params.id);
    const me = normalizeUsername(req.body.me || req.query.me);
    const text = String(req.body.text || req.body.message || "").trim();

    const result = await editMessage({
      messageId,
      me,
      text
    });

    if (!result.success) {
      return res.status(result.status || 400).json({
        success: false,
        error: result.error
      });
    }

    emitEditedMessage(result.message);

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error("Edit message error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка редактирования сообщения"
    });
  }
});

app.delete("/api/messages/:id", async (req, res) => {
  try {
    const messageId = String(req.params.id);
    const me = normalizeUsername(req.query.me || req.body.me);

    const result = await deleteMessageById({
      messageId,
      me
    });

    if (!result.success) {
      return res.status(result.status || 400).json({
        success: false,
        error: result.error
      });
    }

    emitDeletedMessage(result.message);

    res.json({
      success: true,
      deleted: true,
      message: {
        id: String(result.message.id),
        chatId: result.message.chatId,
        from: result.message.from,
        to: result.message.to,
        type: result.message.type,
        groupId: result.message.groupId
      }
    });
  } catch (error) {
    console.error("Delete message error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка удаления сообщения"
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
    const missingUsers = members.filter((username) => !foundUsers.includes(username));

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
    const missingUsers = newMembers.filter((username) => !foundUsers.includes(username));

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

    const updatedGroup = publicGroup(result.rows[0]);

    io.to(`chat:${getGroupChatId(groupId)}`).emit("group_updated", updatedGroup);

    res.json({
      success: true,
      group: updatedGroup
    });
  } catch (error) {
    console.error("Invite group error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка добавления участников"
    });
  }
});

app.post("/api/groups/:id/leave", async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const me = normalizeUsername(req.body.me);

    if (!me) {
      return res.status(400).json({
        success: false,
        error: "Не указан пользователь"
      });
    }

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

    const newMembers = (group.members || []).filter((member) => member !== me);
    const chatId = getGroupChatId(groupId);

    if (newMembers.length === 0) {
      await pool.query("DELETE FROM messages WHERE chat_id = $1", [chatId]);
      await pool.query("DELETE FROM groups WHERE id = $1", [groupId]);

      io.to(`chat:${chatId}`).emit("group_deleted", {
        groupId: String(groupId)
      });

      res.json({
        success: true,
        deleted: true
      });

      return;
    }

    let newOwner = group.owner;

    if (group.owner === me) {
      newOwner = newMembers[0];
    }

    const updateResult = await pool.query(
      `
      UPDATE groups
      SET members = $1, owner = $2
      WHERE id = $3
      RETURNING *
      `,
      [newMembers, newOwner, groupId]
    );

    const updatedGroup = publicGroup(updateResult.rows[0]);

    io.to(`chat:${chatId}`).emit("group_updated", updatedGroup);
    io.to(`user:${me}`).emit("group_left", {
      groupId: String(groupId)
    });

    res.json({
      success: true,
      deleted: false,
      group: updatedGroup
    });
  } catch (error) {
    console.error("Leave group error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка выхода из группы"
    });
  }
});

app.delete("/api/groups/:id", async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const me = normalizeUsername(req.query.me || req.body.me);

    if (!me) {
      return res.status(400).json({
        success: false,
        error: "Не указан пользователь"
      });
    }

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

    if (group.owner !== me) {
      return res.status(403).json({
        success: false,
        error: "Удалить группу может только создатель"
      });
    }

    const chatId = getGroupChatId(groupId);

    await pool.query("DELETE FROM messages WHERE chat_id = $1", [chatId]);
    await pool.query("DELETE FROM groups WHERE id = $1", [groupId]);

    io.to(`chat:${chatId}`).emit("group_deleted", {
      groupId: String(groupId)
    });

    (group.members || []).forEach((member) => {
      io.to(`user:${member}`).emit("group_deleted", {
        groupId: String(groupId)
      });
    });

    res.json({
      success: true,
      deleted: true
    });
  } catch (error) {
    console.error("Delete group error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка удаления группы"
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

    setUserOnline(username, socket.id);

    console.log("Online:", username);
  });

  socket.on("check_user_status", (data) => {
    const username = normalizeUsername(data && data.username);

    if (!username) return;

    socket.emit("user_status", {
      username,
      online: isUserOnline(username)
    });
  });

  socket.on("typing_start", (data) => {
    const from = normalizeUsername(data && data.from);
    const to = normalizeUsername(data && data.to);
    const groupId = String((data && data.groupId) || "");
    const chatType = String((data && data.chatType) || "");

    if (!from) return;

    if (chatType === "direct" && to) {
      io.to(`user:${to}`).emit("typing_start", {
        from,
        to,
        chatType: "direct"
      });
    }

    if (chatType === "group" && groupId) {
      io.to(`chat:${getGroupChatId(groupId)}`).emit("typing_start", {
        from,
        groupId,
        chatType: "group"
      });
    }
  });

  socket.on("typing_stop", (data) => {
    const from = normalizeUsername(data && data.from);
    const to = normalizeUsername(data && data.to);
    const groupId = String((data && data.groupId) || "");
    const chatType = String((data && data.chatType) || "");

    if (!from) return;

    if (chatType === "direct" && to) {
      io.to(`user:${to}`).emit("typing_stop", {
        from,
        to,
        chatType: "direct"
      });
    }

    if (chatType === "group" && groupId) {
      io.to(`chat:${getGroupChatId(groupId)}`).emit("typing_stop", {
        from,
        groupId,
        chatType: "group"
      });
    }
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

      socket.emit("user_status", {
        username: withUser,
        online: isUserOnline(withUser)
      });
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
      const replyTo = cleanReplyTo(data && (data.replyTo || data.reply_to));

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
        media,
        replyTo
      });

      io.to(`user:${from}`).emit("new_message", savedMessage);
      io.to(`user:${to}`).emit("new_message", savedMessage);
      io.to(`chat:${chatId}`).emit("new_message", savedMessage);

      io.to(`user:${to}`).emit("typing_stop", {
        from,
        to,
        chatType: "direct"
      });
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
      const replyTo = cleanReplyTo(data && (data.replyTo || data.reply_to));

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
        media,
        replyTo
      });

      io.to(`chat:${chatId}`).emit("new_group_message", savedMessage);

      (group.members || []).forEach((member) => {
        io.to(`user:${member}`).emit("new_group_message", savedMessage);
      });

      io.to(`chat:${chatId}`).emit("typing_stop", {
        from,
        groupId,
        chatType: "group"
      });
    } catch (error) {
      console.error("Send group message error:", error);
    }
  });

  socket.on("edit_message", async (data) => {
    try {
      const messageId = String((data && (data.messageId || data.id)) || "");
      const me = normalizeUsername(data && (data.me || data.from || data.username));
      const text = String((data && (data.text || data.message)) || "").trim();

      const result = await editMessage({
        messageId,
        me,
        text
      });

      if (!result.success) {
        socket.emit("message_error", {
          action: "edit",
          error: result.error
        });

        return;
      }

      emitEditedMessage(result.message);
    } catch (error) {
      console.error("Socket edit message error:", error);

      socket.emit("message_error", {
        action: "edit",
        error: "Ошибка редактирования сообщения"
      });
    }
  });

  socket.on("edit-message", async (data) => {
    try {
      const messageId = String((data && (data.messageId || data.id)) || "");
      const me = normalizeUsername(data && (data.me || data.from || data.username));
      const text = String((data && (data.text || data.message)) || "").trim();

      const result = await editMessage({
        messageId,
        me,
        text
      });

      if (!result.success) {
        socket.emit("message_error", {
          action: "edit",
          error: result.error
        });

        return;
      }

      emitEditedMessage(result.message);
    } catch (error) {
      console.error("Socket edit-message error:", error);

      socket.emit("message_error", {
        action: "edit",
        error: "Ошибка редактирования сообщения"
      });
    }
  });

  socket.on("delete_message", async (data) => {
    try {
      const messageId = String((data && (data.messageId || data.id)) || "");
      const me = normalizeUsername(data && (data.me || data.from || data.username));

      const result = await deleteMessageById({
        messageId,
        me
      });

      if (!result.success) {
        socket.emit("message_error", {
          action: "delete",
          error: result.error
        });

        return;
      }

      emitDeletedMessage(result.message);
    } catch (error) {
      console.error("Socket delete message error:", error);

      socket.emit("message_error", {
        action: "delete",
        error: "Ошибка удаления сообщения"
      });
    }
  });

  socket.on("delete-message", async (data) => {
    try {
      const messageId = String((data && (data.messageId || data.id)) || "");
      const me = normalizeUsername(data && (data.me || data.from || data.username));

      const result = await deleteMessageById({
        messageId,
        me
      });

      if (!result.success) {
        socket.emit("message_error", {
          action: "delete",
          error: result.error
        });

        return;
      }

      emitDeletedMessage(result.message);
    } catch (error) {
      console.error("Socket delete-message error:", error);

      socket.emit("message_error", {
        action: "delete",
        error: "Ошибка удаления сообщения"
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");

    if (socket.username) {
      setUserOffline(socket.username, socket.id);
    }
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Dark Messenger server started");
  console.log("Server started on port", PORT);
});