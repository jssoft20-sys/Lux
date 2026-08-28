'use strict';
/*
 * Seeds a clean, neutral demo dataset: sample people, a group, a news channel,
 * a few helpful bots, "Saved Messages", and some starter conversations.
 * Run with `node server/seed.js --reset` to wipe and reseed.
 */
const DB = require('./db');

const NOW = Date.parse('2026-08-28T03:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function hash(pw) {
  // toy hash — demo only, do not use for anything real
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h + pw.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}

const COLORS = ['#e17076', '#7bc862', '#e5ca77', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

function seed() {
  const d = DB.db();
  // wipe
  for (const c of DB.COLLECTIONS) d[c] = [];
  d._seq = 0;

  const U = (o) => DB.insert('users', Object.assign({
    id: DB.id('u'), name: '', lastName: '', username: '', phone: '', avatar: null,
    color: COLORS[d.users.length % COLORS.length], bio: '', birthday: '',
    online: false, lastSeen: NOW - HOUR, isBot: false, verified: false, premium: false,
    botInfo: null, password: null,
    privacy: {
      phone: 'nobody', lastSeen: 'everybody', profilePhoto: 'everybody', bio: 'everybody',
      gifts: 'everybody', birthday: 'contacts', savedMusic: 'everybody', forwards: 'everybody',
      calls: 'everybody', voiceMessages: 'everybody', messages: 'everybody', invites: 'contacts',
    },
  }, o));

  // ---- People ----
  const alice = U({ name: 'Alice', lastName: 'Morgan', username: 'alice', phone: '+1 202 555 0140',
    bio: 'Designer. Coffee first ☕', online: true, premium: true, password: hash('demo') });
  const boris = U({ name: 'Boris', lastName: 'Petrov', username: 'boris', phone: '+7 916 555 0177',
    bio: 'Backend dev. Cat person 🐈', lastSeen: NOW - 12 * MIN, password: hash('demo') });
  const chloe = U({ name: 'Chloé', lastName: 'Dubois', username: 'chloe', phone: '+33 6 55 01 88',
    bio: 'Photographer 📷 Paris', lastSeen: NOW - 3 * HOUR, password: hash('demo') });
  const dan = U({ name: 'Daniel', lastName: 'Kim', username: 'dan', phone: '+82 10 5550 0199',
    bio: 'Music & code', lastSeen: NOW - DAY, verified: true, password: hash('demo') });
  const eve = U({ name: 'Eve', lastName: 'Larsson', username: 'eve', phone: '+46 70 555 0201',
    bio: 'Traveler ✈️ 34 countries', online: true, password: hash('demo') });

  // ---- Bots ----
  const echoBot = U({ name: 'Echo', lastName: 'Bot', username: 'echobot', isBot: true, verified: true,
    color: '#65aadd', bio: 'I repeat everything you say.',
    botInfo: { about: 'A simple echo bot for testing.', commands: [
      { cmd: 'start', desc: 'start the bot' }, { cmd: 'help', desc: 'show help' },
      { cmd: 'time', desc: 'current server time' } ], engine: 'echo' } });
  const pollBot = U({ name: 'Poll', lastName: 'Bot', username: 'pollbot', isBot: true, verified: true,
    color: '#7bc862', bio: 'Create polls in any chat.',
    botInfo: { about: 'Create a quick poll: /poll Question | Option A | Option B', commands: [
      { cmd: 'start', desc: 'start' }, { cmd: 'poll', desc: 'create a poll' } ], engine: 'poll' } });
  const botFather = U({ name: 'BotFather', username: 'BotFather', isBot: true, verified: true,
    color: '#65aadd', bio: 'The one bot to rule them all.',
    botInfo: { about: 'Use this bot to create and manage other bots.', commands: [
      { cmd: 'newbot', desc: 'create a new bot' }, { cmd: 'mybots', desc: 'edit your bots' },
      { cmd: 'help', desc: 'commands' } ], engine: 'botfather' } });
  const stickerBot = U({ name: 'Stickers', lastName: 'Bot', username: 'stickers', isBot: true, verified: true,
    color: '#a695e7', bio: 'Discover sticker packs.',
    botInfo: { about: 'Random sticker on demand.', commands: [
      { cmd: 'start', desc: 'start' }, { cmd: 'random', desc: 'send a random sticker' } ], engine: 'sticker' } });

  const people = [alice, boris, chloe, dan, eve];
  const bots = [echoBot, pollBot, botFather, stickerBot];

  // ---- Chats ----
  const C = (o) => DB.insert('chats', Object.assign({
    id: DB.id('c'), type: 'private', title: '', members: [], avatar: null,
    color: COLORS[d.chats.length % COLORS.length], username: '', pinnedMessageId: null,
    folder: 'all', about: '', adminIds: [], muted: false,
  }, o));

  // "Saved Messages" for each real person is created lazily on login; skip here.

  // private chats between demo people
  const privatePairs = [
    [alice, boris], [alice, chloe], [alice, eve], [alice, dan],
    [boris, chloe], [boris, eve],
  ];
  const privChats = privatePairs.map(([a, b]) =>
    C({ type: 'private', members: [a.id, b.id] }));

  // bot chats (Alice with each bot)
  const botChats = bots.map((b) =>
    C({ type: 'bot', members: [alice.id, b.id], title: b.name }));

  // group
  const group = C({ type: 'group', title: 'Design Crew 🎨',
    members: [alice.id, boris.id, chloe.id, dan.id, eve.id], adminIds: [alice.id],
    about: 'Where we argue about pixels.', color: '#a695e7' });

  // channel
  const channel = C({ type: 'channel', title: 'Daily Tech', username: 'dailytech',
    members: [alice.id, boris.id, chloe.id, dan.id, eve.id], adminIds: [dan.id],
    about: 'Curated tech news, once a day.', color: '#65aadd', verified: true });

  // ---- Messages ----
  const M = (o) => DB.insert('messages', Object.assign({
    id: DB.id('m'), chatId: '', senderId: '', text: '', entities: [], media: null,
    replyTo: null, forwardFrom: null, reactions: {}, views: 0, edited: false,
    pinned: false, ts: NOW - HOUR, poll: null, service: null, seenBy: [],
  }, o));

  // Alice <-> Boris
  const cAB = privChats[0];
  M({ chatId: cAB.id, senderId: boris.id, text: 'Hey! Did you see the new mockups?', ts: NOW - 2 * HOUR });
  M({ chatId: cAB.id, senderId: alice.id, text: 'Yes! The gradient header looks 🔥', ts: NOW - 2 * HOUR + 3 * MIN,
     entities: [{ type: 'bold', offset: 9, length: 15 }] });
  M({ chatId: cAB.id, senderId: boris.id, text: 'Ship it?', ts: NOW - 2 * HOUR + 5 * MIN,
     reactions: { '👍': [alice.id] } });
  const pinMsg = M({ chatId: cAB.id, senderId: alice.id, text: 'Standup at 10:00 tomorrow. Don\'t be late 😄',
     ts: NOW - 90 * MIN, pinned: true });
  DB.update('chats', cAB.id, { pinnedMessageId: pinMsg.id });
  M({ chatId: cAB.id, senderId: boris.id, text: 'Got it 👌', ts: NOW - 80 * MIN });

  // Alice <-> Chloe (with a voice-ish + reply)
  const cAC = privChats[1];
  const cm1 = M({ chatId: cAC.id, senderId: chloe.id, text: 'Sending you the shots from the shoot', ts: NOW - 5 * HOUR });
  M({ chatId: cAC.id, senderId: alice.id, text: 'Amazing, thank you!', ts: NOW - 5 * HOUR + 2 * MIN, replyTo: cm1.id });
  M({ chatId: cAC.id, senderId: chloe.id, text: 'https://unsplash.com', ts: NOW - 4 * HOUR,
     media: { kind: 'link', url: 'https://unsplash.com', title: 'Unsplash', desc: 'Beautiful free images & pictures', site: 'unsplash.com' } });

  // Group chat with a poll
  const gm1 = M({ chatId: group.id, senderId: chloe.id, text: 'Team lunch on Friday? 🍜', ts: NOW - 6 * HOUR });
  const pollMsg = M({ chatId: group.id, senderId: alice.id, text: '', ts: NOW - 6 * HOUR + 4 * MIN,
     poll: { question: 'Where should we go?', multiple: false, quiz: false } });
  const poll = DB.insert('polls', { id: DB.id('poll'), messageId: pollMsg.id,
     question: 'Where should we go?', options: ['Ramen 🍜', 'Tacos 🌮', 'Sushi 🍣'],
     votes: { [boris.id]: [0], [chloe.id]: [2], [dan.id]: [0], [eve.id]: [1] }, multiple: false, quiz: false, correct: null });
  DB.update('messages', pollMsg.id, { poll: Object.assign({ id: poll.id }, pollMsg.poll) });
  M({ chatId: group.id, senderId: dan.id, text: 'Ramen obviously 🍜', ts: NOW - 5 * HOUR,
     reactions: { '🔥': [boris.id, alice.id] } });

  // Channel posts
  M({ chatId: channel.id, senderId: dan.id, text: 'Daily Tech · Aug 28\nWebGPU ships in all major browsers. Native-speed graphics on the web are here.',
     ts: NOW - 8 * HOUR, views: 4211, entities: [{ type: 'italic', offset: 0, length: 19 }] });
  M({ chatId: channel.id, senderId: dan.id, text: 'New: structuredClone() is now everywhere. Deep-copy without the JSON hack.',
     ts: NOW - 3 * HOUR, views: 3980, reactions: { '👍': [alice.id, boris.id, eve.id], '🔥': [chloe.id] },
     entities: [{ type: 'code', offset: 5, length: 17 }] });

  // Bot intro messages
  const cEcho = botChats[0];
  M({ chatId: cEcho.id, senderId: echoBot.id, text: 'Hi! I am Echo bot. Send me anything and I will repeat it. Press Start to begin.',
     ts: NOW - DAY, service: null });
  const cBF = botChats[2];
  M({ chatId: cBF.id, senderId: botFather.id, ts: NOW - DAY,
     text: "I can help you create and manage Telegram bots.\n\nYou can control me by sending these commands:\n\n/newbot - create a new bot\n/mybots - edit your bots\n/help - this message" });

  console.log('Seeded:',
    d.users.length, 'users,', d.chats.length, 'chats,', d.messages.length, 'messages.');
  console.log('Demo logins (username / password): alice / demo, boris / demo, chloe / demo, dan / demo, eve / demo');
  DB.flushNow();
}

if (require.main === module) {
  DB.load();
  seed();
  process.exit(0);
}

module.exports = { seed, hash, COLORS };
