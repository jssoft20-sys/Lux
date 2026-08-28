'use strict';
/*
 * Tiny dependency-free JSON document store.
 * Keeps collections in memory, flushes to disk (debounced + atomic rename).
 * Good enough for a demo social network; no native build steps.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = [
  'users',       // { id, name, lastName, username, phone, avatar, color, bio, birthday,
                 //   online, lastSeen, isBot, verified, premium, botInfo, privacy, password }
  'chats',       // { id, type('private'|'group'|'channel'|'bot'|'saved'), title, members[],
                 //   avatar, color, username, pinnedMessageId, folder, about, adminIds[] }
  'messages',    // { id, chatId, senderId, text, entities, media, replyTo, forwardFrom,
                 //   reactions{}, views, edited, pinned, ts, poll, service, seenBy[] }
  'contacts',    // { id, ownerId, userId, firstName, lastName, phone }
  'calls',       // { id, fromId, toId, video, status, duration, ts }
  'sessions',    // { token, userId, device, app, ip, location, ts, current }
  'folders',     // { id, ownerId, title, emoji, includedChats[], excludedChats[], filters[] }
  'polls',       // { id, messageId, question, options[], votes{userId:[idx]}, multiple, quiz, correct }
];

let state = null;
let flushTimer = null;

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function blank() {
  const o = { _seq: 0 };
  for (const c of COLLECTIONS) o[c] = [];
  return o;
}

function load() {
  ensure();
  if (fs.existsSync(DB_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const c of COLLECTIONS) if (!Array.isArray(state[c])) state[c] = [];
      if (typeof state._seq !== 'number') state._seq = 0;
    } catch (e) {
      console.error('DB corrupt, starting fresh:', e.message);
      state = blank();
    }
  } else {
    state = blank();
  }
  return state;
}

function flushNow() {
  if (!state) return;
  ensure();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_FILE);
}

function flush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { flushNow(); } catch (e) { console.error('flush failed', e.message); }
  }, 120);
}

function db() {
  if (!state) load();
  return state;
}

function id(prefix) {
  db()._seq += 1;
  const n = db()._seq;
  flush();
  return `${prefix || 'x'}${n}_${Math.floor(performance.now() * 1000) % 100000}`;
}

// Generic helpers over a collection name
function all(col) { return db()[col]; }
function find(col, pred) { return db()[col].find(pred); }
function filter(col, pred) { return db()[col].filter(pred); }
function byId(col, theId) { return db()[col].find((r) => r.id === theId); }
function insert(col, row) { db()[col].push(row); flush(); return row; }
function update(col, theId, patch) {
  const row = byId(col, theId);
  if (row) { Object.assign(row, patch); flush(); }
  return row;
}
function remove(col, pred) {
  const arr = db()[col];
  const keep = arr.filter((r) => !pred(r));
  db()[col] = keep;
  flush();
}

module.exports = {
  load, flush, flushNow, db, id,
  all, find, filter, byId, insert, update, remove,
  DATA_DIR, DB_FILE, COLLECTIONS,
};
