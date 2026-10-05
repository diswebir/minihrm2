'use strict';
/**
 * میزکار عملیات (Operations Desk) — مسیر /ops
 * ----------------------------------------------------------------------------
 * یک نمای یکجا از کارهای جاری واحد منابع انسانی: کارهای من، درخواست‌های پرسنلی،
 * اموال تخصیص‌یافته، ارزیابی عملکرد، اموال/قراردادهای در آستانه سررسید و اطلاعیه‌ها.
 * هر بخش فقط در صورت داشتن مجوز نمایش داده می‌شود.
 */
const { dashboardRouter } = require('./_module');
const auth = require('../services/auth');

module.exports = dashboardRouter({
  key: 'ops',
  title: 'میزکار عملیات',
  subtitle: 'یک نگاه به همه کارهای جاری: تسک‌ها، درخواست‌های پرسنلی، اموال، ارزیابی عملکرد و اطلاعیه‌ها',
  icon: 'grid',
  gated: false,
  kpis: async (c, req) => {
    const can = (p) => !req.user || auth.can(req.user, p);
    const out = [];
    if (can('requests.view') || can('core.view')) {
      out.push(c.kpi('کارهای باز من', await c.count('tasks', "assignee_user_id = ? AND status <> 'done' AND deleted_at IS NULL", [req.user.id]), { icon: 'check-square', color: 'primary', url: '/tasks' }));
      out.push(c.kpi('درخواست‌های پرسنلی باز', await c.count('hr_requests', "status = 'pending' AND deleted_at IS NULL"), { icon: 'inbox', color: 'warning', url: '/requests' }));
    }
    if (can('performance.view')) {
      out.push(c.kpi('ارزیابی‌های در جریان', await c.count('performance_reviews', "status <> 'completed' AND deleted_at IS NULL"), { icon: 'trending-up', color: 'info', url: '/performance/reviews' }));
    }
    if (can('assets.view')) {
      out.push(c.kpi('اموال تخصیص‌یافته', await c.count('asset_assignments', 'returned_at IS NULL AND deleted_at IS NULL'), { icon: 'box', color: 'success', url: '/assets/assignments' }));
      out.push(c.kpi('گارانتی/بیمه در آستانه سررسید', await c.count('assets', "status <> 'retired' AND warranty_expiry IS NOT NULL AND warranty_expiry <= ? AND deleted_at IS NULL", [plus(45)]), { icon: 'alert', color: 'danger', url: '/assets' }));
    }
    if (can('announcements.view')) {
      out.push(c.kpi('اطلاعیه‌های فعال', await c.count('announcements', "status = 'published' AND deleted_at IS NULL"), { icon: 'megaphone', color: 'purple', url: '/announcements' }));
    }
    return out;
  },
  sections: async (c, req) => {
    const can = (p) => !req.user || auth.can(req.user, p);
    const today = (c.now || '').slice(0, 10);
    const out = [];

    if (can('core.view') || can('requests.view')) {
      const myTasks = await c.query(
        `SELECT * FROM ${c.t('tasks')} WHERE deleted_at IS NULL AND status <> 'done'
          AND (assignee_user_id = ? OR creator_user_id = ?) ORDER BY due_date ASC, id DESC LIMIT 10`, [req.user.id, req.user.id]
      );
      out.push(c.table('کارهای باز من', [
        { label: 'عنوان' }, { label: 'اولویت', align: 'center' }, { label: 'سررسید' }, { label: 'وضعیت', align: 'center' },
      ], myTasks.map((r) => ({
        cells: [r.title || '—', c.badge(r.priority), c.date(r.due_date), c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/tasks/${r.id}/edit` }],
      })), { empty: 'کار بازی برای شما ثبت نشده است.' }));

      const requests = await c.query(
        `SELECT r.*, e.first_name, e.last_name FROM ${c.t('hr_requests')} r
           LEFT JOIN ${c.t('employees')} e ON e.id = r.employee_id
          WHERE r.deleted_at IS NULL AND r.status = 'pending' ORDER BY r.id DESC LIMIT 10`
      );
      out.push(c.table('درخواست‌های پرسنلی در انتظار', [
        { label: 'کارمند' }, { label: 'نوع' }, { label: 'موضوع' }, { label: 'شماره پیگیری' }, { label: 'وضعیت', align: 'center' },
      ], requests.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.type || '—', r.subject || '—', r.ref_no || '—', c.badge(r.status),
        ],
        actions: [{ icon: 'edit', title: 'بررسی', url: `/requests/${r.id}/edit` }],
      })), { empty: 'درخواست بازی وجود ندارد.' }));
    }

    if (can('assets.view')) {
      const warranties = await c.query(
        `SELECT * FROM ${c.t('assets')} WHERE deleted_at IS NULL AND status <> 'retired'
          AND warranty_expiry IS NOT NULL AND warranty_expiry <= ? ORDER BY warranty_expiry ASC LIMIT 10`, [plus(60)]
      );
      out.push(c.table('هشدار گارانتی/سررسید اموال', [
        { label: 'کد' }, { label: 'عنوان' }, { label: 'سررسید' }, { label: 'وضعیت', align: 'center' },
      ], warranties.map((r) => ({
        cells: [r.code || '—', r.title || '—', c.date(r.warranty_expiry), c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/assets/${r.id}/edit` }],
      })), { empty: 'موردی نزدیک به سررسید نیست.' }));
    }

    if (can('legal.view') || can('legal.contracts.manage')) {
      const contracts = await c.query(
        `SELECT * FROM ${c.t('legal_contracts')} WHERE deleted_at IS NULL AND end_date IS NOT NULL AND end_date <= ?
          ORDER BY end_date ASC LIMIT 10`, [plus(60)]
      );
      out.push(c.table('قراردادهای در آستانه پایان', [
        { label: 'عنوان' }, { label: 'طرف قرارداد' }, { label: 'پایان' }, { label: 'وضعیت', align: 'center' },
      ], contracts.map((r) => ({
        cells: [r.title || '—', r.party_name || '—', c.date(r.end_date), c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/legal/contracts/${r.id}/edit` }],
      })), { empty: 'قراردادی نزدیک به پایان نیست.' }));
    }

    if (can('announcements.view')) {
      const news = await c.query(
        `SELECT * FROM ${c.t('announcements')} WHERE deleted_at IS NULL AND status = 'published'
          ORDER BY is_pinned DESC, publish_at DESC LIMIT 8`
      );
      out.push({ type: 'list', title: 'آخرین اطلاعیه‌ها', icon: 'megaphone', url: '/announcements', rows: news.map((r) => ({
        title: r.title || '—',
        sub: String(r.body || '').slice(0, 120),
        meta: c.date(r.publish_at || r.created_at),
        url: `/announcements/${r.id}/edit`,
      })) });
    }

    if (!out.length) {
      out.push({ type: 'html', title: 'دسترسی‌ها', icon: 'lock', html: `<p class="muted">برای مشاهده بخش‌های میزکار، به ماژول‌های مربوطه دسترسی داشته باشید (امروز: ${c.date(today)}).</p>` });
    }
    return out;
  },
});

/** تاریخ امروز + n روز */
function plus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
