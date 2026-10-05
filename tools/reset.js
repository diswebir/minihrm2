'use strict';
/**
 * پاک کردن همه جدول‌های سامانه (فقط در محیط آزمایشی)
 * اجرا: CONFIRM=YES node tools/reset.js
 */
const config = require('../src/config');
const db = require('../src/db');
const schema = require('../src/db/schema');

(async () => {
  if (process.env.CONFIRM !== 'YES') {
    console.error('برای اجرای این دستور باید متغیر CONFIRM=YES تنظیم شود. این عملیات همه داده‌ها را حذف می‌کند.');
    process.exit(1);
  }
  config.ensureDirs();
  await db.connect().catch(() => {});
  const tables = schema.tableNames().filter((t) => t !== 'schema_migrations');
  let dropped = 0;
  for (const t of tables) {
    try { await db.run(`DROP TABLE IF EXISTS ${db.t(t)}`); dropped += 1; } catch (_) {}
  }
  await db.run(`DROP TABLE IF EXISTS ${db.t('schema_migrations')}`).catch(() => {});
  console.log(`${dropped} جدول حذف شد.`);
  await db.close().catch(() => {});
})();
