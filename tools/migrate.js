'use strict';
/** ساخت جدول‌های پایگاه‌داده + تولید فایل‌های SQL (برای نصب دستی در phpMyAdmin) */
const config = require('../src/config');
const db = require('../src/db');
const migrator = require('../src/db/migrator');

(async () => {
  config.ensureDirs();
  await db.connect().catch(() => {});
  const out = await migrator.createSchema();
  console.log(`جدول‌ها: ${out.ok}/${out.total} با موفقیت ساخته شد${out.failed.length ? ' — خطا: ' + out.failed.length : ''}`);
  out.failed.forEach((f) => console.warn('  ✗', f.table, f.error));
  const files = migrator.writeSqlFiles();
  console.log(`فایل‌های SQL نوشته شد: ${files.dir} (mysql: ${files.mysql} دستور، sqlite: ${files.sqlite} دستور)`);
  const st = await migrator.status();
  console.log(`وضعیت: ${st.existingTables}/${st.expectedTables} جدول موجود${st.missing.length ? ' — ناموجود: ' + st.missing.join(', ') : ''}`);
  console.log('شمارش رکوردهای کلیدی:', JSON.stringify(st.counts));
  await db.close().catch(() => {});
})();
