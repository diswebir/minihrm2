'use strict';
/**
 * ماژول آشپزخانه و تغذیه (Kitchen)
 * داشبورد تغذیه: منوی امروز، رزرو و مصرف غذا، انبار، هزینه‌ها
 */
const { dashboardRouter } = require('./_module');

const MEAL_LABELS = { breakfast: 'صبحانه', lunch: 'ناهار', dinner: 'شام', snack: 'میان‌وعده' };

module.exports = dashboardRouter({
  key: 'kitchen',
  title: 'داشبورد آشپزخانه و تغذیه',
  subtitle: 'برنامه غذایی، رزرو و مصرف وعده‌ها، انبار مواد اولیه و پایش هزینه‌ها',
  actions: [
    { label: 'منوی جدید', url: '/kitchen/menus/new', icon: 'plus' },
    { label: 'رزروها', url: '/kitchen/reservations', icon: 'list' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const month = (c.now || '').slice(0, 7);
    return [
      c.kpi('منوی امروز', await c.count('kitchen_menus', 'menu_date = ? AND deleted_at IS NULL', [today]), { icon: 'utensils', color: 'primary', url: '/kitchen/menus' }),
      c.kpi('رزرو امروز', await c.count('meal_reservations', 'meal_date = ? AND deleted_at IS NULL', [today]), { icon: 'check-circle', color: 'success', url: '/kitchen/reservations' }),
      c.kpi('پرس امروز', await c.sum('meal_reservations', 'count', "meal_date = ? AND status <> 'canceled'", [today]), { icon: 'package', color: 'info', url: '/kitchen/reservations' }),
      c.kpi('هزینه این ماه', await c.sum('kitchen_costs', 'amount', 'spent_on LIKE ?', [month + '%']), { icon: 'wallet', color: 'purple', money: true, url: '/kitchen/costs' }),
    ];
  },
  bars: async (c) => {
    const from = new Date();
    from.setDate(from.getDate() - 13);
    const rows = await c.query(
      `SELECT meal_type, SUM(count) AS c FROM ${c.t('meal_reservations')}
        WHERE meal_date >= ? AND status <> 'canceled' GROUP BY meal_type ORDER BY c DESC`,
      [from.toISOString().slice(0, 10)]
    );
    return rows.map((r) => ({ label: MEAL_LABELS[r.meal_type] || r.meal_type || '—', value: Number(r.c) || 0, color: 'info' }));
  },
  barsTitle: 'مصرف وعده‌ها در ۱۴ روز اخیر (پرس)',
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const menus = await c.query(
      `SELECT * FROM ${c.t('kitchen_menus')} WHERE menu_date = ? AND deleted_at IS NULL ORDER BY meal_type ASC`, [today]
    );
    const latestMenus = await c.query(
      `SELECT * FROM ${c.t('kitchen_menus')} WHERE menu_date >= ? AND deleted_at IS NULL ORDER BY menu_date ASC, id ASC LIMIT 12`, [today]
    );
    const lowStock = await c.query(
      `SELECT * FROM ${c.t('kitchen_inventory')}
        WHERE deleted_at IS NULL AND (min_qty IS NOT NULL AND qty <= min_qty)
        ORDER BY (qty - min_qty) ASC LIMIT 12`
    );
    const costs = await c.query(
      `SELECT * FROM ${c.t('kitchen_costs')} WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 8`
    );
    return [
      c.table('منوی امروز', [
        { label: 'وعده' }, { label: 'عنوان' }, { label: 'ظرفیت', align: 'center' }, { label: 'رزرو', align: 'center' }, { label: 'سرو‌شده', align: 'center' }, { label: 'وضعیت', align: 'center' },
      ], menus.map((r) => ({
        cells: [MEAL_LABELS[r.meal_type] || r.meal_type || '—', r.title || '—', c.pnum(r.capacity || 0), c.pnum(r.reserved_count || 0), c.pnum(r.served_count || 0), c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/kitchen/menus/${r.id}/edit` }],
      })), { empty: 'برای امروز منویی ثبت نشده است.' }),
      c.table('برنامه غذایی پیش‌رو', [
        { label: 'تاریخ' }, { label: 'وعده' }, { label: 'عنوان' },
      ], latestMenus.map((r) => ({
        cells: [c.date(r.menu_date), MEAL_LABELS[r.meal_type] || r.meal_type || '—', r.title || '—'],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/kitchen/menus/${r.id}/edit` }],
      })), { empty: 'برنامه‌ای ثبت نشده است.' }),
      c.table('هشدار کمبود انبار', [
        { label: 'قلم' }, { label: 'موجودی', align: 'center' }, { label: 'حداقل', align: 'center' }, { label: 'واحد', align: 'center' },
      ], lowStock.map((r) => ({
        cells: [r.title || '—', c.pnum(r.qty || 0), c.pnum(r.min_qty || 0), r.unit || '—'],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/kitchen/inventory/${r.id}/edit` }],
      })), { empty: 'قلمی زیر حد بحرانی نیست.' }),
      c.table('آخرین هزینه‌های آشپزخانه', [
        { label: 'عنوان' }, { label: 'تاریخ' }, { label: 'دسته' }, { label: 'مبلغ' },
      ], costs.map((r) => ({
        cells: [r.title || '—', c.date(r.spent_on), r.category || '—', c.money(r.amount)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/kitchen/costs/${r.id}/edit` }],
      })), { empty: 'هزینه‌ای ثبت نشده است.' }),
    ];
  },
});
