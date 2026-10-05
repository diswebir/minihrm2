'use strict';
/**
 * ماژول حقوق و دستمزد
 * ----------------------------------------------------------------------------
 *  • داشبورد، دوره‌های حقوق، محاسبهٔ خودکار (موتور lib/payroll)
 *  • اقلام اختصاصی هر فیش (اصلاحات)، لیست پرداخت و فیش چاپی/PDF
 *  • تنظیمات قانونی (بیمه، مالیات، حداقل دستمزد، ضرایب)
 */
const express = require('express');
const db = require('../db');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const audit = require('../lib/audit');
const uikit = require('../lib/uikit');
const engine = require('../lib/payroll');
const pdf = require('../lib/pdf');
const mw = require('../middleware');
const authService = require('../services/auth');
const settings = require('../lib/settings');
const config = require('../config');
const notify = require('../lib/notify');

const router = express.Router();
const P = (perm) => mw.requirePerm(perm);
const gate = mw.moduleGate('payroll');

/** اطلاعات شرکت برای سرصفحه فیش */
async function companyInfo() {
  const c = config.load().company || {};
  const pick = async (key, fallback) => (await settings.get(key, '').catch(() => '')) || c[key] || fallback || '';
  return {
    name: await pick('name', 'شرکت'),
    logo: await pick('logo', ''),
    address: await pick('address', ''),
    phone: await pick('phone', ''),
    economic_code: await pick('economic_code', ''),
    national_id: await pick('national_id', ''),
    insurance_no: await pick('insurance_no', ''),
  };
}

/* ============================== داشبورد ============================== */
router.get('/', mw.requireAuth(), P('payroll.view'), gate, async (req, res, next) => {
  try {
    const [periods, empCount, lastRuns, unpaidLoans, pendingAdj] = await Promise.all([
      db.query(`SELECT * FROM ${db.t('payroll_periods')} ORDER BY year DESC, month DESC LIMIT 6`),
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('employees')} WHERE deleted_at IS NULL AND status='active'`),
      db.query(
        `SELECT r.*, p.title AS period_title FROM ${db.t('payroll_runs')} r
           LEFT JOIN ${db.t('payroll_periods')} p ON p.id = r.period_id
          WHERE r.period_id = (SELECT id FROM ${db.t('payroll_periods')} ORDER BY year DESC, month DESC LIMIT 1)
          ORDER BY r.net DESC LIMIT 10`
      ),
      db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(remaining),0) AS amount FROM ${db.t('loans')} WHERE status='active' AND remaining > 0`).catch(() => ({ c: 0, amount: 0 })),
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('payroll_adjustments')} WHERE status = 'pending'`).catch(() => ({ c: 0 })),
    ]);
    const current = periods[0];
    const stats = current ? await db.get(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total_earnings),0) AS gross, COALESCE(SUM(total_deductions),0) AS ded,
              COALESCE(SUM(net),0) AS net, COALESCE(SUM(income_tax),0) AS tax, COALESCE(SUM(insurance_employee),0) AS ins
         FROM ${db.t('payroll_runs')} WHERE period_id = ?`, [current.id]
    ) : { c: 0, gross: 0, ded: 0, net: 0, tax: 0, ins: 0 };

    res.render('page', {
      title: 'داشبورد حقوق و دستمزد',
      page: {
        icon: 'wallet',
        subtitle: current ? `دوره جاری: ${engine.periodTitle(current)} — وضعیت: ${helpers.statusLabel(current.status)}` : 'هنوز دوره حقوقی ایجاد نشده است.',
        actions: [
          ...(authService.can(req.user, 'payroll.period.manage') ? [{ label: 'دوره حقوق جدید', url: '/payroll/periods?new=1', icon: 'plus', class: 'btn-primary' }] : []),
          ...(authService.can(req.user, 'payroll.run.calculate') ? [{ label: 'محاسبه دوره جاری', url: `/payroll/periods/${current ? current.id : ''}`, icon: 'calculator' }] : []),
        ],
        kpis: [
          uikit.kpi('کارکنان فعال', helpers.pnum(Number(empCount.c)), { icon: 'users', color: 'primary' }),
          uikit.kpi('جمع پرداختی دوره', helpers.money(stats.net), { icon: 'bank', color: 'success', note: current ? engine.periodTitle(current) : '' }),
          uikit.kpi('جمع مزایا', helpers.money(stats.gross), { icon: 'trending-up', color: 'info' }),
          uikit.kpi('کسور (مالیات+بیمه)', helpers.money(Number(stats.ded)), { icon: 'trending-down', color: 'warning' }),
          uikit.kpi('مالیات دوره', helpers.money(stats.tax), { icon: 'percent', color: 'warning' }),
          uikit.kpi('بیمه سهم کارمند', helpers.money(stats.ins), { icon: 'shield', color: 'info' }),
          uikit.kpi('مانده وام‌ها', helpers.money(unpaidLoans.amount), { icon: 'hand-coins', color: 'danger', url: '/payroll/loans' }),
          uikit.kpi('اصلاحات در انتظار', helpers.pnum(pendingAdj.c), { icon: 'edit', color: 'warning', url: '/payroll/adjustments' }),
        ],
        sections: [
          {
            type: 'table', title: 'دوره‌های حقوق', url: '/payroll/periods', empty: 'دوره‌ای ثبت نشده است.',
            columns: [{ label: 'دوره' }, { label: 'بازه' }, { label: 'کارکنان' }, { label: 'جمع مزایا' }, { label: 'جمع کسور' }, { label: 'خالص پرداختی' }, { label: 'وضعیت' }],
            rows: periods.map((p) => ({
              url: `/payroll/periods/${p.id}`,
              cells: [
                `<a class="link strong" href="/payroll/periods/${p.id}">${helpers.escapeHtml(engine.periodTitle(p))}</a>`,
                `${uikit.date(p.start_date)} تا ${uikit.date(p.end_date)}`,
                helpers.pnum(p.employee_count || 0),
                helpers.money(p.total_gross),
                helpers.money(p.total_deduction),
                `<b>${helpers.money(p.total_net)}</b>`,
                uikit.badge(p.status, p.status === 'paid' ? 'success' : p.status === 'locked' ? 'warning' : 'muted'),
              ],
            })),
          },
          {
            type: 'table', title: 'بیشترین خالص پرداختی (دوره آخر)', empty: 'داده‌ای نیست.',
            columns: [{ label: 'کد پرسنلی' }, { label: 'نام' }, { label: 'جمع مزایا' }, { label: 'جمع کسور' }, { label: 'خالص' }, { label: 'وضعیت' }],
            rows: lastRuns.map((r) => ({
              url: `/payroll/runs/${r.id}`,
              cells: [
                `<span dir="ltr">${helpers.escapeHtml(r.personnel_code || '')}</span>`,
                `<a class="link" href="/payroll/runs/${r.id}">${helpers.escapeHtml(r.employee_name || '')}</a>`,
                helpers.money(r.total_earnings), helpers.money(r.total_deductions), `<b>${helpers.money(r.net)}</b>`,
                uikit.badge(r.payment_status, r.payment_status === 'paid' ? 'success' : 'warning'),
              ],
              actions: [
                { icon: 'printer', title: 'فیش حقوقی', url: `/payroll/runs/${r.id}/print`, target: '_blank' },
                { icon: 'receipt', title: 'صدور فیش رسمی', url: `/payroll/runs/${r.id}/issue`, post: true, confirm: 'فیش رسمی با شماره و کد رهگیری صادر شود؟' },
              ],
            })),
          },
        ],
      },
    });
  } catch (err) { next(err); }
});

/* ============================ دوره‌های حقوق ============================ */
router.get('/periods', mw.requireAuth(), P('payroll.view'), gate, async (req, res, next) => {
  try {
    const list = await db.query(`SELECT * FROM ${db.t('payroll_periods')} ORDER BY year DESC, month DESC`);
    const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    const today = jalali.toJalaali(new Date());
    res.render('page', {
      title: 'دوره‌های حقوق',
      page: {
        icon: 'calendar',
        actions: authService.can(req.user, 'payroll.period.manage') ? [{ label: 'دوره جدید', url: '#newPeriod', icon: 'plus', class: 'btn-primary', toggle: 'modal' }] : [],
        sections: [
          ...(authService.can(req.user, 'payroll.period.manage') ? [{
            type: 'form', action: '/payroll/periods', submit: 'ایجاد دوره', id: 'newPeriod', title: 'ایجاد دوره حقوق جدید',
            html: `<div class="form-row">
              <div class="col-3"><div class="form-group"><label class="field-label">سال</label><input type="number" name="year" value="${today.jy}" required></div></div>
              <div class="col-3"><div class="form-group"><label class="field-label">ماه</label><select name="month">${months.map((m, i) => `<option value="${i + 1}" ${i + 1 === today.jm ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>
              <div class="col-3"><div class="form-group"><label class="field-label">عنوان (اختیاری)</label><input type="text" name="title" placeholder="${months[today.jm - 1]} ${today.jy}"></div></div>
              <div class="col-3"><div class="form-group"><label class="field-label">تاریخ پرداخت</label><input type="text" name="pay_date" data-jalali></div></div>
              <div class="col-3"><div class="form-group"><label class="field-label">شروع دوره</label><input type="text" name="start_date" data-jalali required></div></div>
              <div class="col-3"><div class="form-group"><label class="field-label">پایان دوره</label><input type="text" name="end_date" data-jalali required></div></div>
            </div>`,
          }] : []),
          uikit.table(
            [{ label: 'دوره' }, { label: 'بازه' }, { label: 'تاریخ پرداخت' }, { label: 'کارکنان' }, { label: 'جمع مزایا' }, { label: 'جمع کسور' }, { label: 'خالص' }, { label: 'وضعیت' }],
            list.map((p) => ({
              url: `/payroll/periods/${p.id}`,
              cells: [
                `<a class="link strong" href="/payroll/periods/${p.id}">${helpers.escapeHtml(engine.periodTitle(p))}</a>`,
                `${uikit.date(p.start_date)} تا ${uikit.date(p.end_date)}`,
                uikit.date(p.pay_date),
                helpers.pnum(p.employee_count || 0),
                helpers.money(p.total_gross), helpers.money(p.total_deduction), `<b>${helpers.money(p.total_net)}</b>`,
                uikit.badge(p.status, p.status === 'paid' ? 'success' : p.status === 'locked' ? 'warning' : p.status === 'draft' ? 'muted' : 'info'),
              ],
              actions: [
                { icon: 'eye', title: 'جزئیات', url: `/payroll/periods/${p.id}` },
                { icon: 'calculator', title: 'محاسبه', url: `/payroll/periods/${p.id}/calculate`, post: true, confirm: 'حقوق همه کارکنان فعال برای این دوره محاسبه/به‌روزرسانی شود؟' },
                { icon: 'download', title: 'خروجی اکسل (CSV)', url: `/payroll/periods/${p.id}/export.csv` },
                { icon: 'printer', title: 'چاپ همه فیش‌ها', url: `/payroll/periods/${p.id}/print-all`, target: '_blank' },
                { icon: 'lock', title: 'قفل دوره', url: `/payroll/periods/${p.id}/lock`, post: true, confirm: 'دوره قفل شود؟ پس از قفل امکان محاسبه مجدد نیست.' },
              ],
            })),
            { empty: 'دوره حقوقی ثبت نشده است.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

router.post('/periods', mw.requireAuth(), P('payroll.period.manage'), gate, async (req, res, next) => {
  try {
    const year = Number(req.body.year) || jalali.toJalaali(new Date()).jy;
    const month = Math.min(12, Math.max(1, Number(req.body.month) || 1));
    const start = jalali.toLatinDigits(String(req.body.start_date || '')).replace(/\//g, '-');
    const end = jalali.toLatinDigits(String(req.body.end_date || '')).replace(/\//g, '-');
    const payDate = jalali.toLatinDigits(String(req.body.pay_date || '')).replace(/\//g, '-');
    const exists = await db.get(`SELECT id FROM ${db.t('payroll_periods')} WHERE year = ? AND month = ?`, [year, month]);
    if (exists) { req.setFlash('error', 'برای این سال و ماه قبلاً دوره ساخته شده است.'); return res.redirect('/payroll/periods'); }
    const id = await db.insert('payroll_periods', {
      title: req.body.title || `${['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'][month - 1]} ${year}`,
      year, month, start_date: start || null, end_date: end || null, pay_date: payDate || null,
      status: 'draft', created_by: req.user.id, created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'payroll', entity: 'payroll_periods', entityId: id, title: `ایجاد دوره حقوق ${year}/${month}` });
    req.setFlash('success', 'دوره حقوق ایجاد شد. اکنون «محاسبه» را بزنید.');
    res.redirect(`/payroll/periods/${id}`);
  } catch (err) { next(err); }
});

router.get('/periods/:id', mw.requireAuth(), P('payroll.view'), gate, async (req, res, next) => {
  try {
    const period = await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [req.params.id]);
    if (!period) return res.status(404).render('errors/404', { title: 'دوره حقوق یافت نشد' });
    const runs = await db.query(`SELECT * FROM ${db.t('payroll_runs')} WHERE period_id = ? ORDER BY net DESC`, [period.id]);
    const sums = {
      gross: runs.reduce((s, r) => s + Number(r.total_earnings || 0), 0),
      ded: runs.reduce((s, r) => s + Number(r.total_deductions || 0), 0),
      net: runs.reduce((s, r) => s + Number(r.net || 0), 0),
      tax: runs.reduce((s, r) => s + Number(r.income_tax || 0), 0),
      insEmp: runs.reduce((s, r) => s + Number(r.insurance_employee || 0), 0),
      insEmpr: runs.reduce((s, r) => s + Number(r.insurance_employer || 0), 0),
    };
    const canCalc = authService.can(req.user, 'payroll.run.calculate') && !['locked', 'paid'].includes(String(period.status));
    res.render('page', {
      title: `دوره حقوق ${engine.periodTitle(period)}`,
      page: {
        icon: 'wallet',
        subtitle: `${uikit.date(period.start_date)} تا ${uikit.date(period.end_date)} — وضعیت: ${helpers.statusLabel(period.status)}`,
        actions: [
          ...(canCalc ? [{ label: 'محاسبه / به‌روزرسانی', url: `/payroll/periods/${period.id}/calculate`, icon: 'calculator', post: true, confirm: 'محاسبه مجدد برای همه کارکنان فعال؟', class: 'btn-primary' }] : []),
          { label: 'خروجی CSV', url: `/payroll/periods/${period.id}/export.csv`, icon: 'download' },
          ...(authService.can(req.user, 'payroll.payslip.issue') && runs.length ? [{ label: 'صدور همهٔ فیش‌ها', url: `/payroll/periods/${period.id}/issue-all`, icon: 'file-text', post: true, confirm: 'برای همهٔ فیش‌های این دوره، فیش رسمی شماره‌دار صادر شود؟' }] : []),
          { label: 'چاپ همه', url: `/payroll/periods/${period.id}/print-all`, icon: 'printer', target: '_blank' },
          ...(authService.can(req.user, 'payroll.pay') && runs.length ? [{ label: 'ثبت پرداخت دوره', url: `/payroll/periods/${period.id}/pay`, icon: 'bank', post: true, confirm: 'پرداخت کل دوره ثبت شود؟' }] : []),
        ],
        kpis: [
          uikit.kpi('تعداد فیش', helpers.pnum(runs.length), { icon: 'receipt', color: 'primary' }),
          uikit.kpi('جمع مزایا', helpers.money(sums.gross), { icon: 'trending-up', color: 'info' }),
          uikit.kpi('جمع کسور', helpers.money(sums.ded), { icon: 'trending-down', color: 'warning' }),
          uikit.kpi('خالص پرداختی', helpers.money(sums.net), { icon: 'bank', color: 'success' }),
          uikit.kpi('مالیات', helpers.money(sums.tax), { icon: 'percent', color: 'warning' }),
          uikit.kpi('بیمه سهم کارمند / کارفرما', `${helpers.money(sums.insEmp)} / ${helpers.money(sums.insEmpr)}`, { icon: 'shield', color: 'info' }),
        ],
        sections: [
          uikit.table(
            [{ label: 'کد پرسنلی' }, { label: 'نام' }, { label: 'روز کارکرد' }, { label: 'روز بیمه' }, { label: 'مزایا' }, { label: 'بیمه' }, { label: 'مالیات' }, { label: 'کسور' }, { label: 'خالص' }, { label: 'پرداخت' }],
            runs.map((r) => ({
              url: `/payroll/runs/${r.id}`,
              cells: [
                `<span dir="ltr">${helpers.escapeHtml(r.personnel_code || '')}</span>`,
                `<a class="link" href="/payroll/runs/${r.id}">${helpers.escapeHtml(r.employee_name || '')}</a>`,
                helpers.pnum(r.days_worked), helpers.pnum(r.days_insurance),
                helpers.money(r.total_earnings), helpers.money(r.insurance_employee), helpers.money(r.income_tax),
                helpers.money(r.total_deductions), `<b>${helpers.money(r.net)}</b>`,
                uikit.badge(r.payment_status, r.payment_status === 'paid' ? 'success' : 'warning'),
              ],
              actions: [
                { icon: 'eye', title: 'فیش و اقلام', url: `/payroll/runs/${r.id}` },
                { icon: 'printer', title: 'چاپ', url: `/payroll/runs/${r.id}/print`, target: '_blank' },
                ...(authService.can(req.user, 'payroll.adjustment.create') && !['locked', 'paid'].includes(String(period.status)) ? [{ icon: 'plus', title: 'افزودن قلم', url: `/payroll/runs/${r.id}?add=1` }] : []),
                ...(authService.can(req.user, 'payroll.run.calculate') && !['locked', 'paid'].includes(String(period.status)) ? [{ icon: 'refresh', title: 'محاسبه مجدد', url: `/payroll/runs/${r.id}/recalc`, post: true, confirm: 'این فیش دوباره محاسبه شود؟' }] : []),
              ],
            })),
            { empty: 'هنوز فیشی برای این دوره محاسبه نشده است. دکمه «محاسبه» را بزنید.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

router.post('/periods/:id/calculate', mw.requireAuth(), P('payroll.run.calculate'), gate, async (req, res, next) => {
  try {
    const result = await engine.calculatePeriod(Number(req.params.id), { userId: req.user.id, force: req.body.force === '1' });
    await audit.log(req, { action: 'update', module: 'payroll', entity: 'payroll_periods', entityId: req.params.id, title: `محاسبه حقوق دوره (${result.calculated} کارمند)` });
    req.setFlash('success', `محاسبه انجام شد: ${helpers.pnum(result.calculated)} فیش محاسبه، ${helpers.pnum(result.skipped)} رد شده، ${helpers.pnum(result.failed)} خطا.`);
    if (result.errors.length) req.setFlash('warning', result.errors.slice(0, 3).join(' | '));
    res.redirect(`/payroll/periods/${req.params.id}`);
  } catch (err) { req.setFlash('error', err.message); res.redirect(`/payroll/periods/${req.params.id}`); }
});

router.post('/periods/:id/approve', mw.requireAuth(), P('payroll.period.approve'), gate, async (req, res, next) => {
  try {
    await db.update('payroll_periods', { status: 'approved', approved_by: req.user.id, approved_at: db.nowSql() }, 'id = ?', [req.params.id]);
    await audit.log(req, { action: 'update', module: 'payroll', entity: 'payroll_periods', entityId: req.params.id, title: 'تأیید دوره حقوق' });
    req.setFlash('success', 'دوره حقوق تأیید شد.');
    res.redirect(`/payroll/periods/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/periods/:id/reopen', mw.requireAuth(), P('payroll.settings.manage'), gate, async (req, res, next) => {
  try {
    await db.update('payroll_periods', { status: 'calculated', locked_at: null, approved_at: null }, 'id = ?', [req.params.id]);
    await audit.log(req, { action: 'update', module: 'payroll', entity: 'payroll_periods', entityId: req.params.id, title: 'بازگشایی دوره حقوق' });
    req.setFlash('success', 'دوره برای ویرایش باز شد.');
    res.redirect(`/payroll/periods/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/periods/:id/lock', mw.requireAuth(), P('payroll.period.manage'), gate, async (req, res, next) => {
  try {
    await db.update('payroll_periods', { status: 'locked', locked_at: db.nowSql() }, 'id = ?', [req.params.id]);
    req.setFlash('success', 'دوره قفل شد.');
    res.redirect(`/payroll/periods/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/periods/:id/pay', mw.requireAuth(), P('payroll.pay'), gate, async (req, res, next) => {
  try {
    const count = await engine.markPaid(Number(req.params.id), { userId: req.user.id, method: req.body.method || 'bank', reference: req.body.reference || null, bank: req.body.bank || null });
    await audit.log(req, { action: 'update', module: 'payroll', entity: 'payroll_periods', entityId: req.params.id, title: `ثبت پرداخت حقوق (${count} فیش)` });
    await notify.notifyHr('پرداخت حقوق ثبت شد', `پرداخت ${helpers.pnum(count)} فیش حقوقی ثبت شد.`, `/payroll/periods/${req.params.id}`);
    req.setFlash('success', `پرداخت ${helpers.pnum(count)} فیش ثبت شد.`);
    res.redirect(`/payroll/periods/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/periods/:id/issue-all', mw.requireAuth(), P('payroll.payslip.issue'), gate, async (req, res, next) => {
  try {
    const period = await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [req.params.id]);
    if (!period) { req.setFlash('error', 'دوره یافت نشد.'); return res.redirect('/payroll/periods'); }
    const runs = await db.query(`SELECT r.*, p.year AS period_year, p.month AS period_month FROM ${db.t('payroll_runs')} r
        LEFT JOIN ${db.t('payroll_periods')} p ON p.id = r.period_id WHERE r.period_id = ? AND r.status <> 'draft'`, [period.id]);
    let issued = 0; let skipped = 0;
    for (const run of runs) {
      const out = await issuePayslipForRun(run, req.user.id);
      if (out.existing) skipped += 1; else issued += 1;
    }
    await audit.log(req, { action: 'issue', module: 'payroll', entity: 'payroll_periods', entityId: period.id, title: `صدور گروهی فیش‌های دوره (${issued} فیش)` });
    req.setFlash('success', `${helpers.pnum(issued)} فیش رسمی صادر شد` + (skipped ? ` و ${helpers.pnum(skipped)} فیش قبلاً صادر شده بود.` : '.'));
    res.redirect(`/payroll/periods/${period.id}`);
  } catch (err) { next(err); }
});

router.get('/periods/:id/export.csv', mw.requireAuth(), P('payroll.export'), gate, async (req, res, next) => {
  try {
    const period = await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [req.params.id]);
    const runs = await db.query(`SELECT * FROM ${db.t('payroll_runs')} WHERE period_id = ? ORDER BY employee_name`, [req.params.id]);
    const cols = [
      ['personnel_code', 'کد پرسنلی'], ['employee_name', 'نام و نام خانوادگی'], ['days_worked', 'روز کارکرد'], ['days_insurance', 'روز بیمه'],
      ['overtime_hours', 'ساعت اضافه‌کاری'], ['gross', 'جمع مزایا'], ['insurance_employee', 'بیمه سهم کارمند'], ['income_tax', 'مالیات'],
      ['total_deductions', 'جمع کسور'], ['net', 'خالص پرداختی'], ['payment_status', 'وضعیت پرداخت'],
    ];
    const rows = [cols.map((c) => c[1]).join(',')].concat(runs.map((r) => cols.map((c) => `"${String(r[c[0]] == null ? '' : r[c[0]]).replace(/"/g, '""')}"`).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName('payroll', [period.year, period.month])}.csv"`);
    res.send('\ufeff' + rows.join('\n'));
  } catch (err) { next(err); }
});

/* ============================== یک فیش ============================== */
async function loadRun(req) {
  const run = await db.get(
    `SELECT r.*, p.title AS period_title, p.year AS period_year, p.month AS period_month, p.start_date, p.end_date, p.pay_date, p.status AS period_status,
            e.full_name, e.personnel_code AS emp_code, e.national_id, e.bank_name, e.bank_account, e.iban, e.insurance_no, e.hire_date, e.marital_status, e.department_id, e.job_title_id
       FROM ${db.t('payroll_runs')} r
       LEFT JOIN ${db.t('payroll_periods')} p ON p.id = r.period_id
       LEFT JOIN ${db.t('employees')} e ON e.id = r.employee_id
      WHERE r.id = ?`, [req.params.id]
  );
  return run;
}

router.get('/runs/:id', mw.requireAuth(), P('payroll.view'), gate, async (req, res, next) => {
  try {
    const run = await loadRun(req);
    if (!run) return res.status(404).render('errors/404', { title: 'فیش حقوقی یافت نشد' });
    const snap = helpers.jsonParse(run.snapshot, {}) || {};
    const adjustments = await db.query(`SELECT a.*, c.name AS component_name FROM ${db.t('payroll_adjustments')} a LEFT JOIN ${db.t('payroll_components')} c ON c.id = a.component_id WHERE a.employee_id = ? AND a.period_id = ? ORDER BY a.id DESC`, [run.employee_id, run.period_id]).catch(() => []);
    const components = await db.query(`SELECT id, ckey, name, type FROM ${db.t('payroll_components')} WHERE is_active = 1 ORDER BY sort_order`).catch(() => []);
    const editable = !['locked', 'paid'].includes(String(run.period_status)) && authService.can(req.user, 'payroll.adjustment.create');
    res.render('payroll/run', { title: `فیش ${run.employee_name || ''}`, run, snap, adjustments, components, editable, engine });
  } catch (err) { next(err); }
});

router.post('/runs/:id/items', mw.requireAuth(), P('payroll.adjustment.create'), gate, async (req, res, next) => {
  try {
    const run = await loadRun(req);
    if (!run) return res.jsonErr('فیش یافت نشد.', 404);
    if (['locked', 'paid'].includes(String(run.period_status))) return res.jsonErr('دوره قفل/پرداخت‌شده است.');
    const amount = Math.abs(engine.F(jalali.toLatinDigits(String(req.body.amount || '0'))));
    if (!amount) return res.jsonErr('مبلغ معتبر وارد کنید.');
    const id = await db.insert('payroll_adjustments', {
      employee_id: run.employee_id, period_id: run.period_id,
      component_id: Number(req.body.component_id) || null,
      title: req.body.title || 'قلم دستی', type: req.body.type === 'deduction' ? 'deduction' : 'earning',
      amount, reason: req.body.reason || null,
      status: authService.can(req.user, 'payroll.adjustment.approve') ? 'approved' : 'pending',
      created_by: req.user.id, created_at: db.nowSql(),
    });
    await engine.calculateOne(await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [run.period_id]), run.employee_id, { userId: req.user.id, note: 'به‌روزرسانی پس از افزودن قلم' });
    await audit.log(req, { action: 'create', module: 'payroll', entity: 'payroll_adjustments', entityId: id, title: `افزودن قلم «${req.body.title}» به فیش ${run.employee_name}` });
    req.setFlash('success', 'قلم به فیش اضافه و محاسبه به‌روزرسانی شد.');
    res.redirect(`/payroll/runs/${run.id}`);
  } catch (err) { next(err); }
});

router.post('/adjustments/:id/remove', mw.requireAuth(), P('payroll.adjustment.create'), gate, async (req, res, next) => {
  try {
    const adj = await db.get(`SELECT * FROM ${db.t('payroll_adjustments')} WHERE id = ?`, [req.params.id]);
    if (!adj) { req.setFlash('error', 'قلم یافت نشد.'); return res.redirect('/payroll/adjustments'); }
    await db.run(`DELETE FROM ${db.t('payroll_adjustments')} WHERE id = ?`, [adj.id]);
    const period = adj.period_id ? await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [adj.period_id]) : null;
    if (period) await engine.calculateOne(period, adj.employee_id, { userId: req.user.id }).catch(() => {});
    await audit.log(req, { action: 'delete', module: 'payroll', entity: 'payroll_adjustments', entityId: adj.id, title: `حذف قلم ${adj.title}` });
    req.setFlash('success', 'قلم حذف شد.');
    res.redirect(req.body.back || (period ? `/payroll/periods/${period.id}` : '/payroll/adjustments'));
  } catch (err) { next(err); }
});

router.post('/runs/:id/recalc', mw.requireAuth(), P('payroll.run.calculate'), gate, async (req, res, next) => {
  try {
    const run = await loadRun(req);
    if (!run) { req.setFlash('error', 'فیش یافت نشد.'); return res.redirect('/payroll'); }
    const period = await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [run.period_id]);
    await engine.calculateOne(period, run.employee_id, { userId: req.user.id });
    req.setFlash('success', 'فیش بازمحاسبه شد.');
    res.redirect(`/payroll/runs/${run.id}`);
  } catch (err) { next(err); }
});

/* ------------------------------ چاپ فیش ------------------------------ */
async function renderPayslip(req, res, run, opts = {}) {
  const emp = run.employee_id ? await db.get(`SELECT * FROM ${db.t('employees')} WHERE id = ?`, [run.employee_id]) : null;
  const period = run.period_id ? await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [run.period_id]) : null;
  const snap = helpers.jsonParse(run.snapshot, {}) || {};
  const company = await companyInfo();
  const dept = emp && emp.department_id ? await db.get(`SELECT name FROM ${db.t('departments')} WHERE id = ?`, [emp.department_id]).catch(() => null) : null;
  const job = emp && emp.job_title_id ? await db.get(`SELECT name FROM ${db.t('job_titles')} WHERE id = ?`, [emp.job_title_id]).catch(() => null) : null;
  let payslip = await db.get(`SELECT * FROM ${db.t('payslips')} WHERE run_id = ? AND deleted_at IS NULL`, [run.run_id || run.id]).catch(() => null);
  if (!payslip && run.number) payslip = run;
  res.render('payroll/payslip', {
    layout: false, title: `فیش حقوقی ${run.employee_name || ''}`, run, snap, emp, period, company, dept, job, payslip: payslip || run, self: Boolean(opts.self), engine,
  });
}

router.get('/runs/:id/print', mw.requireAuth(), P('payroll.view'), gate, async (req, res, next) => {
  try {
    const run = await loadRun(req);
    if (!run) return res.status(404).render('errors/404', { title: 'فیش حقوقی یافت نشد' });
    if (!authService.can(req.user, 'payroll.payslip.issue') && !authService.can(req.user, 'payroll.view')) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
    return renderPayslip(req, res, run, {});
  } catch (err) { next(err); }
});

router.get('/periods/:id/print-all', mw.requireAuth(), P('payroll.view'), gate, async (req, res, next) => {
  try {
    const period = await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [req.params.id]);
    if (!period) return res.status(404).render('errors/404', { title: 'دوره یافت نشد' });
    const runs = await db.query(`SELECT * FROM ${db.t('payroll_runs')} WHERE period_id = ? ORDER BY employee_name`, [period.id]);
    const company = await companyInfo();
    const employees = {};
    const deps = {};
    for (const r of runs) {
      const e = await db.get(`SELECT * FROM ${db.t('employees')} WHERE id = ?`, [r.employee_id]);
      employees[r.id] = e;
      if (e && e.department_id) deps[e.department_id] = (await db.get(`SELECT name FROM ${db.t('departments')} WHERE id = ?`, [e.department_id]).catch(() => null) || {}).name;
    }
    res.render('payroll/payslips-bulk', { layout: false, title: `فیش‌های ${engine.periodTitle(period)}`, period, runs, company, employees, deps, engine, helpers, jalali });
  } catch (err) { next(err); }
});

/* --------------------- صدور فیش رسمی با کد رهگیری --------------------- */
/** صدور فیش رسمی برای یک فیش محاسبه‌شده (در صورت نبود) */
async function issuePayslipForRun(run, userId) {
  const existing = await db.get(`SELECT * FROM ${db.t('payslips')} WHERE run_id = ? AND deleted_at IS NULL`, [run.id]);
  if (existing) return { existing: true, number: existing.number, verify: existing.verify_code };
  const seq = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('payslips')}`);
  const year = run.period_year || (run.snapshot ? (helpers.jsonParse(run.snapshot, {}).period || {}).year : '') || '';
  const month = run.period_month || (run.snapshot ? (helpers.jsonParse(run.snapshot, {}).period || {}).month : '') || 0;
  const number = `${year}${String(month).padStart(2, '0')}-${String(Number(seq.c) + 1).padStart(5, '0')}`;
  const verify = (require('../lib/security').randomToken(6).replace(/[^a-zA-Z0-9]/g, '') + Date.now().toString(36)).toUpperCase().slice(0, 10);
  await db.insert('payslips', {
    run_id: run.id, employee_id: run.employee_id, period_id: run.period_id, number, serial: number, verify_code: verify,
    issued_at: db.nowSql(), issued_by: userId || null, status: 'issued', snapshot: run.snapshot, created_at: db.nowSql(),
  });
  await db.run(`UPDATE ${db.t('payroll_runs')} SET status = 'issued' WHERE id = ?`, [run.id]).catch(() => {});
  return { existing: false, number, verify };
}


router.post('/runs/:id/issue', mw.requireAuth(), P('payroll.payslip.issue'), gate, async (req, res, next) => {
  try {
    const run = await loadRun(req);
    if (!run) { req.setFlash('error', 'فیش یافت نشد.'); return res.redirect('/payroll'); }
    const out = await issuePayslipForRun(run, req.user.id);
    if (out.existing) req.setFlash('info', 'این فیش قبلاً صادر شده است.');
    else req.setFlash('success', `فیش رسمی با شماره ${out.number} و کد رهگیری ${out.verify} صادر شد.`);
    res.redirect(`/payroll/runs/${run.id}`);
  } catch (err) { next(err); }
});

router.get('/payslips', mw.requireAuth(), P('payroll.payslip.issue'), gate, async (req, res, next) => {
  try {
    const list = await db.query(
      `SELECT s.*, r.employee_name, r.net, r.personnel_code, p.title AS period_title FROM ${db.t('payslips')} s
         LEFT JOIN ${db.t('payroll_runs')} r ON r.id = s.run_id
         LEFT JOIN ${db.t('payroll_periods')} p ON p.id = s.period_id
        ORDER BY s.id DESC LIMIT 300`
    );
    res.render('page', {
      title: 'فیش‌های حقوقی صادرشده',
      page: {
        icon: 'receipt',
        subtitle: 'فیش‌های رسمی با شماره و کد رهگیری؛ کد رهگیری برای اعتبارسنجی در سازمان‌های بیرونی قابل استفاده است.',
        sections: [
          uikit.table(
            [{ label: 'شماره فیش' }, { label: 'کارمند' }, { label: 'کد پرسنلی' }, { label: 'دوره' }, { label: 'خالص' }, { label: 'کد رهگیری' }, { label: 'تاریخ صدور' }],
            list.map((s) => ({
              cells: [
                `<span dir="ltr">${helpers.escapeHtml(s.number || '')}</span>`,
                helpers.escapeHtml(s.employee_name || ''),
                `<span dir="ltr">${helpers.escapeHtml(s.personnel_code || '')}</span>`,
                helpers.escapeHtml(s.period_title || ''),
                `<b>${helpers.money(s.net)}</b>`,
                `<code dir="ltr">${helpers.escapeHtml(s.verify_code || '')}</code>`,
                uikit.dateTime(s.issued_at),
              ],
              actions: [{ icon: 'printer', title: 'چاپ', url: `/payroll/runs/${s.run_id}/print`, target: '_blank' }],
            })),
            { empty: 'فیش رسمی صادر نشده است.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

/* ============================== تنظیمات ============================== */
router.get('/settings', mw.requireAuth(), P('payroll.settings.manage'), gate, async (req, res, next) => {
  try {
    const list = await db.query(`SELECT * FROM ${db.t('payroll_settings')} ORDER BY id`);
    const components = await db.query(`SELECT * FROM ${db.t('payroll_components')} ORDER BY sort_order, id`);
    res.render('page', {
      title: 'تنظیمات حقوق و دستمزد',
      page: {
        icon: 'settings',
        subtitle: 'مقادیر قانونی سال جاری؛ تغییرات روی محاسبات بعدی اعمال می‌شود.',
        sections: [
          {
            type: 'form', action: '/payroll/settings', submit: 'ذخیره تنظیمات', title: 'مقادیر قانونی',
            html: `<div class="form-row">${list.map((s) => `
              <div class="col-4"><div class="form-group"><label class="field-label">${helpers.escapeHtml(s.title || s.skey)}</label>
              <input type="text" name="s_${s.id}" value="${helpers.escapeHtml(s.value == null ? '' : s.value)}" dir="ltr">
              <span class="field-help">${helpers.escapeHtml(s.description || s.skey)}</span></div></div>`).join('')}
            </div>`,
          },
          uikit.table(
            [{ label: 'کلید' }, { label: 'نام قلم' }, { label: 'نوع' }, { label: 'دسته' }, { label: 'روش محاسبه' }, { label: 'مقدار پیش‌فرض' }, { label: 'مشمول مالیات' }, { label: 'مشمول بیمه' }],
            components.map((c) => ({
              url: `/payroll/components/${c.id}`,
              cells: [
                `<span dir="ltr">${helpers.escapeHtml(c.ckey)}</span>`,
                helpers.escapeHtml(c.name),
                c.type === 'deduction' ? 'کسور' : 'مزایا',
                helpers.escapeHtml(c.category || ''),
                helpers.escapeHtml(c.calc_type || 'ثابت'),
                helpers.money(c.default_value),
                c.taxable ? '<span class="badge success">دارد</span>' : '<span class="badge muted">ندارد</span>',
                c.insurable ? '<span class="badge success">دارد</span>' : '<span class="badge muted">ندارد</span>',
              ],
            })),
            { title: 'اقلام حقوق', actions: [{ label: 'مدیریت اقلام', url: '/payroll/components', icon: 'list' }] }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

router.post('/settings', mw.requireAuth(), P('payroll.settings.manage'), gate, async (req, res, next) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!key.startsWith('s_')) continue;
      const id = Number(key.slice(2));
      if (!id) continue;
      await db.run(`UPDATE ${db.t('payroll_settings')} SET value = ?, updated_at = ? WHERE id = ?`, [String(value), db.nowSql(), id]).catch(async () => {
        await db.run(`UPDATE ${db.t('payroll_settings')} SET value = ? WHERE id = ?`, [String(value), id]);
      });
    }
    await audit.log(req, { action: 'update', module: 'payroll', entity: 'payroll_settings', title: 'ویرایش تنظیمات حقوق' });
    req.setFlash('success', 'تنظیمات حقوق ذخیره شد.');
    res.redirect('/payroll/settings');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.renderPayslip = renderPayslip;
