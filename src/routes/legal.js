'use strict';
/**
 * ماژول امور حقوقی و قراردادها (Legal)
 * داشبورد حقوقی: قراردادهای جاری و در آستانه پایان، پرونده‌های قضایی و الزامات قانونی
 */
const { dashboardRouter } = require('./_module');

const CASE_STATUS = { open: 'باز', in_progress: 'در جریان', won: 'برنده', lost: 'باخته', settled: 'سازش', closed: 'بسته‌شده', archived: 'بایگانی' };

module.exports = dashboardRouter({
  key: 'legal',
  title: 'داشبورد امور حقوقی',
  subtitle: 'قراردادها، پرونده‌های قضایی، الزامات قانونی و سررسیدهای حقوقی شرکت',
  actions: [
    { label: 'قرارداد جدید', url: '/legal/contracts/new', icon: 'plus' },
    { label: 'پرونده جدید', url: '/legal/cases/new', icon: 'plus' },
  ],
  kpis: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const soon = plus(60);
    return [
      c.kpi('قراردادهای جاری', await c.count('legal_contracts', "status = 'active' AND deleted_at IS NULL"), { icon: 'file-signature', color: 'primary', url: '/legal/contracts' }),
      c.kpi('قراردادهای در آستانه پایان', await c.count('legal_contracts', 'deleted_at IS NULL AND end_date IS NOT NULL AND end_date >= ? AND end_date <= ?', [today, soon]), { icon: 'clock', color: 'warning', url: '/legal/contracts' }),
      c.kpi('پرونده‌های باز', await c.count('legal_cases', "status IN ('open','in_progress') AND deleted_at IS NULL"), { icon: 'gavel', color: 'danger', url: '/legal/cases' }),
      c.kpi('الزامات در انتظار', await c.count('compliance_items', "status <> 'done' AND deleted_at IS NULL"), { icon: 'check-square', color: 'info', url: '/legal/compliance' }),
      c.kpi('جمع مبلغ قراردادهای جاری', await c.sum('legal_contracts', 'amount', "status = 'active' AND deleted_at IS NULL"), { icon: 'wallet', color: 'purple', money: true, url: '/legal/contracts' }),
    ];
  },
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const contracts = await c.query(
      `SELECT * FROM ${c.t('legal_contracts')} WHERE deleted_at IS NULL
        ORDER BY (end_date IS NULL), end_date ASC, id DESC LIMIT 12`
    );
    const cases = await c.query(
      `SELECT * FROM ${c.t('legal_cases')} WHERE deleted_at IS NULL AND status IN ('open','in_progress')
        ORDER BY next_hearing ASC, id DESC LIMIT 10`
    );
    const compliance = await c.query(
      `SELECT ci.*, u.full_name AS owner_name FROM ${c.t('compliance_items')} ci
         LEFT JOIN ${c.t('users')} u ON u.id = ci.owner_user_id
        WHERE ci.deleted_at IS NULL AND ci.status <> 'done'
        ORDER BY ci.due_date ASC, ci.id DESC LIMIT 10`
    );
    return [
      c.table('قراردادها', [
        { label: 'عنوان' }, { label: 'طرف قرارداد' }, { label: 'موضوع' }, { label: 'مبلغ' }, { label: 'پایان' }, { label: 'وضعیت', align: 'center' },
      ], contracts.map((r) => {
        const days = r.end_date ? Math.ceil((new Date(String(r.end_date).slice(0, 10)) - new Date(today)) / 86400000) : null;
        const badge = days !== null && days <= 60 ? '<span class="badge badge-warning">نزدیک پایان</span>' : c.badge(r.status);
        return {
          cells: [r.title || '—', r.party_name || '—', r.subject || '—', c.money(r.amount), c.date(r.end_date), badge],
          actions: [{ icon: 'edit', title: 'ویرایش', url: `/legal/contracts/${r.id}/edit` }],
        };
      }), { empty: 'قراردادی ثبت نشده است.' }),
      c.table('پرونده‌های قضایی باز', [
        { label: 'عنوان' }, { label: 'شماره پرونده' }, { label: 'دادگاه' }, { label: 'طرف مقابل' }, { label: 'جلسه بعدی' }, { label: 'وضعیت', align: 'center' },
      ], cases.map((r) => ({
        cells: [r.title || '—', r.case_no || '—', r.court || '—', r.opponent || '—', c.date(r.next_hearing), c.badge(CASE_STATUS[r.status] || r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/legal/cases/${r.id}/edit` }],
      })), { empty: 'پرونده بازی وجود ندارد.' }),
      c.table('الزامات قانونی در انتظار', [
        { label: 'عنوان' }, { label: 'مرجع' }, { label: 'مهلت' }, { label: 'مسئول' }, { label: 'وضعیت', align: 'center' },
      ], compliance.map((r) => ({
        cells: [r.title || '—', r.authority || '—', c.date(r.due_date), r.owner_name || '—', c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/legal/compliance/${r.id}/edit` }],
      })), { empty: 'الزامی در انتظار نیست.' }),
    ];
  },
});

function plus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
