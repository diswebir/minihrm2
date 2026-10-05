'use strict';
/**
 * ماژول حضور، مرخصی و اضافه‌کاری (Attendance)
 * داشبورد تصویر روز سازمان: حضور امروز، مرخصی‌های در انتظار، مأموریت‌ها و اضافه‌کاری
 */
const { dashboardRouter, safeGet } = require('./_module');

const LEAVE_LABELS = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده', canceled: 'لغوشده' };

module.exports = dashboardRouter({
  key: 'attendance',
  title: 'داشبورد حضور و غیاب',
  subtitle: 'تصویر روز سازمان: حضور، تأخیر، مرخصی‌ها، اضافه‌کاری و مأموریت‌ها',
  actions: [
    { label: 'ثبت تردد', url: '/attendance/records/new', icon: 'plus' },
    { label: 'مرخصی‌ها', url: '/attendance/leaves', icon: 'calendar' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const month = (c.now || '').slice(0, 7);
    return [
      c.kpi('حاضر امروز', await c.count('attendance_records', 'work_date = ? AND check_in IS NOT NULL', [today]), { icon: 'check-circle', color: 'success', url: '/attendance/records' }),
      c.kpi('تأخیر امروز', await c.count('attendance_records', 'work_date = ? AND late_minutes > 0', [today]), { icon: 'clock', color: 'warning', url: '/attendance/records' }),
      c.kpi('مرخصی در انتظار', await c.count('leave_requests', "status = 'pending' AND deleted_at IS NULL"), { icon: 'calendar', color: 'info', url: '/attendance/leaves' }),
      c.kpi('اضافه‌کاری این ماه', await c.sum('overtime_records', 'hours', 'work_date LIKE ?', [month + '%']), { icon: 'trending-up', color: 'purple', url: '/attendance/overtime' }),
    ];
  },
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const leaveTypes = await c.query(
      `SELECT lr.status, COUNT(*) AS c FROM ${c.t('leave_requests')} lr
        WHERE lr.deleted_at IS NULL GROUP BY lr.status ORDER BY c DESC`
    );
    const pending = await c.query(
      `SELECT lr.*, e.first_name, e.last_name, lt.name AS type_title FROM ${c.t('leave_requests')} lr
         LEFT JOIN ${c.t('employees')} e ON e.id = lr.employee_id
         LEFT JOIN ${c.t('leave_types')} lt ON lt.id = lr.leave_type_id
        WHERE lr.status = 'pending' AND lr.deleted_at IS NULL ORDER BY lr.id DESC LIMIT 10`
    );
    const missions = await c.query(
      `SELECT m.*, e.first_name, e.last_name FROM ${c.t('missions')} m
         LEFT JOIN ${c.t('employees')} e ON e.id = m.employee_id
        WHERE m.to_date >= ? AND m.deleted_at IS NULL ORDER BY m.from_date ASC LIMIT 10`, [today]
    );
    const absent = await safeGet(
      `SELECT COUNT(*) AS c FROM ${c.t('employees')} e
        WHERE e.deleted_at IS NULL AND (e.status IS NULL OR e.status = 'active')
          AND e.id NOT IN (SELECT employee_id FROM ${c.t('attendance_records')} WHERE work_date = ? AND check_in IS NOT NULL)`, [today]
    );
    return [
      c.table('مانده وضعیت مرخصی‌ها', [{ label: 'وضعیت' }, { label: 'تعداد', align: 'center' }],
        leaveTypes.map((r) => ({ cells: [LEAVE_LABELS[r.status] || r.status || '—', c.pnum(r.c)] })), { compact: true }),
      c.table('در انتظار تأیید مرخصی', [
        { label: 'کارمند' }, { label: 'نوع' }, { label: 'از تاریخ' }, { label: 'تا تاریخ' }, { label: 'روز', align: 'center' },
      ], pending.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.type_title || '—', c.date(r.from_date), c.date(r.to_date), c.pnum(r.days || 0),
        ],
        actions: [{ icon: 'edit', title: 'بررسی و تأیید', url: `/attendance/leaves/${r.id}/edit` }],
      })), { empty: 'مرخصی در انتظاری وجود ندارد.' }),
      c.table('مأموریت‌های پیش‌رو', [
        { label: 'کارمند' }, { label: 'عنوان' }, { label: 'مقصد' }, { label: 'از' }, { label: 'تا' },
      ], missions.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.title || '—', r.destination || '—', c.date(r.from_date), c.date(r.to_date),
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/attendance/missions/${r.id}/edit` }],
      })), { empty: 'مأموریتی ثبت نشده است.' }),
      { type: 'html', title: 'غیبت‌های امروز', icon: 'alert', html: `<p class="muted">کارکنان بدون ثبت ورود در تاریخ ${c.date(today)}: <b class="danger-text">${c.pnum(absent ? absent.c : 0)}</b> نفر</p>` },
    ];
  },
});
