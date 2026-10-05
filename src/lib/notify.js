'use strict';
/**
 * اطلاع‌رسانی درون‌سامانه‌ای
 * ----------------------------------------------------------------------------
 * پیام‌ها در جدول notifications ذخیره و در زنگ بالای صفحه نمایش داده می‌شوند.
 */
const db = require('../db');

/** ارسال یک پیام به کاربر مشخص */
async function notifyUser(userId, title, body, link, level) {
  if (!userId) return;
  title = title == null ? '' : String(title);
  body = body == null ? '' : String(body);
  if (!title.trim()) return;
  await db.run(
    `INSERT INTO ${db.t('notifications')} (user_id, title, body, level, link, created_at) VALUES (?,?,?,?,?,?)`,
    [userId, title, body || '', level || 'info', link || null, db.nowSql()]
  ).catch(() => {});
}

/** ارسال پیام به همه کاربران منابع انسانی/مدیریت */
async function notifyHr(title, body, link) {
  const list = await db.query(
    `SELECT id FROM ${db.t('users')} WHERE deleted_at IS NULL AND status='active'
      AND role_id IN (SELECT id FROM ${db.t('roles')} WHERE scope = 'hr' OR scope = 'admin')`
  ).catch(() => []);
  for (const u of list) await notifyUser(u.id, title, body, link, 'info');
}

/** ارسال پیام به مسئولان یک مجوز مشخص (مثلاً payroll.manage) */
async function notifyPerm(perm, title, body, link) {
  const list = await db.query(
    `SELECT DISTINCT u.id FROM ${db.t('users')} u
       LEFT JOIN ${db.t('role_permissions')} rp ON rp.role_id = u.role_id
       LEFT JOIN ${db.t('permissions')} p ON p.id = rp.permission_id
       LEFT JOIN ${db.t('user_permissions')} up ON up.user_id = u.id
      WHERE u.deleted_at IS NULL AND u.status = 'active'
        AND (u.is_superadmin = 1 OR p.pkey = ? OR (up.pkey = ? AND COALESCE(up.allow,1) = 1))`,
    [perm, perm]
  ).catch(() => []);
  for (const u of list) await notifyUser(u.id, title, body, link, 'info');
}

module.exports = { notifyUser, notifyHr, notifyPerm };
