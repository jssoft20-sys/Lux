'use strict';
/* Shared business logic used by both REST routes and the socket layer. */
const DB = require('./db');
const Bots = require('./bots');

function now() { return Date.now(); }

/* ---------------- auth ---------------- */
function userByToken(token) {
  if (!token) return null;
  const s = DB.find('sessions', (x) => x.token === token);
  if (!s) return null;
  return DB.byId('users', s.userId);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, lastName: u.lastName || '', username: u.username || '',
    phone: u.phone || '', avatar: u.avatar || null, color: u.color, bio: u.bio || '',
    birthday: u.birthday || '', online: !!u.online, lastSeen: u.lastSeen || 0,
    isBot: !!u.isBot, verified: !!u.verified, premium: !!u.premium,
    botInfo: u.botInfo || null,
  };
}

/* ---------------- chats ---------------- */
function otherMember(chat, meId) {
  const id = chat.members.find((m) => m !== meId);
  return id ? DB.byId('users', id) : null;
}

function chatTitle(chat, meId) {
  if (chat.type === 'saved') return 'Saved Messages';
  if (chat.title) return chat.title;
  const o = otherMember(chat, meId);
  return o ? (o.name + (o.lastName ? ' ' + o.lastName : '')) : 'Chat';
}

function lastMessage(chatId) {
  const msgs = DB.filter('messages', (m) => m.chatId === chatId);
  if (!msgs.length) return null;
  return msgs.reduce((a, b) => (b.ts > a.ts ? b : a));
}

function unreadCount(chat, meId) {
  return DB.filter('messages', (m) => m.chatId === chat.id && m.senderId !== meId && !(m.seenBy || []).includes(meId)).length;
}

function serializeChat(chat, meId) {
  const other = chat.type === 'private' || chat.type === 'bot' ? otherMember(chat, meId) : null;
  const last = lastMessage(chat.id);
  return {
    id: chat.id, type: chat.type, title: chatTitle(chat, meId),
    avatar: chat.avatar || (other && other.avatar) || null,
    color: chat.color || (other && other.color) || '#65aadd',
    username: chat.username || (other && other.username) || '',
    about: chat.about || (other && other.bio) || '',
    members: chat.members, memberCount: chat.members.length,
    adminIds: chat.adminIds || [], muted: !!chat.muted,
    verified: !!chat.verified || (other && other.verified) || false,
    pinnedMessageId: chat.pinnedMessageId || null, folder: chat.folder || 'all',
    peer: other ? publicUser(other) : null,
    lastMessage: last ? serializeMessage(last, meId, true) : null,
    unread: unreadCount(chat, meId),
    online: other ? !!other.online : false,
    lastSeen: other ? other.lastSeen : 0,
    isBot: chat.type === 'bot' || (other && other.isBot) || false,
  };
}

function chatsForUser(meId) {
  const chats = DB.filter('chats', (c) => c.members.includes(meId));
  const out = chats.map((c) => serializeChat(c, meId));
  out.sort((a, b) => {
    const ta = a.lastMessage ? a.lastMessage.ts : 0;
    const tb = b.lastMessage ? b.lastMessage.ts : 0;
    return tb - ta;
  });
  return out;
}

function ensurePrivateChat(aId, bId) {
  let chat = DB.find('chats', (c) => (c.type === 'private' || c.type === 'bot') &&
    c.members.length === 2 && c.members.includes(aId) && c.members.includes(bId));
  if (chat) return chat;
  const b = DB.byId('users', bId);
  chat = DB.insert('chats', {
    id: DB.id('c'), type: b && b.isBot ? 'bot' : 'private', title: '',
    members: [aId, bId], avatar: null, color: (b && b.color) || '#65aadd',
    username: '', pinnedMessageId: null, folder: 'all', about: '', adminIds: [], muted: false,
  });
  return chat;
}

function ensureSavedChat(meId) {
  let chat = DB.find('chats', (c) => c.type === 'saved' && c.members[0] === meId);
  if (chat) return chat;
  chat = DB.insert('chats', {
    id: DB.id('c'), type: 'saved', title: 'Saved Messages', members: [meId],
    avatar: null, color: '#65aadd', username: '', pinnedMessageId: null, folder: 'all',
    about: '', adminIds: [meId], muted: false,
  });
  return chat;
}

/* ---------------- messages ---------------- */
function serializeMessage(m, meId, brief) {
  const sender = DB.byId('users', m.senderId);
  const base = {
    id: m.id, chatId: m.chatId, senderId: m.senderId,
    senderName: sender ? sender.name + (sender.lastName ? ' ' + sender.lastName : '') : '',
    senderColor: sender ? sender.color : '#65aadd',
    senderAvatar: sender ? sender.avatar : null,
    text: m.text || '', entities: m.entities || [], media: m.media || null,
    replyTo: m.replyTo || null, forwardFrom: m.forwardFrom || null,
    reactions: m.reactions || {}, views: m.views || 0, edited: !!m.edited,
    pinned: !!m.pinned, ts: m.ts, service: m.service || null,
    seenBy: m.seenBy || [], out: m.senderId === meId,
  };
  if (m.poll) {
    const poll = m.poll.id ? DB.byId('polls', m.poll.id) : null;
    if (poll) {
      const votes = poll.votes || {};
      const counts = poll.options.map((_, i) =>
        Object.values(votes).filter((arr) => arr.includes(i)).length);
      const total = Object.keys(votes).length;
      base.poll = {
        id: poll.id, question: poll.question, options: poll.options,
        multiple: poll.multiple, quiz: poll.quiz, correct: poll.correct,
        counts, total, myVotes: votes[meId] || [],
      };
    }
  }
  if (m.replyTo) {
    const r = DB.byId('messages', m.replyTo);
    if (r) {
      const rs = DB.byId('users', r.senderId);
      base.replyPreview = {
        id: r.id, senderName: rs ? rs.name : '', text: r.text || (r.media ? '[media]' : ''),
        color: rs ? rs.color : '#65aadd',
      };
    }
  }
  return base;
}

function messagesForChat(chatId, meId, opts) {
  opts = opts || {};
  let msgs = DB.filter('messages', (m) => m.chatId === chatId).sort((a, b) => a.ts - b.ts);
  if (opts.before) msgs = msgs.filter((m) => m.ts < opts.before);
  const limit = opts.limit || 200;
  msgs = msgs.slice(-limit);
  return msgs.map((m) => serializeMessage(m, meId));
}

function createMessage(chatId, senderId, draft) {
  const m = DB.insert('messages', {
    id: DB.id('m'), chatId, senderId,
    text: draft.text || '', entities: draft.entities || [], media: draft.media || null,
    replyTo: draft.replyTo || null, forwardFrom: draft.forwardFrom || null,
    reactions: {}, views: 0, edited: false, pinned: false, ts: now(),
    poll: null, service: draft.service || null, seenBy: [senderId],
  });
  if (draft.poll && draft.poll.question) {
    const poll = DB.insert('polls', {
      id: DB.id('poll'), messageId: m.id, question: draft.poll.question,
      options: draft.poll.options || [], votes: {}, multiple: !!draft.poll.multiple,
      quiz: !!draft.poll.quiz, correct: draft.poll.correct != null ? draft.poll.correct : null,
    });
    DB.update('messages', m.id, { poll: { id: poll.id, question: poll.question } });
  }
  return DB.byId('messages', m.id);
}

module.exports = {
  now, userByToken, publicUser, otherMember, chatTitle, lastMessage, unreadCount,
  serializeChat, chatsForUser, ensurePrivateChat, ensureSavedChat,
  serializeMessage, messagesForChat, createMessage,
};
