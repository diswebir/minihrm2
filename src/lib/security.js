'use strict';
/**
 * ابزارهای امنیتی
 * ----------------------------------------------------------------------------
 *  • درهم‌سازی گذرواژه با scrypt (بدون وابستگی خارجی)
 *  • رمزنگاری متقارن کلیدهای حساس (رمز آی‌پی‌پنل) با AES-256-GCM
 *  • تولید توکن/کدهای تصادفی امن و مقایسه امن در برابر حملات زمانی
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/* ---------------------------- گذرواژه ---------------------------- */

/** خروجی: scrypt$N$r$p$salt$hash */
function hashPassword(password) {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2,
    });
    return timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}

/** برآورد قدرت گذرواژه (۰ تا ۱۰۰) */
function passwordStrength(password) {
  const s = String(password || '');
  let score = 0;
  if (s.length >= 8) score += 25;
  if (s.length >= 12) score += 15;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score += 15;
  if (/[0-9]/.test(s)) score += 15;
  if (/[^A-Za-z0-9]/.test(s)) score += 20;
  if (s.length >= 16) score += 10;
  if (/^(123|qwerty|admin|password|111)/i.test(s) || s.length < 6) score = Math.min(score, 15);
  return Math.min(100, score);
}

/* ---------------------------- توکن‌ها ---------------------------- */

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** کد عددی OTP (بدون صفر ابتدایی) */
function randomNumericCode(length = 5) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(crypto.randomInt(0, 10));
  return out.replace(/^0+(?=\d)/, '0');
}

/** کد یکتا برای شماره فیش/قرارداد مانند PS-1404-000123 */
function serial(prefix, num, year) {
  const y = year || new Date().getFullYear();
  return `${prefix}-${y}-${String(num).padStart(6, '0')}`;
}

function uuid() {
  return crypto.randomUUID();
}

function hmac(value, key) {
  return crypto.createHmac('sha256', String(key)).update(String(value)).digest('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function md5(value) {
  return crypto.createHash('md5').update(String(value)).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // مقایسه با طول متفاوت هم زمان ثابت بماند
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ------------------------- رمزنگاری داده ------------------------- */

function secretKey() {
  let key = config.get('app.secretKey', '');
  if (!key) {
    key = crypto.randomBytes(32).toString('base64');
    try { config.save({ app: { secretKey: key } }); } catch (_) {}
  }
  return crypto.createHash('sha256').update(String(key) + '|minihrm').digest();
}

/** رمزنگاری متن حساس → enc:v1:iv:tag:cipher */
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const s = String(payload);
  if (!s.startsWith('enc:v1:')) return s;   // مقدار رمزنگاری‌نشده (سازگاری عقب‌رو)
  try {
    const [, , ivB64, tagB64, dataB64] = s.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) { return ''; }
}

/** ماسک کردن مقادیر حساس برای نمایش در UI: ****1234 */
function maskSecret(value, visible = 4) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= visible) return '*'.repeat(s.length);
  return '*'.repeat(Math.max(4, s.length - visible)) + s.slice(-visible);
}

function maskMobile(mobile) {
  const s = String(mobile || '');
  if (s.length < 7) return s;
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

function maskNationalId(id) {
  const s = String(id || '');
  if (s.length < 6) return s;
  return `${s.slice(0, 3)}*****${s.slice(-2)}`;
}

/* --------------------------- امضای کوکی --------------------------- */
/** امضا/بررسی مقدار کوکی برای جلوگیری از دستکاری: value.signature */
function sign(value) {
  return `${value}.${hmac(value, secretKey().toString('hex'))}`;
}

function unsign(signed) {
  if (!signed) return null;
  const idx = String(signed).lastIndexOf('.');
  if (idx < 1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  return timingSafeEqual(hmac(value, secretKey().toString('hex')), sig) ? value : null;
}

/* --------------------------- رمزنگاری فایل --------------------------- */
function fileChecksum(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch (_) { return null; }
}

module.exports = {
  hashPassword, verifyPassword, passwordStrength,
  randomToken, randomNumericCode, serial, uuid, hmac, sha256, md5, timingSafeEqual,
  encrypt, decrypt, maskSecret, maskMobile, maskNationalId,
  sign, unsign, fileChecksum,
};
