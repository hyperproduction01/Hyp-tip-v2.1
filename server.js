import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import generatePayload from 'promptpay-qr';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SITE_NAME = process.env.SITE_NAME || 'HYP TIP';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const RDCW_CLIENT_ID = process.env.RDCW_CLIENT_ID || '';
const RDCW_CLIENT_SECRET = process.env.RDCW_CLIENT_SECRET || '';
const RDCW_API_URL = process.env.RDCW_API_URL || 'https://suba.rdcw.co.th/v2/inquiry';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'slips');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------------------------- DB ---------------------------------- */
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  promptpay_id TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  min_amount INTEGER NOT NULL DEFAULT 20,
  alert_seconds INTEGER NOT NULL DEFAULT 8,
  accent TEXT NOT NULL DEFAULT '#ef2b2d',
  tts INTEGER NOT NULL DEFAULT 1,
  min_tts INTEGER NOT NULL DEFAULT 50,
  blocked_words TEXT DEFAULT '',
  overlay_token TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  tip_goal_amount INTEGER DEFAULT 0,
  tip_goal_current INTEGER DEFAULT 0,
  avatar_url TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  user_agent TEXT DEFAULT '',
  ip_address TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  donor_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  message TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  ref TEXT UNIQUE NOT NULL,
  slip TEXT DEFAULT '',
  slip_hash TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  verified_by TEXT DEFAULT '',
  verify_note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_don_user ON donations(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_don_slip_hash ON donations(slip_hash);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 0,
  quota_alerts INTEGER NOT NULL DEFAULT 0,
  features TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  package_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS slip_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donation_id INTEGER,
  file_path TEXT DEFAULT '',
  slip_hash TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  amount_detected REAL DEFAULT 0,
  ref_detected TEXT DEFAULT '',
  raw_response TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_slip_donation ON slip_verifications(donation_id);
CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT DEFAULT '',
  target_id INTEGER DEFAULT 0,
  details TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  reason TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
);
`);
// migration: columns added after first release
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('tts_rate')) db.exec('ALTER TABLE users ADD COLUMN tts_rate REAL NOT NULL DEFAULT 1');
  if (!cols.includes('tts_volume')) db.exec('ALTER TABLE users ADD COLUMN tts_volume REAL NOT NULL DEFAULT 1');
  if (!cols.includes('tts_pitch')) db.exec('ALTER TABLE users ADD COLUMN tts_pitch REAL NOT NULL DEFAULT 1');
  if (!cols.includes('last_login_at')) db.exec('ALTER TABLE users ADD COLUMN last_login_at INTEGER');
  if (!cols.includes('tip_goal_amount')) db.exec('ALTER TABLE users ADD COLUMN tip_goal_amount INTEGER DEFAULT 0');
  if (!cols.includes('tip_goal_current')) db.exec('ALTER TABLE users ADD COLUMN tip_goal_current INTEGER DEFAULT 0');
  if (!cols.includes('avatar_url')) db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ""');
}
{
  const cols = db.prepare('PRAGMA table_info(donations)').all().map(c => c.name);
  if (!cols.includes('slip_hash')) db.exec('ALTER TABLE donations ADD COLUMN slip_hash TEXT DEFAULT ""');
  if (!cols.includes('verified_by')) db.exec('ALTER TABLE donations ADD COLUMN verified_by TEXT DEFAULT ""');
  if (!cols.includes('verify_note')) db.exec('ALTER TABLE donations ADD COLUMN verify_note TEXT DEFAULT ""');
}

const now = () => Date.now();
const rand = (n = 24) => crypto.randomBytes(n).toString('base64url');
const sha256 = (buf) => crypto.createHash('sha256').update(buf || '').digest('hex');

/* -------------------------------- helpers ------------------------------- */
const RESERVED = new Set([
  'api', 'auth', 'login', 'register', 'dashboard', 'admin', 'overlay', 'css', 'js', 'img', 'uploads',
  'static', 'public', 'assets', 'favicon', 'robots', 'terms', 'privacy', 'about', 'help', 'support',
  'index', 'donate', 'settings', 'logout', 'null', 'undefined'
]);
const DEFAULT_BAD = ['เหี้ย', 'สัส', 'ควาย', 'fuck', 'shit', 'bitch', 'หี', 'เย็ด'];

function maskWords(text, extra = '') {
  const list = [...DEFAULT_BAD, ...extra.split(',').map(s => s.trim()).filter(Boolean)];
  let out = text;
  for (const w of list) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, m => '*'.repeat(m.length));
  }
  return out;
}
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// แปลงตัวเลขเป็นคำอ่านภาษาไทย เช่น 1500 -> "หนึ่งพันห้าร้อย"
function thaiNumber(input) {
  const n = Math.floor(Math.abs(Number(input) || 0));
  if (n === 0) return 'ศูนย์';
  if (n > 999999999999) return String(n);
  const dig = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const unit = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const readChunk = x => {
    const s = String(x); let out = '';
    for (let i = 0; i < s.length; i++) {
      const d = +s[i], pos = s.length - i - 1;
      if (d === 0) continue;
      if (pos === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : dig[d] + 'สิบ';
      else if (pos === 0) out += (d === 1 && s.length > 1) ? 'เอ็ด' : dig[d];
      else out += dig[d] + unit[pos];
    }
    return out;
  };
  const groups = []; let x = n;
  while (x > 0) { groups.push(x % 1000000); x = Math.floor(x / 1000000); }
  let out = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0 && !(i === 0 && out === '')) continue;
    out += readChunk(groups[i]) + (i > 0 ? 'ล้าน'.repeat(i) : '');
  }
  return out;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const buckets = new Map();
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const t = now();
    const b = (buckets.get(key) || []).filter(x => t - x < windowMs);
    if (b.length >= max) return res.status(429).json({ error: 'ส่งคำขอถี่เกินไป โปรดลองใหม่ภายหลัง' });
    b.push(t);
    buckets.set(key, b);
    next();
  };
}
setInterval(() => { const t = now(); for (const [k, v] of buckets) if (!v.some(x => t - x < 3600e3)) buckets.delete(k); }, 600e3).unref();

const publicUser = u => ({
  id: u.id, email: u.email, username: u.username, displayName: u.display_name, role: u.role,
  promptpayId: u.promptpay_id, bio: u.bio, minAmount: u.min_amount, alertSeconds: u.alert_seconds,
  accent: u.accent, tts: !!u.tts, minTts: u.min_tts, blockedWords: u.blocked_words, overlayToken: u.overlay_token,
  ttsRate: u.tts_rate ?? 1, ttsVolume: u.tts_volume ?? 1, ttsPitch: u.tts_pitch ?? 1,
  tipGoalAmount: u.tip_goal_amount ?? 0, avatarUrl: u.avatar_url ?? ''
});

/* --------------------------------- app ---------------------------------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ========================================================================== */
/*                   โหมดปิดปรับปรุงระบบ (Maintenance Mode)                    */
/* ========================================================================== */
// เปลี่ยนเป็น false เมื่อต้องการเปิดใช้งานเว็บไซต์ตามปกติ
const IS_MAINTENANCE = false;

app.use((req, res, next) => {
    if (IS_MAINTENANCE) {
        // ส่งไฟล์ HTML ปิดปรับปรุงสีแดง พร้อมสถานะ 503
        return res.status(503).sendFile(path.join(__dirname, 'maintenance.html'));
    }
    next();
});
/* ========================================================================== */

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (!req.path.startsWith('/overlay/')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
const jsonParser = express.json({ limit: '50kb' });
app.use((req, res, next) => (req.path === '/api/webhook/payment' ? next() : jsonParser(req, res, next)));

// auth
app.use((req, res, next) => {
  const sid = parseCookies(req).sid;
  req.user = null;
  if (sid) {
    const s = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires > ?').get(sid, now());
    if (s) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
      if (u && !u.banned) req.user = u;
    }
  }
  next();
});
// CSRF: state-changing API calls must carry a custom header (cannot be sent cross-site without CORS)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/webhook/payment') return next();
  if (req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: 'forbidden' });
  next();
});
function needAuthLocal(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  next();
}
function isSuperAdminLocal(user) {
  if (!user) return false;
  const email = user.email?.toLowerCase();
  if (user.role === 'super_admin') return true;
  if (email && SUPER_ADMIN_EMAILS.includes(email)) return true;
  return false;
}
function needAdminLocal(req, res, next) {
  if (!req.user) return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || isSuperAdminLocal(req.user)) return next();
  return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
}
function needSuperAdminLocal(req, res, next) {
  if (!req.user || !isSuperAdminLocal(req.user)) return res.status(403).json({ error: 'ต้องเป็น Super Admin เท่านั้น' });
  next();
}
const needAuth = needAuthLocal;
const needAdmin = needAdminLocal;
const needSuperAdmin = needSuperAdminLocal;

function startSession(req, res, userId) {
  const token = rand(32);
  const ttl = 30 * 24 * 3600e3;
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)').run(token, userId, now() + ttl);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl / 1000}${secure}`);
}

/* --------------------------- realtime (SSE) ------------------------------ */
const overlayClients = new Map(); // overlay token -> Set<res>
const dashClients = new Map();    // user id -> Set<res> (แดชบอร์ดของสตรีมเมอร์/แอดมิน)
const refClients = new Map();     // donation ref -> Set<res> (หน้าจ่ายเงินของผู้โดเนท)
const adminClients = new Set();   // subset ของ dashClients ที่เป็นแอดมิน

function sseWrite(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}
function pushToOverlay(token, event, data) {
  const set = overlayClients.get(token);
  if (!set) return 0;
  for (const res of set) sseWrite(res, event, data);
  return set.size;
}
function pushToDash(userId, event, data) {
  const set = dashClients.get(userId);
  if (!set) return 0;
  for (const res of set) sseWrite(res, event, data);
  return set.size;
}
function pushToAdmins(event, data) { for (const res of adminClients) sseWrite(res, event, data); }
function pushToRef(ref, event, data) {
  const set = refClients.get(ref);
  if (!set) return 0;
  for (const res of set) sseWrite(res, event, data);
  return set.size;
}
function sseStart(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  sseWrite(res, 'hello', {});
  return setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
}
function sseJoin(map, key, res) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(res);
}
function sseLeave(map, key, res) {
  const set = map.get(key);
  if (set) { set.delete(res); if (!set.size) map.delete(key); }
}

function alertPayload(u, d) {
  const name = maskWords(d.donor_name, u.blocked_words);
  const message = maskWords(d.message || '', u.blocked_words);
  return {
    id: d.id,
    name,
    amount: d.amount,
    message,
    seconds: u.alert_seconds,
    accent: u.accent,
    speak: !!u.tts && d.amount >= u.min_tts && !!d.message,
    rate: u.tts_rate ?? 1,
    volume: u.tts_volume ?? 1,
    pitch: u.tts_pitch ?? 1,
    speech: `${name} โดเนท ${thaiNumber(d.amount)} บาท${message ? ' ' + message : ''}`
  };
}
function markPaid(donationId) {
  const d = db.prepare('SELECT * FROM donations WHERE id = ?').get(donationId);
  if (!d || d.status === 'paid') return null;
  db.prepare("UPDATE donations SET status='paid', paid_at=? WHERE id=?").run(now(), d.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(d.user_id);
  try { db.prepare('UPDATE users SET tip_goal_current = COALESCE(tip_goal_current,0) + ? WHERE id=?').run(d.amount, d.user_id); } catch (_) {}
  pushToOverlay(u.overlay_token, 'donation', alertPayload(u, d));
  const summary = { id: d.id, donor_name: d.donor_name, amount: d.amount, message: d.message, created_at: d.created_at, paid_at: now(), username: u.username };
  pushToDash(u.id, 'donation-paid', summary);
  pushToAdmins('admin-donation', { action: 'paid', ...summary });
  pushToRef(d.ref, 'status', { status: 'paid' });
  return d;
}
function markRejected(d) {
  db.prepare("UPDATE donations SET status='rejected' WHERE id=?").run(d.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(d.user_id);
  pushToDash(u.id, 'donation-rejected', { id: d.id, donor_name: d.donor_name, amount: d.amount });
  pushToAdmins('admin-donation', { action: 'rejected', id: d.id, username: u.username, donor_name: d.donor_name, amount: d.amount });
  pushToRef(d.ref, 'status', { status: 'rejected' });
}

/* --------------------------- RDCW slip verification ---------------------- */
function rdcwEnabled() { return !!(RDCW_CLIENT_ID && RDCW_CLIENT_SECRET); }

async function rdcwInquiry(filePath) {
  if (!rdcwEnabled()) throw new Error('RDCW not configured');
  const auth = 'Basic ' + Buffer.from(`${RDCW_CLIENT_ID}:${RDCW_CLIENT_SECRET}`).toString('base64');
  const form = new FormData();
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
  form.append('file', new Blob([buf], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }), path.basename(filePath));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(RDCW_API_URL, { method: 'POST', headers: { Authorization: auth }, body: form, signal: ctrl.signal });
    const text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!resp.ok) {
      const err = new Error(data?.message || `RDCW HTTP ${resp.status}`);
      err.code = data?.code || resp.status;
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

// ดึง fields ที่เป็นประโยชน์จากผล RDCW (รองรับหลาย shape ของ response)
function parseRdcwResult(raw) {
  const src = raw?.data || raw?.result || raw || {};
  const amt = src.amount ?? src.transaction?.amount ?? src.sending?.amount ?? src.data?.amount ?? 0;
  const ref = src.transRef ?? src.reference ?? src.transaction?.transRef ?? src.sending?.transRef ?? src.data?.transRef ?? '';
  const sender = src.sending?.name ?? src.sender?.name ?? src.data?.sending?.name ?? '';
  const receiver = src.receiving?.name ?? src.receiver?.name ?? src.data?.receiving?.name ?? '';
  return { amount: Number(amt) || 0, ref: String(ref || ''), sender, receiver };
}

async function verifySlipForDonation(donation, filePath) {
  const createdAt = now();
  const slipHash = donation.slip_hash || '';
  // ป้องกันสลิปซ้ำ: ถ้า slip_hash นี้เคยผ่านการ verify แล้ว (status ok) กับรายการอื่น ให้บล็อก
  if (slipHash) {
    const dup = db.prepare(`SELECT dv.id FROM slip_verifications dv
      JOIN donations d ON d.id = dv.donation_id
      WHERE dv.slip_hash = ? AND dv.status = 'ok' AND d.id != ? LIMIT 1`).get(slipHash, donation.id);
    if (dup) {
      db.prepare(`INSERT INTO slip_verifications (donation_id, file_path, slip_hash, status, error, created_at)
        VALUES (?,?,?,?,?,?)`).run(donation.id, filePath, slipHash, 'duplicate', 'สลิปนี้ถูกใช้กับรายการอื่นไปแล้ว', createdAt);
      db.prepare("UPDATE donations SET verify_note=? WHERE id=?").run('สลิปซ้ำ', donation.id);
      return { ok: false, reason: 'duplicate', message: 'สลิปนี้ถูกใช้ไปแล้ว' };
    }
  }
  let raw = null, status = 'error', error = '', amount = 0, refDetected = '';
  try {
    raw = await rdcwInquiry(filePath);
    const parsed = parseRdcwResult(raw);
    amount = parsed.amount; refDetected = parsed.ref;
    if (parsed.amount > 0 && Math.abs(parsed.amount - donation.amount) < 0.01) {
      status = 'ok';
    } else if (parsed.amount > 0) {
      status = 'amount_mismatch'; error = `ยอดไม่ตรง (สลิป ${parsed.amount} / รายการ ${donation.amount})`;
    } else {
      status = 'no_amount'; error = 'ไม่พบยอดเงินในผลตรวจสอบ';
    }
  } catch (e) {
    status = 'error'; error = e.message || 'RDCW error';
  }
  db.prepare(`INSERT INTO slip_verifications (donation_id, file_path, slip_hash, status, amount_detected, ref_detected, raw_response, error, created_at, verified_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(donation.id, filePath, slipHash, status, amount, refDetected,
    raw ? JSON.stringify(raw).slice(0, 4000) : '', error, createdAt, now());
  if (status === 'ok') {
    db.prepare("UPDATE donations SET verify_note=? WHERE id=?").run('ตรวจสอบผ่านอัตโนมัติ', donation.id);
    return { ok: true, reason: 'ok', message: 'ตรวจสอบผ่าน' };
  }
  db.prepare("UPDATE donations SET verify_note=? WHERE id=?").run(error || status, donation.id);
  return { ok: false, reason: status, message: error || 'รอตรวจสอบด้วยตนเอง' };
}

/* --------------------------------- auth API ------------------------------ */
app.post('/api/register', limit('reg', 8, 3600e3), (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const username = clean(req.body.username, 20).toLowerCase();
  const displayName = clean(req.body.displayName, 40) || username;
  const password = String(req.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 _ ยาว 3-20 ตัวอักษร' });
  if (RESERVED.has(username)) return res.status(400).json({ error: 'ชื่อผู้ใช้นี้ถูกสงวนไว้' });
  if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ? OR username = ?').get(email, username))
    return res.status(409).json({ error: 'อีเมลหรือชื่อผู้ใช้นี้ถูกใช้แล้ว' });
  let role = 'user';
  if (SUPER_ADMIN_EMAILS.includes(email)) role = 'super_admin';
  else if (ADMIN_EMAIL && email === ADMIN_EMAIL) role = 'admin';
  const info = db.prepare(`INSERT INTO users (email, username, display_name, password_hash, role, overlay_token, created_at)
    VALUES (?,?,?,?,?,?,?)`).run(email, username, displayName, bcrypt.hashSync(password, 10), role, rand(18), now());
  startSession(req, res, Number(info.lastInsertRowid));
  res.json({ ok: true });
});

app.post('/api/login', limit('login', 20, 900e3), (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const pass = String(req.body.password || '');
  if (!email || !pass) {
    try { db.prepare('INSERT INTO login_logs (user_id, email, ip_address, user_agent, success, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(null, email, req.ip, req.get('user-agent') || '', 0, 'missing', now()); } catch (_) {}
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  }
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u) {
    try { db.prepare('INSERT INTO login_logs (user_id, email, ip_address, user_agent, success, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(null, email, req.ip, req.get('user-agent') || '', 0, 'not_found', now()); } catch (_) {}
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (u.banned) {
    try { db.prepare('INSERT INTO login_logs (user_id, email, ip_address, user_agent, success, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(u.id, email, req.ip, req.get('user-agent') || '', 0, 'banned', now()); } catch (_) {}
    return res.status(403).json({ error: 'บัญชีนี้ถูกระงับ' });
  }
  if (!bcrypt.compareSync(pass, u.password_hash)) {
    try { db.prepare('INSERT INTO login_logs (user_id, email, ip_address, user_agent, success, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(u.id, email, req.ip, req.get('user-agent') || '', 0, 'wrong_pass', now()); } catch (_) {}
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (SUPER_ADMIN_EMAILS.includes(u.email) && u.role !== 'super_admin') db.prepare("UPDATE users SET role='super_admin' WHERE id=?").run(u.id);
  else if (ADMIN_EMAIL && u.email === ADMIN_EMAIL && u.role !== 'admin') db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);
  try { db.prepare('INSERT INTO login_logs (user_id, email, ip_address, user_agent, success, reason, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(u.id, email, req.ip, req.get('user-agent') || '', 1, 'ok', now()); db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), u.id); } catch (_) {}
  startSession(req, res, u.id);
  res.json({ ok: true, user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null, siteName: SITE_NAME }));

app.get('/api/public/stats', (req, res) => {
  const a = db.prepare('SELECT COUNT(*) c FROM users WHERE banned = 0').get().c;
  const b = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM donations WHERE status='paid'").get();
  res.json({ streamers: a, donations: b.c, total: b.s });
});

/* --------------------------- streamer settings API ----------------------- */
app.patch('/api/settings', needAuth, (req, res) => {
  const b = req.body || {};
  const promptpay = String(b.promptpayId ?? '').replace(/[\s-]/g, '');
  if (promptpay && !/^(\d{10}|\d{13}|\d{15})$/.test(promptpay))
    return res.status(400).json({ error: 'PromptPay ต้องเป็นเบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก' });
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : req.user.accent;
  const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const flt = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  db.prepare(`UPDATE users SET display_name=?, bio=?, promptpay_id=?, min_amount=?, alert_seconds=?, accent=?, tts=?, min_tts=?, blocked_words=?, tts_rate=?, tts_volume=?, tts_pitch=?, tip_goal_amount=? WHERE id=?`)
    .run(clean(b.displayName, 40) || req.user.display_name, clean(b.bio, 200), promptpay,
      int(b.minAmount, 1, 100000, 20), int(b.alertSeconds, 3, 30, 8), accent, b.tts ? 1 : 0,
      int(b.minTts, 1, 100000, 50), clean(b.blockedWords, 300),
      flt(b.ttsRate, 0.5, 2, 1), flt(b.ttsVolume, 0, 1, 1), flt(b.ttsPitch, 0.5, 2, 1),
      int(b.tipGoalAmount, 0, 100000000, 0), req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

app.post('/api/dashboard/rotate-token', needAuth, (req, res) => {
  const old = req.user.overlay_token;
  const t = rand(18);
  db.prepare('UPDATE users SET overlay_token=? WHERE id=?').run(t, req.user.id);
  const set = overlayClients.get(old);
  if (set) { for (const r of set) r.end(); overlayClients.delete(old); }
  res.json({ overlayToken: t });
});

app.get('/api/dashboard/summary', needAuth, (req, res) => {
  const paid = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='paid'").get(req.user.id);
  const month = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='paid' AND paid_at >= ?")
    .get(req.user.id, now() - 30 * 86400e3).s;
  const pending = db.prepare("SELECT COUNT(*) c FROM donations WHERE user_id=? AND status='pending'").get(req.user.id).c;
  res.json({ count: paid.c, total: paid.s, month, pending });
});

app.get('/api/dashboard/donations', needAuth, (req, res) => {
  const status = ['pending', 'paid', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT id, donor_name, amount, message, status, slip != '' AS has_slip, created_at, paid_at FROM donations
    WHERE user_id = ? ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC LIMIT 200`)
    .all(...(status ? [req.user.id, status] : [req.user.id]));
  res.json({ donations: rows });
});

function ownDonation(req, res) {
  const d = db.prepare('SELECT * FROM donations WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
  if (!d) res.status(404).json({ error: 'ไม่พบรายการ' });
  return d;
}
app.post('/api/dashboard/donations/:id/approve', needAuth, (req, res) => {
  const d = ownDonation(req, res); if (!d) return;
  if (d.status === 'rejected') return res.status(400).json({ error: 'รายการนี้ถูกปฏิเสธไปแล้ว' });
  markPaid(d.id);
  try { db.prepare('UPDATE donations SET verified_by=? WHERE id=?').run(req.user.username || req.user.email, d.id); } catch (_) {}
  res.json({ ok: true });
});
app.post('/api/dashboard/donations/:id/reject', needAuth, (req, res) => {
  const d = ownDonation(req, res); if (!d) return;
  if (d.status === 'paid') return res.status(400).json({ error: 'รายการนี้ยืนยันไปแล้ว' });
  markRejected(d);
  try { db.prepare('UPDATE donations SET verified_by=? WHERE id=?').run(req.user.username || req.user.email, d.id); } catch (_) {}
  res.json({ ok: true });
});
app.post('/api/dashboard/donations/:id/replay', needAuth, (req, res) => {
  const d = ownDonation(req, res); if (!d) return;
  if (d.status !== 'paid') return res.status(400).json({ error: 'เล่นซ้ำได้เฉพาะรายการที่ยืนยันแล้ว' });
  res.json({ ok: true, clients: pushToOverlay(req.user.overlay_token, 'donation', alertPayload(req.user, d)) });
});
app.post('/api/dashboard/test-alert', needAuth, (req, res) => {
  const fake = { id: 0, donor_name: 'ผู้ใช้ทดสอบ', amount: 100, message: 'ทดสอบระบบแจ้งเตือน ขอบคุณที่สตรีมนะครับ' };
  const clients = pushToOverlay(req.user.overlay_token, 'donation', alertPayload(req.user, fake));
  res.json({ ok: true, clients });
});
app.get('/api/dashboard/slip/:id', needAuth, (req, res) => {
  const d = ownDonation(req, res); if (!d) return;
  if (!d.slip) return res.status(404).json({ error: 'ไม่มีสลิป' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(d.slip)));
});

/* ------------------------------ public donate API ------------------------ */
function findStreamer(username) {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND banned = 0').get(String(username).toLowerCase());
  return u || null;
}
app.get('/api/streamer/:username', (req, res) => {
  const u = findStreamer(req.params.username);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้รับโดเนท' });
  res.json({
    username: u.username, displayName: u.display_name, bio: u.bio, minAmount: u.min_amount,
    accent: u.accent, ready: !!u.promptpay_id, siteName: SITE_NAME,
    tipGoalAmount: u.tip_goal_amount ?? 0, tipGoalCurrent: u.tip_goal_current ?? 0, avatarUrl: u.avatar_url ?? ''
  });
});

app.post('/api/streamer/:username/donate', limit('donate', 15, 600e3), async (req, res) => {
  const u = findStreamer(req.params.username);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้รับโดเนท' });
  if (!u.promptpay_id) return res.status(400).json({ error: 'ผู้รับยังไม่ได้ตั้งค่าช่องทางรับเงิน' });
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isInteger(amount) || amount < u.min_amount) return res.status(400).json({ error: `ขั้นต่ำ ${u.min_amount} บาท` });
  if (amount > 50000) return res.status(400).json({ error: 'สูงสุด 50,000 บาทต่อครั้ง' });
  const name = clean(req.body.name, 30) || 'ผู้ไม่ประสงค์ออกนาม';
  const message = clean(req.body.message, 200);
  const ref = rand(9);
  const info = db.prepare('INSERT INTO donations (user_id, donor_name, amount, message, ref, created_at) VALUES (?,?,?,?,?,?)')
    .run(u.id, name, amount, message, ref, now());
  // แจ้งแดชบอร์ดผู้รับแบบเรียลไทม์ทันที (ไม่ต้องรอรีเฟรช)
  pushToDash(u.id, 'donation-new', {
    id: Number(info.lastInsertRowid), donor_name: name, amount, message, status: 'pending', created_at: now(), has_slip: 0, ref
  });
  pushToAdmins('admin-donation', { action: 'new', username: u.username, donor_name: name, amount });
  const payload = generatePayload(u.promptpay_id, { amount });
  const qr = await QRCode.toDataURL(payload, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
  res.json({ ref, amount, qr });
});

app.get('/api/donation/:ref', (req, res) => {
  const d = db.prepare('SELECT status, amount FROM donations WHERE ref = ?').get(String(req.params.ref));
  if (!d) return res.status(404).json({ error: 'ไม่พบรายการ' });
  res.json(d);
});

// หน้าจ่ายเงินของผู้โดเนท: รอสถานะแบบเรียลไทม์ (แทนการ poll ทุก 3 วินาที)
app.get('/api/donation/:ref/stream', (req, res) => {
  const d = db.prepare('SELECT status FROM donations WHERE ref = ?').get(String(req.params.ref));
  if (!d) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const ping = sseStart(res);
  if (d.status !== 'pending') sseWrite(res, 'status', { status: d.status });
  const ref = String(req.params.ref);
  sseJoin(refClients, ref, res);
  req.on('close', () => { clearInterval(ping); sseLeave(refClients, ref, res); });
});

/* ------------------------- realtime for dashboard ------------------------ */
app.get('/api/dashboard/stream', needAuth, (req, res) => {
  const ping = sseStart(res);
  const uid = req.user.id;
  sseJoin(dashClients, uid, res);
  if (req.user.role === 'admin') adminClients.add(res);
  req.on('close', () => {
    clearInterval(ping);
    sseLeave(dashClients, uid, res);
    adminClients.delete(res);
  });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, rand(12) + ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype] || '.bin'))
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
});
app.post('/api/donation/:ref/slip', limit('slip', 10, 600e3), upload.single('slip'), async (req, res) => {
  const d = db.prepare('SELECT * FROM donations WHERE ref = ?').get(String(req.params.ref));
  if (!d || d.status !== 'pending') return res.status(400).json({ error: 'ไม่สามารถแนบสลิปได้' });
  if (!req.file) return res.status(400).json({ error: 'รองรับเฉพาะไฟล์ PNG/JPG/WEBP ไม่เกิน 3MB' });
  const filePath = path.join(UPLOAD_DIR, req.file.filename);
  let slipHash = '';
  try { slipHash = sha256(fs.readFileSync(filePath)); } catch (_) {}
  db.prepare('UPDATE donations SET slip = ?, slip_hash = ? WHERE id = ?').run(req.file.filename, slipHash, d.id);
  const updated = db.prepare('SELECT * FROM donations WHERE id = ?').get(d.id);
  // ตรวจสอบสลิปอัตโนมัติผ่าน RDCW ถ้าตั้งค่าไว้ (ไม่ block ถ้าล้มเหลว — ค้างรอตรวจด้วยตนเอง)
  let verify = { ok: false, reason: 'skipped', message: 'รอตรวจสอบ' };
  if (rdcwEnabled()) {
    try { verify = await verifySlipForDonation(updated, filePath); } catch (_) {}
    if (verify.ok) markPaid(updated.id);
  }
  res.json({ ok: true, verify: { status: verify.reason, message: verify.message } });
});

/* ------------------------------ overlay (OBS) ---------------------------- */
app.get('/api/overlay/:token/config', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE overlay_token = ? AND banned = 0').get(req.params.token);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ accent: u.accent, displayName: u.display_name });
});
app.get('/api/overlay/:token/stream', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE overlay_token = ? AND banned = 0').get(req.params.token);
  if (!u) return res.status(404).end();
  const ping = sseStart(res);
  sseJoin(overlayClients, u.overlay_token, res);
  req.on('close', () => { clearInterval(ping); sseLeave(overlayClients, u.overlay_token, res); });
});

/* ------------------------- payment webhook (gateway) --------------------- */
app.post('/api/webhook/payment', express.raw({ type: '*/*', limit: '20kb' }), (req, res) => {
  if (!WEBHOOK_SECRET) return res.status(503).json({ error: 'webhook disabled' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const sig = Buffer.from(String(req.get('x-signature') || ''), 'hex');
  const expect = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest();
  if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return res.status(401).json({ error: 'bad signature' });
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad json' }); }
  const d = db.prepare('SELECT * FROM donations WHERE ref = ?').get(String(body.ref || ''));
  if (!d) return res.status(404).json({ error: 'unknown ref' });
  if (body.status !== 'paid' || Number(body.amount) !== d.amount) return res.status(400).json({ error: 'status/amount mismatch' });
  markPaid(d.id);
  res.json({ ok: true });
});

/* --------------------------------- admin API ----------------------------- */
app.get('/api/admin/overview', needAuth, needAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.id, u.email, u.username, u.display_name, u.role, u.banned, u.created_at,
    (SELECT COUNT(*) FROM donations d WHERE d.user_id=u.id AND d.status='paid') AS paid_count,
    (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.user_id=u.id AND d.status='paid') AS paid_total
    FROM users u ORDER BY u.created_at DESC LIMIT 300`).all();
  const donations = db.prepare(`SELECT d.id, d.donor_name, d.amount, d.status, d.created_at, u.username
    FROM donations d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 100`).all();
  const t = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM donations WHERE status='paid'").get();
  res.json({ users, donations, totals: { users: users.length, paidCount: t.c, paidTotal: t.s } });
});

// สถิติสำหรับกราฟหน้าแอดมิน
app.get('/api/admin/stats', needAuth, needAdmin, (req, res) => {
  const dayMs = 86400e3;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const since = today.getTime() - 29 * dayMs;
  const totals = {
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    banned: db.prepare('SELECT COUNT(*) c FROM users WHERE banned=1').get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM donations WHERE status='pending'").get().c,
    paidCount: db.prepare("SELECT COUNT(*) c FROM donations WHERE status='paid'").get().c,
    paidTotal: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM donations WHERE status='paid'").get().s,
    todayCount: db.prepare("SELECT COUNT(*) c FROM donations WHERE status='paid' AND paid_at >= ?").get(today.getTime()).c,
    todayTotal: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM donations WHERE status='paid' AND paid_at >= ?").get(today.getTime()).s
  };
  const daily = [];
  const donationsByDay = db.prepare(`SELECT strftime('%Y-%m-%d', paid_at/1000, 'unixepoch', 'localtime') d, COUNT(*) c, COALESCE(SUM(amount),0) s
    FROM donations WHERE status='paid' AND paid_at >= ? GROUP BY d`).all(since);
  const usersByDay = db.prepare(`SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') d, COUNT(*) c
    FROM users WHERE created_at >= ? GROUP BY d`).all(since);
  const dm = new Map(donationsByDay.map(x => [x.d, x]));
  const um = new Map(usersByDay.map(x => [x.d, x]));
  for (let i = 0; i < 30; i++) {
    const dte = new Date(since + i * dayMs);
    const key = dte.getFullYear() + '-' + String(dte.getMonth() + 1).padStart(2, '0') + '-' + String(dte.getDate()).padStart(2, '0');
    daily.push({ date: key, donations: dm.get(key)?.c || 0, total: dm.get(key)?.s || 0, users: um.get(key)?.c || 0 });
  }
  const top = db.prepare(`SELECT u.username, u.display_name, COUNT(d.id) c, COALESCE(SUM(d.amount),0) s
    FROM donations d JOIN users u ON u.id=d.user_id WHERE d.status='paid'
    GROUP BY d.user_id ORDER BY s DESC LIMIT 8`).all();
  res.json({ totals, daily, top });
});

// รายชื่อผู้ใช้ + ค้นหา
app.get('/api/admin/users', needAuth, needAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const filter = ['all', 'banned', 'admins'].includes(req.query.filter) ? req.query.filter : 'all';
  let where = '1=1';
  const args = [];
  if (q) { where += ' AND (u.email LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (filter === 'banned') where += ' AND u.banned = 1';
  if (filter === 'admins') where += " AND u.role = 'admin'";
  const users = db.prepare(`SELECT u.id, u.email, u.username, u.display_name, u.role, u.banned, u.promptpay_id, u.created_at,
    (SELECT COUNT(*) FROM donations d WHERE d.user_id=u.id AND d.status='paid') AS paid_count,
    (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.user_id=u.id AND d.status='paid') AS paid_total,
    (SELECT COUNT(*) FROM donations d WHERE d.user_id=u.id AND d.status='pending') AS pending_count
    FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 100`).all(...args);
  res.json({ users });
});

// ระงับ/ปลดระงับบัญชี
app.post('/api/admin/users/:id/ban', needAuth, needAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'ระงับตัวเองไม่ได้' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (isSuperAdminLocal(u) && !isSuperAdminLocal(req.user)) return res.status(403).json({ error: 'ไม่สามารถระงับ Super Admin ได้' });
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(req.body.banned ? 1 : 0, id);
  if (req.body.banned) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  pushToAdmins('admin-user', { action: req.body.banned ? 'ban' : 'unban', username: u.username });
  res.json({ ok: true });
});

// แก้ไขข้อมูลผู้ใช้จากหลังบ้าน
app.patch('/api/admin/users/:id', needAuth, needAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const b = req.body || {};
  const promptpay = String(b.promptpayId ?? u.promptpay_id).replace(/[\s-]/g, '');
  if (promptpay && !/^(\d{10}|\d{13}|\d{15})$/.test(promptpay))
    return res.status(400).json({ error: 'PromptPay ต้องเป็นเบอร์โทร 10 หลัก หรือเลขบัตร 13 หลัก' });
  const role = ['admin', 'user'].includes(b.role) ? b.role : u.role;
  if (u.role === 'admin' && role === 'user' && id === req.user.id)
    return res.status(400).json({ error: 'ถอดสิทธิ์ตัวเองไม่ได้' });
  db.prepare('UPDATE users SET display_name=?, promptpay_id=?, role=? WHERE id=?')
    .run(clean(b.displayName, 40) || u.display_name, promptpay, role, id);
  res.json({ ok: true });
});

// ลบบัญชี (ลบสลิป + รายการโดเนท + session ของเจ้าของด้วย)
app.delete('/api/admin/users/:id', needAuth, needAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'ลบตัวเองไม่ได้' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (String(req.body?.confirm || '').toLowerCase() !== u.username)
    return res.status(400).json({ error: 'พิมพ์ชื่อผู้ใช้ไม่ตรงกัน ยืนยันไม่สำเร็จ' });
  for (const d of db.prepare('SELECT slip FROM donations WHERE user_id=?').all(id))
    if (d.slip) fs.rm(path.join(UPLOAD_DIR, path.basename(d.slip)), { force: true }, () => {});
  db.prepare('DELETE FROM donations WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

// รายการโดเนททั้งระบบ + ค้นหา/กรอง
app.get('/api/admin/donations', needAuth, needAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const status = ['pending', 'paid', 'rejected'].includes(req.query.status) ? req.query.status : null;
  let where = '1=1';
  const args = [];
  if (q) { where += ' AND (d.donor_name LIKE ? OR d.ref LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { where += ' AND d.status = ?'; args.push(status); }
  const rows = db.prepare(`SELECT d.id, d.ref, d.donor_name, d.amount, d.message, d.status, d.slip != '' AS has_slip, d.slip_hash, d.verified_by, d.created_at, d.paid_at,
    u.username, u.display_name FROM donations d JOIN users u ON u.id=d.user_id
    WHERE ${where} ORDER BY d.created_at DESC LIMIT 150`).all(...args);
  res.json({ donations: rows });
});

app.post('/api/admin/donations/:id/approve', needAuth, needAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM donations WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (d.status === 'paid') return res.status(400).json({ error: 'ยืนยันไปแล้ว' });
  markPaid(d.id);
  try { db.prepare('UPDATE donations SET verified_by=? WHERE id=?').run(req.user.username || req.user.email, d.id); } catch (_) {}
  res.json({ ok: true });
});
app.post('/api/admin/donations/:id/reject', needAuth, needAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM donations WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (d.status === 'paid') return res.status(400).json({ error: 'รายการนี้ยืนยันไปแล้ว' });
  markRejected(d);
  try { db.prepare('UPDATE donations SET verified_by=? WHERE id=?').run(req.user.username || req.user.email, d.id); } catch (_) {}
  res.json({ ok: true });
});
app.delete('/api/admin/donations/:id', needAuth, needAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM donations WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (d.slip) fs.rm(path.join(UPLOAD_DIR, path.basename(d.slip)), { force: true }, () => {});
  db.prepare('DELETE FROM donations WHERE id=?').run(d.id);
  res.json({ ok: true });
});
// ดูสลิปจากหลังบ้าน
app.get('/api/admin/slip/:id', needAuth, needAdmin, (req, res) => {
  const d = db.prepare('SELECT slip FROM donations WHERE id=?').get(Number(req.params.id));
  if (!d || !d.slip) return res.status(404).json({ error: 'ไม่มีสลิป' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(d.slip)));
});

// สถานะการเชื่อมต่อ RDCW
app.get('/api/admin/rdcw/status', needAuth, needAdmin, (req, res) => {
  const configured = rdcwEnabled();
  let reachable = false, latencyMs = null, error = '';
  if (configured) {
    const t0 = Date.now();
    try {
      const auth = 'Basic ' + Buffer.from(`${RDCW_CLIENT_ID}:${RDCW_CLIENT_SECRET}`).toString('base64');
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
      // inquiry ด้วย payload ปลอมเพื่อเช็ค auth/subscription (ค่า error 1004/1006 = ต่อเชื่อมสำเร็จ แค่ payload ผิด)
      fetch(RDCW_API_URL, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: 'ping' }), signal: ctrl.signal })
        .then(r => { reachable = r.status === 400 || r.status === 200; })
        .catch(() => {})
        .finally(() => clearTimeout(timer));
      latencyMs = Date.now() - t0;
    } catch (e) { error = e.message; }
  }
  const recent = db.prepare(`SELECT status, COUNT(*) c FROM slip_verifications WHERE created_at >= ? GROUP BY status`)
    .all(Date.now() - 86400e3);
  res.json({ configured, apiUrl: RDCW_API_URL, reachable, latencyMs, error, last24h: recent });
});

// ประวัติการตรวจสลิป (ล่าสุด 100 รายการ)
app.get('/api/admin/slip-verifications', needAuth, needAdmin, (req, res) => {
  const rows = db.prepare(`SELECT dv.id, dv.donation_id, dv.status, dv.amount_detected, dv.ref_detected, dv.error, dv.created_at,
    d.ref, d.donor_name, d.amount, u.username
    FROM slip_verifications dv
    LEFT JOIN donations d ON d.id = dv.donation_id
    LEFT JOIN users u ON u.id = d.user_id
    ORDER BY dv.created_at DESC LIMIT 100`).all();
  res.json({ verifications: rows });
});

/* --------------------------- packages & subscriptions ------------------- */
app.get('/api/packages', (req, res) => {
  const rows = db.prepare('SELECT id, name, slug, price, duration_days, quota_alerts, features, sort_order FROM packages WHERE active=1 ORDER BY sort_order, price').all();
  res.json({ packages: rows });
});

// สมัครแพ็กเกจ (จำลอง — ไม่มี gateway จ่ายเงินจริง ให้ Super Admin อนุมัติ/กำหนดเอง)
app.post('/api/subscriptions', needAuth, limit('sub', 10, 3600e3), (req, res) => {
  const pkgId = Number(req.body.packageId);
  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND active=1').get(pkgId);
  if (!pkg) return res.status(404).json({ error: 'ไม่พบแพ็กเกจ' });
  const start = now();
  const expires = pkg.duration_days > 0 ? start + pkg.duration_days * 86400e3 : start + 365 * 86400e3;
  db.prepare(`INSERT INTO subscriptions (user_id, package_id, status, started_at, expires_at) VALUES (?,?,?, ?,?)`)
    .run(req.user.id, pkg.id, 'active', start, expires);
  res.json({ ok: true, package: pkg.slug, expires_at: expires });
});

// แพ็กเกจของฉัน + วันหมดอายุ
app.get('/api/subscriptions/me', needAuth, (req, res) => {
  const row = db.prepare(`SELECT s.*, p.name, p.slug, p.quota_alerts FROM subscriptions s
    JOIN packages p ON p.id = s.package_id WHERE s.user_id=? ORDER BY s.expires_at DESC LIMIT 1`).get(req.user.id);
  if (!row) return res.json({ subscription: null, effective: 'free' });
  const active = row.expires_at > now() && row.status === 'active';
  res.json({ subscription: { ...row, active }, effective: active ? row.slug : 'free' });
});

/* --------------------------- super admin APIs --------------------------- */
// ภาพรวมระบบระดับสูง
app.get('/api/super/stats', needAuth, needSuperAdmin, (req, res) => {
  const dayMs = 86400e3, today = new Date(); today.setHours(0, 0, 0, 0);
  const totals = {
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    newToday: db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(today.getTime()).c,
    newMonth: db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(today.getTime() - 29 * dayMs).c,
    streamersActive: db.prepare("SELECT COUNT(DISTINCT user_id) c FROM donations WHERE status='paid'").get().c,
    paidCount: db.prepare("SELECT COUNT(*) c FROM donations WHERE status='paid'").get().c,
    paidTotal: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM donations WHERE status='paid'").get().s,
    pending: db.prepare("SELECT COUNT(*) c FROM donations WHERE status='pending'").get().c,
    banned: db.prepare('SELECT COUNT(*) c FROM users WHERE banned=1').get().c
  };
  const subs = db.prepare(`SELECT p.name, p.slug, COUNT(s.id) c FROM packages p LEFT JOIN subscriptions s ON s.package_id=p.id GROUP BY p.id`).all();
  const rdcw = { configured: rdcwEnabled(), ok24h: db.prepare("SELECT COUNT(*) c FROM slip_verifications WHERE status='ok' AND created_at >= ?").get(Date.now() - dayMs).c,
    fail24h: db.prepare("SELECT COUNT(*) c FROM slip_verifications WHERE status != 'ok' AND created_at >= ?").get(Date.now() - dayMs).c };
  res.json({ totals, subs, rdcw });
});

// จัดการแพ็กเกจ (สร้าง/แก้ไข/ปิดใช้งาน)
app.post('/api/super/packages', needAuth, needSuperAdmin, (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 40); const slug = clean(b.slug, 30).toLowerCase();
  if (!name || !/^[a-z0-9_-]{2,30}$/.test(slug)) return res.status(400).json({ error: 'ต้องระบุชื่อและ slug (a-z0-9_)' });
  const price = Math.max(0, parseInt(b.price, 10) || 0);
  const dur = Math.max(0, parseInt(b.durationDays, 10) || 0);
  const quota = Math.max(0, parseInt(b.quotaAlerts, 10) || 0);
  const info = db.prepare(`INSERT INTO packages (name, slug, price, duration_days, quota_alerts, features, active, sort_order)
    VALUES (?,?,?,?,?,?,1,?)`).run(name, slug, price, dur, quota, clean(b.features, 500), parseInt(b.sortOrder, 10) || 0);
  logAdmin(req, 'package.create', 'package', Number(info.lastInsertRowid), slug);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.patch('/api/super/packages/:id', needAuth, needSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM packages WHERE id=?').get(id);
  if (!p) return res.status(404).json({ error: 'ไม่พบแพ็กเกจ' });
  const b = req.body || {};
  const name = clean(b.name ?? p.name, 40) || p.name;
  const price = b.price !== undefined ? Math.max(0, parseInt(b.price, 10) || 0) : p.price;
  const dur = b.durationDays !== undefined ? Math.max(0, parseInt(b.durationDays, 10) || 0) : p.duration_days;
  const quota = b.quotaAlerts !== undefined ? Math.max(0, parseInt(b.quotaAlerts, 10) || 0) : p.quota_alerts;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : p.active;
  db.prepare('UPDATE packages SET name=?, price=?, duration_days=?, quota_alerts=?, features=?, active=? WHERE id=?')
    .run(name, price, dur, quota, clean(b.features ?? p.features, 500), active, id);
  logAdmin(req, 'package.update', 'package', id, p.slug);
  res.json({ ok: true });
});

// กำหนดแพ็กเกจ/บทบาท/วันหมดอายุให้ผู้ใช้
app.post('/api/super/users/:id/assign', needAuth, needSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const b = req.body || {};
  // กำหนด role (user/admin) — super_admin ตั้งให้เองไม่ได้
  if (b.role && ['user', 'admin'].includes(b.role)) {
    if (isSuperAdminLocal(u)) return res.status(400).json({ error: 'เปลี่ยน role ของ Super Admin ไม่ได้' });
    db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role, id);
    logAdmin(req, 'user.role', 'user', id, `${u.username} -> ${b.role}`);
  }
  // กำหนดแพ็กเกจ
  if (b.packageId !== undefined) {
    if (b.packageId === null || Number(b.packageId) === 0) {
      db.prepare("UPDATE subscriptions SET status='expired' WHERE user_id=?").run(id);
    } else {
      const pkg = db.prepare('SELECT * FROM packages WHERE id=?').get(Number(b.packageId));
      if (!pkg) return res.status(404).json({ error: 'ไม่พบแพ็กเกจ' });
      const start = now();
      const days = b.durationDays !== undefined ? Number(b.durationDays) : pkg.duration_days;
      const expires = days > 0 ? start + days * 86400e3 : start + 365 * 86400e3;
      db.prepare("UPDATE subscriptions SET status='expired' WHERE user_id=?").run(id);
      db.prepare(`INSERT INTO subscriptions (user_id, package_id, status, started_at, expires_at) VALUES (?,?,?,?,?)`)
        .run(id, pkg.id, 'active', start, expires);
      logAdmin(req, 'user.package', 'user', id, `${u.username} -> ${pkg.slug}`);
    }
  }
  res.json({ ok: true });
});

// บันทึกประวัติแอดมิน
function logAdmin(req, action, targetType = '', targetId = 0, details = '') {
  try {
    db.prepare(`INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(req.user?.id || 0, action, targetType, targetId, String(details).slice(0, 300), req.ip, req.get('user-agent') || '', now());
  } catch (_) {}
}
app.get('/api/super/admin-logs', needAuth, needSuperAdmin, (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.username AS admin_username FROM admin_logs a LEFT JOIN users u ON u.id=a.admin_id
    ORDER BY a.created_at DESC LIMIT 200`).all();
  res.json({ logs: rows });
});
app.get('/api/super/login-logs', needAuth, needSuperAdmin, (req, res) => {
  const rows = db.prepare(`SELECT l.*, u.username FROM login_logs l LEFT JOIN users u ON u.id=l.user_id
    ORDER BY l.created_at DESC LIMIT 200`).all();
  res.json({ logs: rows });
});

// ตั้งค่าไซต์ (เก็บ key/value)
const SITE_KEYS = ['site_name', 'announcement', 'contact_email', 'social_link', 'terms', 'privacy', 'maintenance'];
app.get('/api/super/site-settings', needAuth, needSuperAdmin, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const out = {}; for (const r of rows) out[r.key] = r.value;
  res.json({ settings: out });
});
app.post('/api/super/site-settings', needAuth, needSuperAdmin, (req, res) => {
  const b = req.body || {};
  for (const key of SITE_KEYS) {
    if (b[key] !== undefined) {
      const val = String(b[key]).slice(0, 2000);
      db.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, val, now());
    }
  }
  logAdmin(req, 'site.settings', 'settings', 0, Object.keys(b).join(','));
  res.json({ ok: true });
});

// ตั้งค่าแพ็กเกจเริ่มต้นเมื่อยังไม่มีข้อมูล
if (db.prepare('SELECT COUNT(*) c FROM packages').get().c === 0) {
  const ins = db.prepare(`INSERT INTO packages (name, slug, price, duration_days, quota_alerts, features, active, sort_order) VALUES (?,?,?,?,?,?,1,?)`);
  ins.run('Free', 'free', 0, 0, 0, 'หน้ารับทิป, Overlay พื้นฐาน', 0);
  ins.run('Streamer', 'streamer', 199, 30, 200, 'ปรับแต่ง Overlay, รูปแบบแจ้งเตือน, สถิติ', 1);
  ins.run('Pro', 'pro', 499, 30, 1000, 'ปรับแต่งขั้นสูง, เครื่องมือวิเคราะห์, โควตาสูง', 2);
}

/* -------------------------------- pages --------------------------------- */
const page = f => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], index: false, maxAge: '1h' }));
app.get('/', page('index.html'));
app.get(['/auth', '/login', '/register'], page('auth.html'));
app.get('/dashboard', page('dashboard.html'));
app.get('/admin', page('admin.html'));
app.get('/overlay/:token', page('overlay.html'));
app.get('/:username', (req, res, next) => {
  const n = req.params.username.toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(n) || RESERVED.has(n)) return next();
  page('donate.html')(req, res);
});
app.use((req, res) => (req.path.startsWith('/api') ? res.status(404).json({ error: 'not found' }) : res.status(404).sendFile(path.join(__dirname, 'public', '404.html'))));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message?.includes('File too large') ? 'ไฟล์ใหญ่เกิน 3MB' : 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' });
});

// housekeeping: expired sessions, stale pending donations
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now());
  db.prepare("UPDATE donations SET status='rejected' WHERE status='pending' AND created_at < ?").run(now() - 3 * 86400e3);
}, 3600e3).unref();

app.listen(PORT, () => console.log(`${SITE_NAME} running on http://localhost:${PORT}`));
