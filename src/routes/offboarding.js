'use strict';
/**
 * ماژول تصفیه و ترک کار (Offboarding)
 * داشبورد فرایندهای خروج، تسویه‌های مالی، تسویه بین واحدی و مصاحبه‌های پایانی
 */
const { dashboardRouter } = require('./_module');

module.exports = dashboardRouter({
  key: 'offboarding',
  title: 'داشبورد تصفیه و ترک کار',
  subtitle: 'پیگیری فرایند خروج کارکنان، تسویه‌حساب نهایی، استعلام بین واحدی و مصاحبه پایانی',
  actions: [
    { label: 'درخواست خروج جدید', url: '/offboarding/requests/new', icon: 'plus' },
    { label: 'صورت تسویه', url: '/offboarding/settlements', icon: 'wallet' },
  ],
  kpis: async (c) => [
    c.kpi('در جریان', await c.count('offboarding_requests', "status NOT IN ('completed','canceled','rejected') AND deleted_at IS NULL"), { icon: 'clock', color: 'warning', url: '/offboarding/requests' }),
    c.kpi('تکمیل‌شده', await c.count('offboarding_requests', "status = 'completed' AND deleted_at IS NULL"), { icon: 'check-circle', color: 'success' }),
    c.kpi('تسویه پرداخت‌نشده', await c.count('settlements', "status <> 'paid' AND deleted_at IS NULL"), { icon: 'wallet', color: 'danger', url: '/offboarding/settlements' }),
    c.kpi('جمع تسویه‌های پرداخت‌نشده', await c.sum('settlements', 'net_payable', "status <> 'paid' AND deleted_at IS NULL"), { icon: 'calculator', color: 'purple', money: true, rawValue: true, url: '/offboarding/settlements' }),
  ],
  bars: async (c) => {
    const rows = await c.query(
      `SELECT type, COUNT(*) AS c FROM ${c.t('offboarding_requests')} WHERE deleted_at IS NULL GROUP BY type ORDER BY c DESC LIMIT 8`
    );
    const labels = { resignation: 'استعفا', termination: 'خاتمه همکاری', retirement: 'بازنشستگی', contract_end: 'پایان قرارداد', dismissal: 'اخراج' };
    return rows.map((r) => ({ label: labels[r.type] || r.type || 'نامشخص', value: Number(r.c), color: 'warning' }));
  },
  barsTitle: 'ترک کار به تفکیک نوع',
  sections: async (c) => {
    const reqs = await c.query(
      `SELECT o.*, e.first_name, e.last_name, e.personnel_code FROM ${c.t('offboarding_requests')} o
         LEFT JOIN ${c.t('employees')} e ON e.id = o.employee_id
        WHERE o.deleted_at IS NULL ORDER BY o.id DESC LIMIT 12`
    );
    const pendingClear = await c.query(
      `SELECT cl.*, o.code AS off_code, e.first_name, e.last_name FROM ${c.t('clearances')} cl
         LEFT JOIN ${c.t('offboarding_requests')} o ON o.id = cl.offboarding_id
         LEFT JOIN ${c.t('employees')} e ON e.id = o.employee_id
        WHERE cl.status <> 'cleared' ORDER BY cl.id DESC LIMIT 10`
    );
    const settlements = await c.query(
      `SELECT s.*, e.first_name, e.last_name FROM ${c.t('settlements')} s
         LEFT JOIN ${c.t('employees')} e ON e.id = s.employee_id
        WHERE s.deleted_at IS NULL ORDER BY s.id DESC LIMIT 10`
    );
    return [
      c.table('آخرین فرایندهای ترک کار', [
        { label: 'کد پرونده' }, { label: 'کارمند' }, { label: 'نوع', align: 'center' },
        { label: 'آخرین روز کاری' }, { label: 'وضعیت', align: 'center' }, { label: 'تسویه', align: 'center' },
      ], reqs.map((r) => ({
        cells: [
          r.code || `#${r.id}`,
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          r.type === 'resignation' ? 'استعفا' : (r.type === 'termination' ? 'خاتمه همکاری' : (r.type || '—')),
          c.date(r.last_working_day), c.badge(r.status), c.badge(r.settlement_status),
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/offboarding/requests/${r.id}/edit` }],
      })), { empty: 'فرایند خروجی ثبت نشده است.' }),
      { type: 'list', title: 'استعلام‌های بین واحدی باز', icon: 'inbox', url: '/offboarding/clearances', rows: pendingClear.map((r) => ({
        title: `${r.department || 'واحد'} — ${r.title || 'استعلام'}`,
        sub: `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
        badge: c.badge(r.status),
        url: '/offboarding/clearances',
      })) },
      c.table('صورت‌های تسویه', [
        { label: 'کارمند' }, { label: 'حقوق آخر' }, { label: 'مطالبات' }, { label: 'کسورات' }, { label: 'خالص پرداختی' }, { label: 'وضعیت', align: 'center' },
      ], settlements.map((r) => ({
        cells: [
          `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—',
          c.money(r.last_salary),
          c.money(Number(r.leave_amount || 0) + Number(r.bonus_amount || 0) + Number(r.notice_amount || 0) + Number(r.severance_amount || 0) + Number(r.other_earnings || 0)),
          c.money(Number(r.debt_amount || 0) + Number(r.loan_balance || 0) + Number(r.other_deductions || 0)),
          c.money(r.net_payable), c.badge(r.status),
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/offboarding/settlements/${r.id}/edit` }],
      })), { empty: 'صورت تسویه‌ای ثبت نشده است.' }),
    ];
  },
});
