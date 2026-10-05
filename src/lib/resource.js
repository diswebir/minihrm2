'use strict';
/**
 * موتور منابع (Resource Engine)
 * ----------------------------------------------------------------------------
 * با تعریف یک «منبع» (schema) برای هر جدول، این موتور به‌صورت خودکار این‌ها را می‌سازد:
 *   • فهرست با جست‌وجو، فیلتر، مرتب‌سازی و صفحه‌بندی
 *   • فرم ایجاد/ویرایش گروه‌بندی‌شده با انواع فیلد (متن، عدد، مبلغ، تاریخ شمسی،
 *     زمان، انتخابی، چندگزینه‌ای، فایل، مرجع وابسته به جدول دیگر)
 *   • صفحه جزئیات (پرونده) با بخش‌های مرتبط
 *   • خروجی CSV/Excel، حذف تک و گروهی، ثبت در لاگ عملیات
 *
 * با این کار همه ماژول‌ها ظاهر و رفتار یکسان و حرفه‌ای دارند و افزودن یک جدول
 * جدید بدون نوشتن مسیر و قالب اختصاصی ممکن است.
 */
const express = require('express');
const db = require('../db');
const helpers = require('./helpers');
const jalali = require('./jalali');
const audit = require('./audit');
const security = require('./security');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const icons = require('./icons');

const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'percent', 'select', 'radio', 'checkbox', 'checkbox_group',
  'date', 'time', 'datetime', 'file', 'hidden', 'static', 'password', 'tags', 'lookup', 'json_list', 'code'];

/* ------------------------------------------------------------------ */
/* کمک‌کننده‌ها                                                       */
/* ------------------------------------------------------------------ */

/** تبدیل مقدار خام فرم به مقدار قابل ذخیره بر اساس نوع فیلد */
function castValue(field, raw) {
  const type = field.type || 'text';
  let value = raw;
  if (type === 'checkbox') {
    value = ['1', 'on', 'true', 'بله', 'yes'].includes(String(raw).toLowerCase()) ? 1 : 0;
    if (raw === undefined) value = 0;              // چک‌باکس بدون مقدار ارسالی = خاموش
    return value;
  }
  if (Array.isArray(raw)) value = raw;
  if (value === undefined || value === null) value = '';
  if (typeof value === 'string') value = value.trim();

  switch (type) {
    case 'number': case 'percent': {
      if (value === '') return null;
      const n = helpers.toNumber(value, NaN);
      return Number.isFinite(n) ? n : null;
    }
    case 'money': {
      if (value === '') return null;
      return helpers.round2(helpers.toNumber(value, 0));
    }
    case 'date': case 'datetime': {
      if (!value) return null;
      if (field.jalali !== false) {
        // ورودی کاربر به شکل 1404/08/25 است → تبدیل به میلادی
        const d = jalali.parseJalaali(value);
        if (d) return type === 'datetime'
          ? db.nowSql(d)
          : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      return value;
    }
    case 'checkbox_group': case 'tags': case 'json_list': {
      const arr = Array.isArray(value) ? value : String(value).split(',');
      const clean = arr.map((v) => String(v).trim()).filter(Boolean);
      if (field.type === 'json_list') return helpers.jsonStringify(clean);
      return clean.join(',');
    }
    case 'file': {
      return value || null;
    }
    case 'lookup': case 'select': case 'radio': {
      if (value === '') return null;
      if (field.numeric) return helpers.toNumber(value, null);
      return value;
    }
    default:
      return value === '' ? (field.nullable === false ? '' : null) : value;
  }
}

/** تبدیل مقدار ذخیره‌شده به متن نمایشی (برای فهرست و جزئیات) */
function displayValue(field, value, ctx = {}) {
  if (value === null || value === undefined || value === '') return '—';
  switch (field.type) {
    case 'money':
      return helpers.formatNumber(value);
    case 'percent':
      return `${helpers.pnum(helpers.formatNumber(value))}٪`;
    case 'date':
      return field.jalali === false ? String(value).slice(0, 10) : jalali.formatJalaali(value);
    case 'datetime':
      return jalali.formatJalaaliDateTime(value);
    case 'checkbox':
      return Number(value) ? 'بله' : 'خیر';
    case 'select': case 'radio': {
      const opt = (field.options || []).find((o) => String(o.value ?? o) === String(value));
      return opt ? (opt.label ?? opt) : String(value);
    }
    case 'badge': {
      const label = field.labels ? (field.labels[value] || value) : (helpers.statusLabel(value) || value);
      return label;
    }
    case 'file':
      return value ? `<a href="/files/${encodeURIComponent(value)}" target="_blank" class="link">${helpers.escapeHtml(field.fileLabel || 'مشاهده فایل')}</a>` : '—';
    case 'json_list': case 'checkbox_group': {
      const arr = helpers.jsonParse(value, null) || String(value).split(',').filter(Boolean);
      return Array.isArray(arr) ? arr.join('، ') : String(value);
    }
    default:
      if (field.truncate) return helpers.escapeHtml(helpers.truncate(String(value), field.truncate));
      return String(value);
  }
}

/** گزینه‌های فیلد انتخابی از جدول دیگر بیاید (lookup) */
async function loadLookups(fields) {
  const map = {};
  for (const f of fields) {
    if (f.type !== 'lookup' || !f.source) continue;
    try {
      const sql = typeof f.source === 'function' ? f.source() : f.source;
      const rows = await db.query(sql);
      map[f.name] = rows.map((r) => ({ value: r.id, label: r.label ?? r.name ?? r.title ?? String(r.id) }));
    } catch (err) {
      map[f.name] = [];
    }
  }
  return map;
}

/** ساخت شرط WHERE از فیلترهای فهرست */
function buildWhere(def, query, lookups = {}) {
  const where = ['1 = 1'];
  const params = [];
  if (def.softDelete) where.push('deleted_at IS NULL');

  // جست‌وجوی متنی
  const q = String(query.q || '').trim();
  if (q && def.search && def.search.length) {
    const parts = def.search.map((col) => `${col} LIKE ?`);
    where.push('(' + parts.join(' OR ') + ')');
    def.search.forEach(() => params.push(`%${q}%`));
  }
  // فیلترها
  for (const f of def.filters || []) {
    const raw = query['f_' + f.name] ?? query[f.name];
    if (raw === undefined || raw === '' || raw === 'all') continue;
    if (f.type === 'date_range') {
      const from = query['f_' + f.name + '_from'];
      const to = query['f_' + f.name + '_to'];
      if (from) { where.push(`${f.name} >= ?`); params.push(castValue({ type: 'date' }, from)); }
      if (to) { where.push(`${f.name} <= ?`); params.push(castValue({ type: 'date' }, to)); }
    } else if (f.type === 'like') {
      where.push(`${f.name} LIKE ?`); params.push(`%${raw}%`);
    } else if (f.type === 'boolean') {
      where.push(`${f.name} = ?`); params.push(['1', 'true', 'on'].includes(String(raw)) ? 1 : 0);
    } else if (f.type === 'in') {
      const list = String(raw).split(',').map((v) => (f.numeric ? helpers.toNumber(v, 0) : v));
      where.push(`${f.name} IN (${list.map(() => '?').join(',')})`); params.push(...list);
    } else {
      where.push(`${f.name} = ?`); params.push(f.numeric ? helpers.toNumber(raw, 0) : raw);
    }
  }
  // فیلتر «فقط رکوردهای من»
  if (def.ownerField && query.mine === '1') {
    where.push(`${def.ownerField} = ?`); params.push(query.__meId || 0);
  }
  // فیلترهای سفارشی
  if (typeof def.extraWhere === 'function') {
    const extra = def.extraWhere(query, lookups) || {};
    if (extra.sql) { where.push(extra.sql); params.push(...(extra.params || [])); }
  }
  return { sql: where.join(' AND '), params };
}

function orderClause(def, query) {
  const allowed = (def.listColumns || []).filter((c) => c.sortable !== false).map((c) => c.name || c.field);
  const requested = String(query.sort || '').replace(/[^a-zA-Z0-9_.]/g, '');
  const dir = String(query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  if (requested && allowed.includes(requested)) return `${requested} ${dir}`;
  return def.orderBy || 'id DESC';
}

/** خروجی CSV با BOM برای نمایش صحیح فارسی در Excel */
function csvResponse(res, filename, columns, rows) {
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    s = s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
    if (/[",\n;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [];
  lines.push(columns.map((c) => esc(c.label)).join(','));
  for (const row of rows) lines.push(columns.map((c) => esc(c.value(row))).join(','));
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
}

/* ------------------------------------------------------------------ */
/* سازنده روتر منبع                                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {object} def تعریف منبع
 * @returns {import('express').Router}
 */
function resourceRouter(def) {
  const router = express.Router();
  const table = db.t(def.table);
  const perm = def.perm || {};
  const basePath = def.basePath || def.key;
  const viewDir = 'resource';

  const canView = () => require('../middleware').requirePerm(perm.view || 'core.view');
  const canCreate = () => require('../middleware').requirePerm(perm.create || perm.view || 'core.view');
  const canEdit = () => require('../middleware').requirePerm(perm.edit || perm.view || 'core.view');
  const canDelete = () => require('../middleware').requirePerm(perm.delete || perm.edit || perm.view || 'core.view');

  const allFields = () => def.fields || [];
  const listCols = () => def.listColumns || (def.fields || []).slice(0, 6).map((f) => ({ field: f.name, label: f.label, type: f.type }));

  /* ------------------------------ فهرست ------------------------------ */
  router.get('/', canView(), async (req, res, next) => {
    try {
      const lookups = await loadLookups(allFields().filter((f) => f.type === 'lookup'));
      const where = buildWhere(def, { ...req.query, __meId: req.user.id }, lookups);
      let total = 0;
      try {
        const row = await db.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where.sql}`, where.params);
        total = Number(row.c);
      } catch (err) { return next(err); }
      const { page, perPage, offset, perPageAllowed } = helpers.paginate(req.query, { perPage: def.perPage || 20 });
      const order = orderClause(def, req.query);
      const selectCols = def.select || '*';
      const rows = await db.query(
        `SELECT ${selectCols} FROM ${table} WHERE ${where.sql} ORDER BY ${order} LIMIT ${perPage} OFFSET ${offset}`,
        where.params
      );

      // تجمیع‌های اختیاری (مثلاً جمع مبلغ)
      let totals = null;
      if (def.sumFields && def.sumFields.length) {
        const parts = def.sumFields.map((f) => `COALESCE(SUM(${f.field || f}),0) AS ${f.alias || (f.field || f)}`);
        totals = await db.get(`SELECT ${parts.join(', ')} FROM ${table} WHERE ${where.sql}`, where.params);
      }

      let trashCount = 0;
      if (def.softDelete) {
        try { trashCount = Number((await db.get(`SELECT COUNT(*) AS c FROM ${table} WHERE deleted_at IS NOT NULL`)).c) || 0; } catch (e) { trashCount = 0; }
      }
      const meta = helpers.paginationMeta(total, page, perPage);
      const enriched = await Promise.all(rows.map(async (r) => (def.rowDecorator ? def.rowDecorator(r, req) : r)));
      return res.render(`${viewDir}/list`, {
        title: def.title,
        def, rows: enriched, meta, lookups, totals,
        perPageAllowed,
        basePath,
        canCreate: require('../services/auth').can(req.user, perm.create || perm.view),
        canDelete: require('../services/auth').can(req.user, perm.delete || perm.edit),
        canExport: def.export !== false && require('../services/auth').can(req.user, perm.export || perm.view),
        buildQuery: helpers.buildQuery,
        trashCount,
        cell: (col, row) => cellHtml(def, col, row, { lookups }),
        sort: req.query.sort, dir: req.query.dir,
      });
    } catch (err) { return next(err); }
  });

  /* ------------------------------ خروجی ------------------------------ */
  router.get('/export.csv', canView(), async (req, res, next) => {
    try {
      if (def.export === false) return res.status(403).send('خروجی برای این بخش فعال نیست.');
      if (perm.export && !require('../services/auth').can(req.user, perm.export)) {
        return res.status(403).render('errors/error', { code: 403, title: 'عدم دسترسی', message: 'مجوز خروجی گرفتن ندارید.' });
      }
      const where = buildWhere(def, req.query);
      const order = orderClause(def, req.query);
      const rows = await db.query(`SELECT ${def.select || '*'} FROM ${table} WHERE ${where.sql} ORDER BY ${order} LIMIT 20000`, where.params);
      await audit.log(req, { action: 'export', module: def.module, entity: def.key, title: `${def.title} (${rows.length} رکورد)` });
      const cols = (def.exportColumns || listCols()).map((c) => ({
        label: c.label || c.field,
        value: (row) => {
          const f = allFields().find((x) => x.name === (c.field || c.name)) || { type: c.type || 'text', options: c.options };
          const raw = row[c.field || c.name];
          return displayValue(f, raw).toString().replace(/&nbsp;/g, ' ');
        },
      }));
      return csvResponse(res, `${def.key}-${new Date().toISOString().slice(0, 10)}.csv`, cols, rows);
    } catch (err) { return next(err); }
  });

  /* ------------------------------ ایجاد ------------------------------ */
  router.get('/new', canCreate(), async (req, res, next) => {
    try {
      if (def.canCreate === false) return res.status(403).render('errors/error', { code: 403, title: 'غیرفعال', message: 'ایجاد رکورد جدید برای این بخش از این مسیر مجاز نیست.' });
      const lookups = await loadLookups(allFields());
      const initial = { ...(def.defaults || {}) };
      for (const [k, v] of Object.entries(req.query)) if (k.startsWith('set_')) initial[k.slice(4)] = v;
      if (typeof def.beforeForm === 'function') await def.beforeForm(null, req, initial);
      return res.render(`${viewDir}/form`, {
        title: `افزودن ${def.titleSingular || def.title}`,
        def, row: initial, lookups, basePath, isNew: true, errors: {},
      });
    } catch (err) { return next(err); }
  });

  router.post('/', canCreate(), async (req, res, next) => {
    try {
      const lookups = await loadLookups(allFields());
      const data = {};
      for (const f of allFields()) {
        if (f.readonly || f.type === 'static') continue;
        data[f.name] = castValue(f, req.body[f.name]);
      }
      // فیلدهای اجباری
      const errors = {};
      for (const f of allFields()) {
        if (!f.required) continue;
        const v = data[f.name];
        if (v === null || v === undefined || v === '' || (f.type === 'checkbox' && f.requiredTrue && Number(v) !== 1)) {
          errors[f.name] = `«${f.label}» الزامی است.`;
        }
      }
      if (typeof def.validate === 'function') Object.assign(errors, (await def.validate(data, req, null)) || {});
      if (Object.keys(errors).length) {
        return res.status(422).render(`${viewDir}/form`, {
          title: `افزودن ${def.titleSingular || def.title}`, def, row: { ...data }, lookups, basePath, isNew: true, errors,
        });
      }
      // مقادیر تکرارنشدنی
      for (const f of allFields()) {
        if (!f.unique) continue;
        const v = data[f.name];
        if (v === null || v === '' || v === undefined) continue;
        const dup = await db.get(`SELECT id FROM ${table} WHERE ${f.name} = ? LIMIT 1`, [v]);
        if (dup) {
          errors[f.name] = `«${f.label}» تکراری است.`;
        }
      }
      if (Object.keys(errors).length) {
        return res.status(422).render(`${viewDir}/form`, {
          title: `افزودن ${def.titleSingular || def.title}`, def, row: { ...data }, lookups, basePath, isNew: true, errors,
        });
      }
      const cols = def.columns;
      if (!cols || cols.has('created_at')) data.created_at = db.nowSql();
      if (!cols || cols.has('updated_at')) data.updated_at = db.nowSql();
      if ((!cols || cols.has('created_by')) && def.hasCreatedBy !== false) data.created_by = req.user.id;
      if (typeof def.beforeSave === 'function') {
        const saved = await def.beforeSave(data, req, { isNew: true, before: null });
        if (saved && typeof saved === 'object') Object.assign(data, saved);
      }
      const id = await db.insert(def.table, data);
      if (typeof def.afterSave === 'function') await def.afterSave(id, data, req, true);
      await audit.log(req, {
        action: 'create', module: def.module, entity: def.key, entityId: id,
        title: def.rowTitle ? def.rowTitle(data) : (data.name || data.title || `${def.titleSingular || def.title} #${id}`),
      });
      req.setFlash('success', `${def.titleSingular || def.title} با موفقیت ثبت شد.`);
      if (typeof def.redirectAfterSave === 'function') return res.redirect(def.redirectAfterSave(id, data, req));
      const target = def.redirectAfterSave === false ? `/${basePath}` : `/${basePath}/${id}`;
      return res.redirect(target);
    } catch (err) { return next(err); }
  });

  /* ----------------------------- جزئیات ----------------------------- */
  router.get('/:id(\\d+)', canView(), async (req, res, next) => {
    try {
      const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!row) return next();
      const lookups = await loadLookups(allFields().filter((f) => f.type === 'lookup'));
      const extra = typeof def.detailData === 'function' ? await def.detailData(row, req) : {};
      await audit.log(req, {
        action: 'view', module: def.module, entity: def.key, entityId: row.id,
        title: def.rowTitle ? def.rowTitle(row) : (row.name || row.title),
      });
      return res.render(`${viewDir}/detail`, {
        title: def.rowTitle ? def.rowTitle(row) : (row.name || row.title || def.title),
        def, row, lookups, basePath, extra,
        detailField: (f) => detailHtml(def, f, row, { lookups }),
        canEdit: require('../services/auth').can(req.user, perm.edit || perm.view),
        canDelete: require('../services/auth').can(req.user, perm.delete || perm.edit),
      });
    } catch (err) { return next(err); }
  });

  /* ------------------------------ ویرایش ------------------------------ */
  router.get('/:id(\\d+)/edit', canEdit(), async (req, res, next) => {
    try {
      const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!row) return next();
      const lookups = await loadLookups(allFields());
      return res.render(`${viewDir}/form`, {
        title: `ویرایش ${def.titleSingular || def.title}`, def, row, lookups, basePath, isNew: false, errors: {},
      });
    } catch (err) { return next(err); }
  });

  router.post('/:id(\\d+)', canEdit(), async (req, res, next) => {
    try {
      const before = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!before) return next();
      const lookups = await loadLookups(allFields());
      const data = {};
      for (const f of allFields()) {
        if (f.readonly || f.type === 'static') continue;
        if (f.type === 'file' && !req.body[f.name]) continue;      // فایل خالی → حفظ مقدار قبلی
        if (f.type === 'password' && !req.body[f.name]) continue;   // گذرواژه خالی → تغییر نکند
        data[f.name] = castValue(f, req.body[f.name]);
      }
      if (!Object.keys(data).length) {
        req.setFlash('info', 'تغییری برای ذخیره وجود نداشت.');
        return res.redirect(`/${basePath}/${before.id}`);
      }
      const errors = {};
      for (const f of allFields()) {
        if (!f.required) continue;
        const v = data[f.name];
        if (v === undefined) continue;
        if (v === null || v === '' || (f.type === 'checkbox' && f.requiredTrue && Number(v) !== 1)) errors[f.name] = `«${f.label}» الزامی است.`;
      }
      for (const f of allFields()) {
        if (!f.unique) continue;
        const v = data[f.name];
        if (v === null || v === '' || v === undefined) continue;
        const dup = await db.get(`SELECT id FROM ${table} WHERE ${f.name} = ? AND id <> ? LIMIT 1`, [v, before.id]);
        if (dup) errors[f.name] = `«${f.label}» تکراری است.`;
      }
      if (typeof def.validate === 'function') Object.assign(errors, (await def.validate(data, req, before)) || {});
      if (Object.keys(errors).length) {
        return res.status(422).render(`${viewDir}/form`, {
          title: `ویرایش ${def.titleSingular || def.title}`, def, row: { ...before, ...data }, lookups, basePath, isNew: false, errors,
        });
      }
      if (def.touchUpdatedAt !== false && (!def.columns || def.columns.has('updated_at'))) data.updated_at = db.nowSql();
      if (typeof def.beforeSave === 'function') {
        const saved = await def.beforeSave(data, req, { isNew: false, before });
        if (saved && typeof saved === 'object') Object.assign(data, saved);
      }
      await db.update(def.table, data, 'id = ?', [before.id]);
      if (typeof def.afterSave === 'function') await def.afterSave(before.id, data, req, false);
      await audit.logChange(req, {
        module: def.module, entity: def.key, entityId: before.id, before, after: { ...before, ...data },
        title: def.rowTitle ? def.rowTitle({ ...before, ...data }) : (before.name || before.title),
      });
      req.setFlash('success', `${def.titleSingular || def.title} با موفقیت به‌روزرسانی شد.`);
      if (typeof def.redirectAfterSave === 'function') return res.redirect(def.redirectAfterSave(before.id, { ...before, ...data }, req));
      return res.redirect(`/${basePath}/${before.id}`);
    } catch (err) { return next(err); }
  });

  /* ------------------------------- حذف ------------------------------- */
  router.post('/:id(\\d+)/delete', canDelete(), async (req, res, next) => {
    try {
      const before = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!before) return next();
      if (typeof def.beforeDelete === 'function') {
        const blocked = await def.beforeDelete(before, req);
        if (blocked) {
          req.setFlash('error', typeof blocked === 'string' ? blocked : 'حذف این رکورد امکان‌پذیر نیست.');
          return res.redirect(`/${basePath}/${before.id}`);
        }
      }
      if (def.softDelete) {
        await db.update(def.table, { deleted_at: db.nowSql() }, 'id = ?', [before.id]);
      } else {
        await db.run(`DELETE FROM ${table} WHERE id = ?`, [before.id]);
      }
      if (typeof def.afterDelete === 'function') await def.afterDelete(before, req);
      await audit.log(req, {
        action: 'delete', module: def.module, entity: def.key, entityId: before.id,
        title: def.rowTitle ? def.rowTitle(before) : (before.name || before.title),
      });
      req.setFlash('success', `${def.titleSingular || def.title} حذف شد.`);
      return res.redirect(`/${basePath}`);
    } catch (err) { return next(err); }
  });

  /* ---------------------------- سطل بازیافت --------------------------- */
  router.get('/deleted', canView(), async (req, res, next) => {
    try {
      if (!def.softDelete) {
        req.setFlash('info', 'این بخش سطل بازیافت ندارد.');
        return res.redirect(`/${basePath}`);
      }
      const rows = await db.query(
        `SELECT ${def.select || '*'} FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`
      );
      const decorated = await Promise.all(rows.map(async (r) => (def.rowDecorator ? def.rowDecorator(r, req) : r)));
      return res.render('resource/deleted', {
        title: `سطل بازیافت — ${def.title}`,
        def, rows: decorated, basePath,
        canDelete: require('../services/auth').can(req.user, perm.delete || perm.edit),
        listColumns: listCols(),
        cell: (col, row) => cellHtml(def, col, row, { lookups: {} }),
      });
    } catch (err) { return next(err); }
  });

  router.post('/:id(\\d+)/restore', canDelete(), async (req, res, next) => {
    try {
      if (!def.softDelete) return next();
      const before = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!before) return next();
      await db.update(def.table, { deleted_at: null }, 'id = ?', [before.id]);
      await audit.log(req, {
        action: 'restore', module: def.module, entity: def.key, entityId: before.id,
        title: def.rowTitle ? def.rowTitle(before) : (before.name || before.title),
      });
      req.setFlash('success', `${def.titleSingular || def.title} بازیابی شد.`);
      return res.redirect(`/${basePath}`);
    } catch (err) { return next(err); }
  });

  router.post('/restore-bulk', canDelete(), async (req, res, next) => {
    try {
      const ids = (Array.isArray(req.body.ids) ? req.body.ids : String(req.body.ids || '').split(','))
        .map((v) => helpers.toNumber(v, 0)).filter((v) => v > 0);
      if (!ids.length) {
        req.setFlash('warning', 'هیچ رکوردی انتخاب نشده بود.');
        return res.redirect(`/${basePath}/deleted`);
      }
      const placeholders = ids.map(() => '?').join(',');
      await db.run(`UPDATE ${table} SET deleted_at = NULL WHERE id IN (${placeholders})`, ids);
      await audit.log(req, { action: 'restore', module: def.module, entity: def.key, title: `بازیابی گروهی (${helpers.pnum(ids.length)} رکورد)`, meta: { ids } });
      req.setFlash('success', `${helpers.pnum(ids.length)} رکورد بازیابی شد.`);
      return res.redirect(`/${basePath}/deleted`);
    } catch (err) { return next(err); }
  });

  /* ---------------------------- حذف گروهی ---------------------------- */
  router.post('/bulk', canDelete(), (req, res, next) => {
    (async () => {
      try {
        const action = String(req.body.action || '');
        const ids = (Array.isArray(req.body.ids) ? req.body.ids : String(req.body.ids || '').split(','))
          .map((v) => helpers.toNumber(v, 0)).filter((v) => v > 0);
        if (!ids.length) {
          req.setFlash('warning', 'هیچ رکوردی انتخاب نشده بود.');
          return res.redirect(`/${basePath}`);
        }
        if (action === 'delete') {
          const placeholders = ids.map(() => '?').join(',');
          let blockedCount = 0;
          if (typeof def.beforeDelete === 'function') {
            for (const id of ids) {
              const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
              if (row && await def.beforeDelete(row, req)) blockedCount += 1;
            }
          }
          if (def.softDelete) {
            await db.run(`UPDATE ${table} SET deleted_at = ? WHERE id IN (${placeholders})`, [db.nowSql(), ...ids]);
          } else {
            await db.run(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ids);
          }
          await audit.log(req, { action: 'delete', module: def.module, entity: def.key, title: `حذف گروهی (${ids.length} رکورد)`, meta: { ids, blockedCount } });
          req.setFlash('success', `${helpers.pnum(ids.length - blockedCount)} رکورد حذف شد.` + (blockedCount ? ` ${helpers.pnum(blockedCount)} رکورد به دلیل وابستگی حذف نشد.` : ''));
          return res.redirect(`/${basePath}`);
        }
        req.setFlash('warning', 'عملیات گروهی نامعتبر است.');
        return res.redirect(`/${basePath}`);
      } catch (err) { return next(err); }
    })();
  });

  return router;
}


/** رندر یک سلول جدول بر اساس تعریف ستون و نوع فیلد */
function cellHtml(def, col, row, ctx = {}) {
  const fieldName = col.field || col.name;
  const field = (def.fields || []).find((f) => f.name === fieldName) || { type: col.type || 'text', options: col.options, labels: col.labels };
  const raw = row[fieldName];
  if (typeof col.render === 'function') return col.render(row, ctx);
  if (col.badge || field.type === 'badge' || field.statusColors) {
    const label = (field.labels && field.labels[raw]) || helpers.statusLabel(raw) || raw || '—';
    const color = (field.statusColors && field.statusColors[raw]) || helpers.statusColor(raw);
    return `<span class="badge ${color}">${helpers.escapeHtml(label)}</span>`;
  }
  if (field.type === 'money') {
    const v = helpers.toNumber(raw, null);
    if (v === null) return '<span class="muted">—</span>';
    return `<span class="money">${helpers.pnum(helpers.formatNumber(v))}</span> <small class="muted">ریال</small>`;
  }
  if (field.type === 'checkbox') {
    return Number(raw) ? '<span class="badge success">بله</span>' : '<span class="badge muted">خیر</span>';
  }
  if (field.type === 'date') return `<span class="nowrap">${jalali.formatJalaali(raw)}</span>`;
  if (field.type === 'datetime') return `<span class="nowrap">${jalali.formatJalaaliDateTime(raw)}</span>`;
  if (field.type === 'percent') return raw === null || raw === '' ? '—' : `${helpers.pnum(helpers.formatNumber(raw, 1))}٪`;
  if (field.type === 'file') return raw ? '<span class="badge info">دارد</span>' : '<span class="muted">—</span>';
  if (field.type === 'lookup' && ctx.lookups && ctx.lookups[fieldName]) {
    const opt = ctx.lookups[fieldName].find((o) => String(o.value) === String(raw));
    return helpers.escapeHtml(opt ? opt.label : (raw || '—'));
  }
  if (field.type === 'select' || field.type === 'radio') {
    const opts = field.options || [];
    const opt = opts.find((o) => String(o.value ?? o) === String(raw));
    const label = opt ? (opt.label ?? opt) : raw;
    return helpers.escapeHtml(label === null || label === undefined || label === '' ? '—' : String(label));
  }
  if (raw === null || raw === undefined || raw === '') return '<span class="muted">—</span>';
  if (col.truncate || field.truncate) {
    return `<span title="${helpers.escapeHtml(String(raw))}">${helpers.escapeHtml(helpers.truncate(String(raw), col.truncate || field.truncate))}</span>`;
  }
  return helpers.escapeHtml(String(raw));
}

/** رندر فیلد در صفحه جزئیات */
function detailHtml(def, field, row, ctx = {}) {
  const raw = row[field.name];
  if (typeof field.render === 'function') return field.render(row, ctx);
  if (field.type === 'money') {
    const v = helpers.toNumber(raw, null);
    return v === null ? '<span class="muted">—</span>' : `<span class="money">${helpers.pnum(helpers.formatNumber(v))}</span> <small class="muted">ریال</small>`;
  }
  if (field.type === 'textarea' || field.type === 'text' && String(raw || '').length > 120) {
    return raw ? `<div style="white-space:pre-wrap">${helpers.escapeHtml(String(raw))}</div>` : '<span class="muted">—</span>';
  }
  if (field.type === 'file') {
    return raw
      ? `<a class="btn btn-sm" target="_blank" href="/files/${encodeURIComponent(raw)}">${icons.icon('download', '', 15)} مشاهده فایل</a>`
      : '<span class="muted">—</span>';
  }
  if (field.type === 'password') return raw ? '<span class="badge success">تنظیم شده</span>' : '<span class="badge warning">تنظیم نشده</span>';
  if (field.type === 'checkbox') return Number(raw) ? '<span class="badge success">بله</span>' : '<span class="badge muted">خیر</span>';
  if (field.type === 'json_list' || field.type === 'checkbox_group') {
    const arr = helpers.jsonParse(raw, null) || String(raw || '').split(',').filter(Boolean);
    if (!Array.isArray(arr) || !arr.length) return '<span class="muted">—</span>';
    return arr.map((v) => `<span class="chip">${helpers.escapeHtml(String(v))}</span>`).join(' ');
  }
  return displayValue(field, raw, ctx);
}

module.exports = { resourceRouter, castValue, displayValue, loadLookups, csvResponse, FIELD_TYPES, buildWhere, cellHtml, detailHtml };
