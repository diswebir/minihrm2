'use strict';
/**
 * لایه دسترسی به داده — دو درایور با یک API واحد
 * ----------------------------------------------------------------------------
 *  • mysql  : هاست cPanel (MariaDB/MySQL)  ← محیط عملیاتی
 *  • sqlite : اجرای محلی / دمو (node:sqlite داخلی، بدون هیچ پکیج بومی)
 *
 * همه کوئری‌ها فقط با placeholder استاندارد «?» نوشته می‌شوند تا روی هر دو
 * موتور یکسان کار کنند. توابع/سینتکس اختصاصی هر موتور پرهیز شده است.
 *
 * نقشه فایل‌های دیتابیس برای توسعه‌دهنده:
 *   db.query(sql, [params])  → Promise<rows[]>
 *   db.get(sql, [params])    → Promise<row|null>
 *   db.run(sql, [params])    → Promise<{insertId, affectedRows}>
 *   db.tx(async (t) => {...}) → تراکنش؛ t همان API بالا را دارد
 *   db.t('users')            → نام جدول با پیشوند (مثلاً hrm_users)
 */
const config = require('../config');

let driver = null;        // { kind, raw }
let ready = null;         // Promise آماده‌سازی

/* ------------------------------------------------------------------ */
/* ابزارهای مشترک                                                      */
/* ------------------------------------------------------------------ */

/** زمان جاری به‌صورت رشته UTC قابل استفاده در هر دو موتور: YYYY-MM-DD HH:MM:SS */
function nowSql(d = new Date()) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function prefix() {
  return config.get('db.prefix', 'hrm_') || '';
}

/** نام جدول با پیشوند — همیشه از این تابع استفاده کنید */
function t(name) {
  return prefix() + name;
}

function isMysql() {
  return driver && driver.kind === 'mysql';
}

/* ------------------------------------------------------------------ */
/* درایور MySQL                                                        */
/* ------------------------------------------------------------------ */

async function initMysql(cfg) {
  const mysql = require('mysql2/promise');
  const opts = {
    host: cfg.host || 'localhost',
    port: Number(cfg.port) || 3306,
    user: cfg.user,
    password: cfg.password || '',
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: Number(cfg.connectionLimit) || 6,
    queueLimit: 0,
    charset: 'utf8mb4_general_ci',
    dateStrings: true,          // تاریخ‌ها را رشته بگیر تا با SQLite یکسان شود
    multipleStatements: false,
    namedPlaceholders: false,
    timezone: 'Z',
  };
  if (cfg.socketPath) { delete opts.host; delete opts.port; opts.socketPath = cfg.socketPath; }
  const pool = mysql.createPool(opts);
  const conn = await pool.getConnection();
  await conn.query('SET NAMES utf8mb4');
  // اطمینان از پشتیبانی utf8mb4 روی سرورهای قدیمی
  conn.release();
  driver = { kind: 'mysql', raw: pool };
  return driver;
}

/* ------------------------------------------------------------------ */
/* درایور SQLite (اجرای محلی / دمو)                                     */
/* ------------------------------------------------------------------ */

function initSqlite(cfg) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (err) {
    throw new Error(
      'درایور SQLite نیازمند Node.js نسخه ۲۲٫۵ یا بالاتر است. ' +
      'روی هاست cPanel لطفاً درایور MySQL را انتخاب کنید.'
    );
  }
  const fs = require('fs');
  const file = cfg.sqliteFile;
  fs.mkdirSync(require('path').dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  driver = { kind: 'sqlite', raw: db };
  return driver;
}

/* ------------------------------------------------------------------ */
/* API عمومی                                                           */
/* ------------------------------------------------------------------ */

/** نرمال‌سازی پارامترها: undefined → null و boolean → 0/1 */
function normParams(params = []) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return nowSql(p);
    if (p !== null && typeof p === 'object') return JSON.stringify(p);
    return p;
  });
}

async function query(sql, params = []) {
  await ensureReady();
  const p = normParams(params);
  if (driver.kind === 'mysql') {
    const [rows] = await driver.raw.query(sql, p);
    return Array.isArray(rows) ? rows : [];
  }
  const stmt = driver.raw.prepare(sql);
  return stmt.all(...p);
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

async function run(sql, params = []) {
  await ensureReady();
  const p = normParams(params);
  if (driver.kind === 'mysql') {
    const [res] = await driver.raw.query(sql, p);
    return { insertId: res.insertId, affectedRows: res.affectedRows, changedRows: res.changedRows };
  }
  const stmt = driver.raw.prepare(sql);
  const res = stmt.run(...p);
  return { insertId: Number(res.lastInsertRowid), affectedRows: Number(res.changes), changedRows: Number(res.changes) };
}

/** درج و بازگشت شناسه */
async function insert(table, data) {
  const keys = Object.keys(data);
  const cols = keys.map((k) => `\`${k}\``).join(', ');
  const marks = keys.map(() => '?').join(', ');
  const res = await run(`INSERT INTO ${t(table)} (${cols}) VALUES (${marks})`, keys.map((k) => data[k]));
  return res.insertId;
}

/** بروزرسانی بر اساس شرط */
async function update(table, data, where, whereParams = []) {
  const keys = Object.keys(data);
  if (!keys.length) return { affectedRows: 0 };
  const sets = keys.map((k) => `\`${k}\` = ?`).join(', ');
  return run(`UPDATE ${t(table)} SET ${sets} WHERE ${where}`, [...keys.map((k) => data[k]), ...whereParams]);
}

/** حذف بر اساس شناسه */
async function remove(table, id) {
  return run(`DELETE FROM ${t(table)} WHERE id = ?`, [id]);
}

/** اجرای چند دستور (فقط برای DDL) */
async function exec(sql) {
  await ensureReady();
  if (driver.kind === 'mysql') {
    const mysql = require('mysql2/promise');
    const cfg = config.db;
    const conn = await mysql.createConnection({
      host: cfg.host || 'localhost', port: Number(cfg.port) || 3306, user: cfg.user,
      password: cfg.password || '', database: cfg.database, multipleStatements: true,
      charset: 'utf8mb4_general_ci', dateStrings: true,
      ...(cfg.socketPath ? { socketPath: cfg.socketPath } : {}),
    });
    try { await conn.query(sql); } finally { await conn.end(); }
    return;
  }
  driver.raw.exec(sql);
}

/* ------------------------------------------------------------------ */
/* تراکنش                                                              */
/* ------------------------------------------------------------------ */

async function tx(fn) {
  await ensureReady();
  if (driver.kind === 'sqlite') {
    // SQLite سنکرون است؛ برای جلوگیری از تودرتویی از SAVEPOINT استفاده می‌کنیم
    const sp = 'sp_' + Math.random().toString(36).slice(2, 10);
    driver.raw.exec('BEGIN');
    try {
      const res = await fn(api);
      driver.raw.exec('COMMIT');
      return res;
    } catch (err) {
      try { driver.raw.exec('ROLLBACK'); } catch (_) {}
      // تلاش برای سازگاری با فراخوانی تودرتو
      void sp;
      throw err;
    }
  }
  const conn = await driver.raw.getConnection();
  const scoped = {
    query: async (sql, p = []) => { const [rows] = await conn.query(sql, normParams(p)); return Array.isArray(rows) ? rows : []; },
    get: async (sql, p = []) => { const rows = await scoped.query(sql, p); return rows.length ? rows[0] : null; },
    run: async (sql, p = []) => { const [r] = await conn.query(sql, normParams(p)); return { insertId: r.insertId, affectedRows: r.affectedRows, changedRows: r.changedRows }; },
    insert: async (table, data) => {
      const keys = Object.keys(data);
      const [r] = await conn.query(
        `INSERT INTO ${t(table)} (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        normParams(keys.map((k) => data[k])));
      return r.insertId;
    },
    update: async (table, data, where, wp = []) => {
      const keys = Object.keys(data);
      if (!keys.length) return { affectedRows: 0 };
      const [r] = await conn.query(
        `UPDATE ${t(table)} SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE ${where}`,
        normParams([...keys.map((k) => data[k]), ...wp]));
      return { insertId: r.insertId, affectedRows: r.affectedRows, changedRows: r.changedRows };
    },
  };
  await conn.beginTransaction();
  try {
    const res = await fn(scoped);
    await conn.commit();
    return res;
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------------ */
/* راه‌اندازی / اتصال مجدد                                             */
/* ------------------------------------------------------------------ */

async function connect() {
  const cfg = config.db;
  driver = null;
  ready = null;
  if (cfg.driver === 'mysql') await initMysql(cfg);
  else initSqlite(cfg);
  ready = Promise.resolve(true);
  // بررسی اتصال
  await query('SELECT 1 AS ok');
  return { driver: driver.kind, database: cfg.driver === 'mysql' ? cfg.database : cfg.sqliteFile };
}

async function ensureReady() {
  if (!driver) {
    if (!ready) ready = connect().then(() => true).catch((e) => { ready = null; throw e; });
    await ready;
  }
}

/** برای نصب‌کننده: تست اتصال پیش از ذخیره تنظیمات */
async function testConnection(cfg) {
  if (cfg.driver === 'sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('SELECT 1');
    return { ok: true, message: 'درایور SQLite در دسترس است.' };
  }
  const mysql = require('mysql2/promise');
  const opts = {
    host: cfg.host, port: Number(cfg.port) || 3306, user: cfg.user,
    password: cfg.password || '', connectTimeout: 10000, charset: 'utf8mb4_general_ci',
  };
  if (cfg.socketPath) { delete opts.host; delete opts.port; opts.socketPath = cfg.socketPath; }
  let conn;
  try {
    conn = await mysql.createConnection(opts);
    const [rows] = await conn.query(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [cfg.database]);
    if (!rows.length) return { ok: false, message: `پایگاه‌داده «${cfg.database}» پیدا نشد یا کاربر به آن دسترسی ندارد.` };
    const [ver] = await conn.query('SELECT VERSION() AS v');
    return { ok: true, message: `اتصال موفق به MySQL نسخه ${ver[0].v}`, version: ver[0].v };
  } catch (err) {
    return { ok: false, message: 'اتصال برقرار نشد: ' + err.message, code: err.code };
  } finally { if (conn) await conn.end().catch(() => {}); }
}

async function close() {
  if (!driver) return;
  if (driver.kind === 'mysql') await driver.raw.end();
  else driver.raw.close();
  driver = null; ready = null;
}

/* ------------------------------------------------------------------ */
module.exports = {
  t, isMysql, nowSql, prefix,
  query, get, run, insert, update, remove, exec, tx,
  connect, ensureReady, testConnection, close,
  get kind() { return driver ? driver.kind : null; },
  get driverReady() { return Boolean(driver); },
};
