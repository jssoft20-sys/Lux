'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const DB = require('./db');
const socket = require('./socket');
const routes = require('./routes');
const seed = require('./seed');

const PORT = process.env.PORT || 8044;
const HOST = process.env.HOST || '0.0.0.0';

DB.load();
// Seed on first run (no users yet).
if (DB.all('users').length === 0) {
  console.log('Empty database — seeding demo data…');
  seed.seed();
}

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// static
const PUBLIC = path.join(__dirname, '..', 'public');
const UPLOADS = path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(PUBLIC, { maxAge: 0, etag: false }));

app.get('/health', (req, res) => res.json({ ok: true, users: DB.all('users').length,
  chats: DB.all('chats').length, messages: DB.all('messages').length }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 30 * 1024 * 1024 });
const hub = socket.attach(io);

routes.register(app, io, hub);

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

server.listen(PORT, HOST, () => {
  const nets = require('os').networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) for (const n of nets[name]) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   Telegram clone is running                    ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('   Local:   http://localhost:' + PORT);
  for (const ip of ips) console.log('   Network: http://' + ip + ':' + PORT);
  console.log('   Demo logins: alice / demo   (also boris, chloe, dan, eve)');
  console.log('');
});

process.on('SIGINT', () => { DB.flushNow(); process.exit(0); });
process.on('SIGTERM', () => { DB.flushNow(); process.exit(0); });
