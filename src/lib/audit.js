'use strict';
/**
 * ثبت لاگ عملیات (Audit Trail) — همه تغییرات حساس سامانه
 */
const db = require('../db');
const helpers = require('./helpers');

const ACTION_LABELS = {
  create: 'ایجاد', update: 'ویرایش', delete: 'حذف', restore: 'بازیابی', login: 'ورود',
  logout: 'خروج', login_failed: 'ورود ناموفق', approve: 'تأیید', reject: 'رد',
  export: 'خروجی', print: 'چاپ', enable: 'فعال‌سازی', disable: 'غیرفعال‌سازی',
  issue: 'صدور', pay: 'پرداخت', calculate: 'محاسبه', assign: 'تخصیص', upload: 'بارگذاری',
  send: 'ارسال', reset: 'بازنشانی', import: 'ورود اطلاعات', view_sensitive: 'مشاهده اطلاعات حساس',
  lock: 'قفل', unlock: 'بازکردن قفل', renew: 'تمدید',
};

function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}

/**
 * ثبت رکورد لاگ — هرگز باعث خطای مسیر اصلی نشود
 * @param {object} ctx  درخواست Express (اختیاری)
 */
async function log(ctx, { action, module, entity, entityId, title, meta, userId, userName } = {}) {
  try {
    let uid = userId;
    let uname = userName;
    let ip = null;
    if (ctx) {
      uid = uid !== undefined ? uid : (ctx.user ? ctx.user.id : null);
      uname = uname || (ctx.user ? ctx.user.full_name : null);
      ip = ctx.ip || (ctx.headers && (ctx.headers['x-forwarded-for'] || ''));
    }
    await db.run(
      `INSERT INTO ${db.t('audit_logs')} (user_id, user_name, action, module, entity, entity_id, title, meta, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [uid || null, uname || null, action || '', module || '', entity || '', entityId || null,
        title ? String(title).slice(0, 255) : null, meta ? helpers.jsonStringify(meta) : null, ip || null, db.nowSql()]
    );
  } catch (err) {
    if (process.env.DEBUG_AUDIT) console.error('[audit]', err.message);
  }
}

/** ثبت تغییرات یک رکورد با تفاوت مقادیر قبل/بعد */
async function logChange(ctx, { module, entity, entityId, before, after, title }) {
  const changes = helpers.diffObjects(before, after);
  if (!Object.keys(changes).length) return;
  await log(ctx, {
    action: before ? 'update' : 'create',
    module, entity, entityId,
    title: title || (after && (after.name || after.title || after.full_name)) || `#${entityId}`,
    meta: { changes },
  });
}

async function recent(limit = 50, filters = {}) {
  const where = [];
  const params = [];
  if (filters.module) { where.push('module = ?'); params.push(filters.module); }
  if (filters.user_id) { where.push('user_id = ?'); params.push(filters.user_id); }
  if (filters.action) { where.push('action = ?'); params.push(filters.action); }
  if (filters.entity) { where.push('entity = ?'); params.push(filters.entity); }
  const sql = `SELECT * FROM ${db.t('audit_logs')} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Number(limit) || 50}`;
  return db.query(sql, params);
}

module.exports = { log, logChange, recent, ACTION_LABELS, actionLabel };
