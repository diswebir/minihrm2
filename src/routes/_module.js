'use strict';
/**
 * ابزار ساخت «داشبورد ماژول»
 * ----------------------------------------------------------------------------
 * هر ماژول یک داشبورد اختصاصی دارد: کارت‌های آماری، نمودار میله‌ای، کاشی‌های
 * میان‌بر و جدول/فهرست‌های مرتبط. برای پرهیز از تکرار، همه ماژول‌ها از همین
 * قالب استفاده می‌کنند و هر فایل فقط داده‌های خودش را تعریف می‌کند.
 *
 * نمونه:
 *   module.exports = dashboardRouter({
 *     key: 'training',
 *     kpis: async (c) => [c.kpi('دوره‌های فعال', await c.count('courses', 'status = ?', ['active']))],
 *     sections: async (c) => [c.list('آخرین ثبت‌نام‌ها', await c.rows('SELECT ...'))],
 *   });
 */
const express = require('express');
const db = require('../db');
const mw = require('../middleware');
const modules = require('../modules');
const uikit = require('../lib/uikit');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const auth = require('../services/auth');

/** اطلاعات ماژول از رجیستری */
function moduleInfo(key) {
  return modules.MODULES.find((m) => m.key === key) || { key, name: key, icon: 'grid', menus: [], description: '' };
}

/** پرس‌وجوی ایمن — خطای SQL صفحه را نمی‌شکند */
async function safeQuery(sql, params = []) {
  try { return await db.query(sql, params); } catch (_) { return []; }
}
async function safeGet(sql, params = []) {
  try { return await db.get(sql, params); } catch (_) { return null; }
}

const COLORS = ['primary', 'success', 'info', 'warning', 'purple', 'danger'];

function makeCtx() {
  return {
    db, uikit, helpers, jalali,
    t: (name) => db.t(name),
    /** شمارش رکوردهای یک جدول با شرط دلخواه */
    async count(table, where = '', params = []) {
      const r = await safeGet(`SELECT COUNT(*) AS c FROM ${db.t(table)}${where ? ` WHERE ${where}` : ''}`, params);
      return r ? Number(r.c) || 0 : 0;
    },
    /** جمع یک ستون */
    async sum(table, column, where = '', params = []) {
      const r = await safeGet(`SELECT COALESCE(SUM(${column}), 0) AS s FROM ${db.t(table)}${where ? ` WHERE ${where}` : ''}`, params);
      return r ? Number(r.s) || 0 : 0;
    },
    query: safeQuery,
    get: safeGet,
    /** کارت آماری */
    kpi: (label, value, opts = {}) => uikit.kpi(label, value, opts),
    /** جدول */
    table: (title, columns, rows, opts = {}) => uikit.table(columns, rows, { ...opts, title }),
    /** فهرست ساده */
    list: (title, rows, opts = {}) => uikit.list(title, rows, opts),
    /** ردیف فهرست */
    item: (row) => row,
    money: (v) => helpers.money(v, { suffix: false }),
    date: (v) => (v ? jalali.formatJalaali(v) : '—'),
    dateTime: (v) => (v ? jalali.formatJalaaliDateTime(v) : '—'),
    pnum: (v) => helpers.pnum(v ?? 0),
    badge: (v, color) => uikit.badge(v, color),
    now: db.nowSql(),
  };
}

/** کاشی‌های میان‌بر از منوهای ماژول (با رعایت مجوزهای کاربر) */
function tilesFromMenus(meta, opts = {}, user = null) {
  const base = `/${meta.key}`;
  const menus = (meta.menus || []).filter((m) => m.url && m.url !== base && m.url !== base + '/')
    .filter((m) => !m.perm || !user || auth.can(user, m.perm));
  return menus.map((m, i) => ({
    title: m.label,
    url: m.url,
    icon: m.icon || 'grid',
    desc: opts.descriptions ? opts.descriptions[m.url] : undefined,
    color: COLORS[i % COLORS.length],
  }));
}

/**
 * ساخت روتر داشبورد
 * opts:
 *   key        : کلید ماژول (برای گیت و منوها)
 *   title      : عنوان صفحه
 *   icon       : آیکن
 *   subtitle   : توضیح زیر عنوان
 *   perm       : مجوز اختصاصی (پیش‌فرض key.view)
 *   guards     : آرایه میدل‌ور جایگزین
 *   tiles      : false برای حذف کاشی‌ها
 *   kpis/bars/sections/alerts/actions : تابع async(ctx, req) یا مقدار ثابت
 */
function dashboardRouter(opts) {
  const router = express.Router();
  const meta = moduleInfo(opts.key);
  const guards = opts.guards || [
    mw.requireAuth(),
    mw.requirePasswordChange(),
    ...(opts.gated === false ? [] : [mw.moduleGate(opts.key), mw.requirePerm(opts.perm || `${opts.key}.view`)]),
  ];

  router.get('/', ...guards, async (req, res, next) => {
    try {
      const ctx = makeCtx();
      const resolve = async (v) => (typeof v === 'function' ? (await v(ctx, req)) || [] : v || []);
      const kpis = await resolve(opts.kpis);
      const bars = await resolve(opts.bars);
      const sections = await resolve(opts.sections);
      const alerts = await resolve(opts.alerts);
      const actions = await resolve(opts.actions);
      const tiles = opts.tiles === false ? [] : tilesFromMenus(meta, opts.tilesOptions, req.user);
      res.render('page', {
        title: opts.title || meta.name,
        page: {
          icon: opts.icon || meta.icon || 'grid',
          subtitle: opts.subtitle !== undefined ? opts.subtitle : meta.description,
          actions,
          kpis,
          alerts,
          bars,
          barsTitle: opts.barsTitle,
          sections: [...(tiles.length ? [{ type: 'tiles', items: tiles }] : []), ...sections.filter(Boolean)],
        },
      });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { dashboardRouter, moduleInfo, safeQuery, safeGet, makeCtx, tilesFromMenus };
