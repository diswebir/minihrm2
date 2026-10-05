'use strict';
/**
 * سرویس احراز هویت و کنترل دسترسی
 * ----------------------------------------------------------------------------
 *  • نشست‌های پایگاه‌داده‌ای با کوکی امضاشده (بدون وابستگی به حافظه سرور → سازگار cPanel)
 *  • ورود با نام کاربری/موبایل و گذرواژه
 *  • ورود کارمند با رمز یک‌بارمصرف پیامکی (آی‌پی‌پنل)
 *  • دسترسی نقش‌محور: هر نقش مجموعه‌ای از مجوزهای ماژول‌ها را دارد
 */
const db = require('../db');
const config = require('../config');
const security = require('../lib/security');
const settings = require('../lib/settings');
const audit = require('../lib/audit');
const helpers = require('../lib/helpers');

const COOKIE_NAME = 'hrm_session';
const SESSION_MS_DEFAULT = 12 * 60 * 60 * 1000;

/* ------------------------- ساخت/بازیابی نشست ------------------------- */

async function sessionTtl() {
  const hours = await settings.getNumber('security.session_hours', 12);
  return Math.max(1, hours) * 60 * 60 * 1000;
}

async function createSession(user, req) {
  const sid = security.randomToken(32);
  const csrf = security.randomToken(24);
  const ttl = await sessionTtl();
  const expires = new Date(Date.now() + ttl);
  await db.run(
    `INSERT INTO ${db.t('sessions')} (sid, user_id, ip, user_agent, csrf, expires_at, last_seen_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [sid, user.id, req ? req.ip : null,
      req ? String(req.headers['user-agent'] || '').slice(0, 250) : null,
      csrf, db.nowSql(expires), db.nowSql(), db.nowSql()]
  );
  return { sid, csrf, expires };
}

function setSessionCookie(res, sid, expires) {
  res.cookie(COOKIE_NAME, security.sign(sid), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,           // روی cPanel با SSL می‌توانید true کنید
    expires,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

async function loadSession(req) {
  const raw = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!raw) return null;
  const sid = security.unsign(raw);
  if (!sid) return null;
  const row = await db.get(
    `SELECT s.*, u.username, u.full_name, u.email, u.mobile, u.avatar, u.status AS user_status,
            u.role_id, u.is_superadmin, u.must_change_password, r.rkey AS role_key, r.name AS role_name,
            r.scope AS role_scope, r.is_locked AS role_locked
       FROM ${db.t('sessions')} s
       JOIN ${db.t('users')} u ON u.id = s.user_id
       LEFT JOIN ${db.t('roles')} r ON r.id = u.role_id
      WHERE s.sid = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    [sid, db.nowSql()]
  );
  if (!row || row.user_status !== 'active') return null;
  // دسترسی‌ها را یک‌بار در هر درخواست بارگذاری می‌کنیم
  const permissions = await permissionsOf(row);
  const user = {
    id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    mobile: row.mobile,
    avatar: row.avatar,
    role_id: row.role_id,
    role_key: row.role_key,
    role_name: row.role_name,
    role_scope: row.role_scope,
    is_superadmin: Boolean(row.is_superadmin),
    must_change_password: Boolean(row.must_change_password),
    permissions,
    sid,
    csrf: row.csrf,
  };
  // به‌روزرسانی آخرین بازدید (بدون انتظار — برای سرعت)
  db.run(`UPDATE ${db.t('sessions')} SET last_seen_at = ? WHERE sid = ?`, [db.nowSql(), sid]).catch(() => {});
  return user;
}

async function permissionsOf(userRow) {
  if (userRow.is_superadmin) return ['*'];
  if (!userRow.role_id) return [];
  try {
    const rows = await db.query(
      `SELECT p.pkey FROM ${db.t('role_permissions')} rp
         JOIN ${db.t('permissions')} p ON p.id = rp.permission_id
        WHERE rp.role_id = ?`,
      [userRow.role_id]
    );
    return rows.map((r) => r.pkey);
  } catch (_) { return []; }
}

async function destroySession(req, res) {
  const raw = req.cookies ? req.cookies[COOKIE_NAME] : null;
  const sid = raw ? security.unsign(raw) : null;
  if (sid) {
    await db.run(`UPDATE ${db.t('sessions')} SET revoked_at = ? WHERE sid = ?`, [db.nowSql(), sid]);
  }
  clearSessionCookie(res);
}

async function destroyAllSessions(userId) {
  await db.run(`UPDATE ${db.t('sessions')} SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, [db.nowSql(), userId]);
}

/* ------------------------------ ورود ------------------------------ */

async function findUserByLogin(login) {
  const value = String(login || '').trim();
  if (!value) return null;
  return db.get(
    `SELECT u.*, r.rkey AS role_key, r.name AS role_name, r.scope AS role_scope
       FROM ${db.t('users')} u LEFT JOIN ${db.t('roles')} r ON r.id = u.role_id
      WHERE (u.username = ? OR u.mobile = ? OR u.email = ?) AND u.deleted_at IS NULL
      LIMIT 1`,
    [value, value, value]
  );
}

/**
 * ورود با گذرواژه
 * @returns {Promise<{ok:boolean, user?:object, error?:string, lockedUntil?:string}>}
 */
async function loginWithPassword(ctx, login, password) {
  const maxAttempts = await settings.getNumber('security.max_failed_attempts', 7);
  const lockMinutes = await settings.getNumber('security.lockout_minutes', 15);
  const user = await findUserByLogin(login);
  const ip = ctx ? ctx.ip : null;
  const ua = ctx ? String(ctx.headers['user-agent'] || '').slice(0, 250) : null;

  const fail = async (reason, userRow) => {
    await db.run(
      `INSERT INTO ${db.t('login_logs')} (user_id, username, ok, reason, ip, user_agent, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [userRow ? userRow.id : null, String(login || '').slice(0, 100), 0, reason, ip, ua, db.nowSql()]
    );
    await audit.log(ctx, { action: 'login_failed', module: 'core', entity: 'users', entityId: userRow ? userRow.id : null, title: `${login} — ${reason}` });
  };

  if (!user) { await fail('کاربر یافت نشد'); return { ok: false, error: 'نام کاربری یا گذرواژه نادرست است.' }; }
  if (user.status !== 'active') { await fail('حساب غیرفعال', user); return { ok: false, error: 'حساب کاربری شما غیرفعال است. با مدیر سامانه تماس بگیرید.' }; }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await fail('حساب قفل است', user);
    return { ok: false, error: 'حساب شما به دلیل تلاش‌های ناموفق موقتاً قفل شده است.', lockedUntil: user.locked_until };
  }

  if (!security.verifyPassword(password, user.password_hash)) {
    const attempts = helpers.toNumber(user.failed_attempts, 0) + 1;
    const lock = attempts >= maxAttempts ? db.nowSql(new Date(Date.now() + lockMinutes * 60000)) : null;
    await db.run(`UPDATE ${db.t('users')} SET failed_attempts = ?, locked_until = ? WHERE id = ?`, [attempts, lock, user.id]);
    await fail('گذرواژه نادرست', user);
    const remaining = Math.max(0, maxAttempts - attempts);
    return {
      ok: false,
      error: lock
        ? `تعداد تلاش‌های ناموفق زیاد شد. حساب شما تا ${helpers.pnum(lockMinutes)} دقیقه قفل شد.`
        : `گذرواژه نادرست است. ${remaining} تلاش دیگر باقی مانده.`,
      lockedUntil: lock,
    };
  }

  await db.run(
    `UPDATE ${db.t('users')} SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ? WHERE id = ?`,
    [db.nowSql(), ip, user.id]
  );
  await db.run(
    `INSERT INTO ${db.t('login_logs')} (user_id, username, ok, reason, ip, user_agent, created_at) VALUES (?,?,?,?,?,?,?)`,
    [user.id, user.username, 1, 'گذرواژه', ip, ua, db.nowSql()]
  );
  await audit.log(ctx, { action: 'login', module: 'core', entity: 'users', entityId: user.id, title: user.full_name });
  return { ok: true, user };
}

/** ثبت ورود موفق پس از احراز OTP */
async function registerSuccessfulLogin(ctx, user, reason = 'رمز یک‌بارمصرف') {
  await db.run(
    `UPDATE ${db.t('users')} SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ? WHERE id = ?`,
    [db.nowSql(), ctx ? ctx.ip : null, user.id]
  );
  await db.run(
    `INSERT INTO ${db.t('login_logs')} (user_id, username, ok, reason, ip, user_agent, created_at) VALUES (?,?,?,?,?,?,?)`,
    [user.id, user.username, 1, reason, ctx ? ctx.ip : null,
      ctx ? String(ctx.headers['user-agent'] || '').slice(0, 250) : null, db.nowSql()]
  );
  await audit.log(ctx, { action: 'login', module: 'core', entity: 'users', entityId: user.id, title: `${user.full_name} (${reason})` });
}

/* --------------------------- کنترل دسترسی --------------------------- */

function can(user, permission) {
  if (!user) return false;
  if (user.is_superadmin) return true;
  const perms = user.permissions || [];
  if (perms.includes('*') || perms.includes(permission)) return true;
  // پشتیبانی از سلسله‌مراتب: payroll.run با داشتن payroll.*
  const mod = permission.split('.')[0];
  if (perms.includes(`${mod}.*`)) return true;
  return false;
}

function canAny(user, permissions = []) {
  return permissions.some((p) => can(user, p));
}

function isHr(user) {
  return Boolean(user) && ['admin', 'hr'].includes(user.role_scope);
}

/** نقش‌هایی که کاربر می‌تواند داشته باشد */
async function listRoles() {
  return db.query(`SELECT * FROM ${db.t('roles')} WHERE status = 'active' ORDER BY sort_order, id`);
}

module.exports = {
  COOKIE_NAME, SESSION_MS_DEFAULT,
  createSession, setSessionCookie, clearSessionCookie, loadSession, destroySession, destroyAllSessions,
  permissionsOf, findUserByLogin, loginWithPassword, registerSuccessfulLogin,
  can, canAny, isHr, listRoles,
};
