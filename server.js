'use strict';
/**
 * اجرای سامانه
 * ----------------------------------------------------------------------------
 * • روی cPanel: در بخش Setup Node.js App، فایل شروع را server.js قرار دهید.
 * • پورت از متغیر محیطی PORT خوانده می‌شود (پیش‌فرض 3000).
 */
const config = require('./src/config');
const { createApp } = require('./src/app');

config.ensureDirs();

const port = Number(process.env.PORT || config.get('app.port', 3000)) || 3000;
const host = process.env.HOST || '0.0.0.0';

(async () => {
  const app = await createApp();
  const server = app.listen(port, host, () => {
  const installed = config.isInstalled();
    console.log('──────────────────────────────────────────────');
    console.log(`  ${config.get('app.name', 'مینی HRM')} — نسخه ${require('./package.json').version}`);
    console.log(`  آدرس اجرا: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`  وضعیت نصب: ${installed ? 'نصب‌شده' : 'نصب‌نشده — از مسیر /install نصب کنید'}`);
    console.log(`  درایور پایگاه‌داده: ${config.db.driver}${config.db.driver === 'mysql' ? ' (' + config.db.database + ')' : ''}`);
    console.log('──────────────────────────────────────────────');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`پورت ${port} در استفاده است. متغیر PORT را تغییر دهید.`);
    else console.error('خطای اجرای سرور:', err.message);
    process.exit(1);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
})();
