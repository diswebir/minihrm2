'use strict';
/**
 * تبدیل و قالب‌بندی تاریخ شمسی (جلالی) بدون هیچ وابستگی خارجی
 * ----------------------------------------------------------------------------
 * الگوریتم بر پایه تقویم هجری شمسی خورشیدیِ نجومی (هم‌ارز jalaali-js) است و
 * درخواست‌ها/پاسخ‌ها با آزمون خودکار روی بازه ۱۳۰۰ تا ۱۵۰۰ بررسی می‌شود.
 */

const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

const div = (a, b) => Math.trunc(a / b);
const mod = (a, b) => a - Math.floor(a / b) * b;

function jalCal(jy) {
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jm;
  let jump = 0;
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error('سال جلالی نامعتبر: ' + jy);
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let jd;
  let jm;
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

function isLeapJalaali(jy) {
  return jalCal(jy).leap === 1;
}

const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const J_MONTHS_SHORT = ['فرو', 'ارد', 'خرد', 'تیر', 'مرد', 'شهر', 'مهر', 'آبا', 'آذر', 'دی', 'بهم', 'اسف'];
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const WEEKDAYS_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];

/* ---------------------------- توابع عمومی ---------------------------- */

function toJalaali(date) {
  const d = toDate(date);
  if (!d) return null;
  const jdn = g2d(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return d2j(jdn);
}

function toGregorian(jy, jm, jd) {
  const g = d2g(j2d(jy, jm, jd));
  return new Date(g.gy, g.gm - 1, g.gd);
}

/** تبدیل هر ورودی به Date (پشتیبانی از رشته‌های ISO و «YYYY-MM-DD HH:MM:SS») */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  let s = String(value).trim();
  if (!s) return null;
  // اعداد شمسی خالص 8 رقمی مانند 14040825 را به تاریخ میلادی تبدیل کن
  if (/^\d{8}$/.test(s) && s.startsWith('13')) {
    const g = toGregorian(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
    return g;
  }
  s = s.replace(' ', 'T');
  if (!/T/.test(s) && /^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** خروجی: 1404/08/25 */
function formatJalaali(value, opts = {}) {
  const d = toDate(value);
  if (!d) return opts.fallback !== undefined ? opts.fallback : '—';
  const j = toJalaali(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${j.jy}/${p(j.jm)}/${p(j.jd)}`;
}

/** خروجی: 25 آبان 1404 */
function formatJalaaliLong(value, opts = {}) {
  const d = toDate(value);
  if (!d) return opts.fallback !== undefined ? opts.fallback : '—';
  const j = toJalaali(d);
  return `${j.jd} ${J_MONTHS[j.jm - 1]} ${j.jy}`;
}

/** خروجی: شنبه 25 آبان 1404 - 14:30 */
function formatJalaaliFull(value, opts = {}) {
  const d = toDate(value);
  if (!d) return opts.fallback !== undefined ? opts.fallback : '—';
  const j = toJalaali(d);
  const p = (n) => String(n).padStart(2, '0');
  const wd = WEEKDAYS[d.getDay()];
  const time = opts.withTime === false ? '' : ` - ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${wd} ${j.jd} ${J_MONTHS[j.jm - 1]} ${j.jy}${time}`;
}

/** خروجی: 1404/08/25 - 14:30 */
function formatJalaaliDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${formatJalaali(d)} - ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function jalaaliMonthName(month) {
  return J_MONTHS[(Number(month) || 1) - 1];
}

function weekDayName(value) {
  const d = toDate(value) || new Date();
  return WEEKDAYS[d.getDay()];
}

/** اختلاف دو تاریخ بر حسب روز */
function diffDays(a, b) {
  const d1 = toDate(a);
  const d2 = toDate(b);
  if (!d1 || !d2) return null;
  return Math.round((d1 - d2) / 86400000);
}

/** افزودن روز به یک تاریخ */
function addDays(value, days) {
  const d = toDate(value) || new Date();
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

/** تبدیل ارقام لاتین به فارسی */
function toPersianDigits(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

/** تبدیل ارقام فارسی/عربی به لاتین (برای ورودی کاربر) */
function toLatinDigits(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** رشته تاریخ شمسی «1404/08/25» یا «14040825» را به Date میلادی تبدیل می‌کند */
function parseJalaali(str) {
  if (!str) return null;
  const s = toLatinDigits(String(str)).replace(/[-.]/g, '/').trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return toDate(str);
  try {
    return toGregorian(+m[1], +m[2], +m[3]);
  } catch (_) { return null; }
}

/** امروز به فرمت استاندارد ذخیره‌سازی (YYYY-MM-DD) */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** دامنه ابتدا/انتها ماه شمسی جاری بر حسب تاریخ میلادی */
function jalaaliMonthRange(jy, jm) {
  const start = toGregorian(jy, jm, 1);
  const endJ = jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };
  const end = addDays(toGregorian(endJ.jy, endJ.jm, 1), -1);
  return { start, end };
}

/** سن بر حسب سال از تاریخ تولد */
function ageFrom(birthDate) {
  const d = toDate(birthDate);
  if (!d) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

module.exports = {
  toJalaali, toGregorian, toDate, parseJalaali,
  formatJalaali, formatJalaaliLong, formatJalaaliFull, formatJalaaliDateTime,
  jalaaliMonthName, weekDayName, diffDays, addDays, today,
  toPersianDigits, toLatinDigits, jalaaliMonthRange, ageFrom, isLeapJalaali,
  J_MONTHS, J_MONTHS_SHORT, WEEKDAYS, WEEKDAYS_SHORT,
};
