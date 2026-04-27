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

let archivedDirect = {};
let archivedGroups = {};
let archiveMode = false;

let archiveBtn = null;
let archiveContextMenu = null;
let archiveContextTarget = null;

let typingTimer = null;
let isTypingNow = false;

let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingStartTime = 0;
let recordingTimerInterval = null;
let isRecording = false;
let finalVoiceBlob = null;
let liveWaveformBars = [];

let audioContext = null;
let analyserNode = null;
let analyserDataArray = null;
let visualizerAnimationFrame = null;

let notificationPermissionRequested = false;
let notificationSoundCooldown = false;

let fileInput = null;
let attachBtn = null;
let voiceBtn = null;
let recordingPanel = null;
let recordingTimer = null;
let recordingVisualizer = null;
let recordingCancelBtn = null;
let recordingSendBtn = null;

let recentChatsBox = null;
let groupsBox = null;
let createGroupBtn = null;
let groupModal = null;
let groupActionsBox = null;

let settingsBtn = null;
let profileAvatarBtn = null;
let settingsModal = null;
let profileAvatarDraft = "";

let contextMenu = null;
let contextMessage = null;
let replyToMessage = null;
let editingMessage = null;
let replyPanel = null;
let editPanel = null;

const voicePlayers = new Map();

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

let appSettings = {
  selectedMicId: "",
  notificationSoundsEnabled: true,
  notificationVolume: 0.8,
  voicePlaybackVolume: 1,
  favoritesText: ""
};

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
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

function showError(text) {
  if (authError) authError.textContent = text || "Ошибка";
}

function clearError() {
  if (authError) authError.textContent = "";
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

function getInputData() {
  return {
    displayName: displayNameInput ? displayNameInput.value.trim() : "",
    username: usernameInput ? normalizeUsername(usernameInput.value) : "",
    password: passwordInput ? passwordInput.value : ""
  };
}

function saveUser(user) {
  const remember = rememberMeInput ? rememberMeInput.checked : false;

  localStorage.removeItem("darkMessengerUser");
  sessionStorage.removeItem("darkMessengerUser");
  localStorage.removeItem("callibriUser");
  sessionStorage.removeItem("callibriUser");

  if (remember) {
    localStorage.setItem("callibriUser", JSON.stringify(user));
  } else {
    sessionStorage.setItem("callibriUser", JSON.stringify(user));
  }
}

function updateSavedUser(user) {
  const useLocal =
    Boolean(localStorage.getItem("callibriUser")) ||
    Boolean(localStorage.getItem("darkMessengerUser"));

  currentUser = user;

  localStorage.removeItem("darkMessengerUser");
  sessionStorage.removeItem("darkMessengerUser");
  localStorage.removeItem("callibriUser");
  sessionStorage.removeItem("callibriUser");

  if (useLocal) {
    localStorage.setItem("callibriUser", JSON.stringify(user));
  } else {
    sessionStorage.setItem("callibriUser", JSON.stringify(user));
  }
}

function loadSavedUser() {
  try {
    const localUser =
      localStorage.getItem("callibriUser") ||
      localStorage.getItem("darkMessengerUser");

    const sessionUser =
      sessionStorage.getItem("callibriUser") ||
      sessionStorage.getItem("darkMessengerUser");

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

function getSettingsKey() {
  if (!currentUser) return "";
  return `callibri_settings_${currentUser.username}`;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(getSettingsKey());
    if (!raw) return;

    appSettings = {
      ...appSettings,
      ...JSON.parse(raw)
    };
  } catch {}
}

function saveSettings() {
  try {
    localStorage.setItem(getSettingsKey(), JSON.stringify(appSettings));
  } catch {}
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
    await startApp();
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
    await startApp();
  } catch (error) {
    showError(error.message);
  }
}

function logout() {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();
  closeSettingsModal();
  hideContextMenu();
  cancelReply();
  cancelEdit();

  localStorage.removeItem("callibriUser");
  sessionStorage.removeItem("callibriUser");
  localStorage.removeItem("darkMessengerUser");
  sessionStorage.removeItem("darkMessengerUser");

  currentUser = null;
  selectedUser = null;
  selectedGroup = null;
  selectedChatType = null;

  usersCache = [];
  recentChatsCache = [];
  groupsCache = [];
  messagesCache = [];
  unreadDirect = {};
  unreadGroups = {};
  onlineUsers = {};
  typingUsers = {};

  archivedDirect = {};
archivedGroups = {};
archiveMode = false;

  if (auth) auth.classList.remove("hidden");
  if (app) app.classList.add("hidden");

  updateUnreadTitle();
}

function updateUnreadTitle() {
  const directCount = Object.values(unreadDirect).reduce((sum, value) => sum + value, 0);
  const groupCount = Object.values(unreadGroups).reduce((sum, value) => sum + value, 0);
  const total = directCount + groupCount;

  document.title = total > 0 ? `(${total}) Callibri` : "Callibri";
}

function injectStyles() {
  if (document.getElementById("callibriDynamicStyles")) return;

  const style = document.createElement("style");
  style.id = "callibriDynamicStyles";

  style.textContent = `
    .callibri-avatar-btn {
      width: 52px;
      height: 52px;
      border-radius: 18px;
      overflow: hidden;
      background: linear-gradient(135deg, #0ea5e9, #10b981);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 22px;
      flex-shrink: 0;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
    }

    .callibri-avatar-btn img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .callibri-settings-btn {
      width: 44px;
      height: 44px;
      margin-left: auto;
      border-radius: 15px;
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.9), rgba(16, 185, 129, 0.8));
      color: white;
      font-size: 20px;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
    }

    .online-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 6px;
      background: #64748b;
    }

    .online-dot.online {
      background: #22c55e;
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
    }

    .unread-badge {
      margin-left: auto;
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 999px;
      background: #06b6d4;
      color: white;
      font-size: 12px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .message {
      position: relative;
    }

    .message-meta {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 6px;
      font-size: 12px;
      color: #9fb3c8;
    }

    .message-status {
      position: relative;
      display: inline-flex;
      width: 20px;
      height: 13px;
      flex-shrink: 0;
    }

    .message-status__check {
      position: absolute;
      top: -2px;
      font-size: 13px;
      line-height: 1;
      font-weight: 900;
    }

    .message-status__check.first {
      left: 0;
    }

    .message-status__check.second {
      left: 7px;
    }

    .message-status.unread .message-status__check {
      color: #94a3b8;
    }

    .message-status.read .message-status__check {
      color: #5fd2ff;
      text-shadow: 0 0 8px rgba(95, 210, 255, 0.35);
    }

    .message-edited {
      font-size: 11px;
      opacity: 0.7;
    }

    .message-reply-preview {
      margin-bottom: 8px;
      padding: 7px 9px;
      border-radius: 11px;
      border-left: 3px solid #22d3ee;
      background: rgba(34, 211, 238, 0.12);
      overflow: hidden;
    }

    .message.mine .message-reply-preview {
      border-left-color: rgba(255, 255, 255, 0.85);
      background: rgba(255, 255, 255, 0.13);
    }

    .message-reply-author {
      font-size: 12px;
      font-weight: 900;
      color: #67e8f9;
      margin-bottom: 2px;
    }

    .message.mine .message-reply-author {
      color: rgba(255, 255, 255, 0.85);
    }

    .message-reply-text {
      font-size: 12px;
      color: rgba(226, 232, 240, 0.82);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .message-context-menu {
      position: fixed;
      z-index: 999999;
      width: 220px;
      padding: 7px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.97);
      border: 1px solid rgba(148, 163, 184, 0.18);
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(18px);
    }

    .message-context-menu.hidden {
      display: none;
    }

    .message-context-menu button {
      width: 100%;
      height: 40px;
      border: none;
      outline: none;
      background: transparent;
      color: #e5e7eb;
      border-radius: 11px;
      padding: 0 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 11px;
      font-size: 14px;
      font-weight: 700;
      text-align: left;
    }

    .message-context-menu button:hover {
      background: rgba(148, 163, 184, 0.13);
    }

    .message-context-menu button.danger {
      color: #fb7185;
    }

    .message-context-menu button.danger:hover {
      background: rgba(251, 113, 133, 0.14);
    }

    .mode-panel {
      margin: 8px 0 10px;
      padding: 10px 12px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.18);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .mode-panel.hidden {
      display: none;
    }

    .mode-panel-line {
      width: 3px;
      align-self: stretch;
      min-height: 36px;
      border-radius: 999px;
      background: #22d3ee;
      flex-shrink: 0;
    }

    .mode-panel.edit .mode-panel-line {
      background: #f59e0b;
    }

    .mode-panel-content {
      flex: 1;
      min-width: 0;
    }

    .mode-panel-title {
      font-size: 12px;
      font-weight: 900;
      color: #67e8f9;
      margin-bottom: 3px;
    }

    .mode-panel.edit .mode-panel-title {
      color: #fbbf24;
    }

    .mode-panel-text {
      color: #cbd5e1;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mode-panel-close {
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 50%;
      background: rgba(148, 163, 184, 0.13);
      color: white;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .settings-modal-shell {
      width: min(96vw, 760px);
      max-height: 88vh;
      overflow: auto;
      background: linear-gradient(180deg, rgba(7,37,67,.98), rgba(10,72,86,.98));
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 26px;
      padding: 22px;
      color: #e2e8f0;
      box-shadow: 0 30px 80px rgba(0,0,0,.38);
    }

    .settings-modal-shell h2 {
      margin: 0 0 8px;
      color: #fff;
    }

    .settings-section {
      margin-top: 16px;
      padding: 16px;
      border-radius: 18px;
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.07);
    }

    .settings-section h3 {
      margin: 0 0 10px;
      color: #d9f99d;
    }

    .settings-section input,
    .settings-section select,
    .settings-section textarea {
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 10px;
      padding: 11px 13px;
      border-radius: 13px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(2, 6, 23, .45);
      color: #e2e8f0;
      outline: none;
    }

    .settings-section textarea {
      min-height: 130px;
      resize: vertical;
    }

    .settings-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .settings-row button,
    .settings-modal-shell button {
      min-height: 38px;
      padding: 0 14px;
      border-radius: 13px;
      border: none;
      background: rgba(255,255,255,.1);
      color: white;
      font-weight: 800;
      cursor: pointer;
    }

    .settings-row .primary,
    .settings-modal-shell .primary {
      background: linear-gradient(135deg, #0ea5e9, #10b981);
    }

    .settings-row .danger {
      background: linear-gradient(135deg, rgba(190,24,93,.88), rgba(153,27,27,.95));
    }

    .settings-avatar-preview {
      width: 72px;
      height: 72px;
      border-radius: 22px;
      overflow: hidden;
      background: linear-gradient(135deg, #2563eb, #10b981);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 900;
      margin-bottom: 10px;
    }

    .settings-avatar-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .voice-card__footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .voice-card__footer-left,
    .voice-card__footer-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .voice-card__clock {
      color: #9fb3c8;
      font-size: 12px;
    }
      .archive-btn {
      width: 100%;
      min-height: 62px;
      margin: 10px 0 12px;
      padding: 10px 12px;
      border: 1px solid rgba(34, 211, 238, 0.24);
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.18), rgba(16, 185, 129, 0.14));
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 12px;
      text-align: left;
      cursor: pointer;
      transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
    }

    .archive-btn:hover {
      transform: translateY(-1px);
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.26), rgba(16, 185, 129, 0.2));
      border-color: rgba(125, 211, 252, 0.38);
    }

    .archive-icon {
      width: 38px;
      height: 38px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(125, 211, 252, 0.24);
      color: #67e8f9;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      flex-shrink: 0;
      box-shadow: 0 10px 22px rgba(0,0,0,0.2);
    }

    .archive-info {
      min-width: 0;
      flex: 1;
    }

    .archive-info b {
      display: block;
      color: #f8fafc;
      font-size: 14px;
      font-weight: 900;
      margin-bottom: 3px;
    }

    .archive-info span {
      display: block;
      color: #9bd8e6;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .archive-badge {
      min-width: 24px;
      height: 24px;
      padding: 0 7px;
      border-radius: 999px;
      background: #06b6d4;
      color: white;
      font-size: 12px;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .archive-context-menu {
      position: fixed;
      z-index: 999999;
      width: 210px;
      padding: 7px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.97);
      border: 1px solid rgba(148, 163, 184, 0.18);
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(18px);
    }

    .archive-context-menu.hidden {
      display: none;
    }

    .archive-context-menu button {
      width: 100%;
      height: 40px;
      border: none;
      outline: none;
      background: transparent;
      color: #e5e7eb;
      border-radius: 11px;
      padding: 0 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 11px;
      font-size: 14px;
      font-weight: 800;
      text-align: left;
    }

    .archive-context-menu button:hover {
      background: rgba(148, 163, 184, 0.13);
    }`;

  document.head.appendChild(style);
}

function onlineDot(username) {
  const online = onlineUsers[normalizeUsername(username)];

  return `
    <span class="online-dot ${online ? "online" : ""}"></span>
  `;
}

function unreadBadge(count) {
  if (!count || count <= 0) return "";

  return `<span class="unread-badge">${count > 99 ? "99+" : count}</span>`;
}

function renderAvatar(user) {
  const avatar = user && user.avatar;

  if (avatar) {
    return `<div class="avatar"><img src="${avatar}" alt="avatar"></div>`;
  }

  return `<div class="avatar">${escapeHtml(((user && (user.displayName || user.username)) || "?")[0] || "?")}</div>`;
}

function setupProfileUI() {
  if (!meName) return;

  const profile = meName.closest(".profile");

  if (!profile) return;

  if (!profileAvatarBtn) {
    profileAvatarBtn = document.createElement("button");
    profileAvatarBtn.id = "profileAvatarBtn";
    profileAvatarBtn.type = "button";
    profileAvatarBtn.className = "callibri-avatar-btn";
    profileAvatarBtn.title = "Профиль и настройки";
    profileAvatarBtn.addEventListener("click", openSettingsModal);
    profile.prepend(profileAvatarBtn);
  }

  if (!settingsBtn) {
    settingsBtn = document.createElement("button");
    settingsBtn.id = "settingsBtn";
    settingsBtn.type = "button";
    settingsBtn.className = "callibri-settings-btn";
    settingsBtn.title = "Настройки";
    settingsBtn.textContent = "⚙";
    settingsBtn.addEventListener("click", openSettingsModal);
    profile.appendChild(settingsBtn);
  }

  if (logoutBtn) logoutBtn.style.display = "none";

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

function setupSettingsModal() {
  if (document.getElementById("settingsModal")) {
    settingsModal = document.getElementById("settingsModal");
    return;
  }

  settingsModal = document.createElement("div");
  settingsModal.id = "settingsModal";
  settingsModal.className = "modal hidden";

  settingsModal.innerHTML = `
    <div class="settings-modal-shell">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <h2>Настройки Callibri</h2>
          <div style="color:#9bd8e6;font-size:13px;">Профиль, микрофон, избранное и уведомления</div>
        </div>

        <button id="settingsCloseBtn" type="button">×</button>
      </div>

      <div class="settings-section">
        <h3>Профиль</h3>
        <div id="settingsAvatarPreview" class="settings-avatar-preview">?</div>
        <input id="settingsDisplayName" type="text" placeholder="Имя" />
        <input id="settingsUsername" type="text" placeholder="username без @" />
        <input id="settingsAvatarFile" type="file" accept="image/*" style="display:none;" />

        <div class="settings-row">
          <button id="settingsChangeAvatar" type="button">Сменить аватарку</button>
          <button id="settingsRemoveAvatar" type="button">Убрать</button>
          <button id="settingsSaveProfile" type="button" class="primary">Сохранить профиль</button>
        </div>

        <div id="settingsProfileError" style="margin-top:8px;color:#fb7185;font-size:13px;"></div>
      </div>

      <div class="settings-section">
        <h3>Микрофон</h3>
        <select id="settingsMicSelect"></select>

        <div class="settings-row">
          <button id="settingsRefreshMics" type="button">Обновить список</button>
          <button id="settingsSaveMic" type="button" class="primary">Сохранить микрофон</button>
        </div>

        <div style="margin-top:8px;color:#9bd8e6;font-size:12px;">
          Для лучшего качества не выбирай Bluetooth Hands-Free микрофон.
        </div>
      </div>

      <div class="settings-section">
        <h3>Избранное</h3>
        <textarea id="settingsFavorites" placeholder="Твои заметки, ссылки, важная информация..."></textarea>

        <div class="settings-row">
          <button id="settingsSaveFavorites" type="button" class="primary">Сохранить избранное</button>
          <button id="settingsClearFavorites" type="button">Очистить</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Уведомления и звук</h3>

        <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <input id="settingsNotificationsEnabled" type="checkbox" style="width:auto;margin:0;" />
          <span>Звук уведомлений колибри</span>
        </label>

        <label>Громкость уведомлений</label>
        <input id="settingsNotificationVolume" type="range" min="0" max="100" step="1" />

        <label>Громкость голосовых</label>
        <input id="settingsVoiceVolume" type="range" min="0" max="100" step="1" />

        <div class="settings-row">
          <button id="settingsTestSound" type="button">Проверить звук</button>
          <button id="settingsSaveSounds" type="button" class="primary">Сохранить звук</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Устройство входа</h3>
        <div id="settingsDeviceInfo" style="font-size:13px;color:#cbd5e1;line-height:1.6;"></div>
      </div>

      <div class="settings-row" style="margin-top:16px;justify-content:space-between;">
        <button id="settingsLogout" type="button" class="danger">Выйти из аккаунта</button>
        <button id="settingsDone" type="button" class="primary">Готово</button>
      </div>
    </div>
  `;

  document.body.appendChild(settingsModal);

  document.getElementById("settingsCloseBtn").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsDone").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsLogout").addEventListener("click", logout);

  document.getElementById("settingsChangeAvatar").addEventListener("click", () => {
    document.getElementById("settingsAvatarFile").click();
  });

  document.getElementById("settingsRemoveAvatar").addEventListener("click", () => {
    profileAvatarDraft = "";
    renderSettingsAvatar();
  });

  document.getElementById("settingsAvatarFile").addEventListener("change", handleSettingsAvatar);

  document.getElementById("settingsSaveProfile").addEventListener("click", saveProfileFromSettings);
  document.getElementById("settingsRefreshMics").addEventListener("click", populateMicrophones);
  document.getElementById("settingsSaveMic").addEventListener("click", saveMicSettings);

  document.getElementById("settingsSaveFavorites").addEventListener("click", () => {
    appSettings.favoritesText = document.getElementById("settingsFavorites").value;
    saveSettings();
    alert("Избранное сохранено");
  });

  document.getElementById("settingsClearFavorites").addEventListener("click", () => {
    document.getElementById("settingsFavorites").value = "";
    appSettings.favoritesText = "";
    saveSettings();
  });

  document.getElementById("settingsTestSound").addEventListener("click", playNotificationSound);
  document.getElementById("settingsSaveSounds").addEventListener("click", saveSoundSettings);
}

function openSettingsModal() {
  setupSettingsModal();
  loadSettings();

  profileAvatarDraft = currentUser.avatar || "";

  document.getElementById("settingsDisplayName").value = currentUser.displayName || currentUser.username || "";
  document.getElementById("settingsUsername").value = currentUser.username || "";
  document.getElementById("settingsFavorites").value = appSettings.favoritesText || "";
  document.getElementById("settingsNotificationsEnabled").checked = Boolean(appSettings.notificationSoundsEnabled);
  document.getElementById("settingsNotificationVolume").value = String(Math.round((appSettings.notificationVolume || 0.8) * 100));
  document.getElementById("settingsVoiceVolume").value = String(Math.round((appSettings.voicePlaybackVolume || 1) * 100));

  document.getElementById("settingsDeviceInfo").innerHTML = `
    Браузер: ${escapeHtml(navigator.userAgent)}<br>
    Платформа: ${escapeHtml(navigator.platform || "—")}<br>
    Язык: ${escapeHtml(navigator.language || "—")}<br>
    Экран: ${window.screen.width} × ${window.screen.height}
  `;

  renderSettingsAvatar();
  populateMicrophones();

  settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.add("hidden");
}

function renderSettingsAvatar() {
  const box = document.getElementById("settingsAvatarPreview");

  if (!box) return;

  if (profileAvatarDraft) {
    box.innerHTML = `<img src="${profileAvatarDraft}" alt="avatar">`;
  } else {
    box.textContent = (currentUser.displayName || currentUser.username || "?")[0].toUpperCase();
  }
}

async function handleSettingsAvatar(event) {
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

  profileAvatarDraft = await fileToDataUrl(file);
  renderSettingsAvatar();
  event.target.value = "";
}

async function saveProfileFromSettings() {
  const error = document.getElementById("settingsProfileError");
  const displayName = document.getElementById("settingsDisplayName").value.trim();
  const newUsername = normalizeUsername(document.getElementById("settingsUsername").value);
  const oldUsername = currentUser.username;

  error.textContent = "";

  if (!displayName || !newUsername) {
    error.textContent = "Введите имя и username";
    return;
  }

  try {
    const data = await request("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        oldUsername,
        newUsername,
        displayName,
        avatar: profileAvatarDraft || ""
      })
    });

    updateSavedUser(data.user);

    if (meName) meName.textContent = currentUser.displayName || currentUser.username;
    if (meLogin) meLogin.textContent = "@" + currentUser.username;

    renderMyAvatar();

    socket.emit("user_online", {
      username: currentUser.username
    });

    await loadRecentChats();
    await loadGroups();

    alert("Профиль сохранён");
  } catch (err) {
    error.textContent = err.message;
  }
}

async function populateMicrophones() {
  const select = document.getElementById("settingsMicSelect");

  if (!select) return;

  select.innerHTML = `<option value="">Системный микрофон по умолчанию</option>`;

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
        temp.getTracks().forEach((track) => track.stop());
      } catch {}
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");

    microphones.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Микрофон ${index + 1}`;
      select.appendChild(option);
    });

    select.value = appSettings.selectedMicId || "";
  } catch {
    select.innerHTML = `<option value="">Не удалось получить микрофоны</option>`;
  }
}

function saveMicSettings() {
  const select = document.getElementById("settingsMicSelect");

  if (!select) return;

  appSettings.selectedMicId = select.value || "";
  saveSettings();
  alert("Микрофон сохранён");
}

function saveSoundSettings() {
  appSettings.notificationSoundsEnabled = document.getElementById("settingsNotificationsEnabled").checked;
  appSettings.notificationVolume = Number(document.getElementById("settingsNotificationVolume").value) / 100;
  appSettings.voicePlaybackVolume = Number(document.getElementById("settingsVoiceVolume").value) / 100;

  saveSettings();
  applyVoiceVolumeToPlayers();
  alert("Настройки звука сохранены");
}

function applyVoiceVolumeToPlayers() {
  for (const [, player] of voicePlayers.entries()) {
    try {
      player.setVolume(Number(appSettings.voicePlaybackVolume || 1));
    } catch {}
  }
}

function getArchiveStorageKey() {
  if (!currentUser || !currentUser.username) return "";
  return `callibri_archive_${currentUser.username}`;
}

function loadArchiveState() {
  if (!currentUser) return;

  try {
    const raw = localStorage.getItem(getArchiveStorageKey());
    const data = raw ? JSON.parse(raw) : {};

    archivedDirect = data.direct || {};
    archivedGroups = data.groups || {};
  } catch {
    archivedDirect = {};
    archivedGroups = {};
  }
}

function saveArchiveState() {
  if (!currentUser) return;

  localStorage.setItem(
    getArchiveStorageKey(),
    JSON.stringify({
      direct: archivedDirect,
      groups: archivedGroups
    })
  );
}

function isDirectArchived(username) {
  return Boolean(archivedDirect[normalizeUsername(username)]);
}

function isGroupArchived(groupId) {
  return Boolean(archivedGroups[String(groupId)]);
}

function archiveDirectChat(username) {
  const cleanUsername = normalizeUsername(username);

  if (!cleanUsername) return;

  archivedDirect[cleanUsername] = true;
  saveArchiveState();

  if (
    selectedChatType === "direct" &&
    selectedUser &&
    selectedUser.username === cleanUsername
  ) {
    renderEmptyChat();
  }

  renderRecentChats();
  renderGroups();
  renderArchiveButton();
}

function unarchiveDirectChat(username) {
  const cleanUsername = normalizeUsername(username);

  if (!cleanUsername) return;

  delete archivedDirect[cleanUsername];
  saveArchiveState();

  renderRecentChats();
  renderGroups();
  renderArchiveButton();
}

function archiveGroupChat(groupId) {
  const id = String(groupId || "");

  if (!id) return;

  archivedGroups[id] = true;
  saveArchiveState();

  if (
    selectedChatType === "group" &&
    selectedGroup &&
    selectedGroup.id === id
  ) {
    renderEmptyChat();
  }

  renderRecentChats();
  renderGroups();
  renderArchiveButton();
}

function unarchiveGroupChat(groupId) {
  const id = String(groupId || "");

  if (!id) return;

  delete archivedGroups[id];
  saveArchiveState();

  renderRecentChats();
  renderGroups();
  renderArchiveButton();
}

function getArchivedCount() {
  const directCount = recentChatsCache.filter((chat) =>
    isDirectArchived(chat.username)
  ).length;

  const groupCount = groupsCache.filter((group) =>
    isGroupArchived(group.id)
  ).length;

  return directCount + groupCount;
}

function renderArchiveButton() {
  if (!archiveBtn) return;

  const count = getArchivedCount();

  archiveBtn.innerHTML = `
    <div class="archive-icon">▣</div>

    <div class="archive-info">
      <b>${archiveMode ? "← Все чаты" : "Архив"}</b>
      <span>${
        archiveMode
          ? "Вернуться к обычным чатам"
          : count > 0
            ? `${count} в архиве`
            : "Пока пусто"
      }</span>
    </div>

    ${
      count > 0 && !archiveMode
        ? `<span class="archive-badge">${count}</span>`
        : ""
    }
  `;
}

function toggleArchiveMode() {
  archiveMode = !archiveMode;

  renderArchiveButton();
  renderRecentChats();
  renderGroups();
  renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
}

function setupArchiveContextMenu() {
  if (document.getElementById("archiveContextMenu")) {
    archiveContextMenu = document.getElementById("archiveContextMenu");
    return;
  }

  archiveContextMenu = document.createElement("div");
  archiveContextMenu.id = "archiveContextMenu";
  archiveContextMenu.className = "archive-context-menu hidden";

  archiveContextMenu.innerHTML = `
    <button id="archiveContextToggleBtn" type="button">В архив</button>
  `;

  document.body.appendChild(archiveContextMenu);

  document
    .getElementById("archiveContextToggleBtn")
    .addEventListener("click", () => {
      if (!archiveContextTarget) return;

      if (archiveContextTarget.type === "direct") {
        if (isDirectArchived(archiveContextTarget.id)) {
          unarchiveDirectChat(archiveContextTarget.id);
        } else {
          archiveDirectChat(archiveContextTarget.id);
        }
      }

      if (archiveContextTarget.type === "group") {
        if (isGroupArchived(archiveContextTarget.id)) {
          unarchiveGroupChat(archiveContextTarget.id);
        } else {
          archiveGroupChat(archiveContextTarget.id);
        }
      }

      hideArchiveContextMenu();
    });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#archiveContextMenu")) {
      hideArchiveContextMenu();
    }
  });

  window.addEventListener("resize", hideArchiveContextMenu);
}

function openArchiveContextMenu(event, target) {
  setupArchiveContextMenu();

  archiveContextTarget = target;

  const btn = document.getElementById("archiveContextToggleBtn");

  if (target.type === "direct") {
    btn.textContent = isDirectArchived(target.id)
      ? "Вернуть из архива"
      : "В архив";
  }

  if (target.type === "group") {
    btn.textContent = isGroupArchived(target.id)
      ? "Вернуть из архива"
      : "В архив";
  }

  archiveContextMenu.classList.remove("hidden");

  const rect = archiveContextMenu.getBoundingClientRect();

  let x = event.clientX;
  let y = event.clientY;

  if (x + rect.width > window.innerWidth) {
    x = window.innerWidth - rect.width - 10;
  }

  if (y + rect.height > window.innerHeight) {
    y = window.innerHeight - rect.height - 10;
  }

  archiveContextMenu.style.left = `${x}px`;
  archiveContextMenu.style.top = `${y}px`;
}

function hideArchiveContextMenu() {
  if (archiveContextMenu) {
    archiveContextMenu.classList.add("hidden");
  }
}

function setupGroupUI() {
  if (document.getElementById("createGroupBtn")) return;
  if (!usersBox || !usersBox.parentElement) return;

  archiveBtn = document.createElement("button");
  archiveBtn.id = "archiveBtn";
  archiveBtn.type = "button";
  archiveBtn.className = "archive-btn";

  createGroupBtn = document.createElement("button");
  createGroupBtn.id = "createGroupBtn";
  createGroupBtn.type = "button";
  createGroupBtn.textContent = "+ Создать группу";

  const recentTitle = document.createElement("div");
  recentTitle.className = "sidebar-title";
  recentTitle.textContent = "Личные чаты";

  recentChatsBox = document.createElement("div");
  recentChatsBox.id = "recentChats";

  const groupsTitle = document.createElement("div");
  groupsTitle.className = "sidebar-title";
  groupsTitle.textContent = "Группы";

  groupsBox = document.createElement("div");
  groupsBox.id = "groups";

  const usersTitle = document.createElement("div");
  usersTitle.className = "sidebar-title";
  usersTitle.textContent = "Поиск пользователей";

  usersBox.parentElement.insertBefore(archiveBtn, usersBox);
  usersBox.parentElement.insertBefore(createGroupBtn, usersBox);
  usersBox.parentElement.insertBefore(recentTitle, usersBox);
  usersBox.parentElement.insertBefore(recentChatsBox, usersBox);
  usersBox.parentElement.insertBefore(groupsTitle, usersBox);
  usersBox.parentElement.insertBefore(groupsBox, usersBox);
  usersBox.parentElement.insertBefore(usersTitle, usersBox);

  archiveBtn.addEventListener("click", toggleArchiveMode);
  createGroupBtn.addEventListener("click", openGroupModal);

  createGroupModal();
  setupArchiveContextMenu();
  renderArchiveButton();
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

function setupGroupActionsUI() {
  if (document.getElementById("groupActionsBox")) return;
  if (!chatStatus || !chatStatus.parentElement) return;

  groupActionsBox = document.createElement("div");
  groupActionsBox.id = "groupActionsBox";
  groupActionsBox.style.display = "none";
  groupActionsBox.style.marginTop = "8px";
  groupActionsBox.style.gap = "8px";
  groupActionsBox.style.flexWrap = "wrap";

  const leaveBtn = document.createElement("button");
  leaveBtn.id = "leaveGroupBtn";
  leaveBtn.type = "button";
  leaveBtn.textContent = "Выйти";
  leaveBtn.style.height = "32px";
  leaveBtn.style.padding = "0 12px";
  leaveBtn.style.borderRadius = "10px";
  leaveBtn.style.background = "#243044";
  leaveBtn.style.color = "white";
  leaveBtn.style.fontWeight = "700";

  const deleteBtn = document.createElement("button");
  deleteBtn.id = "deleteGroupBtn";
  deleteBtn.type = "button";
  deleteBtn.textContent = "Удалить";
  deleteBtn.style.height = "32px";
  deleteBtn.style.padding = "0 12px";
  deleteBtn.style.borderRadius = "10px";
  deleteBtn.style.background = "#7f1d1d";
  deleteBtn.style.color = "white";
  deleteBtn.style.fontWeight = "700";

  leaveBtn.addEventListener("click", leaveCurrentGroup);
  deleteBtn.addEventListener("click", deleteCurrentGroup);

  groupActionsBox.appendChild(leaveBtn);
  groupActionsBox.appendChild(deleteBtn);

  chatStatus.parentElement.appendChild(groupActionsBox);
}

function showGroupActions(group) {
  setupGroupActionsUI();

  if (!groupActionsBox || !group || !currentUser) return;

  const deleteBtn = document.getElementById("deleteGroupBtn");

  groupActionsBox.style.display = "flex";

  if (deleteBtn) {
    deleteBtn.style.display = group.owner === currentUser.username ? "inline-flex" : "none";
    deleteBtn.style.alignItems = "center";
    deleteBtn.style.justifyContent = "center";
  }
}

function hideGroupActions() {
  if (groupActionsBox) {
    groupActionsBox.style.display = "none";
  }
}

async function leaveCurrentGroup() {
  if (!currentUser || !selectedGroup) return;

  const ok = confirm(`Выйти из группы "${selectedGroup.name}"?`);

  if (!ok) return;

  try {
    await request(`/api/groups/${encodeURIComponent(selectedGroup.id)}/leave`, {
      method: "POST",
      body: JSON.stringify({
        me: currentUser.username
      })
    });

    groupsCache = groupsCache.filter((group) => group.id !== selectedGroup.id);
    delete unreadGroups[selectedGroup.id];

    renderGroups();
    renderEmptyChat();
    updateUnreadTitle();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteCurrentGroup() {
  if (!currentUser || !selectedGroup) return;

  const ok = confirm(`Удалить группу "${selectedGroup.name}" полностью?`);

  if (!ok) return;

  try {
    await request(`/api/groups/${encodeURIComponent(selectedGroup.id)}?me=${encodeURIComponent(currentUser.username)}`, {
      method: "DELETE"
    });

    groupsCache = groupsCache.filter((group) => group.id !== selectedGroup.id);
    delete unreadGroups[selectedGroup.id];

    renderGroups();
    renderEmptyChat();
    updateUnreadTitle();
  } catch (error) {
    alert(error.message);
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

  setupRecordingPanel();
  setupPanels();
}

function setupRecordingPanel() {
  if (document.getElementById("recordingPanel")) return;
  if (!sendBtn || !sendBtn.parentElement) return;

  recordingPanel = document.createElement("div");
  recordingPanel.id = "recordingPanel";
  recordingPanel.className = "recording-panel hidden";

  recordingPanel.innerHTML = `
    <div class="recording-left">
      <div class="recording-dot"></div>
      <div id="recordingTimer" class="recording-timer">00:00</div>
    </div>

    <div id="recordingVisualizer" class="recording-visualizer"></div>

    <div class="recording-actions">
      <button id="recordingCancelBtn" type="button" class="recording-action cancel">Отмена</button>
      <button id="recordingSendBtn" type="button" class="recording-action send" disabled>Отправить</button>
    </div>
  `;

  const chatInput = sendBtn.parentElement;

  if (chatInput && chatInput.parentElement) {
    chatInput.parentElement.appendChild(recordingPanel);
  }

  recordingTimer = document.getElementById("recordingTimer");
  recordingVisualizer = document.getElementById("recordingVisualizer");
  recordingCancelBtn = document.getElementById("recordingCancelBtn");
  recordingSendBtn = document.getElementById("recordingSendBtn");

  if (recordingCancelBtn) recordingCancelBtn.addEventListener("click", cancelVoiceRecording);
  if (recordingSendBtn) recordingSendBtn.addEventListener("click", sendRecordedVoice);
}

function setupPanels() {
  if (!sendBtn || !sendBtn.parentElement || !sendBtn.parentElement.parentElement) return;

  const inputBox = sendBtn.parentElement;
  const parent = inputBox.parentElement;

  if (!document.getElementById("replyPanelNew")) {
    replyPanel = document.createElement("div");
    replyPanel.id = "replyPanelNew";
    replyPanel.className = "mode-panel hidden";

    replyPanel.innerHTML = `
      <div class="mode-panel-line"></div>
      <div class="mode-panel-content">
        <div class="mode-panel-title">Ответ на сообщение</div>
        <div id="replyPanelTextNew" class="mode-panel-text"></div>
      </div>
      <button id="cancelReplyNew" type="button" class="mode-panel-close">×</button>
    `;

    parent.insertBefore(replyPanel, inputBox);

    document.getElementById("cancelReplyNew").addEventListener("click", cancelReply);
  } else {
    replyPanel = document.getElementById("replyPanelNew");
  }

  if (!document.getElementById("editPanelNew")) {
    editPanel = document.createElement("div");
    editPanel.id = "editPanelNew";
    editPanel.className = "mode-panel edit hidden";

    editPanel.innerHTML = `
      <div class="mode-panel-line"></div>
      <div class="mode-panel-content">
        <div class="mode-panel-title">Редактирование сообщения</div>
        <div class="mode-panel-text">Измени текст и нажми «Сохранить»</div>
      </div>
      <button id="cancelEditNew" type="button" class="mode-panel-close">×</button>
    `;

    parent.insertBefore(editPanel, inputBox);

    document.getElementById("cancelEditNew").addEventListener("click", cancelEdit);
  } else {
    editPanel = document.getElementById("editPanelNew");
  }
}

function setupContextMenu() {
  if (document.getElementById("callibriContextMenu")) {
    contextMenu = document.getElementById("callibriContextMenu");
    return;
  }

  contextMenu = document.createElement("div");
  contextMenu.id = "callibriContextMenu";
  contextMenu.className = "message-context-menu hidden";

  contextMenu.innerHTML = `
    <button id="contextReplyBtn" type="button">↩ Ответить</button>
    <button id="contextEditBtn" type="button">✎ Редактировать</button>
    <button id="contextDeleteBtn" type="button" class="danger">🗑 Удалить</button>
  `;

  document.body.appendChild(contextMenu);

  document.getElementById("contextReplyBtn").addEventListener("click", () => {
    if (!contextMessage) return;

    replyToMessage = {
      id: contextMessage.id,
      text: contextMessage.text,
      username: contextMessage.username,
      displayName: contextMessage.displayName
    };

    if (replyPanel) {
      const textBox = document.getElementById("replyPanelTextNew");
      if (textBox) textBox.textContent = replyToMessage.text || "Медиа";
      replyPanel.classList.remove("hidden");
    }

    cancelEdit();
    hideContextMenu();

    if (messageInput) messageInput.focus();
  });

  document.getElementById("contextEditBtn").addEventListener("click", () => {
    if (!contextMessage || !contextMessage.mine) return;

    editingMessage = {
      id: contextMessage.id,
      text: contextMessage.text
    };

    if (messageInput) {
      messageInput.value = contextMessage.text || "";
      messageInput.focus();
    }

    if (sendBtn) sendBtn.textContent = "Сохранить";
    if (editPanel) editPanel.classList.remove("hidden");

    cancelReply();
    hideContextMenu();
  });

  document.getElementById("contextDeleteBtn").addEventListener("click", () => {
    if (!contextMessage || !contextMessage.mine) return;

    deleteMessage(contextMessage.id);
    hideContextMenu();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#callibriContextMenu")) {
      hideContextMenu();
    }
  });

  window.addEventListener("resize", hideContextMenu);
}

function openContextMenu(event, data) {
  setupContextMenu();

  contextMessage = data;

  const editBtn = document.getElementById("contextEditBtn");
  const deleteBtn = document.getElementById("contextDeleteBtn");

  if (data.mine) {
    editBtn.style.display = "flex";
    deleteBtn.style.display = "flex";
  } else {
    editBtn.style.display = "none";
    deleteBtn.style.display = "none";
  }

  contextMenu.classList.remove("hidden");

  const rect = contextMenu.getBoundingClientRect();

  let x = event.clientX;
  let y = event.clientY;

  if (x + rect.width > window.innerWidth) {
    x = window.innerWidth - rect.width - 10;
  }

  if (y + rect.height > window.innerHeight) {
    y = window.innerHeight - rect.height - 10;
  }

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
}

function hideContextMenu() {
  if (contextMenu) contextMenu.classList.add("hidden");
}

function cancelReply() {
  replyToMessage = null;

  if (replyPanel) replyPanel.classList.add("hidden");
}

function cancelEdit() {
  editingMessage = null;

  if (editPanel) editPanel.classList.add("hidden");
  if (sendBtn) sendBtn.textContent = "Отправить";
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

    sendMediaMessage({
      type: isImage ? "image" : "video",
      url,
      name: file.name
    });
  } catch {
    alert("Не удалось отправить файл");
  } finally {
    event.target.value = "";
  }
}

function buildAudioConstraints(useExactDevice = true) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000
  };

  if (useExactDevice && appSettings.selectedMicId) {
    audio.deviceId = {
      exact: appSettings.selectedMicId
    };
  }

  return audio;
}

async function getRecordingStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(true)
    });
  } catch (error) {
    if (appSettings.selectedMicId) {
      return navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(false)
      });
    }

    throw error;
  }
}

function getBestAudioMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/ogg"
  ];

  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";

  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function toggleVoiceRecording() {
  if (!canSendNow()) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Запись голоса не поддерживается.");
    return;
  }

  if (isRecording) {
    finishVoiceRecording();
    return;
  }

  try {
    recordedChunks = [];
    finalVoiceBlob = null;
    liveWaveformBars = [];

    recordingStream = await getRecordingStream();

    const mimeType = getBestAudioMimeType();
    const options = {
      audioBitsPerSecond: 128000
    };

    if (mimeType) options.mimeType = mimeType;

    mediaRecorder = new MediaRecorder(recordingStream, options);

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000
    });

    const source = audioContext.createMediaStreamSource(recordingStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, {
        type: mimeType || "audio/webm"
      });

      finalVoiceBlob = blob;

      if (recordingSendBtn) {
        recordingSendBtn.disabled = !blob.size;
      }
    };

    mediaRecorder.start(250);
    isRecording = true;

    openRecordingPanel();
    startRecordingTimer();
    startRealtimeVisualizer();

    if (voiceBtn) {
      voiceBtn.classList.add("recording");
      voiceBtn.textContent = "■";
      voiceBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    alert("Разреши доступ к микрофону");
    cancelVoiceRecording();
  }
}

function openRecordingPanel() {
  if (!recordingPanel) return;

  recordingPanel.classList.remove("hidden");

  if (voiceBtn) voiceBtn.disabled = true;
  if (attachBtn) attachBtn.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (messageInput) messageInput.disabled = true;

  if (recordingSendBtn) recordingSendBtn.disabled = true;
  if (recordingVisualizer) recordingVisualizer.innerHTML = "";

  renderLiveWaveform([]);
}

function closeRecordingPanel() {
  if (!recordingPanel) return;

  recordingPanel.classList.add("hidden");

  if (voiceBtn) voiceBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (messageInput) messageInput.disabled = false;

  if (recordingTimer) recordingTimer.textContent = "00:00";
  if (recordingVisualizer) recordingVisualizer.innerHTML = "";

  finalVoiceBlob = null;
  liveWaveformBars = [];
}

function formatRecordingTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatVoiceSeconds(seconds) {
  const totalSeconds = Math.floor(seconds || 0);
  const minutes = String(Math.floor(totalSeconds / 60));
  const sec = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${sec}`;
}

function startRecordingTimer() {
  recordingStartTime = Date.now();

  if (recordingTimer) recordingTimer.textContent = "00:00";

  clearInterval(recordingTimerInterval);

  recordingTimerInterval = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;
    if (recordingTimer) recordingTimer.textContent = formatRecordingTime(elapsed);
  }, 200);
}

function stopRecordingTimer() {
  clearInterval(recordingTimerInterval);
  recordingTimerInterval = null;
}

function renderLiveWaveform(values) {
  if (!recordingVisualizer) return;

  recordingVisualizer.innerHTML = "";

  const bars = values.length ? values : [8, 10, 12, 9, 11, 7, 13, 10];

  bars.forEach((value) => {
    const bar = document.createElement("div");
    bar.className = "recording-bar";
    bar.style.height = `${Math.max(6, Math.min(36, value))}px`;
    recordingVisualizer.appendChild(bar);
  });
}

function startRealtimeVisualizer() {
  if (!analyserNode) return;

  analyserDataArray = new Uint8Array(analyserNode.fftSize);

  function draw() {
    if (!analyserNode || !analyserDataArray) return;

    analyserNode.getByteTimeDomainData(analyserDataArray);

    let sum = 0;

    for (let i = 0; i < analyserDataArray.length; i++) {
      sum += Math.abs(analyserDataArray[i] - 128);
    }

    const average = sum / analyserDataArray.length;
    const barHeight = Math.max(6, Math.min(36, Math.round(average * 1.2)));

    liveWaveformBars.push(barHeight);

    if (liveWaveformBars.length > 80) {
      liveWaveformBars.shift();
    }

    renderLiveWaveform(liveWaveformBars);

    visualizerAnimationFrame = requestAnimationFrame(draw);
  }

  draw();
}

function stopRealtimeVisualizer() {
  if (visualizerAnimationFrame) {
    cancelAnimationFrame(visualizerAnimationFrame);
    visualizerAnimationFrame = null;
  }
}

async function finishVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  isRecording = false;

  stopRecordingTimer();
  stopRealtimeVisualizer();

  if (voiceBtn) {
    voiceBtn.classList.remove("recording");
    voiceBtn.textContent = "🎙";
    voiceBtn.disabled = false;
  }

  mediaRecorder.stop();

  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }

  if (audioContext) {
    try {
      await audioContext.close();
    } catch {}
    audioContext = null;
  }
}

function cancelVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }

  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }

  stopRecordingTimer();
  stopRealtimeVisualizer();

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  recordedChunks = [];
  finalVoiceBlob = null;
  liveWaveformBars = [];
  isRecording = false;

  if (voiceBtn) {
    voiceBtn.classList.remove("recording");
    voiceBtn.textContent = "🎙";
    voiceBtn.disabled = false;
  }

  closeRecordingPanel();
}

function normalizeWaveformBars(bars, targetCount = 96) {
  if (!Array.isArray(bars) || !bars.length) {
    return Array.from({ length: targetCount }, () => 10);
  }

  const result = [];

  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor((i / targetCount) * bars.length);
    const end = Math.floor(((i + 1) / targetCount) * bars.length);
    const slice = bars.slice(start, Math.max(start + 1, end));
    const avg = slice.reduce((sum, value) => sum + value, 0) / slice.length;

    result.push(Math.max(6, Math.min(32, Math.round(avg))));
  }

  return result;
}

async function sendRecordedVoice() {
  if (!finalVoiceBlob) return;

  if (finalVoiceBlob.size > MAX_FILE_SIZE) {
    alert("Голосовое слишком большое. Максимум 8 МБ.");
    return;
  }

  try {
    const url = await blobToDataUrl(finalVoiceBlob);
    const elapsed = Math.max(1000, Date.now() - recordingStartTime);

    sendMediaMessage({
      type: "audio",
      url,
      name: finalVoiceBlob.type.includes("ogg") ? "voice.ogg" : "voice.webm",
      isVoice: true,
      durationMs: elapsed,
      waveform: normalizeWaveformBars(liveWaveformBars, 96),
      mimeType: finalVoiceBlob.type || "audio/webm",
      quality: "high"
    });

    closeRecordingPanel();
  } catch {
    alert("Не удалось отправить голосовое");
  }
}

function emitTypingStart() {
  if (!currentUser || !selectedChatType || isTypingNow || editingMessage) return;

  isTypingNow = true;

  if (selectedChatType === "direct" && selectedUser) {
    socket.emit("typing_start", {
      from: currentUser.username,
      to: selectedUser.username,
      chatType: "direct"
    });
  }

  if (selectedChatType === "group" && selectedGroup) {
    socket.emit("typing_start", {
      from: currentUser.username,
      groupId: selectedGroup.id,
      chatType: "group"
    });
  }
}

function stopTyping() {
  if (!currentUser || !selectedChatType || !isTypingNow) return;

  isTypingNow = false;

  if (selectedChatType === "direct" && selectedUser) {
    socket.emit("typing_stop", {
      from: currentUser.username,
      to: selectedUser.username,
      chatType: "direct"
    });
  }

  if (selectedChatType === "group" && selectedGroup) {
    socket.emit("typing_stop", {
      from: currentUser.username,
      groupId: selectedGroup.id,
      chatType: "group"
    });
  }
}

function handleTypingInput() {
  if (!canSendNow()) return;

  const text = messageInput ? messageInput.value.trim() : "";

  if (!text) {
    stopTyping();
    return;
  }

  emitTypingStart();

  clearTimeout(typingTimer);

  typingTimer = setTimeout(stopTyping, 1600);
}

function clearTypingState() {
  typingUsers = {};
  updateChatStatusText();
}

function updateChatStatusText() {
  if (!chatStatus) return;

  if (selectedChatType === "direct" && selectedUser) {
    const username = selectedUser.username;

    if (typingUsers[username]) {
      chatStatus.textContent = "печатает...";
      return;
    }

    chatStatus.textContent = onlineUsers[username] ? "онлайн" : "офлайн";
    return;
  }

  if (selectedChatType === "group" && selectedGroup) {
    const typingList = Object.keys(typingUsers).filter((username) => typingUsers[username]);

    if (typingList.length === 1) {
      chatStatus.textContent = `@${typingList[0]} печатает...`;
      return;
    }

    if (typingList.length > 1) {
      chatStatus.textContent = "несколько участников печатают...";
      return;
    }

    chatStatus.textContent = `${selectedGroup.members.length} участн. · создатель @${selectedGroup.owner}`;
  }
}

function buildReplyPayload() {
  if (!replyToMessage) return null;

  return {
    id: String(replyToMessage.id || ""),
    text: String(replyToMessage.text || "").slice(0, 500),
    username: normalizeUsername(replyToMessage.username || ""),
    displayName: String(replyToMessage.displayName || "").trim()
  };
}

function sendMessage() {
  if (!currentUser) return;

  const text = messageInput ? messageInput.value.trim() : "";

  if (!text) return;

  stopTyping();

  if (editingMessage) {
    socket.emit("edit_message", {
      messageId: editingMessage.id,
      me: currentUser.username,
      username: currentUser.username,
      text
    });

    if (messageInput) {
      messageInput.value = "";
      messageInput.focus();
    }

    cancelEdit();
    return;
  }

  const replyTo = buildReplyPayload();

  if (selectedChatType === "direct" && selectedUser) {
    socket.emit("send_message", {
      from: currentUser.username,
      to: selectedUser.username,
      text,
      replyTo
    });
  }

  if (selectedChatType === "group" && selectedGroup) {
    socket.emit("send_group_message", {
      from: currentUser.username,
      groupId: selectedGroup.id,
      text,
      replyTo
    });
  }

  if (messageInput) {
    messageInput.value = "";
    messageInput.focus();
  }

  cancelReply();
}

function sendMediaMessage(media) {
  stopTyping();

  if (!canSendNow()) return;

  const replyTo = buildReplyPayload();

  if (selectedChatType === "direct" && selectedUser) {
    socket.emit("send_message", {
      from: currentUser.username,
      to: selectedUser.username,
      text: "",
      media,
      replyTo
    });
  }

  if (selectedChatType === "group" && selectedGroup) {
    socket.emit("send_group_message", {
      from: currentUser.username,
      groupId: selectedGroup.id,
      text: "",
      media,
      replyTo
    });
  }

  cancelReply();
}

function deleteMessage(messageId) {
  if (!currentUser || !messageId) return;

  const ok = confirm("Удалить сообщение у всех?");

  if (!ok) return;

  destroyVoicePlayer(messageId);

  socket.emit("delete_message", {
    messageId,
    me: currentUser.username,
    username: currentUser.username
  });
}

async function startApp() {
  if (!currentUser) return;

  injectStyles();
  loadSettings();
  loadArchiveState();

  setupProfileUI();
  setupGroupUI();
  setupGroupActionsUI();
  setupMessageTools();
  setupContextMenu();
  setupSettingsModal();
  setupNotifications();

  if (auth) auth.classList.add("hidden");
  if (app) app.classList.remove("hidden");

  if (meName) meName.textContent = currentUser.displayName || currentUser.username;
  if (meLogin) meLogin.textContent = "@" + currentUser.username;

  renderMyAvatar();

  if (searchInput) {
    searchInput.value = "";
    searchInput.placeholder = "Поиск по @id, например @username";
  }

  socket.emit("user_online", {
    username: currentUser.username
  });

  await loadRecentChats();
  await loadGroups();

  renderSearchHint();
  renderEmptyChat();
}

async function loadRecentChats() {
  if (!currentUser) return;

  try {
    const data = await request(`/api/chats?me=${encodeURIComponent(currentUser.username)}`);

    recentChatsCache = data.chats || [];

    recentChatsCache.forEach((chat) => {
      onlineUsers[chat.username] = Boolean(chat.online);
    });

    function renderRecentChats() {
  if (!recentChatsBox) return;

  recentChatsBox.innerHTML = "";

  const visibleChats = recentChatsCache.filter((user) => {
    const archived = isDirectArchived(user.username);
    return archiveMode ? archived : !archived;
  });

  if (!visibleChats.length) {
    recentChatsBox.innerHTML = `
      <div class="empty small-empty">
        ${
          archiveMode
            ? "В архиве личных чатов пока нет"
            : "Личных чатов пока нет"
        }
      </div>
    `;
    return;
  }

  visibleChats.forEach((user) => {
    const item = document.createElement("button");
    item.className = "user recent-chat-item";

    if (
      selectedChatType === "direct" &&
      selectedUser &&
      selectedUser.username === user.username
    ) {
      item.classList.add("active");
    }

    const count = unreadDirect[user.username] || 0;
    const preview = getChatPreview(user);

    item.innerHTML = `
      ${renderAvatar(user)}
      <div class="user-info">
        <b>${onlineDot(user.username)}${escapeHtml(user.displayName || user.username)}</b>
        <span>${escapeHtml(preview)}</span>
      </div>
      ${unreadBadge(count)}
    `;

    item.addEventListener("click", () => {
      openChat(user);
    });

    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();

      openArchiveContextMenu(event, {
        type: "direct",
        id: user.username
      });
    });

    recentChatsBox.appendChild(item);
  });
}

async function loadGroups() {
  if (!currentUser) return;

  try {
    const data = await request(`/api/groups?me=${encodeURIComponent(currentUser.username)}`);

    groupsCache = data.groups || [];
    function renderGroups() {
  if (!groupsBox) return;

  groupsBox.innerHTML = "";

  const visibleGroups = groupsCache.filter((group) => {
    const archived = isGroupArchived(group.id);
    return archiveMode ? archived : !archived;
  });

  if (!visibleGroups.length) {
    groupsBox.innerHTML = `
      <div class="empty small-empty">
        ${
          archiveMode
            ? "В архиве групп пока нет"
            : "Групп пока нет"
        }
      </div>
    `;
    return;
  }

  visibleGroups.forEach((group) => {
    const item = document.createElement("button");
    item.className = "user group-item";

    if (
      selectedChatType === "group" &&
      selectedGroup &&
      selectedGroup.id === group.id
    ) {
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

    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();

      openArchiveContextMenu(event, {
        type: "group",
        id: group.id
      });
    });

    groupsBox.appendChild(item);
  });
}

function renderRecentChats() {
  if (!recentChatsBox) return;

  recentChatsBox.innerHTML = "";

  if (!recentChatsCache.length) {
    recentChatsBox.innerHTML = `<div class="empty small-empty">Личных чатов пока нет</div>`;
    return;
  }

  recentChatsCache.forEach((user) => {
    const item = document.createElement("button");
    item.className = "user recent-chat-item";

    if (selectedChatType === "direct" && selectedUser && selectedUser.username === user.username) {
      item.classList.add("active");
    }

    const count = unreadDirect[user.username] || 0;
    const preview = getChatPreview(user);

    item.innerHTML = `
      ${renderAvatar(user)}
      <div class="user-info">
        <b>${onlineDot(user.username)}${escapeHtml(user.displayName || user.username)}</b>
        <span>${escapeHtml(preview)}</span>
      </div>
      ${unreadBadge(count)}
    `;

    item.addEventListener("click", () => openChat(user));

    recentChatsBox.appendChild(item);
  });
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

    item.addEventListener("click", () => openGroup(group));

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

    usersCache.forEach((user) => {
      onlineUsers[user.username] = Boolean(user.online);
    });

    renderUsers(cleanQuery);
  } catch {
    if (usersBox) usersBox.innerHTML = `<div class="empty">Ошибка поиска</div>`;
  }
}

function renderSearchHint() {
  if (!usersBox) return;

  usersBox.innerHTML = `
    <div class="empty">
      Введите @id пользователя, чтобы найти новый чат.<br>
      Например: <b>@username</b>
    </div>
  `;
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

    if (selectedChatType === "direct" && selectedUser && selectedUser.username === user.username) {
      item.classList.add("active");
    }

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
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();
  cancelReply();
  cancelEdit();
  hideContextMenu();

  selectedUser = null;
  selectedGroup = null;
  selectedChatType = null;
  messagesCache = [];

  clearTypingState();
  hideGroupActions();

  if (chatAvatar) {
    chatAvatar.textContent = "?";
    chatAvatar.innerHTML = "?";
  }

  if (chatName) chatName.textContent = "Выберите чат";
  if (chatStatus) chatStatus.textContent = "Выберите личный чат, группу или найдите пользователя";

  if (messagesBox) {
    messagesBox.innerHTML = `
      <div class="empty">
        Выберите чат слева или найдите пользователя через поиск.
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

  renderRecentChats();
  renderGroups();
  renderSearchHint();
}

async function openChat(user) {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();
  cancelReply();
  cancelEdit();
  hideContextMenu();

  selectedUser = user;
  selectedGroup = null;
  selectedChatType = "direct";
  messagesCache = [];

  clearTypingState();
  hideGroupActions();

  unreadDirect[user.username] = 0;
  updateUnreadTitle();

  upsertRecentChat(user, null);

  socket.emit("check_user_status", {
    username: user.username
  });

  if (chatAvatar) {
    if (user.avatar) {
      chatAvatar.innerHTML = `<img src="${user.avatar}" alt="avatar">`;
    } else {
      chatAvatar.textContent = (user.displayName || user.username)[0] || "?";
    }
  }

  if (chatName) chatName.textContent = user.displayName || user.username;
  updateChatStatusText();

  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;
  if (voiceBtn) voiceBtn.disabled = false;

  if (messagesBox) messagesBox.innerHTML = `<div class="empty">Загрузка...</div>`;

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
    markCurrentDirectMessagesAsRead();
    renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
    renderRecentChats();
    renderGroups();
  } catch (error) {
    console.error("Open chat messages error:", error);

    if (messagesBox) {
      messagesBox.innerHTML = `<div class="empty">Ошибка загрузки сообщений</div>`;
    }
  }
}

async function openGroup(group) {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();
  cancelReply();
  cancelEdit();
  hideContextMenu();

  selectedGroup = group;
  selectedUser = null;
  selectedChatType = "group";
  messagesCache = [];

  clearTypingState();

  unreadGroups[group.id] = 0;
  updateUnreadTitle();

  if (chatAvatar) {
    chatAvatar.textContent = "#";
    chatAvatar.innerHTML = "#";
  }

  if (chatName) chatName.textContent = group.name;
  updateChatStatusText();

  showGroupActions(group);

  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;
  if (voiceBtn) voiceBtn.disabled = false;

  if (messagesBox) messagesBox.innerHTML = `<div class="empty">Загрузка...</div>`;

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
    renderRecentChats();
    renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
  } catch {
    if (messagesBox) messagesBox.innerHTML = `<div class="empty">Ошибка загрузки группы</div>`;
  }
}

function isMessageRead(message) {
  return Boolean(message && (message.isRead === true || message.is_read === true));
}

function renderMessageStatus(message, mine, compact = false) {
  if (!mine || !message) return "";

  const isDirectMessage =
    String(message.type || "") === "direct" ||
    Boolean(message.to);

  if (!isDirectMessage) return "";

  const read = isMessageRead(message);

  return `
    <span class="message-status ${read ? "read" : "unread"} ${compact ? "compact" : ""}" title="${read ? "Прочитано" : "Не прочитано"}">
      <span class="message-status__check first">✓</span>
      <span class="message-status__check second">✓</span>
    </span>
  `;
}

function markCurrentDirectMessagesAsRead() {
  if (!currentUser) return;
  if (selectedChatType !== "direct") return;
  if (!selectedUser) return;

  socket.emit("mark_messages_read", {
    me: currentUser.username,
    with: selectedUser.username
  });
}

function getReply(message) {
  return message.replyTo || message.reply_to || null;
}

function renderReplyPreview(message) {
  const reply = getReply(message);

  if (!reply) return "";

  const author = reply.displayName || reply.display_name || reply.username || "Сообщение";
  const text = reply.text || reply.message || "Медиа";

  return `
    <div class="message-reply-preview">
      <div class="message-reply-author">${escapeHtml(author)}</div>
      <div class="message-reply-text">${escapeHtml(text)}</div>
    </div>
  `;
}

function getMessageActionText(message) {
  if (!message) return "";

  const text = message.text || message.message || "";

  if (text) return String(text);

  if (message.media) {
    if (message.media.type === "image") return "Фото";
    if (message.media.type === "video") return "Видео";
    if (message.media.type === "audio") return "Голосовое сообщение";
  }

  return "Сообщение";
}

function renderMessages() {
  if (!messagesBox) return;

  setupContextMenu();
  destroyAllVoicePlayers();

  messagesBox.innerHTML = "";

  if (!messagesCache.length) {
    messagesBox.innerHTML = `<div class="empty">Сообщений пока нет. Напиши первым.</div>`;
    return;
  }

  messagesCache.forEach((message) => {
    const mine = message.from === currentUser.username || message.username === currentUser.username;
    const isAudio = message.media && message.media.type === "audio";

    const bubble = document.createElement("div");
    bubble.className = mine ? "message mine" : "message";

    const text = message.text || message.message || "";
    const mediaHtml = renderMedia(message.media, message, mine);
    const replyHtml = renderReplyPreview(message);
    const statusHtml = renderMessageStatus(message, mine);

    bubble.innerHTML = `
      <div class="message-name">${escapeHtml(message.displayName || message.username || "")}</div>
      ${replyHtml}
      ${mediaHtml}
      ${text ? `<div class="message-text">${escapeHtml(text)}</div>` : ""}
      ${
        !isAudio
          ? `
            <div class="message-meta">
              <span class="message-time">${formatTime(message.created_at)}</span>
              ${message.edited ? `<span class="message-edited">изменено</span>` : ""}
              ${statusHtml}
            </div>
          `
          : ""
      }
    `;

    bubble.addEventListener("contextmenu", (event) => {
      event.preventDefault();

      openContextMenu(event, {
        id: String(message.id || ""),
        text: getMessageActionText(message),
        username: message.username || message.from || "",
        displayName: message.displayName || message.username || "",
        mine,
        message
      });
    });

    messagesBox.appendChild(bubble);

    if (isAudio) initVoicePlayer(message);
  });

  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function renderMedia(media, message, mine) {
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
        ${renderVoiceCard(media, message, mine)}
      </div>
    `;
  }

  return "";
}

function createFallbackWaveformHtml(waveform) {
  const bars = Array.isArray(waveform) && waveform.length
    ? waveform
    : Array.from({ length: 60 }, (_, index) => 8 + ((index * 7) % 20));

  return bars
    .map((value) => {
      const height = Math.max(5, Math.min(26, Number(value) || 8));
      return `<span class="voice-wave-bar" style="height:${height}px"></span>`;
    })
    .join("");
}

function renderVoiceCard(media, message, mine) {
  const id = String(message.id);
  const audioUrl = media.url || "";
  const durationText = media.durationMs ? formatRecordingTime(media.durationMs) : "00:00";
  const clockText = formatTime(message.created_at);
  const fallbackWave = createFallbackWaveformHtml(media.waveform);
  const statusHtml = renderMessageStatus(message, mine, true);

  return `
    <div class="voice-card" data-voice-id="${escapeHtml(id)}" data-audio-url="${escapeHtml(audioUrl)}">
      <div class="voice-card__main">
        <button class="voice-card__play" type="button" data-voice-play="${escapeHtml(id)}">▶</button>

        <div class="voice-card__body">
          <div class="voice-card__top">
            <span class="voice-card__time">
              <span id="voice-current-${escapeHtml(id)}">0:00</span>
              <span class="voice-card__slash">/</span>
              <span id="voice-duration-${escapeHtml(id)}">${escapeHtml(durationText)}</span>
            </span>

            <span class="voice-card__hint">тяни волну</span>
          </div>

          <div class="voice-card__wave" id="voice-wave-${escapeHtml(id)}">
            <div class="voice-card__fallback-wave">
              ${fallbackWave}
            </div>
          </div>
        </div>
      </div>

      <div class="voice-card__footer">
        <div class="voice-card__footer-left"></div>

        <div class="voice-card__footer-right">
          <span class="voice-card__clock">
            ${escapeHtml(clockText)}
            ${message.edited ? `<span class="message-edited">изменено</span>` : ""}
          </span>
          ${statusHtml}
        </div>
      </div>
    </div>
  `;
}

function initVoicePlayer(message) {
  if (!message || !message.id || !message.media || message.media.type !== "audio") return;

  const id = String(message.id);
  const media = message.media;
  const audioUrl = media.url || "";

  if (!audioUrl) return;
  if (voicePlayers.has(id)) return;

  const waveEl = document.getElementById(`voice-wave-${id}`);
  const playBtn = document.querySelector(`[data-voice-play="${CSS.escape(id)}"]`);
  const currentEl = document.getElementById(`voice-current-${id}`);
  const durationEl = document.getElementById(`voice-duration-${id}`);

  if (!waveEl || !playBtn || !currentEl || !durationEl) return;

  if (typeof WaveSurfer === "undefined") {
    console.warn("WaveSurfer не подключён");
    return;
  }

  waveEl.innerHTML = "";

  const player = WaveSurfer.create({
    container: waveEl,
    height: 38,
    waveColor: "rgba(255,255,255,0.34)",
    progressColor: "#ffffff",
    cursorColor: "#7fe3ff",
    cursorWidth: 2,
    barWidth: 3,
    barGap: 2,
    barRadius: 4,
    normalize: true,
    interact: true,
    dragToSeek: true,
    hideScrollbar: true,
    backend: "MediaElement"
  });

  voicePlayers.set(id, player);
  player.load(audioUrl);

  player.on("ready", () => {
    const duration = player.getDuration();

    if (duration && Number.isFinite(duration)) {
      durationEl.textContent = formatVoiceSeconds(duration);
    } else if (media.durationMs) {
      durationEl.textContent = formatRecordingTime(media.durationMs);
    }

    try {
      player.setVolume(Number(appSettings.voicePlaybackVolume || 1));
    } catch {}
  });

  player.on("play", () => {
    stopOtherVoicePlayers(id);
    playBtn.textContent = "❚❚";
  });

  player.on("pause", () => {
    playBtn.textContent = "▶";
  });

  player.on("finish", () => {
    playBtn.textContent = "▶";
    currentEl.textContent = "0:00";

    try {
      player.seekTo(0);
    } catch {}
  });

  player.on("audioprocess", () => {
    currentEl.textContent = formatVoiceSeconds(player.getCurrentTime());
  });

  player.on("interaction", () => {
    currentEl.textContent = formatVoiceSeconds(player.getCurrentTime());
  });

  playBtn.addEventListener("click", () => {
    if (player.isPlaying()) {
      player.pause();
    } else {
      stopOtherVoicePlayers(id);
      player.play();
    }
  });
}

function destroyVoicePlayer(messageId) {
  const id = String(messageId);
  const player = voicePlayers.get(id);

  if (player) {
    try {
      player.destroy();
    } catch {}

    voicePlayers.delete(id);
  }
}

function destroyAllVoicePlayers() {
  for (const [id, player] of voicePlayers.entries()) {
    try {
      player.destroy();
    } catch {}

    voicePlayers.delete(id);
  }
}

function stopOtherVoicePlayers(exceptId) {
  for (const [id, player] of voicePlayers.entries()) {
    if (id !== String(exceptId) && player && player.isPlaying && player.isPlaying()) {
      player.pause();
    }
  }
}

function setupNotifications() {
  if (notificationPermissionRequested) return;

  notificationPermissionRequested = true;

  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function playNotificationSound() {
  if (!appSettings.notificationSoundsEnabled) return;
  if (notificationSoundCooldown) return;

  notificationSoundCooldown = true;

  setTimeout(() => {
    notificationSoundCooldown = false;
  }, 650);

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const volume = Math.max(0, Math.min(1, Number(appSettings.notificationVolume || 0.8)));

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.14 * volume, ctx.currentTime + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    master.connect(ctx.destination);

    function chirp(start, from, to, duration, gainValue) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(from, start);
      osc.frequency.exponentialRampToValueAtTime(to, start + duration);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue * volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(master);

      osc.start(start);
      osc.stop(start + duration + 0.03);
    }

    const now = ctx.currentTime;

    chirp(now + 0.01, 1800, 2600, 0.1, 0.15);
    chirp(now + 0.12, 2300, 3400, 0.09, 0.11);
    chirp(now + 0.24, 1750, 2850, 0.13, 0.09);

    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {}
}

function showWindowsNotification(title, body, avatar) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const notification = new Notification(title, {
      body,
      icon: avatar || undefined,
      silent: true
    });

    playNotificationSound();

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 7000);
  } catch {}
}

function makeNotificationText(message) {
  if (!message) return "Новое сообщение";

  if (message.text || message.message) return String(message.text || message.message);

  if (message.media) {
    if (message.media.type === "image") return "Фото";
    if (message.media.type === "video") return "Видео";
    if (message.media.type === "audio") return "Голосовое сообщение";
  }

  return "Новое сообщение";
}

function shouldNotifyDirect(message) {
  if (!currentUser) return false;

  const from = normalizeUsername(message.from || message.username);

  if (!from || from === currentUser.username) return false;

  if (selectedChatType === "direct" && selectedUser && selectedUser.username === from) {
    return document.hidden;
  }

  return true;
}

function shouldNotifyGroup(message) {
  if (!currentUser) return false;

  const from = normalizeUsername(message.from || message.username);
  const groupId = String(message.groupId || "");

  if (!groupId || from === currentUser.username) return false;

  if (selectedChatType === "group" && selectedGroup && selectedGroup.id === groupId) {
    return document.hidden;
  }

  return true;
}

function notifyDirectMessage(message) {
  if (!shouldNotifyDirect(message)) return;

  const from = normalizeUsername(message.from || message.username);
  const title = message.displayName || from || "Новое сообщение";
  const body = makeNotificationText(message);

  showWindowsNotification(title, body, message.avatar || "");
}

function notifyGroupMessage(message) {
  if (!shouldNotifyGroup(message)) return;

  const group = groupsCache.find((item) => item.id === String(message.groupId));
  const groupName = group ? group.name : "Группа";
  const sender = message.displayName || message.username || "Участник";
  const body = `${sender}: ${makeNotificationText(message)}`;

  showWindowsNotification(groupName, body, message.avatar || "");
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

  return String(message.groupId) === String(selectedGroup.id);
}

function handleMessageDeleted(data) {
  if (!data) return;

  const id = String(data.id || data.messageId || "");

  if (!id) return;

  destroyVoicePlayer(id);

  messagesCache = messagesCache.filter((message) => String(message.id) !== id);

  if (replyToMessage && String(replyToMessage.id) === id) cancelReply();
  if (editingMessage && String(editingMessage.id) === id) cancelEdit();

  renderMessages();
  loadRecentChats();
}

function handleMessageEdited(data) {
  if (!data) return;

  const id = String(data.id || data.messageId || "");

  if (!id) return;

  messagesCache = messagesCache.map((message) => {
    if (String(message.id) !== id) return message;

    return {
      ...message,
      text: data.text || data.message || message.text || "",
      message: data.text || data.message || message.message || "",
      edited: true,
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  });

  renderMessages();
  loadRecentChats();
}

socket.on("load_messages", (messages) => {
  messagesCache = Array.isArray(messages) ? messages : [];
  renderMessages();

  if (selectedChatType === "direct" && selectedUser) {
    markCurrentDirectMessagesAsRead();
  }
});

socket.on("messages_read", (data) => {
  if (!data || !data.chatId || !currentUser) return;

  const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
  let changed = false;

  messagesCache = messagesCache.map((message) => {
    const sameChat = String(message.chatId || "") === String(data.chatId);
    const messageId = String(message.id || "");
    const mine = normalizeUsername(message.from || message.username) === currentUser.username;

    if (!sameChat || !mine) return message;

    if (ids.length && !ids.includes(messageId)) return message;

    changed = true;

    return {
      ...message,
      isRead: true,
      readAt: data.readAt || message.readAt || new Date().toISOString()
    };
  });

  if (changed) renderMessages();
});

socket.on("message_deleted", handleMessageDeleted);
socket.on("message-deleted", handleMessageDeleted);
socket.on("group_message_deleted", handleMessageDeleted);

socket.on("message_edited", handleMessageEdited);
socket.on("message-edited", handleMessageEdited);
socket.on("group_message_edited", handleMessageEdited);

socket.on("message_error", (data) => {
  if (!data) return;
  alert(data.error || "Ошибка сообщения");
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

    socket.emit("user_online", {
      username: currentUser.username
    });
  }

  recentChatsCache = recentChatsCache.map((chat) => {
    if (chat.username === oldUsername || chat.username === user.username) {
      return {
        ...chat,
        id: user.id,
        displayName: user.displayName,
        username: user.username,
        avatar: user.avatar
      };
    }

    return chat;
  });

  usersCache = usersCache.map((item) => {
    if (item.username === oldUsername || item.username === user.username) {
      return {
        ...item,
        id: user.id,
        displayName: user.displayName,
        username: user.username,
        avatar: user.avatar
      };
    }

    return item;
  });

  if (selectedUser && (selectedUser.username === oldUsername || selectedUser.username === user.username)) {
    selectedUser = {
      ...selectedUser,
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      avatar: user.avatar
    };

    if (chatName) chatName.textContent = selectedUser.displayName || selectedUser.username;

    if (chatAvatar) {
      if (selectedUser.avatar) {
        chatAvatar.innerHTML = `<img src="${selectedUser.avatar}" alt="avatar">`;
      } else {
        chatAvatar.textContent = (selectedUser.displayName || selectedUser.username)[0] || "?";
      }
    }
  }

  renderRecentChats();
  renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
});

socket.on("user_status", (data) => {
  if (!data || !data.username) return;

  const username = normalizeUsername(data.username);

  onlineUsers[username] = Boolean(data.online);

  recentChatsCache = recentChatsCache.map((chat) => {
    if (chat.username === username) {
      return {
        ...chat,
        online: Boolean(data.online)
      };
    }

    return chat;
  });

  usersCache = usersCache.map((user) => {
    if (user.username === username) {
      return {
        ...user,
        online: Boolean(data.online)
      };
    }

    return user;
  });

  renderRecentChats();
  renderUsers(searchInput ? searchInput.value.replace(/^@/, "") : "");
  updateChatStatusText();
});

socket.on("typing_start", (data) => {
  if (!currentUser || !data) return;

  const from = normalizeUsername(data.from);

  if (!from || from === currentUser.username) return;

  if (data.chatType === "direct") {
    if (selectedChatType === "direct" && selectedUser && selectedUser.username === from) {
      typingUsers[from] = true;
      updateChatStatusText();
    }

    if (recentChatsCache.some((chat) => chat.username === from)) {
      typingUsers[from] = true;
      renderRecentChats();
    }
  }

  if (data.chatType === "group") {
    const groupId = String(data.groupId || "");

    if (selectedChatType === "group" && selectedGroup && selectedGroup.id === groupId) {
      typingUsers[from] = true;
      updateChatStatusText();
    }
  }
});

socket.on("typing_stop", (data) => {
  if (!data) return;

  const from = normalizeUsername(data.from);

  if (!from) return;

  delete typingUsers[from];

  updateChatStatusText();
  renderRecentChats();
});

socket.on("new_message", (message) => {
  if (!currentUser) return;

  const from = normalizeUsername(message.from || message.username);
  const to = normalizeUsername(message.to);
  const otherUsername = from === currentUser.username ? to : from;

  delete typingUsers[otherUsername];
  delete typingUsers[from];

  const userForRecent = {
    id: otherUsername,
    username: otherUsername,
    displayName:
      from === currentUser.username && selectedUser
        ? selectedUser.displayName
        : message.displayName || otherUsername,
    avatar:
      from === currentUser.username && selectedUser
        ? selectedUser.avatar
        : message.avatar || ""
  };

  upsertRecentChat(userForRecent, message);

  if (from !== currentUser.username) {
    notifyDirectMessage(message);
  }

  if (from === currentUser.username) {
    if (shouldShowIncomingDirect(message)) {
      const exists = messagesCache.some((m) => String(m.id) === String(message.id));

      if (!exists) {
        messagesCache.push(message);
        renderMessages();
      }
    }

    renderRecentChats();
    updateChatStatusText();
    return;
  }

  if (shouldShowIncomingDirect(message)) {
    const exists = messagesCache.some((m) => String(m.id) === String(message.id));

    if (!exists) {
      messagesCache.push(message);
      renderMessages();
    }

    unreadDirect[from] = 0;
    markCurrentDirectMessagesAsRead();
  } else {
    unreadDirect[from] = (unreadDirect[from] || 0) + 1;
  }

  updateUnreadTitle();
  renderRecentChats();
  updateChatStatusText();
});

socket.on("new_group_message", (message) => {
  loadGroups();

  if (!currentUser) return;

  const groupId = String(message.groupId || "");
  const from = normalizeUsername(message.from || message.username);

  delete typingUsers[from];

  if (!groupId) return;

  if (from !== currentUser.username) {
    notifyGroupMessage(message);
  }

  if (shouldShowIncomingGroup(message)) {
    const exists = messagesCache.some((m) => String(m.id) === String(message.id));

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
  updateChatStatusText();
});

socket.on("group_updated", (group) => {
  if (!group || !group.id) return;

  groupsCache = groupsCache.map((item) => {
    return item.id === group.id ? group : item;
  });

  if (selectedGroup && selectedGroup.id === group.id) {
    selectedGroup = group;
    updateChatStatusText();
    showGroupActions(group);
  }

  renderGroups();
});

socket.on("group_left", (data) => {
  if (!data || !data.groupId) return;

  groupsCache = groupsCache.filter((group) => group.id !== data.groupId);
  delete unreadGroups[data.groupId];

  if (selectedGroup && selectedGroup.id === data.groupId) {
    renderEmptyChat();
  }

  renderGroups();
  updateUnreadTitle();
});

socket.on("group_deleted", (data) => {
  if (!data || !data.groupId) return;

  groupsCache = groupsCache.filter((group) => group.id !== data.groupId);
  delete unreadGroups[data.groupId];

  if (selectedGroup && selectedGroup.id === data.groupId) {
    renderEmptyChat();
    alert("Группа была удалена");
  }

  renderGroups();
  updateUnreadTitle();
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

if (searchInput) {
  searchInput.addEventListener("input", () => {
    loadUsers(searchInput.value);
  });
}

if (sendBtn) sendBtn.addEventListener("click", sendMessage);

if (messageInput) {
  messageInput.addEventListener("input", handleTypingInput);

  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }

    if (event.key === "Escape") {
      cancelReply();
      cancelEdit();
      hideContextMenu();

      if (messageInput) messageInput.value = "";
    }
  });

  messageInput.addEventListener("blur", () => {
    setTimeout(stopTyping, 500);
  });
}

window.addEventListener("beforeunload", () => {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();
});

injectStyles();
setupContextMenu();

const savedUser = loadSavedUser();

if (savedUser) {
  currentUser = savedUser;
  startApp();
}