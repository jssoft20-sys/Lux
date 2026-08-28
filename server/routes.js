'use strict';
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const multer = require('multer');
const DB = require('./db');
const S = require('./service');
const { hash, COLORS } = require('./seed');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || guessExt(file.mimetype);
    cb(null, DB.id('f') + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

function guessExt(mime) {
  const map = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
    'video/webm': '.webm', 'video/mp4': '.mp4' };
  return map[mime] || '';
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const me = S.userByToken(token);
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  req.me = me;
  next();
}

function register(app, io, hub) {
  const emitToUser = hub.emitToUser;

  /* ---------------- auth ---------------- */
  app.post('/api/auth/register', (req, res) => {
    const { name, lastName, username, phone, password } = req.body || {};
    if (!name || !username || !password) return res.status(400).json({ error: 'name, username, password required' });
    const uname = String(username).replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(uname)) return res.status(400).json({ error: 'username must be 3-32 chars: a-z, 0-9, _' });
    if (DB.find('users', (u) => u.username.toLowerCase() === uname)) return res.status(409).json({ error: 'username taken' });
    const u = DB.insert('users', {
      id: DB.id('u'), name, lastName: lastName || '', username: uname, phone: phone || '',
      avatar: null, color: COLORS[DB.all('users').length % COLORS.length], bio: '', birthday: '',
      online: true, lastSeen: S.now(), isBot: false, verified: false, premium: false, botInfo: null,
      password: hash(password),
      privacy: { phone: 'nobody', lastSeen: 'everybody', profilePhoto: 'everybody', bio: 'everybody',
        gifts: 'everybody', birthday: 'contacts', savedMusic: 'everybody', forwards: 'everybody',
        calls: 'everybody', voiceMessages: 'everybody', messages: 'everybody', invites: 'contacts' },
    });
    S.ensureSavedChat(u.id);
    const token = issueSession(u, req);
    res.json({ token, user: S.publicUser(u) });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const uname = String(username || '').replace(/^@/, '').toLowerCase();
    const u = DB.find('users', (x) => x.username.toLowerCase() === uname && !x.isBot);
    if (!u || u.password !== hash(password || '')) return res.status(401).json({ error: 'wrong username or password' });
    S.ensureSavedChat(u.id);
    const token = issueSession(u, req);
    res.json({ token, user: S.publicUser(u) });
  });

  function issueSession(u, req) {
    const token = 't_' + DB.id('s');
    const ua = req.headers['user-agent'] || '';
    DB.insert('sessions', { token, userId: u.id, device: deviceName(ua), app: appName(ua),
      ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0],
      location: 'Local network', ts: S.now(), current: true });
    return token;
  }

  app.post('/api/auth/logout', auth, (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    DB.remove('sessions', (s) => s.token === token);
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => {
    const u = req.me;
    res.json({ user: Object.assign(S.publicUser(u), { privacy: u.privacy, phone: u.phone || '' }) });
  });

  app.patch('/api/me', auth, (req, res) => {
    const allowed = ['name', 'lastName', 'bio', 'birthday', 'color', 'avatar', 'premium'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    if (req.body && req.body.username) {
      const uname = String(req.body.username).replace(/^@/, '').toLowerCase();
      if (uname !== req.me.username) {
        if (!/^[a-z0-9_]{3,32}$/.test(uname)) return res.status(400).json({ error: 'bad username' });
        if (DB.find('users', (u) => u.username.toLowerCase() === uname)) return res.status(409).json({ error: 'username taken' });
        patch.username = uname;
      }
    }
    DB.update('users', req.me.id, patch);
    res.json({ user: S.publicUser(DB.byId('users', req.me.id)) });
  });

  app.patch('/api/me/privacy', auth, (req, res) => {
    const privacy = Object.assign({}, req.me.privacy, req.body || {});
    DB.update('users', req.me.id, { privacy });
    res.json({ privacy });
  });

  /* ---------------- users / contacts ---------------- */
  app.get('/api/users/:id', auth, (req, res) => {
    const u = DB.byId('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json({ user: S.publicUser(u) });
  });

  // directory of discoverable people (non-bots, excluding self)
  app.get('/api/directory', auth, (req, res) => {
    const users = DB.filter('users', (u) => u.id !== req.me.id && !u.isBot).map(S.publicUser);
    const bots = DB.filter('users', (u) => u.isBot).map(S.publicUser);
    res.json({ users, bots });
  });

  app.get('/api/contacts', auth, (req, res) => {
    const contacts = DB.filter('contacts', (c) => c.ownerId === req.me.id);
    // also include demo users as discoverable contacts
    const list = contacts.map((c) => {
      const u = DB.byId('users', c.userId);
      return u ? S.publicUser(u) : null;
    }).filter(Boolean);
    res.json({ contacts: list });
  });

  app.post('/api/contacts', auth, (req, res) => {
    const { username, firstName, lastName, phone } = req.body || {};
    let target = null;
    if (username) target = DB.find('users', (u) => u.username.toLowerCase() === String(username).replace(/^@/, '').toLowerCase());
    if (!target && phone) target = DB.find('users', (u) => u.phone.replace(/\D/g, '') === String(phone).replace(/\D/g, ''));
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (!DB.find('contacts', (c) => c.ownerId === req.me.id && c.userId === target.id)) {
      DB.insert('contacts', { id: DB.id('ct'), ownerId: req.me.id, userId: target.id,
        firstName: firstName || target.name, lastName: lastName || target.lastName, phone: phone || target.phone });
    }
    const chat = S.ensurePrivateChat(req.me.id, target.id);
    res.json({ user: S.publicUser(target), chatId: chat.id });
  });

  /* ---------------- chats ---------------- */
  app.get('/api/chats', auth, (req, res) => {
    res.json({ chats: S.chatsForUser(req.me.id) });
  });

  app.get('/api/chats/:id', auth, (req, res) => {
    const chat = DB.byId('chats', req.params.id);
    if (!chat || !chat.members.includes(req.me.id)) return res.status(404).json({ error: 'not found' });
    res.json({ chat: S.serializeChat(chat, req.me.id),
      members: chat.members.map((mid) => S.publicUser(DB.byId('users', mid))) });
  });

  // open or create a chat with a user (by id or username)
  app.post('/api/chats/open', auth, (req, res) => {
    let peer = null;
    if (req.body.userId) peer = DB.byId('users', req.body.userId);
    else if (req.body.username) peer = DB.find('users', (u) => u.username.toLowerCase() === String(req.body.username).replace(/^@/, '').toLowerCase());
    if (!peer) return res.status(404).json({ error: 'user not found' });
    if (peer.id === req.me.id) { const saved = S.ensureSavedChat(req.me.id); return res.json({ chat: S.serializeChat(saved, req.me.id) }); }
    const chat = S.ensurePrivateChat(req.me.id, peer.id);
    res.json({ chat: S.serializeChat(chat, req.me.id) });
  });

  app.post('/api/chats/group', auth, (req, res) => {
    const { title, memberIds, about } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const members = Array.from(new Set([req.me.id, ...(memberIds || [])]));
    const chat = DB.insert('chats', { id: DB.id('c'), type: 'group', title, members, avatar: null,
      color: COLORS[DB.all('chats').length % COLORS.length], username: '', pinnedMessageId: null,
      folder: 'all', about: about || '', adminIds: [req.me.id], muted: false });
    const m = S.createMessage(chat.id, req.me.id, { service: { type: 'group_created', by: req.me.id } });
    for (const uid of members) emitToUser(uid, 'chat:new', { chat: S.serializeChat(chat, uid) });
    res.json({ chat: S.serializeChat(chat, req.me.id) });
  });

  app.patch('/api/chats/:id/mute', auth, (req, res) => {
    const chat = DB.byId('chats', req.params.id);
    if (!chat) return res.status(404).json({ error: 'not found' });
    DB.update('chats', chat.id, { muted: !!req.body.muted });
    res.json({ ok: true, muted: !!req.body.muted });
  });

  app.delete('/api/chats/:id', auth, (req, res) => {
    const chat = DB.byId('chats', req.params.id);
    if (!chat || !chat.members.includes(req.me.id)) return res.status(404).json({ error: 'not found' });
    DB.remove('messages', (m) => m.chatId === chat.id);
    if (chat.type === 'group' || chat.type === 'channel') {
      DB.update('chats', chat.id, { members: chat.members.filter((m) => m !== req.me.id) });
    } else {
      DB.remove('chats', (c) => c.id === chat.id);
    }
    res.json({ ok: true });
  });

  /* ---------------- messages ---------------- */
  app.get('/api/chats/:id/messages', auth, (req, res) => {
    const chat = DB.byId('chats', req.params.id);
    if (!chat || !chat.members.includes(req.me.id)) return res.status(404).json({ error: 'not found' });
    const before = req.query.before ? Number(req.query.before) : null;
    res.json({ messages: S.messagesForChat(chat.id, req.me.id, { before, limit: 300 }),
      pinnedMessageId: chat.pinnedMessageId });
  });

  // shared media/files/voice/links for a chat
  app.get('/api/chats/:id/shared', auth, (req, res) => {
    const kind = req.query.kind || 'media';
    const msgs = DB.filter('messages', (m) => m.chatId === req.params.id && m.media);
    const filtered = msgs.filter((m) => {
      const k = m.media.kind;
      if (kind === 'media') return k === 'photo' || k === 'video';
      if (kind === 'files') return k === 'file';
      if (kind === 'voice') return k === 'voice' || k === 'audio';
      if (kind === 'links') return k === 'link';
      return true;
    });
    res.json({ items: filtered.map((m) => S.serializeMessage(m, req.me.id)) });
  });

  /* ---------------- search ---------------- */
  app.get('/api/search', auth, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ users: [], chats: [], messages: [] });
    const users = DB.filter('users', (u) => u.id !== req.me.id && (
      (u.name + ' ' + (u.lastName || '')).toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q))).slice(0, 20).map(S.publicUser);
    const chats = S.chatsForUser(req.me.id).filter((c) => c.title.toLowerCase().includes(q)).slice(0, 20);
    const myChatIds = DB.filter('chats', (c) => c.members.includes(req.me.id)).map((c) => c.id);
    const messages = DB.filter('messages', (m) => myChatIds.includes(m.chatId) &&
      (m.text || '').toLowerCase().includes(q)).slice(0, 30).map((m) => S.serializeMessage(m, req.me.id));
    res.json({ users, chats, messages });
  });

  /* ---------------- calls ---------------- */
  app.get('/api/calls', auth, (req, res) => {
    const calls = DB.filter('calls', (c) => c.fromId === req.me.id || c.toId === req.me.id)
      .sort((a, b) => b.ts - a.ts).slice(0, 100)
      .map((c) => ({ id: c.id, video: c.video, status: c.status, duration: c.duration, ts: c.ts,
        out: c.fromId === req.me.id,
        peer: S.publicUser(DB.byId('users', c.fromId === req.me.id ? c.toId : c.fromId)) }));
    res.json({ calls });
  });

  /* ---------------- devices / sessions ---------------- */
  app.get('/api/sessions', auth, (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const sessions = DB.filter('sessions', (s) => s.userId === req.me.id)
      .map((s) => ({ token: s.token === token ? 'current' : s.token.slice(0, 8),
        device: s.device, app: s.app, ip: s.ip, location: s.location, ts: s.ts,
        current: s.token === token }));
    res.json({ sessions });
  });
  // terminate ALL other (non-current) sessions
  app.delete('/api/sessions', auth, (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    DB.remove('sessions', (s) => s.userId === req.me.id && s.token !== token);
    res.json({ ok: true });
  });
  app.delete('/api/sessions/:token', auth, (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    DB.remove('sessions', (s) => s.userId === req.me.id && s.token !== token && s.token.startsWith(req.params.token));
    res.json({ ok: true });
  });

  /* ---------------- folders ---------------- */
  app.get('/api/folders', auth, (req, res) => {
    res.json({ folders: DB.filter('folders', (f) => f.ownerId === req.me.id) });
  });
  app.post('/api/folders', auth, (req, res) => {
    const f = DB.insert('folders', { id: DB.id('fl'), ownerId: req.me.id,
      title: req.body.title || 'Folder', emoji: req.body.emoji || '📁',
      includedChats: req.body.includedChats || [], excludedChats: [], filters: req.body.filters || [] });
    res.json({ folder: f });
  });
  app.delete('/api/folders/:id', auth, (req, res) => {
    DB.remove('folders', (f) => f.id === req.params.id && f.ownerId === req.me.id);
    res.json({ ok: true });
  });

  /* ---------------- uploads ---------------- */
  app.post('/api/upload', auth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ url: '/uploads/' + req.file.filename, name: req.file.originalname,
      size: req.file.size, mime: req.file.mimetype });
  });

  /* ---------------- link preview ---------------- */
  app.get('/api/link-preview', auth, (req, res) => {
    const target = req.query.url;
    if (!target || !/^https?:\/\//.test(target)) return res.status(400).json({ error: 'bad url' });
    fetchPreview(target).then((p) => res.json(p)).catch(() => res.json({ url: target, title: '', desc: '', site: hostOf(target) }));
  });
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

function fetchPreview(target) {
  return new Promise((resolve, reject) => {
    const lib = target.startsWith('https') ? https : http;
    const req = lib.get(target, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 TelegramBot' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.destroy();
        return resolve(fetchPreview(new URL(r.headers.location, target).href));
      }
      let data = ''; let len = 0;
      r.on('data', (c) => { data += c; len += c.length; if (len > 200000) r.destroy(); });
      r.on('end', () => {
        const title = meta(data, 'og:title') || tag(data, 'title') || '';
        const desc = meta(data, 'og:description') || metaName(data, 'description') || '';
        const image = meta(data, 'og:image') || '';
        resolve({ url: target, title, desc, image, site: hostOf(target) });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
function meta(html, prop) {
  const re = new RegExp('<meta[^>]+property=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re) || html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']' + prop + '["\']', 'i'));
  return m ? decodeEntities(m[1]) : '';
}
function metaName(html, name) {
  const m = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]+content=["\']([^"\']*)["\']', 'i'));
  return m ? decodeEntities(m[1]) : '';
}
function tag(html, t) { const m = html.match(new RegExp('<' + t + '[^>]*>([^<]*)</' + t + '>', 'i')); return m ? decodeEntities(m[1].trim()) : ''; }
function decodeEntities(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }

function deviceName(ua) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android device';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Web';
}
function appName(ua) {
  if (/Chrome\/(\d+)/.test(ua)) return 'Telegram Web (Chrome ' + RegExp.$1 + ')';
  if (/Firefox\/(\d+)/.test(ua)) return 'Telegram Web (Firefox ' + RegExp.$1 + ')';
  if (/Safari/.test(ua)) return 'Telegram Web (Safari)';
  return 'Telegram Web';
}

module.exports = { register, auth };
