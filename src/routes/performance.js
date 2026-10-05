'use strict';
/**
 * ماژول ارزیابی عملکرد (Performance)
 * داشبورد عملکرد: چرخه‌های ارزیابی، میانگین امتیاز، شاخص‌های KPI و ارزیابی‌های در جریان
 */
const { dashboardRouter } = require('./_module');

module.exports = dashboardRouter({
  key: 'performance',
  title: 'داشبورد ارزیابی عملکرد',
  subtitle: 'چرخه‌های ارزیابی، امتیازها، شاخص‌های کلیدی عملکرد (KPI) و بازخورد کارکنان',
  actions: [
    { label: 'ارزیابی جدید', url: '/performance/reviews/new', icon: 'plus' },
    { label: 'شاخص جدید', url: '/performance/kpis/new', icon: 'plus' },
  ],
  kpis: async (c) => {
    const avg = await c.get(`SELECT AVG(overall_score) AS a FROM ${c.t('performance_reviews')} WHERE deleted_at IS NULL AND overall_score IS NOT NULL`);
    return [
      c.kpi('ارزیابی‌های در جریان', await c.count('performance_reviews', "status NOT IN ('completed','canceled') AND deleted_at IS NULL"), { icon: 'trending-up', color: 'warning', url: '/performance/reviews' }),
      c.kpi('ارزیابی‌های تکمیل‌شده', await c.count('performance_reviews', "status = 'completed' AND deleted_at IS NULL"), { icon: 'check-circle', color: 'success', url: '/performance/reviews' }),
      c.kpi('میانگین امتیاز', avg && avg.a !== null ? `${c.pnum(Math.round(Number(avg.a) * 100) / 100)} از ۱۰۰` : '—', { icon: 'star', color: 'primary', rawValue: true }),
      c.kpi('شاخص‌های فعال', await c.count('kpis', "status <> 'inactive' AND deleted_at IS NULL"), { icon: 'target', color: 'info', url: '/performance/kpis' }),
    ];
  },
  bars: async (c) => {
    const rows = await c.query(
      `SELECT round(overall_score) AS score, COUNT(*) AS c FROM ${c.t('performance_reviews')}
        WHERE deleted_at IS NULL AND overall_score IS NOT NULL GROUP BY round(overall_score) ORDER BY score DESC LIMIT 10`
    );
    return rows.map((r) => ({ label: `امتیاز ${c.pnum(r.score || 0)}`, value: Number(r.c), color: 'success' }));
  },
  barsTitle: 'توزیع امتیازهای ارزیابی',
  sections: async (c) => {
    const reviews = await c.query(
      `SELECT r.*, e.first_name, e.last_name, e.personnel_code,
              u.full_name AS reviewer_name
         FROM ${c.t('performance_reviews')} r
         LEFT JOIN ${c.t('employees')} e ON e.id = r.employee_id
         LEFT JOIN ${c.t('users')} u ON u.id = r.reviewer_user_id
        WHERE r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 12`
    );
    const kpis = await c.query(
      `SELECT k.*, d.name AS department_name FROM ${c.t('kpis')} k
         LEFT JOIN ${c.t('departments')} d ON d.id = k.department_id
        WHERE k.deleted_at IS NULL ORDER BY k.id DESC LIMIT 10`
    );
    const top = await c.query(
      `SELECT e.first_name, e.last_name, e.personnel_code, AVG(r.overall_score) AS avg_score, COUNT(*) AS n
         FROM ${c.t('performance_reviews')} r
         LEFT JOIN ${c.t('employees')} e ON e.id = r.employee_id
        WHERE r.deleted_at IS NULL AND r.overall_score IS NOT NULL AND r.status = 'completed'
        GROUP BY r.employee_id, e.first_name, e.last_name, e.personnel_code
        HAVING AVG(r.overall_score) IS NOT NULL
        ORDER BY avg_score DESC LIMIT 8`
    );
    return [
      c.table('آخرین ارزیابی‌ها', [
        { label: 'کارمند' }, { label: 'دوره' }, { label: 'نوع' }, { label: 'ارزیاب' }, { label: 'امتیاز', align: 'center' }, { label: 'وضعیت', align: 'center' },
      ], reviews.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.period_label || '—', r.type || '—', r.reviewer_name || '—',
          r.overall_score !== null && r.overall_score !== undefined ? c.pnum(Math.round(Number(r.overall_score) * 100) / 100) : '—',
          c.badge(r.status),
        ],
        actions: [{ icon: 'edit', title: 'مشاهده', url: `/performance/reviews/${r.id}/edit` }],
      })), { empty: 'ارزیابی‌ای ثبت نشده است.' }),
      c.table('شاخص‌های کلیدی عملکرد', [
        { label: 'عنوان' }, { label: 'واحد' }, { label: 'وزن' }, { label: 'هدف' }, { label: 'دوره' }, { label: 'وضعیت', align: 'center' },
      ], kpis.map((r) => ({
        cells: [r.title || '—', r.department_name || '—', `${c.pnum(r.weight || 0)}٪`, `${c.pnum(r.target || 0)} ${r.unit || ''}`.trim(), r.period || '—', c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/performance/kpis/${r.id}/edit` }],
      })), { empty: 'شاخصی ثبت نشده است.' }),
      c.table('برترین میانگین امتیازها', [
        { label: 'کارمند' }, { label: 'کد پرسنلی' }, { label: 'میانگین', align: 'center' }, { label: 'تعداد ارزیابی', align: 'center' },
      ], top.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—', c.pnum(r.personnel_code || '—'),
          c.pnum(Math.round(Number(r.avg_score) * 100) / 100), c.pnum(r.n || 0),
        ],
        actions: [{ icon: 'eye', title: 'پرونده', url: '/performance/reviews' }],
      })), { empty: 'ارزیابی تکمیل‌شده‌ای وجود ندارد.' }),
    ];
  },
});
