'use strict';
/**
 * Minimal SMTP client (no dependencies). Supports:
 *  - implicit TLS (port 465)  -> secure: true
 *  - STARTTLS (port 587/25)   -> secure: false (upgrades automatically when the server offers it)
 *  - AUTH LOGIN / AUTH PLAIN
 *  - UTF-8 subjects/bodies, multipart/alternative (text + html)
 *
 *   sendMail({ host, port, secure, user, pass, from, to, subject, text, html, replyTo, timeout, insecure })
 */
const net = require('net');
const tls = require('tls');
const os = require('os');

const CRLF = '\r\n';
const NUL = String.fromCharCode(0);
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const isAscii = (s) => /^[ -~]*$/.test(s);
const encHeader = (s) => (isAscii(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/(.{76})/g, '$1' + CRLF);

function buildMessage({ from, to, subject, text, html, replyTo }) {
  const boundary = 'hh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const toList = Array.isArray(to) ? to : String(to).split(/[,;]\s*/).filter(Boolean);
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `From: ${from}`,
    `To: ${toList.join(', ')}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encHeader(subject)}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${os.hostname() || 'helihop'}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  const part = (type, body) => `--${boundary}${CRLF}Content-Type: ${type}; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${wrap76(b64(body))}${CRLF}`;
  let msg = headers.join(CRLF) + CRLF + CRLF + part('text/plain', text || '');
  if (html) msg += part('text/html', html);
  msg += `--${boundary}--${CRLF}`;
  return msg.replace(/\r\n\./g, '\r\n..'); // dot-stuffing
}

function sendMail(opts) {
  const { host, user, pass, from, to, timeout = 15000, insecure = false } = opts;
  const port = Number(opts.port) || (opts.secure ? 465 : 587);
  const secure = opts.secure != null ? !!opts.secure : port === 465;
  const toList = Array.isArray(to) ? to : String(to).split(/[,;]\s*/).filter(Boolean);
  const message = buildMessage({ ...opts, to: toList });
  const tlsOpts = { host, servername: host, rejectUnauthorized: !insecure };

  return new Promise((resolve, reject) => {
    let socket = null, buffer = '', done = false, timer = null;
    const queue = [];
    const fail = (err) => { if (done) return; done = true; clearTimeout(timer); try { socket && socket.destroy(); } catch (e) { /* noop */ } reject(err instanceof Error ? err : new Error(String(err))); };
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { socket && socket.end(); } catch (e) { /* noop */ } resolve(v); };
    const armTimeout = () => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('SMTP timeout')), timeout); };

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const lines = buffer.split(CRLF);
        let end = -1;
        for (let i = 0; i < lines.length - 1; i++) { if (/^\d{3}( |$)/.test(lines[i])) { end = i; break; } }
        if (end === -1) return;
        const reply = lines.slice(0, end + 1);
        buffer = lines.slice(end + 1).join(CRLF);
        const code = parseInt(reply[0].slice(0, 3), 10);
        const p = queue.shift();
        if (p) p.resolve({ code, lines: reply });
        else if (code >= 400) fail(new Error('SMTP error: ' + reply.join(' | ')));
      }
    };
    const attach = (s) => { socket = s; s.setEncoding('utf8'); s.on('data', onData); s.on('error', fail); s.on('close', () => { if (!done) fail(new Error('SMTP connection closed')); }); };
    const wait = () => new Promise((res, rej) => { queue.push({ resolve: res, reject: rej }); armTimeout(); });
    const cmd = async (line, okCodes = [250]) => {
      const p = wait();
      socket.write(line + CRLF);
      const r = await p;
      if (!okCodes.includes(r.code)) throw new Error(`SMTP "${line.split(' ')[0]}" failed: ${r.lines.join(' | ')}`);
      return r;
    };

    (async () => {
      const greeting = wait();
      attach(secure ? tls.connect({ ...tlsOpts, port }) : net.connect({ host, port }));
      const g = await greeting;
      if (g.code !== 220) throw new Error('SMTP greeting failed: ' + g.lines.join(' | '));
      const name = os.hostname() || 'localhost';
      let ehlo = await cmd(`EHLO ${name}`);
      if (!secure && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
        await cmd('STARTTLS', [220]);
        const plain = socket;
        plain.removeAllListeners('data'); plain.removeAllListeners('close'); plain.removeAllListeners('error');
        await new Promise((res, rej) => { const s = tls.connect({ ...tlsOpts, socket: plain }, () => { attach(s); res(); }); s.once('error', rej); });
        ehlo = await cmd(`EHLO ${name}`);
      }
      if (user && pass) {
        const auths = ehlo.lines.find((l) => /^250[ -]AUTH/i.test(l)) || '';
        if (/PLAIN/i.test(auths) && !/LOGIN/i.test(auths)) {
          await cmd(`AUTH PLAIN ${b64(NUL + user + NUL + pass)}`, [235]);
        } else {
          await cmd('AUTH LOGIN', [334]);
          await cmd(b64(user), [334]);
          await cmd(b64(pass), [235]);
        }
      }
      const fromAddr = (/<([^>]+)>/.exec(from) || [null, from])[1];
      await cmd(`MAIL FROM:<${fromAddr}>`);
      for (const rcpt of toList) { const a = (/<([^>]+)>/.exec(rcpt) || [null, rcpt])[1]; await cmd(`RCPT TO:<${a}>`, [250, 251]); }
      await cmd('DATA', [354]);
      const dataReply = wait();
      socket.write(message + CRLF + '.' + CRLF);
      const r = await dataReply;
      if (r.code !== 250) throw new Error('SMTP DATA failed: ' + r.lines.join(' | '));
      try { await cmd('QUIT', [221, 250]); } catch (e) { /* ignore */ }
      finish({ ok: true, response: r.lines.join(' ') });
    })().catch(fail);
  });
}

module.exports = { sendMail, buildMessage };
