'use strict';
/**
 * سرو و بارگذاری فایل‌ها
 * ----------------------------------------------------------------------------
 * فایل‌ها بیرون از پوشه عمومی نگهداری می‌شوند و تنها با کنترل دسترسی سرو
 * می‌شوند؛ بارگذاری با multer و نام‌گذاری امن انجام می‌شود.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const security = require('../lib/security');
const mw = require('../middleware');
const audit = require('../lib/audit');

const router = express.Router();
const UPLOAD_DIR = path.join(config.STORAGE_DIR, 'uploads');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.zip', '.rar', '.mp4', '.mp3']);
const MAX_SIZE = 15 * 1024 * 1024; // ۱۵ مگابایت

function ensureDir() { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); }
ensureDir();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const sub = new Date().toISOString().slice(0, 7); // پوشه ماهانه
    const dir = path.join(UPLOAD_DIR, sub);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safe = (ext && ALLOWED_EXT.has(ext)) ? ext : '.bin';
    cb(null, `${Date.now()}-${security.randomToken(6).replace(/[^a-zA-Z0-9]/g, '')}${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 5 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('پسوند فایل مجاز نیست.'));
    cb(null, true);
  },
});

/** بارگذاری فایل (آزمایشی/عمومی برای فرم داوطلب) → { file: '1404-08/xxx.pdf' } */
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.jsonErr('فایلی انتخاب نشده است.');
  const rel = path.relative(UPLOAD_DIR, req.file.path).split(path.sep).join('/');
  res.jsonOk({ file: rel, name: req.file.originalname, size: req.file.size });
});

/** بارگذاری از داخل فرم‌ها (با احراز هویت) */
router.post('/upload-auth', mw.requireAuth(), upload.single('file'), async (req, res) => {
  if (!req.file) return res.jsonErr('فایلی انتخاب نشده است.');
  const rel = path.relative(UPLOAD_DIR, req.file.path).split(path.sep).join('/');
  await audit.log(req, { action: 'create', module: 'core', entity: 'files', title: `بارگذاری فایل ${req.file.originalname}` });
  res.jsonOk({ file: rel, name: req.file.originalname, size: req.file.size });
});

/** دانلود امن: فایل‌های عمومی داوطلب با لینک امضاشده، سایر فایل‌ها با ورود کاربر */
router.get('/:y/:m/:name', async (req, res, next) => {
  try {
    const rel = `${req.params.y}/${req.params.m}/${req.params.name}`;
    const signed = req.query.sig && security.unsign(String(req.query.sig));
    const publicOk = signed === rel;
    if (!publicOk && !req.user) return res.status(401).render('errors/403', { title: 'دسترسی غیرمجاز', message: 'برای مشاهده این فایل باید وارد سامانه شوید.' });
    const full = path.join(UPLOAD_DIR, rel);
    const resolved = path.resolve(full);
    if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) return res.status(400).render('errors/404', { title: 'مسیر نامعتبر' });
    if (!fs.existsSync(resolved)) return res.status(404).render('errors/404', { title: 'فایل یافت نشد' });
    res.sendFile(resolved);
  } catch (err) { next(err); }
});

/** پشتیبانی از نام‌های تخت (سازگاری با داده‌های قدیمی) */
router.get('/:name', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).render('errors/403', { title: 'دسترسی غیرمجاز', message: 'برای مشاهده این فایل باید وارد سامانه شوید.' });
    const rel = String(req.params.name);
    if (rel.includes('..')) return res.status(400).render('errors/404', { title: 'مسیر نامعتبر' });
    const full = path.join(UPLOAD_DIR, rel);
    if (!fs.existsSync(full)) return res.status(404).render('errors/404', { title: 'فایل یافت نشد' });
    res.sendFile(full);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
module.exports.upload = upload;
