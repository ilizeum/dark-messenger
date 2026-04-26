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

let notificationPermissionRequested = false;
let typingTimer = null;
let isTypingNow = false;

let profileAvatarDraft = "";

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

let recentChatsBox = null;
let groupsBox = null;
let createGroupBtn = null;
let groupModal = null;

let avatarInput = null;
let fileInput = null;
let attachBtn = null;
let voiceBtn = null;
let profileAvatarBtn = null;
let profileBtn = null;
let groupActionsBox = null;
let profileModal = null;
let profileModalAvatarInput = null;

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

function logout() {
  stopTyping();

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

  updateUnreadTitle();

  if (rememberMeInput) rememberMeInput.checked = false;

  if (app) app.classList.add("hidden");
  if (auth) auth.classList.remove("hidden");

  if (messageInput) messageInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

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
      silent: false
    });

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

function setupProfileUI() {
  if (!meName || document.getElementById("profileAvatarBtn")) return;

  const profile = meName.closest(".profile");

  if (!profile) return;

  profileAvatarBtn = document.createElement("button");
  profileAvatarBtn.id = "profileAvatarBtn";
  profileAvatarBtn.type = "button";
  profileAvatarBtn.title = "Профиль";

  profileBtn = document.createElement("button");
  profileBtn.id = "profileBtn";
  profileBtn.type = "button";
  profileBtn.textContent = "Профиль";
  profileBtn.title = "Открыть профиль";

  profileBtn.style.marginLeft = "auto";
  profileBtn.style.background = "#243044";
  profileBtn.style.color = "#cbd5e1";
  profileBtn.style.padding = "9px 12px";
  profileBtn.style.borderRadius = "12px";
  profileBtn.style.fontWeight = "700";
  profileBtn.style.whiteSpace = "nowrap";

  if (logoutBtn) {
    logoutBtn.style.marginLeft = "6px";
  }

  profile.prepend(profileAvatarBtn);

  if (logoutBtn) {
    profile.insertBefore(profileBtn, logoutBtn);
  } else {
    profile.appendChild(profileBtn);
  }

  profileAvatarBtn.addEventListener("click", openProfileModal);
  profileBtn.addEventListener("click", openProfileModal);

  createProfileModal();
  renderMyAvatar();
}

function createProfileModal() {
  if (document.getElementById("profileModal")) return;

  profileModal = document.createElement("div");
  profileModal.id = "profileModal";
  profileModal.className = "modal hidden";

  profileModal.innerHTML = `
    <div class="modal-card" style="max-width:460px;">
      <h2>Профиль</h2>
      <p>Здесь можно изменить аватарку, имя и @username.</p>

      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <button id="profileModalAvatarBtn" type="button" style="
          width:74px;
          height:74px;
          border-radius:50%;
          background:linear-gradient(135deg,#22d3ee,#2563eb);
          color:white;
          font-size:28px;
          font-weight:900;
          overflow:hidden;
          flex-shrink:0;
        "></button>

        <div>
          <button id="profileChangeAvatarBtn" type="button" style="
            background:#243044;
            color:white;
            border-radius:12px;
            padding:10px 13px;
            font-weight:800;
          ">Сменить аватарку</button>

          <button id="profileRemoveAvatarBtn" type="button" style="
            background:#3a2230;
            color:#fb7185;
            border-radius:12px;
            padding:10px 13px;
            font-weight:800;
            margin-left:6px;
          ">Убрать</button>
        </div>
      </div>

      <input id="profileDisplayNameInput" type="text" placeholder="Имя" />
      <input id="profileUsernameInput" type="text" placeholder="username без @" />

      <div style="color:#94a3b8;font-size:13px;line-height:1.4;margin:-4px 0 12px;">
        Username: только латиница, цифры и нижнее подчёркивание. От 3 до 24 символов.
      </div>

      <input id="profileAvatarFileInput" type="file" accept="image/*" style="display:none;" />

      <div id="profileError" style="min-height:20px;color:#fb7185;font-size:14px;margin-bottom:12px;"></div>

      <div class="modal-actions">
        <button id="cancelProfileBtn" type="button">Отмена</button>
        <button id="saveProfileBtn" type="button">Сохранить</button>
      </div>
    </div>
  `;

  document.body.appendChild(profileModal);

  const cancelProfileBtn = document.getElementById("cancelProfileBtn");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const profileModalAvatarBtn = document.getElementById("profileModalAvatarBtn");
  const profileChangeAvatarBtn = document.getElementById("profileChangeAvatarBtn");
  const profileRemoveAvatarBtn = document.getElementById("profileRemoveAvatarBtn");

  profileModalAvatarInput = document.getElementById("profileAvatarFileInput");

  if (cancelProfileBtn) cancelProfileBtn.addEventListener("click", closeProfileModal);
  if (saveProfileBtn) saveProfileBtn.addEventListener("click", saveProfile);

  if (profileModalAvatarBtn) {
    profileModalAvatarBtn.addEventListener("click", () => {
      profileModalAvatarInput.click();
    });
  }

  if (profileChangeAvatarBtn) {
    profileChangeAvatarBtn.addEventListener("click", () => {
      profileModalAvatarInput.click();
    });
  }

  if (profileRemoveAvatarBtn) {
    profileRemoveAvatarBtn.addEventListener("click", () => {
      profileAvatarDraft = "";
      renderProfileModalAvatar();
    });
  }

  if (profileModalAvatarInput) {
    profileModalAvatarInput.addEventListener("change", handleProfileAvatarDraft);
  }
}

function openProfileModal() {
  if (!currentUser) return;

  createProfileModal();

  const nameInput = document.getElementById("profileDisplayNameInput");
  const usernameInput = document.getElementById("profileUsernameInput");
  const error = document.getElementById("profileError");

  profileAvatarDraft = currentUser.avatar || "";

  if (nameInput) nameInput.value = currentUser.displayName || currentUser.username || "";
  if (usernameInput) usernameInput.value = currentUser.username || "";
  if (error) error.textContent = "";

  renderProfileModalAvatar();

  if (profileModal) {
    profileModal.classList.remove("hidden");
  }
}

function closeProfileModal() {
  if (profileModal) {
    profileModal.classList.add("hidden");
  }

  if (profileModalAvatarInput) {
    profileModalAvatarInput.value = "";
  }
}

function renderProfileModalAvatar() {
  const btn = document.getElementById("profileModalAvatarBtn");

  if (!btn || !currentUser) return;

  if (profileAvatarDraft) {
    btn.innerHTML = `<img src="${profileAvatarDraft}" alt="avatar" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    btn.textContent = (currentUser.displayName || currentUser.username || "?")[0].toUpperCase();
  }
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
    renderProfileModalAvatar();
  } catch (error) {
    alert("Не удалось загрузить аватарку");
  } finally {
    event.target.value = "";
  }
}

async function saveProfile() {
  if (!currentUser) return;

  const nameInput = document.getElementById("profileDisplayNameInput");
  const usernameInput = document.getElementById("profileUsernameInput");
  const error = document.getElementById("profileError");

  const oldUsername = currentUser.username;
  const displayName = nameInput ? nameInput.value.trim() : "";
  const newUsername = usernameInput ? normalizeUsername(usernameInput.value) : "";

  if (error) error.textContent = "";

  if (!displayName) {
    if (error) error.textContent = "Введите имя";
    return;
  }

  if (!newUsername) {
    if (error) error.textContent = "Введите username";
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

    selectedUser = null;
    selectedGroup = null;
    selectedChatType = null;
    messagesCache = [];

    await loadRecentChats();
    await loadGroups();

    renderEmptyChat();
    closeProfileModal();

    alert("Профиль обновлён");
  } catch (err) {
    if (error) error.textContent = err.message;
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
  stopTyping();

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
  stopTyping();

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
  stopTyping();

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
    await request(`/api/messages/${encodeURIComponent(messageId)}?me=${encodeURIComponent(currentUser.username)}`, {
      method: "DELETE"
    });
  } catch (error) {
    alert(error.message);
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
    const canDelete = mine && selectedChatType === "direct" && message.id;

    const bubble = document.createElement("div");
    bubble.className = mine ? "message mine" : "message";

    const text = message.text || message.message || "";
    const mediaHtml = renderMedia(message.media);

    bubble.innerHTML = `
      <div class="message-name">${escapeHtml(message.displayName || message.username || "")}</div>
      ${mediaHtml}
      ${text ? `<div class="message-text">${escapeHtml(text)}</div>` : ""}
      <div class="message-time">${formatTime(message.created_at)}</div>
      ${
        canDelete
          ? `<button class="delete-message-btn" data-id="${escapeHtml(message.id)}" title="Удалить сообщение">Удалить</button>`
          : ""
      }
    `;

    const deleteBtn = bubble.querySelector(".delete-message-btn");

    if (deleteBtn) {
      deleteBtn.style.marginTop = "7px";
      deleteBtn.style.background = "rgba(127, 29, 29, 0.65)";
      deleteBtn.style.color = "white";
      deleteBtn.style.borderRadius = "10px";
      deleteBtn.style.padding = "5px 9px";
      deleteBtn.style.fontSize = "11px";
      deleteBtn.style.fontWeight = "700";

      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteMessage(deleteBtn.dataset.id);
      });
    }

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

socket.on("message_deleted", (data) => {
  if (!data || !data.id) return;

  messagesCache = messagesCache.filter((message) => String(message.id) !== String(data.id));

  renderMessages();
  loadRecentChats();
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
  stopTyping();
});

const savedUser = loadSavedUser();

if (savedUser) {
  currentUser = savedUser;
  startApp();
}