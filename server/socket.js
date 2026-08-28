'use strict';
const DB = require('./db');
const S = require('./service');
const Bots = require('./bots');

// userId -> Set of socket ids
const online = new Map();

function attach(io) {
  function emitToUser(userId, event, payload) {
    const set = online.get(userId);
    if (!set) return;
    for (const sid of set) io.to(sid).emit(event, payload);
  }
  function emitToChat(chat, event, payload, exceptUser) {
    for (const uid of chat.members) {
      if (uid === exceptUser) continue;
      emitToUser(uid, event, payload);
    }
  }

  io.on('connection', (socket) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const me = S.userByToken(token);
    if (!me) { socket.emit('unauthorized'); socket.disconnect(true); return; }
    socket.data.userId = me.id;

    if (!online.has(me.id)) online.set(me.id, new Set());
    online.get(me.id).add(socket.id);
    DB.update('users', me.id, { online: true, lastSeen: S.now() });
    broadcastPresence(me.id, true);

    // ---- send a message ----
    socket.on('message:send', (payload, ack) => {
      try {
        const chat = DB.byId('chats', payload.chatId);
        if (!chat || !chat.members.includes(me.id)) return ack && ack({ error: 'no chat' });
        const msg = S.createMessage(chat.id, me.id, payload);
        const forSender = S.serializeMessage(msg, me.id);
        ack && ack({ ok: true, message: forSender });
        for (const uid of chat.members) {
          emitToUser(uid, 'message:new', { chatId: chat.id, message: S.serializeMessage(msg, uid) });
        }
        // bot auto-reply
        if (chat.type === 'bot') {
          const bot = Bots.botFor(chat);
          if (bot) {
            const drafts = Bots.respond(bot, payload.text, me);
            let delay = 500;
            for (const draft of drafts) {
              setTimeout(() => {
                emitToChat(chat, 'typing', { chatId: chat.id, userId: bot.id, name: bot.name, on: true });
                setTimeout(() => {
                  const bm = S.createMessage(chat.id, bot.id, draft);
                  for (const uid of chat.members) {
                    emitToUser(uid, 'typing', { chatId: chat.id, userId: bot.id, on: false });
                    emitToUser(uid, 'message:new', { chatId: chat.id, message: S.serializeMessage(bm, uid) });
                  }
                }, 600);
              }, delay);
              delay += 900;
            }
          }
        }
      } catch (e) { console.error('message:send', e); ack && ack({ error: e.message }); }
    });

    // ---- typing ----
    socket.on('typing', (payload) => {
      const chat = DB.byId('chats', payload.chatId);
      if (!chat) return;
      emitToChat(chat, 'typing', { chatId: chat.id, userId: me.id, name: me.name, on: !!payload.on }, me.id);
    });

    // ---- read receipts ----
    socket.on('message:read', (payload) => {
      const chat = DB.byId('chats', payload.chatId);
      if (!chat) return;
      const msgs = DB.filter('messages', (m) => m.chatId === chat.id && m.senderId !== me.id);
      let changed = false;
      for (const m of msgs) {
        if (!(m.seenBy || []).includes(me.id)) { m.seenBy = (m.seenBy || []).concat(me.id); changed = true; }
      }
      if (changed) { DB.flush(); emitToChat(chat, 'message:read', { chatId: chat.id, userId: me.id }, me.id); }
    });

    // ---- reactions ----
    socket.on('message:react', (payload, ack) => {
      const m = DB.byId('messages', payload.messageId);
      if (!m) return ack && ack({ error: 'no msg' });
      const chat = DB.byId('chats', m.chatId);
      if (!chat || !chat.members.includes(me.id)) return ack && ack({ error: 'no chat' });
      const emoji = payload.emoji;
      const reactions = m.reactions || {};
      // remove my other reactions (single reaction model like TG default)
      for (const k of Object.keys(reactions)) {
        reactions[k] = reactions[k].filter((u) => u !== me.id);
        if (!reactions[k].length) delete reactions[k];
      }
      if (emoji && !(payload.remove)) {
        if (!reactions[emoji]) reactions[emoji] = [];
        reactions[emoji].push(me.id);
      }
      DB.update('messages', m.id, { reactions });
      for (const uid of chat.members)
        emitToUser(uid, 'message:react', { chatId: chat.id, messageId: m.id, reactions });
      ack && ack({ ok: true });
    });

    // ---- edit / delete / pin ----
    socket.on('message:edit', (payload, ack) => {
      const m = DB.byId('messages', payload.messageId);
      if (!m || m.senderId !== me.id) return ack && ack({ error: 'nope' });
      DB.update('messages', m.id, { text: payload.text, entities: payload.entities || [], edited: true });
      const chat = DB.byId('chats', m.chatId);
      for (const uid of chat.members)
        emitToUser(uid, 'message:edit', { chatId: chat.id, message: S.serializeMessage(DB.byId('messages', m.id), uid) });
      ack && ack({ ok: true });
    });
    socket.on('message:delete', (payload, ack) => {
      const m = DB.byId('messages', payload.messageId);
      if (!m) return ack && ack({ error: 'no msg' });
      const chat = DB.byId('chats', m.chatId);
      if (!chat || !chat.members.includes(me.id)) return ack && ack({ error: 'no chat' });
      DB.remove('messages', (x) => x.id === m.id);
      if (chat.pinnedMessageId === m.id) DB.update('chats', chat.id, { pinnedMessageId: null });
      for (const uid of chat.members)
        emitToUser(uid, 'message:delete', { chatId: chat.id, messageId: m.id });
      ack && ack({ ok: true });
    });
    socket.on('message:pin', (payload, ack) => {
      const m = DB.byId('messages', payload.messageId);
      if (!m) return ack && ack({ error: 'no msg' });
      const chat = DB.byId('chats', m.chatId);
      const pin = payload.unpin ? null : m.id;
      DB.update('chats', chat.id, { pinnedMessageId: pin });
      DB.update('messages', m.id, { pinned: !payload.unpin });
      for (const uid of chat.members)
        emitToUser(uid, 'chat:pin', { chatId: chat.id, pinnedMessageId: pin });
      ack && ack({ ok: true });
    });

    // ---- poll vote ----
    socket.on('poll:vote', (payload, ack) => {
      const poll = DB.byId('polls', payload.pollId);
      if (!poll) return ack && ack({ error: 'no poll' });
      const m = DB.byId('messages', poll.messageId);
      const chat = DB.byId('chats', m.chatId);
      if (!chat || !chat.members.includes(me.id)) return ack && ack({ error: 'no chat' });
      const votes = poll.votes || {};
      votes[me.id] = poll.multiple ? (payload.options || []) : [payload.options[0]];
      DB.update('polls', poll.id, { votes });
      for (const uid of chat.members)
        emitToUser(uid, 'poll:update', { chatId: chat.id, messageId: m.id, poll: S.serializeMessage(m, uid).poll });
      ack && ack({ ok: true });
    });

    // ---- WebRTC call signaling ----
    socket.on('call:invite', (payload) => {
      const call = DB.insert('calls', { id: DB.id('call'), fromId: me.id, toId: payload.toId,
        video: !!payload.video, status: 'ringing', duration: 0, ts: S.now() });
      socket.data.callId = call.id;
      emitToUser(payload.toId, 'call:incoming', { callId: call.id, from: S.publicUser(me), video: !!payload.video, sdp: payload.sdp });
      emitToUser(me.id, 'call:ringing', { callId: call.id, to: S.publicUser(DB.byId('users', payload.toId)) });
    });
    socket.on('call:answer', (payload) => {
      const call = DB.byId('calls', payload.callId);
      if (!call) return;
      DB.update('calls', call.id, { status: 'active' });
      emitToUser(call.fromId, 'call:answered', { callId: call.id, sdp: payload.sdp });
    });
    socket.on('call:ice', (payload) => {
      const call = DB.byId('calls', payload.callId);
      if (!call) return;
      const target = me.id === call.fromId ? call.toId : call.fromId;
      emitToUser(target, 'call:ice', { callId: call.id, candidate: payload.candidate });
    });
    socket.on('call:hangup', (payload) => {
      const call = DB.byId('calls', payload.callId);
      if (!call) return;
      DB.update('calls', call.id, { status: payload.reason || 'ended', duration: payload.duration || 0 });
      const target = me.id === call.fromId ? call.toId : call.fromId;
      emitToUser(target, 'call:hangup', { callId: call.id, reason: payload.reason || 'ended' });
    });
    socket.on('call:decline', (payload) => {
      const call = DB.byId('calls', payload.callId);
      if (!call) return;
      DB.update('calls', call.id, { status: 'declined' });
      emitToUser(call.fromId, 'call:declined', { callId: call.id });
    });

    socket.on('presence:ping', () => { DB.update('users', me.id, { lastSeen: S.now() }); });

    socket.on('disconnect', () => {
      const set = online.get(me.id);
      if (set) { set.delete(socket.id); if (!set.size) online.delete(me.id); }
      if (!online.has(me.id)) {
        DB.update('users', me.id, { online: false, lastSeen: S.now() });
        broadcastPresence(me.id, false);
      }
    });
  });

  function broadcastPresence(userId, isOnline) {
    const chats = DB.filter('chats', (c) => c.members.includes(userId));
    const seen = new Set();
    for (const c of chats) for (const uid of c.members) {
      if (uid === userId || seen.has(uid)) continue;
      seen.add(uid);
      emitToUser(uid, 'presence', { userId, online: isOnline, lastSeen: S.now() });
    }
  }
  function emitToUser(userId, event, payload) {
    const set = online.get(userId);
    if (!set) return;
    for (const sid of set) io.to(sid).emit(event, payload);
  }

  return { emitToUser, online };
}

module.exports = { attach, online };
