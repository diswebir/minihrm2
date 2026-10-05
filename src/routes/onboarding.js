'use strict';
/**
 * ماژول بدو ورود (Onboarding)
 * داشبورد چک‌لیست‌های ورود کارکنان جدید، پیشرفت و اقلام تحویلی
 */
const { dashboardRouter } = require('./_module');

module.exports = dashboardRouter({
  key: 'onboarding',
  title: 'داشبورد بدو ورود',
  subtitle: 'مدیریت چک‌لیست‌های ورود کارکنان جدید، تحویل تجهیزات و پیگیری مراحل',
  actions: [
    { label: 'قالب‌های چک‌لیست', url: '/onboarding/templates', icon: 'list' },
    { label: 'تحویل تجهیزات', url: '/onboarding/kits', icon: 'box' },
  ],
  kpis: async (c) => [
    c.kpi('در حال انجام', await c.count('employee_onboarding', "status IN ('in_progress','pending')"), { icon: 'clock', color: 'warning', url: '/onboarding' }),
    c.kpi('تکمیل‌شده', await c.count('employee_onboarding', "status = 'completed'"), { icon: 'check-circle', color: 'success' }),
    c.kpi('قالب‌های فعال', await c.count('onboarding_templates', 'is_active = ?', [1]), { icon: 'list', color: 'info', url: '/onboarding/templates' }),
    c.kpi('اقلام تحویل‌نشده', await c.count('employee_kits', 'delivered = ?', [0]), { icon: 'box', color: 'danger', url: '/onboarding/kits' }),
  ],
  sections: async (c) => {
    const rows = await c.query(
      `SELECT o.*, e.first_name, e.last_name, e.personnel_code, t.name AS template_name
         FROM ${c.t('employee_onboarding')} o
         LEFT JOIN ${c.t('employees')} e ON e.id = o.employee_id
         LEFT JOIN ${c.t('onboarding_templates')} t ON t.id = o.template_id
        WHERE o.deleted_at IS NULL
        ORDER BY o.id DESC LIMIT 12`
    );
    const items = rows.map((r) => ({
      id: r.id,
      title: `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
      sub: `${r.template_name || 'بدون قالب'} — کد پرسنلی ${c.pnum(r.personnel_code || '—')}`,
      meta: `${c.pnum(Math.round(Number(r.progress) || 0))}٪`,
      badge: c.badge(r.status),
      url: `/employees/${r.employee_id}`,
    }));
    const kitRows = await c.query(
      `SELECT k.*, e.first_name, e.last_name
         FROM ${c.t('employee_kits')} k
         LEFT JOIN ${c.t('employees')} e ON e.id = k.employee_id
        WHERE k.delivered = 0
        ORDER BY k.id DESC LIMIT 10`
    );
    return [
      { type: 'list', title: 'آخرین فرایندهای بدو ورود', icon: 'flag', url: '/onboarding', rows: items },
      c.table('اقلام تحویل‌نشده', [
        { label: 'کارمند' }, { label: 'قلم' }, { label: 'تعداد', align: 'center' },
      ], kitRows.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.title || '—',
          c.pnum(r.quantity || 1),
        ],
        actions: [{ icon: 'eye', title: 'پروفایل', url: `/employees/${r.employee_id}` }],
      })), { empty: 'همه اقلام تحویل داده شده است.' }),
    ];
  },
});
