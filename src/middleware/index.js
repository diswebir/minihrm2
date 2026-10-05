'use strict';
/**
 * میان‌افزارهای مشترک سامانه
 * ----------------------------------------------------------------------------
 * کوکی، نشست، CSRF، پیام‌های فلش، مقادیر مشترک قالب‌ها، کنترل دسترسی و خطاها
 */
const crypto = require('crypto');
const auth = require('../services/auth');
const settings = require('../lib/settings');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const registry = require('../modules');
const modulesService = require('../services/modules');
const config = require('../config');
const security = require('../lib/security');
const icons = require('../lib/icons');
const uikit = require('../lib/uikit');

/* ---------------------------- کوکی‌خوان ---------------------------- */
function cookieParser() {
  return (req, res, next) => {
    const header = req.headers.cookie || '';
    const cookies = {};
    header.split(';').forEach((part) => {
      const idx = part.indexOf('=');
      if (idx < 0) return;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (!k) return;
      try { cookies[k] = decodeURIComponent(v); } catch (_) { cookies[k] = v; }
    });
    req.cookies = cookies;
    res.cookie = (name, value, opts = {}) => {
      const parts = [`${name}=${encodeURIComponent(value)}`];
      if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
      if (opts.expires) parts.push(`Expires=${new Date(opts.expires).toUTCString()}`);
      parts.push(`Path=${opts.path || '/'}`);
      if (opts.httpOnly !== false) parts.push('HttpOnly');
      parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
      if (opts.secure) parts.push('Secure');
      const prev = res.getHeader('Set-Cookie');
      const arr = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
      arr.push(parts.join('; '));
      res.setHeader('Set-Cookie', arr);
    };
    res.clearCookie = (name, opts = {}) => {
      res.cookie(name, '', { ...opts, expires: new Date(0) });
    };
    next();
  };
}

/* ------------------------- پارامترهای بدنه ------------------------- */
/** پشتیبانی از فرم‌های HTML و JSON — بدون وابستگی سنگین body-parser */
function bodyReader() {
  const express = require('express');
  return [express.urlencoded({ extended: true, limit: '5mb' }), express.json({ limit: '5mb' })];
}

/* ------------------------------- CSRF ------------------------------- */
function csrf() {
  return (req, res, next) => {
    if (!req.cookies.hrm_csrf) {
      const token = security.randomToken(24);
      res.cookie('hrm_csrf', token, { sameSite: 'Strict' });
      req.cookies.hrm_csrf = token;
    }
    req.csrfToken = () => req.cookies.hrm_csrf;
    const method = String(req.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      // در فرم‌های multipart (بارگذاری فایل) بدنه پس از این میدل‌ور خوانده می‌شود؛
      // بنابراین اجازه می‌دهیم توکن از کوئری‌استرینگ هم پذیرفته شود.
      const isMultipart = String(req.headers['content-type'] || '').startsWith('multipart/form-data');
      const sent = (req.body && (req.body._csrf || req.body.csrf))
        || (isMultipart ? (req.query._csrf || req.query.csrf) : '')
        || req.headers['x-csrf-token'] || '';
      if (!sent || !security.timingSafeEqual(String(sent), String(req.cookies.hrm_csrf))) {
        if (req.xhr || (req.headers.accept || '').includes('application/json')) {
          return res.status(419).json({ ok: false, error: 'توکن امنیتی نامعتبر است. صفحه را دوباره بارگذاری کنید.' });
        }
        return res.status(419).render('errors/error', {
          code: 419, title: 'نشست منقضی شده است',
          message: 'برای امنیت بیشتر، توکن این فرم منقضی شده است. لطفاً صفحه را دوباره بارگذاری کنید.',
        });
      }
    }
    next();
  };
}

/* ------------------------------ فلش‌ها ------------------------------ */
function flash() {
  return (req, res, next) => {
    let flashData = null;
    if (req.cookies.hrm_flash) {
      const raw = security.unsign(req.cookies.hrm_flash);
      flashData = helpers.jsonParse(raw, null);
      res.clearCookie('hrm_flash', { path: '/' });
    }
    req.setFlash = (type, message) => {
      res.cookie('hrm_flash', security.sign(helpers.jsonStringify({ type, message })), { path: '/' });
    };
    res.locals.flash = flashData;
    next();
  };
}

/* --------------------------- رندر با قالب --------------------------- */
function layoutRenderer() {
  return (req, res, next) => {
    const original = res.render.bind(res);
    res.render = (view, options, callback) => {
      let opts = options;
      let cb = callback;
      if (typeof options === 'function') { cb = options; opts = {}; }
      opts = { ...(opts || {}) };
      const noLayout = opts.layout === false || view === 'layout' || String(view).startsWith('partials/') || String(view).startsWith('errors/');
      if (noLayout) return original(view, opts, cb);
      original(view, opts, (err, html) => {
        if (err) {
          if (cb) return cb(err);
          return next(err);
        }
        original('layout', { ...opts, body: html }, (err2, page) => {
          if (err2) {
            if (cb) return cb(err2);
            return next(err2);
          }
          if (cb) return cb(null, page);
          return res.send(page);
        });
      });
    };
    res.jsonOk = (data = {}, status = 200) => res.status(status).json({ ok: true, ...data });
    res.jsonErr = (error, status = 400, extra = {}) => res.status(status).json({ ok: false, error, ...extra });
    next();
  };
}

/* ------------------------- مقادیر مشترک قالب ------------------------- */
async function locals() {
  return async (req, res, next) => {
    try {
      const appName = await settings.get('app.name', 'مینی HRM');
      res.locals.appName = appName;
      res.locals.appVersion = require('../../package.json').version;
      res.locals.tagline = await settings.get('app.tagline', '');
      res.locals.companyName = (config.load().company || {}).name || appName;
      res.locals.companyLogo = (config.load().company || {}).logo || (await settings.get('app.logo', ''));
      res.locals.baseUrl = config.get('app.publicBaseUrl', '') || '';
      res.locals.user = req.user || null;
      res.locals.can = (perm) => auth.can(req.user, perm);
      res.locals.canAny = (perms) => auth.canAny(req.user, perms);
      res.locals.currentPath = req.path;
      res.locals.query = req.query || {};
      res.locals.h = helpers;
      res.locals.uikit = uikit;
      res.locals.uikitBadge = uikit.badge;
      res.locals.icon = icons.icon;
      res.locals.icons = icons;
      res.locals.j = jalali;
      res.locals.jalali = jalali;
      res.locals.registry = registry;
      res.locals.csrfToken = req.cookies.hrm_csrf;
      res.locals.flash = res.locals.flash || null;
      res.locals.primaryColor = await settings.get('app.primary_color', '#2563eb');
      res.locals.dateDisplay = await settings.get('app.date_display', 'jalali');
      res.locals.modulesEnabled = await modulesService.enabledKeys();
      res.locals.unreadNotifications = 0;
      if (req.user) {
        try {
          const row = await require('../db').get(
            `SELECT COUNT(*) AS c FROM ${require('../db').t('notifications')} WHERE user_id = ? AND read_at IS NULL`,
            [req.user.id]
          );
          res.locals.unreadNotifications = Number(row.c) || 0;
        } catch (_) {}
      }
      // نام‌گذاری عمدی navMenus تا با داده‌های صفحه (مثلاً منوی غذا) تداخل نکند
      res.locals.navMenus = req.user ? await modulesService.menusFor(req.user) : [];
      res.locals.menus = res.locals.navMenus;
      res.locals.asset = (file) => `/assets/${file}`;
      res.locals.activeMenu = (url, exact = false) => {
        const p = String(req.path || '');
        const u = String(url || '');
        if (u === '/') return p === '/';
        return exact ? p === u : (p === u || p.startsWith(u + '/'));
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/* --------------------------- بارگذاری کاربر --------------------------- */
async function loadUser() {
  return async (req, res, next) => {
    try {
      req.user = await auth.loadSession(req);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** فقط کاربر وارد‌شده */
function requireAuth() {
  return (req, res, next) => {
    if (req.user) return next();
    // اگر نشست منقضی شده، در صورت وجود پیام مناسب نمایش داده می‌شود
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/dashboard'));
  };
}

/** اجبار به تغییر گذرواژه در ورود اول */
function requirePasswordChange() {
  return (req, res, next) => {
    if (req.user && req.user.must_change_password && !req.path.startsWith('/profile/password') && !req.path.startsWith('/logout')) {
      return res.redirect('/profile/password?force=1');
    }
    next();
  };
}

/** بررسی مجوز */
function requirePerm(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (auth.canAny(req.user, perms.length ? perms : ['*'])) return next();
    if (req.xhr || (req.headers.accept || '').includes('application/json')) {
      return res.status(403).json({ ok: false, error: 'شما به این بخش دسترسی ندارید.' });
    }
    return res.status(403).render('errors/error', {
      code: 403, title: 'عدم دسترسی',
      message: 'شما مجوز لازم برای مشاهده این بخش را ندارید. در صورت نیاز با مدیر سامانه تماس بگیرید.',
    });
  };
}

/** گیت ماژول: اگر ماژول خاموش باشد ۴۰۴ */
function moduleGate(key) {
  return modulesService.requireModule(key);
}

/* --------------------------- اعتبارسنجی --------------------------- */
/**
 * اعتبارسنجی ساده و صریح: rules = { field: 'required|number|min:3|max:50|in:a,b|mobile|national_id|email|date' }
 */
function validator(rules) {
  return (req, res, next) => {
    const errors = {};
    const data = { ...(req.body || {}) };
    for (const [field, ruleStr] of Object.entries(rules || {})) {
      const ruleList = String(ruleStr).split('|').filter(Boolean);
      let value = data[field];
      value = typeof value === 'string' ? value.trim() : value;
      for (const rule of ruleList) {
        const [name, arg] = rule.split(':');
        const isEmpty = value === undefined || value === null || value === '';
        if (name === 'required') {
          if (isEmpty) { errors[field] = `«${field}» الزامی است.`; break; }
          continue;
        }
        if (isEmpty) continue;
        if (name === 'number' && !/^-?\d+([.,]\d+)?$/.test(String(helpers.toNumber(value)))) {
          errors[field] = 'مقدار باید عدد باشد.'; break;
        }
        if (name === 'min' && String(value).length < Number(arg)) { errors[field] = `حداقل ${helpers.pnum(arg)} کاراکتر لازم است.`; break; }
        if (name === 'max' && String(value).length > Number(arg)) { errors[field] = `حداکثر ${helpers.pnum(arg)} کاراکتر مجاز است.`; break; }
        if (name === 'minNum' && helpers.toNumber(value) < Number(arg)) { errors[field] = `مقدار باید حداقل ${helpers.pnum(arg)} باشد.`; break; }
        if (name === 'maxNum' && helpers.toNumber(value) > Number(arg)) { errors[field] = `مقدار باید حداکثر ${helpers.pnum(arg)} باشد.`; break; }
        if (name === 'in' && !String(arg).split(',').includes(String(value))) { errors[field] = 'مقدار انتخابی نامعتبر است.'; break; }
        if (name === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value))) { errors[field] = 'قالب ایمیل صحیح نیست.'; break; }
        if (name === 'mobile' && !/^09\d{9}$/.test(jalali.toLatinDigits(String(value)))) { errors[field] = 'شماره موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.'; break; }
        if (name === 'national_id' && !/^\d{10}$/.test(jalali.toLatinDigits(String(value)))) { errors[field] = 'کد ملی باید ۱۰ رقم باشد.'; break; }
        if (name === 'date' && isNaN(new Date(String(value)).getTime())) { errors[field] = 'تاریخ نامعتبر است.'; break; }
        if (name === 'confirmed' && String(value) !== String(data[arg] ?? '')) { errors[field] = 'تکرار مقدار مطابقت ندارد.'; break; }
      }
    }
    req.formErrors = errors;
    req.formData = data;
    req.isValid = Object.keys(errors).length === 0;
    next();
  };
}

/** در صورت خطا، همان صفحه را با پیام‌ها دوباره نشان بده (کمکی) */
function failOnErrors(view, extra = {}) {
  return (req, res, next) => {
    if (req.isValid) return next();
    return res.status(422).render(view, { ...extra, errors: req.formErrors, form: req.formData, title: extra.title || 'خطا در فرم' });
  };
}

/* ---------------------------- خطاها ---------------------------- */
function notFound() {
  return (req, res) => {
    if (req.xhr || (req.headers.accept || '').includes('application/json')) {
      return res.status(404).json({ ok: false, error: 'مسیر یافت نشد.' });
    }
    res.status(404).render('errors/error', {
      code: 404, title: 'صفحه پیدا نشد',
      message: 'آدرس مورد نظر وجود ندارد یا جابه‌جا شده است.',
    });
  };
}

function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const debug = config.get('app.debug', false);
    console.error('[error]', req.method, req.originalUrl, '→', err.message);
    if (debug) console.error(err.stack);
    try {
      require('../lib/audit').log(req, { action: 'error', module: 'core', title: err.message.slice(0, 240), meta: { url: req.originalUrl } });
    } catch (_) {}
    if (res.headersSent) return;
    if (req.xhr || (req.headers.accept || '').includes('application/json')) {
      return res.status(500).json({ ok: false, error: debug ? err.message : 'خطای غیرمنتظره در سرور' });
    }
    res.status(500).render('errors/error', {
      code: 500, title: 'خطای غیرمنتظره',
      message: debug ? err.message : 'در پردازش درخواست خطایی رخ داد. لطفاً دوباره تلاش کنید.',
      stack: debug ? err.stack : null,
    });
  };
}

module.exports = {
  cookieParser, bodyReader, csrf, flash, layoutRenderer, locals, loadUser,
  requireAuth, requirePerm, requirePasswordChange, moduleGate,
  validator, failOnErrors, notFound, errorHandler,
};
