'use strict';
/**
 * ماژول ایاب و ذهاب (Transport)
 * داشبورد ناوگان: خودروها و رانندگان، مسیرها و ایستگاه‌ها، مشترکان سرویس،
 * سفرهای امروز و هشدار انقضای بیمه/معاینه فنی
 */
const { dashboardRouter } = require('./_module');

module.exports = dashboardRouter({
  key: 'transport',
  title: 'داشبورد ایاب و ذهاب',
  subtitle: 'مدیریت ناوگان، مسیرها و ایستگاه‌ها، تخصیص سرویس به کارکنان و پایش سفرها و هزینه‌ها',
  actions: [
    { label: 'خودرو جدید', url: '/transport/vehicles/new', icon: 'plus' },
    { label: 'مسیر جدید', url: '/transport/routes/new', icon: 'plus' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const month = (c.now || '').slice(0, 7);
    return [
      c.kpi('خودروهای فعال', await c.count('transport_vehicles', "status = 'active' AND deleted_at IS NULL"), { icon: 'truck', color: 'primary', url: '/transport/vehicles' }),
      c.kpi('مسیرهای فعال', await c.count('transport_routes', "status = 'active' AND deleted_at IS NULL"), { icon: 'map', color: 'info', url: '/transport/routes' }),
      c.kpi('مشترکان سرویس', await c.count('transport_subscriptions', "status = 'active' AND deleted_at IS NULL"), { icon: 'users', color: 'success', url: '/transport/subscriptions' }),
      c.kpi('سفرهای امروز', await c.count('transport_trips', 'trip_date = ? AND deleted_at IS NULL', [today]), { icon: 'navigation', color: 'warning', url: '/transport/trips' }),
      c.kpi('هزینه این ماه', await c.sum('transport_costs', 'amount', 'cost_date LIKE ?', [month + '%']), { icon: 'wallet', color: 'purple', money: true, url: '/transport/costs' }),
    ];
  },
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const routes = await c.query(
      `SELECT r.*, v.plate_no, v.title AS vehicle_title,
              (SELECT COUNT(*) FROM ${c.t('transport_subscriptions')} s WHERE s.route_id = r.id AND s.status = 'active' AND s.deleted_at IS NULL) AS subscribers
         FROM ${c.t('transport_routes')} r
         LEFT JOIN ${c.t('transport_vehicles')} v ON v.id = r.vehicle_id
        WHERE r.deleted_at IS NULL ORDER BY r.name ASC LIMIT 12`
    );
    const todayTrips = await c.query(
      `SELECT t.*, r.name AS route_name FROM ${c.t('transport_trips')} t
         LEFT JOIN ${c.t('transport_routes')} r ON r.id = t.route_id
        WHERE t.trip_date = ? AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 10`, [today]
    );
    const expiring = await c.query(
      `SELECT v.* FROM ${c.t('transport_vehicles')} v
        WHERE v.deleted_at IS NULL AND (
          (v.insurance_expiry IS NOT NULL AND v.insurance_expiry <= ?) OR
          (v.technical_expiry IS NOT NULL AND v.technical_expiry <= ?))
        ORDER BY v.insurance_expiry ASC LIMIT 10`, [plus(c, 45), plus(c, 45)]
    );
    const topRoutes = await c.query(
      `SELECT r.name, COUNT(s.id) AS c FROM ${c.t('transport_routes')} r
         LEFT JOIN ${c.t('transport_subscriptions')} s ON s.route_id = r.id AND s.status = 'active' AND s.deleted_at IS NULL
        WHERE r.deleted_at IS NULL GROUP BY r.id, r.name ORDER BY c DESC LIMIT 8`
    );
    return [
      { type: 'tiles', items: [
        { title: 'ناوگان و رانندگان', url: '/transport/vehicles', icon: 'truck', color: 'primary', desc: 'ثبت خودرو، راننده و مدارک' },
        { title: 'مسیر و ایستگاه', url: '/transport/routes', icon: 'map', color: 'info', desc: 'تعریف مسیر، ساعت حرکت و کرایه' },
        { title: 'تخصیص سرویس', url: '/transport/subscriptions', icon: 'users', color: 'success', desc: 'سرویس مشترک چند کارمند در یک مسیر' },
        { title: 'گزارش سفرها', url: '/transport/trips', icon: 'navigation', color: 'warning', desc: 'ثبت سفر، مسافر و کیلومتر' },
        { title: 'هزینه‌ها', url: '/transport/costs', icon: 'wallet', color: 'purple', desc: 'سوخت، تعمیر و کرایه' },
      ] },
      c.table('مسیرها و ظرفیت', [
        { label: 'مسیر' }, { label: 'کد' }, { label: 'خودرو' }, { label: 'راننده' },
        { label: 'ظرفیت', align: 'center' }, { label: 'مشترک', align: 'center' }, { label: 'کرایه ماهانه' },
      ], routes.map((r) => ({
        cells: [
          r.name || '—', r.code || '—', r.plate_no || r.vehicle_title || '—', r.driver_name || '—',
          c.pnum(r.capacity || 0), c.pnum(r.subscribers || 0), c.money(r.monthly_fee),
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/transport/routes/${r.id}/edit` },
          { icon: 'plus', title: 'ایستگاه‌ها', url: `/transport/stops/new` }],
      })), { empty: 'مسیری تعریف نشده است.' }),
      { type: 'list', title: 'سفرهای امروز', icon: 'navigation', url: '/transport/trips', rows: todayTrips.map((r) => ({
        title: `${r.route_name || 'مسیر'} — ${r.direction === 'return' ? 'برگشت' : 'رفت'}`,
        sub: `${r.driver_name || 'راننده نامشخص'}${r.departed_at ? ' — حرکت ' + c.pnum(String(r.departed_at).slice(0, 5)) : ''}`,
        meta: `${c.pnum(r.passenger_count || 0)} مسافر`,
        badge: c.badge(r.status),
        url: '/transport/trips',
      })) },
      { type: 'list', title: 'هشدار انقضای مدارک خودروها', icon: 'alert', url: '/transport/vehicles', rows: expiring.map((r) => ({
        title: `${r.plate_no || r.title || 'خودرو'} — ${r.driver_name || 'بدون راننده'}`,
        sub: `بیمه: ${c.date(r.insurance_expiry)} — معاینه فنی: ${c.date(r.technical_expiry)}`,
        badge: '<span class="badge badge-danger">نزدیک انقضا</span>',
        url: `/transport/vehicles/${r.id}/edit`,
      })) },
      c.table('پرترددترین مسیرها', [{ label: 'مسیر' }, { label: 'مشترک فعال', align: 'center' }],
        topRoutes.map((r) => ({ cells: [r.name || '—', c.pnum(r.c)] })), { compact: true, empty: 'داده‌ای موجود نیست.' }),
    ];
  },
});

/** تاریخ امروز + n روز به صورت YYYY-MM-DD */
function plus(c, days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
