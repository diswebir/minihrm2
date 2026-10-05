'use strict';
/**
 * ماژول مجوزها و پروانه‌ها (Licensing)
 * داشبورد مجوزها: پروانه‌های معتبر، در آستانه انقضا، تمدیدها + نگاه یکجا به
 * امور دانش‌بنیان و مالکیت فکری شرکت
 */
const { dashboardRouter } = require('./_module');

module.exports = dashboardRouter({
  key: 'licensing',
  title: 'داشبورد مجوزها و پروانه‌ها',
  subtitle: 'پایش پروانه‌های صنفی و بهره‌برداری، یادآور تمدید، امور دانش‌بنیان و مالکیت فکری',
  actions: [
    { label: 'مجوز جدید', url: '/licensing/list/new', icon: 'plus' },
    { label: 'ثبت تمدید', url: '/licensing/renewals/new', icon: 'refresh' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const soon = plus(60);
    return [
      c.kpi('مجوزهای معتبر', await c.count('licenses', 'deleted_at IS NULL AND (expiry_date IS NULL OR expiry_date > ?)', [today]), { icon: 'certificate', color: 'success', url: '/licensing/list' }),
      c.kpi('در آستانه انقضا (۶۰ روز)', await c.count('licenses', 'deleted_at IS NULL AND expiry_date IS NOT NULL AND expiry_date > ? AND expiry_date <= ?', [today, soon]), { icon: 'alert', color: 'warning', url: '/licensing/list' }),
      c.kpi('منقضی‌شده', await c.count('licenses', 'deleted_at IS NULL AND expiry_date IS NOT NULL AND expiry_date <= ?', [today]), { icon: 'x-circle', color: 'danger', url: '/licensing/list' }),
      c.kpi('دانش‌بنیان فعال', await c.count('knowledge_based', "status = 'active' AND deleted_at IS NULL"), { icon: 'atom', color: 'info', url: '/knowledge-based' }),
      c.kpi('مالکیت فکری', await c.count('ip_assets', 'deleted_at IS NULL'), { icon: 'bulb', color: 'purple', url: '/ip' }),
    ];
  },
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const critical = await c.query(
      `SELECT * FROM ${c.t('licenses')} WHERE deleted_at IS NULL AND expiry_date IS NOT NULL AND expiry_date <= ?
        ORDER BY expiry_date ASC LIMIT 10`, [plus(90)]
    );
    const renewals = await c.query(
      `SELECT r.*, l.title AS license_title FROM ${c.t('license_renewals')} r
         LEFT JOIN ${c.t('licenses')} l ON l.id = r.license_id
        WHERE r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 10`
    );
    const kb = await c.query(
      `SELECT * FROM ${c.t('knowledge_based')} WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 8`
    );
    const ip = await c.query(
      `SELECT * FROM ${c.t('ip_assets')} WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 8`
    );
    return [
      c.table('مجوزهای نیازمند اقدام', [
        { label: 'عنوان' }, { label: 'شماره' }, { label: 'مرجع' }, { label: 'تاریخ انقضا' }, { label: 'مسئول' },
      ], critical.map((r) => ({
        cells: [r.title || '—', r.number || '—', r.authority || '—', c.date(r.expiry_date), r.responsible_name || '—'],
        actions: [
          { icon: 'refresh', title: 'تمدید', url: `/licensing/renewals/new` },
          { icon: 'edit', title: 'ویرایش', url: `/licensing/list/${r.id}/edit` },
        ],
      })), { empty: 'مجوزی نزدیک به انقضا نیست.' }),
      { type: 'list', title: 'آخرین تمدیدها', icon: 'refresh', url: '/licensing/renewals', rows: renewals.map((r) => ({
        title: r.license_title || '—',
        sub: `تاریخ تمدید: ${c.date(r.renewed_at)} — انقضای جدید: ${c.date(r.new_expiry)}`,
        meta: c.money(r.cost),
        url: '/licensing/renewals',
      })) },
      c.table('پرونده‌های دانش‌بنیان', [
        { label: 'عنوان' }, { label: 'سطح' }, { label: 'مرجع' }, { label: 'تاریخ ارزیابی' }, { label: 'انقضا' }, { label: 'وضعیت', align: 'center' },
      ], kb.map((r) => ({
        cells: [r.title || '—', r.level || '—', r.authority || '—', c.date(r.evaluation_date), c.date(r.expiry_date), c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/knowledge-based/${r.id}/edit` }],
      })), { empty: 'پرونده‌ای ثبت نشده است.' }),
      c.table('دارایی‌های فکری', [
        { label: 'عنوان' }, { label: 'نوع' }, { label: 'شماره ثبت' }, { label: 'تاریخ ثبت' }, { label: 'انقضا' }, { label: 'وضعیت', align: 'center' },
      ], ip.map((r) => ({
        cells: [r.title || '—', r.type || '—', r.registry_no || '—', c.date(r.filing_date || r.grant_date), c.date(r.expiry_date), c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/ip/${r.id}/edit` }],
      })), { empty: 'دارایی فکری ثبت نشده است.' }),
    ];
  },
});

/** تاریخ امروز + n روز */
function plus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
