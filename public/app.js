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
let isRecording = false;

let recordingStream = null;
let recordingStartTime = 0;
let recordingTimerInterval = null;

let audioContext = null;
let analyserNode = null;
let analyserDataArray = null;
let visualizerAnimationFrame = null;

let liveWaveformBars = [];
let finalVoiceBlob = null;

let notificationPermissionRequested = false;
let typingTimer = null;
let isTypingNow = false;

let profileAvatarDraft = "";

let profileAvatarBtn = null;
let settingsBtn = null;
let groupActionsBox = null;

let recentChatsBox = null;
let groupsBox = null;
let createGroupBtn = null;
let groupModal = null;

let avatarInput = null;
let fileInput = null;
let attachBtn = null;
let voiceBtn = null;

let recordingPanel = null;
let recordingTimer = null;
let recordingVisualizer = null;
let recordingCancelBtn = null;
let recordingSendBtn = null;

let settingsModal = null;
let settingsActiveSection = "profile";
let profileModalAvatarInput = null;

let settingsMicTestStream = null;
let settingsMicTestContext = null;
let settingsMicTestAnalyser = null;
let settingsMicTestDataArray = null;
let settingsMicTestFrame = null;

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

function getDefaultSettings() {
  return {
    selectedMicId: "",
    notificationSoundsEnabled: true,
    notificationVolume: 0.8,
    voicePlaybackVolume: 1,
    favoritesText: "",
    loginDeviceInfo: null
  };
}

let appSettings = getDefaultSettings();

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
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

function getSettingsStorageKey() {
  if (!currentUser || !currentUser.username) return null;
  return `callibri_settings_${currentUser.username}`;
}

function loadAppSettings() {
  const defaults = getDefaultSettings();
  const key = getSettingsStorageKey();

  if (!key) {
    appSettings = defaults;
    return;
  }

  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    appSettings = {
      ...defaults,
      ...(parsed || {})
    };
  } catch {
    appSettings = defaults;
  }
}

function saveAppSettings(oldUsername = "") {
  const key = getSettingsStorageKey();
  if (!key) return;

  try {
    if (oldUsername && oldUsername !== currentUser.username) {
      localStorage.removeItem(`callibri_settings_${oldUsername}`);
    }

    localStorage.setItem(key, JSON.stringify(appSettings));
  } catch (error) {
    console.log("Save settings error:", error);
  }
}

function detectBrowserName() {
  const ua = navigator.userAgent || "";

  if (/Electron/i.test(ua)) return "Electron";
  if (/Edg/i.test(ua)) return "Microsoft Edge";
  if (/OPR|Opera/i.test(ua)) return "Opera";
  if (/Firefox/i.test(ua)) return "Mozilla Firefox";
  if (/Chrome/i.test(ua)) return "Google Chrome";
  if (/Safari/i.test(ua)) return "Safari";

  return "Неизвестный браузер";
}

function detectOSName() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "Windows";
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "Linux";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";

  return platform || "Неизвестная ОС";
}

function buildLoginDeviceInfo() {
  return {
    app: /Electron/i.test(navigator.userAgent || "") ? "Callibri Desktop" : "Callibri Web",
    browser: detectBrowserName(),
    os: detectOSName(),
    platform: navigator.platform || "Неизвестно",
    language: navigator.language || "Неизвестно",
    screen: `${window.screen.width} × ${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Неизвестно",
    savedAt: new Date().toISOString()
  };
}

function ensureLoginDeviceInfo() {
  if (!appSettings.loginDeviceInfo) {
    appSettings.loginDeviceInfo = buildLoginDeviceInfo();
    saveAppSettings();
  }
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function closeSettingsModal() {
  stopSettingsMicTest();

  if (settingsModal) {
    settingsModal.classList.add("hidden");
  }

  if (profileModalAvatarInput) {
    profileModalAvatarInput.value = "";
  }
}

function logout() {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();
  closeSettingsModal();

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

  appSettings = getDefaultSettings();

  updateUnreadTitle();

  if (rememberMeInput) rememberMeInput.checked = false;

  if (app) app.classList.add("hidden");
  if (auth) auth.classList.remove("hidden");

  if (messageInput) messageInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (attachBtn) attachBtn.disabled = true;
  if (voiceBtn) voiceBtn.disabled = true;

  hideGroupActions();
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
    loadAppSettings();
    appSettings.loginDeviceInfo = buildLoginDeviceInfo();
    saveAppSettings();
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
    loadAppSettings();
    appSettings.loginDeviceInfo = buildLoginDeviceInfo();
    saveAppSettings();
    startApp();
  } catch (error) {
    showError(error.message);
  }
}

function updateUnreadTitle() {
  const totalDirect = Object.values(unreadDirect).reduce((sum, value) => sum + value, 0);
  const totalGroups = Object.values(unreadGroups).reduce((sum, value) => sum + value, 0);
  const total = totalDirect + totalGroups;

  document.title = total > 0 ? `(${total}) Callibri` : "Callibri";
}

async function setupWindowsNotifications() {
  if (notificationPermissionRequested) return;

  notificationPermissionRequested = true;

  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (error) {
      console.log("Notification permission error:", error);
    }
  }
}

function playNotificationSound() {
  if (!appSettings.notificationSoundsEnabled) return;

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;

    gainNode.gain.value = Math.max(0, Math.min(1, Number(appSettings.notificationVolume || 0.8))) * 0.06;

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();

    setTimeout(() => {
      oscillator.stop();
      ctx.close().catch(() => {});
    }, 140);
  } catch (error) {
    console.log("Play notification sound error:", error);
  }
}

function makeNotificationText(message) {
  if (!message) return "Новое сообщение";

  if (message.text || message.message) {
    return String(message.text || message.message);
  }

  if (message.media) {
    if (message.media.type === "image") return "Фото";
    if (message.media.type === "video") return "Видео";
    if (message.media.type === "audio") return "Голосовое сообщение";
  }

  return "Новое сообщение";
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

    if (appSettings.notificationSoundsEnabled) {
      playNotificationSound();
    }

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => {
      notification.close();
    }, 7000);
  } catch (error) {
    console.log("Notification show error:", error);
  }
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

function onlineDot(username) {
  const online = onlineUsers[normalizeUsername(username)];

  return `
    <span style="
      width:9px;
      height:9px;
      border-radius:50%;
      background:${online ? "#22c55e" : "#64748b"};
      display:inline-block;
      margin-right:6px;
      box-shadow:${online ? "0 0 0 3px rgba(34,197,94,0.18)" : "none"};
    "></span>
  `;
}

function updateChatStatusText() {
  if (!chatStatus) return;

  if (selectedChatType === "direct" && selectedUser) {
    const username = selectedUser.username;
    const typing = typingUsers[username];

    if (typing) {
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

function emitTypingStart() {
  if (!currentUser || !selectedChatType) return;
  if (isTypingNow) return;

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

  typingTimer = setTimeout(() => {
    stopTyping();
  }, 1600);
}

function clearTypingState() {
  typingUsers = {};
  updateChatStatusText();
}

function injectEnhancedSettingsStyles() {
  if (document.getElementById("callibriSettingsStyles")) return;

  const style = document.createElement("style");
  style.id = "callibriSettingsStyles";
  style.textContent = `
    .callibri-settings-btn{
      width:44px;
      height:44px;
      border-radius:14px;
      margin-left:auto;
      display:flex;
      align-items:center;
      justify-content:center;
      background:linear-gradient(135deg, rgba(25,74,126,.92), rgba(16,184,166,.78));
      color:#ecfeff;
      font-size:20px;
      font-weight:900;
      box-shadow:0 12px 28px rgba(0,0,0,.20), inset 0 1px 0 rgba(255,255,255,.20);
      transition:transform .18s ease, box-shadow .18s ease, opacity .18s ease;
    }

    .callibri-settings-btn:hover{
      transform:translateY(-1px);
      box-shadow:0 14px 30px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.22);
    }

    .callibri-avatar-btn{
      width:54px;
      height:54px;
      border-radius:18px;
      overflow:hidden;
      display:flex;
      align-items:center;
      justify-content:center;
      background:linear-gradient(135deg,#0d4ed8,#14b8a6);
      color:#fff;
      font-size:24px;
      font-weight:900;
      box-shadow:0 10px 24px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.20);
      flex-shrink:0;
    }

    .callibri-avatar-btn img{
      width:100%;
      height:100%;
      object-fit:cover;
    }

    .settings-shell{
      width:min(96vw,980px);
      max-width:980px;
      min-height:620px;
      background:linear-gradient(180deg, rgba(7,37,67,.98), rgba(10,72,86,.98));
      border:1px solid rgba(255,255,255,.08);
      border-radius:26px;
      overflow:hidden;
      box-shadow:0 30px 80px rgba(0,0,0,.38);
      color:#e2e8f0;
    }

    .settings-head{
      padding:18px 22px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:14px;
      border-bottom:1px solid rgba(255,255,255,.08);
      background:linear-gradient(135deg, rgba(14,116,144,.28), rgba(16,185,129,.12));
    }

    .settings-head h2{
      margin:0;
      font-size:24px;
      font-weight:900;
      color:#f8fafc;
    }

    .settings-head p{
      margin:4px 0 0;
      color:#a5f3fc;
      font-size:13px;
    }

    .settings-close-btn{
      width:42px;
      height:42px;
      border-radius:14px;
      font-size:22px;
      color:#e2e8f0;
      background:rgba(255,255,255,.08);
    }

    .settings-layout{
      display:flex;
      min-height:560px;
    }

    .settings-sidebar{
      width:240px;
      flex-shrink:0;
      border-right:1px solid rgba(255,255,255,.08);
      padding:16px;
      background:rgba(2, 17, 34, .26);
    }

    .settings-nav{
      display:flex;
      flex-direction:column;
      gap:10px;
    }

    .settings-nav-btn{
      border-radius:16px;
      padding:12px 14px;
      text-align:left;
      background:rgba(255,255,255,.04);
      color:#cbd5e1;
      font-weight:800;
      font-size:14px;
      transition:all .18s ease;
      border:1px solid transparent;
    }

    .settings-nav-btn.active{
      background:linear-gradient(135deg, rgba(14,116,144,.62), rgba(16,185,129,.34));
      color:#fff;
      border-color:rgba(125,211,252,.24);
      box-shadow:0 10px 24px rgba(0,0,0,.18);
    }

    .settings-nav-btn small{
      display:block;
      font-weight:500;
      font-size:12px;
      margin-top:4px;
      opacity:.8;
    }

    .settings-content{
      flex:1;
      padding:22px;
      overflow:auto;
    }

    .settings-panel{
      display:none;
    }

    .settings-panel.active{
      display:block;
    }

    .settings-title{
      margin:0 0 8px;
      font-size:22px;
      color:#fff;
      font-weight:900;
    }

    .settings-subtitle{
      margin:0 0 18px;
      color:#9bd8e6;
      font-size:14px;
      line-height:1.5;
    }

    .settings-card{
      background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.07);
      border-radius:20px;
      padding:18px;
      margin-bottom:16px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }

    .settings-grid{
      display:grid;
      grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
      gap:12px;
    }

    .settings-value-card{
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.05);
      border-radius:16px;
      padding:14px;
    }

    .settings-value-card label{
      display:block;
      color:#8fb6c0;
      font-size:12px;
      margin-bottom:6px;
    }

    .settings-value-card div{
      color:#f8fafc;
      font-weight:800;
      line-height:1.35;
      word-break:break-word;
    }

    .settings-field{
      margin-bottom:14px;
    }

    .settings-field label{
      display:block;
      margin-bottom:8px;
      color:#d9f99d;
      font-size:13px;
      font-weight:800;
    }

    .settings-field input[type="text"],
    .settings-field textarea,
    .settings-field select{
      width:100%;
      box-sizing:border-box;
      padding:12px 14px;
      border-radius:14px;
      border:1px solid rgba(255,255,255,.10);
      background:rgba(2, 6, 23, .45);
      color:#e2e8f0;
      outline:none;
      font-size:14px;
    }

    .settings-field textarea{
      min-height:240px;
      resize:vertical;
      line-height:1.55;
    }

    .settings-actions{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:8px;
    }

    .settings-primary-btn,
    .settings-secondary-btn,
    .settings-danger-btn{
      height:42px;
      padding:0 16px;
      border-radius:14px;
      font-weight:800;
      color:#fff;
      transition:transform .16s ease, opacity .16s ease;
    }

    .settings-primary-btn:hover,
    .settings-secondary-btn:hover,
    .settings-danger-btn:hover{
      transform:translateY(-1px);
    }

    .settings-primary-btn{
      background:linear-gradient(135deg, #0ea5e9, #10b981);
    }

    .settings-secondary-btn{
      background:rgba(255,255,255,.08);
      color:#e2e8f0;
    }

    .settings-danger-btn{
      background:linear-gradient(135deg, rgba(190,24,93,.88), rgba(153,27,27,.95));
    }

    .settings-profile-top{
      display:flex;
      align-items:center;
      gap:16px;
      margin-bottom:18px;
      flex-wrap:wrap;
    }

    .settings-profile-avatar{
      width:84px;
      height:84px;
      border-radius:24px;
      overflow:hidden;
      display:flex;
      align-items:center;
      justify-content:center;
      background:linear-gradient(135deg,#2563eb,#10b981);
      color:#fff;
      font-size:32px;
      font-weight:900;
      flex-shrink:0;
      box-shadow:0 14px 34px rgba(0,0,0,.24);
    }

    .settings-profile-avatar img{
      width:100%;
      height:100%;
      object-fit:cover;
    }

    .settings-status{
      min-height:20px;
      margin-top:10px;
      font-size:13px;
      color:#86efac;
    }

    .settings-status.error{
      color:#fda4af;
    }

    .settings-range-row{
      display:flex;
      align-items:center;
      gap:12px;
      margin-top:8px;
    }

    .settings-range-row input[type="range"]{
      flex:1;
    }

    .settings-range-value{
      width:56px;
      text-align:right;
      color:#fff;
      font-weight:800;
    }

    .settings-toggle-row{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      padding:12px 14px;
      border-radius:16px;
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.06);
      margin-bottom:14px;
    }

    .settings-toggle-row b{
      color:#fff;
      display:block;
      margin-bottom:4px;
    }

    .settings-toggle-row span{
      color:#94a3b8;
      font-size:13px;
    }

    .settings-toggle-row input[type="checkbox"]{
      width:18px;
      height:18px;
    }

    .settings-meter{
      width:100%;
      height:14px;
      border-radius:999px;
      background:rgba(255,255,255,.08);
      overflow:hidden;
      margin-top:12px;
      border:1px solid rgba(255,255,255,.06);
    }

    .settings-meter-fill{
      width:0%;
      height:100%;
      background:linear-gradient(90deg, #0ea5e9, #22c55e);
      transition:width .08s linear;
    }

    .settings-footer{
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      flex-wrap:wrap;
      padding:16px 22px 22px;
      border-top:1px solid rgba(255,255,255,.08);
      background:rgba(2, 17, 34, .18);
    }

    .settings-footer-info{
      color:#94a3b8;
      font-size:12px;
      line-height:1.5;
    }

    .settings-mini-note{
      margin-top:8px;
      color:#8fd3e0;
      font-size:12px;
      line-height:1.5;
    }

    @media (max-width: 900px){
      .settings-layout{
        flex-direction:column;
      }

      .settings-sidebar{
        width:100%;
        border-right:none;
        border-bottom:1px solid rgba(255,255,255,.08);
      }

      .settings-nav{
        display:grid;
        grid-template-columns:repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 620px){
      .settings-nav{
        grid-template-columns:1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function setupProfileUI() {
  injectEnhancedSettingsStyles();

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

  if (logoutBtn) {
    logoutBtn.style.display = "none";
  }

  createSettingsModal();
  renderMyAvatar();
}

function createSettingsModal() {
  if (document.getElementById("settingsModal")) {
    settingsModal = document.getElementById("settingsModal");
    return;
  }

  settingsModal = document.createElement("div");
  settingsModal.id = "settingsModal";
  settingsModal.className = "modal hidden";

  settingsModal.innerHTML = `
    <div class="settings-shell">
      <div class="settings-head">
        <div>
          <h2>Настройки Callibri</h2>
          <p>Профиль, микрофон, устройство входа, избранное и уведомления — всё в одном месте.</p>
        </div>
        <button id="settingsCloseBtn" type="button" class="settings-close-btn">×</button>
      </div>

      <div class="settings-layout">
        <aside class="settings-sidebar">
          <div class="settings-nav">
            <button type="button" class="settings-nav-btn active" data-settings-section-btn="profile">
              Профиль
              <small>Имя, username, аватарка</small>
            </button>

            <button type="button" class="settings-nav-btn" data-settings-section-btn="microphone">
              Микрофон
              <small>Выбор устройства записи</small>
            </button>

            <button type="button" class="settings-nav-btn" data-settings-section-btn="device">
              Устройство входа
              <small>Информация о текущем устройстве</small>
            </button>

            <button type="button" class="settings-nav-btn" data-settings-section-btn="favorites">
              Избранное
              <small>Личные заметки и важные данные</small>
            </button>

            <button type="button" class="settings-nav-btn" data-settings-section-btn="sounds">
              Уведомления и звук
              <small>Громкость и звуки уведомлений</small>
            </button>
          </div>
        </aside>

        <section class="settings-content">
          <div class="settings-panel active" data-settings-panel="profile">
            <h3 class="settings-title">Профиль</h3>
            <p class="settings-subtitle">Измени имя, username и аватарку. Всё обновится в интерфейсе мессенджера.</p>

            <div class="settings-card">
              <div class="settings-profile-top">
                <div id="settingsProfileAvatar" class="settings-profile-avatar">?</div>

                <div style="display:flex;flex-wrap:wrap;gap:10px;">
                  <button id="settingsChangeAvatarBtn" type="button" class="settings-secondary-btn">Сменить аватарку</button>
                  <button id="settingsRemoveAvatarBtn" type="button" class="settings-secondary-btn">Убрать аватарку</button>
                </div>
              </div>

              <div class="settings-field">
                <label for="settingsDisplayNameInput">Имя</label>
                <input id="settingsDisplayNameInput" type="text" placeholder="Введите имя" />
              </div>

              <div class="settings-field">
                <label for="settingsUsernameInput">Username</label>
                <input id="settingsUsernameInput" type="text" placeholder="username без @" />
                <div class="settings-mini-note">
                  Username: латиница, цифры и нижнее подчёркивание. От 3 до 24 символов.
                </div>
              </div>

              <input id="settingsAvatarFileInput" type="file" accept="image/*" style="display:none;" />

              <div id="settingsProfileState" class="settings-status"></div>

              <div class="settings-actions">
                <button id="settingsSaveProfileBtn" type="button" class="settings-primary-btn">Сохранить профиль</button>
              </div>
            </div>
          </div>

          <div class="settings-panel" data-settings-panel="microphone">
            <h3 class="settings-title">Настройка микрофона</h3>
            <p class="settings-subtitle">Выбери устройство записи. Эта настройка влияет на новые голосовые сообщения.</p>

            <div class="settings-card">
              <div class="settings-field">
                <label for="settingsMicSelect">Микрофон</label>
                <select id="settingsMicSelect"></select>
              </div>

              <div class="settings-actions">
                <button id="settingsRefreshMicsBtn" type="button" class="settings-secondary-btn">Обновить список</button>
                <button id="settingsTestMicBtn" type="button" class="settings-secondary-btn">Проверить микрофон</button>
                <button id="settingsSaveMicBtn" type="button" class="settings-primary-btn">Сохранить выбор</button>
              </div>

              <div class="settings-meter">
                <div id="settingsMicMeterFill" class="settings-meter-fill"></div>
              </div>

              <div class="settings-mini-note">
                Рекомендуется использовать основной микрофон с включёнными: шумоподавлением, эхоподавлением и автоусилением.
              </div>

              <div id="settingsMicState" class="settings-status"></div>
            </div>

            <div class="settings-card">
              <div class="settings-grid">
                <div class="settings-value-card">
                  <label>Кодек записи</label>
                  <div>Opus / WebM</div>
                </div>
                <div class="settings-value-card">
                  <label>Битрейт</label>
                  <div>128 kbps</div>
                </div>
                <div class="settings-value-card">
                  <label>Шумоподавление</label>
                  <div>Включено</div>
                </div>
                <div class="settings-value-card">
                  <label>Эхоподавление</label>
                  <div>Включено</div>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-panel" data-settings-panel="device">
            <h3 class="settings-title">Устройство, с которого выполнен вход</h3>
            <p class="settings-subtitle">Здесь отображается информация о текущем устройстве, браузере или desktop-приложении.</p>

            <div class="settings-card">
              <div class="settings-grid">
                <div class="settings-value-card">
                  <label>Приложение</label>
                  <div id="deviceInfoApp">—</div>
                </div>
                <div class="settings-value-card">
                  <label>Браузер / оболочка</label>
                  <div id="deviceInfoBrowser">—</div>
                </div>
                <div class="settings-value-card">
                  <label>Операционная система</label>
                  <div id="deviceInfoOS">—</div>
                </div>
                <div class="settings-value-card">
                  <label>Платформа</label>
                  <div id="deviceInfoPlatform">—</div>
                </div>
                <div class="settings-value-card">
                  <label>Язык</label>
                  <div id="deviceInfoLanguage">—</div>
                </div>
                <div class="settings-value-card">
                  <label>Разрешение экрана</label>
                  <div id="deviceInfoScreen">—</div>
                </div>
                <div class="settings-value-card">
                  <label>Часовой пояс</label>
                  <div id="deviceInfoTimezone">—</div>
                </div>
                <div class="settings-value-card">
                  <label>Время входа</label>
                  <div id="deviceInfoSavedAt">—</div>
                </div>
              </div>

              <div class="settings-actions">
                <button id="settingsRefreshDeviceBtn" type="button" class="settings-secondary-btn">Обновить информацию</button>
              </div>
            </div>
          </div>

          <div class="settings-panel" data-settings-panel="favorites">
            <h3 class="settings-title">Избранное</h3>
            <p class="settings-subtitle">Личное пространство для заметок, ссылок, кодов, напоминаний и другой важной информации, как в Telegram.</p>

            <div class="settings-card">
              <div class="settings-field">
                <label for="settingsFavoritesTextarea">Ваше избранное</label>
                <textarea id="settingsFavoritesTextarea" placeholder="Например:
• важные ссылки
• пароли без чувствительных данных
• заметки
• коды
• планы
• шаблоны сообщений"></textarea>
              </div>

              <div class="settings-mini-note">
                Сейчас избранное хранится локально на этом устройстве, в браузере/приложении.
              </div>

              <div id="settingsFavoritesState" class="settings-status"></div>

              <div class="settings-actions">
                <button id="settingsSaveFavoritesBtn" type="button" class="settings-primary-btn">Сохранить избранное</button>
                <button id="settingsClearFavoritesBtn" type="button" class="settings-secondary-btn">Очистить</button>
              </div>
            </div>
          </div>

          <div class="settings-panel" data-settings-panel="sounds">
            <h3 class="settings-title">Уведомления и звук</h3>
            <p class="settings-subtitle">Настрой звуки уведомлений и громкость воспроизведения голосовых сообщений.</p>

            <div class="settings-card">
              <div class="settings-toggle-row">
                <div>
                  <b>Звуки уведомлений</b>
                  <span>Воспроизводить короткий звук при новых сообщениях</span>
                </div>
                <input id="settingsNotificationSoundToggle" type="checkbox" />
              </div>

              <div class="settings-field">
                <label for="settingsNotificationVolume">Громкость уведомлений</label>
                <div class="settings-range-row">
                  <input id="settingsNotificationVolume" type="range" min="0" max="100" step="1" />
                  <div id="settingsNotificationVolumeValue" class="settings-range-value">80%</div>
                </div>
              </div>

              <div class="settings-field">
                <label for="settingsVoicePlaybackVolume">Громкость голосовых сообщений</label>
                <div class="settings-range-row">
                  <input id="settingsVoicePlaybackVolume" type="range" min="0" max="100" step="1" />
                  <div id="settingsVoicePlaybackVolumeValue" class="settings-range-value">100%</div>
                </div>
              </div>

              <div id="settingsSoundState" class="settings-status"></div>

              <div class="settings-actions">
                <button id="settingsTestSoundBtn" type="button" class="settings-secondary-btn">Проверить звук</button>
                <button id="settingsSaveSoundBtn" type="button" class="settings-primary-btn">Сохранить настройки</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="settings-footer">
        <div class="settings-footer-info">
          Callibri · Панель настроек<br>
          Всё управление аккаунтом теперь собрано в одной шестерёнке.
        </div>

        <div class="settings-actions" style="margin-top:0;">
          <button id="settingsLogoutBtn" type="button" class="settings-danger-btn">Выйти из аккаунта</button>
          <button id="settingsDoneBtn" type="button" class="settings-primary-btn">Готово</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(settingsModal);

  document.getElementById("settingsCloseBtn").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsDoneBtn").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsLogoutBtn").addEventListener("click", () => {
    closeSettingsModal();
    logout();
  });

  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) {
      closeSettingsModal();
    }
  });

  document.querySelectorAll("[data-settings-section-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      switchSettingsSection(button.dataset.settingsSectionBtn);
    });
  });

  document.getElementById("settingsSaveProfileBtn").addEventListener("click", saveProfile);
  document.getElementById("settingsChangeAvatarBtn").addEventListener("click", () => {
    profileModalAvatarInput.click();
  });
  document.getElementById("settingsRemoveAvatarBtn").addEventListener("click", () => {
    profileAvatarDraft = "";
    renderSettingsProfileAvatar();
  });

  profileModalAvatarInput = document.getElementById("settingsAvatarFileInput");
  profileModalAvatarInput.addEventListener("change", handleProfileAvatarDraft);

  document.getElementById("settingsRefreshMicsBtn").addEventListener("click", populateMicrophoneDevices);
  document.getElementById("settingsTestMicBtn").addEventListener("click", toggleSettingsMicTest);
  document.getElementById("settingsSaveMicBtn").addEventListener("click", saveMicSettings);

  document.getElementById("settingsRefreshDeviceBtn").addEventListener("click", refreshDeviceInfo);

  document.getElementById("settingsSaveFavoritesBtn").addEventListener("click", saveFavoritesSettings);
  document.getElementById("settingsClearFavoritesBtn").addEventListener("click", clearFavoritesSettings);

  document.getElementById("settingsNotificationVolume").addEventListener("input", updateSoundRangeLabels);
  document.getElementById("settingsVoicePlaybackVolume").addEventListener("input", updateSoundRangeLabels);
  document.getElementById("settingsTestSoundBtn").addEventListener("click", playNotificationSound);
  document.getElementById("settingsSaveSoundBtn").addEventListener("click", saveSoundSettings);
}

function switchSettingsSection(section) {
  settingsActiveSection = section || "profile";

  document.querySelectorAll("[data-settings-section-btn]").forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsSectionBtn === settingsActiveSection);
  });

  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.settingsPanel === settingsActiveSection);
  });

  if (settingsActiveSection !== "microphone") {
    stopSettingsMicTest();
  }

  if (settingsActiveSection === "profile") {
    renderSettingsProfileSection();
  }

  if (settingsActiveSection === "microphone") {
    populateMicrophoneDevices();
  }

  if (settingsActiveSection === "device") {
    renderDeviceInfo();
  }

  if (settingsActiveSection === "favorites") {
    renderFavoritesSection();
  }

  if (settingsActiveSection === "sounds") {
    renderSoundSection();
  }
}

function openSettingsModal() {
  if (!currentUser) return;

  createSettingsModal();
  loadAppSettings();
  ensureLoginDeviceInfo();

  profileAvatarDraft = currentUser.avatar || "";

  renderSettingsProfileSection();
  renderDeviceInfo();
  renderFavoritesSection();
  renderSoundSection();

  settingsModal.classList.remove("hidden");
  switchSettingsSection(settingsActiveSection || "profile");
}

function renderSettingsProfileAvatar() {
  const avatarBox = document.getElementById("settingsProfileAvatar");

  if (!avatarBox || !currentUser) return;

  if (profileAvatarDraft) {
    avatarBox.innerHTML = `<img src="${profileAvatarDraft}" alt="avatar">`;
  } else {
    avatarBox.textContent = (currentUser.displayName || currentUser.username || "?")[0].toUpperCase();
  }
}

function renderSettingsProfileSection() {
  if (!currentUser) return;

  const nameInput = document.getElementById("settingsDisplayNameInput");
  const usernameInput = document.getElementById("settingsUsernameInput");
  const state = document.getElementById("settingsProfileState");

  if (nameInput) nameInput.value = currentUser.displayName || currentUser.username || "";
  if (usernameInput) usernameInput.value = currentUser.username || "";
  if (state) {
    state.textContent = "";
    state.classList.remove("error");
  }

  renderSettingsProfileAvatar();
}

async function handleProfileAvatarDraft(event) {
  const file = event.target.files && event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Выбери изображение");
    event.target.value = "";
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    alert("Файл слишком большой. Максимум 8 МБ.");
    event.target.value = "";
    return;
  }

  try {
    profileAvatarDraft = await fileToDataUrl(file);
    renderSettingsProfileAvatar();
  } catch (error) {
    alert("Не удалось загрузить аватарку");
  } finally {
    event.target.value = "";
  }
}

async function saveProfile() {
  if (!currentUser) return;

  const state = document.getElementById("settingsProfileState");
  const nameInput = document.getElementById("settingsDisplayNameInput");
  const usernameInput = document.getElementById("settingsUsernameInput");

  const oldUsername = currentUser.username;
  const displayName = nameInput ? nameInput.value.trim() : "";
  const newUsername = usernameInput ? normalizeUsername(usernameInput.value) : "";

  if (state) {
    state.textContent = "";
    state.classList.remove("error");
  }

  if (!displayName) {
    if (state) {
      state.textContent = "Введите имя";
      state.classList.add("error");
    }
    return;
  }

  if (!newUsername) {
    if (state) {
      state.textContent = "Введите username";
      state.classList.add("error");
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
        avatar: profileAvatarDraft || ""
      })
    });

    const oldSettingsSnapshot = { ...appSettings };

    updateSavedUser(data.user);

    appSettings = {
      ...oldSettingsSnapshot
    };

    if (appSettings.loginDeviceInfo) {
      appSettings.loginDeviceInfo.savedAt = new Date().toISOString();
    }

    saveAppSettings(oldUsername);

    if (meName) meName.textContent = currentUser.displayName || currentUser.username;
    if (meLogin) meLogin.textContent = "@" + currentUser.username;

    renderMyAvatar();

    socket.emit("user_online", {
      username: currentUser.username
    });

    selectedUser = null;
    selectedGroup = null;
    selectedChatType = null;
    messagesCache = [];

    await loadRecentChats();
    await loadGroups();

    renderEmptyChat();
    renderSettingsProfileSection();
    renderDeviceInfo();

    if (state) {
      state.textContent = "Профиль обновлён";
      state.classList.remove("error");
    }
  } catch (err) {
    if (state) {
      state.textContent = err.message;
      state.classList.add("error");
    }
  }
}

function renderMyAvatar() {
  if (!profileAvatarBtn || !currentUser) return;

  if (currentUser.avatar) {
    profileAvatarBtn.innerHTML = `<img src="${currentUser.avatar}" alt="avatar">`;
  } else {
    profileAvatarBtn.textContent = (currentUser.displayName || currentUser.username || "?")[0].toUpperCase();
  }
}

async function populateMicrophoneDevices() {
  const select = document.getElementById("settingsMicSelect");
  const state = document.getElementById("settingsMicState");

  if (!select) return;

  if (state) {
    state.textContent = "";
    state.classList.remove("error");
  }

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
        temp.getTracks().forEach((track) => track.stop());
      } catch {}
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");

    select.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Системный микрофон по умолчанию";
    select.appendChild(defaultOption);

    microphones.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Микрофон ${index + 1}`;
      select.appendChild(option);
    });

    select.value = appSettings.selectedMicId || "";
  } catch (error) {
    console.error(error);

    select.innerHTML = `<option value="">Не удалось получить список устройств</option>`;

    if (state) {
      state.textContent = "Не удалось получить список микрофонов";
      state.classList.add("error");
    }
  }
}

function saveMicSettings() {
  const select = document.getElementById("settingsMicSelect");
  const state = document.getElementById("settingsMicState");

  if (!select) return;

  appSettings.selectedMicId = select.value || "";
  saveAppSettings();

  if (state) {
    state.textContent = "Выбор микрофона сохранён";
    state.classList.remove("error");
  }
}

function stopSettingsMicTest() {
  if (settingsMicTestFrame) {
    cancelAnimationFrame(settingsMicTestFrame);
    settingsMicTestFrame = null;
  }

  if (settingsMicTestStream) {
    settingsMicTestStream.getTracks().forEach((track) => track.stop());
    settingsMicTestStream = null;
  }

  if (settingsMicTestContext) {
    settingsMicTestContext.close().catch(() => {});
    settingsMicTestContext = null;
  }

  settingsMicTestAnalyser = null;
  settingsMicTestDataArray = null;

  const meter = document.getElementById("settingsMicMeterFill");
  const btn = document.getElementById("settingsTestMicBtn");

  if (meter) meter.style.width = "0%";
  if (btn) btn.textContent = "Проверить микрофон";
}

async function toggleSettingsMicTest() {
  const btn = document.getElementById("settingsTestMicBtn");
  const state = document.getElementById("settingsMicState");
  const meter = document.getElementById("settingsMicMeterFill");

  if (settingsMicTestStream) {
    stopSettingsMicTest();

    if (state) {
      state.textContent = "Проверка микрофона остановлена";
      state.classList.remove("error");
    }

    return;
  }

  try {
    const select = document.getElementById("settingsMicSelect");
    const selectedMicId = select ? select.value : "";

    const constraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    };

    if (selectedMicId) {
      constraints.deviceId = { exact: selectedMicId };
    }

    settingsMicTestStream = await navigator.mediaDevices.getUserMedia({
      audio: constraints
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    settingsMicTestContext = new AudioCtx();

    const source = settingsMicTestContext.createMediaStreamSource(settingsMicTestStream);
    settingsMicTestAnalyser = settingsMicTestContext.createAnalyser();
    settingsMicTestAnalyser.fftSize = 256;
    source.connect(settingsMicTestAnalyser);

    const length = settingsMicTestAnalyser.frequencyBinCount;
    settingsMicTestDataArray = new Uint8Array(length);

    if (btn) btn.textContent = "Остановить проверку";

    if (state) {
      state.textContent = "Говори в микрофон — индикатор ниже покажет уровень";
      state.classList.remove("error");
    }

    function drawMicLevel() {
      if (!settingsMicTestAnalyser || !settingsMicTestDataArray) return;

      settingsMicTestAnalyser.getByteFrequencyData(settingsMicTestDataArray);

      let sum = 0;
      for (let i = 0; i < settingsMicTestDataArray.length; i++) {
        sum += settingsMicTestDataArray[i];
      }

      const average = sum / settingsMicTestDataArray.length;
      const level = Math.max(0, Math.min(100, Math.round((average / 180) * 100)));

      if (meter) {
        meter.style.width = `${level}%`;
      }

      settingsMicTestFrame = requestAnimationFrame(drawMicLevel);
    }

    drawMicLevel();
  } catch (error) {
    console.error(error);

    stopSettingsMicTest();

    if (state) {
      state.textContent = "Не удалось запустить проверку микрофона";
      state.classList.add("error");
    }
  }
}

function refreshDeviceInfo() {
  appSettings.loginDeviceInfo = buildLoginDeviceInfo();
  saveAppSettings();
  renderDeviceInfo();
}

function renderDeviceInfo() {
  const info = appSettings.loginDeviceInfo || buildLoginDeviceInfo();

  const map = {
    deviceInfoApp: info.app,
    deviceInfoBrowser: info.browser,
    deviceInfoOS: info.os,
    deviceInfoPlatform: info.platform,
    deviceInfoLanguage: info.language,
    deviceInfoScreen: info.screen,
    deviceInfoTimezone: info.timezone,
    deviceInfoSavedAt: formatDateTime(info.savedAt)
  };

  Object.entries(map).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value || "—";
    }
  });
}

function renderFavoritesSection() {
  const textarea = document.getElementById("settingsFavoritesTextarea");
  const state = document.getElementById("settingsFavoritesState");

  if (textarea) {
    textarea.value = appSettings.favoritesText || "";
  }

  if (state) {
    state.textContent = "";
    state.classList.remove("error");
  }
}

function saveFavoritesSettings() {
  const textarea = document.getElementById("settingsFavoritesTextarea");
  const state = document.getElementById("settingsFavoritesState");

  appSettings.favoritesText = textarea ? textarea.value : "";
  saveAppSettings();

  if (state) {
    state.textContent = "Избранное сохранено";
    state.classList.remove("error");
  }
}

function clearFavoritesSettings() {
  const textarea = document.getElementById("settingsFavoritesTextarea");
  const state = document.getElementById("settingsFavoritesState");

  if (textarea) textarea.value = "";
  appSettings.favoritesText = "";
  saveAppSettings();

  if (state) {
    state.textContent = "Избранное очищено";
    state.classList.remove("error");
  }
}

function updateSoundRangeLabels() {
  const notificationRange = document.getElementById("settingsNotificationVolume");
  const voiceRange = document.getElementById("settingsVoicePlaybackVolume");
  const notificationValue = document.getElementById("settingsNotificationVolumeValue");
  const voiceValue = document.getElementById("settingsVoicePlaybackVolumeValue");

  if (notificationRange && notificationValue) {
    notificationValue.textContent = `${notificationRange.value}%`;
  }

  if (voiceRange && voiceValue) {
    voiceValue.textContent = `${voiceRange.value}%`;
  }
}

function renderSoundSection() {
  const toggle = document.getElementById("settingsNotificationSoundToggle");
  const notificationRange = document.getElementById("settingsNotificationVolume");
  const voiceRange = document.getElementById("settingsVoicePlaybackVolume");
  const state = document.getElementById("settingsSoundState");

  if (toggle) {
    toggle.checked = Boolean(appSettings.notificationSoundsEnabled);
  }

  if (notificationRange) {
    notificationRange.value = String(Math.round((appSettings.notificationVolume || 0) * 100));
  }

  if (voiceRange) {
    voiceRange.value = String(Math.round((appSettings.voicePlaybackVolume || 0) * 100));
  }

  updateSoundRangeLabels();

  if (state) {
    state.textContent = "";
    state.classList.remove("error");
  }
}

function applyVoiceVolumeToPlayers() {
  for (const [, player] of voicePlayers.entries()) {
    try {
      player.setVolume(Number(appSettings.voicePlaybackVolume || 1));
    } catch {}
  }
}

function saveSoundSettings() {
  const toggle = document.getElementById("settingsNotificationSoundToggle");
  const notificationRange = document.getElementById("settingsNotificationVolume");
  const voiceRange = document.getElementById("settingsVoicePlaybackVolume");
  const state = document.getElementById("settingsSoundState");

  appSettings.notificationSoundsEnabled = Boolean(toggle && toggle.checked);
  appSettings.notificationVolume = Math.max(0, Math.min(1, Number(notificationRange ? notificationRange.value : 80) / 100));
  appSettings.voicePlaybackVolume = Math.max(0, Math.min(1, Number(voiceRange ? voiceRange.value : 100) / 100));

  saveAppSettings();
  applyVoiceVolumeToPlayers();

  if (state) {
    state.textContent = "Настройки звука сохранены";
    state.classList.remove("error");
  }
}

function setupGroupUI() {
  if (document.getElementById("createGroupBtn")) return;

  if (!usersBox || !usersBox.parentElement) return;

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

  usersBox.parentElement.insertBefore(createGroupBtn, usersBox);
  usersBox.parentElement.insertBefore(recentTitle, usersBox);
  usersBox.parentElement.insertBefore(recentChatsBox, usersBox);
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

    alert("Ты вышел из группы");
  } catch (error) {
    alert(error.message);
  }
}

async function deleteCurrentGroup() {
  if (!currentUser || !selectedGroup) return;

  const ok = confirm(`Удалить группу "${selectedGroup.name}" полностью? Сообщения группы тоже удалятся.`);

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

    alert("Группа удалена");
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

function openRecordingPanel() {
  if (!recordingPanel) return;

  recordingPanel.classList.remove("hidden");

  if (voiceBtn) voiceBtn.disabled = true;
  if (attachBtn) attachBtn.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (messageInput) messageInput.disabled = true;

  if (recordingSendBtn) recordingSendBtn.disabled = true;
  if (recordingVisualizer) recordingVisualizer.innerHTML = "";

  liveWaveformBars = [];
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

  if (recordingTimer) {
    recordingTimer.textContent = "00:00";
  }

  clearInterval(recordingTimerInterval);

  recordingTimerInterval = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;

    if (recordingTimer) {
      recordingTimer.textContent = formatRecordingTime(elapsed);
    }
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

  const bufferLength = analyserNode.fftSize;
  analyserDataArray = new Uint8Array(bufferLength);

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

function buildRecordingAudioConstraints(useExactDevice = true) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000
  };

  if (useExactDevice && appSettings.selectedMicId) {
    audio.deviceId = { exact: appSettings.selectedMicId };
  }

  return audio;
}

async function getRecordingStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: buildRecordingAudioConstraints(true)
    });
  } catch (error) {
    if (appSettings.selectedMicId) {
      return await navigator.mediaDevices.getUserMedia({
        audio: buildRecordingAudioConstraints(false)
      });
    }

    throw error;
  }
}

async function toggleVoiceRecording() {
  if (!canSendNow()) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Запись голоса не поддерживается в этом браузере/окне.");
    return;
  }

  if (isRecording) {
    await finishVoiceRecording();
    return;
  }

  try {
    recordingStream = await getRecordingStream();

    recordedChunks = [];
    finalVoiceBlob = null;
    liveWaveformBars = [];

    let recorderOptions = {};

    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      recorderOptions = {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000
      };
    } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm")) {
      recorderOptions = {
        mimeType: "audio/webm",
        audioBitsPerSecond: 128000
      };
    }

    mediaRecorder = new MediaRecorder(recordingStream, recorderOptions);

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

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
        type: "audio/webm"
      });

      finalVoiceBlob = blob;

      if (recordingSendBtn) {
        recordingSendBtn.disabled = !blob.size;
      }
    };

    mediaRecorder.start();
    isRecording = true;

    openRecordingPanel();
    startRecordingTimer();
    startRealtimeVisualizer();

    if (voiceBtn) {
      voiceBtn.classList.add("recording");
      voiceBtn.textContent = "■";
      voiceBtn.title = "Остановить запись";
      voiceBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    alert("Разреши доступ к микрофону.");
    cancelVoiceRecording();
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
    voiceBtn.title = "Голосовое сообщение";
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
    voiceBtn.title = "Голосовое сообщение";
    voiceBtn.disabled = false;
  }

  closeRecordingPanel();
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
    const waveform = normalizeWaveformBars(liveWaveformBars, 96);

    sendMediaMessage({
      type: "audio",
      url,
      name: "voice.webm",
      isVoice: true,
      durationMs: elapsed,
      waveform
    });

    closeRecordingPanel();
  } catch (error) {
    alert("Не удалось отправить голосовое");
  }
}

function sendMediaMessage(media) {
  stopTyping();

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

  loadAppSettings();
  ensureLoginDeviceInfo();

  setupProfileUI();
  setupGroupUI();
  setupGroupActionsUI();
  setupMessageTools();
  setupWindowsNotifications();

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

    renderRecentChats();
  } catch (error) {
    console.error(error);

    if (recentChatsBox) {
      recentChatsBox.innerHTML = `<div class="empty small-empty">Ошибка загрузки чатов</div>`;
    }
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
  }
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

    item.addEventListener("click", () => {
      openChat(user);
    });

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

    usersCache.forEach((user) => {
      onlineUsers[user.username] = Boolean(user.online);
    });

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
      Введите @id пользователя, чтобы найти новый чат.<br>
      Например: <b>@username</b>
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

    item.addEventListener("click", () => {
      openChat(user);
    });

    usersBox.appendChild(item);
  });
}

function renderEmptyChat() {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();

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
    renderRecentChats();
    renderGroups();
  } catch (error) {
    if (messagesBox) {
      messagesBox.innerHTML = `<div class="empty">Ошибка загрузки сообщений</div>`;
    }
  }
}

async function openGroup(group) {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();

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
    renderRecentChats();
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

  stopTyping();

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

async function deleteMessage(messageId) {
  if (!currentUser || !messageId) return;

  const ok = confirm("Удалить сообщение у всех?");

  if (!ok) return;

  try {
    destroyVoicePlayer(messageId);

    await request(`/api/messages/${encodeURIComponent(messageId)}?me=${encodeURIComponent(currentUser.username)}`, {
      method: "DELETE"
    });
  } catch (error) {
    alert(error.message);
  }
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

function createFallbackWaveformHtml(waveform) {
  const bars = Array.isArray(waveform) && waveform.length
    ? waveform
    : Array.from({ length: 60 }, (_, index) => 8 + ((index * 7) % 20));

  return bars
    .map((value) => {
      const height = Math.max(5, Math.min(26, value));

      return `<span class="voice-wave-bar" style="height:${height}px"></span>`;
    })
    .join("");
}

function renderVoiceCard(media, message, mine, canDelete) {
  const id = String(message.id);
  const audioUrl = media.url || "";
  const durationText = media.durationMs ? formatRecordingTime(media.durationMs) : "00:00";
  const clockText = formatTime(message.created_at);
  const fallbackWave = createFallbackWaveformHtml(media.waveform);

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
        ${
          canDelete
            ? `<button class="delete-message-btn voice-card__delete" data-id="${escapeHtml(id)}" title="Удалить сообщение">🗑</button>`
            : `<span></span>`
        }

        <span class="voice-card__clock">${escapeHtml(clockText)}</span>
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
    console.warn("WaveSurfer не подключён. Проверь public/index.html");
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

  player.on("seeking", () => {
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

function renderMedia(media, message, mine, canDelete) {
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
        ${renderVoiceCard(media, message, mine, canDelete)}
      </div>
    `;
  }

  return "";
}

function renderMessages() {
  if (!messagesBox) return;

  destroyAllVoicePlayers();

  messagesBox.innerHTML = "";

  if (!messagesCache.length) {
    messagesBox.innerHTML = `<div class="empty">Сообщений пока нет. Напиши первым.</div>`;
    return;
  }

  messagesCache.forEach((message) => {
    const mine = message.from === currentUser.username || message.username === currentUser.username;
    const canDelete = mine && selectedChatType === "direct" && message.id;
    const isAudio = message.media && message.media.type === "audio";

    const bubble = document.createElement("div");
    bubble.className = mine ? "message mine" : "message";

    const text = message.text || message.message || "";
    const mediaHtml = renderMedia(message.media, message, mine, canDelete);

    bubble.innerHTML = `
      <div class="message-name">${escapeHtml(message.displayName || message.username || "")}</div>
      ${mediaHtml}
      ${text ? `<div class="message-text">${escapeHtml(text)}</div>` : ""}
      ${!isAudio ? `<div class="message-time">${formatTime(message.created_at)}</div>` : ""}
      ${
        canDelete && !isAudio
          ? `<button class="delete-message-btn" data-id="${escapeHtml(message.id)}" title="Удалить сообщение">Удалить</button>`
          : ""
      }
    `;

    const deleteBtn = bubble.querySelector(".delete-message-btn");

    if (deleteBtn && !deleteBtn.classList.contains("voice-card__delete")) {
      deleteBtn.style.marginTop = "7px";
      deleteBtn.style.background = "rgba(127, 29, 29, 0.65)";
      deleteBtn.style.color = "white";
      deleteBtn.style.borderRadius = "10px";
      deleteBtn.style.padding = "5px 9px";
      deleteBtn.style.fontSize = "11px";
      deleteBtn.style.fontWeight = "700";
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteMessage(deleteBtn.dataset.id);
      });
    }

    messagesBox.appendChild(bubble);

    if (isAudio) {
      initVoicePlayer(message);
    }
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

socket.on("message_deleted", (data) => {
  if (!data || !data.id) return;

  destroyVoicePlayer(data.id);

  messagesCache = messagesCache.filter((message) => String(message.id) !== String(data.id));

  renderMessages();
  loadRecentChats();
});

socket.on("profile_updated", (data) => {
  if (!data || !data.user) return;

  const oldUsername = normalizeUsername(data.oldUsername);
  const user = data.user;

  if (currentUser && oldUsername === currentUser.username) {
    const oldSettingsSnapshot = { ...appSettings };

    updateSavedUser(user);

    appSettings = {
      ...oldSettingsSnapshot
    };

    saveAppSettings(oldUsername);

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
      const exists = messagesCache.some((m) => m.id === message.id);

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
  messageInput.addEventListener("input", handleTypingInput);

  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener("blur", () => {
    setTimeout(() => {
      stopTyping();
    }, 500);
  });
}

window.addEventListener("beforeunload", () => {
  cancelVoiceRecording();
  stopTyping();
  destroyAllVoicePlayers();
  stopSettingsMicTest();
});

const savedUser = loadSavedUser();

if (savedUser) {
  currentUser = savedUser;
  startApp();
}

/* =========================================================
   CALLIBRI — HUMMINGBIRD NOTIFICATION SOUND
   ВСТАВИТЬ В САМЫЙ НИЗ public/app.js
   ========================================================= */

let callibriNotificationSoundCooldown = false;

function playNotificationSound() {
  if (!appSettings || !appSettings.notificationSoundsEnabled) return;

  if (callibriNotificationSoundCooldown) return;

  callibriNotificationSoundCooldown = true;

  setTimeout(() => {
    callibriNotificationSoundCooldown = false;
  }, 650);

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    if (!AudioCtx) return;

    const ctx = new AudioCtx();

    const volume = Math.max(
      0,
      Math.min(1, Number(appSettings.notificationVolume || 0.8))
    );

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.16 * volume, ctx.currentTime + 0.035);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    masterGain.connect(ctx.destination);

    const reverbDelay = ctx.createDelay();
    reverbDelay.delayTime.value = 0.085;

    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.16 * volume;

    reverbDelay.connect(reverbGain);
    reverbGain.connect(ctx.destination);

    function createChirp(startTime, startFreq, endFreq, duration, gainValue) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      oscillator.type = "sine";

      oscillator.frequency.setValueAtTime(startFreq, startTime);
      oscillator.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

      filter.type = "bandpass";
      filter.frequency.setValueAtTime((startFreq + endFreq) / 2, startTime);
      filter.Q.value = 6;

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(gainValue * volume, startTime + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      gain.connect(reverbDelay);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration + 0.03);
    }

    function createSoftWingFlutter(startTime) {
      const flutterGain = ctx.createGain();
      flutterGain.gain.setValueAtTime(0.0001, startTime);
      flutterGain.gain.exponentialRampToValueAtTime(0.045 * volume, startTime + 0.025);
      flutterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.38);

      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 900;

      const bufferSize = ctx.sampleRate * 0.42;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        const t = i / ctx.sampleRate;
        const flutter = Math.sin(2 * Math.PI * 42 * t) * 0.5 + 0.5;
        data[i] = (Math.random() * 2 - 1) * flutter * 0.25;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      noise.connect(filter);
      filter.connect(flutterGain);
      flutterGain.connect(masterGain);

      noise.start(startTime);
      noise.stop(startTime + 0.42);
    }

    const now = ctx.currentTime;

    createSoftWingFlutter(now);

    createChirp(now + 0.015, 1850, 2650, 0.105, 0.13);
    createChirp(now + 0.125, 2300, 3400, 0.095, 0.105);
    createChirp(now + 0.245, 1750, 2850, 0.13, 0.09);

    const sparkle = ctx.createOscillator();
    const sparkleGain = ctx.createGain();

    sparkle.type = "triangle";
    sparkle.frequency.setValueAtTime(4200, now + 0.34);
    sparkle.frequency.exponentialRampToValueAtTime(5200, now + 0.48);

    sparkleGain.gain.setValueAtTime(0.0001, now + 0.34);
    sparkleGain.gain.exponentialRampToValueAtTime(0.045 * volume, now + 0.37);
    sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);

    sparkle.connect(sparkleGain);
    sparkleGain.connect(masterGain);
    sparkleGain.connect(reverbDelay);

    sparkle.start(now + 0.34);
    sparkle.stop(now + 0.55);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch (error) {
    console.log("Callibri notification sound error:", error);
  }
}