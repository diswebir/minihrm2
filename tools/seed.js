'use strict';
/** بارگذاری داده‌های پایه (نقش‌ها، دسترسی‌ها، ماژول‌ها، فرم استخدام، آزمون، اقلام حقوق) */
const config = require('../src/config');
const db = require('../src/db');
const seed = require('../src/db/seed');
const security = require('../src/lib/security');

(async () => {
  config.ensureDirs();
  await db.connect().catch(() => {});
  const username = process.env.ADMIN_USER || 'admin';
  const existing = await db.get(`SELECT id FROM ${db.t('users')} WHERE is_superadmin = 1 LIMIT 1`).catch(() => null);
  const out = await seed.seedAll(existing ? {} : {
    createSuperAdmin: { username, password: process.env.ADMIN_PASS || security.randomToken(6) + 'Aa1', fullName: 'مدیر سامانه' },
  });
  console.log('داده‌های پایه بارگذاری شد:', JSON.stringify(out));
  if (!existing) console.log(`نام کاربری مدیر سامانه: ${username} — گذرواژه در متغیر ADMIN_PASS تعیین می‌شود.`);
  const demo = String(process.env.DEMO || '').trim();
  if (demo === '1' && typeof seed.seedDemo === 'function') {
    const res = await seed.seedDemo();
    console.log('داده نمونه:', JSON.stringify(res));
  }
  await db.close().catch(() => {});
})();
