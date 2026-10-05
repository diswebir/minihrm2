'use strict';
/**
 * نصب‌کننده تحت مرورگر (سازگار با هاست cPanel بدون SSH)
 * ----------------------------------------------------------------------------
 * در نخستین اجرا، همه درخواست‌ها به همین ویزارد هدایت می‌شوند. کاربر مراحل را
 * در مرورگر کامل می‌کند و سامانه فایل storage/config.json را می‌سازد، جداول را
 * ایجاد و داده‌های اولیه را ثبت می‌کند و نخستین سوپر ادمین را به وجود می‌آورد.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');
const security = require('../lib/security');
const jalali = require('../lib/jalali');
const helpers = require('../lib/helpers');

const router = express.Router();
const INSTALL_LOCK = path.join(config.STORAGE_DIR, 'install.lock');

function isInstalled() {
  try {
    if (!config.isInstalled()) return false;
    if (fs.existsSync(INSTALL_LOCK)) return true;
    // اگر فایل قفل نبود ولی تنظیمات هست، همچنان نصب‌شده تلقی می‌شود
    return true;
  } catch (_) { return false; }
}

/** بررسی پیش‌نیازهای محیط هاست */
function requirements() {
  const items = [];
  const nodeMajor = Number(process.version.replace('v', '').split('.')[0]);
  items.push({
    title: `نسخه Node.js (${process.version})`,
    ok: nodeMajor >= 18,
    hint: 'حداقل Node.js 18 — پیشنهاد: ۲۰ یا بالاتر (در cPanel از بخش Setup Node.js App قابل انتخاب است)',
    critical: true,
  });
  try {
    config.ensureDirs();
    const probe = path.join(config.STORAGE_DIR, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    items.push({ title: 'دسترسی نوشتن در پوشه storage', ok: true, hint: 'برای ذخیره تنظیمات، فایل‌ها و پشتیبان‌ها', critical: true });
  } catch (err) {
    items.push({ title: 'دسترسی نوشتن در پوشه storage', ok: false, hint: `دسترسی نوشتن وجود ندارد: ${err.message}. سطح دسترسی پوشه storage را روی 755 یا 775 قرار دهید.`, critical: true });
  }
  try {
    require('node:sqlite');
    items.push({ title: 'درایور SQLite داخلی (برای حالت آزمایشی)', ok: true, hint: 'در صورت نبود MySQL می‌توانید از حالت آزمایشی استفاده کنید', critical: false });
  } catch (_) {
    items.push({ title: 'درایور SQLite داخلی', ok: false, hint: 'در Node.js 22.5+ موجود است — برای هاست cPanel از MySQL استفاده کنید', critical: false });
  }
  try {
    const mysql = require('mysql2');
    items.push({ title: `پکیج MySQL (mysql2 ${require('mysql2/package.json').version})`, ok: Boolean(mysql), hint: 'برای اتصال به پایگاه‌داده cPanel', critical: true });
  } catch (_) {
    items.push({ title: 'پکیج MySQL (mysql2)', ok: false, hint: 'اجرای دستور npm install در ترمینال cPanel یا آپلود پوشه node_modules', critical: true });
  }
  const canWriteConfig = (() => {
    try {
      fs.writeFileSync(config.CONFIG_FILE + '.test', '{}');
      fs.unlinkSync(config.CONFIG_FILE + '.test');
      return true;
    } catch (_) { return false; }
  })();
  items.push({ title: 'قابلیت ساخت فایل تنظیمات storage/config.json', ok: canWriteConfig, hint: 'در صورت خطا، دسترسی پوشه را اصلاح کنید', critical: true });
  return items;
}

const GATE_HTML = (title, message) => ({
  title, message, code: 0,
});

async function renderInstall(req, res, extra = {}) {
  const reqs = requirements();
  const allOk = reqs.filter((r) => r.critical).every((r) => r.ok);
  const cfg = config.load();
  res.render('install/wizard', {
    layout: false,
    title: 'نصب سامانه مینی HRM',
    // لوکال‌های پایه (چون میان‌افزار locals پیش از نصب اجرا نمی‌شود)
    h: helpers,
    j: jalali,
    jalali,
    icons: require('../lib/icons'),
    icon: require('../lib/icons').icon,
    csrfToken: req.cookies ? req.cookies.hrm_csrf : '',
    step: extra.step || 'start',
    requirements: reqs,
    allOk,
    errors: extra.errors || {},
    error: extra.error || req.query.error || null,
    success: extra.success || null,
    values: extra.values || {
      driver: cfg.db.driver || 'mysql',
      host: cfg.db.host || 'localhost',
      port: cfg.db.port || 3306,
      database: cfg.db.database || '',
      user: cfg.db.user || '',
      password: '',
      prefix: cfg.db.prefix || 'hrm_',
      companyName: cfg.company.name || '',
      companyNationalId: cfg.company.nationalId || '',
      companyPhone: cfg.company.phone || '',
      companyAddress: cfg.company.address || '',
      companyEmail: cfg.company.email || '',
      adminName: '',
      adminUsername: 'admin',
      adminMobile: '',
      adminEmail: '',
      smsApiKey: '',
      smsSender: '',
      smsPattern: '',
      smsUsername: '',
      smsPassword: '',
      demo: false,
    },
    done: extra.done || false,
    credentials: extra.credentials || null,
  });
}

/* --------------------------- GET /install --------------------------- */
router.get('/', async (req, res) => {
  if (isInstalled() && !req.query.force) {
    return res.redirect('/login?installed=1');
  }
  if (req.query.done === '1') {
    return renderInstall(req, res, { done: true, step: 'done', credentials: null });
  }
  return renderInstall(req, res);
});

/* ---------------------- POST /install/test-db ---------------------- */
router.post('/test-db', async (req, res) => {
  const driver = String(req.body.driver || 'mysql');
  const cfg = {
    driver,
    host: String(req.body.host || 'localhost').trim(),
    port: helpers.toNumber(req.body.port, 3306),
    database: String(req.body.database || '').trim(),
    user: String(req.body.user || '').trim(),
    password: String(req.body.password || ''),
    socketPath: String(req.body.socketPath || '').trim(),
    sqliteFile: path.join(config.STORAGE_DIR, 'minihrm.sqlite'),
  };
  if (driver === 'sqlite') {
    try {
      require('node:sqlite');
      return res.json({ ok: true, message: 'حالت آزمایشی (SQLite) آماده است. اطلاعات در پوشه storage ذخیره می‌شود.' });
    } catch (err) {
      return res.json({ ok: false, message: 'درایور SQLite در این نسخه Node.js موجود نیست. از MySQL استفاده کنید.' });
    }
  }
  if (!cfg.database || !cfg.user) {
    return res.json({ ok: false, message: 'نام پایگاه‌داده و نام کاربری الزامی است. در cPanel از بخش MySQL Databases ساخته می‌شود.' });
  }
  try {
    const result = await db.testConnection(cfg);
    return res.json({ ok: result.ok, message: result.message + (result.version ? ` — نسخه ${result.version}` : '') });
  } catch (err) {
    return res.json({ ok: false, message: 'خطا در بررسی اتصال: ' + err.message });
  }
});

/* --------------------------- POST /install --------------------------- */
router.post('/', async (req, res) => {
  const b = req.body || {};
  const errors = {};
  const values = { ...b, password: b.password || '' };

  const driver = String(b.driver || 'mysql');
  const prefix = String(b.prefix || 'hrm_').replace(/[^a-zA-Z0-9_]/g, '') || 'hrm_';
  const adminUsername = String(b.adminUsername || '').trim().toLowerCase();
  const adminPassword = String(b.adminPassword || '');
  const adminPassword2 = String(b.adminPassword2 || '');
  const adminName = String(b.adminName || '').trim();
  const adminMobile = jalali.toLatinDigits(String(b.adminMobile || '').trim());

  if (!/^[a-z0-9._-]{3,40}$/.test(adminUsername)) errors.adminUsername = 'نام کاربری باید ۳ تا ۴۰ کاراکتر و شامل حروف کوچک لاتین، عدد، نقطه، خط تیره باشد.';
  if (adminPassword.length < 8) errors.adminPassword = 'گذرواژه باید حداقل ۸ کاراکتر باشد.';
  if (security.passwordStrength(adminPassword) < 40) errors.adminPassword = 'گذرواژه انتخابی ساده است. از حروف بزرگ و کوچک، عدد و نماد استفاده کنید.';
  if (adminPassword !== adminPassword2) errors.adminPassword2 = 'تکرار گذرواژه مطابقت ندارد.';
  if (!adminName || adminName.length < 3) errors.adminName = 'نام و نام خانوادگی مدیر را وارد کنید.';
  if (adminMobile && !/^09\d{9}$/.test(adminMobile)) errors.adminMobile = 'شماره موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.';

  if (driver === 'mysql') {
    if (!String(b.database || '').trim()) errors.database = 'نام پایگاه‌داده الزامی است.';
    if (!String(b.user || '').trim()) errors.user = 'نام کاربری پایگاه‌داده الزامی است.';
  }

  if (Object.keys(errors).length) {
    const reqs = requirements();
    return res.status(422).render('install/wizard', {
      layout: false, title: 'نصب سامانه مینی HRM', step: 'form',
      requirements: reqs, allOk: reqs.filter((r) => r.critical).every((r) => r.ok),
      errors, error: 'لطفاً خطاهای مشخص‌شده را برطرف کنید.', success: null, values, done: false, credentials: null,
    });
  }

  // ---- ۱) بررسی اتصال پایگاه‌داده ----
  const dbCfg = {
    driver,
    host: String(b.host || 'localhost').trim(),
    port: helpers.toNumber(b.port, 3306),
    database: String(b.database || '').trim(),
    user: String(b.user || '').trim(),
    password: String(b.password || ''),
    socketPath: String(b.socketPath || '').trim(),
    prefix,
    sqliteFile: path.join(config.STORAGE_DIR, 'minihrm.sqlite'),
  };
  try {
    if (driver === 'mysql') {
      const test = await db.testConnection(dbCfg);
      if (!test.ok) throw new Error(test.message);
    }
  } catch (err) {
    const reqs = requirements();
    return res.status(422).render('install/wizard', {
      layout: false, title: 'نصب سامانه مینی HRM', step: 'form',
      requirements: reqs, allOk: reqs.filter((r) => r.critical).every((r) => r.ok),
      errors: { database: err.message }, error: 'اتصال به پایگاه‌داده برقرار نشد.', success: null, values, done: false, credentials: null,
    });
  }

  // ---- ۲) ذخیره تنظیمات ----
  try {
    config.ensureDirs();
    const company = {
      name: String(b.companyName || 'شرکت من').trim(),
      legalName: String(b.companyLegalName || '').trim(),
      nationalId: jalali.toLatinDigits(String(b.companyNationalId || '').trim()),
      registrationNo: jalali.toLatinDigits(String(b.companyRegistrationNo || '').trim()),
      economicCode: jalali.toLatinDigits(String(b.companyEconomicCode || '').trim()),
      knowledgeBased: ['1', 'on', 'true'].includes(String(b.knowledgeBased || '')),
      address: String(b.companyAddress || '').trim(),
      phone: String(b.companyPhone || '').trim(),
      email: String(b.companyEmail || '').trim(),
      logo: '',
      currency: 'ریال',
    };
    const sms = {
      enabled: Boolean(String(b.smsApiKey || '').trim() || (String(b.smsUsername || '').trim() && String(b.smsPassword || '').trim())),
      provider: 'ippanel',
      username: String(b.smsUsername || '').trim(),
      password: String(b.smsPassword || '') ? security.encrypt(String(b.smsPassword || '')) : '',
      apiKey: String(b.smsApiKey || '') ? security.encrypt(String(b.smsApiKey || '')) : '',
      sender: String(b.smsSender || '').trim(),
      patternCode: String(b.smsPattern || '').trim(),
      baseUrl: 'https://api.ippanel.com',
      debugShowCode: driver === 'sqlite',
    };
    config.save({
      installed: true,
      installedAt: new Date().toISOString(),
      app: {
        name: String(b.companyName || 'مینی HRM').trim(),
        publicBaseUrl: '',
        debug: false,
        secretKey: config.get('app.secretKey', '') || security.randomToken(32),
      },
      db: dbCfg,
      company,
      sms,
      version: require('../../package.json').version,
    });
  } catch (err) {
    return renderInstall(req, res, { step: 'form', error: 'ذخیره فایل تنظیمات ناموفق بود: ' + err.message, values });
  }

  // ---- ۳) ساخت جداول و داده‌های اولیه ----
  let schemaResult;
  let seedResult;
  try {
    await db.connect();
    const migrator = require('../db/migrator');
    migrator.writeSqlFiles();
    schemaResult = await migrator.createSchema();
    if (schemaResult.failed.length && schemaResult.ok < schemaResult.total) {
      throw new Error('خطا در ساخت جداول: ' + schemaResult.failed.slice(0, 3).map((f) => f.error).join(' | '));
    }
    const seed = require('../db/seed');
    seedResult = await seed.seedAll({
      createSuperAdmin: {
        username: adminUsername,
        passwordHash: security.hashPassword(adminPassword),
        fullName: adminName,
        mobile: adminMobile || null,
        email: String(b.adminEmail || '').trim() || null,
      },
    });
  } catch (err) {
    return renderInstall(req, res, {
      step: 'form',
      error: 'ساخت پایگاه‌داده ناموفق بود: ' + err.message,
      values,
    });
  }

  try {
    fs.writeFileSync(INSTALL_LOCK, JSON.stringify({ at: new Date().toISOString(), version: 1 }), { mode: 0o600 });
  } catch (_) {}

  return renderInstall(req, res, {
    step: 'done',
    done: true,
    success: 'نصب با موفقیت انجام شد.',
    credentials: {
      username: adminUsername,
      password: adminPassword,
      tables: schemaResult ? schemaResult.tables : null,
      statements: schemaResult ? schemaResult.ok : null,
      permissions: seedResult ? seedResult.permissionsRoles.permissions : null,
      roles: seedResult ? seedResult.permissionsRoles.roles : null,
      modules: seedResult ? seedResult.modules : null,
      driver,
      database: driver === 'mysql' ? dbCfg.database : 'storage/minihrm.sqlite',
    },
  });
});

/** میان‌افزار نگهبان: اگر نصب نشده باشد → ویزارد */
function guard(req, res, next) {
  if (!isInstalled()) {
    if (req.originalUrl.startsWith('/assets') || req.originalUrl.startsWith('/install')) return next();
    return res.redirect('/install');
  }
  next();
}

/** آیا سامانه نیاز به نصب دارد؟ (برای بررسی سریع) */
function needsInstall() {
  return !isInstalled();
}

module.exports = { router, guard, needsInstall, isInstalled, requirements, INSTALL_LOCK };
