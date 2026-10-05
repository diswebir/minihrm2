'use strict';
/**
 * ماژول نگهبانی و امنیت (Security)
 * داشبورد نگهبانی: پست‌ها، شیفت‌های امروز، گشت‌ها، وقایع، دفتر مهمانان و مجوز خروج کالا
 */
const { dashboardRouter } = require('./_module');

const SEVERITY = { low: 'کم', medium: 'متوسط', high: 'زیاد', critical: 'بحرانی' };

module.exports = dashboardRouter({
  key: 'security',
  title: 'داشبورد نگهبانی و امنیت',
  subtitle: 'پست‌های نگهبانی، برنامه شیفت، گشت‌ها، وقایع امنیتی، دفتر ورود مهمان و مجوزهای خروج کالا',
  actions: [
    { label: 'ثبت مهمان', url: '/security/visitors/new', icon: 'plus' },
    { label: 'مجوز خروج کالا', url: '/security/gate-passes/new', icon: 'plus' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    return [
      c.kpi('پست‌های فعال', await c.count('security_posts', "status = 'active' AND deleted_at IS NULL"), { icon: 'shield', color: 'primary', url: '/security/posts' }),
      c.kpi('شیفت‌های امروز', await c.count('security_shifts', "status = 'active' AND (from_date IS NULL OR from_date <= ?) AND (to_date IS NULL OR to_date >= ?)", [today, today]), { icon: 'clock', color: 'info', url: '/security/shifts' }),
      c.kpi('وقایع باز', await c.count('security_incidents', "status <> 'closed' AND deleted_at IS NULL"), { icon: 'alert', color: 'danger', url: '/security/incidents' }),
      c.kpi('مهمانان امروز', await c.count('visitors_log', 'created_at LIKE ?', [today + '%']), { icon: 'users', color: 'success', url: '/security/visitors' }),
      c.kpi('مجوزهای خروج باز', await c.count('gate_passes', "status <> 'returned' AND deleted_at IS NULL"), { icon: 'package', color: 'warning', url: '/security/gate-passes' }),
    ];
  },
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const shifts = await c.query(
      `SELECT s.*, p.title AS post_title FROM ${c.t('security_shifts')} s
         LEFT JOIN ${c.t('security_posts')} p ON p.id = s.post_id
        WHERE s.deleted_at IS NULL AND (s.from_date IS NULL OR s.from_date <= ?) AND (s.to_date IS NULL OR s.to_date >= ?)
        ORDER BY p.title ASC, s.start_time ASC LIMIT 12`, [today, today]
    );
    const incidents = await c.query(
      `SELECT * FROM ${c.t('security_incidents')} WHERE deleted_at IS NULL AND status <> 'closed'
        ORDER BY happened_at DESC LIMIT 10`
    );
    const visitors = await c.query(
      `SELECT v.*, e.first_name, e.last_name FROM ${c.t('visitors_log')} v
         LEFT JOIN ${c.t('employees')} e ON e.id = v.host_employee_id
        WHERE v.created_at LIKE ? ORDER BY v.id DESC LIMIT 10`, [today + '%']
    );
    const gatePasses = await c.query(
      `SELECT g.*, e.first_name, e.last_name FROM ${c.t('gate_passes')} g
         LEFT JOIN ${c.t('employees')} e ON e.id = g.employee_id
        WHERE g.deleted_at IS NULL AND g.status <> 'returned' ORDER BY g.id DESC LIMIT 10`
    );
    return [
      c.table('شیفت‌های امروز', [
        { label: 'پست' }, { label: 'شیفت' }, { label: 'نگهبان' }, { label: 'ساعت' }, { label: 'وضعیت', align: 'center' },
      ], shifts.map((r) => ({
        cells: [
          r.post_title || '—', r.shift_name || '—', r.guard_name || '—',
          `${String(r.start_time || '').slice(0, 5)} - ${String(r.end_time || '').slice(0, 5)}`, c.badge(r.status),
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/security/shifts/${r.id}/edit` }],
      })), { empty: 'شیفتی برای امروز ثبت نشده است.' }),
      c.table('وقایع امنیتی باز', [
        { label: 'عنوان' }, { label: 'نوع' }, { label: 'شدت', align: 'center' }, { label: 'زمان' }, { label: 'وضعیت', align: 'center' },
      ], incidents.map((r) => ({
        cells: [r.title || '—', r.type || '—', SEVERITY[r.severity] || r.severity || '—', c.dateTime(r.happened_at), c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'بررسی', url: `/security/incidents/${r.id}/edit` }],
      })), { empty: 'واقعه باز وجود ندارد.' }),
      c.table('مهمانان امروز', [
        { label: 'مهمان' }, { label: 'شرکت' }, { label: 'میزبان' }, { label: 'ورود' }, { label: 'خروج' }, { label: 'کارت', align: 'center' },
      ], visitors.map((r) => ({
        cells: [
          r.visitor_name || '—', r.company || '—',
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.entry_at ? String(r.entry_at).slice(11, 16) : '—', r.exit_at ? String(r.exit_at).slice(11, 16) : 'در محل', r.badge_no || '—',
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/security/visitors/${r.id}/edit` }],
      })), { empty: 'مهمانی امروز ثبت نشده است.' }),
      { type: 'list', title: 'مجوزهای خروج کالا (باز)', icon: 'package', url: '/security/gate-passes', rows: gatePasses.map((r) => ({
        title: `${r.number || '#' + r.id} — ${r.items || 'کالا'}`,
        sub: `${r.carrier_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—'} — مقصد: ${r.destination || '—'}`,
        meta: r.exit_at ? c.dateTime(r.exit_at) : '',
        badge: c.badge(r.status),
        url: `/security/gate-passes/${r.id}/edit`,
      })) },
    ];
  },
});
