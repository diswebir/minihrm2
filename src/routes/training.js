'use strict';
/**
 * ماژول آموزش و توسعه (Training)
 * داشبورد دوره‌ها، ثبت‌نام‌ها، درخواست‌های آموزش و گواهی‌نامه‌ها
 */
const { dashboardRouter } = require('./_module');

const STATUS_LABELS = {
  pending: 'در انتظار بررسی', approved: 'تأییدشده', rejected: 'ردشده',
  in_progress: 'در حال یادگیری', completed: 'تکمیل‌شده', cancelled: 'لغوشده',
  assigned: 'تخصیص‌داده‌شده', active: 'فعال', draft: 'پیش‌نویس',
};

module.exports = dashboardRouter({
  key: 'training',
  title: 'داشبورد آموزش و توسعه',
  subtitle: 'مدیریت دوره‌های آموزشی داخلی و آنلاین، تخصیص به کارکنان، پیگیری یادگیری و صدور گواهی‌نامه',
  actions: [
    { label: 'دوره جدید', url: '/training/courses/new', icon: 'plus' },
    { label: 'ثبت‌نام‌ها', url: '/training/enrollments', icon: 'list' },
  ],
  kpis: async (c) => [
    c.kpi('دوره‌های فعال', await c.count('courses', "status = 'active'"), { icon: 'book', color: 'primary', url: '/training/courses' }),
    c.kpi('در حال یادگیری', await c.count('enrollments', "status IN ('assigned','in_progress')"), { icon: 'clock', color: 'info', url: '/training/enrollments' }),
    c.kpi('گواهی‌نامه‌ها', await c.count('certificates'), { icon: 'award', color: 'success', url: '/training/certificates' }),
    c.kpi('درخواست‌های در انتظار', await c.count('training_requests', "status = 'pending'"), { icon: 'inbox', color: 'warning', url: '/training/requests' }),
  ],
  bars: async (c) => {
    const rows = await c.query(
      `SELECT status, COUNT(*) AS c FROM ${c.t('enrollments')} WHERE deleted_at IS NULL GROUP BY status ORDER BY c DESC`
    );
    return rows.map((r) => ({ label: STATUS_LABELS[r.status] || r.status || '—', value: Number(r.c), color: 'info' }));
  },
  barsTitle: 'وضعیت ثبت‌نام‌های آموزشی',
  sections: async (c) => {
    const reqs = await c.query(
      `SELECT r.*, e.first_name, e.last_name FROM ${c.t('training_requests')} r
         LEFT JOIN ${c.t('employees')} e ON e.id = r.employee_id
        WHERE r.status = 'pending' AND r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 10`
    );
    const active = await c.query(
      `SELECT co.id, co.title, co.type, co.duration_hours, co.capacity, co.enrolled_count
         FROM ${c.t('courses')} co WHERE co.status = 'active' AND co.deleted_at IS NULL
        ORDER BY co.id DESC LIMIT 10`
    );
    const latest = await c.query(
      `SELECT en.*, e.first_name, e.last_name, co.title AS course_title FROM ${c.t('enrollments')} en
         LEFT JOIN ${c.t('employees')} e ON e.id = en.employee_id
         LEFT JOIN ${c.t('courses')} co ON co.id = en.course_id
        WHERE en.deleted_at IS NULL ORDER BY en.id DESC LIMIT 10`
    );
    return [
      { type: 'list', title: 'درخواست‌های آموزش در انتظار تأیید', icon: 'inbox', url: '/training/requests', rows: reqs.map((r) => ({
        title: r.course_title || '—',
        sub: `${r.first_name || ''} ${r.last_name || ''} — ${r.provider || 'بدون ارائه‌دهنده'}`,
        meta: c.money(r.cost),
        badge: c.badge(r.status),
        url: '/training/requests',
      })) },
      c.table('دوره‌های در حال برگزاری', [
        { label: 'عنوان' }, { label: 'نوع', align: 'center' }, { label: 'مدت (ساعت)', align: 'center' },
        { label: 'ظرفیت', align: 'center' }, { label: 'ثبت‌نام‌شده', align: 'center' },
      ], active.map((r) => ({
        cells: [r.title || '—', r.type === 'online' ? 'آنلاین' : (r.type === 'internal' ? 'داخلی' : 'حضوری'),
          c.pnum(r.duration_hours || 0), c.pnum(r.capacity || 0), c.pnum(r.enrolled_count || 0)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/training/courses/${r.id}/edit` }],
      })), { empty: 'دوره فعالی وجود ندارد.' }),
      c.table('آخرین ثبت‌نام‌ها', [
        { label: 'کارمند' }, { label: 'دوره' }, { label: 'وضعیت', align: 'center' }, { label: 'پیشرفت', align: 'center' },
      ], latest.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.course_title || '—',
          c.badge(r.status),
          `${c.pnum(Math.round(Number(r.progress) || 0))}٪`,
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/training/enrollments/${r.id}/edit` }],
      })), { empty: 'ثبت‌نامی انجام نشده است.' }),
    ];
  },
});
