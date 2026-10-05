'use strict';
/**
 * لایه تنظیمات
 * ----------------------------------------------------------------------------
 * ترتیب اولویت خواندن تنظیمات:
 *   1. متغیرهای محیطی (process.env)  ← برای هاست‌هایی که امکان ست کردن env دارند
 *   2. فایل storage/config.json      ← خروجی «نصب‌کننده» (روش اصلی روی cPanel بدون SSH)
 *   3. مقادیر پیش‌فرض                ← فقط برای اجرای محلی / دمو
 *
 * روی cPanel بدون SSH کاربر یک‌بار مراحل نصب را در مرورگر طی می‌کند و
 * فایل storage/config.json به‌صورت خودکار ساخته می‌شود.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STORAGE_DIR = process.env.MINIHRM_STORAGE_DIR
  ? path.resolve(process.env.MINIHRM_STORAGE_DIR)
  : path.join(ROOT, 'storage');
const CONFIG_FILE = path.join(STORAGE_DIR, 'config.json');

const DEFAULTS = {
  installed: false,
  app: {
    name: 'مینی HRM',
    url: '',
    timezone: 'Asia/Tehran',
    locale: 'fa-IR',
    debug: false,
    sessionHours: 12,
    // آدرس عمومی سامانه برای ساخت لینک QR — اگر خالی باشد از هدر Host استفاده می‌شود
    publicBaseUrl: '',
  },
  db: {
    // driver: mysql  → هاست cPanel (توصیه‌شده)
    // driver: sqlite → اجرای محلی/دمو (بدون نیاز به MySQL)
    driver: 'sqlite',
    host: 'localhost',
    port: 3306,
    database: '',
    user: '',
    password: '',
    socketPath: '',
    prefix: 'hrm_',
    sqliteFile: path.join(STORAGE_DIR, 'minihrm.sqlite'),
    connectionLimit: 6,
  },
  company: {
    name: '',
    legalName: '',
    nationalId: '',
    registrationNo: '',
    economicCode: '',
    knowledgeBased: false,
    address: '',
    phone: '',
    email: '',
    logo: '',
    currency: 'ریال',
  },
  mail: { enabled: false, host: '', port: 587, secure: false, user: '', password: '', from: '' },
  sms: {
    provider: 'ippanel',
    enabled: false,
    // تنظیمات پنل Edge آی‌پی‌پنل: https://ippanel.com
    username: '',        // نام کاربری پنل (برای احراز هویت با رمز)
    password: '',
    apiKey: '',          // کلید API (Edge) — روش پیشنهادی
    baseUrl: 'https://api.ippanel.com',
    sender: '',          // شماره فرستنده / خط خدماتی برای Webservice
    patternCode: '',     // کد الگو برای ارسال OTP (مثلاً: hrm-otp)
    otpLength: 5,
    otpTtlSeconds: 120,
    otpResendSeconds: 60,
    otpMaxAttempts: 5,
    // در حالت false، کد OTP روی صفحه/لاگ نمایش داده می‌شود (فقط برای تست)
    debugShowCode: false,
  },
};

let cache = null;
let cacheMtime = 0;

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

function envOverrides() {
  const e = process.env;
  const o = { app: {}, db: {}, company: {}, sms: {}, mail: {} };
  if (e.APP_URL) o.app.publicBaseUrl = e.APP_URL;
  if (e.PUBLIC_BASE_URL) o.app.publicBaseUrl = e.PUBLIC_BASE_URL;
  if (e.APP_NAME) o.app.name = e.APP_NAME;
  if (e.DEBUG) o.app.debug = ['1', 'true', 'yes'].includes(String(e.DEBUG).toLowerCase());
  if (e.NODE_ENV === 'production') o.app.debug = false;
  if (e.DB_DRIVER) o.db.driver = e.DB_DRIVER;
  if (e.DB_HOST) o.db.host = e.DB_HOST;
  if (e.DB_PORT) o.db.port = Number(e.DB_PORT);
  if (e.DB_NAME) o.db.database = e.DB_NAME;
  if (e.DB_USER) o.db.user = e.DB_USER;
  if (e.DB_PASSWORD) o.db.password = e.DB_PASSWORD;
  if (e.DB_PREFIX) o.db.prefix = e.DB_PREFIX;
  if (e.DB_SOCKET) o.db.socketPath = e.DB_SOCKET;
  if (e.SQLITE_FILE) o.db.sqliteFile = e.SQLITE_FILE;
  if (e.COMPANY_NAME) o.company.name = e.COMPANY_NAME;
  if (e.IPPANEL_API_KEY) { o.sms.apiKey = e.IPPANEL_API_KEY; o.sms.enabled = true; }
  if (e.IPPANEL_USERNAME) o.sms.username = e.IPPANEL_USERNAME;
  if (e.IPPANEL_PASSWORD) o.sms.password = e.IPPANEL_PASSWORD;
  if (e.IPPANEL_SENDER) o.sms.sender = e.IPPANEL_SENDER;
  if (e.IPPANEL_PATTERN) o.sms.patternCode = e.IPPANEL_PATTERN;
  if (e.SMS_DEBUG_SHOW_CODE) o.sms.debugShowCode = ['1', 'true', 'yes'].includes(String(e.SMS_DEBUG_SHOW_CODE).toLowerCase());
  return o;
}

function readFileConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const st = fs.statSync(CONFIG_FILE);
    if (st.mtimeMs !== cacheMtime) cacheMtime = st.mtimeMs;
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    console.error('[config] خطا در خواندن فایل تنظیمات:', err.message);
    return {};
  }
}

function load(force = false) {
  if (cache && !force) return cache;
  const merged = deepMerge(deepMerge(DEFAULTS, readFileConfig()), envOverrides());
  // باگ رایج: مقدار درست env خالی باشد و مقدار فایل باقی بماند — مشکلی نیست
  cache = merged;
  return cache;
}

function get(pathStr, fallback) {
  const cfg = load();
  const val = pathStr.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), cfg);
  return val === undefined || val === null || val === '' ? fallback : val;
}

/**
 * ذخیره تغییرات در storage/config.json (بدون از دست دادن کلیدهای ناشناخته)
 */
function save(patch) {
  ensureDirs();
  let current = {};
  try { if (fs.existsSync(CONFIG_FILE)) current = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  const next = deepMerge(current, patch);
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (_) {}
  load(true);
  return next;
}

function ensureDirs() {
  for (const d of [STORAGE_DIR, path.join(STORAGE_DIR, 'uploads'), path.join(STORAGE_DIR, 'logs'), path.join(STORAGE_DIR, 'backups'), path.join(STORAGE_DIR, 'cache')]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  }
}

function isInstalled() {
  const c = load();
  return Boolean(c.installed) && Boolean(c.db && c.db.driver);
}

module.exports = {
  ROOT, STORAGE_DIR, CONFIG_FILE, DEFAULTS,
  load, get, save, ensureDirs, isInstalled,
  get app() { return load().app; },
  get db() { return load().db; },
  get company() { return load().company; },
  get sms() { return load().sms; },
  get mail() { return load().mail; },
};
