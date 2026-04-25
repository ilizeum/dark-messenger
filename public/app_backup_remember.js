const API_URL = "";
const socket = io();

let currentUser = null;
let selectedUser = null;
let usersCache = [];
let messagesCache = [];

const auth = document.getElementById("auth");
const app = document.getElementById("app");

const displayNameInput = document.getElementById("displayName");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const authError = document.getElementById("authError");

const meName = document.getElementById("meName");
const meLogin = document.getElementById("meLogin");
const logoutBtn = document.getElementById("logoutBtn");

const searchInput = document.getElementById("search");
const usersBox = document.getElementById("users");

const chatAvatar = document.getElementById("chatAvatar");
const chatName = document.getElementById("chatName") || document.getElementById("chatTitle");
const chatStatus = document.getElementById("chatStatus");

const messagesBox = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

function showError(text) {
  if (authError) {
    authError.textContent = text || "Ошибка";
  }
}

function clearError() {
  if (authError) {
    authError.textContent = "";
  }
}

function getInputData() {
  return {
    displayName: displayNameInput ? displayNameInput.value.trim() : "",
    username: usernameInput ? usernameInput.value.trim().toLowerCase().replace(/^@/, "") : "",
    password: passwordInput ? passwordInput.value : ""
  };
}

async function request(url, options = {}) {
  const response = await fetch(API_URL + url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Ошибка сервера");
  }

  return data;
}

function saveUser(user) {
  localStorage.setItem("darkMessengerUser", JSON.stringify(user));
}

function loadSavedUser() {
  try {
    const raw = localStorage.getItem("darkMessengerUser");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function logout() {
  localStorage.removeItem("darkMessengerUser");

  currentUser = null;
  selectedUser = null;
  usersCache = [];
  messagesCache = [];

  if (app) app.classList.add("hidden");
  if (auth) auth.classList.remove("hidden");

  if (messageInput) messageInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
}

async function register() {
  clearError();

  const { displayName, username, password } = getInputData();

  if (!username || !password) {
    showError("Введите логин и пароль");
    return;
  }

  try {
    const data = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({
        displayName,
        username,
        password
      })
    });

    currentUser = data.user;
    saveUser(currentUser);
    startApp();
  } catch (error) {
    showError(error.message);
  }
}

async function login() {
  clearError();

  const { username, password } = getInputData();

  if (!username || !password) {
    showError("Введите логин и пароль");
    return;
  }

  try {
    const data = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
    });

    currentUser = data.user;
    saveUser(currentUser);
    startApp();
  } catch (error) {
    showError(error.message);
  }
}

async function startApp() {
  if (!currentUser) return;

  if (auth) auth.classList.add("hidden");
  if (app) app.classList.remove("hidden");

  if (meName) meName.textContent = currentUser.displayName || currentUser.username;
  if (meLogin) meLogin.textContent = "@" + currentUser.username;

  if (searchInput) {
    searchInput.value = "";
    searchInput.placeholder = "Поиск по @id, например @ilizeum";
  }

  socket.emit("user_online", {
    username: currentUser.username
  });

  renderSearchHint();
  renderEmptyChat();
}

async function loadUsers(query = "") {
  if (!currentUser) return;

  const cleanQuery = String(query || "").trim().replace(/^@/, "").toLowerCase();

  if (!cleanQuery) {
    usersCache = [];
    renderSearchHint();
    return;
  }

  try {
    const data = await request(
      `/api/users?me=${encodeURIComponent(currentUser.username)}&q=${encodeURIComponent(cleanQuery)}`
    );

    usersCache = data.users || [];
    renderUsers(cleanQuery);
  } catch (error) {
    console.error(error);
    if (usersBox) {
      usersBox.innerHTML = `<div class="empty">Ошибка поиска</div>`;
    }
  }
}

function renderSearchHint() {
  if (!usersBox) return;

  usersBox.innerHTML = `
    <div class="empty">
      Введите @id пользователя, чтобы найти чат.<br>
      Например: <b>@ilizeum</b>
    </div>
  `;
}

function renderUsers(query = "") {
  if (!usersBox) return;

  usersBox.innerHTML = "";

  if (!usersCache.length) {
    usersBox.innerHTML = `
      <div class="empty">
        Пользователь не найден.<br>
        Проверь @id: <b>@${escapeHtml(query)}</b>
      </div>
    `;
    return;
  }

  usersCache.forEach((user) => {
    const item = document.createElement("button");
    item.className = "user";

    if (selectedUser && selectedUser.username === user.username) {
      item.classList.add("active");
    }

    item.innerHTML = `
      <div class="avatar">${escapeHtml((user.displayName || user.username)[0] || "?")}</div>
      <div class="user-info">
        <b>${escapeHtml(user.displayName || user.username)}</b>
        <span>@${escapeHtml(user.username)}</span>
      </div>
    `;

    item.addEventListener("click", () => {
      openChat(user);
    });

    usersBox.appendChild(item);
  });
}

function renderEmptyChat() {
  selectedUser = null;
  messagesCache = [];

  if (chatAvatar) chatAvatar.textContent = "?";
  if (chatName) chatName.textContent = "Выберите чат";
  if (chatStatus) chatStatus.textContent = "Найдите пользователя по @id";

  if (messagesBox) {
    messagesBox.innerHTML = `
      <div class="empty">
        Чаты не показываются автоматически.<br>
        Найдите пользователя через поиск слева.
      </div>
    `;
  }

  if (messageInput) {
    messageInput.value = "";
    messageInput.disabled = true;
  }

  if (sendBtn) {
    sendBtn.disabled = true;
  }
}

async function openChat(user) {
  selectedUser = user;
  messagesCache = [];

  if (chatAvatar) chatAvatar.textContent = (user.displayName || user.username)[0] || "?";
  if (chatName) chatName.textContent = user.displayName || user.username;
  if (chatStatus) chatStatus.textContent = "@" + user.username;

  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;

  if (messagesBox) {
    messagesBox.innerHTML = `<div class="empty">Загрузка...</div>`;
  }

  socket.emit("open_chat", {
    me: currentUser.username,
    with: selectedUser.username
  });

  try {
    const data = await request(
      `/api/messages?me=${encodeURIComponent(currentUser.username)}&with=${encodeURIComponent(selectedUser.username)}`
    );

    messagesCache = data.messages || [];
    renderMessages();
    renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
  } catch (error) {
    if (messagesBox) {
      messagesBox.innerHTML = `<div class="empty">Ошибка загрузки сообщений</div>`;
    }
  }
}

function sendMessage() {
  if (!currentUser || !selectedUser) return;

  const text = messageInput ? messageInput.value.trim() : "";

  if (!text) return;

  socket.emit("send_message", {
    from: currentUser.username,
    to: selectedUser.username,
    text
  });

  if (messageInput) {
    messageInput.value = "";
    messageInput.focus();
  }
}

function renderMessages() {
  if (!messagesBox) return;

  messagesBox.innerHTML = "";

  if (!messagesCache.length) {
    messagesBox.innerHTML = `<div class="empty">Сообщений пока нет. Напиши первым.</div>`;
    return;
  }

  messagesCache.forEach((message) => {
    const mine = message.from === currentUser.username || message.username === currentUser.username;

    const bubble = document.createElement("div");
    bubble.className = mine ? "message mine" : "message";

    const text = message.text || message.message || "";

    bubble.innerHTML = `
      <div class="message-name">${escapeHtml(message.displayName || message.username || "")}</div>
      <div class="message-text">${escapeHtml(text)}</div>
      <div class="message-time">${formatTime(message.created_at)}</div>
    `;

    messagesBox.appendChild(bubble);
  });

  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function shouldShowIncoming(message) {
  if (!currentUser || !selectedUser) return false;

  const from = message.from || message.username;
  const to = message.to;

  return (
    (from === currentUser.username && to === selectedUser.username) ||
    (from === selectedUser.username && to === currentUser.username)
  );
}

socket.on("load_messages", (messages) => {
  messagesCache = Array.isArray(messages) ? messages : [];
  renderMessages();
});

socket.on("new_message", (message) => {
  if (shouldShowIncoming(message)) {
    const exists = messagesCache.some((m) => m.id === message.id);

    if (!exists) {
      messagesCache.push(message);
      renderMessages();
    }
  }
});

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

if (loginBtn) loginBtn.addEventListener("click", login);
if (registerBtn) registerBtn.addEventListener("click", register);
if (logoutBtn) logoutBtn.addEventListener("click", logout);

if (searchInput) {
  searchInput.addEventListener("input", () => {
    loadUsers(searchInput.value);
  });
}

if (sendBtn) {
  sendBtn.addEventListener("click", sendMessage);
}

if (messageInput) {
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
}

const savedUser = loadSavedUser();

if (savedUser) {
  currentUser = savedUser;
  startApp();
}