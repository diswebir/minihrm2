'use strict';
/**
 * سازنده ساختار پایگاه‌داده
 * ----------------------------------------------------------------------------
 *  • ساخت همه جدول‌ها و ایندکس‌ها (ایمن برای اجرای مکرر: IF NOT EXISTS)
 *  • تولید فایل‌های sql/schema-mysql.sql و sql/schema-sqlite.sql برای مرجع/پشتیبان
 *  • امکان بررسی وضعیت جداول (برای صفحه سلامت سامانه)
 */
const fs = require('fs');
const path = require('path');
const db = require('./index');
const schema = require('./schema');
const config = require('../config');

const SQL_DIR = path.join(config.ROOT, 'sql');

function writeSqlFiles() {
  fs.mkdirSync(SQL_DIR, { recursive: true });
  const prefix = db.prefix();
  const mysql = schema.statements('mysql', prefix);
  const sqlite = schema.statements('sqlite', prefix);
  const header = (dialect) => `-- ساختار پایگاه‌داده سامانه مینی HRM\n-- موتور: ${dialect}\n-- این فایل به‌صورت خودکار از src/db/schema.js ساخته شده است — دستی ویرایش نکنید.\n-- تعداد جداول: ${schema.TABLES.length}\n\nSET NAMES utf8mb4;\n\n`;
  fs.writeFileSync(path.join(SQL_DIR, 'schema-mysql.sql'), header('MySQL/MariaDB') + mysql.join('\n\n') + '\n');
  fs.writeFileSync(path.join(SQL_DIR, 'schema-sqlite.sql'), header('SQLite') + sqlite.join('\n\n') + '\n');
  return { mysql: mysql.length, sqlite: sqlite.length, dir: SQL_DIR };
}

/**
 * ساخت ساختار — دستورات را تک‌تک اجرا می‌کند تا در صورت خطای یک ایندکس،
 * کل عملیات متوقف نشود.
 */
async function createSchema({ onProgress } = {}) {
  const dialect = db.isMysql() ? 'mysql' : 'sqlite';
  const stmts = schema.statements(dialect, db.prefix());
  const result = { dialect, total: stmts.length, ok: 0, failed: [], tables: schema.TABLES.length };

  // جدول‌ها اول، بعد ایندکس‌ها (ترتیب خروجی statements همین است)
  for (const stmt of stmts) {
    try {
      await db.exec(stmt);
      result.ok += 1;
    } catch (err) {
      const msg = String(err.message || err);
      // ایندکس موجود / کلید تکراری / خطای بی‌خطر → نادیده بگیر
      if (/Duplicate key name|already exists|duplicate column|Duplicate entry/i.test(msg)) {
        result.ok += 1;
      } else {
        result.failed.push({ statement: stmt.split('\n')[0].slice(0, 120), error: msg.slice(0, 300) });
      }
    }
    if (onProgress) onProgress(result.ok, stmts.length);
  }
  return result;
}

/** وضعیت جداول موجود */
async function status() {
  const dialect = db.isMysql() ? 'mysql' : 'sqlite';
  let existing = [];
  if (dialect === 'mysql') {
    existing = await db.query(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    ).then((rows) => rows.map((r) => r.name));
  } else {
    existing = await db.query("SELECT name FROM sqlite_master WHERE type = 'table'").then((rows) => rows.map((r) => r.name));
  }
  const want = schema.TABLES.map((t) => db.prefix() + t.name);
  const missing = want.filter((t) => !existing.includes(t));
  // شمارش رکورد جدول‌های کلیدی
  const counts = {};
  for (const t of ['users', 'roles', 'permissions', 'modules', 'employees', 'applications', 'form_fields', 'assessment_questions', 'payroll_components']) {
    try {
      const row = await db.get(`SELECT COUNT(*) AS c FROM ${db.t(t)}`);
      counts[t] = Number(row.c);
    } catch (_) { counts[t] = null; }
  }
  return { dialect, expectedTables: want.length, existingTables: existing.filter((n) => want.includes(n)).length, missing, counts };
}

module.exports = { createSchema, writeSqlFiles, status, SQL_DIR };
