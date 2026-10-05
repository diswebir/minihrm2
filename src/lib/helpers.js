'use strict';
/**
 * توابع کمکی مشترک سراسر سامانه
 */
const path = require('path');
const crypto = require('crypto');
const jalali = require('./jalali');

/* --------------------------- متن و امنیت --------------------------- */

function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** پاک‌سازی برای درج در متن (حذف تگ‌ها) */
function stripTags(input) {
  return String(input || '').replace(/<[^>]*>/g, '').trim();
}

function truncate(input, len = 80) {
  const s = String(input || '');
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

function slugify(input, fallback = 'item') {
  const base = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || `${fallback}-${Date.now().toString(36)}`;
}

/** تبدیل «نام شغل فارسی» به اسلاگ خوانا برای URL آگهی */
function jobSlug(title, code) {
  const t = String(title || '').trim().replace(/\s+/g, '-');
  return encodeURIComponent(`${t}${code ? '-' + code : ''}`).slice(0, 120);
}

/* --------------------------- عدد و پول --------------------------- */

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(jalali.toLatinDigits(String(value)).replace(/[,\s\u066c]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** قالب‌بندی عدد با جداکننده هزارگان */
function formatNumber(value, digits = 0) {
  const n = toNumber(value, 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** قالب‌بندی مبلغ + واحد پول (پیش‌فرض ریال) */
function formatMoney(value, currency = 'ریال', opts = {}) {
  const n = toNumber(value, 0);
  const abs = Math.abs(n);
  if (opts.short && abs >= 1_000_000_000) return `${formatNumber(n / 1_000_000_000, 1)} میلیارد ${currency}`;
  if (opts.short && abs >= 1_000_000) return `${formatNumber(n / 1_000_000, 1)} میلیون ${currency}`;
  return `${formatNumber(n)} ${currency}`;
}

/** رقم به حروف (برای فیش حقوقی و چک) */
function numberToPersianWords(num) {
  const n = Math.floor(Math.abs(toNumber(num, 0)));
  if (n === 0) return 'صفر';
  const yekan = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  const dahgan = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  const dah = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  const sadgan = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
  const scales = ['', ' هزار', ' میلیون', ' میلیارد', ' بیلیون'];

  const three = (x) => {
    const out = [];
    const s = Math.floor(x / 100);
    const rem = x % 100;
    if (s) out.push(sadgan[s]);
    if (rem >= 10 && rem < 20) out.push(dah[rem - 10]);
    else {
      const d = Math.floor(rem / 10);
      const y = rem % 10;
      if (d) out.push(dahgan[d]);
      if (y) out.push(yekan[y]);
    }
    return out.join(' و ');
  };

  const parts = [];
  let rest = n;
  let scale = 0;
  while (rest > 0) {
    const chunk = rest % 1000;
    if (chunk) parts.unshift(three(chunk) + scales[scale]);
    rest = Math.floor(rest / 1000);
    scale += 1;
  }
  return parts.join(' و ');
}

/* --------------------------- رشته و تاریخ --------------------------- */

const FA_DIGITS = { 0: '۰', 1: '۱', 2: '۲', 3: '۳', 4: '۴', 5: '۵', 6: '۶', 7: '۷', 8: '۸', 9: '۹' };
const fa = (v) => String(v ?? '').replace(/[0-9]/g, (d) => FA_DIGITS[d]);

function formatBytes(bytes, digits = 1) {
  const b = toNumber(bytes, 0);
  if (b < 1024) return `${b} بایت`;
  const units = ['کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(digits)} ${units[i]}`;
}

/** «۳ روز پیش» / «۲ ساعت بعد» */
function relativeTime(value) {
  const d = jalali.toDate(value);
  if (!d) return '—';
  const diff = Math.round((d - new Date()) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff < 0 ? ' پیش' : ' دیگر';
  if (abs < 60) return `${jalali.toPersianDigits(abs)} ثانیه${suffix}`;
  if (abs < 3600) return `${jalali.toPersianDigits(Math.round(abs / 60))} دقیقه${suffix}`;
  if (abs < 86400) return `${jalali.toPersianDigits(Math.round(abs / 3600))} ساعت${suffix}`;
  if (abs < 2592000) return `${jalali.toPersianDigits(Math.round(abs / 86400))} روز${suffix}`;
  if (abs < 31536000) return `${jalali.toPersianDigits(Math.round(abs / 2592000))} ماه${suffix}`;
  return `${jalali.toPersianDigits(Math.round(abs / 31536000))} سال${suffix}`;
}

/** «۸ سال و ۳ ماه سابقه» */
function durationText(from, to) {
  const d1 = jalali.toDate(from);
  const d2 = jalali.toDate(to) || new Date();
  if (!d1) return '—';
  let months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
  if (d2.getDate() < d1.getDate()) months -= 1;
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${jalali.toPersianDigits(y)} سال`);
  if (m) parts.push(`${jalali.toPersianDigits(m)} ماه`);
  return parts.length ? parts.join(' و ') : 'کمتر از یک ماه';
}

/** «۳ روز و ۴ ساعت» از دقیقه */
function minutesText(minutes) {
  const m = toNumber(minutes, 0);
  if (m <= 0) return '۰';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const p = [];
  if (d) p.push(`${jalali.toPersianDigits(d)} روز`);
  if (h) p.push(`${jalali.toPersianDigits(h)} ساعت`);
  if (mm) p.push(`${jalali.toPersianDigits(mm)} دقیقه`);
  return p.join(' و ');
}

function initials(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 1);
  return parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1);
}

function colorFromString(str) {
  const palette = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#4f46e5', '#059669'];
  const h = crypto.createHash('md5').update(String(str || '')).digest();
  return palette[h[0] % palette.length];
}

/* --------------------------- ساختار داده --------------------------- */

function jsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function jsonStringify(value) {
  if (value === null || value === undefined) return null;
  try { return JSON.stringify(value); } catch (_) { return null; }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

function onlyFilled(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function groupBy(arr, keyFn) {
  return (arr || []).reduce((acc, item) => {
    const k = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function sum(arr, keyFn) {
  return (arr || []).reduce((acc, item) => acc + toNumber(typeof keyFn === 'function' ? keyFn(item) : item[keyFn], 0), 0);
}

/** تفاوت دو شیء برای گزارش تغییرات در audit log */
function diffObjects(before, after) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (['updated_at', 'created_at'].includes(k)) continue;
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (String(a ?? '') !== String(b ?? '')) changes[k] = { from: a, to: b };
  }
  return changes;
}

/* --------------------------- صفحه‌بندی --------------------------- */

function paginate(query = {}, defaults = {}) {
  const perPageAllowed = defaults.perPageAllowed || [10, 20, 25, 50, 100];
  let perPage = toNumber(query.per_page, defaults.perPage || 20);
  if (!perPageAllowed.includes(perPage)) perPage = defaults.perPage || 20;
  const page = Math.max(1, toNumber(query.page, 1));
  return { page, perPage, offset: (page - 1) * perPage, perPageAllowed };
}

function paginationMeta(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return {
    total, page, perPage, pages,
    hasPrev: page > 1, hasNext: page < pages,
    from: total === 0 ? 0 : (page - 1) * perPage + 1,
    to: Math.min(page * perPage, total),
  };
}

/** ساخت رشته کوئری با حفظ پارامترهای فعلی */
function buildQuery(base = {}, overrides = {}) {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v === null || v === undefined || v === '' || k === 'undefined' || v === 'all') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/* --------------------------- متفرقه --------------------------- */

function fileExistsSafe(p) {
  try { return require('fs').existsSync(p); } catch (_) { return false; }
}

function extOf(filename) {
  return path.extname(String(filename || '')).toLowerCase().replace('.', '');
}

function safeFileName(original) {
  const ext = extOf(original);
  const base = crypto.randomBytes(8).toString('hex');
  const stamp = Date.now().toString(36);
  return `${stamp}-${base}${ext ? '.' + ext : ''}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** ساخت درخت از فهرست تخت */
function buildTree(items, idKey = 'id', parentKey = 'parent_id', childrenKey = 'children') {
  const map = new Map();
  const roots = [];
  (items || []).forEach((it) => map.set(it[idKey], { ...it, [childrenKey]: [] }));
  map.forEach((item) => {
    const parent = item[parentKey] ? map.get(item[parentKey]) : null;
    if (parent) parent[childrenKey].push(item);
    else roots.push(item);
  });
  return roots;
}

function flattenTree(nodes, childrenKey = 'children', depth = 0, out = []) {
  for (const n of nodes || []) {
    out.push({ ...n, __depth: depth });
    flattenTree(n[childrenKey], childrenKey, depth + 1, out);
  }
  return out;
}

/** درصد با یک رقم اعشار */
function percent(part, total) {
  const t = toNumber(total, 0);
  if (!t) return 0;
  return round2((toNumber(part, 0) / t) * 100);
}

const STATUS_COLORS = {
  active: 'success', open: 'success', approved: 'success', paid: 'success', completed: 'success',
  done: 'success', valid: 'success', published: 'success', assigned: 'info', hired: 'success',
  pending: 'warning', draft: 'muted', review: 'info', in_progress: 'info', processing: 'info',
  requested: 'warning', sent: 'info', scheduled: 'info', screening: 'info', interview: 'info',
  rejected: 'danger', expired: 'danger', overdue: 'danger', canceled: 'danger', cancelled: 'danger',
  terminated: 'danger', failed: 'danger', closed: 'muted', inactive: 'muted', suspended: 'danger',
  archived: 'muted', new: 'info', calculated: 'info', locked: 'muted', paused: 'warning',
  contact: 'info', offer: 'success', assessment: 'warning', no_show: 'danger',
};

function statusColor(status) {
  return STATUS_COLORS[String(status || '').toLowerCase()] || 'muted';
}

/** برچسب فارسی وضعیت‌ها */
const STATUS_LABELS = {
  active: 'فعال', inactive: 'غیرفعال', pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده',
  draft: 'پیش‌نویس', open: 'باز', closed: 'بسته', paid: 'پرداخت‌شده', completed: 'تکمیل‌شده',
  in_progress: 'در جریان', done: 'انجام‌شده', canceled: 'لغوشده', cancelled: 'لغوشده',
  new: 'جدید', screening: 'بررسی اولیه', interview: 'مصاحبه', assessment: 'آزمون',
  offer: 'پیشنهاد شغلی', hired: 'استخدام‌شده', withdrawn: 'انصراف', expired: 'منقضی',
  scheduled: 'زمان‌بندی‌شده', no_show: 'غیبت در مصاحبه', calculated: 'محاسبه‌شده',
  locked: 'قفل‌شده', suspended: 'معلق', terminated: 'خاتمه‌یافته', archived: 'بایگانی',
  assigned: 'تخصیص‌یافته', requested: 'درخواست‌شده', valid: 'معتبر', paused: 'متوقف',
  reserved: 'رزرو‌شده', served: 'تحویل‌شده', sent: 'ارسال‌شده', failed: 'ناموفق',
  delivered: 'تحویل‌شده', settled: 'تسویه‌شده', issued: 'صادرشده', paid_off: 'تسویه کامل',
};

function statusLabel(status) {
  return STATUS_LABELS[String(status || '').toLowerCase()] || String(status || '');
}


/**
 * قالب‌بندی مبلغ به ریال
 * money(1234567) → «۱٬۲۳۴٬۵۶۷ ریال» | money(1234567, { suffix: false }) → «۱٬۲۳۴٬۵۶۷»
 */
function money(value, opts = {}) {
  if (value === null || value === undefined || value === '') return opts.empty || '—';
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return opts.empty || '—';
  const formatted = opts.latin ? formatNumber(Math.round(n)) : jalali.toPersianDigits(formatNumber(Math.round(n))).replace(/,/g, '٬');
  return opts.suffix === false ? formatted : `${formatted}${opts.suffix || ' ریال'}`;
}

module.exports = {
  escapeHtml, stripTags, truncate, slugify, jobSlug,
  toNumber, round2, formatNumber, formatMoney, money, numberToPersianWords, fa,
  formatBytes, relativeTime, durationText, minutesText, initials, colorFromString,
  jsonParse, jsonStringify, pick, omit, onlyFilled, isEmpty, chunk, groupBy, sum, diffObjects,
  paginate, paginationMeta, buildQuery,
  fileExistsSafe, extOf, safeFileName, sleep, buildTree, flattenTree, percent,
  statusColor, statusLabel, STATUS_LABELS,
  // میان‌برهای تاریخ
  fd: jalali.formatJalaali,
  fdl: jalali.formatJalaaliLong,
  fdf: jalali.formatJalaaliFull,
  fdt: jalali.formatJalaaliDateTime,
  pnum: jalali.toPersianDigits,
};
