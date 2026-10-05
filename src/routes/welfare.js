'use strict';
/**
 * ماژول رفاهیات و امکانات (Welfare)
 * داشبورد رفاهیات: امکانات و رزرو، درخواست‌های کمک‌رفاهی، رویدادها و بیمه تکمیلی
 */
const { dashboardRouter } = require('./_module');

const REQ_TYPES = {
  loan: 'وام', grant: 'کمک هزینه', insurance: 'بیمه', sport: 'ورزش',
  cultural: 'فرهنگی', travel: 'سفر', education: 'آموزش', other: 'سایر',
};

module.exports = dashboardRouter({
  key: 'welfare',
  title: 'داشبورد رفاهیات',
  subtitle: 'امکانات رفاهی و رزرو آن‌ها، درخواست‌های کمک‌رفاهی، اردوها و رویدادها و بیمه تکمیلی کارکنان',
  actions: [
    { label: 'رزرو جدید', url: '/welfare/bookings/new', icon: 'plus' },
    { label: 'رویداد جدید', url: '/welfare/events/new', icon: 'plus' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    return [
      c.kpi('امکانات فعال', await c.count('welfare_facilities', "status = 'active' AND deleted_at IS NULL"), { icon: 'sparkles', color: 'primary', url: '/welfare/facilities' }),
      c.kpi('رزرو در انتظار', await c.count('facility_bookings', "status = 'pending' AND deleted_at IS NULL"), { icon: 'calendar', color: 'warning', url: '/welfare/bookings' }),
      c.kpi('درخواست‌های در انتظار', await c.count('welfare_requests', "status = 'pending' AND deleted_at IS NULL"), { icon: 'inbox', color: 'info', url: '/welfare/requests' }),
      c.kpi('رویدادهای پیش‌رو', await c.count('welfare_events', 'start_date >= ? AND deleted_at IS NULL', [today]), { icon: 'flag', color: 'success', url: '/welfare/events' }),
      c.kpi('بیمه‌نامه‌های فعال', await c.count('welfare_insurance', "status = 'active' AND deleted_at IS NULL"), { icon: 'shield', color: 'purple', url: '/welfare/insurance' }),
    ];
  },
  bars: async (c) => {
    const rows = await c.query(
      `SELECT type, COUNT(*) AS c FROM ${c.t('welfare_requests')} WHERE deleted_at IS NULL GROUP BY type ORDER BY c DESC LIMIT 8`
    );
    return rows.map((r) => ({ label: REQ_TYPES[r.type] || r.type || '—', value: Number(r.c), color: 'purple' }));
  },
  barsTitle: 'درخواست‌های رفاهی به تفکیک نوع',
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const requests = await c.query(
      `SELECT r.*, e.first_name, e.last_name FROM ${c.t('welfare_requests')} r
         LEFT JOIN ${c.t('employees')} e ON e.id = r.employee_id
        WHERE r.status = 'pending' AND r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 10`
    );
    const events = await c.query(
      `SELECT * FROM ${c.t('welfare_events')} WHERE start_date >= ? AND deleted_at IS NULL ORDER BY start_date ASC LIMIT 10`, [today]
    );
    const bookings = await c.query(
      `SELECT b.*, f.name AS facility_name, e.first_name, e.last_name FROM ${c.t('facility_bookings')} b
         LEFT JOIN ${c.t('welfare_facilities')} f ON f.id = b.facility_id
         LEFT JOIN ${c.t('employees')} e ON e.id = b.employee_id
        WHERE b.status = 'pending' AND b.deleted_at IS NULL ORDER BY b.id DESC LIMIT 10`
    );
    const insurance = await c.query(
      `SELECT i.*, e.first_name, e.last_name FROM ${c.t('welfare_insurance')} i
         LEFT JOIN ${c.t('employees')} e ON e.id = i.employee_id
        WHERE i.deleted_at IS NULL ORDER BY i.end_date ASC LIMIT 8`
    );
    return [
      c.table('درخواست‌های رفاهی در انتظار', [
        { label: 'کارمند' }, { label: 'نوع' }, { label: 'عنوان' }, { label: 'مبلغ' }, { label: 'وضعیت', align: 'center' },
      ], requests.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          REQ_TYPES[r.type] || r.type || '—', r.title || '—', c.money(r.amount), c.badge(r.status),
        ],
        actions: [{ icon: 'edit', title: 'بررسی', url: `/welfare/requests/${r.id}/edit` }],
      })), { empty: 'درخواست رفاهی در انتظاری وجود ندارد.' }),
      c.table('رزروهای در انتظار تأیید', [
        { label: 'امکان' }, { label: 'کارمند' }, { label: 'تاریخ' }, { label: 'ساعت' }, { label: 'مهمان', align: 'center' },
      ], bookings.map((r) => ({
        cells: [
          r.facility_name || '—',
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          c.date(r.booking_date),
          `${String(r.from_time || '').slice(0, 5)} - ${String(r.to_time || '').slice(0, 5)}`,
          c.pnum(r.guests || 0),
        ],
        actions: [{ icon: 'edit', title: 'بررسی', url: `/welfare/bookings/${r.id}/edit` }],
      })), { empty: 'رزروی در انتظار نیست.' }),
      c.table('رویدادهای پیش‌رو', [
        { label: 'عنوان' }, { label: 'نوع' }, { label: 'از' }, { label: 'تا' }, { label: 'محل' }, { label: 'وضعیت', align: 'center' },
      ], events.map((r) => ({
        cells: [r.title || '—', r.type || '—', c.date(r.start_date), c.date(r.end_date), r.location || '—', c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/welfare/events/${r.id}/edit` }],
      })), { empty: 'رویدادی ثبت نشده است.' }),
      c.table('بیمه تکمیلی کارکنان', [
        { label: 'کارمند' }, { label: 'بیمه‌گر' }, { label: 'شماره بیمه‌نامه' }, { label: 'تا تاریخ' }, { label: 'وضعیت', align: 'center' },
      ], insurance.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.insurer || '—', r.policy_no || '—', c.date(r.end_date), c.badge(r.status),
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/welfare/insurance/${r.id}/edit` }],
      })), { empty: 'بیمه‌نامه‌ای ثبت نشده است.' }),
    ];
  },
});
