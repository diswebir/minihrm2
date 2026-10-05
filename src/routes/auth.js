'use strict';
/**
 * مسیرهای احراز هویت
 * ----------------------------------------------------------------------------
 *  • ورود با نام کاربری/موبایل و گذرواژه
 *  • ورود کارمند با رمز یک‌بارمصرف پیامکی (آی‌پی‌پنل)
 *  • فراموشی گذرواژه (بازنشانی با OTP)
 *  • تغییر گذرواژه در پروفایل و اجبار به تغییر در ورود اول
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const settings = require('../lib/settings');
const auth = require('../services/auth');
const sms = require('../services/sms');
const security = require('../lib/security');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const audit = require('../lib/audit');
const mw = require('../middleware');

const router = express.Router();

function safeNext(value) {
  const v = String(value || '');
  if (!v.startsWith('/') || v.startsWith('//')) return '/dashboard';
  return v;
}

/* ------------------------------- ورود ------------------------------- */
router.get('/login', async (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next || '/dashboard'));
  res.render('auth/login', {
    layout: false,
    title: 'ورود به سامانه',
    next: safeNext(req.query.next || '/dashboard'),
    error: null,
    mode: req.query.mode === 'otp' ? 'otp' : 'password',
    installed: req.query.installed === '1',
    allowedOtp: await settings.getBool('app.allow_employee_otp_login', true),
    demoHint: null,
  });
});

router.post('/login', async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next || '/dashboard');

  if (!login || !password) {
    return res.status(422).render('auth/login', {
      layout: false, title: 'ورود به سامانه', next, mode: 'password',
      error: 'نام کاربری و گذرواژه را وارد کنید.', allowedOtp: true, installed: false, demoHint: null,
    });
  }

  const result = await auth.loginWithPassword(req, login, password);
  if (!result.ok) {
    return res.status(401).render('auth/login', {
      layout: false, title: 'ورود به سامانه', next, mode: 'password',
      error: result.error, allowedOtp: true, installed: false, demoHint: null,
    });
  }

  const session = await auth.createSession(result.user, req);
  auth.setSessionCookie(res, session.sid, session.expires, req);
  req.setFlash('success', `${result.user.full_name} خوش آمدید.`);
  if (result.user.must_change_password) return res.redirect('/profile/password?force=1');
  return res.redirect(next);
});

/* --------------------------- ورود با رمز پیامکی --------------------------- */
router.post('/login/otp/request', async (req, res) => {
  const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
  if (!/^09\d{9}$/.test(mobile)) {
    req.setFlash('error', 'شماره موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.');
    return res.redirect('/login?mode=otp');
  }
  const allowed = await settings.getBool('app.allow_employee_otp_login', true);
  if (!allowed) {
    req.setFlash('error', 'ورود با رمز پیامکی توسط مدیر سامانه غیرفعال شده است.');
    return res.redirect('/login?mode=otp');
  }
  const user = await db.get(
    `SELECT u.*, r.rkey AS role_key FROM ${db.t('users')} u LEFT JOIN ${db.t('roles')} r ON r.id = u.role_id
      WHERE u.mobile = ? AND u.deleted_at IS NULL AND u.status = 'active'`,
    [mobile]
  );
  // برای جلوگیری از افشای وجود کاربر، پیام یکسان نمایش داده می‌شود
  if (!user) {
    req.setFlash('info', 'اگر این شماره در سامانه ثبت شده باشد، کد تأیید ارسال می‌شود.');
    return res.redirect(`/login/otp?mobile=${encodeURIComponent(mobile)}`);
  }
  const otp = await sms.issueOtp(mobile, 'login', { refType: 'users', refId: user.id, name: user.full_name, ip: req.ip });
  if (!otp.ok) {
    req.setFlash('error', otp.error || 'ارسال کد ناموفق بود.');
    return res.redirect('/login?mode=otp');
  }
  req.setFlash('success', 'کد تأیید ارسال شد.');
  const query = `?mobile=${encodeURIComponent(mobile)}` + (otp.debug ? `&code=${otp.code}` : '');
  return res.redirect('/login/otp' + query);
});

router.get('/login/otp', (req, res) => {
  res.render('auth/otp', {
    layout: false,
    title: 'ورود با رمز پیامکی',
    mobile: jalali.toLatinDigits(String(req.query.mobile || '')),
    code: req.query.code || null,
    error: null,
    purpose: 'login',
    action: '/login/otp/verify',
    next: safeNext(req.query.next || '/dashboard'),
    backUrl: '/login?mode=otp',
  });
});

router.post('/login/otp/verify', async (req, res) => {
  const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
  const code = jalali.toLatinDigits(String(req.body.code || '').trim());
  const next = safeNext(req.body.next || '/dashboard');
  const result = await sms.verifyOtp(mobile, code, 'login');
  if (!result.ok) {
    return res.status(401).render('auth/otp', {
      layout: false, title: 'ورود با رمز پیامکی', mobile, code: null, error: result.error,
      purpose: 'login', action: '/login/otp/verify', next, backUrl: '/login?mode=otp',
    });
  }
  const user = await db.get(
    `SELECT u.*, r.rkey AS role_key, r.name AS role_name, r.scope AS role_scope
       FROM ${db.t('users')} u LEFT JOIN ${db.t('roles')} r ON r.id = u.role_id
      WHERE u.mobile = ? AND u.deleted_at IS NULL`,
    [mobile]
  );
  if (!user || user.status !== 'active') {
    return res.status(403).render('auth/login', {
      layout: false, title: 'ورود به سامانه', next, mode: 'otp',
      error: 'حساب کاربری فعالی با این شماره یافت نشد.', allowedOtp: true, installed: false, demoHint: null,
    });
  }
  await auth.registerSuccessfulLogin(req, user, 'رمز پیامکی');
  const session = await auth.createSession(user, req);
  auth.setSessionCookie(res, session.sid, session.expires, req);
  req.setFlash('success', `${user.full_name} خوش آمدید.`);
  return res.redirect(next);
});

/* ------------------------------ فراموشی گذرواژه ------------------------------ */
router.get('/forgot', (req, res) => {
  res.render('auth/forgot', {
    layout: false, title: 'بازیابی گذرواژه', stage: 'request', mobile: '', error: null, code: null,
  });
});

router.post('/forgot', async (req, res) => {
  const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
  const user = await db.get(`SELECT id, full_name FROM ${db.t('users')} WHERE mobile = ? AND status = 'active'`, [mobile]);
  if (!/^09\d{9}$/.test(mobile)) {
    return res.status(422).render('auth/forgot', { layout: false, title: 'بازیابی گذرواژه', stage: 'request', mobile, error: 'شماره موبایل معتبر نیست.', code: null });
  }
  if (user) {
    await sms.issueOtp(mobile, 'reset', { refType: 'users', refId: user.id, name: user.full_name, ip: req.ip });
  }
  req.setFlash('info', 'اگر این شماره در سامانه ثبت شده باشد، کد بازیابی ارسال می‌شود.');
  return res.redirect('/forgot/verify?mobile=' + encodeURIComponent(mobile));
});

router.get('/forgot/verify', (req, res) => {
  res.render('auth/forgot', {
    layout: false, title: 'بازیابی گذرواژه', stage: 'verify',
    mobile: jalali.toLatinDigits(String(req.query.mobile || '')), error: null, code: null,
  });
});

router.post('/forgot/verify', async (req, res) => {
  const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
  const code = jalali.toLatinDigits(String(req.body.code || '').trim());
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 || '');
  const render = (error) => res.status(422).render('auth/forgot', {
    layout: false, title: 'بازیابی گذرواژه', stage: 'verify', mobile, error, code: null,
  });
  if (password.length < 8) return render('گذرواژه باید حداقل ۸ کاراکتر باشد.');
  if (password !== password2) return render('تکرار گذرواژه مطابقت ندارد.');
  const otp = await sms.verifyOtp(mobile, code, 'reset');
  if (!otp.ok) return render(otp.error);
  const user = await db.get(`SELECT id FROM ${db.t('users')} WHERE mobile = ?`, [mobile]);
  if (!user) return render('کاربری با این شماره یافت نشد.');
  await db.run(`UPDATE ${db.t('users')} SET password_hash = ?, password_changed_at = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE id = ?`,
    [security.hashPassword(password), db.nowSql(), user.id]);
  await auth.destroyAllSessions(user.id);
  await audit.log(req, { action: 'reset', module: 'core', entity: 'users', entityId: user.id, title: 'بازنشانی گذرواژه با پیامک' });
  req.setFlash('success', 'گذرواژه با موفقیت تغییر کرد. اکنون وارد شوید.');
  return res.redirect('/login');
});

/* ------------------------------- خروج ------------------------------- */
router.post('/logout', async (req, res) => {
  if (req.user) await audit.log(req, { action: 'logout', module: 'core', entity: 'users', entityId: req.user.id, title: req.user.full_name });
  await auth.destroySession(req, res);
  req.setFlash('success', 'با موفقیت خارج شدید.');
  res.redirect('/login');
});

/* --------------------------- تغییر گذرواژه --------------------------- */
router.get('/profile/password', mw.requireAuth(), (req, res) => {
  res.render('auth/change-password', {
    title: 'تغییر گذرواژه',
    force: req.query.force === '1' || req.user.must_change_password,
    error: null,
  });
});

router.post('/profile/password', mw.requireAuth(), async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const next2 = String(req.body.new_password2 || '');
  const render = (error) => res.status(422).render('auth/change-password', {
    title: 'تغییر گذرواژه', force: req.user.must_change_password, error,
  });
  if (next.length < 8) return render('گذرواژه جدید باید حداقل ۸ کاراکتر باشد.');
  if (next !== next2) return render('تکرار گذرواژه جدید مطابقت ندارد.');
  const row = await db.get(`SELECT password_hash FROM ${db.t('users')} WHERE id = ?`, [req.user.id]);
  if (!row || !security.verifyPassword(current, row.password_hash)) return render('گذرواژه فعلی نادرست است.');
  if (security.verifyPassword(next, row.password_hash)) return render('گذرواژه جدید باید با گذرواژه فعلی متفاوت باشد.');
  await db.run(`UPDATE ${db.t('users')} SET password_hash = ?, password_changed_at = ?, must_change_password = 0 WHERE id = ?`,
    [security.hashPassword(next), db.nowSql(), req.user.id]);
  await audit.log(req, { action: 'update', module: 'core', entity: 'users', entityId: req.user.id, title: 'تغییر گذرواژه' });
  req.setFlash('success', 'گذرواژه شما تغییر کرد.');
  res.redirect('/dashboard');
});

/* ------------------------------ پروفایل من ------------------------------ */
router.get('/profile', mw.requireAuth(), async (req, res) => {
  const employee = await db.get(
    `SELECT e.*, d.name AS department_name, jt.title AS job_title_name
       FROM ${db.t('employees')} e
       LEFT JOIN ${db.t('departments')} d ON d.id = e.department_id
       LEFT JOIN ${db.t('job_titles')} jt ON jt.id = e.job_title_id
      WHERE e.user_id = ? AND e.deleted_at IS NULL LIMIT 1`,
    [req.user.id]
  );
  const logins = await db.query(
    `SELECT * FROM ${db.t('login_logs')} WHERE user_id = ? ORDER BY id DESC LIMIT 8`, [req.user.id]
  );
  res.render('auth/profile', { title: 'پروفایل من', employee, logins });
});

router.post('/profile', mw.requireAuth(), async (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim();
  const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
  if (!fullName) {
    req.setFlash('error', 'نام و نام خانوادگی الزامی است.');
    return res.redirect('/profile');
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    req.setFlash('error', 'قالب ایمیل صحیح نیست.');
    return res.redirect('/profile');
  }
  if (mobile && !/^09\d{9}$/.test(mobile)) {
    req.setFlash('error', 'شماره موبایل معتبر نیست.');
    return res.redirect('/profile');
  }
  const dup = await db.get(`SELECT id FROM ${db.t('users')} WHERE mobile = ? AND id <> ?`, [mobile || '', req.user.id]);
  if (mobile && dup) {
    req.setFlash('error', 'این شماره موبایل برای کاربر دیگری ثبت شده است.');
    return res.redirect('/profile');
  }
  await db.run(`UPDATE ${db.t('users')} SET full_name = ?, email = ?, mobile = ? WHERE id = ?`,
    [fullName, email || null, mobile || null, req.user.id]);
  const theme = ['light', 'dark'].includes(String(req.body.theme || '')) ? req.body.theme : null;
  if (theme) await db.run(`UPDATE ${db.t('users')} SET theme = ? WHERE id = ?`, [theme, req.user.id]);
  await audit.log(req, { action: 'update', module: 'core', entity: 'users', entityId: req.user.id, title: 'ویرایش پروفایل' });
  req.setFlash('success', 'پروفایل به‌روزرسانی شد.');
  res.redirect('/profile');
});

/* ------------------------- اطلاع‌رسانی‌های من ------------------------- */
router.get('/notifications', mw.requireAuth(), async (req, res) => {
  const rows = await db.query(
    `SELECT * FROM ${db.t('notifications')} WHERE user_id = ? ORDER BY id DESC LIMIT 100`, [req.user.id]
  );
  res.render('auth/notifications', { title: 'اطلاع‌رسانی‌ها', rows });
});

router.post('/notifications/read', mw.requireAuth(), async (req, res) => {
  await db.run(`UPDATE ${db.t('notifications')} SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, [db.nowSql(), req.user.id]);
  res.jsonOk({ message: 'همه اطلاع‌رسانی‌ها خوانده‌شده علامت زدند.' });
});

module.exports = router;
