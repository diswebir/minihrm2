'use strict';
/**
 * موتور محاسبه حقوق و دستمزد
 * ----------------------------------------------------------------------------
 * ورودی‌ها: کارمند، دوره حقوق، اقلام حقوق، تنظیمات قانونی، اصلاحات، وام‌ها،
 * اضافه‌کاری و حضور/غیاب. خروجی: اقلام مزایا و کسور، جمع‌ها، مالیات پله‌ای و
 * بیمه، به‌همراه snapshot کامل برای فیش حقوقی.
 *
 * همه مبالغ به ریال است (واحد پیش‌فرض سامانه).
 */
const db = require('../db');

const F = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const R = (v) => Math.round(F(v));

function pad(n) { return String(n).padStart(2, '0'); }
function dateOnly(v) { return String(v || '').slice(0, 10); }
function daysBetween(a, b) {
  const d1 = new Date(dateOnly(a) + 'T00:00:00Z');
  const d2 = new Date(dateOnly(b) + 'T00:00:00Z');
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  return Math.max(0, Math.round((d2 - d1) / 864e5) + 1);
}
function yearsBetween(a, b) {
  const d1 = new Date(dateOnly(a) + 'T00:00:00Z');
  const d2 = new Date(dateOnly(b) + 'T00:00:00Z');
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  let years = d2.getUTCFullYear() - d1.getUTCFullYear();
  const before = (d2.getUTCMonth() < d1.getUTCMonth()) || (d2.getUTCMonth() === d1.getUTCMonth() && d2.getUTCDate() < d1.getUTCDate());
  if (before) years -= 1;
  return Math.max(0, years);
}
function monthDays(period) {
  const s = dateOnly(period.start_date);
  const e = dateOnly(period.end_date);
  const n = daysBetween(s, e);
  return n > 0 ? n : 30;
}

/** تنظیمات حقوق (payroll_settings) به‌صورت نقشه skey → number */
async function settingsMap(year) {
  const rows = await db.query(`SELECT skey, value FROM ${db.t('payroll_settings')} WHERE year = ? OR year IS NULL`, [year]).catch(() => []);
  const map = {};
  rows.forEach((r) => { map[r.skey] = r.value; });
  return map;
}

async function taxBrackets(year) {
  const rows = await db.query(
    `SELECT * FROM ${db.t('tax_brackets')} WHERE is_active = 1 AND (year = ? OR year IS NULL) ORDER BY sort_order, from_amount`,
    [year]
  ).catch(() => []);
  return rows;
}

/** مالیات بر درآمد: پله‌ای روی مبلغ مشمول پس از کسر معافیت ماهانه */
function incomeTax(taxableMonthly, brackets, exemptionMonthly) {
  const bracketsSorted = [...brackets].sort((a, b) => F(a.from_amount) - F(b.from_amount));
  if (!bracketsSorted.length) return 0;
  // پله معافیت
  const exempt = bracketsSorted.find((b) => F(b.exemption) > 0);
  const exemptAmount = exempt ? F(exempt.from_amount) || F(exempt.exemption) : F(exemptionMonthly);
  const base = Math.max(0, F(exemptAmount) || F(exemptionMonthly));
  const above = Math.max(0, F(taxableMonthly) - base);
  if (above <= 0) return 0;
  let tax = 0;
  const steps = bracketsSorted.filter((b) => F(b.rate_percent) > 0);
  for (const b of steps) {
    const from = Math.max(F(b.from_amount), base);
    const to = F(b.to_amount) > 0 ? F(b.to_amount) : Infinity;
    if (taxableMonthly <= from) break;
    const slice = Math.min(taxableMonthly, to) - from;
    if (slice > 0) tax += slice * F(b.rate_percent) / 100;
    if (taxableMonthly <= to) break;
  }
  return R(tax);
}

/** جمع‌آوری ورودی‌های یک کارمند در یک دوره */
async function gather(employeeId, period) {
  const employee = await db.get(`SELECT * FROM ${db.t('employees')} WHERE id = ?`, [employeeId]);
  if (!employee) throw new Error('کارمند یافت نشد.');
  const [components, settings, brackets, adjustments, loans, employeeSettings, attendance, overtime] = await Promise.all([
    db.query(`SELECT * FROM ${db.t('payroll_components')} WHERE is_active = 1 ORDER BY sort_order, id`),
    settingsMap(period.year),
    taxBrackets(period.year),
    db.query(`SELECT * FROM ${db.t('payroll_adjustments')} WHERE employee_id = ? AND period_id = ? AND status <> 'rejected' ORDER BY id`, [employeeId, period.id]),
    db.query(`SELECT * FROM ${db.t('loans')} WHERE employee_id = ? AND status IN ('active','approved') AND remaining > 0 ORDER BY id`, [employeeId]),
    db.query(`SELECT s.*, c.ckey, c.name AS component_name, c.type AS component_type, c.calc_type, c.percentage,
                     c.taxable AS c_taxable, c.insurable AS c_insurable
                FROM ${db.t('payroll_employee_settings')} s
                LEFT JOIN ${db.t('payroll_components')} c ON c.id = s.component_id
               WHERE s.employee_id = ?`, [employeeId]),
    db.get(
      `SELECT COUNT(*) AS present_days, COALESCE(SUM(overtime_minutes),0) AS ot_minutes,
              COALESCE(SUM(late_minutes),0) AS late_minutes, COALESCE(SUM(early_leave_minutes),0) AS early_minutes
         FROM ${db.t('attendance_records')} WHERE employee_id = ? AND work_date BETWEEN ? AND ?`,
      [employeeId, dateOnly(period.start_date), dateOnly(period.end_date)]
    ).catch(() => null),
    db.query(
      `SELECT type, COALESCE(SUM(hours),0) AS hours, COALESCE(AVG(rate),0) AS rate
         FROM ${db.t('overtime_records')} WHERE employee_id = ? AND work_date BETWEEN ? AND ? AND status = 'approved'
        GROUP BY type`,
      [employeeId, dateOnly(period.start_date), dateOnly(period.end_date)]
    ).catch(() => []),
  ]);
  // تعداد فرزندان: مقدار قلم «حق اولاد» در اقلام اختصاصی کارمند = تعداد فرزند
  const childRow = (employeeSettings || []).find((s) => s.ckey === 'child_allowance' || s.component_name === 'حق اولاد');
  const childCount = childRow ? F(childRow.value) : 0;
  return { employee, components, settings, brackets, adjustments, loans, employeeSettings, attendance, overtime, childCount };
}

/** نرخ ساعتی: حقوق پایه ماهانه ÷ (روزهای ماه × ساعت کاری روز) */
function hourlyRate(baseSalary, period, settings) {
  const hoursPerDay = F(settings.daily_work_hours) || 8;
  const days = monthDays(period) || 30;
  return F(baseSalary) / (days * hoursPerDay);
}

/**
 * محاسبه حقوق یک کارمند.
 * @returns {{earnings:Array, deductions:Array, employer:Array, totals:Object, snapshot:Object}}
 */
function compute(input, period) {
  const { employee, components, settings, brackets, adjustments, loans, employeeSettings, attendance, overtime } = input;
  const comp = {};
  components.forEach((c) => { comp[c.ckey] = c; });
  const periodsDays = monthDays(period);
  const insuranceDays = F(employee.insurance_days) || F(settings.insurance_days_default) || 30;
  const daysWorked = attendance && F(attendance.present_days) > 0 ? Math.min(periodsDays, F(attendance.present_days)) : periodsDays;
  const prorate = periodsDays > 0 ? daysWorked / periodsDays : 1;

  const earnings = [];
  const deductions = [];
  const employer = [];
  const add = (arr, key, title, amount, opts = {}) => {
    const amt = R(amount);
    if (!amt && !opts.keepZero) return;
    arr.push({ key, title, amount: amt, taxable: opts.taxable !== false, insurable: opts.insurable !== false, note: opts.note || null });
  };

  const base = F(employee.base_salary) || F((comp.base_salary || {}).default_value);
  const fixed = (key, fallbackSetting) => {
    const c = comp[key];
    const fromSettings = fallbackSetting ? F(settings[fallbackSetting]) : 0;
    return F(c && Number(c.default_value) > 0 ? c.default_value : fromSettings);
  };

  // --- مزایا ---
  add(earnings, 'base_salary', 'حقوق پایه', base * prorate, { keepZero: true });
  if (fixed('housing_allowance', 'housing_allowance')) add(earnings, 'housing_allowance', 'حق مسکن', fixed('housing_allowance', 'housing_allowance') * prorate, { taxable: false, insurable: false });
  if (fixed('food_allowance', 'food_allowance')) add(earnings, 'food_allowance', 'بن کارگری', fixed('food_allowance', 'food_allowance') * prorate, { taxable: false, insurable: false });
  if (String(employee.marital_status || '') === 'married' && fixed('marriage_allowance', 'marriage_allowance')) {
    add(earnings, 'marriage_allowance', 'حق تأهل', fixed('marriage_allowance', 'marriage_allowance') * prorate, { taxable: false, insurable: false });
  }
  const childCount = F(input.childCount);
  if (childCount > 0) {
    const perChild = F(settings.child_allowance) || (F(settings.min_base_salary_daily) * 3);
    add(earnings, 'child_allowance', `حق اولاد (${childCount} فرزند)`, perChild * childCount, { taxable: false, insurable: false });
  }
  // سنوات (پایه سنوات = حداقل دستمزد روزانه × روزهای سنوات هر سال)
  const seniorityYears = employee.hire_date ? yearsBetween(employee.hire_date, period.end_date) : 0;
  if (seniorityYears > 0) {
    const perYear = (F(settings.min_base_salary_daily) || 0) * (F(settings.seniority_days) || 30);
    const amount = perYear * seniorityYears * (insuranceDays / 30);
    add(earnings, 'seniority_pay', `پایه سنوات (${seniorityYears} سال)`, amount, { keepZero: false });
  }

  // اضافه‌کاری/شب‌کاری از ثبت‌های تأییدشده
  const hourly = hourlyRate(base, period, settings);
  const otMap = {};
  (overtime || []).forEach((o) => { otMap[o.type || 'normal'] = F(o.hours); });
  const otHoursNormal = otMap.normal || 0;
  const otHoursHoliday = otMap.holiday || 0;
  const otHoursNight = otMap.night || 0;
  if (otHoursNormal) add(earnings, 'overtime', `اضافه‌کاری (${otHoursNormal} ساعت)`, hourly * otHoursNormal * (F(settings.overtime_rate) || 1.4));
  if (otHoursHoliday) add(earnings, 'holiday_overtime', `اضافه‌کاری تعطیل (${otHoursHoliday} ساعت)`, hourly * otHoursHoliday * (F(settings.holiday_overtime_rate) || 2));
  if (otHoursNight) add(earnings, 'night_pay', `فوق‌العاده شب‌کاری (${otHoursNight} ساعت)`, hourly * otHoursNight * (F(settings.night_rate) || 1.35));

  // اقلام اختصاصی هر کارمند
  for (const s of employeeSettings) {
    if (s.ckey === 'child_allowance' || s.component_name === 'حق اولاد') continue; // تعداد فرزند، نه مبلغ
    const title = s.component_name || s.ckey || 'قلم اختصاصی';
    const type = s.component_type || (F(s.value) >= 0 ? 'earning' : 'deduction');
    const calcType = s.calc_type || 'fixed';
    let amount = F(s.value);
    if (calcType === 'percent' || F(s.percent) > 0) {
      const pct = F(s.percent) || F(s.percentage);
      amount = base * pct / 100;
    }
    if (type === 'deduction') add(deductions, s.ckey || `emp_${s.id}`, title, amount, { taxable: false, insurable: false });
    else add(earnings, s.ckey || `emp_${s.id}`, title, amount, { taxable: s.c_taxable !== 0, insurable: s.c_insurable !== 0 });
  }

  // اصلاحات دوره (پاداش، کسر، مساعده...)
  for (const a of adjustments) {
    const isDeduction = a.type === 'deduction';
    add(isDeduction ? deductions : earnings, `adj_${a.id}`, a.title || 'اصلاح حقوق', F(a.amount), { taxable: !isDeduction, insurable: false, note: a.reason });
  }

  const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
  const insurableTotal = earnings.filter((e) => e.insurable).reduce((sum, e) => sum + e.amount, 0);
  const taxableTotal = earnings.filter((e) => e.taxable).reduce((sum, e) => sum + e.amount, 0);

  // --- کسور ---
  const insurancePercent = F(settings.insurance_employee_percent) || F(settings['payroll.employee_insurance_percent']) || 7;
  const insuranceEmployee = R(insurableTotal * insurancePercent / 100);
  if (insuranceEmployee) add(deductions, 'insurance_employee', `بیمه تأمین اجتماعی (${insurancePercent}٪)`, insuranceEmployee, { taxable: false, insurable: false });

  const tax = incomeTax(taxableTotal, brackets, F(settings.tax_exemption_monthly));
  if (tax) add(deductions, 'income_tax', 'مالیات بر درآمد', tax, { taxable: false, insurable: false });

  for (const loan of loans) {
    const inst = await0(loan);
    if (inst > 0) add(deductions, `loan_${loan.id}`, `قسط وام — ${loan.title || loan.code || ''}`.trim(), inst, { taxable: false, insurable: false });
  }

  // کسر غیبت/تأخیر (در صورت تنظیم)
  const lateMinutes = attendance ? F(attendance.late_minutes) : 0;
  const latePenalty = F(settings.late_penalty_per_minute);
  if (lateMinutes > 0 && latePenalty > 0) add(deductions, 'late_penalty', `کسر تأخیر (${lateMinutes} دقیقه)`, lateMinutes * latePenalty, { taxable: false, insurable: false });

  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const net = totalEarnings - totalDeductions;

  // --- هزینه‌های کارفرما ---
  const employerPercent = F(settings.insurance_employer_percent) || 23;
  const unemploymentPercent = F(settings.unemployment_percent) || 3;
  const employerInsurance = R(insurableTotal * employerPercent / 100);
  add(employer, 'insurance_employer', `بیمه سهم کارفرما (${employerPercent}٪)`, employerInsurance, { taxable: false, insurable: false });
  add(employer, 'unemployment_insurance', `بیمه بیکاری (${unemploymentPercent}٪)`, R(insurableTotal * unemploymentPercent / 100), { taxable: false, insurable: false });

  return {
    earnings, deductions, employer,
    totals: {
      days_worked: daysWorked, days_insurance: insuranceDays, overtime_hours: otHoursNormal + otHoursHoliday + otHoursNight,
      gross: totalEarnings, total_earnings: totalEarnings, total_deductions: totalDeductions,
      insurance_employee: insuranceEmployee, insurance_employer: employerInsurance,
      unemployment_insurance: R(insurableTotal * unemploymentPercent / 100),
      income_tax: tax, net,
      insurable_total: insurableTotal, taxable_total: taxableTotal,
      employer_cost: totalEarnings + employerInsurance,
    },
    snapshot: {
      period: { id: period.id, title: period.title, year: period.year, month: period.month, start_date: period.start_date, end_date: period.end_date },
      employee: { id: employee.id, name: employee.full_name, code: employee.personnel_code, national_id: employee.national_id, department_id: employee.department_id, job_title_id: employee.job_title_id, bank_name: employee.bank_name, bank_account: employee.bank_account, iban: employee.iban, insurance_no: employee.insurance_no, hire_date: employee.hire_date, marital_status: employee.marital_status },
      earnings, deductions, employer,
      totals: null, // بعداً پر می‌شود
      settings: { insurance_employee_percent: insurancePercent, insurance_employer_percent: employerPercent, tax_exemption_monthly: F(settings.tax_exemption_monthly) },
    },
  };

  function await0(loan) { return F(loan.installment_amount) || (F(loan.amount) / Math.max(1, F(loan.installments))); }
}

/** محاسبه و ذخیره یک کارمند در دوره */
async function calculateOne(period, employeeId, opts = {}) {
  const input = await gather(employeeId, period);
  const result = compute(input, period);
  const snapshot = result.snapshot;
  snapshot.totals = result.totals;
  const existing = await db.get(`SELECT * FROM ${db.t('payroll_runs')} WHERE period_id = ? AND employee_id = ?`, [period.id, employeeId]);
  const t = result.totals;
  const data = {
    period_id: period.id, employee_id: employeeId,
    personnel_code: input.employee.personnel_code, employee_name: input.employee.full_name,
    days_worked: t.days_worked, days_insurance: t.days_insurance, overtime_hours: t.overtime_hours,
    gross: t.gross, total_earnings: t.total_earnings, total_deductions: t.total_deductions,
    insurance_employee: t.insurance_employee, insurance_employer: t.insurance_employer,
    unemployment_insurance: t.unemployment_insurance, income_tax: t.income_tax, net: t.net,
    status: 'calculated', payment_status: 'unpaid', snapshot: JSON.stringify(snapshot),
    note: opts.note || null, updated_at: db.nowSql(),
  };
  let runId;
  if (existing) {
    if (['paid', 'locked'].includes(String(existing.status))) return { skipped: true, reason: 'قفل/پرداخت‌شده' };
    await db.update('payroll_runs', data, 'id = ?', [existing.id]);
    runId = existing.id;
  } else {
    data.created_at = db.nowSql();
    data.created_by = opts.userId || null;
    runId = await db.insert('payroll_runs', data);
  }
  // علامت‌گذاری اقساط وام
  for (const loan of input.loans) {
    const inst = F(loan.installment_amount) || (F(loan.amount) / Math.max(1, F(loan.installments)));
    if (inst <= 0) continue;
    const already = await db.get(`SELECT id FROM ${db.t('loan_installments')} WHERE loan_id = ? AND period_id = ?`, [loan.id, period.id]);
    if (!already) {
      await db.run(`INSERT INTO ${db.t('loan_installments')} (loan_id, period_id, no, amount, status, created_at) VALUES (?,?,?,?,?,?)`,
        [loan.id, period.id, F(loan.paid_installments) + 1, R(inst), 'pending', db.nowSql()]);
    }
  }
  return { runId, totals: t };
}

/** محاسبه همه کارکنان فعال یک دوره */
async function calculatePeriod(periodId, opts = {}) {
  const period = await db.get(`SELECT * FROM ${db.t('payroll_periods')} WHERE id = ?`, [periodId]);
  if (!period) throw new Error('دوره حقوق یافت نشد.');
  if (['paid', 'locked', 'approved'].includes(String(period.status)) && !opts.force) {
    throw new Error('این دوره تأیید/قفل شده است؛ ابتدا آن را باز کنید.');
  }
  const employees = opts.employeeIds
    ? await db.query(`SELECT id FROM ${db.t('employees')} WHERE deleted_at IS NULL AND id IN (${opts.employeeIds.map(() => '?').join(',')})`, opts.employeeIds)
    : await db.query(`SELECT id FROM ${db.t('employees')} WHERE deleted_at IS NULL AND status = 'active' ORDER BY id`);
  let calculated = 0, skipped = 0, failed = 0;
  const errors = [];
  for (const e of employees) {
    try {
      const r = await calculateOne(period, e.id, opts);
      if (r.skipped) skipped += 1; else calculated += 1;
    } catch (err) { failed += 1; errors.push(`#${e.id}: ${err.message}`); }
  }
  const sums = await db.get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total_earnings),0) AS gross, COALESCE(SUM(total_deductions),0) AS ded, COALESCE(SUM(net),0) AS net
       FROM ${db.t('payroll_runs')} WHERE period_id = ?`,
    [periodId]
  );
  await db.update('payroll_periods', {
    employee_count: Number(sums.c), total_gross: F(sums.gross), total_deduction: F(sums.ded), total_net: F(sums.net),
    status: period.status === 'draft' ? 'calculated' : period.status, updated_at: db.nowSql(),
  }, 'id = ?', [periodId]);
  await db.run(`UPDATE ${db.t('payroll_periods')} SET calculated_at = ? WHERE id = ?`, [db.nowSql(), periodId]).catch(() => {});
  return { calculated, skipped, failed, errors, totals: { employees: Number(sums.c), gross: F(sums.gross), deductions: F(sums.ded), net: F(sums.net) } };
}

/** ثبت پرداخت دوره */
async function markPaid(periodId, opts = {}) {
  const runs = await db.query(`SELECT * FROM ${db.t('payroll_runs')} WHERE period_id = ?`, [periodId]);
  const t = db.nowSql();
  let count = 0;
  for (const run of runs) {
    await db.run(`UPDATE ${db.t('payroll_runs')} SET payment_status = 'paid', paid_at = ?, bank_ref = ?, status = 'paid' WHERE id = ?`, [t, opts.reference || null, run.id]);
    await db.insert('salary_payments', {
      payroll_run_id: run.id, period_id: periodId, employee_id: run.employee_id, amount: run.net,
      method: opts.method || 'bank', bank: opts.bank || null, reference: opts.reference || null,
      paid_at: t, status: 'paid', note: opts.note || null, created_by: opts.userId || null, created_at: t,
    });
    await db.run(`UPDATE ${db.t('loan_installments')} SET status = 'deducted', deducted_at = ? WHERE period_id = ? AND loan_id IN (SELECT id FROM ${db.t('loans')} WHERE employee_id = ?)`, [t, periodId, run.employee_id]);
    await db.run(`UPDATE ${db.t('loans')} SET paid_installments = paid_installments + 1, remaining = CASE WHEN remaining - installment_amount < 0 THEN 0 ELSE remaining - installment_amount END WHERE employee_id = ? AND status IN ('active','approved')`, [run.employee_id]);
    count += 1;
  }
  await db.update('payroll_periods', { status: 'paid', pay_date: opts.payDate || dateOnly(db.nowSql()), updated_at: t }, 'id = ?', [periodId]);
  return count;
}

/** نام فایل خروجی */
function periodTitle(period) {
  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const m = months[Math.max(0, Math.min(11, F(period.month) - 1))];
  return period.title || `${m} ${period.year}`;
}

module.exports = { compute, gather, calculateOne, calculatePeriod, markPaid, settingsMap, taxBrackets, incomeTax, periodTitle, monthDays, hourlyRate, F, R, dateOnly, daysBetween, yearsBetween };
