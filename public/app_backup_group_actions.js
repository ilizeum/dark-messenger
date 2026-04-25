const API_URL = "";
const socket = io();

let currentUser = null;
let selectedUser = null;
let selectedGroup = null;
let selectedChatType = null;

let usersCache = [];
let groupsCache = [];
let messagesCache = [];

let unreadDirect = {};
let unreadGroups = {};

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

const MAX_FILE_SIZE = 8 * 1024 * 1024;

const auth = document.getElementById("auth");
const app = document.getElementById("app");

const displayNameInput = document.getElementById("displayName");
const usernameInput = document.getElementById("username");
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

let groupsBox = null;
let createGroupBtn = null;
let groupModal = null;

let avatarInput = null;
let fileInput = null;
let attachBtn = null;
let voiceBtn = null;
let profileAvatarBtn = null;

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

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
    username: usernameInput ? normalizeUsername(usernameInput.value) : "",
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
  const remember = rememberMeInput ? rememberMeInput.checked : false;

  sessionStorage.removeItem("darkMessengerUser");
  localStorage.removeItem("darkMessengerUser");

  if (remember) {
    localStorage.setItem("darkMessengerUser", JSON.stringify(user));
  } else {
    sessionStorage.setItem("darkMessengerUser", JSON.stringify(user));
  }
}

function updateSavedUser(user) {
  currentUser = user;

  const hasLocal = Boolean(localStorage.getItem("darkMessengerUser"));

  sessionStorage.removeItem("darkMessengerUser");
  localStorage.removeItem("darkMessengerUser");

  if (hasLocal) {
    localStorage.setItem("darkMessengerUser", JSON.stringify(user));
  } else {
    sessionStorage.setItem("darkMessengerUser", JSON.stringify(user));
  }
}

function loadSavedUser() {
  try {
    const localUser = localStorage.getItem("darkMessengerUser");
    const sessionUser = sessionStorage.getItem("darkMessengerUser");

    if (localUser) {
      if (rememberMeInput) rememberMeInput.checked = true;
      return JSON.parse(localUser);
    }

    if (sessionUser) {
      if (rememberMeInput) rememberMeInput.checked = false;
      return JSON.parse(sessionUser);
    }

    return null;
  } catch {
    return null;
  }
}

function logout() {
  localStorage.removeItem("darkMessengerUser");
  sessionStorage.removeItem("darkMessengerUser");

  currentUser = null;
  selectedUser = null;
  selectedGroup = null;
  selectedChatType = null;

  usersCache = [];
  groupsCache = [];
  messagesCache = [];
  unreadDirect = {};
  unreadGroups = {};

  updateUnreadTitle();

  if (rememberMeInput) rememberMeInput.checked = false;

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

function updateUnreadTitle() {
  const totalDirect = Object.values(unreadDirect).reduce((sum, value) => sum + value, 0);
  const totalGroups = Object.values(unreadGroups).reduce((sum, value) => sum + value, 0);
  const total = totalDirect + totalGroups;

  document.title = total > 0 ? `(${total}) Dark Messenger` : "Dark Messenger";
}

function unreadBadge(count) {
  if (!count || count <= 0) return "";

  return `
    <span style="
      margin-left:auto;
      min-width:22px;
      height:22px;
      padding:0 7px;
      border-radius:999px;
      background:#06b6d4;
      color:white;
      font-size:12px;
      font-weight:800;
      display:flex;
      align-items:center;
      justify-content:center;
      box-shadow:0 0 0 2px rgba(6,182,212,0.18);
    ">
      ${count > 99 ? "99+" : count}
    </span>
  `;
}

function addRecentUserFromMessage(message) {
  const from = normalizeUsername(message.from || message.username);

  if (!from || !currentUser || from === currentUser.username) return;

  const exists = usersCache.some((user) => user.username === from);

  if (exists) return;

  usersCache.unshift({
    id: from,
    username: from,
    displayName: message.displayName || from,
    avatar: message.avatar || ""
  });
}

function setupProfileUI() {
  if (!meName || document.getElementById("profileAvatarBtn")) return;

  const profile = meName.closest(".profile");

  if (!profile) return;

  profileAvatarBtn = document.createElement("button");
  profileAvatarBtn.id = "profileAvatarBtn";
  profileAvatarBtn.type = "button";
  profileAvatarBtn.title = "Сменить аватар";

  avatarInput = document.createElement("input");
  avatarInput.id = "avatarInput";
  avatarInput.type = "file";
  avatarInput.accept = "image/*";
  avatarInput.style.display = "none";

  profile.prepend(profileAvatarBtn);
  document.body.appendChild(avatarInput);

  profileAvatarBtn.addEventListener("click", () => {
    avatarInput.click();
  });

  avatarInput.addEventListener("change", handleAvatarChange);

  renderMyAvatar();
}

function renderMyAvatar() {
  if (!profileAvatarBtn || !currentUser) return;

  if (currentUser.avatar) {
    profileAvatarBtn.innerHTML = `<img src="${currentUser.avatar}" alt="avatar">`;
  } else {
    profileAvatarBtn.textContent = (currentUser.displayName || currentUser.username || "?")[0].toUpperCase();
  }
}

async function handleAvatarChange(event) {
  const file = event.target.files && event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Выбери изображение");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    alert("Файл слишком большой. Максимум 8 МБ.");
    return;
  }

  try {
    const avatar = await fileToDataUrl(file);

    const data = await request("/api/avatar", {
      method: "POST",
      body: JSON.stringify({
        username: currentUser.username,
        avatar
      })
    });

    updateSavedUser(data.user);
    renderMyAvatar();

    if (meName) meName.textContent = currentUser.displayName || currentUser.username;
    if (meLogin) meLogin.textContent = "@" + currentUser.username;

    alert("Аватар обновлён");
  } catch (error) {
    alert(error.message);
  } finally {
    event.target.value = "";
  }
}

function setupGroupUI() {
  if (document.getElementById("createGroupBtn")) return;

  if (!usersBox || !usersBox.parentElement) return;

  createGroupBtn = document.createElement("button");
  createGroupBtn.id = "createGroupBtn";
  createGroupBtn.type = "button";
  createGroupBtn.textContent = "+ Создать группу";

  const groupsTitle = document.createElement("div");
  groupsTitle.className = "sidebar-title";
  groupsTitle.textContent = "Группы";

  groupsBox = document.createElement("div");
  groupsBox.id = "groups";

  const usersTitle = document.createElement("div");
  usersTitle.className = "sidebar-title";
  usersTitle.textContent = "Поиск пользователей";

  usersBox.parentElement.insertBefore(createGroupBtn, usersBox);
  usersBox.parentElement.insertBefore(groupsTitle, usersBox);
  usersBox.parentElement.insertBefore(groupsBox, usersBox);
  usersBox.parentElement.insertBefore(usersTitle, usersBox);

  createGroupBtn.addEventListener("click", openGroupModal);

  createGroupModal();
}

function createGroupModal() {
  if (document.getElementById("groupModal")) return;

  groupModal = document.createElement("div");
  groupModal.id = "groupModal";
  groupModal.className = "modal hidden";

  groupModal.innerHTML = `
    <div class="modal-card">
      <h2>Создать группу</h2>
      <p>Добавь участников через @id. Например: @test1, @test2</p>

      <input id="groupNameInput" type="text" placeholder="Название группы" />
      <textarea id="groupMembersInput" placeholder="@id участников через запятую"></textarea>

      <div id="groupError"></div>

      <div class="modal-actions">
        <button id="cancelGroupBtn" type="button">Отмена</button>
        <button id="saveGroupBtn" type="button">Создать</button>
      </div>
    </div>
  `;

  document.body.appendChild(groupModal);

  document.getElementById("cancelGroupBtn").addEventListener("click", closeGroupModal);
  document.getElementById("saveGroupBtn").addEventListener("click", createGroup);
}

function openGroupModal() {
  const modal = document.getElementById("groupModal");
  const error = document.getElementById("groupError");

  if (error) error.textContent = "";
  if (modal) modal.classList.remove("hidden");
}

function closeGroupModal() {
  const modal = document.getElementById("groupModal");

  if (modal) modal.classList.add("hidden");
}

async function createGroup() {
  const nameInput = document.getElementById("groupNameInput");
  const membersInput = document.getElementById("groupMembersInput");
  const error = document.getElementById("groupError");

  const name = nameInput ? nameInput.value.trim() : "";
  const membersText = membersInput ? membersInput.value.trim() : "";

  const members = membersText
    .split(",")
    .map(normalizeUsername)
    .filter(Boolean);

  if (!name) {
    if (error) error.textContent = "Введите название группы";
    return;
  }

  try {
    const data = await request("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        owner: currentUser.username,
        name,
        members
      })
    });

    if (nameInput) nameInput.value = "";
    if (membersInput) membersInput.value = "";
    if (error) error.textContent = "";

    closeGroupModal();

    await loadGroups();
    openGroup(data.group);
  } catch (err) {
    if (error) error.textContent = err.message;
  }
}

function setupMessageTools() {
  if (!sendBtn || document.getElementById("attachBtn")) return;

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
  fileInput.id = "fileInput";
  fileInput.type = "file";
  fileInput.accept = "image/*,video/*";
  fileInput.style.display = "none";

  sendBtn.parentElement.insertBefore(attachBtn, sendBtn);
  sendBtn.parentElement.insertBefore(voiceBtn, sendBtn);
  document.body.appendChild(fileInput);

  attachBtn.addEventListener("click", () => {
    if (!canSendNow()) return;
    fileInput.click();
  });

  fileInput.addEventListener("change", handleFileSend);

  voiceBtn.addEventListener("click", toggleVoiceRecording);
}

function canSendNow() {
  return Boolean(currentUser && selectedChatType && (selectedUser || selectedGroup));
}

async function handleFileSend(event) {
  const file = event.target.files && event.target.files[0];

  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    alert("Файл слишком большой. Максимум 8 МБ.");
    event.target.value = "";
    return;
  }

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) {
    alert("Можно отправлять только фото или видео.");
    event.target.value = "";
    return;
  }

  try {
    const url = await fileToDataUrl(file);

    const media = {
      type: isImage ? "image" : "video",
      url,
      name: file.name
    };

    sendMediaMessage(media);
  } catch (error) {
    alert("Не удалось отправить файл");
  } finally {
    event.target.value = "";
  }
}

async function toggleVoiceRecording() {
  if (!canSendNow()) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Запись голоса не поддерживается в этом браузере/окне.");
    return;
  }

  if (isRecording) {
    stopVoiceRecording();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    recordedChunks = [];

    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, {
        type: "audio/webm"
      });

      stream.getTracks().forEach((track) => track.stop());

      if (blob.size > MAX_FILE_SIZE) {
        alert("Голосовое слишком большое. Максимум 8 МБ.");
        return;
      }

      const url = await blobToDataUrl(blob);

      sendMediaMessage({
        type: "audio",
        url,
        name: "voice.webm"
      });
    };

    mediaRecorder.start();
    isRecording = true;

    if (voiceBtn) {
      voiceBtn.classList.add("recording");
      voiceBtn.textContent = "■";
      voiceBtn.title = "Остановить запись";
    }
  } catch (error) {
    alert("Разреши доступ к микрофону.");
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  isRecording = false;

  if (voiceBtn) {
    voiceBtn.classList.remove("recording");
    voiceBtn.textContent = "🎙";
    voiceBtn.title = "Голосовое сообщение";
  }
}

function sendMediaMessage(media) {
  if (!canSendNow()) return;

  if (selectedChatType === "direct" && selectedUser) {
    socket.emit("send_message", {
      from: currentUser.username,
      to: selectedUser.username,
      text: "",
      media
    });
  }

  if (selectedChatType === "group" && selectedGroup) {
    socket.emit("send_group_message", {
      from: currentUser.username,
      groupId: selectedGroup.id,
      text: "",
      media
    });
  }
}

async function startApp() {
  if (!currentUser) return;

  setupProfileUI();
  setupGroupUI();
  setupMessageTools();

  if (auth) auth.classList.add("hidden");
  if (app) app.classList.remove("hidden");

  if (meName) meName.textContent = currentUser.displayName || currentUser.username;
  if (meLogin) meLogin.textContent = "@" + currentUser.username;

  renderMyAvatar();

  if (searchInput) {
    searchInput.value = "";
    searchInput.placeholder = "Поиск по @id, например @ilizeum";
  }

  socket.emit("user_online", {
    username: currentUser.username
  });

  await loadGroups();

  renderSearchHint();
  renderEmptyChat();
}

async function loadGroups() {
  if (!currentUser) return;

  try {
    const data = await request(`/api/groups?me=${encodeURIComponent(currentUser.username)}`);

    groupsCache = data.groups || [];
    renderGroups();
  } catch (error) {
    console.error(error);
  }
}

function renderGroups() {
  if (!groupsBox) return;

  groupsBox.innerHTML = "";

  if (!groupsCache.length) {
    groupsBox.innerHTML = `<div class="empty small-empty">Групп пока нет</div>`;
    return;
  }

  groupsCache.forEach((group) => {
    const item = document.createElement("button");
    item.className = "user group-item";

    if (selectedChatType === "group" && selectedGroup && selectedGroup.id === group.id) {
      item.classList.add("active");
    }

    const count = unreadGroups[group.id] || 0;

    item.innerHTML = `
      <div class="avatar group-avatar">#</div>
      <div class="user-info">
        <b>${escapeHtml(group.name)}</b>
        <span>${group.members.length} участн.</span>
      </div>
      ${unreadBadge(count)}
    `;

    item.addEventListener("click", () => {
      openGroup(group);
    });

    groupsBox.appendChild(item);
  });
}

async function loadUsers(query = "") {
  if (!currentUser) return;

  const cleanQuery = normalizeUsername(query);

  if (!cleanQuery) {
    renderUsers("");
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

  const hasUnreadUsers = usersCache.some((user) => unreadDirect[user.username] > 0);

  if (hasUnreadUsers) {
    renderUsers("");
    return;
  }

  usersBox.innerHTML = `
    <div class="empty">
      Введите @id пользователя, чтобы найти чат.<br>
      Например: <b>@ilizeum</b>
    </div>
  `;
}

function renderAvatar(user) {
  const avatar = user && user.avatar;

  if (avatar) {
    return `<div class="avatar"><img src="${avatar}" alt="avatar"></div>`;
  }

  return `<div class="avatar">${escapeHtml(((user && (user.displayName || user.username)) || "?")[0] || "?")}</div>`;
}

function renderUsers(query = "") {
  if (!usersBox) return;

  const hasQuery = Boolean(normalizeUsername(query));
  const visibleUsers = hasQuery
    ? usersCache
    : usersCache.filter((user) => unreadDirect[user.username] > 0);

  usersBox.innerHTML = "";

  if (!visibleUsers.length) {
    if (hasQuery) {
      usersBox.innerHTML = `
        <div class="empty">
          Пользователь не найден.<br>
          Проверь @id: <b>@${escapeHtml(query)}</b>
        </div>
      `;
    } else {
      usersBox.innerHTML = `
        <div class="empty">
          Введите @id пользователя, чтобы найти чат.<br>
          Например: <b>@ilizeum</b>
        </div>
      `;
    }

    return;
  }

  visibleUsers.forEach((user) => {
    const item = document.createElement("button");
    item.className = "user";

    if (selectedChatType === "direct" && selectedUser && selectedUser.username === user.username) {
      item.classList.add("active");
    }

    const count = unreadDirect[user.username] || 0;

    item.innerHTML = `
      ${renderAvatar(user)}
      <div class="user-info">
        <b>${escapeHtml(user.displayName || user.username)}</b>
        <span>@${escapeHtml(user.username)}</span>
      </div>
      ${unreadBadge(count)}
    `;

    item.addEventListener("click", () => {
      openChat(user);
    });

    usersBox.appendChild(item);
  });
}

function renderEmptyChat() {
  selectedUser = null;
  selectedGroup = null;
  selectedChatType = null;
  messagesCache = [];

  if (chatAvatar) {
    chatAvatar.textContent = "?";
    chatAvatar.innerHTML = "?";
  }

  if (chatName) chatName.textContent = "Выберите чат";
  if (chatStatus) chatStatus.textContent = "Найдите пользователя или выберите группу";

  if (messagesBox) {
    messagesBox.innerHTML = `
      <div class="empty">
        Чаты не показываются автоматически.<br>
        Найдите пользователя через поиск или создайте группу.
      </div>
    `;
  }

  if (messageInput) {
    messageInput.value = "";
    messageInput.disabled = true;
  }

  if (sendBtn) sendBtn.disabled = true;
  if (attachBtn) attachBtn.disabled = true;
  if (voiceBtn) voiceBtn.disabled = true;

  renderGroups();
  renderSearchHint();
}

async function openChat(user) {
  selectedUser = user;
  selectedGroup = null;
  selectedChatType = "direct";
  messagesCache = [];

  unreadDirect[user.username] = 0;
  updateUnreadTitle();

  if (chatAvatar) {
    if (user.avatar) {
      chatAvatar.innerHTML = `<img src="${user.avatar}" alt="avatar">`;
    } else {
      chatAvatar.textContent = (user.displayName || user.username)[0] || "?";
    }
  }

  if (chatName) chatName.textContent = user.displayName || user.username;
  if (chatStatus) chatStatus.textContent = "@" + user.username;

  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;
  if (voiceBtn) voiceBtn.disabled = false;

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
    renderGroups();
  } catch (error) {
    if (messagesBox) {
      messagesBox.innerHTML = `<div class="empty">Ошибка загрузки сообщений</div>`;
    }
  }
}

async function openGroup(group) {
  selectedGroup = group;
  selectedUser = null;
  selectedChatType = "group";
  messagesCache = [];

  unreadGroups[group.id] = 0;
  updateUnreadTitle();

  if (chatAvatar) {
    chatAvatar.textContent = "#";
    chatAvatar.innerHTML = "#";
  }

  if (chatName) chatName.textContent = group.name;
  if (chatStatus) chatStatus.textContent = `${group.members.length} участн.`;

  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;
  if (voiceBtn) voiceBtn.disabled = false;

  if (messagesBox) {
    messagesBox.innerHTML = `<div class="empty">Загрузка...</div>`;
  }

  socket.emit("open_group", {
    me: currentUser.username,
    groupId: group.id
  });

  try {
    const data = await request(
      `/api/groups/${encodeURIComponent(group.id)}/messages?me=${encodeURIComponent(currentUser.username)}`
    );

    messagesCache = data.messages || [];
    renderMessages();
    renderGroups();
    renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
  } catch (error) {
    if (messagesBox) {
      messagesBox.innerHTML = `<div class="empty">Ошибка загрузки группы</div>`;
    }
  }
}

function sendMessage() {
  if (!currentUser) return;

  const text = messageInput ? messageInput.value.trim() : "";

  if (!text) return;

  if (selectedChatType === "direct" && selectedUser) {
    socket.emit("send_message", {
      from: currentUser.username,
      to: selectedUser.username,
      text
    });
  }

  if (selectedChatType === "group" && selectedGroup) {
    socket.emit("send_group_message", {
      from: currentUser.username,
      groupId: selectedGroup.id,
      text
    });
  }

  if (messageInput) {
    messageInput.value = "";
    messageInput.focus();
  }
}

function renderMedia(media) {
  if (!media || !media.url) return "";

  if (media.type === "image") {
    return `
      <div class="message-media">
        <img src="${media.url}" alt="${escapeHtml(media.name || "image")}" loading="lazy">
      </div>
    `;
  }

  if (media.type === "video") {
    return `
      <div class="message-media">
        <video src="${media.url}" controls></video>
      </div>
    `;
  }

  if (media.type === "audio") {
    return `
      <div class="message-media">
        <audio src="${media.url}" controls></audio>
      </div>
    `;
  }

  return "";
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
    const mediaHtml = renderMedia(message.media);

    bubble.innerHTML = `
      <div class="message-name">${escapeHtml(message.displayName || message.username || "")}</div>
      ${mediaHtml}
      ${text ? `<div class="message-text">${escapeHtml(text)}</div>` : ""}
      <div class="message-time">${formatTime(message.created_at)}</div>
    `;

    messagesBox.appendChild(bubble);
  });

  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function shouldShowIncomingDirect(message) {
  if (!currentUser || !selectedUser || selectedChatType !== "direct") return false;

  const from = message.from || message.username;
  const to = message.to;

  return (
    (from === currentUser.username && to === selectedUser.username) ||
    (from === selectedUser.username && to === currentUser.username)
  );
}

function shouldShowIncomingGroup(message) {
  if (!currentUser || !selectedGroup || selectedChatType !== "group") return false;

  return message.groupId === selectedGroup.id;
}

socket.on("load_messages", (messages) => {
  messagesCache = Array.isArray(messages) ? messages : [];
  renderMessages();
});

socket.on("new_message", (message) => {
  const from = normalizeUsername(message.from || message.username);

  if (!currentUser || from === currentUser.username) {
    if (shouldShowIncomingDirect(message)) {
      const exists = messagesCache.some((m) => m.id === message.id);

      if (!exists) {
        messagesCache.push(message);
        renderMessages();
      }
    }

    return;
  }

  addRecentUserFromMessage(message);

  if (shouldShowIncomingDirect(message)) {
    const exists = messagesCache.some((m) => m.id === message.id);

    if (!exists) {
      messagesCache.push(message);
      renderMessages();
    }

    unreadDirect[from] = 0;
  } else {
    unreadDirect[from] = (unreadDirect[from] || 0) + 1;
  }

  updateUnreadTitle();
  renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
});

socket.on("new_group_message", (message) => {
  loadGroups();

  if (!currentUser) return;

  const groupId = String(message.groupId || "");
  const from = normalizeUsername(message.from || message.username);

  if (!groupId) return;

  if (shouldShowIncomingGroup(message)) {
    const exists = messagesCache.some((m) => m.id === message.id);

    if (!exists) {
      messagesCache.push(message);
      renderMessages();
    }

    unreadGroups[groupId] = 0;
  } else if (from !== currentUser.username) {
    unreadGroups[groupId] = (unreadGroups[groupId] || 0) + 1;
  }

  updateUnreadTitle();
  renderGroups();
});

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

if (togglePasswordBtn && passwordInput) {
  togglePasswordBtn.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";

    passwordInput.type = isHidden ? "text" : "password";
    togglePasswordBtn.textContent = isHidden ? "Скрыть" : "Показать";
  });
}

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