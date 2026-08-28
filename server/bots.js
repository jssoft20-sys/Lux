'use strict';
/*
 * Minimal server-side bot engine. When a user sends a message to a bot chat,
 * the bot may reply (optionally with inline keyboard buttons or a poll).
 * Deliberately tiny and neutral — echo / help / poll / stickers / BotFather-style.
 */
const DB = require('./db');

const STICKERS = ['🐻', '🐸', '🍑', '🦊', '🦁', '🐼', '🐧', '🐨', '🐵', '🦄'];

function botFor(chat) {
  const botId = chat.members.find((mid) => {
    const u = DB.byId('users', mid);
    return u && u.isBot;
  });
  return botId ? DB.byId('users', botId) : null;
}

// Returns an array of message drafts (without id/chatId/senderId/ts).
function respond(bot, text, fromUser) {
  const engine = bot.botInfo && bot.botInfo.engine;
  const t = (text || '').trim();
  const cmd = t.startsWith('/') ? t.slice(1).split(/[\s@]/)[0].toLowerCase() : null;

  if (engine === 'echo') {
    if (cmd === 'start') return [{ text: 'Echo bot started ✅ Send me any text and I will echo it back.' }];
    if (cmd === 'help') return [{ text: 'Just type something. /time for server time.' }];
    if (cmd === 'time') return [{ text: '🕒 Server time: ' + new Date().toUTCString() }];
    if (!t) return [{ text: '(nothing to echo)' }];
    return [{ text: t }];
  }

  if (engine === 'poll') {
    if (cmd === 'start') return [{ text: 'Send /poll Question | Option A | Option B | ... to create a poll.' }];
    if (cmd === 'poll') {
      const rest = t.replace(/^\/poll\s*/i, '');
      const parts = rest.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) return [{ text: 'Usage: /poll Question | Option A | Option B' }];
      const [question, ...options] = parts;
      return [{ text: '', poll: { question, options, multiple: false, quiz: false } }];
    }
    return [{ text: 'I only understand /poll. Try /poll Best language? | JS | Python | Rust' }];
  }

  if (engine === 'sticker') {
    if (cmd === 'start') return [{ text: 'Press /random for a sticker!' }];
    const s = STICKERS[Math.floor((Date.now() / 1000) % STICKERS.length)];
    return [{ text: '', media: { kind: 'sticker', emoji: s } }];
  }

  if (engine === 'botfather') {
    if (cmd === 'newbot') return [{ text: "Alright, a new bot. How are we going to call it? Please choose a name for your bot." }];
    if (cmd === 'mybots') return [{ text: 'You have no bots yet. Use /newbot to create one.' }];
    return [{ text: "I can help you create and manage bots.\n\n/newbot - create a new bot\n/mybots - edit your bots\n/help - commands",
      keyboard: [[{ text: '/newbot' }, { text: '/mybots' }], [{ text: '/help' }]] }];
  }

  // default
  return [{ text: 'Beep boop 🤖 (' + (bot.name || 'bot') + ')' }];
}

module.exports = { botFor, respond, STICKERS };
