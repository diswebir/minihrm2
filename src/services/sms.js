'use strict';
/**
 * سرویس پیامک و رمز یک‌بارمصرف — بر پایه سامانه آی‌پی‌پنل (IPPanel Edge API)
 * ----------------------------------------------------------------------------
 * مستندات مرجع: https://ippanelcom.github.io/Edge-Document/docs/
 *
 *   • Base URL : https://edge.ippanel.com/v1
 *   • ارسال الگو : POST /api/send  → { sending_type: "pattern", from_number, code, recipients, params }
 *   • ارسال معمولی: POST /api/send  → { sending_type: "webservice", from_number, message, params: { recipients } }
 *   • دریافت توکن (در صورت استفاده از نام کاربری/گذرواژه به‌جای کلید API):
 *         POST /api/acl/auth/login  → { username, password }
 *   • هدر احراز هویت: Authorization: <API_KEY>
 *
 * نکته: توکن پنل ۱۰ ساعت اعتبار دارد؛ کلید API انقضا ندارد و روش پیشنهادی است.
 */
const config = require('../config');
const security = require('../lib/security');
const helpers = require('../lib/helpers');
const db = require('../db');

const BASE_URL_DEFAULT = 'https://edge.ippanel.com/v1';
let cachedToken = null;     // { token, expiresAt }
let lastSendInfo = null;    // برای نمایش در پنل (آخرین ارسال / آخرین خطا)

/* ------------------------------------------------------------------ */
/* ابزارها                                                            */
/* ------------------------------------------------------------------ */

function cfg() {
  const c = config.load();
  const sms = c.sms || {};
  return {
    enabled: Boolean(sms.enabled),
    apiKey: sms.apiKey ? security.decrypt(sms.apiKey) : '',
    username: sms.username || '',
    password: sms.password ? security.decrypt(sms.password) : '',
    sender: sms.sender || '',
    patternCode: sms.patternCode || '',
    baseUrl: (sms.baseUrl || BASE_URL_DEFAULT).replace(/\/+$/, ''),
    otpLength: Number(sms.otpLength) || 5,
    otpTtlSeconds: Number(sms.otpTtlSeconds) || 120,
    otpResendSeconds: Number(sms.otpResendSeconds) || 60,
    otpMaxAttempts: Number(sms.otpMaxAttempts) || 5,
    debugShowCode: Boolean(sms.debugShowCode) || c.app.driver === 'sqlite',
  };
}

/** تبدیل شماره موبایل به قالب E.164: 09121234567 → +989121234567 */
function toE164(mobile) {
  const digits = require('../lib/jalali').toLatinDigits(String(mobile || '')).replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.startsWith('98')) return '+' + digits;
  if (digits.startsWith('0')) return '+98' + digits.slice(1);
  if (digits.length === 10) return '+98' + digits;
  return '+' + digits;
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.apiKey || (c.username && c.password));
}

function isEnabled() {
  const c = cfg();
  return c.enabled && isConfigured();
}

async function httpJson(url, { method = 'POST', body, headers = {}, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

/** گرفتن توکن از پنل با نام کاربری و گذرواژه (در صورت نبود کلید API) */
async function getToken(force = false) {
  const c = cfg();
  if (c.apiKey) return c.apiKey;
  if (!c.username || !c.password) return null;
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const { json, status } = await httpJson(`${c.baseUrl}/api/acl/auth/login`, {
    body: { username: c.username, password: c.password },
  });
  const token = json && json.data && json.data.token;
  if (!token) {
    throw new Error(`ورود به آی‌پی‌پنل ناموفق بود: ${(json && json.meta && json.meta.message) || 'HTTP ' + status}`);
  }
  if (json.data.method && json.data.method !== 'login') {
    // حساب کاربری دو مرحله‌ای (Google Authenticator / پیامک) دارد و کلید API لازم است
    throw new Error('حساب آی‌پی‌پنل شما ورود دو مرحله‌ای دارد؛ لطفاً در پنل آی‌پی‌پنل از بخش Developers › Access Keys یک «کلید API» بسازید و در تنظیمات وارد کنید.');
  }
  cachedToken = { token, expiresAt: Date.now() + 9 * 60 * 60 * 1000 };
  return token;
}

/* ------------------------------------------------------------------ */
/* ارسال                                                              */
/* ------------------------------------------------------------------ */

/**
 * ارسال پیامک معمولی
 * @param {string|string[]} recipients
 */
async function sendText(recipients, message, { sender, sendTime } = {}) {
  const c = cfg();
  const list = (Array.isArray(recipients) ? recipients : [recipients]).map(toE164).filter(Boolean);
  if (!list.length) return { ok: false, error: 'شماره گیرنده نامعتبر است.' };
  const from = sender || c.sender;
  if (!from) return { ok: false, error: 'شماره فرستنده در تنظیمات پیامک ثبت نشده است.' };
  if (!isEnabled()) {
    lastSendInfo = { at: new Date().toISOString(), ok: false, error: 'سرویس پیامک غیرفعال است', preview: String(message).slice(0, 120) };
    return { ok: false, error: 'سرویس پیامک فعال یا تنظیم نشده است.' };
  }
  try {
    const token = await getToken();
    const body = {
      sending_type: 'webservice',
      from_number: toE164(from),
      message: String(message),
      params: { recipients: list },
    };
    if (sendTime) body.send_time = sendTime;
    const { json, status } = await httpJson(`${c.baseUrl}/api/send`, {
      body, headers: { Authorization: token },
    });
    const meta = json && json.meta;
    const ok = Boolean(meta && meta.status);
    lastSendInfo = {
      at: new Date().toISOString(), ok, to: list.length, preview: String(message).slice(0, 120),
      message: meta && meta.message, ids: json && json.data && json.data.message_outbox_ids,
      error: ok ? null : ((meta && meta.message) || `HTTP ${status}`),
    };
    if (!ok) return { ok: false, error: lastSendInfo.error, raw: json };
    await logSend('text', list, message, meta, json);
    return { ok: true, ids: lastSendInfo.ids, message: meta.message };
  } catch (err) {
    lastSendInfo = { at: new Date().toISOString(), ok: false, error: err.message, preview: String(message).slice(0, 120) };
    return { ok: false, error: err.message };
  }
}

/**
 * ارسال پیامک الگو (Pattern) — مناسب رمز یک‌بارمصرف
 * @param {string} mobile
 * @param {object} params  مقادیر جایگذاری، مثلاً { code: '12345' }
 */
async function sendPattern(mobile, params = {}, { patternCode, sender } = {}) {
  const c = cfg();
  const code = patternCode || c.patternCode;
  const to = toE164(mobile);
  if (!to) return { ok: false, error: 'شماره موبایل نامعتبر است.' };
  if (!code) return { ok: false, error: 'کد الگوی پیامک (Pattern) در تنظیمات ثبت نشده است.', fallback: true };
  if (!isEnabled()) return { ok: false, error: 'سرویس پیامک فعال یا تنظیم نشده است.', fallback: true };
  const from = sender || c.sender;
  if (!from) return { ok: false, error: 'شماره فرستنده ثبت نشده است.', fallback: true };
  try {
    const token = await getToken();
    const { json, status } = await httpJson(`${c.baseUrl}/api/send`, {
      body: {
        sending_type: 'pattern',
        from_number: toE164(from),
        code: String(code),
        recipients: [to],
        params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      },
      headers: { Authorization: token },
    });
    const meta = json && json.meta;
    const ok = Boolean(meta && meta.status);
    lastSendInfo = {
      at: new Date().toISOString(), ok, to: 1, pattern: code,
      preview: JSON.stringify(params).slice(0, 120),
      message: meta && meta.message, ids: json && json.data && json.data.message_outbox_ids,
      error: ok ? null : ((meta && meta.message) || `HTTP ${status}`),
    };
    if (!ok) return { ok: false, error: lastSendInfo.error, fallback: true, raw: json };
    await logSend('pattern', [to], `الگو:${code} ${JSON.stringify(params)}`, meta, json);
    return { ok: true, ids: lastSendInfo.ids };
  } catch (err) {
    lastSendInfo = { at: new Date().toISOString(), ok: false, error: err.message, pattern: code };
    return { ok: false, error: err.message, fallback: true };
  }
}

/**
 * ثبت گزارش ارسال در جدول sms_logs (منبع گزارش‌های ماژول پیامک)
 * هیچ‌گاه خطا را به بیرون پرتاب نمی‌کند تا ارسال پیامک را مختل نکند.
 */
async function logSend(kind, recipients, message, meta, raw) {
  try {
    const ok = Boolean(meta && meta.status);
    await db.insert('sms_logs', {
      mobile: recipients.join(',').slice(0, 40),
      type: kind === 'pattern' ? 'pattern' : 'text',
      template_key: kind === 'pattern' ? String((raw && raw.data && raw.data.pattern_code) || '') || null : null,
      body: String(message || '').slice(0, 500),
      ref_type: 'sms',
      ref_id: null,
      status: ok ? 'sent' : 'failed',
      provider_id: String((raw && raw.data && raw.data.message_outbox_ids && raw.data.message_outbox_ids[0]) || '') || null,
      cost: null,
      error: ok ? null : ((meta && meta.message) || 'خطای ارسال'),
      sent_by: null,
      created_at: db.nowSql(),
    });
  } catch (_) { /* بی‌صدا */ }
}

/* ------------------------------------------------------------------ */
/* رمز یک‌بارمصرف (OTP)                                                */
/* ------------------------------------------------------------------ */

/**
 * ساخت و ارسال کد تأیید
 * @returns {{ok:boolean, code?:string, error?:string, expiresAt?:Date, debug?:boolean}}
 */
async function issueOtp(mobile, purpose = 'login', { refType = null, refId = null, name = null, ip = null } = {}) {
  const c = cfg();
  const m = require('../lib/jalali').toLatinDigits(String(mobile || '')).trim();
  if (!/^09\d{9}$/.test(m)) return { ok: false, error: 'شماره موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.' };

  // محدودیت ارسال مجدد
  const last = await db.get(
    `SELECT created_at FROM ${db.t('otp_codes')} WHERE mobile = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    [m, purpose]
  ).catch(() => null);
  if (last && last.created_at) {
    const diff = (Date.now() - new Date(String(last.created_at).replace(' ', 'T') + 'Z').getTime()) / 1000;
    if (diff < c.otpResendSeconds) {
      return { ok: false, error: `برای ارسال دوباره ${Math.ceil(c.otpResendSeconds - diff)} ثانیه صبر کنید.`, wait: Math.ceil(c.otpResendSeconds - diff) };
    }
  }

  const code = security.randomNumericCode(c.otpLength);
  const expires = new Date(Date.now() + c.otpTtlSeconds * 1000);
  const codeHash = security.hmac(code, 'otp|' + m);

  let send = { ok: false, error: 'سرویس پیامک تنظیم نشده است.' };
  if (isEnabled()) {
    if (c.patternCode) {
      // پارامترهای رایج الگوها: code / otp / verifyCode
      send = await sendPattern(m, { code, otp: code, verifyCode: code, name: name || '' });
      if (!send.ok && send.fallback) {
        const text = `کد تأیید شما در سامانه منابع انسانی: ${code}\nاین کد ${c.otpTtlSeconds / 60} دقیقه اعتبار دارد.`;
        send = await sendText(m, text);
      }
    } else {
      const text = `کد تأیید شما در سامانه منابع انسانی: ${code}\nاین کد ${c.otpTtlSeconds / 60} دقیقه اعتبار دارد.`;
      send = await sendText(m, text);
    }
  }

  // کد در همه حالت‌ها ثبت می‌شود تا در حالت آزمایشی هم قابل استفاده باشد
  const id = await db.insert('otp_codes', {
    mobile: m, code_hash: codeHash, purpose, ref_type: refType, ref_id: refId,
    attempts: 0, max_attempts: c.otpMaxAttempts,
    expires_at: db.nowSql(expires), ip,
    send_status: send.ok ? 'sent' : 'failed',
    provider_response: helpers.jsonStringify({ error: send.error || null, ids: send.ids || null }),
  });

  if (!send.ok) {
    // اگر پیامک نرفته باشد، فقط در حالت آزمایشی کد را نشان می‌دهیم
    if (c.debugShowCode) {
      return { ok: true, code, id, expiresAt: expires, debug: true, warning: send.error };
    }
    return { ok: false, error: send.error || 'ارسال پیامک ناموفق بود.', id };
  }
  return { ok: true, code: c.debugShowCode ? code : undefined, id, expiresAt: expires, debug: c.debugShowCode };
}

/**
 * بررسی کد واردشده
 * @returns {{ok:boolean, error?:string, record?:object}}
 */
async function verifyOtp(mobile, code, purpose = 'login') {
  const m = require('../lib/jalali').toLatinDigits(String(mobile || '')).trim();
  const input = require('../lib/jalali').toLatinDigits(String(code || '')).trim();
  if (!m || !input) return { ok: false, error: 'شماره موبایل و کد تأیید الزامی است.' };
  const row = await db.get(
    `SELECT * FROM ${db.t('otp_codes')}
      WHERE mobile = ? AND purpose = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [m, purpose]
  );
  if (!row) return { ok: false, error: 'کدی برای این شماره ارسال نشده است. دوباره درخواست کنید.' };
  if (new Date(String(row.expires_at).replace(' ', 'T') + 'Z') < new Date()) {
    return { ok: false, error: 'کد تأیید منقضی شده است. کد جدید درخواست کنید.', expired: true };
  }
  if (Number(row.attempts) >= Number(row.max_attempts)) {
    return { ok: false, error: 'تعداد تلاش‌های ناموفق زیاد است. کد جدید درخواست کنید.', blocked: true };
  }
  const expected = security.hmac(input, 'otp|' + m);
  if (!security.timingSafeEqual(expected, String(row.code_hash || ''))) {
    await db.run(`UPDATE ${db.t('otp_codes')} SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    const left = Math.max(0, Number(row.max_attempts) - Number(row.attempts) - 1);
    return { ok: false, error: `کد وارد‌شده صحیح نیست. ${helpers.pnum(left)} تلاش باقی مانده است.`, remaining: left };
  }
  await db.run(`UPDATE ${db.t('otp_codes')} SET consumed_at = ? WHERE id = ?`, [db.nowSql(), row.id]);
  return { ok: true, record: row };
}

/** آخرین وضعیت ارسال برای نمایش در پنل تنظیمات */
function status() {
  const c = cfg();
  return {
    enabled: c.enabled,
    configured: isConfigured(),
    mode: c.apiKey ? 'api_key' : (c.username ? 'username_password' : 'none'),
    sender: c.sender,
    patternCode: c.patternCode,
    baseUrl: c.baseUrl,
    debugShowCode: c.debugShowCode,
    lastSend: lastSendInfo,
  };
}

/** آزمون اتصال: ارسال پیامک آزمایشی به یک شماره */
async function test(mobile, text) {
  if (!isConfigured()) return { ok: false, error: 'کلید API یا نام کاربری/گذرواژه آی‌پی‌پنل ثبت نشده است.' };
  const message = text || `پیام آزمایشی سامانه منابع انسانی — ${new Date().toISOString().slice(0, 19)}`;
  let token;
  try { token = await getToken(); } catch (err) { return { ok: false, error: err.message }; }
  if (!token) return { ok: false, error: 'احراز هویت آی‌پی‌پنل انجام نشد.' };
  const c = cfg();
  if (c.patternCode) {
    const r = await sendPattern(mobile, { code: '123456', otp: '123456' });
    if (r.ok) return { ok: true, message: 'پیامک آزمایشی الگو ارسال شد.' };
    return { ok: false, error: r.error };
  }
  const r = await sendText(mobile, message);
  if (r.ok) return { ok: true, message: 'پیامک آزمایشی ارسال شد.' };
  return { ok: false, error: r.error };
}

module.exports = {
  cfg, toE164, isEnabled, isConfigured, sendText, sendPattern,
  issueOtp, verifyOtp, status, test, getToken, BASE_URL_DEFAULT,
};
