const API_URL = "";
const socket = io();

let currentUser = null;
let selectedUser = null;
let selectedGroup = null;
let selectedChatType = null;

let usersCache = [];
let recentChatsCache = [];
let groupsCache = [];
let messagesCache = [];

let unreadDirect = {};
let unreadGroups = {};
let onlineUsers = {};
let typingUsers = {};

let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let isRecording = false;
let recordingStartTime = 0;
let recordingTimerInterval = null;

let notificationPermissionRequested = false;
let typingTimer = null;
let isTypingNow = false;
let profileAvatarDraft = "";

let replyToMessage = null;
let editingMessage = null;
let contextSelectedMessage = null;
let selectedMessageIds = new Set();
let selectionMode = false;

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ARCHIVE_KEY_PREFIX = "callibri_archive_";
const SETTINGS_KEY_PREFIX = "callibri_settings_";

const auth = document.getElementById("auth");
const app = document.getElementById("app");

const displayNameInput = document.getElementById("displayName");
const usernameInput = document.getElementById("username");
const phoneInput = document.getElementById("phone");
const passwordInput = document.getElementById("password");
const togglePasswordBtn = document.getElementById("togglePassword");
const rememberMeInput = document.getElementById("rememberMe");
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

let recentChatsBox = null;
let groupsBox = null;
let createGroupBtn = null;
let archiveBtn = null;
let groupActionsBox = null;
let fileInput = null;
let attachBtn = null;
let voiceBtn = null;
let profileAvatarBtn = null;
let settingsBtn = null;
let recordingPanel = null;

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase().replace(/^@/, "");
}

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
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function showError(text) {
  if (authError) authError.textContent = text || "Ошибка";
}

function clearError() {
  if (authError) authError.textContent = "";
}

function getInputData() {
  return {
    displayName: displayNameInput ? displayNameInput.value.trim() : "",
    username: usernameInput ? usernameInput.value.trim() : "",
    phone: phoneInput ? phoneInput.value.trim() : "",
    password: passwordInput ? passwordInput.value : ""
  };
}

async function request(url, options = {}) {
  const response = await fetch(API_URL + url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Ошибка сервера");
  }

  return data;
}

function saveUser(user) {
  const remember = rememberMeInput ? rememberMeInput.checked : false;
  localStorage.removeItem("darkMessengerUser");
  sessionStorage.removeItem("darkMessengerUser");
  localStorage.removeItem("callibriUser");
  sessionStorage.removeItem("callibriUser");

  if (remember) localStorage.setItem("callibriUser", JSON.stringify(user));
  else sessionStorage.setItem("callibriUser", JSON.stringify(user));
}

function updateSavedUser(user) {
  currentUser = user;
  const useLocal = Boolean(localStorage.getItem("callibriUser") || localStorage.getItem("darkMessengerUser"));
  localStorage.removeItem("darkMessengerUser");
  sessionStorage.removeItem("darkMessengerUser");
  localStorage.removeItem("callibriUser");
  sessionStorage.removeItem("callibriUser");
  if (useLocal) localStorage.setItem("callibriUser", JSON.stringify(user));
  else sessionStorage.setItem("callibriUser", JSON.stringify(user));
}

function loadSavedUser() {
  try {
    const localUser = localStorage.getItem("callibriUser") || localStorage.getItem("darkMessengerUser");
    const sessionUser = sessionStorage.getItem("callibriUser") || sessionStorage.getItem("darkMessengerUser");
    if (localUser) {
      if (rememberMeInput) rememberMeInput.checked = true;
      return JSON.parse(localUser);
    }
    if (sessionUser) {
      if (rememberMeInput) rememberMeInput.checked = false;
      return JSON.parse(sessionUser);
    }
  } catch {}
  return null;
}

function updateUnreadTitle() {
  const totalDirect = Object.values(unreadDirect).reduce((sum, value) => sum + value, 0);
  const totalGroups = Object.values(unreadGroups).reduce((sum, value) => sum + value, 0);
  const total = totalDirect + totalGroups;
  document.title = total > 0 ? `(${total}) Callibri` : "Callibri";
}

async function register() {
  clearError();
  const { displayName, username, phone, password } = getInputData();
  if (!username || !password) {
    showError("Введите логин и пароль");
    return;
  }

  try {
    const data = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({ displayName, username, phone, password })
    });
    currentUser = data.user;
    saveUser(currentUser);
    await startApp();
  } catch (error) {
    showError(error.message);
  }
}

async function login() {
  clearError();
  const { username, password } = getInputData();
  if (!username || !password) {
    showError("Введите логин/телефон и пароль");
    return;
  }

  try {
    const data = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    currentUser = data.user;
    saveUser(currentUser);
    await startApp();
  } catch (error) {
    showError(error.message);
  }
}

function logout() {
  cancelVoiceRecording();
  stopTyping();
  localStorage.removeItem("darkMessengerUser");
  sessionStorage.removeItem("darkMessengerUser");
  localStorage.removeItem("callibriUser");
  sessionStorage.removeItem("callibriUser");

  currentUser = null;
  selectedUser = null;
  selectedGroup = null;
  selectedChatType = null;
  messagesCache = [];
  unreadDirect = {};
  unreadGroups = {};
  updateUnreadTitle();

  if (app) app.classList.add("hidden");
  if (auth) auth.classList.remove("hidden");
  renderEmptyChat();
}

function archiveKey() {
  return ARCHIVE_KEY_PREFIX + (currentUser ? currentUser.username : "guest");
}

function loadArchive() {
  try {
    const data = JSON.parse(localStorage.getItem(archiveKey()) || "{}");
    return { direct: data.direct || {}, groups: data.groups || {}, open: Boolean(data.open) };
  } catch {
    return { direct: {}, groups: {}, open: false };
  }
}

function saveArchive(data) {
  localStorage.setItem(archiveKey(), JSON.stringify(data));
}

function isArchivedDirect(username) {
  return Boolean(loadArchive().direct[normalizeUsername(username)]);
}

function isArchivedGroup(id) {
  return Boolean(loadArchive().groups[String(id)]);
}

function isArchiveOpen() {
  return loadArchive().open;
}

function setArchiveOpen(open) {
  const data = loadArchive();
  data.open = Boolean(open);
  saveArchive(data);
}

function archiveChat(type, id, archived) {
  const data = loadArchive();
  if (type === "direct") {
    if (archived) data.direct[normalizeUsername(id)] = true;
    else delete data.direct[normalizeUsername(id)];
  }
  if (type === "group") {
    if (archived) data.groups[String(id)] = true;
    else delete data.groups[String(id)];
  }
  saveArchive(data);
  if (selectedChatType === type) {
    if (type === "direct" && selectedUser && selectedUser.username === normalizeUsername(id)) renderEmptyChat();
    if (type === "group" && selectedGroup && String(selectedGroup.id) === String(id)) renderEmptyChat();
  }
  renderRecentChats();
  renderGroups();
  renderArchiveButton();
}

function renderArchiveButton() {
  if (!archiveBtn) return;
  const data = loadArchive();
  const count = Object.keys(data.direct).length + Object.keys(data.groups).length;
  archiveBtn.classList.toggle("active", data.open);
  archiveBtn.innerHTML = `
    <div class="archive-icon">${data.open ? "←" : "🗂"}</div>
    <div class="archive-info">
      <b>${data.open ? "Все чаты" : "Архив"}</b>
      <span>${data.open ? "Вернуться назад" : "Скрытые чаты"}</span>
    </div>
    ${count && !data.open ? `<div class="archive-badge">${count > 99 ? "99+" : count}</div>` : ""}
  `;
}

function setupSidebarUI() {
  if (!usersBox || !usersBox.parentElement) return;

  if (!archiveBtn) {
    archiveBtn = document.getElementById("archiveToggleBtn") || document.createElement("button");
    archiveBtn.id = "archiveToggleBtn";
    archiveBtn.type = "button";
    archiveBtn.className = "archive-btn";
    archiveBtn.addEventListener("click", () => {
      setArchiveOpen(!isArchiveOpen());
      renderRecentChats();
      renderGroups();
      renderArchiveButton();
    });
    if (!archiveBtn.parentElement) usersBox.parentElement.insertBefore(archiveBtn, usersBox);
  }

  if (!createGroupBtn) {
    createGroupBtn = document.getElementById("createGroupBtn") || document.createElement("button");
    createGroupBtn.id = "createGroupBtn";
    createGroupBtn.type = "button";
    createGroupBtn.textContent = "+ Создать группу";
    createGroupBtn.addEventListener("click", openGroupModal);
    if (!createGroupBtn.parentElement) usersBox.parentElement.insertBefore(createGroupBtn, usersBox);
  }

  if (!recentChatsBox) {
    const title = document.createElement("div");
    title.className = "sidebar-title";
    title.textContent = "Личные чаты";
    recentChatsBox = document.createElement("div");
    recentChatsBox.id = "recentChats";
    usersBox.parentElement.insertBefore(title, usersBox);
    usersBox.parentElement.insertBefore(recentChatsBox, usersBox);
  }

  if (!groupsBox) {
    const title = document.createElement("div");
    title.className = "sidebar-title";
    title.textContent = "Группы";
    groupsBox = document.createElement("div");
    groupsBox.id = "groups";
    usersBox.parentElement.insertBefore(title, usersBox);
    usersBox.parentElement.insertBefore(groupsBox, usersBox);
  }

  if (!document.getElementById("usersTitle")) {
    const usersTitle = document.createElement("div");
    usersTitle.id = "usersTitle";
    usersTitle.className = "sidebar-title";
    usersTitle.textContent = "Поиск пользователей";
    usersBox.parentElement.insertBefore(usersTitle, usersBox);
  }

  renderArchiveButton();
}

function renderAvatar(user) {
  const name = (user && (user.displayName || user.display_name || user.username)) || "?";
  const avatar = user && user.avatar;
  if (avatar) return `<div class="avatar"><img src="${avatar}" alt="avatar"></div>`;
  return `<div class="avatar">${escapeHtml(name[0] || "?").toUpperCase()}</div>`;
}

function unreadBadge(count) {
  if (!count || count <= 0) return "";
  return `<span class="unread-badge">${count > 99 ? "99+" : count}</span>`;
}

function onlineDot(username) {
  const online = onlineUsers[normalizeUsername(username)];
  return `<span class="online-dot ${online ? "online" : ""}"></span>`;
}

function getChatPreview(user) {
  if (typingUsers[user.username]) return "печатает...";
  if (user.lastMessageText) return user.lastMessageText;
  if (user.lastMessageMedia) {
    if (user.lastMessageMedia.type === "image") return "Фото";
    if (user.lastMessageMedia.type === "video") return "Видео";
    if (user.lastMessageMedia.type === "audio") return "Голосовое";
  }
  return onlineUsers[user.username] ? "онлайн" : "офлайн";
}

async function loadRecentChats() {
  if (!currentUser) return;
  try {
    const data = await request(`/api/chats?me=${encodeURIComponent(currentUser.username)}`);
    recentChatsCache = data.chats || [];
    recentChatsCache.forEach((chat) => {
      onlineUsers[chat.username] = Boolean(chat.online);
    });
    renderRecentChats();
  } catch (error) {
    console.error(error);
    if (recentChatsBox) recentChatsBox.innerHTML = `<div class="empty small-empty">Ошибка загрузки чатов</div>`;
  }
}

async function loadGroups() {
  if (!currentUser) return;
  try {
    const data = await request(`/api/groups?me=${encodeURIComponent(currentUser.username)}`);
    groupsCache = data.groups || [];
    renderGroups();
  } catch (error) {
    console.error(error);
    if (groupsBox) groupsBox.innerHTML = `<div class="empty small-empty">Ошибка загрузки групп</div>`;
  }
}

function renderRecentChats() {
  if (!recentChatsBox) return;
  const archiveOpen = isArchiveOpen();
  const chats = recentChatsCache.filter((chat) => archiveOpen ? isArchivedDirect(chat.username) : !isArchivedDirect(chat.username));
  recentChatsBox.innerHTML = "";

  if (!chats.length) {
    recentChatsBox.innerHTML = `<div class="empty small-empty">${archiveOpen ? "В архиве личных чатов нет" : "Личных чатов пока нет"}</div>`;
    return;
  }

  chats.forEach((user) => {
    const item = document.createElement("button");
    item.className = "user recent-chat-item";
    if (selectedChatType === "direct" && selectedUser && selectedUser.username === user.username) item.classList.add("active");
    item.innerHTML = `
      ${renderAvatar(user)}
      <div class="user-info">
        <b>${onlineDot(user.username)}${escapeHtml(user.displayName || user.username)}</b>
        <span>${escapeHtml(getChatPreview(user))}</span>
      </div>
      ${unreadBadge(unreadDirect[user.username] || 0)}
    `;
    item.addEventListener("click", () => openChat(user));
    item.addEventListener("contextmenu", (event) => openSidebarMenu(event, "direct", user));
    recentChatsBox.appendChild(item);
  });
}

function renderGroups() {
  if (!groupsBox) return;
  const archiveOpen = isArchiveOpen();
  const groups = groupsCache.filter((group) => archiveOpen ? isArchivedGroup(group.id) : !isArchivedGroup(group.id));
  groupsBox.innerHTML = "";

  if (!groups.length) {
    groupsBox.innerHTML = `<div class="empty small-empty">${archiveOpen ? "В архиве групп нет" : "Групп пока нет"}</div>`;
    return;
  }

  groups.forEach((group) => {
    const item = document.createElement("button");
    item.className = "user group-item";
    if (selectedChatType === "group" && selectedGroup && selectedGroup.id === group.id) item.classList.add("active");
    item.innerHTML = `
      <div class="avatar group-avatar">#</div>
      <div class="user-info">
        <b>${escapeHtml(group.name)}</b>
        <span>${(group.members || []).length} участн.</span>
      </div>
      ${unreadBadge(unreadGroups[group.id] || 0)}
    `;
    item.addEventListener("click", () => openGroup(group));
    item.addEventListener("contextmenu", (event) => openSidebarMenu(event, "group", group));
    groupsBox.appendChild(item);
  });
}

function openSidebarMenu(event, type, item) {
  event.preventDefault();
  document.querySelectorAll(".callibri-sidebar-context-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "callibri-sidebar-context-menu";
  const id = type === "direct" ? item.username : item.id;
  const archived = type === "direct" ? isArchivedDirect(id) : isArchivedGroup(id);
  menu.innerHTML = `
    <button data-action="open"><span>↗</span>Открыть чат</button>
    <button data-action="archive" class="archive"><span>${archived ? "↩" : "🗂"}</span>${archived ? "Вернуть из архива" : "Архивировать"}</button>
    <div class="callibri-sidebar-context-separator"></div>
    <button data-action="copy"><span>📋</span>Скопировать ${type === "direct" ? "@id" : "название"}</button>
  `;
  document.body.appendChild(menu);
  menu.style.left = Math.min(event.clientX, window.innerWidth - 280) + "px";
  menu.style.top = Math.min(event.clientY, window.innerHeight - 170) + "px";
  menu.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "open") type === "direct" ? openChat(item) : openGroup(item);
    if (action === "archive") archiveChat(type, id, !archived);
    if (action === "copy") {
      const text = type === "direct" ? "@" + item.username : item.name;
      await navigator.clipboard.writeText(text).catch(() => {});
    }
    menu.remove();
  });
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

async function loadUsers(query = "") {
  const cleanQuery = normalizeUsername(query);
  if (!currentUser || !cleanQuery) {
    renderUsers(cleanQuery);
    return;
  }
  try {
    const data = await request(`/api/users?me=${encodeURIComponent(currentUser.username)}&q=${encodeURIComponent(cleanQuery)}`);
    usersCache = data.users || [];
    usersCache.forEach((user) => onlineUsers[user.username] = Boolean(user.online));
    renderUsers(cleanQuery);
  } catch (error) {
    console.error(error);
    if (usersBox) usersBox.innerHTML = `<div class="empty">Ошибка поиска</div>`;
  }
}

function renderSearchHint() {
  if (!usersBox) return;
  usersBox.innerHTML = `<div class="empty">Введите @id пользователя,<br>чтобы найти новый чат.<br>Например: <b>@username</b></div>`;
}

function renderUsers(query = "") {
  if (!usersBox) return;
  const hasQuery = Boolean(normalizeUsername(query));
  usersBox.innerHTML = "";
  if (!hasQuery) {
    renderSearchHint();
    return;
  }
  if (!usersCache.length) {
    usersBox.innerHTML = `<div class="empty">Пользователь не найден<br><b>@${escapeHtml(query)}</b></div>`;
    return;
  }
  usersCache.forEach((user) => {
    const item = document.createElement("button");
    item.className = "user";
    item.innerHTML = `
      ${renderAvatar(user)}
      <div class="user-info">
        <b>${onlineDot(user.username)}${escapeHtml(user.displayName || user.username)}</b>
        <span>${onlineUsers[user.username] ? "онлайн" : "офлайн"} · @${escapeHtml(user.username)}</span>
      </div>
    `;
    item.addEventListener("click", () => openChat(user));
    usersBox.appendChild(item);
  });
}

function renderEmptyChat() {
  selectedUser = null;
  selectedGroup = null;
  selectedChatType = null;
  messagesCache = [];
  typingUsers = {};
  hideGroupActions();
  cancelMessageModes();
  exitSelectionMode();

  if (chatAvatar) chatAvatar.innerHTML = "?";
  if (chatName) chatName.textContent = "Выберите чат";
  if (chatStatus) chatStatus.textContent = "Выберите личный чат, группу или найдите пользователя";
  if (messagesBox) messagesBox.innerHTML = `<div class="empty">Выберите чат слева или найдите пользователя через поиск.</div>`;
  if (messageInput) {
    messageInput.value = "";
    messageInput.disabled = true;
  }
  if (sendBtn) sendBtn.disabled = true;
  if (attachBtn) attachBtn.disabled = true;
  if (voiceBtn) voiceBtn.disabled = true;
  renderRecentChats();
  renderGroups();
}

function updateChatHeaderForUser(user) {
  if (chatAvatar) chatAvatar.innerHTML = user.avatar ? `<img src="${user.avatar}" alt="avatar">` : escapeHtml((user.displayName || user.username || "?")[0]);
  if (chatName) chatName.textContent = user.displayName || user.username;
  updateChatStatusText();
}

function updateChatHeaderForGroup(group) {
  if (chatAvatar) chatAvatar.innerHTML = "#";
  if (chatName) chatName.textContent = group.name;
  updateChatStatusText();
}

async function openChat(user) {
  cancelVoiceRecording();
  stopTyping();
  selectedUser = user;
  selectedGroup = null;
  selectedChatType = "direct";
  messagesCache = [];
  unreadDirect[user.username] = 0;
  updateUnreadTitle();
  hideGroupActions();
  cancelMessageModes();
  exitSelectionMode();
  updateChatHeaderForUser(user);
  enableMessageInput(true);
  if (messagesBox) messagesBox.innerHTML = `<div class="empty">Загрузка...</div>`;
  socket.emit("open_chat", { me: currentUser.username, with: user.username });
  socket.emit("check_user_status", { username: user.username });

  try {
    const data = await request(`/api/messages?me=${encodeURIComponent(currentUser.username)}&with=${encodeURIComponent(user.username)}`);
    messagesCache = data.messages || [];
    renderMessages();
    socket.emit("mark_messages_read", { me: currentUser.username, with: user.username });
  } catch (error) {
    console.warn("HTTP messages load failed, waiting for socket:", error);
    if (messagesBox) messagesBox.innerHTML = `<div class="empty">Ошибка загрузки сообщений</div>`;
  }

  renderRecentChats();
  renderGroups();
  renderUsers(searchInput ? searchInput.value : "");
}

async function openGroup(group) {
  cancelVoiceRecording();
  stopTyping();
  selectedGroup = group;
  selectedUser = null;
  selectedChatType = "group";
  messagesCache = [];
  unreadGroups[group.id] = 0;
  updateUnreadTitle();
  cancelMessageModes();
  exitSelectionMode();
  updateChatHeaderForGroup(group);
  showGroupActions(group);
  enableMessageInput(true);
  if (messagesBox) messagesBox.innerHTML = `<div class="empty">Загрузка...</div>`;
  socket.emit("open_group", { me: currentUser.username, groupId: group.id });

  try {
    const data = await request(`/api/groups/${encodeURIComponent(group.id)}/messages?me=${encodeURIComponent(currentUser.username)}`);
    messagesCache = data.messages || [];
    renderMessages();
  } catch (error) {
    if (messagesBox) messagesBox.innerHTML = `<div class="empty">Ошибка загрузки группы</div>`;
  }
  renderGroups();
  renderRecentChats();
}

function enableMessageInput(enabled) {
  if (messageInput) messageInput.disabled = !enabled;
  if (sendBtn) sendBtn.disabled = !enabled;
  if (attachBtn) attachBtn.disabled = !enabled;
  if (voiceBtn) voiceBtn.disabled = !enabled;
}

function canSendNow() {
  return Boolean(currentUser && selectedChatType && (selectedUser || selectedGroup));
}

function getMessageBodyText() {
  return messageInput ? messageInput.value.trim() : "";
}

function sendMessage() {
  if (!canSendNow()) return;
  const text = getMessageBodyText();
  if (!text && !editingMessage) return;

  if (editingMessage) {
    socket.emit("edit_message", {
      messageId: editingMessage.id,
      me: currentUser.username,
      text
    });
    cancelEditMode();
    if (messageInput) messageInput.value = "";
    return;
  }

  const payload = {
    from: currentUser.username,
    text,
    replyTo: replyToMessage ? makeReplyPayload(replyToMessage) : null
  };

  stopTyping();

  if (selectedChatType === "direct" && selectedUser) {
    socket.emit("send_message", { ...payload, to: selectedUser.username });
  }
  if (selectedChatType === "group" && selectedGroup) {
    socket.emit("send_group_message", { ...payload, groupId: selectedGroup.id });
  }

  if (messageInput) {
    messageInput.value = "";
    messageInput.focus();
  }
  cancelReplyMode();
}

function sendMediaMessage(media) {
  if (!canSendNow() || !media) return;
  stopTyping();
  const payload = {
    from: currentUser.username,
    text: "",
    media,
    replyTo: replyToMessage ? makeReplyPayload(replyToMessage) : null
  };
  if (selectedChatType === "direct" && selectedUser) socket.emit("send_message", { ...payload, to: selectedUser.username });
  if (selectedChatType === "group" && selectedGroup) socket.emit("send_group_message", { ...payload, groupId: selectedGroup.id });
  cancelReplyMode();
}

function makeReplyPayload(message) {
  return {
    id: String(message.id || ""),
    text: String(message.text || message.message || mediaLabel(message.media) || "").slice(0, 500),
    username: message.username || message.from || "",
    displayName: message.displayName || message.username || ""
  };
}

function mediaLabel(media) {
  if (!media) return "";
  if (media.type === "image") return "Фото";
  if (media.type === "video") return "Видео";
  if (media.type === "audio") return "Голосовое сообщение";
  return "Медиа";
}

function renderMessages() {
  if (!messagesBox) return;
  messagesBox.innerHTML = "";
  if (!messagesCache.length) {
    messagesBox.innerHTML = `<div class="empty">Сообщений пока нет. Напиши первым.</div>`;
    return;
  }

  messagesCache.forEach((message) => {
    const mine = normalizeUsername(message.from || message.username) === currentUser.username;
    const bubble = document.createElement("div");
    bubble.className = mine ? "message mine" : "message";
    bubble.dataset.messageId = String(message.id || "");

    const text = message.text || message.message || "";
    bubble.innerHTML = `
      <div class="message-name">${escapeHtml(message.displayName || message.username || "")}</div>
      ${renderReplyPreview(message.replyTo || message.reply_to)}
      ${renderMedia(message.media)}
      ${text ? `<div class="message-text">${escapeHtml(text)}</div>` : ""}
      <div class="message-meta">
        ${message.edited ? `<span class="message-edited">изменено</span>` : ""}
        <span class="message-time">${formatTime(message.created_at || message.createdAt)}</span>
        ${mine && selectedChatType === "direct" ? renderReadStatus(message) : ""}
      </div>
    `;

    bubble.addEventListener("contextmenu", (event) => openMessageContextMenu(event, message));
    bubble.addEventListener("click", () => {
      if (selectionMode) toggleMessageSelection(message.id);
    });
    messagesBox.appendChild(bubble);
  });
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function renderReplyPreview(reply) {
  if (!reply) return "";
  return `
    <div class="message-reply-preview">
      <div class="message-reply-author">${escapeHtml(reply.displayName || reply.username || "Ответ")}</div>
      <div class="message-reply-text">${escapeHtml(reply.text || "Сообщение")}</div>
    </div>
  `;
}

function renderReadStatus(message) {
  const read = Boolean(message.isRead || message.is_read || message.readAt || message.read_at);
  return `
    <span class="message-status ${read ? "read" : "unread"}" title="${read ? "Прочитано" : "Отправлено"}">
      <span class="message-status__check first">✓</span>
      <span class="message-status__check second">✓</span>
    </span>
  `;
}

function renderMedia(media) {
  if (!media || !media.url) return "";
  if (media.type === "image") return `<div class="message-media"><img src="${media.url}" alt="${escapeHtml(media.name || "image")}" loading="lazy"></div>`;
  if (media.type === "video") return `<div class="message-media"><video src="${media.url}" controls></video></div>`;
  if (media.type === "audio") return `<div class="message-media"><audio src="${media.url}" controls preload="metadata"></audio></div>`;
  return "";
}

function openMessageContextMenu(event, message) {
  event.preventDefault();
  contextSelectedMessage = message;
  document.querySelectorAll(".message-context-menu").forEach((menu) => menu.remove());
  const mine = normalizeUsername(message.from || message.username) === currentUser.username;
  const menu = document.createElement("div");
  menu.className = "message-context-menu";
  menu.innerHTML = `
    <button data-action="select"><span>☑</span>Выбрать</button>
    <button data-action="reply"><span>↩</span>Ответить</button>
    ${mine ? `<button data-action="edit"><span>✎</span>Редактировать</button>` : ""}
    <button data-action="copy"><span>📋</span>Копировать</button>
    ${mine ? `<button data-action="delete" class="danger"><span>🗑</span>Удалить</button>` : ""}
  `;
  document.body.appendChild(menu);
  menu.style.left = Math.min(event.clientX, window.innerWidth - 230) + "px";
  menu.style.top = Math.min(event.clientY, window.innerHeight - 230) + "px";
  menu.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "select") enterSelectionMode(message.id);
    if (action === "reply") startReply(message);
    if (action === "edit") startEdit(message);
    if (action === "copy") await copyText(message.text || message.message || mediaLabel(message.media));
    if (action === "delete") deleteMessage(message.id);
    menu.remove();
  });
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

function startReply(message) {
  replyToMessage = message;
  ensureModePanel();
  const panel = document.getElementById("callibriModePanel");
  panel.className = "mode-panel reply";
  panel.innerHTML = `
    <div class="mode-panel-line"></div>
    <div class="mode-panel-content">
      <div class="mode-panel-title">Ответ на ${escapeHtml(message.displayName || message.username || "сообщение")}</div>
      <div class="mode-panel-text">${escapeHtml(message.text || message.message || mediaLabel(message.media))}</div>
    </div>
    <button class="mode-panel-close" type="button">×</button>
  `;
  panel.querySelector("button").addEventListener("click", cancelReplyMode);
  panel.classList.remove("hidden");
  if (messageInput) messageInput.focus();
}

function startEdit(message) {
  editingMessage = message;
  replyToMessage = null;
  ensureModePanel();
  const panel = document.getElementById("callibriModePanel");
  panel.className = "mode-panel edit";
  panel.innerHTML = `
    <div class="mode-panel-line"></div>
    <div class="mode-panel-content">
      <div class="mode-panel-title">Редактирование сообщения</div>
      <div class="mode-panel-text">Измени текст и нажми отправить</div>
    </div>
    <button class="mode-panel-close" type="button">×</button>
  `;
  panel.querySelector("button").addEventListener("click", cancelEditMode);
  panel.classList.remove("hidden");
  if (messageInput) {
    messageInput.value = message.text || message.message || "";
    messageInput.focus();
  }
}

function ensureModePanel() {
  if (document.getElementById("callibriModePanel")) return;
  const panel = document.createElement("div");
  panel.id = "callibriModePanel";
  panel.className = "mode-panel hidden";
  const footer = document.querySelector(".chat-input");
  if (footer && footer.parentElement) footer.parentElement.insertBefore(panel, footer);
}

function cancelReplyMode() {
  replyToMessage = null;
  const panel = document.getElementById("callibriModePanel");
  if (panel && !editingMessage) panel.classList.add("hidden");
}

function cancelEditMode() {
  editingMessage = null;
  const panel = document.getElementById("callibriModePanel");
  if (panel) panel.classList.add("hidden");
  if (messageInput) messageInput.value = "";
}

function cancelMessageModes() {
  replyToMessage = null;
  editingMessage = null;
  const panel = document.getElementById("callibriModePanel");
  if (panel) panel.classList.add("hidden");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || "");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text || "";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function deleteMessage(id) {
  if (!id || !currentUser) return;
  if (!confirm("Удалить сообщение?")) return;
  socket.emit("delete_message", { messageId: id, id, me: currentUser.username, from: currentUser.username });
}

function enterSelectionMode(id) {
  selectionMode = true;
  selectedMessageIds.clear();
  if (id) selectedMessageIds.add(String(id));
  renderSelectionToolbar();
  markSelectedBubbles();
}

function toggleMessageSelection(id) {
  const key = String(id || "");
  if (!key) return;
  if (selectedMessageIds.has(key)) selectedMessageIds.delete(key);
  else selectedMessageIds.add(key);
  if (!selectedMessageIds.size) exitSelectionMode();
  else {
    renderSelectionToolbar();
    markSelectedBubbles();
  }
}

function exitSelectionMode() {
  selectionMode = false;
  selectedMessageIds.clear();
  const toolbar = document.getElementById("callibriSelectionToolbar");
  if (toolbar) toolbar.remove();
  markSelectedBubbles();
}

function markSelectedBubbles() {
  if (!messagesBox) return;
  messagesBox.querySelectorAll(".message").forEach((bubble) => {
    const selected = selectedMessageIds.has(String(bubble.dataset.messageId || ""));
    bubble.classList.toggle("callibri-selected", selected);
    bubble.classList.toggle("callibri-selection-mode", selectionMode);
  });
}

function renderSelectionToolbar() {
  let toolbar = document.getElementById("callibriSelectionToolbar");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "callibriSelectionToolbar";
    toolbar.className = "callibri-selection-toolbar";
    document.body.appendChild(toolbar);
  }
  toolbar.innerHTML = `
    <div class="callibri-selected-count">Выбрано: ${selectedMessageIds.size}</div>
    <button data-action="copy" class="primary">Копировать</button>
    <button data-action="delete" class="danger">Удалить</button>
    <button data-action="all">Выбрать все</button>
    <button data-action="cancel">Отмена</button>
  `;
  toolbar.onclick = async (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "cancel") exitSelectionMode();
    if (action === "all") {
      messagesCache.forEach((m) => m.id && selectedMessageIds.add(String(m.id)));
      renderSelectionToolbar();
      markSelectedBubbles();
    }
    if (action === "copy") {
      const text = messagesCache
        .filter((m) => selectedMessageIds.has(String(m.id)))
        .map((m) => `${m.displayName || m.username || "Пользователь"}: ${m.text || m.message || mediaLabel(m.media)}`)
        .join("\n");
      await copyText(text);
    }
    if (action === "delete") {
      const own = messagesCache.filter((m) => selectedMessageIds.has(String(m.id)) && normalizeUsername(m.from || m.username) === currentUser.username);
      if (!own.length) return alert("Можно удалить только свои сообщения");
      if (!confirm(`Удалить выбранные свои сообщения: ${own.length}?`)) return;
      own.forEach((m) => socket.emit("delete_message", { messageId: m.id, me: currentUser.username, from: currentUser.username }));
      exitSelectionMode();
    }
  };
}

function setupGroupActionsUI() {
  if (groupActionsBox) return;
  if (!chatStatus || !chatStatus.parentElement) return;
  groupActionsBox = document.createElement("div");
  groupActionsBox.id = "groupActionsBox";
  groupActionsBox.style.display = "none";
  groupActionsBox.style.gap = "8px";
  groupActionsBox.style.marginTop = "8px";
  groupActionsBox.innerHTML = `
    <button id="inviteGroupBtn" type="button">+ Добавить</button>
    <button id="leaveGroupBtn" type="button">Выйти</button>
    <button id="deleteGroupBtn" type="button">Удалить</button>
  `;
  chatStatus.parentElement.appendChild(groupActionsBox);
  document.getElementById("inviteGroupBtn").addEventListener("click", openInviteModal);
  document.getElementById("leaveGroupBtn").addEventListener("click", leaveCurrentGroup);
  document.getElementById("deleteGroupBtn").addEventListener("click", deleteCurrentGroup);
}

function showGroupActions(group) {
  setupGroupActionsUI();
  if (!groupActionsBox) return;
  groupActionsBox.style.display = "flex";
  const deleteBtn = document.getElementById("deleteGroupBtn");
  if (deleteBtn) deleteBtn.style.display = group && currentUser && group.owner === currentUser.username ? "inline-flex" : "none";
}

function hideGroupActions() {
  if (groupActionsBox) groupActionsBox.style.display = "none";
}

function openGroupModal() {
  createGroupModal();
  document.getElementById("groupModal").classList.remove("hidden");
}

function createGroupModal() {
  if (document.getElementById("groupModal")) return;
  const modal = document.createElement("div");
  modal.id = "groupModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-card">
      <h2>Создать группу</h2>
      <p>Добавь участников через @id. Например: @test1, @test2</p>
      <input id="groupNameInput" type="text" placeholder="Название группы">
      <textarea id="groupMembersInput" placeholder="@id участников через запятую"></textarea>
      <div id="groupError"></div>
      <div class="modal-actions">
        <button id="cancelGroupBtn" type="button">Отмена</button>
        <button id="saveGroupBtn" type="button">Создать</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("cancelGroupBtn").addEventListener("click", () => modal.classList.add("hidden"));
  document.getElementById("saveGroupBtn").addEventListener("click", createGroup);
}

async function createGroup() {
  const name = document.getElementById("groupNameInput").value.trim();
  const members = document.getElementById("groupMembersInput").value.split(/[,:;\n]/).map(normalizeUsername).filter(Boolean);
  const error = document.getElementById("groupError");
  if (!name) {
    error.textContent = "Введите название группы";
    return;
  }
  try {
    const data = await request("/api/groups", { method: "POST", body: JSON.stringify({ owner: currentUser.username, name, members }) });
    document.getElementById("groupModal").classList.add("hidden");
    await loadGroups();
    openGroup(data.group);
  } catch (e) {
    error.textContent = e.message;
  }
}

function openInviteModal() {
  if (!selectedGroup) return;
  let modal = document.getElementById("inviteGroupModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "inviteGroupModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-card">
        <h2>Добавить участников</h2>
        <p>Введи @id пользователей через запятую.</p>
        <textarea id="inviteMembersInput" placeholder="@username1, @username2"></textarea>
        <div id="inviteError"></div>
        <div class="modal-actions">
          <button id="cancelInviteBtn" type="button">Отмена</button>
          <button id="saveInviteBtn" type="button">Добавить</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("cancelInviteBtn").addEventListener("click", () => modal.classList.add("hidden"));
    document.getElementById("saveInviteBtn").addEventListener("click", inviteMembersToCurrentGroup);
  }
  document.getElementById("inviteMembersInput").value = "";
  document.getElementById("inviteError").textContent = "";
  modal.classList.remove("hidden");
}

async function inviteMembersToCurrentGroup() {
  if (!selectedGroup) return;
  const members = document.getElementById("inviteMembersInput").value.split(/[,:;\n]/).map(normalizeUsername).filter(Boolean);
  const error = document.getElementById("inviteError");
  if (!members.length) {
    error.textContent = "Введите хотя бы одного пользователя";
    return;
  }
  try {
    const data = await request(`/api/groups/${encodeURIComponent(selectedGroup.id)}/invite`, {
      method: "POST",
      body: JSON.stringify({ me: currentUser.username, members: Array.from(new Set(members)) })
    });
    selectedGroup = data.group;
    groupsCache = groupsCache.map((g) => g.id === data.group.id ? data.group : g);
    document.getElementById("inviteGroupModal").classList.add("hidden");
    renderGroups();
    updateChatStatusText();
  } catch (e) {
    error.textContent = e.message;
  }
}

async function leaveCurrentGroup() {
  if (!selectedGroup || !confirm(`Выйти из группы "${selectedGroup.name}"?`)) return;
  await request(`/api/groups/${encodeURIComponent(selectedGroup.id)}/leave`, { method: "POST", body: JSON.stringify({ me: currentUser.username }) });
  groupsCache = groupsCache.filter((g) => g.id !== selectedGroup.id);
  renderEmptyChat();
}

async function deleteCurrentGroup() {
  if (!selectedGroup || !confirm(`Удалить группу "${selectedGroup.name}"?`)) return;
  await request(`/api/groups/${encodeURIComponent(selectedGroup.id)}?me=${encodeURIComponent(currentUser.username)}`, { method: "DELETE" });
  groupsCache = groupsCache.filter((g) => g.id !== selectedGroup.id);
  renderEmptyChat();
}

function setupMessageTools() {
  if (!sendBtn || attachBtn) return;
  attachBtn = document.createElement("button");
  attachBtn.id = "attachBtn";
  attachBtn.type = "button";
  attachBtn.title = "Отправить фото или видео";
  attachBtn.textContent = "📎";
  voiceBtn = document.createElement("button");
  voiceBtn.id = "voiceBtn";
  voiceBtn.type = "button";
  voiceBtn.title = "Голосовое сообщение";
  voiceBtn.textContent = "🎙";
  fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*,video/*";
  fileInput.style.display = "none";
  sendBtn.parentElement.insertBefore(attachBtn, sendBtn);
  sendBtn.parentElement.insertBefore(voiceBtn, sendBtn);
  document.body.appendChild(fileInput);
  attachBtn.addEventListener("click", () => canSendNow() && fileInput.click());
  fileInput.addEventListener("change", handleFileSend);
  voiceBtn.addEventListener("click", toggleVoiceRecording);
}

async function handleFileSend(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) return alert("Файл слишком большой. Максимум 8 МБ.");
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) return alert("Можно отправлять только фото или видео.");
  const url = await fileToDataUrl(file);
  sendMediaMessage({ type: isImage ? "image" : "video", url, name: file.name });
  event.target.value = "";
}

async function toggleVoiceRecording() {
  if (!canSendNow()) return;
  if (isRecording) {
    finishVoiceRecording();
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm" });
    mediaRecorder.ondataavailable = (event) => event.data && event.data.size && recordedChunks.push(event.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      if (blob.size > MAX_FILE_SIZE) return alert("Голосовое слишком большое. Максимум 8 МБ.");
      const url = await blobToDataUrl(blob);
      sendMediaMessage({ type: "audio", url, name: "voice.webm", isVoice: true, durationMs: Date.now() - recordingStartTime });
    };
    mediaRecorder.start();
    isRecording = true;
    recordingStartTime = Date.now();
    if (voiceBtn) {
      voiceBtn.textContent = "■";
      voiceBtn.classList.add("recording");
    }
  } catch {
    alert("Разреши доступ к микрофону.");
  }
}

function finishVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  isRecording = false;
  mediaRecorder.stop();
  if (recordingStream) recordingStream.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  if (voiceBtn) {
    voiceBtn.textContent = "🎙";
    voiceBtn.classList.remove("recording");
  }
}

function cancelVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (recordingStream) recordingStream.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  isRecording = false;
  if (voiceBtn) {
    voiceBtn.textContent = "🎙";
    voiceBtn.classList.remove("recording");
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function setupSettingsGear() {
  const profile = meName ? meName.closest(".profile") : null;
  if (!profile || settingsBtn) return;
  if (logoutBtn) logoutBtn.style.display = "none";
  profileAvatarBtn = document.getElementById("profileAvatarBtn") || document.createElement("button");
  profileAvatarBtn.id = "profileAvatarBtn";
  profileAvatarBtn.type = "button";
  profileAvatarBtn.title = "Профиль";
  if (!profileAvatarBtn.parentElement) profile.prepend(profileAvatarBtn);
  settingsBtn = document.createElement("button");
  settingsBtn.id = "callibriGearBtn";
  settingsBtn.type = "button";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "Настройки";
  settingsBtn.addEventListener("click", openSettingsModal);
  profile.appendChild(settingsBtn);
  profileAvatarBtn.addEventListener("click", openSettingsModal);
  renderMyAvatar();
}

function renderMyAvatar() {
  if (!profileAvatarBtn || !currentUser) return;
  if (currentUser.avatar) profileAvatarBtn.innerHTML = `<img src="${currentUser.avatar}" alt="avatar">`;
  else profileAvatarBtn.textContent = (currentUser.displayName || currentUser.username || "?")[0].toUpperCase();
}

function settingsKey() {
  return SETTINGS_KEY_PREFIX + (currentUser ? currentUser.username : "guest");
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(settingsKey()) || "{}");
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem(settingsKey(), JSON.stringify(settings));
}

function openSettingsModal() {
  if (!currentUser) return;
  let modal = document.getElementById("callibriSettingsModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "callibriSettingsModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-card settings-modal-shell">
        <h2>Настройки Callibri</h2>
        <p>Профиль, избранное, звук и выход из аккаунта.</p>
        <input id="settingsNameInput" type="text" placeholder="Имя">
        <input id="settingsUsernameInput" type="text" placeholder="username без @">
        <textarea id="settingsFavoritesInput" placeholder="Избранное: заметки, ссылки, важные данные"></textarea>
        <label class="remember-row"><input id="settingsSoundInput" type="checkbox"> <span>Звук уведомлений</span></label>
        <div class="modal-actions">
          <button id="settingsLogoutBtn" class="danger" type="button">Выйти</button>
          <button id="settingsCloseBtn" type="button">Закрыть</button>
          <button id="settingsSaveBtn" type="button">Сохранить</button>
        </div>
        <div id="settingsStatus"></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("settingsCloseBtn").addEventListener("click", () => modal.classList.add("hidden"));
    document.getElementById("settingsLogoutBtn").addEventListener("click", () => { modal.classList.add("hidden"); logout(); });
    document.getElementById("settingsSaveBtn").addEventListener("click", saveSettingsModal);
  }
  const settings = loadSettings();
  document.getElementById("settingsNameInput").value = currentUser.displayName || currentUser.username || "";
  document.getElementById("settingsUsernameInput").value = currentUser.username || "";
  document.getElementById("settingsFavoritesInput").value = settings.favorites || "";
  document.getElementById("settingsSoundInput").checked = settings.sound !== false;
  document.getElementById("settingsStatus").textContent = "";
  modal.classList.remove("hidden");
}

async function saveSettingsModal() {
  const status = document.getElementById("settingsStatus");
  const displayName = document.getElementById("settingsNameInput").value.trim();
  const newUsername = normalizeUsername(document.getElementById("settingsUsernameInput").value);
  const settings = loadSettings();
  settings.favorites = document.getElementById("settingsFavoritesInput").value;
  settings.sound = document.getElementById("settingsSoundInput").checked;
  saveSettings(settings);

  if (!displayName || !newUsername) {
    status.textContent = "Введите имя и username";
    return;
  }
  try {
    const data = await request("/api/profile", {
      method: "PUT",
      body: JSON.stringify({ oldUsername: currentUser.username, newUsername, displayName, avatar: currentUser.avatar || "" })
    });
    updateSavedUser(data.user);
    if (meName) meName.textContent = currentUser.displayName || currentUser.username;
    if (meLogin) meLogin.textContent = "@" + currentUser.username;
    renderMyAvatar();
    socket.emit("user_online", { username: currentUser.username });
    status.textContent = "Сохранено";
  } catch (e) {
    status.textContent = e.message;
  }
}

function emitTypingStart() {
  if (!currentUser || !selectedChatType || isTypingNow) return;
  isTypingNow = true;
  if (selectedChatType === "direct" && selectedUser) socket.emit("typing_start", { from: currentUser.username, to: selectedUser.username, chatType: "direct" });
  if (selectedChatType === "group" && selectedGroup) socket.emit("typing_start", { from: currentUser.username, groupId: selectedGroup.id, chatType: "group" });
}

function stopTyping() {
  if (!currentUser || !selectedChatType || !isTypingNow) return;
  isTypingNow = false;
  if (selectedChatType === "direct" && selectedUser) socket.emit("typing_stop", { from: currentUser.username, to: selectedUser.username, chatType: "direct" });
  if (selectedChatType === "group" && selectedGroup) socket.emit("typing_stop", { from: currentUser.username, groupId: selectedGroup.id, chatType: "group" });
}

function handleTypingInput() {
  if (!canSendNow() || editingMessage) return;
  const text = messageInput ? messageInput.value.trim() : "";
  if (!text) return stopTyping();
  emitTypingStart();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1600);
}

function updateChatStatusText() {
  if (!chatStatus) return;
  if (selectedChatType === "direct" && selectedUser) {
    if (typingUsers[selectedUser.username]) chatStatus.textContent = "печатает...";
    else chatStatus.textContent = onlineUsers[selectedUser.username] ? "онлайн" : "офлайн";
    return;
  }
  if (selectedChatType === "group" && selectedGroup) {
    const typingList = Object.keys(typingUsers).filter((username) => typingUsers[username]);
    if (typingList.length === 1) chatStatus.textContent = `@${typingList[0]} печатает...`;
    else if (typingList.length > 1) chatStatus.textContent = "несколько участников печатают...";
    else chatStatus.textContent = `${(selectedGroup.members || []).length} участн. · создатель @${selectedGroup.owner}`;
  }
}

function upsertRecentChat(user, message) {
  if (!user || !user.username) return;
  recentChatsCache = recentChatsCache.filter((item) => item.username !== user.username);
  recentChatsCache.unshift({
    id: user.id || user.username,
    displayName: user.displayName || user.display_name || user.username,
    username: user.username,
    avatar: user.avatar || "",
    online: onlineUsers[user.username] || user.online || false,
    lastMessageText: message ? (message.text || message.message || "") : (user.lastMessageText || ""),
    lastMessageMedia: message ? (message.media || null) : (user.lastMessageMedia || null),
    lastMessageAt: message ? message.created_at : user.lastMessageAt
  });
  renderRecentChats();
}

function shouldShowIncomingDirect(message) {
  if (!currentUser || !selectedUser || selectedChatType !== "direct") return false;
  const from = normalizeUsername(message.from || message.username);
  const to = normalizeUsername(message.to);
  return (from === currentUser.username && to === selectedUser.username) || (from === selectedUser.username && to === currentUser.username);
}

function shouldShowIncomingGroup(message) {
  return currentUser && selectedGroup && selectedChatType === "group" && String(message.groupId) === String(selectedGroup.id);
}

function markMessagesRead(ids, readAt) {
  const set = new Set((ids || []).map(String));
  messagesCache = messagesCache.map((m) => set.has(String(m.id)) ? { ...m, isRead: true, is_read: true, readAt, read_at: readAt } : m);
  renderMessages();
}

socket.on("load_messages", (messages) => {
  messagesCache = Array.isArray(messages) ? messages : [];
  renderMessages();
});

socket.on("new_message", (message) => {
  if (!currentUser || !message) return;
  const from = normalizeUsername(message.from || message.username);
  const to = normalizeUsername(message.to);
  const otherUsername = from === currentUser.username ? to : from;
  upsertRecentChat({ username: otherUsername, displayName: message.displayName || otherUsername, avatar: message.avatar || "" }, message);
  if (shouldShowIncomingDirect(message)) {
    if (!messagesCache.some((m) => String(m.id) === String(message.id))) messagesCache.push(message);
    unreadDirect[otherUsername] = 0;
    renderMessages();
    if (from !== currentUser.username) socket.emit("mark_messages_read", { me: currentUser.username, with: from });
  } else if (from !== currentUser.username) {
    unreadDirect[from] = (unreadDirect[from] || 0) + 1;
  }
  updateUnreadTitle();
  renderRecentChats();
});

socket.on("new_group_message", (message) => {
  if (!currentUser || !message) return;
  const groupId = String(message.groupId || "");
  const from = normalizeUsername(message.from || message.username);
  if (shouldShowIncomingGroup(message)) {
    if (!messagesCache.some((m) => String(m.id) === String(message.id))) messagesCache.push(message);
    unreadGroups[groupId] = 0;
    renderMessages();
  } else if (from !== currentUser.username) {
    unreadGroups[groupId] = (unreadGroups[groupId] || 0) + 1;
  }
  updateUnreadTitle();
  renderGroups();
});

socket.on("message_deleted", (data) => {
  if (!data || !data.id) return;
  messagesCache = messagesCache.filter((message) => String(message.id) !== String(data.id));
  renderMessages();
  renderRecentChats();
});

socket.on("message_edited", (data) => {
  if (!data || !data.id) return;
  messagesCache = messagesCache.map((message) => String(message.id) === String(data.id) ? { ...message, text: data.text, message: data.text, edited: true } : message);
  renderMessages();
});

socket.on("message-edited", (data) => socket.emit("message_edited", data));
socket.on("message-deleted", (data) => socket.emit("message_deleted", data));

socket.on("messages_read", (payload) => {
  if (!payload || !Array.isArray(payload.ids)) return;
  markMessagesRead(payload.ids, payload.readAt);
});

socket.on("profile_updated", (data) => {
  if (!data || !data.user) return;
  const oldUsername = normalizeUsername(data.oldUsername);
  const user = data.user;
  if (currentUser && oldUsername === currentUser.username) {
    updateSavedUser(user);
    if (meName) meName.textContent = currentUser.displayName || currentUser.username;
    if (meLogin) meLogin.textContent = "@" + currentUser.username;
    renderMyAvatar();
  }
  recentChatsCache = recentChatsCache.map((chat) => chat.username === oldUsername || chat.username === user.username ? { ...chat, displayName: user.displayName, username: user.username, avatar: user.avatar } : chat);
  usersCache = usersCache.map((item) => item.username === oldUsername || item.username === user.username ? { ...item, displayName: user.displayName, username: user.username, avatar: user.avatar } : item);
  renderRecentChats();
  renderUsers(searchInput ? searchInput.value : "");
});

socket.on("user_status", (data) => {
  if (!data || !data.username) return;
  const username = normalizeUsername(data.username);
  onlineUsers[username] = Boolean(data.online);
  recentChatsCache = recentChatsCache.map((chat) => chat.username === username ? { ...chat, online: Boolean(data.online) } : chat);
  usersCache = usersCache.map((user) => user.username === username ? { ...user, online: Boolean(data.online) } : user);
  renderRecentChats();
  renderUsers(searchInput ? searchInput.value : "");
  updateChatStatusText();
});

socket.on("typing_start", (data) => {
  if (!currentUser || !data) return;
  const from = normalizeUsername(data.from);
  if (!from || from === currentUser.username) return;
  typingUsers[from] = true;
  updateChatStatusText();
  renderRecentChats();
});

socket.on("typing_stop", (data) => {
  if (!data) return;
  delete typingUsers[normalizeUsername(data.from)];
  updateChatStatusText();
  renderRecentChats();
});

socket.on("group_updated", (group) => {
  if (!group || !group.id) return;
  groupsCache = groupsCache.map((item) => item.id === group.id ? group : item);
  if (selectedGroup && selectedGroup.id === group.id) selectedGroup = group;
  renderGroups();
  updateChatStatusText();
});

socket.on("group_deleted", (data) => {
  if (!data || !data.groupId) return;
  groupsCache = groupsCache.filter((group) => String(group.id) !== String(data.groupId));
  if (selectedGroup && String(selectedGroup.id) === String(data.groupId)) renderEmptyChat();
  renderGroups();
});

socket.on("group_left", (data) => {
  if (!data || !data.groupId) return;
  groupsCache = groupsCache.filter((group) => String(group.id) !== String(data.groupId));
  if (selectedGroup && String(selectedGroup.id) === String(data.groupId)) renderEmptyChat();
  renderGroups();
});

async function setupWindowsNotifications() {
  if (notificationPermissionRequested || !("Notification" in window)) return;
  notificationPermissionRequested = true;
  if (Notification.permission === "default") await Notification.requestPermission().catch(() => {});
}

async function startApp() {
  if (!currentUser) return;
  setupSidebarUI();
  setupSettingsGear();
  setupGroupActionsUI();
  setupMessageTools();
  setupWindowsNotifications();
  if (auth) auth.classList.add("hidden");
  if (app) app.classList.remove("hidden");
  if (meName) meName.textContent = currentUser.displayName || currentUser.username;
  if (meLogin) meLogin.textContent = "@" + currentUser.username;
  renderMyAvatar();
  if (searchInput) searchInput.value = "";
  socket.emit("user_online", { username: currentUser.username });
  await loadRecentChats();
  await loadGroups();
  renderSearchHint();
  renderEmptyChat();
}

if (loginBtn) loginBtn.addEventListener("click", login);
if (registerBtn) registerBtn.addEventListener("click", register);
if (logoutBtn) logoutBtn.addEventListener("click", logout);
if (togglePasswordBtn && passwordInput) {
  togglePasswordBtn.addEventListener("click", () => {
    const hidden = passwordInput.type === "password";
    passwordInput.type = hidden ? "text" : "password";
    togglePasswordBtn.textContent = hidden ? "Скрыть" : "Показать";
  });
}
if (searchInput) searchInput.addEventListener("input", () => loadUsers(searchInput.value));
if (sendBtn) sendBtn.addEventListener("click", sendMessage);
if (messageInput) {
  messageInput.addEventListener("input", handleTypingInput);
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  messageInput.addEventListener("blur", () => setTimeout(stopTyping, 400));
}
window.addEventListener("beforeunload", () => {
  cancelVoiceRecording();
  stopTyping();
});

const savedUser = loadSavedUser();
if (savedUser) {
  currentUser = savedUser;
  startApp();
} else {
  renderEmptyChat();
}

/* =========================================================
   CALLIBRI PREMIUM SETTINGS + GROUP ACTIONS
   Настройки и кнопки группы в стиле макета
   ========================================================= */

(function setupCallibriPremiumSettingsAndActions() {
  const SETTINGS_KEY_PREFIX = "callibri_premium_settings_";

  let premiumModal = null;
  let premiumAvatarDraft = "";
  let premiumMicStream = null;
  let premiumAudioContext = null;
  let premiumAnalyser = null;
  let premiumMeterFrame = null;

  function getPremiumSettingsKey() {
    const username =
      currentUser && currentUser.username
        ? normalizeUsername(currentUser.username)
        : "guest";

    return SETTINGS_KEY_PREFIX + username;
  }

  function loadPremiumSettings() {
    try {
      const raw = localStorage.getItem(getPremiumSettingsKey());
      const data = raw ? JSON.parse(raw) : {};

      return {
        favorites: data.favorites || "",
        notificationSounds: data.notificationSounds !== false,
        notificationSoundName: data.notificationSoundName || "hummingbird",
        notificationVolume: Number(data.notificationVolume ?? 80),
        microphoneId: data.microphoneId || "",
        theme: data.theme || "callibri-dark",
        hotkeys: data.hotkeys !== false
      };
    } catch {
      return {
        favorites: "",
        notificationSounds: true,
        notificationSoundName: "hummingbird",
        notificationVolume: 80,
        microphoneId: "",
        theme: "callibri-dark",
        hotkeys: true
      };
    }
  }

  function savePremiumSettings(settings) {
    localStorage.setItem(getPremiumSettingsKey(), JSON.stringify(settings));
  }

  function removeOldSettingsModals() {
    const oldIds = [
      "callibriCleanSettingsModal",
      "callibriSettingsModal",
      "settingsModal"
    ];

    oldIds.forEach((id) => {
      const el = document.getElementById(id);

      if (el && el !== premiumModal) {
        el.remove();
      }
    });
  }

  function installPremiumGear() {
    if (!meName) return;

    const profile = meName.closest(".profile");

    if (!profile) return;

    const oldLogout = document.getElementById("logoutBtn");
    const oldProfile = document.getElementById("profileBtn");

    if (oldLogout) oldLogout.style.display = "none";
    if (oldProfile) oldProfile.style.display = "none";

    if (document.getElementById("callibriPremiumGear")) return;

    const gear = document.createElement("button");
    gear.id = "callibriPremiumGear";
    gear.type = "button";
    gear.title = "Настройки";
    gear.innerHTML = "⚙";
    gear.addEventListener("click", openPremiumSettings);

    profile.appendChild(gear);
  }

  function premiumGroupButtonIcon(text) {
    const clean = String(text || "").toLowerCase();

    if (clean.includes("добав")) return "👥";
    if (clean.includes("вый")) return "↪";
    if (clean.includes("удал")) return "🗑";

    return "";
  }

  function decorateGroupActionButtons() {
    const invite = document.getElementById("inviteGroupBtn");
    const leave = document.getElementById("leaveGroupBtn");
    const del = document.getElementById("deleteGroupBtn");

    if (invite) {
      invite.classList.add("callibri-premium-group-btn", "add");
      invite.innerHTML = `<span>${premiumGroupButtonIcon("добавить")}</span><b>Добавить</b>`;
    }

    if (leave) {
      leave.classList.add("callibri-premium-group-btn", "leave");
      leave.innerHTML = `<span>${premiumGroupButtonIcon("выйти")}</span><b>Выйти</b>`;
    }

    if (del) {
      del.classList.add("callibri-premium-group-btn", "delete");
      del.innerHTML = `<span>${premiumGroupButtonIcon("удалить")}</span><b>Удалить</b>`;
    }
  }

  function patchGroupActions() {
    if (typeof showGroupActions === "function" && !showGroupActions.__premiumPatched) {
      const originalShowGroupActions = showGroupActions;

      showGroupActions = function patchedShowGroupActions(group) {
        originalShowGroupActions(group);
        decorateGroupActionButtons();
      };

      showGroupActions.__premiumPatched = true;
    }

    decorateGroupActionButtons();
  }

  function createMeterBars() {
    return Array.from({ length: 18 })
      .map((_, index) => `<i data-meter-bar="${index}" style="height:${8 + (index % 8) * 2}px"></i>`)
      .join("");
  }

  function renderPremiumAvatar() {
    const avatarBox = document.getElementById("callibriPremiumAvatar");

    if (!avatarBox || !currentUser) return;

    if (premiumAvatarDraft || currentUser.avatar) {
      avatarBox.innerHTML = `
        <img src="${escapeHtml(premiumAvatarDraft || currentUser.avatar)}" alt="avatar">
        <button id="callibriPremiumAvatarEdit" class="callibri-premium-avatar-edit" type="button">✎</button>
      `;
    } else {
      const letter = (currentUser.displayName || currentUser.username || "C")[0].toUpperCase();

      avatarBox.innerHTML = `
        <div class="callibri-premium-avatar-mark">${escapeHtml(letter)}</div>
        <button id="callibriPremiumAvatarEdit" class="callibri-premium-avatar-edit" type="button">✎</button>
      `;
    }

    const editBtn = document.getElementById("callibriPremiumAvatarEdit");

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        const input = document.getElementById("callibriPremiumAvatarInput");
        if (input) input.click();
      });
    }
  }

  async function loadMicrophones() {
    const select = document.getElementById("callibriPremiumMicSelect");

    if (!select) return;

    const settings = loadPremiumSettings();

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((device) => device.kind === "audioinput");

      select.innerHTML = "";

      if (!microphones.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Микрофон не найден";
        select.appendChild(option);
        return;
      }

      microphones.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Микрофон ${index + 1}`;

        if (settings.microphoneId && settings.microphoneId === device.deviceId) {
          option.selected = true;
        }

        select.appendChild(option);
      });
    } catch {
      select.innerHTML = `<option value="">Нет доступа к микрофону</option>`;
    }
  }

  function stopMicMeter() {
    if (premiumMeterFrame) {
      cancelAnimationFrame(premiumMeterFrame);
      premiumMeterFrame = null;
    }

    if (premiumMicStream) {
      premiumMicStream.getTracks().forEach((track) => track.stop());
      premiumMicStream = null;
    }

    if (premiumAudioContext) {
      premiumAudioContext.close().catch(() => {});
      premiumAudioContext = null;
    }

    premiumAnalyser = null;
  }

  async function startMicMeter() {
    stopMicMeter();

    const bars = Array.from(document.querySelectorAll("[data-meter-bar]"));

    if (!bars.length) return;

    try {
      const micSelect = document.getElementById("callibriPremiumMicSelect");
      const deviceId = micSelect && micSelect.value ? micSelect.value : undefined;

      premiumMicStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      });

      premiumAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = premiumAudioContext.createMediaStreamSource(premiumMicStream);

      premiumAnalyser = premiumAudioContext.createAnalyser();
      premiumAnalyser.fftSize = 256;

      source.connect(premiumAnalyser);

      const data = new Uint8Array(premiumAnalyser.frequencyBinCount);

      function draw() {
        if (!premiumAnalyser) return;

        premiumAnalyser.getByteFrequencyData(data);

        const average = data.reduce((sum, value) => sum + value, 0) / data.length;
        const activeCount = Math.max(2, Math.min(bars.length, Math.round((average / 255) * bars.length)));

        bars.forEach((bar, index) => {
          bar.classList.toggle("active", index < activeCount);
        });

        premiumMeterFrame = requestAnimationFrame(draw);
      }

      draw();
    } catch {
      bars.forEach((bar, index) => {
        bar.classList.toggle("active", index < 7);
      });
    }
  }

  function createPremiumSettingsModal() {
    removeOldSettingsModals();

    if (document.getElementById("callibriPremiumSettings")) {
      premiumModal = document.getElementById("callibriPremiumSettings");
      return;
    }

    premiumModal = document.createElement("div");
    premiumModal.id = "callibriPremiumSettings";
    premiumModal.className = "callibri-premium-settings hidden";

    premiumModal.innerHTML = `
      <div class="callibri-premium-window">
        <div class="callibri-premium-head">
          <div>
            <h2>Настройки Callibri</h2>
            <p>Профиль, избранное, микрофон, устройство входа и уведомления.</p>
          </div>

          <button id="callibriPremiumCloseX" class="callibri-premium-close" type="button">×</button>
        </div>

        <div class="callibri-premium-body">
          <nav class="callibri-premium-nav">
            <button type="button" data-premium-section="profile" class="active">
              <span>👤</span> Профиль
            </button>
            <button type="button" data-premium-section="favorites">
              <span>☆</span> Избранное
            </button>
            <button type="button" data-premium-section="microphone">
              <span>🎙</span> Микрофон
            </button>
            <button type="button" data-premium-section="device">
              <span>🖥</span> Устройство входа
            </button>
            <button type="button" data-premium-section="sounds">
              <span>🔔</span> Звуки уведомлений
            </button>
            <button type="button" data-premium-section="appearance">
              <span>🎨</span> Внешний вид
            </button>
            <button type="button" data-premium-section="privacy">
              <span>🔒</span> Конфиденциальность
            </button>
            <button type="button" data-premium-section="hotkeys">
              <span>⌨</span> Горячие клавиши
            </button>
            <button type="button" data-premium-section="about">
              <span>ⓘ</span> О программе
            </button>
          </nav>

          <div class="callibri-premium-content">
            <section class="callibri-premium-section" data-premium-content="profile">
              <div class="callibri-premium-section-title">Профиль</div>

              <div class="callibri-premium-profile-grid">
                <div>
                  <div class="callibri-premium-field">
                    <label>Отображаемое имя</label>
                    <input id="callibriPremiumDisplayName" class="callibri-premium-input" type="text" placeholder="Имя">
                  </div>

                  <div class="callibri-premium-field">
                    <label>Имя пользователя</label>
                    <input id="callibriPremiumUsername" class="callibri-premium-input" type="text" placeholder="@username">
                  </div>

                  <input id="callibriPremiumAvatarInput" type="file" accept="image/*" style="display:none">
                </div>

                <div id="callibriPremiumAvatar" class="callibri-premium-avatar"></div>
              </div>

              <div id="callibriPremiumStatus" class="callibri-premium-status"></div>
            </section>

            <section class="callibri-premium-section" data-premium-content="favorites">
              <div class="callibri-premium-section-title">Избранное</div>

              <textarea
                id="callibriPremiumFavorites"
                class="callibri-premium-textarea"
                placeholder="Заметки, ссылки, важные данные"
              ></textarea>
            </section>

            <section class="callibri-premium-section" data-premium-content="microphone">
              <div class="callibri-premium-section-title">Микрофон</div>

              <div class="callibri-premium-row">
                <div class="callibri-premium-row-icon">🎙</div>

                <div class="callibri-premium-row-main">
                  <select id="callibriPremiumMicSelect" class="callibri-premium-select">
                    <option value="">Загрузка микрофонов...</option>
                  </select>
                </div>

                <div class="callibri-premium-meter">
                  ${createMeterBars()}
                </div>
              </div>
            </section>

            <section class="callibri-premium-section" data-premium-content="device">
              <div class="callibri-premium-section-title">Устройство входа</div>

              <div class="callibri-premium-row">
                <div class="callibri-premium-row-icon">🖥</div>

                <div class="callibri-premium-row-main">
                  <b id="callibriPremiumDeviceName">Текущее устройство</b>
                  <span id="callibriPremiumDeviceMeta">Текущая сессия</span>
                </div>

                <div style="color:#8fb5c5;font-size:22px;">›</div>
              </div>
            </section>

            <section class="callibri-premium-section" data-premium-content="sounds">
              <div class="callibri-premium-section-title">Звуки уведомлений</div>

              <div class="callibri-premium-row">
                <div class="callibri-premium-row-icon">🔔</div>

                <div class="callibri-premium-row-main">
                  <b>Включить звуки уведомлений</b>
                  <span>Получайте звуковые уведомления о новых сообщениях</span>
                </div>

                <button id="callibriPremiumSoundToggle" class="callibri-premium-toggle" type="button"></button>
              </div>

              <div class="callibri-premium-sound-grid">
                <select id="callibriPremiumSoundSelect" class="callibri-premium-select">
                  <option value="hummingbird">Звук колибри</option>
                  <option value="soft">Мягкий сигнал</option>
                  <option value="classic">Классический звук</option>
                </select>

                <input id="callibriPremiumVolume" class="callibri-premium-range" type="range" min="0" max="100">
              </div>
            </section>

            <section class="callibri-premium-section" data-premium-content="appearance">
              <div class="callibri-premium-section-title">Внешний вид</div>

              <div class="callibri-premium-row">
                <div class="callibri-premium-row-icon">🎨</div>

                <div class="callibri-premium-row-main">
                  <b>Тема Callibri Dark</b>
                  <span>Тёмный сине-зелёный стиль с градиентами колибри</span>
                </div>
              </div>
            </section>

            <section class="callibri-premium-section" data-premium-content="privacy">
              <div class="callibri-premium-section-title">Конфиденциальность</div>

              <div class="callibri-premium-row">
                <div class="callibri-premium-row-icon">🔒</div>

                <div class="callibri-premium-row-main">
                  <b>Локальные настройки</b>
                  <span>Избранное, звук и устройство хранятся на этом компьютере</span>
                </div>
              </div>
            </section>

            <section class="callibri-premium-section" data-premium-content="hotkeys">
              <div class="callibri-premium-section-title">Горячие клавиши</div>

              <div class="callibri-premium-row">
                <div class="callibri-premium-row-icon">⌨</div>

                <div class="callibri-premium-row-main">
                  <b>Enter — отправить сообщение</b>
                  <span>Shift + Enter — новая строка</span>
                </div>
              </div>
            </section>

            <section class="callibri-premium-section" data-premium-content="about">
              <div class="callibri-premium-section-title">О программе</div>

              <div class="callibri-premium-row">
                <div class="callibri-premium-row-icon">🐦</div>

                <div class="callibri-premium-row-main">
                  <b>Callibri Messenger</b>
                  <span>Версия 2.8.1 · Dark Messenger / Callibri</span>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div class="callibri-premium-footer">
          <button id="callibriPremiumLogout" class="danger" type="button">↪ Выйти</button>
          <button id="callibriPremiumClose" type="button">Закрыть</button>
          <button id="callibriPremiumSave" class="primary" type="button">Сохранить</button>
        </div>
      </div>
    `;

    document.body.appendChild(premiumModal);

    document.getElementById("callibriPremiumCloseX").addEventListener("click", closePremiumSettings);
    document.getElementById("callibriPremiumClose").addEventListener("click", closePremiumSettings);
    document.getElementById("callibriPremiumSave").addEventListener("click", savePremiumSettingsFromModal);
    document.getElementById("callibriPremiumLogout").addEventListener("click", () => {
      closePremiumSettings();
      if (typeof logout === "function") logout();
    });

    premiumModal.addEventListener("click", (event) => {
      if (event.target === premiumModal) closePremiumSettings();
    });

    document.querySelectorAll("[data-premium-section]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-premium-section]").forEach((item) => {
          item.classList.remove("active");
        });

        button.classList.add("active");

        const section = button.dataset.premiumSection;
        const target = document.querySelector(`[data-premium-content="${section}"]`);

        if (target) {
          target.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      });
    });

    const avatarInput = document.getElementById("callibriPremiumAvatarInput");

    if (avatarInput) {
      avatarInput.addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
          alert("Выбери изображение");
          avatarInput.value = "";
          return;
        }

        if (file.size > MAX_FILE_SIZE) {
          alert("Файл слишком большой. Максимум 8 МБ.");
          avatarInput.value = "";
          return;
        }

        premiumAvatarDraft = await fileToDataUrl(file);
        renderPremiumAvatar();
        avatarInput.value = "";
      });
    }

    const soundToggle = document.getElementById("callibriPremiumSoundToggle");

    if (soundToggle) {
      soundToggle.addEventListener("click", () => {
        soundToggle.classList.toggle("active");
      });
    }

    const micSelect = document.getElementById("callibriPremiumMicSelect");

    if (micSelect) {
      micSelect.addEventListener("change", () => {
        startMicMeter();
      });
    }
  }

  function fillPremiumSettingsModal() {
    if (!currentUser) return;

    const settings = loadPremiumSettings();

    const displayNameInput = document.getElementById("callibriPremiumDisplayName");
    const usernameInput = document.getElementById("callibriPremiumUsername");
    const favoritesInput = document.getElementById("callibriPremiumFavorites");
    const soundToggle = document.getElementById("callibriPremiumSoundToggle");
    const soundSelect = document.getElementById("callibriPremiumSoundSelect");
    const volumeInput = document.getElementById("callibriPremiumVolume");
    const deviceName = document.getElementById("callibriPremiumDeviceName");
    const deviceMeta = document.getElementById("callibriPremiumDeviceMeta");
    const status = document.getElementById("callibriPremiumStatus");

    premiumAvatarDraft = currentUser.avatar || "";

    if (displayNameInput) {
      displayNameInput.value = currentUser.displayName || currentUser.username || "";
    }

    if (usernameInput) {
      usernameInput.value = currentUser.username || "";
    }

    if (favoritesInput) {
      favoritesInput.value = settings.favorites || "";
    }

    if (soundToggle) {
      soundToggle.classList.toggle("active", Boolean(settings.notificationSounds));
    }

    if (soundSelect) {
      soundSelect.value = settings.notificationSoundName || "hummingbird";
    }

    if (volumeInput) {
      volumeInput.value = String(settings.notificationVolume ?? 80);
    }

    if (deviceName) {
      deviceName.textContent = navigator.platform || "Текущее устройство";
    }

    if (deviceMeta) {
      const browser = navigator.userAgent.includes("Electron")
        ? "Electron"
        : navigator.userAgent.includes("Chrome")
          ? "Chrome / Chromium"
          : "Браузер";

      deviceMeta.textContent = `● Текущая сессия · ${browser}`;
    }

    if (status) {
      status.textContent = "";
    }

    renderPremiumAvatar();
    loadMicrophones().then(startMicMeter);
  }

  function openPremiumSettings() {
    if (!currentUser) return;

    createPremiumSettingsModal();
    fillPremiumSettingsModal();

    premiumModal.classList.remove("hidden");
  }

  function closePremiumSettings() {
    if (premiumModal) {
      premiumModal.classList.add("hidden");
    }

    stopMicMeter();
  }

  async function savePremiumSettingsFromModal() {
    if (!currentUser) return;

    const displayNameInput = document.getElementById("callibriPremiumDisplayName");
    const usernameInput = document.getElementById("callibriPremiumUsername");
    const favoritesInput = document.getElementById("callibriPremiumFavorites");
    const soundToggle = document.getElementById("callibriPremiumSoundToggle");
    const soundSelect = document.getElementById("callibriPremiumSoundSelect");
    const volumeInput = document.getElementById("callibriPremiumVolume");
    const micSelect = document.getElementById("callibriPremiumMicSelect");
    const status = document.getElementById("callibriPremiumStatus");

    const oldUsername = currentUser.username;
    const displayName = displayNameInput ? displayNameInput.value.trim() : "";
    const newUsername = usernameInput ? normalizeUsername(usernameInput.value) : "";

    if (status) {
      status.style.color = "#86efac";
      status.textContent = "";
    }

    if (!displayName) {
      if (status) {
        status.style.color = "#fda4af";
        status.textContent = "Введите имя";
      }

      return;
    }

    if (!newUsername) {
      if (status) {
        status.style.color = "#fda4af";
        status.textContent = "Введите username";
      }

      return;
    }

    try {
      const data = await request("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          oldUsername,
          newUsername,
          displayName,
          avatar: premiumAvatarDraft || ""
        })
      });

      updateSavedUser(data.user);

      if (meName) meName.textContent = currentUser.displayName || currentUser.username;
      if (meLogin) meLogin.textContent = "@" + currentUser.username;

      if (typeof renderMyAvatar === "function") {
        renderMyAvatar();
      }

      socket.emit("user_online", {
        username: currentUser.username
      });

      const settings = loadPremiumSettings();

      settings.favorites = favoritesInput ? favoritesInput.value : "";
      settings.notificationSounds = soundToggle ? soundToggle.classList.contains("active") : true;
      settings.notificationSoundName = soundSelect ? soundSelect.value : "hummingbird";
      settings.notificationVolume = volumeInput ? Number(volumeInput.value || 80) : 80;
      settings.microphoneId = micSelect ? micSelect.value : "";

      savePremiumSettings(settings);

      if (status) {
        status.style.color = "#86efac";
        status.textContent = "Настройки сохранены";
      }

      setTimeout(() => {
        closePremiumSettings();
      }, 450);
    } catch (error) {
      if (status) {
        status.style.color = "#fda4af";
        status.textContent = error.message;
      } else {
        alert(error.message);
      }
    }
  }

  function initPremiumUi() {
    installPremiumGear();
    createPremiumSettingsModal();
    patchGroupActions();
  }

  initPremiumUi();

  // ВАЖНО:
  // MutationObserver по всему document.body отключён,
  // потому что он вызывал зависание страницы.
  // Обновляем кнопки безопасно только после основных действий.
  document.addEventListener("click", () => {
    setTimeout(() => {
      installPremiumGear();
      patchGroupActions();
    }, 100);
  });

  window.addEventListener("beforeunload", stopMicMeter);
})();

/* =========================================================
   CALLIBRI FULL REDESIGN ENHANCER
   Без setInterval и без MutationObserver по всему body
   ========================================================= */

(function setupCallibriFullRedesign() {
  function makeRailUser() {
    const avatar = currentUser && currentUser.avatar;
    const letter = currentUser
      ? (currentUser.displayName || currentUser.username || "C")[0].toUpperCase()
      : "C";

    if (avatar) {
      return `<img src="${escapeHtml(avatar)}" alt="avatar">`;
    }

    return escapeHtml(letter);
  }

  function ensureRail() {
    if (!app || document.getElementById("callibriRail")) return;

    const rail = document.createElement("nav");
    rail.id = "callibriRail";
    rail.className = "callibri-rail";

    rail.innerHTML = `
      <div class="callibri-rail-logo">C</div>
      <button class="callibri-rail-btn active" type="button" title="Чаты">💬</button>
      <button class="callibri-rail-btn" type="button" title="Контакты">👥</button>
      <button class="callibri-rail-btn" type="button" title="Звонки">📞</button>
      <button class="callibri-rail-btn" type="button" title="Уведомления">🔔</button>
      <button class="callibri-rail-btn" type="button" title="Избранное">☆</button>
      <div class="callibri-rail-spacer"></div>
      <button id="callibriRailSettings" class="callibri-rail-btn" type="button" title="Настройки">⚙</button>
      <div id="callibriRailUser" class="callibri-rail-user">${makeRailUser()}</div>
    `;

    app.prepend(rail);

    const settings = document.getElementById("callibriRailSettings");

    if (settings) {
      settings.addEventListener("click", () => {
        const premiumGear = document.getElementById("callibriPremiumGear");
        const globalGear = document.getElementById("callibriGlobalSettingsBtn");
        const fallbackProfile = document.getElementById("profileBtn");

        if (premiumGear) premiumGear.click();
        else if (globalGear) globalGear.click();
        else if (fallbackProfile) fallbackProfile.click();
      });
    }
  }

  function updateRailUser() {
    const railUser = document.getElementById("callibriRailUser");

    if (railUser) {
      railUser.innerHTML = makeRailUser();
    }
  }

  function ensureFilterChips() {
    if (!searchInput || !searchInput.parentElement) return;
    if (document.getElementById("callibriFilterRow")) return;

    const row = document.createElement("div");
    row.id = "callibriFilterRow";
    row.className = "callibri-filter-row";

    row.innerHTML = `
      <button class="callibri-filter-chip active" type="button">Все</button>
      <button class="callibri-filter-chip" type="button">Непрочитанные</button>
      <button class="callibri-filter-chip" type="button">Группы</button>
    `;

    searchInput.insertAdjacentElement("afterend", row);

    row.querySelectorAll(".callibri-filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        row.querySelectorAll(".callibri-filter-chip").forEach((item) => {
          item.classList.remove("active");
        });

        button.classList.add("active");
      });
    });
  }

  function ensurePremiumGearFallback() {
    if (!meName) return;

    const profile = meName.closest(".profile");

    if (!profile) return;

    const oldProfileBtn = document.getElementById("profileBtn");
    const oldLogoutBtn = document.getElementById("logoutBtn");

    if (oldProfileBtn) oldProfileBtn.style.display = "none";
    if (oldLogoutBtn) oldLogoutBtn.style.display = "none";

    if (document.getElementById("callibriGlobalSettingsBtn")) return;
    if (document.getElementById("callibriPremiumGear")) return;

    const btn = document.createElement("button");
    btn.id = "callibriGlobalSettingsBtn";
    btn.type = "button";
    btn.title = "Настройки";
    btn.textContent = "⚙";

    btn.addEventListener("click", () => {
      const profileBtn = document.getElementById("profileBtn");

      if (profileBtn) {
        profileBtn.click();
        return;
      }

      if (typeof openProfileModal === "function") {
        openProfileModal();
      }
    });

    profile.appendChild(btn);
  }

  function decorateGroupButtons() {
    const invite = document.getElementById("inviteGroupBtn");
    const leave = document.getElementById("leaveGroupBtn");
    const del = document.getElementById("deleteGroupBtn");

    if (invite && !invite.dataset.redesignDone) {
      invite.dataset.redesignDone = "1";
      invite.classList.add("callibri-premium-group-btn", "add");
      invite.innerHTML = `<span>👥</span><b>Добавить</b>`;
    }

    if (leave && !leave.dataset.redesignDone) {
      leave.dataset.redesignDone = "1";
      leave.classList.add("callibri-premium-group-btn", "leave");
      leave.innerHTML = `<span>↪</span><b>Выйти</b>`;
    }

    if (del && !del.dataset.redesignDone) {
      del.dataset.redesignDone = "1";
      del.classList.add("callibri-premium-group-btn", "delete");
      del.innerHTML = `<span>🗑</span><b>Удалить</b>`;
    }
  }

  function decorateComposerButtons() {
    if (attachBtn && !attachBtn.dataset.redesignDone) {
      attachBtn.dataset.redesignDone = "1";
      attachBtn.innerHTML = "📎";
      attachBtn.title = "Прикрепить файл";
    }

    if (voiceBtn && !voiceBtn.dataset.redesignDone) {
      voiceBtn.dataset.redesignDone = "1";
      voiceBtn.innerHTML = "🎙";
      voiceBtn.title = "Голосовое сообщение";
    }
  }

  function decorateExistingUi() {
    if (app) app.classList.add("callibri-redesign-ready");

    ensureRail();
    updateRailUser();
    ensureFilterChips();
    ensurePremiumGearFallback();
    decorateGroupButtons();
    decorateComposerButtons();
  }

  function patchRenderersSafely() {
    if (typeof renderRecentChats === "function" && !renderRecentChats.__callibriRedesignPatched) {
      const original = renderRecentChats;

      renderRecentChats = function patchedRenderRecentChats() {
        original();
        decorateExistingUi();
      };

      renderRecentChats.__callibriRedesignPatched = true;
    }

    if (typeof renderGroups === "function" && !renderGroups.__callibriRedesignPatched) {
      const original = renderGroups;

      renderGroups = function patchedRenderGroups() {
        original();
        decorateExistingUi();
      };

      renderGroups.__callibriRedesignPatched = true;
    }

    if (typeof renderMessages === "function" && !renderMessages.__callibriRedesignPatched) {
      const original = renderMessages;

      renderMessages = function patchedRenderMessages() {
        original();
        decorateExistingUi();
      };

      renderMessages.__callibriRedesignPatched = true;
    }

    if (typeof showGroupActions === "function" && !showGroupActions.__callibriRedesignPatched) {
      const original = showGroupActions;

      showGroupActions = function patchedShowGroupActions(group) {
        original(group);
        decorateGroupButtons();
      };

      showGroupActions.__callibriRedesignPatched = true;
    }

    if (typeof startApp === "function" && !startApp.__callibriRedesignPatched) {
      const original = startApp;

      startApp = async function patchedStartApp() {
        const result = await original.apply(this, arguments);
        decorateExistingUi();
        return result;
      };

      startApp.__callibriRedesignPatched = true;
    }
  }

  function runRedesignBoot() {
    patchRenderersSafely();
    decorateExistingUi();

    setTimeout(decorateExistingUi, 150);
    setTimeout(decorateExistingUi, 500);
    setTimeout(decorateExistingUi, 1200);
  }

  runRedesignBoot();

  document.addEventListener("click", () => {
    setTimeout(decorateExistingUi, 80);
  });

  window.addEventListener("focus", () => {
    setTimeout(decorateExistingUi, 120);
  });
})();

/* =========================================================
   CALLIBRI UI RECOVERY FIX
   Убираем дубли шестерёнок, добавляем бренд, возвращаем клики
   ========================================================= */

(function callibriUiRecoveryFix() {
  const PATCHED_FLAG = "__callibriUiRecoveryFixPatched";

  function getCurrentUserSafe() {
    try {
      if (typeof currentUser !== "undefined" && currentUser) return currentUser;
    } catch (e) {}
    return null;
  }

  function makeBrandCard() {
    const card = document.createElement("div");
    card.id = "callibriBrandCard";

    card.innerHTML = `
      <div class="callibri-brand-logo">
        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 36C20 30 27 29 34 30C31 25 30 20 31 15C39 18 45 24 48 31C54 29 58 26 60 23C59 31 55 38 48 42C45 52 38 58 26 60C32 54 34 49 34 45C26 46 18 43 12 36Z" fill="white"/>
        </svg>
      </div>
      <div class="callibri-brand-text">
        <strong>callibri</strong>
        <span>messenger</span>
      </div>
    `;

    return card;
  }

  function ensureBrandCard() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    const old = document.getElementById("callibriBrandCard");
    if (!old) {
      sidebar.insertBefore(makeBrandCard(), sidebar.firstChild);
    }
  }

  function removeInjectedDuplicates() {
    const selectorsToRemoveCompletely = [
      "#callibriPremiumGear",
      "#callibriGlobalSettingsBtn",
      "#callibriRailSettings",
      ".clean-settings-gear",
      ".callibri-settings-gear"
    ];

    selectorsToRemoveCompletely.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    });

    const originalSettings = document.getElementById("profileBtn");
    if (originalSettings) {
      originalSettings.style.display = "none";
      originalSettings.style.pointerEvents = "none";
    }

    const secondarySettings = document.getElementById("settingsBtn");
    if (secondarySettings) {
      secondarySettings.style.display = "none";
      secondarySettings.style.pointerEvents = "none";
    }
  }

  function openSettingsSafely() {
    const originalSettings = document.getElementById("profileBtn");
    if (originalSettings && typeof originalSettings.click === "function") {
      originalSettings.click();
      return;
    }

    const secondarySettings = document.getElementById("settingsBtn");
    if (secondarySettings && typeof secondarySettings.click === "function") {
      secondarySettings.click();
      return;
    }

    if (typeof openProfileModal === "function") {
      openProfileModal();
      return;
    }

    console.warn("Не удалось открыть настройки: не найдена функция или кнопка.");
  }

  function ensureSingleSettingsButton() {
    const profile = document.querySelector(".profile");
    if (!profile) return;

    profile.querySelectorAll("#callibriSingleSettingsBtn").forEach((el, index) => {
      if (index > 0) el.remove();
    });

    Array.from(profile.querySelectorAll("button")).forEach((btn) => {
      if (btn.id === "callibriSingleSettingsBtn") return;
      if (btn.id === "profileBtn") return;
      if (btn.id === "settingsBtn") return;

      const text = (btn.textContent || "").trim();
      const title = (btn.title || "").toLowerCase();

      if (text === "⚙" || text === "☸" || title.includes("настрой")) {
        btn.remove();
      }
    });

    let settingsBtn = document.getElementById("callibriSingleSettingsBtn");

    if (!settingsBtn) {
      settingsBtn = document.createElement("button");
      settingsBtn.id = "callibriSingleSettingsBtn";
      settingsBtn.type = "button";
      settingsBtn.title = "Настройки";
      settingsBtn.textContent = "⚙";
      settingsBtn.addEventListener("click", openSettingsSafely);
      profile.appendChild(settingsBtn);
    }
  }

  function makeRailUserContent() {
    const user = getCurrentUserSafe();
    if (!user) return "C";

    if (user.avatar) {
      const img = document.createElement("img");
      img.src = user.avatar;
      img.alt = "avatar";
      return img;
    }

    return ((user.displayName || user.username || "C")[0] || "C").toUpperCase();
  }

  function ensureRailUser() {
    const railUser = document.getElementById("callibriRailUser");
    if (!railUser) return;

    railUser.innerHTML = "";

    const content = makeRailUserContent();
    if (typeof content === "string") {
      railUser.textContent = content;
    } else {
      railUser.appendChild(content);
    }
  }

  function ensureFilterRow() {
    const search = document.getElementById("search");
    if (!search || !search.parentElement) return;

    let row = document.getElementById("callibriFilterRow");

    if (!row) {
      row = document.createElement("div");
      row.id = "callibriFilterRow";
      row.className = "callibri-filter-row";
      row.innerHTML = `
        <button class="callibri-filter-chip active" type="button">Все</button>
        <button class="callibri-filter-chip" type="button">Непрочитанные</button>
        <button class="callibri-filter-chip" type="button">Группы</button>
      `;

      search.insertAdjacentElement("afterend", row);

      row.querySelectorAll(".callibri-filter-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          row.querySelectorAll(".callibri-filter-chip").forEach((el) => {
            el.classList.remove("active");
          });
          chip.classList.add("active");
        });
      });
    }
  }

  function unblockHiddenLayers() {
    const hiddenSelectors = [
      ".modal.hidden",
      ".callibri-premium-settings.hidden",
      ".message-context-menu.hidden",
      ".callibri-sidebar-context-menu.hidden"
    ];

    hiddenSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.style.display = "none";
        el.style.pointerEvents = "none";
        el.style.opacity = "0";
        el.style.visibility = "hidden";
      });
    });
  }

  function restorePointerEvents() {
    [
      "#app",
      ".callibri-rail",
      ".sidebar",
      ".chat",
      ".chat-header",
      "#messages",
      ".chat-input",
      ".profile"
    ].forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.style.pointerEvents = "auto";
      });
    });
  }

  function cleanupTopLeftRawLook() {
    const railLogo = document.querySelector(".callibri-rail-logo");
    if (railLogo) {
      railLogo.style.display = "none";
    }
  }

  function runUiFix() {
    removeInjectedDuplicates();
    ensureBrandCard();
    ensureSingleSettingsButton();
    ensureFilterRow();
    ensureRailUser();
    unblockHiddenLayers();
    restorePointerEvents();
    cleanupTopLeftRawLook();
  }

  function patchFunction(functionName) {
    const fn = window[functionName];
    if (typeof fn !== "function") return;
    if (fn[PATCHED_FLAG]) return;

    const wrapped = function () {
      const result = fn.apply(this, arguments);
      setTimeout(runUiFix, 0);
      setTimeout(runUiFix, 150);
      setTimeout(runUiFix, 500);
      return result;
    };

    wrapped[PATCHED_FLAG] = true;
    window[functionName] = wrapped;
  }

  function patchKnownFunctions() {
    [
      "startApp",
      "renderRecentChats",
      "renderGroups",
      "renderMessages",
      "renderUsers",
      "openChat",
      "openGroupChat",
      "renderArchiveButton",
      "showGroupActions"
    ].forEach(patchFunction);
  }

  function boot() {
    patchKnownFunctions();
    runUiFix();
    setTimeout(runUiFix, 200);
    setTimeout(runUiFix, 800);
    setTimeout(runUiFix, 1600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener("load", () => {
    setTimeout(runUiFix, 200);
  });
})();

/* =========================================================
   CALLIBRI REDESIGN — ЭТАП 2 JS
   Аккуратное оформление без зависаний
   ========================================================= */

(function callibriStageTwoRedesign() {
  function appEl() {
    return document.getElementById("app");
  }

  function applyStageClass() {
    const app = appEl();

    if (app) {
      app.classList.add("callibri-stage-two");
    }
  }

  function fixGroupButtonsText() {
    const invite = document.getElementById("inviteGroupBtn");
    const leave = document.getElementById("leaveGroupBtn");
    const del = document.getElementById("deleteGroupBtn");

    if (invite && invite.dataset.stageTwo !== "1") {
      invite.dataset.stageTwo = "1";
      invite.innerHTML = `<span>👥</span><b>Добавить</b>`;
    }

    if (leave && leave.dataset.stageTwo !== "1") {
      leave.dataset.stageTwo = "1";
      leave.innerHTML = `<span>↪</span><b>Выйти</b>`;
    }

    if (del && del.dataset.stageTwo !== "1") {
      del.dataset.stageTwo = "1";
      del.innerHTML = `<span>🗑</span><b>Удалить</b>`;
    }
  }

  function polishComposerButtons() {
    const attach = document.getElementById("attachBtn");
    const voice = document.getElementById("voiceBtn");
    const send = document.getElementById("sendBtn");

    if (attach && attach.dataset.stageTwo !== "1") {
      attach.dataset.stageTwo = "1";
      attach.innerHTML = "📎";
      attach.title = "Прикрепить файл";
    }

    if (voice && voice.dataset.stageTwo !== "1") {
      voice.dataset.stageTwo = "1";
      voice.innerHTML = "🎙";
      voice.title = "Голосовое сообщение";
    }

    if (send && send.dataset.stageTwo !== "1") {
      send.dataset.stageTwo = "1";
      send.textContent = "Отправить";
    }
  }

  function removeDuplicateSettingsAgain() {
    const duplicates = [
      "#callibriPremiumGear",
      "#callibriGlobalSettingsBtn",
      "#callibriRailSettings",
      ".clean-settings-gear",
      ".callibri-settings-gear"
    ];

    duplicates.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    });
  }

  function addChatHeaderMenuDots() {
    const header = document.querySelector(".chat-header");

    if (!header) return;
    if (document.getElementById("callibriChatMoreBtn")) return;

    const btn = document.createElement("button");
    btn.id = "callibriChatMoreBtn";
    btn.type = "button";
    btn.title = "Дополнительно";
    btn.textContent = "⋮";

    btn.style.width = "46px";
    btn.style.height = "46px";
    btn.style.borderRadius = "16px";
    btn.style.background = "rgba(255,255,255,0.045)";
    btn.style.color = "#9fb8c6";
    btn.style.fontSize = "24px";
    btn.style.cursor = "pointer";
    btn.style.border = "1px solid rgba(148,163,184,0.12)";

    btn.addEventListener("click", () => {
      alert("Дополнительное меню чата пока в разработке");
    });

    const groupActions = document.getElementById("groupActionsBox");

    if (groupActions && groupActions.parentElement === header) {
      groupActions.insertAdjacentElement("afterend", btn);
    } else {
      header.appendChild(btn);
    }
  }

  function decorateChatItems() {
    document.querySelectorAll(".user, .recent-chat-item, .group-item").forEach((item) => {
      if (item.dataset.stageTwo === "1") return;
      item.dataset.stageTwo = "1";
    });
  }

  function runStageTwo() {
    applyStageClass();
    removeDuplicateSettingsAgain();
    fixGroupButtonsText();
    polishComposerButtons();
    addChatHeaderMenuDots();
    decorateChatItems();
  }

  function patchSafe(name) {
    const fn = window[name];

    if (typeof fn !== "function") return;
    if (fn.__stageTwoPatched) return;

    const wrapped = function () {
      const result = fn.apply(this, arguments);

      setTimeout(runStageTwo, 0);
      setTimeout(runStageTwo, 120);

      return result;
    };

    wrapped.__stageTwoPatched = true;
    window[name] = wrapped;
  }

  function boot() {
    [
      "startApp",
      "renderRecentChats",
      "renderGroups",
      "renderMessages",
      "renderUsers",
      "openChat",
      "openGroup",
      "showGroupActions",
      "renderEmptyChat"
    ].forEach(patchSafe);

    runStageTwo();

    setTimeout(runStageTwo, 200);
    setTimeout(runStageTwo, 700);
    setTimeout(runStageTwo, 1400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener("focus", () => {
    setTimeout(runStageTwo, 120);
  });
})();

/* =========================================================
   CALLIBRI — перенос настроек в левый бар
   ========================================================= */

(function moveSettingsButtonToRail() {
  function removeOldProfileSettings() {
    const selectors = [
      '.profile #settingsBtn',
      '.profile #openSettingsBtn',
      '.profile #profileSettingsBtn',
      '.profile .profile-settings-btn',
      '.profile .settings-btn',
      '.profile .clean-settings-gear',
      '.profile .callibri-settings-btn',
      '.profile .callibri-profile-gear',
      '.profile button[title="Настройки"]'
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    });
  }

  function getRail() {
    return (
      document.querySelector('.callibri-rail') ||
      document.querySelector('.left-rail') ||
      document.querySelector('.sidebar-rail')
    );
  }

  function ensureRailBottom(rail) {
    let bottom = rail.querySelector('.callibri-rail-bottom');

    if (!bottom) {
      bottom = document.createElement('div');
      bottom.className = 'callibri-rail-bottom';
      rail.appendChild(bottom);
    }

    return bottom;
  }

  function openSettingsSafe() {
    if (typeof window.openSettingsModal === 'function') {
      window.openSettingsModal();
      return;
    }

    if (typeof window.openSettings === 'function') {
      window.openSettings();
      return;
    }

    if (typeof window.showSettingsModal === 'function') {
      window.showSettingsModal();
      return;
    }

    const modal =
      document.getElementById('settingsModal') ||
      document.getElementById('callibriSettingsModal') ||
      document.querySelector('.settings-modal');

    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function createRailSettingsButton(bottom) {
    let btn = document.getElementById('railSettingsBtn');

    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'railSettingsBtn';
    btn.type = 'button';
    btn.title = 'Настройки';
    btn.setAttribute('aria-label', 'Настройки');

    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2"></circle>
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.55V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1.04H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.55V3a2 2 0 0 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.64a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .66.38 1.25.98 1.55.18.09.38.14.57.14H21a2 2 0 0 1 0 4h-.05c-.19 0-.39.05-.57.14-.6.3-.98.89-.98 1.55z"></path>
      </svg>
    `;

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSettingsSafe();
    });

    bottom.prepend(btn);

    return btn;
  }

  function runMoveSettings() {
    removeOldProfileSettings();

    const rail = getRail();
    if (!rail) return;

    const bottom = ensureRailBottom(rail);
    createRailSettingsButton(bottom);
  }

  function patchRender(fnName) {
    const original = window[fnName];

    if (typeof original !== 'function') return;
    if (original.__settingsRailPatched) return;

    const wrapped = function () {
      const result = original.apply(this, arguments);
      setTimeout(runMoveSettings, 0);
      setTimeout(runMoveSettings, 120);
      return result;
    };

    wrapped.__settingsRailPatched = true;
    window[fnName] = wrapped;
  }

  function boot() {
    [
      'startApp',
      'renderRecentChats',
      'renderGroups',
      'renderUsers',
      'renderProfile',
      'openChat',
      'openGroup'
    ].forEach(patchRender);

    runMoveSettings();

    setTimeout(runMoveSettings, 200);
    setTimeout(runMoveSettings, 800);
    setTimeout(runMoveSettings, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('focus', () => {
    setTimeout(runMoveSettings, 100);
  });
})();

/* =========================================================
   CALLIBRI — логотип в левом баре
   ========================================================= */

(function installCallibriRailBrand() {
  function getRail() {
    return (
      document.querySelector(".callibri-rail") ||
      document.querySelector(".left-rail") ||
      document.querySelector(".sidebar-rail")
    );
  }

  function hideOldRawLogo(rail) {
    if (!rail) return;

    rail.querySelectorAll(".callibri-rail-logo").forEach((el) => {
      el.style.display = "none";
      el.setAttribute("aria-hidden", "true");
    });

    Array.from(rail.children).forEach((child) => {
      const text = String(child.textContent || "").trim();

      if (
        child.id !== "callibriRailBrand" &&
        child.classList.contains("callibri-rail-logo") &&
        text.toLowerCase() === "c"
      ) {
        child.remove();
      }
    });
  }

  function createBrand() {
    const brand = document.createElement("div");
    brand.id = "callibriRailBrand";
    brand.title = "Callibri Messenger";

    brand.innerHTML = `
      <div id="callibriRailBrandIcon">
        <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M15 55C27 43 39 40 52 42C46 34 44 25 47 14C61 20 72 31 77 45C86 42 91 37 94 32C93 47 85 59 72 66C66 80 54 89 33 92C43 82 47 73 47 66C35 68 24 64 15 55Z"
            fill="url(#bodyGradient)"
          />
          <path
            d="M15 55C27 43 39 40 52 42C40 49 31 58 25 71C21 67 18 62 15 55Z"
            fill="url(#wingGradient)"
          />
          <path
            d="M50 42C61 39 71 40 83 45C73 50 64 56 55 66C54 56 53 49 50 42Z"
            fill="white"
            fill-opacity="0.92"
          />
          <path
            d="M72 35C78 27 86 22 94 20C86 29 80 38 76 46C75 42 74 38 72 35Z"
            fill="#E0FBFF"
          />
          <circle cx="64" cy="29" r="3.2" fill="#06111F"/>
          <defs>
            <linearGradient id="bodyGradient" x1="18" y1="22" x2="82" y2="83" gradientUnits="userSpaceOnUse">
              <stop stop-color="#67E8F9"/>
              <stop offset="0.45" stop-color="#0EA5E9"/>
              <stop offset="1" stop-color="#10B981"/>
            </linearGradient>
            <linearGradient id="wingGradient" x1="15" y1="42" x2="55" y2="74" gradientUnits="userSpaceOnUse">
              <stop stop-color="#A7F3D0"/>
              <stop offset="0.52" stop-color="#22D3EE"/>
              <stop offset="1" stop-color="#0F766E"/>
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div id="callibriRailBrandText">
        calli<span>bri</span>
      </div>
    `;

    return brand;
  }

  function installBrand() {
    const rail = getRail();

    if (!rail) return;

    hideOldRawLogo(rail);

    let brand = document.getElementById("callibriRailBrand");

    if (!brand) {
      brand = createBrand();
      rail.prepend(brand);
    } else if (brand.parentElement !== rail) {
      rail.prepend(brand);
    }

    hideOldRawLogo(rail);
  }

  function patchSafe(functionName) {
    const original = window[functionName];

    if (typeof original !== "function") return;
    if (original.__callibriRailBrandPatched) return;

    const wrapped = function () {
      const result = original.apply(this, arguments);

      setTimeout(installBrand, 0);
      setTimeout(installBrand, 180);

      return result;
    };

    wrapped.__callibriRailBrandPatched = true;
    window[functionName] = wrapped;
  }

  function bootBrand() {
    [
      "startApp",
      "renderRecentChats",
      "renderGroups",
      "renderUsers",
      "renderMessages",
      "openChat",
      "openGroup",
      "renderEmptyChat"
    ].forEach(patchSafe);

    installBrand();

    setTimeout(installBrand, 200);
    setTimeout(installBrand, 800);
    setTimeout(installBrand, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootBrand, { once: true });
  } else {
    bootBrand();
  }

  window.addEventListener("focus", () => {
    setTimeout(installBrand, 120);
  });
})();
