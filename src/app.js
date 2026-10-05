'use strict';
/**
 * ساخت اپلیکیشن Express
 * ----------------------------------------------------------------------------
 * نصب‌کننده، پنل کاربران و درگاه داوطلب استخدام روی همین اپ اجرا می‌شوند.
 */
const path = require('path');
const express = require('express');
const mw = require('./middleware');
const db = require('./db');

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.engine('ejs', require('ejs').__express);

  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  app.use(mw.cookieParser());
  app.use(...mw.bodyReader());
  app.use(mw.csrf());
  app.use(mw.flash());
  app.use(mw.layoutRenderer());
  app.use(await mw.loadUser());

  // --- نصب‌کننده (تنها بخشی که پیش از نصب در دسترس است) ---
  const installer = require('./routes/install');
  app.use('/install', installer.router);
  app.use(installer.guard);

  // --- آمادگی پایگاه‌داده ---
  app.use(async (req, res, next) => {
    try { await db.ensureReady(); next(); } catch (err) {
      res.status(503).render('errors/error', {
        code: 503, title: 'اتصال به پایگاه‌داده برقرار نشد',
        message: 'تنظیمات اتصال پایگاه‌داده را بررسی کنید. ' + (err.message || ''),
      });
    }
  });

  app.use(await mw.locals());

  // فایل‌های بارگذاری‌شده (با کنترل دسترسی)
  app.use('/files', require('./routes/files'));
  // درگاه عمومی داوطلب استخدام: فرم، QR، آزمون، پیگیری وضعیت
  const publicRoutes = require('./routes/public');
  app.use('/apply', publicRoutes);
  app.use('/careers', publicRoutes);

  app.use(require('./routes/auth'));
  app.use(require('./routes/panel'));

  app.use(mw.notFound());
  app.use(mw.errorHandler());

  return app;
}

module.exports = { createApp };
