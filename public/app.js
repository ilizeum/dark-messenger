let token = localStorage.getItem('dm_token');
let me = null;
let socket = null;
let users = [];
let online = new Set();
let activeUser = null;
let messages = [];

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function setAuthError(text) { $('authError').textContent = text || ''; }

async function register() {
  try {
    setAuthError('');
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: $('displayName').value,
        username: $('username').value,
        password: $('password').value
      })
    });
    loginSuccess(data);
  } catch (e) { setAuthError(e.message); }
}

async function login() {
  try {
    setAuthError('');
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('username').value, password: $('password').value })
    });
    loginSuccess(data);
  } catch (e) { setAuthError(e.message); }
}

function loginSuccess(data) {
  token = data.token;
  me = data.user;
  localStorage.setItem('dm_token', token);
  showApp();
}

async function showApp() {
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('meName').textContent = me.displayName;
  $('meLogin').textContent = '@' + me.username;
  connectSocket();
  await loadUsers();
}

function logout() {
  localStorage.removeItem('dm_token');
  location.reload();
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });
  socket.on('online-users', (ids) => {
    online = new Set(ids);
    renderUsers();
    renderHeader();
  });
  socket.on('new-message', (msg) => {
    if (activeUser && (msg.fromUserId === activeUser.id || msg.toUserId === activeUser.id)) {
      messages.push(msg);
      renderMessages();
    }
  });
}

async function loadUsers() {
  const data = await api('/api/users');
  users = data.users;
  renderUsers();
}

function renderUsers() {
  const query = $('search').value.trim().toLowerCase();
  $('users').innerHTML = '';
  users.filter(u => u.displayName.toLowerCase().includes(query) || u.username.toLowerCase().includes(query)).forEach(user => {
    const btn = document.createElement('button');
    btn.className = 'user' + (activeUser?.id === user.id ? ' active' : '');
    btn.innerHTML = `
      <div class="avatar">${escapeHtml(user.displayName[0] || user.username[0])}</div>
      <div class="user-meta"><div class="user-name">${escapeHtml(user.displayName)}</div><div class="user-login">@${escapeHtml(user.username)}</div></div>
      ${online.has(user.id) ? '<div class="dot"></div>' : ''}
    `;
    btn.onclick = () => openChat(user);
    $('users').appendChild(btn);
  });
}

async function openChat(user) {
  activeUser = user;
  $('messageInput').disabled = false;
  $('sendBtn').disabled = false;
  renderUsers();
  renderHeader();
  const data = await api('/api/messages/' + user.id);
  messages = data.messages;
  renderMessages();
}

function renderHeader() {
  if (!activeUser) return;
  $('chatAvatar').textContent = activeUser.displayName[0] || activeUser.username[0];
  $('chatName').textContent = activeUser.displayName;
  $('chatStatus').textContent = online.has(activeUser.id) ? 'в сети' : 'не в сети';
}

function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  if (!messages.length) {
    box.innerHTML = '<div class="empty">Сообщений пока нет. Напиши первым.</div>';
    return;
  }
  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = 'bubble ' + (msg.fromUserId === me.id ? 'me' : 'them');
    div.innerHTML = `<div>${escapeHtml(msg.text)}</div><div class="time">${formatTime(msg.createdAt)}</div>`;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const input = $('messageInput');
  const text = input.value.trim();
  if (!text || !activeUser) return;
  socket.emit('send-message', { toUserId: activeUser.id, text }, (res) => {
    if (!res?.ok) alert(res?.error || 'Не отправилось');
  });
  input.value = '';
}

function formatTime(dateString) {
  const d = new Date(dateString.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

$('registerBtn').onclick = register;
$('loginBtn').onclick = login;
$('logoutBtn').onclick = logout;
$('sendBtn').onclick = sendMessage;
$('search').oninput = renderUsers;
$('messageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
});

(async function boot() {
  if (!token) return;
  try {
    const data = await api('/api/me');
    me = data.user;
    showApp();
  } catch {
    localStorage.removeItem('dm_token');
    token = null;
  }
})();
