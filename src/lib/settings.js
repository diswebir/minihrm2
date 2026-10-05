'use strict';
/**
 * سرویس تنظیمات سطح پایگاه‌داده (جدول settings)
 * ----------------------------------------------------------------------------
 * برای مقادیری که مدیر سامانه از داخل پنل تغییر می‌دهد: نام شرکت، شعار سامانه،
 * مهلت‌ها، پیش‌فرض‌ها و ... مقادیر ساختاری (اتصال دیتابیس، آی‌پی‌پنل) در
 * storage/config.json نگهداری می‌شوند.
 */
const db = require('../db');
const helpers = require('./helpers');

const DEFAULTS = {
  'app.name': 'مینی HRM',
  'app.tagline': 'سامانه جامع منابع انسانی',
  'app.logo': '',
  'app.primary_color': '#2563eb',
  'app.fiscal_start_month': '1',            // شروع سال مالی (شمسی)
  'app.default_currency': 'ریال',
  'app.timezone': 'Asia/Tehran',
  'app.date_display': 'jalali',
  'app.footer_text': '',
  'app.login_notice': '',
  'app.allow_employee_otp_login': '1',
  'security.password_min_length': '8',
  'security.session_hours': '12',
  'security.max_failed_attempts': '7',
  'security.lockout_minutes': '15',
  'security.otp_ttl_seconds': '120',
  'security.otp_resend_seconds': '60',
  'security.otp_max_attempts': '5',
  'recruitment.default_template': 'of-fr-01-03',
  'recruitment.invite_ttl_days': '7',
  'recruitment.allow_multiple_applications': '1',
  'recruitment.require_mbti_by_default': '1',
  'recruitment.thank_you_text': 'از وقتی که گذاشتید سپاسگزاریم. نتیجه بررسی پرونده شما در اسرع وقت توسط کارشناسان منابع انسانی اعلام خواهد شد.',
  'assessment.hide_result_from_candidate': '1',
  'attendance.work_hours_per_day': '8',
  'attendance.work_days_per_month': '26',
  'attendance.leave_approval_chain': 'manager,hr',
  'payroll.employee_insurance_percent': '7',
  'payroll.employer_insurance_percent': '23',
  'payroll.unemployment_percent': '3',
  'payroll.overtime_rate': '1.4',
  'payroll.holiday_overtime_rate': '2',
  'payroll.night_rate': '1.35',
  'payroll.eid_days': '60',
  'payroll.seniority_days': '30',
  'transport.require_approval': '1',
  'kitchen.require_reservation': '1',
  'kitchen.reservation_deadline_hours': '14',
  'transport.reservation_deadline_hours': '18',
  'onboarding.probation_days': '90',
};

let cache = null;
let loadedAt = 0;
const TTL_MS = 30 * 1000;

function parseValue(raw) {
  const s = (raw === null || raw === undefined) ? '' : String(raw);
  return s;
}

async function loadAll(force = false) {
  const now = Date.now();
  if (cache && !force && now - loadedAt < TTL_MS) return cache;
  try {
    const rows = await db.query(`SELECT skey, value FROM ${db.t('settings')}`);
    const map = { ...DEFAULTS };
    for (const r of rows) map[r.skey] = parseValue(r.value);
    cache = map;
    loadedAt = now;
  } catch (err) {
    // قبل از اجرای نصب، جدول وجود ندارد
    cache = { ...DEFAULTS };
  }
  return cache;
}

async function get(key, fallback) {
  const all = await loadAll();
  const v = all[key];
  if (v === undefined || v === '') {
    const d = DEFAULTS[key];
    return d !== undefined ? d : fallback;
  }
  return v;
}

function getSync(key, fallback) {
  const all = cache || DEFAULTS;
  const v = all[key];
  if (v === undefined || v === '') return DEFAULTS[key] !== undefined ? DEFAULTS[key] : fallback;
  return v;
}

async function getNumber(key, fallback = 0) {
  return helpers.toNumber(await get(key), fallback);
}

async function getBool(key, fallback = false) {
  const v = await get(key);
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on', true].includes(typeof v === 'string' ? v.toLowerCase() : v);
}

async function set(key, value, userId = null) {
  const table = db.t('settings');
  const exists = await db.get(`SELECT skey FROM ${table} WHERE skey = ?`, [key]);
  if (exists) {
    await db.run(`UPDATE ${table} SET value = ?, updated_at = ?, updated_by = ? WHERE skey = ?`,
      [value === null || value === undefined ? '' : String(value), db.nowSql(), userId, key]);
  } else {
    await db.run(`INSERT INTO ${table} (skey, value, updated_at, updated_by) VALUES (?,?,?,?)`,
      [key, value === null || value === undefined ? '' : String(value), db.nowSql(), userId]);
  }
  if (cache) cache[key] = value === null || value === undefined ? '' : String(value);
  return true;
}

async function setMany(obj, userId = null) {
  for (const [k, v] of Object.entries(obj || {})) await set(k, v, userId);
}

/** همه تنظیمات با یک پیشوند */
async function browse(prefix = '') {
  const all = await loadAll();
  const out = {};
  for (const [k, v] of Object.entries(all)) if (!prefix || k.startsWith(prefix)) out[k] = v;
  return out;
}

/** مقادیر گروهی به‌صورت آبجکت تودرتو: app.name → { app: { name } } */
async function tree(prefix = '') {
  const flat = await browse(prefix);
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      node[parts[i]] = node[parts[i]] || {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = v;
  }
  return out;
}

function invalidate() {
  cache = null;
  loadedAt = 0;
}

module.exports = { DEFAULTS, get, getSync, getNumber, getBool, set, setMany, browse, tree, loadAll, invalidate };
