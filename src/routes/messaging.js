'use strict';
/**
 * ماژول پیامک و اطلاع‌رسانی (Messaging)
 * ----------------------------------------------------------------------------
 * داشبورد وضعیت سامانه پیامک (IPPanel)، ارسال گروهی به گروه‌های پرسنلی،
 * ارسال آزمایشی و گزارش ارسال‌ها. همه ارسال‌ها در sms_logs ثبت می‌شوند.
 */
const express = require('express');
const db = require('../db');
const mw = require('../middleware');
const sms = require('../services/sms');
const audit = require('../lib/audit');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const { dashboardRouter, makeCtx } = require('./_module');

/* ------------------------------ ارسال گروهی ------------------------------ */

const AUDIENCES = {
  all: { label: 'همه کارکنان فعال', sql: `SELECT id, first_name, last_name, COALESCE(mobile, phone) AS mobile FROM {employees} WHERE deleted_at IS NULL AND (status IS NULL OR status = 'active') AND COALESCE(mobile, phone) IS NOT NULL` },
  managers: { label: 'مدیران و سرپرستان', sql: `SELECT e.id, e.first_name, e.last_name, COALESCE(e.mobile, e.phone) AS mobile FROM {employees} e WHERE e.deleted_at IS NULL AND e.id IN (SELECT manager_user_id FROM {employees} WHERE manager_user_id IS NOT NULL)` },
  department: { label: 'یک واحد سازمانی', sql: `SELECT e.id, e.first_name, e.last_name, COALESCE(e.mobile, e.phone) AS mobile FROM {employees} e WHERE e.deleted_at IS NULL AND e.department_id = ? AND COALESCE(e.mobile, e.phone) IS NOT NULL` },
  custom: { label: 'شماره‌های دلخواه', sql: null },
};

const sendRouter = express.Router();

async function recipientsFor(mode, departmentId, custom) {
  if (mode === 'custom') {
    return String(custom || '')
      .split(/[\s,;،\n]+/)
      .map((x) => sms.toE164(x))
      .filter(Boolean);
  }
  const def = AUDIENCES[mode] || AUDIENCES.all;
  if (!def.sql) return [];
  const sql = def.sql.replace(/\{(\w+)\}/g, (_, t) => db.t(t));
  const rows = await db.query(sql, mode === 'department' ? [Number(departmentId) || 0] : []);
  return rows.map((r) => sms.toE164(r.mobile)).filter(Boolean);
}

sendRouter.get('/send', mw.requireAuth(), mw.requirePasswordChange(), mw.moduleGate('messaging'), mw.requirePerm('messaging.send'), async (req, res, next) => {
  try {
    const departments = await db.query(`SELECT id, name FROM ${db.t('departments')} WHERE deleted_at IS NULL ORDER BY name`);
    const templates = await db.query(`SELECT id, title, body FROM ${db.t('message_templates')} WHERE deleted_at IS NULL AND is_active = 1 ORDER BY title`);
    res.render('messaging/send', {
      title: 'ارسال گروهی پیامک',
      status: sms.status(),
      audiences: AUDIENCES,
      departments,
      templates,
      result: req.query.done ? { done: true, sent: Number(req.query.sent) || 0, failed: Number(req.query.failed) || 0 } : null,
    });
  } catch (err) { next(err); }
});

sendRouter.post('/send', mw.requireAuth(), mw.requirePasswordChange(), mw.moduleGate('messaging'), mw.requirePerm('messaging.send'), async (req, res, next) => {
  try {
    const body = String(req.body.message || '').trim();
    if (!body) {
      req.setFlash('danger', 'متن پیامک را وارد کنید.');
      return res.redirect('/messaging/send');
    }
    const recipients = await recipientsFor(req.body.audience, req.body.department_id, req.body.custom_mobiles);
    if (!recipients.length) {
      req.setFlash('warning', 'هیچ شماره معتبری برای ارسال پیدا نشد.');
      return res.redirect('/messaging/send');
    }
    if (req.body.test_mobile) {
      const one = sms.toE164(req.body.test_mobile);
      if (one) {
        const t = await sms.sendText([one], body);
        req.setFlash(t.ok ? 'success' : 'danger', t.ok ? 'پیامک آزمایشی ارسال شد.' : `ارسال آزمایشی ناموفق بود: ${t.error || 'خطای نامشخص'}`);
        return res.redirect('/messaging/send');
      }
    }
    if (!sms.isEnabled() || !sms.isConfigured()) {
      req.setFlash('danger', 'سامانه پیامک فعال یا تنظیم نشده است. ابتدا در تنظیمات پیامک، اطلاعات IPPanel را وارد کنید.');
      return res.redirect('/settings/sms');
    }
    let sent = 0;
    let failed = 0;
    const result = await sms.sendText(recipients, body, { sender: req.body.sender || undefined });
    if (result.ok) sent = recipients.length; else failed = recipients.length;
    const providerId = Array.isArray(result.ids) && result.ids.length ? String(result.ids[0]) : null;
    await db.insert('sms_logs', {
      mobile: recipients.length === 1 ? recipients[0] : `${recipients.length} شماره`,
      type: 'bulk', template_key: null, body,
      ref_type: 'manual', ref_id: null,
      status: result.ok ? 'sent' : 'failed',
      provider_id: providerId,
      cost: null, error: result.ok ? null : (result.error || 'خطای ارسال'),
      sent_by: req.user.id, created_at: db.nowSql(),
    });
    await audit.log(req, {
      action: 'send', module: 'messaging', entity: 'sms_logs', entityId: null,
      title: `ارسال گروهی پیامک به ${helpers.pnum(recipients.length)} شماره${result.ok ? '' : ' (ناموفق)'}`,
    });
    if (!result.ok) req.setFlash('danger', `ارسال ناموفق: ${result.error || 'خطای نامشخص'}`);
    else req.setFlash('success', `پیامک برای ${helpers.pnum(sent)} شماره ارسال شد.`);
    res.redirect(`/messaging/send?done=1&sent=${sent}&failed=${failed}`);
  } catch (err) { next(err); }
});

/* -------------------------------- داشبورد -------------------------------- */

const dashboard = dashboardRouter({
  key: 'messaging',
  title: 'داشبورد پیامک و اطلاع‌رسانی',
  subtitle: 'وضعیت سامانه پیامک، ارسال گروهی، قالب‌های پیام و گزارش ارسال‌ها',
  actions: [
    { label: 'ارسال گروهی', url: '/messaging/send', icon: 'send' },
    { label: 'تنظیمات پیامک', url: '/settings/sms', icon: 'settings' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const month = (c.now || '').slice(0, 7);
    return [
      c.kpi('ارسال امروز', await c.count('sms_logs', 'created_at LIKE ?', [today + '%']), { icon: 'send', color: 'primary', url: '/messaging/logs' }),
      c.kpi('ارسال این ماه', await c.count('sms_logs', 'created_at LIKE ?', [month + '%']), { icon: 'message', color: 'info', url: '/messaging/logs' }),
      c.kpi('ناموفق این ماه', await c.count('sms_logs', "created_at LIKE ? AND status = 'failed'", [month + '%']), { icon: 'alert', color: 'danger', url: '/messaging/logs' }),
      c.kpi('قالب‌های فعال', await c.count('message_templates', 'is_active = 1 AND deleted_at IS NULL'), { icon: 'file-text', color: 'purple', url: '/messaging/templates' }),
    ];
  },
  sections: async (c) => {
    const st = sms.status();
    const last = await c.query(
      `SELECT * FROM ${c.t('sms_logs')} ORDER BY id DESC LIMIT 12`
    );
    return [
      {
        type: 'html',
        title: 'وضعیت سامانه پیامک (IPPanel)',
        icon: 'smartphone',
        html: `<div class="grid-3">
          <div><div class="muted small">وضعیت فعال بودن</div><div class="stat-value">${st.enabled ? '<span class="badge badge-success">فعال</span>' : '<span class="badge badge-warning">غیرفعال</span>'}</div></div>
          <div><div class="muted small">اطلاعات ورود</div><div class="stat-value">${st.configured ? '<span class="badge badge-success">تنظیم‌شده</span>' : '<span class="badge badge-danger">تنظیم‌نشده</span>'}</div></div>
          <div><div class="muted small">شماره فرستنده</div><div class="stat-value" dir="ltr">${helpers.escapeHtml(st.sender || '—')}</div></div>
          <div><div class="muted small">روش احراز هویت</div><div class="stat-value">${st.mode === 'api_key' ? 'کلید API' : (st.mode === 'username_password' ? 'نام کاربری/گذرواژه' : 'ثبت‌نشده')}</div></div>
          <div><div class="muted small">کد الگوی ورود</div><div class="stat-value">${st.patternCode ? 'تعریف‌شده' : 'تعریف‌نشده'}</div></div>
        </div>
        <p class="muted small" style="margin-top:.75rem">برای تغییر تنظیمات به <a class="link" href="/settings/sms">تنظیمات پیامک</a> بروید. اطلاعات ورود در پایگاه‌داده نگهداری می‌شود و هرگز در گزارش‌ها نمایش داده نمی‌شود.</p>`,
      },
      c.table('آخرین ارسال‌ها', [
        { label: 'گیرنده' }, { label: 'نوع' }, { label: 'متن' }, { label: 'وضعیت', align: 'center' }, { label: 'زمان' },
      ], last.map((r) => ({
        cells: [
          r.mobile || '—', r.type === 'otp' ? 'کد ورود' : (r.type === 'bulk' ? 'گروهی' : (r.type || '—')),
          helpers.truncate(r.body || r.error || '—', 60),
          c.badge(r.status), c.dateTime(r.created_at),
        ],
      })), { empty: 'ارسالی ثبت نشده است.' }),
    ];
  },
});

const router = express.Router();
router.use('/', sendRouter);
router.use('/', dashboard);

module.exports = router;
