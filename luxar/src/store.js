import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { defaultSettings } from './defaults.js';

/*
 * Простое встроенное хранилище: все данные в data/db.json.
 * Запись атомарная (tmp + rename), чтобы файл не повредился при сбое питания.
 * Объём данных небольшой (машины, брони, клиенты, платежи), поэтому JSON достаточно;
 * репозиторный слой (методы ниже) позволяет позже перейти на SQL без переписывания логики.
 */

const COLLECTIONS = ['cars', 'clients', 'bookings', 'payments', 'mailLog', 'notifications', 'activity', 'sessions'];

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra === undefined ? base : extra;
  if (typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const key of Object.keys(extra || {})) {
    const b = base[key];
    const e = extra[key];
    if (e && typeof e === 'object' && !Array.isArray(e) && b && typeof b === 'object' && !Array.isArray(b)) out[key] = deepMerge(b, e);
    else if (e !== undefined) out[key] = e;
  }
  return out;
}

export class Store {
  constructor(file = path.join(DATA_DIR, 'db.json')) {
    this.file = file;
    this.data = null;
    this.saveTimer = null;
    this.load();
  }

  load() {
    let raw = null;
    if (fs.existsSync(this.file)) {
      try {
        raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (err) {
        const broken = this.file + '.broken-' + Date.now();
        fs.copyFileSync(this.file, broken);
        console.error(`[store] db.json повреждён, копия сохранена в ${broken}:`, err.message);
      }
    }
    raw = raw || {};
    this.data = {
      settings: deepMerge(defaultSettings(), raw.settings || {}),
      auth: raw.auth || null,
      counters: { booking: 1000, ...(raw.counters || {}) },
      meta: { createdAt: new Date().toISOString(), lastBaseUrl: '', ...(raw.meta || {}) },
    };
    for (const c of COLLECTIONS) this.data[c] = Array.isArray(raw[c]) ? raw[c] : [];
  }

  /* Синхронная атомарная запись. Вызывается после каждого изменения. */
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  /* Отложенная запись: несколько изменений подряд объединяются в одну. */
  touch() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try { this.save(); } catch (err) { console.error('[store] ошибка записи:', err.message); }
    }, 50);
  }

  flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.save();
  }

  backup(keep = 30) {
    const dir = path.join(DATA_DIR, 'backups');
    const name = 'db-' + new Date().toISOString().slice(0, 10) + '.json';
    const target = path.join(dir, name);
    if (fs.existsSync(target)) return;
    this.flush();
    fs.copyFileSync(this.file, target);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('db-')).sort();
    while (files.length > keep) fs.unlinkSync(path.join(dir, files.shift()));
  }

  /* ---------- generic helpers ---------- */
  get settings() { return this.data.settings; }

  list(col) { return this.data[col]; }

  get(col, id) { return this.data[col].find((x) => x.id === id) || null; }

  find(col, fn) { return this.data[col].find(fn) || null; }

  filter(col, fn) { return this.data[col].filter(fn); }

  insert(col, doc) {
    this.data[col].push(doc);
    this.touch();
    return doc;
  }

  update(col, id, patch) {
    const doc = this.get(col, id);
    if (!doc) return null;
    Object.assign(doc, typeof patch === 'function' ? patch(doc) : patch, { updatedAt: new Date().toISOString() });
    this.touch();
    return doc;
  }

  remove(col, id) {
    const idx = this.data[col].findIndex((x) => x.id === id);
    if (idx < 0) return false;
    this.data[col].splice(idx, 1);
    this.touch();
    return true;
  }

  nextCounter(name) {
    this.data.counters[name] = (this.data.counters[name] || 0) + 1;
    this.touch();
    return this.data.counters[name];
  }

  updateSettings(section, patch) {
    if (!(section in this.data.settings)) throw new Error('Неизвестный раздел настроек: ' + section);
    this.data.settings[section] = deepMerge(this.data.settings[section], patch);
    this.touch();
    return this.data.settings[section];
  }

  log(type, message, meta = {}) {
    const entry = { id: cryptoId(), at: new Date().toISOString(), type, message, meta };
    this.data.activity.push(entry);
    if (this.data.activity.length > 5000) this.data.activity.splice(0, this.data.activity.length - 5000);
    this.touch();
    return entry;
  }
}

export function cryptoId() {
  return globalThis.crypto.randomUUID();
}

export const store = new Store();
