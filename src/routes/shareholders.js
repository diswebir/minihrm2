'use strict';
/**
 * ماژول مدیریت سهام‌داران (Shareholders)
 * داشبورد سهام: ترکیب سهام‌داران، گردش سهام، هیئت‌مدیره، مجامع و سرمایه ثبت‌شده
 */
const { dashboardRouter } = require('./_module');

module.exports = dashboardRouter({
  key: 'shareholders',
  title: 'داشبورد سهام‌داران',
  subtitle: 'ترکیب سهام، نقل و انتقالات، اعضای هیئت‌مدیره، مجامع عمومی و سرمایه ثبت‌شده شرکت',
  actions: [
    { label: 'سهام‌دار جدید', url: '/shareholders/list/new', icon: 'plus' },
    { label: 'ثبت نقل و انتقال', url: '/shareholders/transactions/new', icon: 'share' },
  ],
  kpis: async (c) => {
    const year = (c.now || '').slice(0, 4);
    return [
      c.kpi('سهام‌داران', await c.count('shareholders', 'deleted_at IS NULL'), { icon: 'pie', color: 'primary', url: '/shareholders/list' }),
      c.kpi('مجموع سهام', await c.sum('shareholders', 'shares_count', 'deleted_at IS NULL'), { icon: 'layers', color: 'info', url: '/shareholders/list' }),
      c.kpi('گردش سهام امسال', await c.count('shareholder_transactions', 'tdate LIKE ?', [year + '%']), { icon: 'share', color: 'warning', url: '/shareholders/transactions' }),
      c.kpi('اعضای هیئت‌مدیره', await c.count('board_members', 'deleted_at IS NULL'), { icon: 'users', color: 'purple', url: '/shareholders/board' }),
      c.kpi('مجامع برگزارشده', await c.count('general_meetings', 'deleted_at IS NULL'), { icon: 'flag', color: 'success', url: '/shareholders/meetings' }),
    ];
  },
  bars: async (c) => {
    const rows = await c.query(
      `SELECT name, share_percent FROM ${c.t('shareholders')} WHERE deleted_at IS NULL
        ORDER BY share_percent DESC LIMIT 8`
    );
    return rows.map((r) => ({ label: r.name || '—', value: Math.round((Number(r.share_percent) || 0) * 100) / 100, color: 'primary' }));
  },
  barsTitle: 'درصد سهام سهام‌داران اصلی',
  sections: async (c) => {
    const today = (c.now || '').slice(0, 10);
    const holders = await c.query(
      `SELECT id, name, person_type, shares_count, share_percent, nominal_value, join_date, status
         FROM ${c.t('shareholders')} WHERE deleted_at IS NULL ORDER BY share_percent DESC LIMIT 12`
    );
    const transactions = await c.query(
      `SELECT t.*, s.name AS shareholder_name FROM ${c.t('shareholder_transactions')} t
         LEFT JOIN ${c.t('shareholders')} s ON s.id = t.shareholder_id
        WHERE t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 10`
    );
    const meetings = await c.query(
      `SELECT * FROM ${c.t('general_meetings')} WHERE deleted_at IS NULL ORDER BY meeting_date DESC LIMIT 8`
    );
    const capital = await c.get(
      `SELECT * FROM ${c.t('company_capital')} WHERE deleted_at IS NULL ORDER BY year DESC, id DESC LIMIT 1`
    );
    return [
      c.table('ترکیب سهام‌داران', [
        { label: 'سهام‌دار' }, { label: 'نوع' }, { label: 'تعداد سهام' }, { label: 'درصد' }, { label: 'ارزش اسمی' }, { label: 'وضعیت', align: 'center' },
      ], holders.map((r) => ({
        cells: [
          r.name || '—', r.person_type === 'legal' ? 'شخص حقوقی' : 'شخص حقیقی',
          c.pnum(r.shares_count || 0), `${c.pnum(r.share_percent || 0)}٪`, c.money(r.nominal_value), c.badge(r.status),
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/shareholders/list/${r.id}/edit` }],
      })), { empty: 'سهام‌داری ثبت نشده است.' }),
      c.table('آخرین نقل و انتقالات', [
        { label: 'سهام‌دار' }, { label: 'نوع' }, { label: 'تاریخ' }, { label: 'تعداد سهام' }, { label: 'مبلغ' }, { label: 'مرجع' },
      ], transactions.map((r) => ({
        cells: [
          r.shareholder_name || '—',
          r.type === 'transfer' ? 'انتقال' : (r.type === 'sale' ? 'فروش' : (r.type || '—')),
          c.date(r.tdate), c.pnum(r.shares || 0), c.money(r.amount), r.reference || '—',
        ],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/shareholders/transactions/${r.id}/edit` }],
      })), { empty: 'نقل و انتقالی ثبت نشده است.' }),
      c.table('مجامع عمومی', [
        { label: 'عنوان' }, { label: 'نوع' }, { label: 'تاریخ' }, { label: 'محل' }, { label: 'حد نصاب' }, { label: 'وضعیت', align: 'center' },
      ], meetings.map((r) => ({
        cells: [r.title || '—', r.type || '—', c.date(r.meeting_date), r.location || '—', `${c.pnum(r.quorum_percent || 0)}٪`, c.badge(r.status)],
        actions: [{ icon: 'edit', title: 'ویرایش', url: `/shareholders/meetings/${r.id}/edit` }],
      })), { empty: 'مجمعی ثبت نشده است.' }),
      ...(capital ? [{
        type: 'html',
        title: 'سرمایه ثبت‌شده شرکت',
        icon: 'layers',
        html: `<div class="grid-3">
          <div><div class="muted small">سال مالی</div><div class="stat-value">${c.pnum(capital.year || '—')}</div></div>
          <div><div class="muted small">سرمایه</div><div class="stat-value">${c.money(capital.capital_amount)}</div></div>
          <div><div class="muted small">تعداد سهام</div><div class="stat-value">${c.pnum(capital.shares_total || 0)}</div></div>
          <div><div class="muted small">ارزش اسمی هر سهم</div><div class="stat-value">${c.money(capital.nominal_value)}</div></div>
          <div><div class="muted small">افزایش سرمایه</div><div class="stat-value">${c.money(capital.increase_amount)}</div></div>
          <div><div class="muted small">شماره ثبت</div><div class="stat-value">${c.pnum(capital.reg_no || '—')}</div></div>
        </div>`,
      }] : []),
      {
        type: 'html',
        title: 'یادآور مالیاتی/قانونی',
        icon: 'info',
        html: `<p class="muted">ثبت نقل و انتقال سهام، برگزاری مجمع سالانه و ارسال صورت‌های مالی به مراجع ذی‌ربط در موعد مقرر الزامی است. تاریخ مجمع بعدی را در بخش «مجامع» ثبت کنید تا در تقویم سازمان دیده شود (امروز: ${c.date(today)}).</p>`,
      },
    ];
  },
});
