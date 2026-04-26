// ============================================
// VoiceHub - Main Application Logic
// app.js - Modular Firebase Social Chat App
// ============================================

import { initializeApp } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js”;
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js”;
import { getDatabase, ref, set, get, push, onValue, off, remove, update, query, orderByChild, equalTo, serverTimestamp, onDisconnect } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js”;
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js”;

// ===== FIREBASE INIT =====
// TODO: Replace with your Firebase config at firebase/config.js
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCXA1x9fJe6zPFo7yiK1kSRsoR89aSff5k",
  authDomain: "itchat-web-8c4ed.firebaseapp.com",
  databaseURL: "https://itchat-web-8c4ed-default-rtdb.firebaseio.com",
  projectId: "itchat-web-8c4ed",
  storageBucket: "itchat-web-8c4ed.firebasestorage.app",
  messagingSenderId: "787261764804",
  appId: "1:787261764804:web:7af9a924d03989b1dbc591",
  measurementId: "G-1KPE5B71QR"
};

let app, auth, db, storage;
let currentUser = null;
let currentUserData = null;
let currentRoom = null;
let currentChatPartner = null;
let isMicMuted = true;
let isHandRaised = false;
let roomListeners = {};
let allUsersCache = {};
let contextTargetUser = null;

// ===== DEMO MODE (when Firebase is not configured) =====
let demoMode = false;
let demoRooms = {
“demo1”: {
roomId: “demo1”, name: “غرفة الترحيب 🎉”, description: “مرحباً بالجميع!”,
ownerId: “demo1”, ownerName: “أحمد”, type: “public”,
users: { “demo1”: { uid: “demo1”, name: “أحمد”, role: “owner” } },
speakers: { “demo1”: { uid: “demo1”, name: “أحمد” } },
userCount: 3, isLocked: false, createdAt: Date.now()
},
“demo2”: {
roomId: “demo2”, name: “محادثة موسيقى 🎵”, description: “نقاش حول الموسيقى”,
ownerId: “demo2”, ownerName: “سارة”, type: “public”,
users: { “demo2”: { uid: “demo2”, name: “سارة”, role: “owner” } },
speakers: {}, userCount: 7, isLocked: false, createdAt: Date.now()
},
“demo3”: {
roomId: “demo3”, name: “غرفة الألعاب 🎮”, description: “تحدث عن الألعاب”,
ownerId: “demo3”, ownerName: “خالد”, type: “private”,
users: {}, speakers: {}, userCount: 2, isLocked: true, createdAt: Date.now()
}
};
let demoUser = { uid: “user_demo”, name: “مستخدم تجريبي”, bio: “مرحباً بالجميع!”, photoURL: “”, role: “user” };

// ===== INIT =====
try {
app = initializeApp(firebaseConfig);
auth = getAuth(app);
db = getDatabase(app);
storage = getStorage(app);

onAuthStateChanged(auth, async (user) => {
if (user) {
currentUser = user;
await loadUserData(user.uid);
showScreen(‘screen-home’);
loadRooms();
loadChats();
} else {
currentUser = null;
currentUserData = null;
showScreen(‘screen-login’);
}
});
} catch (err) {
console.warn(“Firebase not configured, running in demo mode:”, err.message);
demoMode = true;
initDemoMode();
}

function initDemoMode() {
showToast(“⚠️ وضع العرض التجريبي - قم بإعداد Firebase للوظائف الكاملة”, “error”);
currentUser = { uid: demoUser.uid };
currentUserData = demoUser;
setTimeout(() => {
showScreen(‘screen-login’);
}, 100);
}

// ===== AUTH FUNCTIONS =====
window.switchTab = (tab) => {
document.querySelectorAll(’.auth-tab’).forEach((t, i) => {
t.classList.toggle(‘active’, (tab === ‘login’ && i === 0) || (tab === ‘register’ && i === 1));
});
document.getElementById(‘login-form’).classList.toggle(‘hidden’, tab !== ‘login’);
document.getElementById(‘register-form’).classList.toggle(‘hidden’, tab !== ‘register’);
hideAuthError();
};

window.handleLogin = async () => {
if (demoMode) {
currentUser = { uid: demoUser.uid };
currentUserData = demoUser;
showScreen(‘screen-home’);
loadRoomsDemo();
return;
}
const email = document.getElementById(‘login-email’).value.trim();
const password = document.getElementById(‘login-password’).value;
if (!email || !password) return showAuthError(“الرجاء إدخال البريد الإلكتروني وكلمة المرور”);
try {
await signInWithEmailAndPassword(auth, email, password);
} catch (err) {
showAuthError(getAuthError(err.code));
}
};

window.handleRegister = async () => {
if (demoMode) {
showToast(“يرجى إعداد Firebase لإنشاء حسابات حقيقية”, “error”);
return;
}
const name = document.getElementById(‘reg-name’).value.trim();
const email = document.getElementById(‘reg-email’).value.trim();
const password = document.getElementById(‘reg-password’).value;
if (!name || !email || !password) return showAuthError(“الرجاء ملء جميع الحقول”);
if (password.length < 6) return showAuthError(“كلمة المرور يجب أن تكون 6 أحرف على الأقل”);
try {
const cred = await createUserWithEmailAndPassword(auth, email, password);
await createUserProfile(cred.user.uid, name, email);
} catch (err) {
showAuthError(getAuthError(err.code));
}
};

window.handleLogout = async () => {
if (demoMode) {
showScreen(‘screen-login’);
return;
}
if (currentRoom) await leaveRoom();
await signOut(auth);
};

async function createUserProfile(uid, name, email) {
const userData = {
uid, name, email, bio: “”, photoURL: “”,
roomCreatedId: uid, createdAt: serverTimestamp(), role: “user”
};
await set(ref(db, `users/${uid}`), userData);
}

async function loadUserData(uid) {
const snap = await get(ref(db, `users/${uid}`));
if (snap.exists()) {
currentUserData = snap.val();
updateHeaderAvatar();
} else {
// Create profile if it doesn’t exist
const userData = {
uid, name: “مستخدم”, email: currentUser.email || “”, bio: “”, photoURL: “”,
roomCreatedId: uid, createdAt: Date.now(), role: “user”
};
await set(ref(db, `users/${uid}`), userData);
currentUserData = userData;
}
}

// ===== SCREEN MANAGEMENT =====
window.showScreen = (screenId) => {
document.querySelectorAll(’.screen’).forEach(s => {
s.classList.remove(‘active’);
s.classList.add(‘hidden’);
});
const screen = document.getElementById(screenId);
if (screen) {
screen.classList.remove(‘hidden’);
screen.classList.add(‘active’);
}

// Update nav buttons
document.querySelectorAll(’.nav-btn’).forEach(btn => btn.classList.remove(‘active’));
const navMap = {
‘screen-home’: 0, ‘screen-friends’: 1,
‘screen-messages’: 2, ‘screen-profile’: 3
};
if (navMap[screenId] !== undefined) {
document.querySelectorAll(’.nav-btn’)[navMap[screenId]]?.classList.add(‘active’);
}

// Load screen-specific data
if (screenId === ‘screen-profile’) loadProfileScreen();
if (screenId === ‘screen-friends’) loadFriendsScreen();
if (screenId === ‘screen-messages’) loadChats();
};

// ===== ROOMS =====
window.showCreateRoom = () => {
document.getElementById(‘new-room-name’).value = ‘’;
document.getElementById(‘new-room-desc’).value = ‘’;
document.querySelector(‘input[name=“room-type”][value=“public”]’).checked = true;
document.getElementById(‘room-password-wrapper’).classList.add(‘hidden’);
showModal(‘modal-create-room’);

// Show/hide password field
document.querySelectorAll(‘input[name=“room-type”]’).forEach(r => {
r.onchange = () => {
document.getElementById(‘room-password-wrapper’).classList.toggle(‘hidden’, r.value !== ‘private’);
};
});
};

window.createRoom = async () => {
const name = document.getElementById(‘new-room-name’).value.trim();
if (!name) return showToast(“أدخل اسم الغرفة”, “error”);
const desc = document.getElementById(‘new-room-desc’).value.trim();
const type = document.querySelector(‘input[name=“room-type”]:checked’).value;
const password = type === ‘private’ ? document.getElementById(‘new-room-password’).value : ‘’;
const roomId = currentUser.uid;

if (demoMode) {
demoRooms[roomId] = {
roomId, name, description: desc, ownerId: currentUser.uid,
ownerName: currentUserData.name, type, isLocked: false,
users: {}, speakers: {}, userCount: 0, createdAt: Date.now()
};
hideModal(‘modal-create-room’);
showToast(“✅ تم إنشاء الغرفة”, “success”);
loadRoomsDemo();
return;
}

try {
const roomData = {
roomId, name, description: desc, ownerId: currentUser.uid,
ownerName: currentUserData.name, type, isLocked: false,
password: password, moderators: {}, createdAt: serverTimestamp()
};
await set(ref(db, `rooms/${roomId}`), roomData);
hideModal(‘modal-create-room’);
showToast(“✅ تم إنشاء الغرفة”, “success”);
await joinRoom(roomId);
} catch (err) {
showToast(“فشل إنشاء الغرفة: “ + err.message, “error”);
}
};

function loadRooms() {
if (demoMode) { loadRoomsDemo(); return; }
const roomsRef = ref(db, ‘rooms’);
onValue(roomsRef, (snap) => {
const rooms = snap.val() || {};
renderRooms(Object.values(rooms));
});
}

function loadRoomsDemo() {
renderRooms(Object.values(demoRooms));
}

let currentRoomFilter = ‘all’;
window.filterRooms = (filter) => {
currentRoomFilter = filter;
document.querySelectorAll(’.room-tab’).forEach((t, i) => {
t.classList.toggle(‘active’, [‘all’,‘public’,‘private’][i] === filter);
});
if (demoMode) loadRoomsDemo();
};

function renderRooms(rooms) {
const list = document.getElementById(‘rooms-list’);
let filtered = rooms;
if (currentRoomFilter !== ‘all’) filtered = rooms.filter(r => r.type === currentRoomFilter);

if (!filtered.length) {
list.innerHTML = `<div class="empty-state"><span>🏠</span><p>لا توجد غرف بعد</p><small>كن أول من ينشئ غرفة!</small></div>`;
return;
}

list.innerHTML = filtered.map(room => {
const userCount = room.users ? Object.keys(room.users).length : (room.userCount || 0);
return `<div class="room-card" onclick="joinRoom('${room.roomId}')"> <div class="room-card-header"> <div class="room-card-name">${escapeHtml(room.name)}</div> <div class="room-card-badges"> <span class="badge-type badge-${room.type}">${room.type === 'public' ? '🌍 عامة' : '🔒 خاصة'}</span> ${room.isLocked ? '<span class="badge-type" style="background:rgba(255,209,102,0.15);color:var(--warning);border:1px solid var(--warning)">🔐 مغلقة</span>' : ''} </div> </div> ${room.description ?`<div class="room-card-desc">${escapeHtml(room.description)}</div>` : ''} <div class="room-card-footer"> <div class="room-card-owner"> <div class="room-card-owner-avatar">👤</div> <span>${escapeHtml(room.ownerName || 'مجهول')}</span> </div> <div class="room-users">👥 ${userCount} مستخدم</div> </div> </div>`;
}).join(’’);
}

window.joinRoom = async (roomId) => {
if (demoMode) {
currentRoom = demoRooms[roomId] || null;
if (!currentRoom) return showToast(“الغرفة غير موجودة”, “error”);
renderRoomScreen(currentRoom);
showScreen(‘screen-room’);
return;
}

try {
const snap = await get(ref(db, `rooms/${roomId}`));
if (!snap.exists()) return showToast(“الغرفة غير موجودة”, “error”);
const room = snap.val();

```
if (room.isLocked && room.ownerId !== currentUser.uid) {
  const pass = prompt("🔑 أدخل كلمة مرور الغرفة:");
  if (pass !== room.password) return showToast("❌ كلمة مرور خاطئة", "error");
}

currentRoom = room;

// Add user to room
const userInRoom = {
  uid: currentUser.uid,
  name: currentUserData.name,
  photoURL: currentUserData.photoURL || '',
  role: room.ownerId === currentUser.uid ? 'owner' : 'user',
  joinedAt: serverTimestamp()
};
await set(ref(db, `rooms/${roomId}/users/${currentUser.uid}`), userInRoom);

// Setup disconnect handler
await onDisconnect(ref(db, `rooms/${roomId}/users/${currentUser.uid}`)).remove();
await onDisconnect(ref(db, `rooms/${roomId}/speakers/${currentUser.uid}`)).remove();

renderRoomScreen(room);
showScreen('screen-room');
listenToRoom(roomId);
```

} catch (err) {
showToast(“فشل الانضمام: “ + err.message, “error”);
}
};

function renderRoomScreen(room) {
document.getElementById(‘room-title’).textContent = room.name;
document.getElementById(‘room-subtitle’).textContent = `0 مستخدم`;

const isOwnerOrAdmin = room.ownerId === currentUser?.uid ||
(room.moderators && room.moderators[currentUser?.uid]);
document.getElementById(‘room-menu-toggle’).classList.toggle(‘hidden’, !isOwnerOrAdmin);

if (demoMode) {
renderSpeakers(room.speakers || {});
renderListeners(room.users || {});
}
}

function listenToRoom(roomId) {
// Clear old listeners
Object.values(roomListeners).forEach(unsub => unsub && unsub());
roomListeners = {};

// Listen to users
const usersRef = ref(db, `rooms/${roomId}/users`);
roomListeners.users = onValue(usersRef, (snap) => {
const users = snap.val() || {};
const count = Object.keys(users).length;
document.getElementById(‘room-subtitle’).textContent = `${count} مستخدم`;
listenToSpeakers(roomId, users);
});

// Listen to messages
const msgsRef = ref(db, `roomMessages/${roomId}`);
roomListeners.messages = onValue(msgsRef, (snap) => {
const msgs = snap.val() || {};
renderRoomMessages(Object.values(msgs).sort((a, b) => a.timestamp - b.timestamp));
});
}

function listenToSpeakers(roomId, allUsers) {
if (roomListeners.speakers) roomListeners.speakers();
const speakersRef = ref(db, `rooms/${roomId}/speakers`);
roomListeners.speakers = onValue(speakersRef, (snap) => {
const speakers = snap.val() || {};
const speakerUids = Object.keys(speakers);
const listeners = {};
Object.entries(allUsers).forEach(([uid, user]) => {
if (!speakerUids.includes(uid)) listeners[uid] = user;
});
renderSpeakers(speakers);
renderListeners(listeners);
});
}

function renderSpeakers(speakers) {
const grid = document.getElementById(‘speakers-grid’);
const entries = Object.entries(speakers);
if (!entries.length) {
grid.innerHTML = ‘<p style="color:var(--text-secondary);font-size:13px;text-align:center;padding:12px">لا يوجد متحدثون</p>’;
return;
}
grid.innerHTML = entries.map(([uid, user]) => buildSeatHTML(uid, user, ‘speaker’)).join(’’);
}

function renderListeners(listeners) {
const grid = document.getElementById(‘listeners-grid’);
const entries = Object.entries(listeners);
if (!entries.length) {
grid.innerHTML = ‘<p style="color:var(--text-secondary);font-size:13px;text-align:center;padding:12px">لا يوجد مستمعون</p>’;
return;
}
grid.innerHTML = entries.map(([uid, user]) => buildSeatHTML(uid, user, ‘listener’)).join(’’);
}

function buildSeatHTML(uid, user, seatType) {
const isOwner = currentRoom && currentRoom.ownerId === uid;
const isMuted = user.isMuted;
const avatarClass = `seat-avatar ${isOwner ? 'owner' : ''} ${isMuted ? 'muted' : ''}`;
const avatarContent = user.photoURL
? `<img src="${user.photoURL}" alt="" onerror="this.parentNode.textContent='👤'">`
: ‘👤’;
return `

  <div class="user-seat" onclick="showUserContext('${uid}', '${escapeHtml(user.name || 'مستخدم')}')">
    <div class="${avatarClass}">
      ${avatarContent}
      <div class="seat-mic-icon">${seatType === 'speaker' ? (isMuted ? '🔇' : '🎤') : '👂'}</div>
    </div>
    <span class="seat-name">${escapeHtml(user.name || 'مستخدم')}</span>
    ${isOwner ? '<span class="seat-role">👑 المالك</span>' : ''}
  </div>`;
}

window.leaveRoom = async () => {
if (!currentRoom) { showScreen(‘screen-home’); return; }
if (!demoMode && currentUser) {
try {
await remove(ref(db, `rooms/${currentRoom.roomId}/users/${currentUser.uid}`));
await remove(ref(db, `rooms/${currentRoom.roomId}/speakers/${currentUser.uid}`));
} catch (e) {}
}
Object.values(roomListeners).forEach(unsub => unsub && unsub());
roomListeners = {};
currentRoom = null;
isMicMuted = true;
isHandRaised = false;
updateMicUI();
showScreen(‘screen-home’);
};

window.toggleRoomMenu = () => {
document.getElementById(‘room-admin-menu’).classList.toggle(‘hidden’);
};

window.closeRoom = async () => {
if (!currentRoom) return;
if (!confirm(‘هل تريد إغلاق الغرفة نهائياً؟’)) return;
if (demoMode) {
delete demoRooms[currentRoom.roomId];
leaveRoom();
return;
}
if (currentRoom.ownerId !== currentUser.uid) return showToast(“فقط المالك يمكنه إغلاق الغرفة”, “error”);
try {
await remove(ref(db, `rooms/${currentRoom.roomId}`));
await remove(ref(db, `roomMessages/${currentRoom.roomId}`));
leaveRoom();
showToast(“تم إغلاق الغرفة”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

window.toggleRoomLock = async () => {
if (!currentRoom) return;
const newLock = !currentRoom.isLocked;
if (demoMode) {
demoRooms[currentRoom.roomId].isLocked = newLock;
currentRoom.isLocked = newLock;
document.getElementById(‘lock-btn-text’).textContent = newLock ? ‘فتح الغرفة’ : ‘قفل الغرفة’;
showToast(newLock ? “تم قفل الغرفة 🔒” : “تم فتح الغرفة 🔓”, “success”);
return;
}
try {
await update(ref(db, `rooms/${currentRoom.roomId}`), { isLocked: newLock });
currentRoom.isLocked = newLock;
document.getElementById(‘lock-btn-text’).textContent = newLock ? ‘فتح الغرفة’ : ‘قفل الغرفة’;
showToast(newLock ? “تم قفل الغرفة 🔒” : “تم فتح الغرفة 🔓”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

// ===== MIC CONTROLS =====
window.toggleMic = () => {
if (!currentRoom) return;
isMicMuted = !isMicMuted;
updateMicUI();

if (!demoMode && currentUser && currentRoom) {
const speakersRef = ref(db, `rooms/${currentRoom.roomId}/speakers/${currentUser.uid}`);
if (isMicMuted) {
remove(speakersRef);
} else {
set(speakersRef, {
uid: currentUser.uid,
name: currentUserData.name,
photoURL: currentUserData.photoURL || ‘’,
isMuted: false
});
}
}
showToast(isMicMuted ? “🔇 الميكروفون مكتوم” : “🎤 الميكروفون مفعّل”, “”);
};

function updateMicUI() {
const btn = document.getElementById(‘mic-btn’);
const icon = document.getElementById(‘mic-icon’);
btn.classList.toggle(‘muted’, isMicMuted);
icon.textContent = isMicMuted ? ‘🔇’ : ‘🎤’;
}

window.raiseHand = () => {
isHandRaised = !isHandRaised;
const btn = document.getElementById(‘hand-btn’);
btn.classList.toggle(‘raised’, isHandRaised);
btn.textContent = isHandRaised ? ‘✋ تم رفع اليد’ : ‘✋ رفع يد’;
if (isHandRaised) showToast(“✋ تم رفع يدك - انتظر إذن المشرف”, “”);
};

// ===== ROOM MESSAGES =====
window.sendRoomMessage = async () => {
const input = document.getElementById(‘room-msg-input’);
const text = input.value.trim();
if (!text || !currentRoom) return;
input.value = ‘’;

const msg = {
from: currentUser.uid,
name: currentUserData.name,
photoURL: currentUserData.photoURL || ‘’,
text, timestamp: Date.now()
};

if (demoMode) {
appendRoomMessage(msg);
return;
}
try {
await push(ref(db, `roomMessages/${currentRoom.roomId}`), msg);
} catch (e) { showToast(e.message, “error”); }
};

function renderRoomMessages(msgs) {
const container = document.getElementById(‘room-messages’);
container.innerHTML = ‘’;
msgs.forEach(msg => appendRoomMessage(msg, false));
container.scrollTop = container.scrollHeight;
}

function appendRoomMessage(msg, scroll = true) {
const container = document.getElementById(‘room-messages’);
const isMe = msg.from === currentUser?.uid;
const div = document.createElement(‘div’);
div.className = ‘room-msg’;
div.innerHTML = `<div class="room-msg-avatar"> ${msg.photoURL ?`<img src="${msg.photoURL}" onerror="this.parentNode.textContent='👤'">` : '👤'} </div> <div class="room-msg-content"> <div class="room-msg-name" style="color:${isMe ? 'var(--accent-2)' : 'var(--accent)'}">${escapeHtml(msg.name)}</div> <div class="room-msg-text">${escapeHtml(msg.text)}</div> </div>`;
container.appendChild(div);
if (scroll) container.scrollTop = container.scrollHeight;
}

// ===== USER CONTEXT MENU =====
window.showUserContext = (uid, name) => {
contextTargetUser = uid;
const isAdminOrOwner = currentRoom && (
currentRoom.ownerId === currentUser?.uid ||
(currentRoom.moderators && currentRoom.moderators[currentUser?.uid])
);
document.getElementById(‘context-user-info’).textContent = `👤 ${name}`;
document.getElementById(‘admin-context-actions’).classList.toggle(‘hidden’, !isAdminOrOwner || uid === currentUser?.uid);
document.getElementById(‘user-context-menu’).classList.remove(‘hidden’);
};

window.hideContextMenu = () => {
document.getElementById(‘user-context-menu’).classList.add(‘hidden’);
contextTargetUser = null;
};

window.contextSendMessage = async () => {
hideContextMenu();
if (!contextTargetUser) return;
await openPrivateChat(contextTargetUser);
};

window.contextAddFriend = async () => {
hideContextMenu();
if (!contextTargetUser || demoMode) return showToast(“إضافة الأصدقاء تتطلب Firebase”, “”);
await sendFriendRequest(contextTargetUser);
};

window.contextMakeAdmin = async () => {
hideContextMenu();
if (!currentRoom || !contextTargetUser) return;
if (demoMode) return showToast(“تم تعيين المشرف (تجريبي)”, “success”);
try {
await set(ref(db, `rooms/${currentRoom.roomId}/moderators/${contextTargetUser}`), true);
showToast(“✅ تم تعيين المشرف”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

window.contextMoveToSpeaker = async () => {
hideContextMenu();
if (!currentRoom || !contextTargetUser) return;
if (demoMode) { showToast(“تم نقله للمتحدثين (تجريبي)”, “success”); return; }
try {
const snap = await get(ref(db, `rooms/${currentRoom.roomId}/users/${contextTargetUser}`));
if (snap.exists()) {
await set(ref(db, `rooms/${currentRoom.roomId}/speakers/${contextTargetUser}`), snap.val());
}
showToast(“✅ تم النقل للمتحدثين”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

window.contextMoveToListener = async () => {
hideContextMenu();
if (!currentRoom || !contextTargetUser) return;
if (demoMode) { showToast(“تم نقله للمستمعين (تجريبي)”, “success”); return; }
try {
await remove(ref(db, `rooms/${currentRoom.roomId}/speakers/${contextTargetUser}`));
showToast(“✅ تم النقل للمستمعين”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

window.contextKickUser = async () => {
hideContextMenu();
if (!currentRoom || !contextTargetUser) return;
if (demoMode) { showToast(“تم طرده (تجريبي)”, “success”); return; }
try {
await remove(ref(db, `rooms/${currentRoom.roomId}/users/${contextTargetUser}`));
await remove(ref(db, `rooms/${currentRoom.roomId}/speakers/${contextTargetUser}`));
showToast(“✅ تم الطرد”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

// ===== PRIVATE CHAT =====
async function openPrivateChat(partnerUid) {
if (!partnerUid) return;
let partnerData = allUsersCache[partnerUid];
if (!partnerData && !demoMode) {
try {
const snap = await get(ref(db, `users/${partnerUid}`));
if (snap.exists()) {
partnerData = snap.val();
allUsersCache[partnerUid] = partnerData;
}
} catch (e) {}
}
if (!partnerData) partnerData = { name: “مستخدم”, photoURL: “” };

currentChatPartner = { uid: partnerUid, …partnerData };
document.getElementById(‘chat-partner-name’).textContent = partnerData.name;

const chatAvatar = document.getElementById(‘chat-avatar’);
chatAvatar.innerHTML = partnerData.photoURL
? `<img src="${partnerData.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentNode.textContent='👤'">`
: ‘👤’;

showScreen(‘screen-private-chat’);
loadPrivateMessages(partnerUid);
}

function getChatId(uid1, uid2) {
return [uid1, uid2].sort().join(’_’);
}

function loadPrivateMessages(partnerUid) {
const chatId = getChatId(currentUser.uid, partnerUid);
const container = document.getElementById(‘private-messages’);
container.innerHTML = ‘’;

if (demoMode) return;

const msgsRef = ref(db, `messages/${chatId}`);
onValue(msgsRef, (snap) => {
const msgs = snap.val() || {};
container.innerHTML = ‘’;
Object.values(msgs)
.sort((a, b) => a.timestamp - b.timestamp)
.forEach(msg => {
const isMe = msg.from === currentUser.uid;
const div = document.createElement(‘div’);
div.className = `msg-bubble ${isMe ? 'sent' : 'received'}`;
div.innerHTML = `${escapeHtml(msg.text)}<div class="msg-time">${formatTime(msg.timestamp)}</div>`;
container.appendChild(div);
});
container.scrollTop = container.scrollHeight;
});
}

window.sendPrivateMessage = async () => {
const input = document.getElementById(‘private-msg-input’);
const text = input.value.trim();
if (!text || !currentChatPartner) return;
input.value = ‘’;

const msg = { from: currentUser.uid, text, timestamp: Date.now() };

if (demoMode) {
const div = document.createElement(‘div’);
div.className = ‘msg-bubble sent’;
div.innerHTML = `${escapeHtml(text)}<div class="msg-time">${formatTime(Date.now())}</div>`;
document.getElementById(‘private-messages’).appendChild(div);
document.getElementById(‘private-messages’).scrollTop = 99999;
return;
}

const chatId = getChatId(currentUser.uid, currentChatPartner.uid);
try {
await push(ref(db, `messages/${chatId}`), msg);
// Update chat preview
await set(ref(db, `userChats/${currentUser.uid}/${currentChatPartner.uid}`), {
partnerUid: currentChatPartner.uid,
partnerName: currentChatPartner.name,
partnerPhoto: currentChatPartner.photoURL || ‘’,
lastMessage: text, timestamp: Date.now()
});
await set(ref(db, `userChats/${currentChatPartner.uid}/${currentUser.uid}`), {
partnerUid: currentUser.uid,
partnerName: currentUserData.name,
partnerPhoto: currentUserData.photoURL || ‘’,
lastMessage: text, timestamp: Date.now()
});
} catch (e) { showToast(e.message, “error”); }
};

function loadChats() {
if (demoMode) return;
const chatsRef = ref(db, `userChats/${currentUser.uid}`);
onValue(chatsRef, (snap) => {
const chats = snap.val() || {};
const container = document.getElementById(‘chats-list’);
const chatList = Object.values(chats).sort((a, b) => b.timestamp - a.timestamp);
if (!chatList.length) {
container.innerHTML = `<div class="empty-state"><span>💬</span><p>لا توجد محادثات بعد</p><small>ابدأ محادثة من قائمة الأصدقاء</small></div>`;
return;
}
container.innerHTML = chatList.map(chat => `<div class="chat-item" onclick="openPrivateChat('${chat.partnerUid}')"> <div class="chat-item-avatar"> ${chat.partnerPhoto ?`<img src="${chat.partnerPhoto}" onerror="this.textContent='👤'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '👤'} </div> <div class="chat-item-info"> <div class="chat-item-name">${escapeHtml(chat.partnerName)}</div> <div class="chat-item-preview">${escapeHtml(chat.lastMessage)}</div> </div> <div class="chat-item-time">${formatTime(chat.timestamp)}</div> </div>`).join(’’);
});
}

// ===== FRIENDS =====
window.switchFriendTab = (tab) => {
[‘list’, ‘requests’, ‘search’].forEach((t, i) => {
document.querySelectorAll(’.friend-tab’)[i].classList.toggle(‘active’, t === tab);
document.getElementById(`${t === 'list' ? 'friends-list' : t}-tab`).classList.toggle(‘hidden’, t !== tab);
});
};

function loadFriendsScreen() {
if (demoMode) {
document.getElementById(‘friends-list’).innerHTML = `<div class="empty-state"><span>👥</span><p>لا يوجد أصدقاء في الوضع التجريبي</p></div>`;
return;
}
loadFriendsList();
loadFriendRequests();
}

function loadFriendsList() {
const friendsRef = ref(db, `friends/${currentUser.uid}`);
onValue(friendsRef, async (snap) => {
const friends = snap.val() || {};
const accepted = Object.entries(friends).filter(([, f]) => f.status === ‘accepted’);
const container = document.getElementById(‘friends-list’);
if (!accepted.length) {
container.innerHTML = `<div class="empty-state"><span>👥</span><p>لا يوجد أصدقاء بعد</p></div>`;
return;
}
const cards = await Promise.all(accepted.map(async ([uid]) => {
let user = allUsersCache[uid];
if (!user) {
const s = await get(ref(db, `users/${uid}`));
user = s.val() || { name: “مستخدم”, bio: “” };
allUsersCache[uid] = user;
}
return `<div class="friend-card"> <div class="friend-avatar">${user.photoURL ?`<img src="${user.photoURL}" onerror="this.parentNode.textContent='👤'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '👤'}</div> <div class="friend-info"> <div class="friend-name">${escapeHtml(user.name)}</div> <div class="friend-bio">${escapeHtml(user.bio || '')}</div> </div> <div class="friend-actions"> <button class="friend-btn msg" onclick="openPrivateChat('${uid}')">💬</button> </div> </div>`;
}));
container.innerHTML = cards.join(’’);
document.getElementById(‘stat-friends’).textContent = accepted.length;
});
}

function loadFriendRequests() {
const reqRef = ref(db, `friendRequests/${currentUser.uid}`);
onValue(reqRef, async (snap) => {
const reqs = snap.val() || {};
const pending = Object.entries(reqs).filter(([, r]) => r.status === ‘pending’);
const badge = document.getElementById(‘req-count’);
if (pending.length) {
badge.textContent = pending.length;
badge.classList.remove(‘hidden’);
} else {
badge.classList.add(‘hidden’);
}
const container = document.getElementById(‘requests-list’);
if (!pending.length) {
container.innerHTML = `<div class="empty-state"><span>📬</span><p>لا توجد طلبات معلقة</p></div>`;
return;
}
const cards = await Promise.all(pending.map(async ([senderUid, req]) => {
let user = allUsersCache[senderUid];
if (!user) {
const s = await get(ref(db, `users/${senderUid}`));
user = s.val() || { name: req.senderName || “مستخدم”, bio: “” };
allUsersCache[senderUid] = user;
}
return `<div class="friend-card"> <div class="friend-avatar">${user.photoURL ?`<img src="${user.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '👤'}</div> <div class="friend-info"> <div class="friend-name">${escapeHtml(user.name)}</div> <div class="friend-bio">طلب صداقة</div> </div> <div class="friend-actions"> <button class="friend-btn accept" onclick="acceptFriend('${senderUid}')">✓</button> <button class="friend-btn reject" onclick="rejectFriend('${senderUid}')">✕</button> </div> </div>`;
}));
container.innerHTML = cards.join(’’);
});
}

async function sendFriendRequest(targetUid) {
if (demoMode) return showToast(“يتطلب Firebase”, “”);
try {
await set(ref(db, `friendRequests/${targetUid}/${currentUser.uid}`), {
senderUid: currentUser.uid,
senderName: currentUserData.name,
status: ‘pending’,
timestamp: Date.now()
});
await set(ref(db, `friends/${currentUser.uid}/${targetUid}`), {
status: ‘sent’, timestamp: Date.now()
});
showToast(“✅ تم إرسال طلب الصداقة”, “success”);
} catch (e) { showToast(e.message, “error”); }
}

window.acceptFriend = async (senderUid) => {
try {
await set(ref(db, `friends/${currentUser.uid}/${senderUid}`), { status: ‘accepted’, timestamp: Date.now() });
await set(ref(db, `friends/${senderUid}/${currentUser.uid}`), { status: ‘accepted’, timestamp: Date.now() });
await remove(ref(db, `friendRequests/${currentUser.uid}/${senderUid}`));
showToast(“✅ تم قبول طلب الصداقة”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

window.rejectFriend = async (senderUid) => {
try {
await remove(ref(db, `friendRequests/${currentUser.uid}/${senderUid}`));
await remove(ref(db, `friends/${currentUser.uid}/${senderUid}`));
showToast(“تم رفض الطلب”, “”);
} catch (e) { showToast(e.message, “error”); }
};

window.searchUsers = async () => {
const q = document.getElementById(‘search-user-input’).value.trim().toLowerCase();
const container = document.getElementById(‘search-results’);
if (!q) return;

if (demoMode) {
container.innerHTML = `<div class="empty-state"><span>🔍</span><p>البحث يتطلب Firebase</p></div>`;
return;
}

container.innerHTML = ‘<div class="loading-rooms"><div class="pulse-loader"></div><p>جارٍ البحث…</p></div>’;
try {
const snap = await get(ref(db, ‘users’));
const users = snap.val() || {};
const results = Object.values(users).filter(u =>
u.uid !== currentUser.uid &&
(u.name?.toLowerCase().includes(q) || u.uid?.toLowerCase().includes(q))
);

```
if (!results.length) {
  container.innerHTML = `<div class="empty-state"><span>🔍</span><p>لا توجد نتائج</p></div>`;
  return;
}

container.innerHTML = results.map(user => `
<div class="friend-card">
  <div class="friend-avatar">${user.photoURL ? `<img src="${user.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '👤'}</div>
  <div class="friend-info">
    <div class="friend-name">${escapeHtml(user.name)}</div>
    <div class="friend-bio">${escapeHtml(user.bio || 'لا توجد نبذة')}</div>
  </div>
  <div class="friend-actions">
    <button class="friend-btn add" onclick="sendFriendRequest('${user.uid}')">➕</button>
    <button class="friend-btn msg" onclick="openPrivateChat('${user.uid}')">💬</button>
  </div>
</div>`).join('');
```

} catch (e) { showToast(e.message, “error”); }
};

// ===== PROFILE =====
function loadProfileScreen() {
if (!currentUser || !currentUserData) return;
document.getElementById(‘profile-uid’).textContent = currentUser.uid;
document.getElementById(‘profile-name’).value = currentUserData.name || ‘’;
document.getElementById(‘profile-bio’).value = currentUserData.bio || ‘’;

const img = document.getElementById(‘profile-img’);
const placeholder = document.getElementById(‘profile-avatar-placeholder’);
if (currentUserData.photoURL) {
img.src = currentUserData.photoURL;
img.style.display = ‘block’;
placeholder.style.display = ‘none’;
} else {
img.style.display = ‘none’;
placeholder.style.display = ‘flex’;
}

updateHeaderAvatar();
}

window.saveProfile = async () => {
const name = document.getElementById(‘profile-name’).value.trim();
const bio = document.getElementById(‘profile-bio’).value.trim();
if (!name) return showToast(“أدخل اسمك”, “error”);

if (demoMode) {
demoUser.name = name;
demoUser.bio = bio;
currentUserData = demoUser;
showToast(“✅ تم حفظ الملف الشخصي”, “success”);
return;
}

try {
await update(ref(db, `users/${currentUser.uid}`), { name, bio });
currentUserData.name = name;
currentUserData.bio = bio;
showToast(“✅ تم حفظ التغييرات”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

window.triggerAvatarUpload = () => {
document.getElementById(‘avatar-upload’).click();
};

window.uploadAvatar = async (event) => {
const file = event.target.files[0];
if (!file) return;
if (file.size > 5 * 1024 * 1024) return showToast(“الصورة كبيرة جداً (5MB كحد أقصى)”, “error”);

if (demoMode) {
const reader = new FileReader();
reader.onload = (e) => {
demoUser.photoURL = e.target.result;
currentUserData.photoURL = e.target.result;
loadProfileScreen();
showToast(“✅ تم تحديث الصورة (تجريبي)”, “success”);
};
reader.readAsDataURL(file);
return;
}

showToast(“⏳ جارٍ رفع الصورة…”, “”);
try {
const fileRef = storageRef(storage, `avatars/${currentUser.uid}`);
await uploadBytes(fileRef, file);
const url = await getDownloadURL(fileRef);
await update(ref(db, `users/${currentUser.uid}`), { photoURL: url });
currentUserData.photoURL = url;
loadProfileScreen();
showToast(“✅ تم تحديث الصورة”, “success”);
} catch (e) { showToast(e.message, “error”); }
};

window.copyUID = () => {
const uid = currentUser?.uid;
if (!uid) return;
navigator.clipboard.writeText(uid).then(() => showToast(“✅ تم نسخ المعرف”, “success”));
};

function updateHeaderAvatar() {
const avatar = document.getElementById(‘header-avatar’);
if (currentUserData?.photoURL) {
avatar.src = currentUserData.photoURL;
avatar.style.display = ‘block’;
avatar.nextElementSibling.style.display = ‘none’;
}
}

// ===== MODALS =====
window.showModal = (id) => document.getElementById(id).classList.remove(‘hidden’);
window.hideModal = (id) => document.getElementById(id).classList.add(‘hidden’);
window.showAddModerator = () => showToast(“اضغط على مستخدم في الغرفة لتعيينه مشرفاً”, “”);

// ===== UTILITIES =====
function showAuthError(msg) {
const el = document.getElementById(‘auth-error’);
el.textContent = msg;
el.classList.remove(‘hidden’);
}
function hideAuthError() {
document.getElementById(‘auth-error’).classList.add(‘hidden’);
}

window.showToast = (msg, type = ‘’) => {
const toast = document.getElementById(‘toast’);
toast.textContent = msg;
toast.className = `toast ${type}`;
clearTimeout(window._toastTimer);
window._toastTimer = setTimeout(() => toast.classList.add(‘hidden’), 3000);
};

function getAuthError(code) {
const errors = {
‘auth/user-not-found’: ‘البريد الإلكتروني غير مسجل’,
‘auth/wrong-password’: ‘كلمة المرور خاطئة’,
‘auth/email-already-in-use’: ‘البريد الإلكتروني مستخدم بالفعل’,
‘auth/invalid-email’: ‘البريد الإلكتروني غير صالح’,
‘auth/weak-password’: ‘كلمة المرور ضعيفة جداً’,
‘auth/network-request-failed’: ‘فشل الاتصال بالإنترنت’,
‘auth/too-many-requests’: ‘محاولات كثيرة، حاول لاحقاً’
};
return errors[code] || `خطأ: ${code}`;
}

function escapeHtml(str) {
if (!str) return ‘’;
return str.toString()
.replace(/&/g, ‘&’)
.replace(/</g, ‘<’)
.replace(/>/g, ‘>’)
.replace(/”/g, ‘"’);
}

function formatTime(ts) {
if (!ts) return ‘’;
const d = new Date(ts);
return d.toLocaleTimeString(‘ar’, { hour: ‘2-digit’, minute: ‘2-digit’ });
}

// Close context menu on outside click
document.addEventListener(‘click’, (e) => {
const menu = document.getElementById(‘user-context-menu’);
if (!menu.classList.contains(‘hidden’) && !menu.contains(e.target)) {
hideContextMenu();
}
});

// Allow Enter key in room message input
document.getElementById(‘room-msg-input’)?.addEventListener(‘keypress’, (e) => {
if (e.key === ‘Enter’) sendRoomMessage();
});

console.log(‘🎙️ VoiceHub loaded successfully!’);
