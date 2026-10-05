'use strict';
/**
 * ماژول کارکنان: فهرست، پرونده پرسنلی، فرم استخدام کارمند، چارت سازمانی و
 * تبدیل داوطلب به کارمند.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const audit = require('../lib/audit');
const uikit = require('../lib/uikit');
const mw = require('../middleware');
const filesRoutes = require('./files');
/** فرم پرسنلی با enctype=multipart ارسال می‌شود؛ بدنه را با multer می‌خوانیم */
const formBody = filesRoutes.upload.any();
const authService = require('../services/auth');

const router = express.Router();
const P = (perm) => mw.requirePerm(perm);

const EMP_FIELDS = [
  { name: 'first_name', label: 'نام', type: 'text', required: true, group: 'مشخصات فردی', col: 4 },
  { name: 'last_name', label: 'نام خانوادگی', type: 'text', required: true, group: 'مشخصات فردی', col: 4 },
  { name: 'father_name', label: 'نام پدر', type: 'text', group: 'مشخصات فردی', col: 4 },
  { name: 'national_id', label: 'کد ملی', type: 'text', group: 'مشخصات فردی', col: 4, dir: 'ltr' },
  { name: 'id_number', label: 'شماره شناسنامه', type: 'text', group: 'مشخصات فردی', col: 4 },
  { name: 'birth_date', label: 'تاریخ تولد', type: 'date', group: 'مشخصات فردی', col: 4 },
  { name: 'birth_place', label: 'محل صدور', type: 'text', group: 'مشخصات فردی', col: 4 },
  { name: 'gender', label: 'جنسیت', type: 'select', options: ['مرد', 'زن'], group: 'مشخصات فردی', col: 4 },
  { name: 'marital_status', label: 'وضعیت تأهل', type: 'select', options: ['مجرد', 'متأهل'], group: 'مشخصات فردی', col: 4 },
  { name: 'military_status', label: 'وضعیت نظام وظیفه', type: 'select', options: ['معاف', 'پایان خدمت', 'در حال خدمت', 'مشمول'], group: 'مشخصات فردی', col: 4 },
  { name: 'religion', label: 'دین', type: 'text', group: 'مشخصات فردی', col: 4 },
  { name: 'mazhab', label: 'مذهب', type: 'text', group: 'مشخصات فردی', col: 4 },
  { name: 'photo', label: 'تصویر پرسنلی', type: 'file', group: 'مشخصات فردی', col: 4, accept: 'image/*' },

  { name: 'mobile', label: 'موبایل', type: 'text', group: 'تماس و نشانی', col: 4, dir: 'ltr' },
  { name: 'phone', label: 'تلفن ثابت', type: 'text', group: 'تماس و نشانی', col: 4, dir: 'ltr' },
  { name: 'email', label: 'ایمیل', type: 'text', group: 'تماس و نشانی', col: 4, dir: 'ltr' },
  { name: 'postal_code', label: 'کد پستی', type: 'text', group: 'تماس و نشانی', col: 4, dir: 'ltr' },
  { name: 'address', label: 'نشانی محل سکونت', type: 'textarea', group: 'تماس و نشانی', rows: 2 },
  { name: 'emergency_name', label: 'نام شخص اضطراری', type: 'text', group: 'تماس و نشانی', col: 4 },
  { name: 'emergency_relative', label: 'نسبت', type: 'text', group: 'تماس و نشانی', col: 4 },
  { name: 'emergency_phone', label: 'تلفن اضطراری', type: 'text', group: 'تماس و نشانی', col: 4, dir: 'ltr' },

  { name: 'personnel_code', label: 'کد پرسنلی', type: 'text', group: 'اطلاعات شغلی', col: 4, dir: 'ltr' },
  { name: 'hire_date', label: 'تاریخ استخدام', type: 'date', group: 'اطلاعات شغلی', col: 4 },
  { name: 'employment_type', label: 'نوع همکاری', type: 'select', options: ['رسمی', 'قراردادی', 'پیمانکاری', 'پاره‌وقت', 'کارآموزی', 'ساعتی'], group: 'اطلاعات شغلی', col: 4 },
  { name: 'department_id', label: 'واحد سازمانی', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('departments')} WHERE deleted_at IS NULL ORDER BY sort_order`, group: 'اطلاعات شغلی', col: 4 },
  { name: 'job_title_id', label: 'عنوان شغلی', type: 'lookup', source: () => `SELECT id, title AS label FROM ${db.t('job_titles')} WHERE deleted_at IS NULL ORDER BY title`, group: 'اطلاعات شغلی', col: 4 },
  { name: 'position_id', label: 'پست سازمانی', type: 'lookup', source: () => `SELECT id, title AS label FROM ${db.t('job_positions')} WHERE deleted_at IS NULL ORDER BY title`, group: 'اطلاعات شغلی', col: 4 },
  { name: 'location_id', label: 'محل کار', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('locations')} ORDER BY name`, group: 'اطلاعات شغلی', col: 4 },
  { name: 'manager_user_id', label: 'مدیر مستقیم', type: 'lookup', source: () => `SELECT id, full_name AS label FROM ${db.t('users')} WHERE status='active' ORDER BY full_name`, group: 'اطلاعات شغلی', col: 4 },
  { name: 'work_shift_id', label: 'شیفت کاری', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('work_shifts')} ORDER BY name`, group: 'اطلاعات شغلی', col: 4 },
  { name: 'status', label: 'وضعیت', type: 'select', options: [{ value: 'active', label: 'شاغل' }, { value: 'leave', label: 'مرخصی بدون حقوق' }, { value: 'terminated', label: 'خاتمه همکاری' }], group: 'اطلاعات شغلی', col: 4 },
  { name: 'probation_end_date', label: 'پایان دوره آزمایشی', type: 'date', group: 'اطلاعات شغلی', col: 4 },
  { name: 'termination_date', label: 'تاریخ خاتمه همکاری', type: 'date', group: 'اطلاعات شغلی', col: 4 },
  { name: 'termination_reason', label: 'علت خاتمه', type: 'text', group: 'اطلاعات شغلی', col: 4 },

  { name: 'education_level', label: 'مدرک تحصیلی', type: 'select', options: ['زیر دیپلم', 'دیپلم', 'کاردانی', 'کارشناسی', 'کارشناسی ارشد', 'دکتری'], group: 'تحصیلات و مهارت', col: 4 },
  { name: 'field_of_study', label: 'رشته تحصیلی', type: 'text', group: 'تحصیلات و مهارت', col: 4 },
  { name: 'insurance_no', label: 'شماره بیمه', type: 'text', group: 'بیمه و بانک', col: 4, dir: 'ltr' },
  { name: 'insurance_days', label: 'روزهای بیمه در ماه', type: 'number', group: 'بیمه و بانک', col: 4 },
  { name: 'insurance_status', label: 'وضعیت بیمه', type: 'select', options: ['بیمه‌شده', 'در انتظار بیمه', 'بیمه اختیاری', 'بدون بیمه'], group: 'بیمه و بانک', col: 4 },
  { name: 'bank_name', label: 'نام بانک', type: 'text', group: 'بیمه و بانک', col: 4 },
  { name: 'bank_account', label: 'شماره حساب', type: 'text', group: 'بیمه و بانک', col: 4, dir: 'ltr' },
  { name: 'iban', label: 'شماره شبا', type: 'text', group: 'بیمه و بانک', col: 4, dir: 'ltr' },
  { name: 'base_salary', label: 'حقوق پایه ماهانه', type: 'money', group: 'مالی', col: 4 },
  { name: 'notes', label: 'یادداشت', type: 'textarea', group: 'مالی', rows: 2 },
];

/* ------------------------------ اجزای مشترک ------------------------------ */
async function maps() {
  const [depts, titles, locs, users] = await Promise.all([
    db.query(`SELECT id, name FROM ${db.t('departments')}`).catch(() => []),
    db.query(`SELECT id, title FROM ${db.t('job_titles')}`).catch(() => []),
    db.query(`SELECT id, name FROM ${db.t('locations')}`).catch(() => []),
    db.query(`SELECT id, full_name FROM ${db.t('users')}`).catch(() => []),
  ]);
  const toMap = (list, field) => list.reduce((acc, r) => { acc[r.id] = r[field]; return acc; }, {});
  return { deptMap: toMap(depts, 'name'), titleMap: toMap(titles, 'title'), locMap: toMap(locs, 'name'), userMap: toMap(users, 'full_name') };
}

/* -------------------------------- فهرست -------------------------------- */
router.get('/', mw.requireAuth(), P('employees.view'), mw.moduleGate('employees'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 20;
    const where = ['e.deleted_at IS NULL'];
    const params = [];
    if (req.query.q) {
      where.push('(e.full_name LIKE ? OR e.personnel_code LIKE ? OR e.mobile LIKE ? OR e.national_id LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like, like);
    }
    if (req.query.f_department_id) { where.push('e.department_id = ?'); params.push(Number(req.query.f_department_id)); }
    if (req.query.f_status) { where.push('e.status = ?'); params.push(req.query.f_status); }
    if (req.query.f_job_title_id) { where.push('e.job_title_id = ?'); params.push(Number(req.query.f_job_title_id)); }
    const totalRow = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('employees')} e WHERE ${where.join(' AND ')}`, params);
    const total = Number(totalRow.c);
    const list = await db.query(
      `SELECT e.*, d.name AS dept_name, jt.title AS job_title FROM ${db.t('employees')} e
         LEFT JOIN ${db.t('departments')} d ON d.id = e.department_id
         LEFT JOIN ${db.t('job_titles')} jt ON jt.id = e.job_title_id
        WHERE ${where.join(' AND ')} ORDER BY e.last_name, e.first_name
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      params
    );
    const m = await maps();
    const showSalary = authService.can(req.user, 'employees.view_salary');
    const ui = {
      table: uikit.table(
        [{ label: 'کد پرسنلی' }, { label: 'نام' }, { label: 'واحد' }, { label: 'عنوان شغلی' }, { label: 'شیفت/محل' }, { label: 'وضعیت' }, ...(showSalary ? [{ label: 'حقوق پایه', align: 'left' }] : [])],
        list.map((e) => ({
          url: `/employees/${e.id}`,
          cells: [
            helpers.pnum(e.personnel_code || '—'),
            `<a href="/employees/${e.id}" class="link strong">${helpers.escapeHtml(e.full_name || '')}</a><div class="muted small" dir="ltr">${helpers.pnum(e.mobile || '')}</div>`,
            helpers.escapeHtml(m.deptMap[e.department_id] || '—'),
            helpers.escapeHtml(m.titleMap[e.job_title_id] || '—'),
            helpers.escapeHtml(m.locMap[e.location_id] || '—'),
            uikit.badge(e.status, e.status === 'active' ? 'success' : (e.status === 'terminated' ? 'danger' : 'warning')),
            ...(showSalary ? [uikit.money(e.base_salary)] : []),
          ],
          actions: [
            { icon: 'eye', title: 'مشاهده پرونده', url: `/employees/${e.id}` },
            ...(authService.can(req.user, 'employees.edit') ? [{ icon: 'edit', title: 'ویرایش', url: `/employees/${e.id}/edit` }] : []),
          ],
        })),
        { empty: 'کارمندی با این شرایط یافت نشد.' }
      ),
      html: `
        <div class="card"><div class="card-body">
          <form class="table-toolbar" method="get">
            <input type="search" name="q" value="${helpers.escapeHtml(req.query.q || '')}" placeholder="جست‌وجوی نام، کد پرسنلی، موبایل یا کد ملی…">
            <select name="f_department_id"><option value="">همه واحدها</option>${Object.keys(m.deptMap).map((id) => `<option value="${id}" ${String(req.query.f_department_id) === String(id) ? 'selected' : ''}>${helpers.escapeHtml(m.deptMap[id])}</option>`).join('')}</select>
            <select name="f_status"><option value="">همه وضعیت‌ها</option><option value="active" ${req.query.f_status === 'active' ? 'selected' : ''}>شاغل</option><option value="leave" ${req.query.f_status === 'leave' ? 'selected' : ''}>مرخصی</option><option value="terminated" ${req.query.f_status === 'terminated' ? 'selected' : ''}>خاتمه همکاری</option></select>
            <button class="btn btn-primary btn-sm" type="submit">${require('../lib/icons').icon('search', '', 16)} فیلتر</button>
            <a class="btn btn-sm" href="/employees">پاک کردن</a>
          </form>
        </div></div>`,
    };
    res.render('page', {
      title: 'کارکنان',
      page: {
        icon: 'users',
        subtitle: `مجموع ${helpers.pnum(total)} نفر با شرایط انتخابی`,
        actions: [
          ...(authService.can(req.user, 'employees.export') ? [{ label: 'خروجی CSV', url: '/employees/export.csv?' + helpers.buildQuery(req.query), icon: 'download', class: 'btn-ghost' }] : []),
          ...(authService.can(req.user, 'employees.create') ? [{ label: 'افزودن کارمند', url: '/employees/new', icon: 'user-plus', class: 'btn-primary' }] : []),
          { label: 'چارت سازمانی', url: '/employees/org-chart', icon: 'sitemap' },
        ],
        sections: [{ type: 'html', html: ui.html }, ui.table],
      },
      meta: helpers.paginationMeta(total, page, perPage),
    });
  } catch (err) { next(err); }
});

/* --------------------------- خروجی CSV کارکنان --------------------------- */
router.get('/export.csv', mw.requireAuth(), P('employees.export'), mw.moduleGate('employees'), async (req, res, next) => {
  try {
    const list = await db.query(
      `SELECT e.*, d.name AS dept_name, jt.title AS job_title FROM ${db.t('employees')} e
         LEFT JOIN ${db.t('departments')} d ON d.id = e.department_id
         LEFT JOIN ${db.t('job_titles')} jt ON jt.id = e.job_title_id
        WHERE e.deleted_at IS NULL ORDER BY e.last_name`
    );
    const showSalary = authService.can(req.user, 'employees.view_salary');
    const cols = [
      ['personnel_code', 'کد پرسنلی'], ['full_name', 'نام'], ['national_id', 'کد ملی'], ['mobile', 'موبایل'],
      ['dept_name', 'واحد'], ['job_title', 'عنوان شغلی'], ['hire_date', 'تاریخ استخدام'], ['status', 'وضعیت'],
      ...(showSalary ? [['base_salary', 'حقوق پایه']] : []),
    ];
    const rows = list.map((r) => cols.map(([f]) => (f.endsWith('_date') && r[f] ? jalali.formatJalaali(r[f]) : (r[f] === null || r[f] === undefined ? '' : r[f]))));
    const csv = '\uFEFF' + [cols.map((c) => c[1]).join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    await audit.log(req, { action: 'export', module: 'employees', entity: 'employees', title: `خروجی ${helpers.pnum(list.length)} کارمند` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="employees-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

/* ------------------------------ چارت سازمانی ------------------------------ */
router.get('/org-chart', mw.requireAuth(), P('employees.view'), mw.moduleGate('employees'), async (req, res, next) => {
  try {
    const [depts, emps] = await Promise.all([
      db.query(`SELECT * FROM ${db.t('departments')} WHERE deleted_at IS NULL ORDER BY sort_order, name`),
      db.query(`SELECT id, full_name, department_id, job_title_id FROM ${db.t('employees')} WHERE deleted_at IS NULL AND status='active'`),
    ]);
    const titles = await db.query(`SELECT id, title FROM ${db.t('job_titles')}`);
    const titleMap = titles.reduce((a, r) => { a[r.id] = r.title; return a; }, {});
    const html = helpers.buildTree(depts, 'id', 'parent_id', (d) => {
      const members = emps.filter((e) => Number(e.department_id) === Number(d.id));
      return `<div class="org-node">
        <div class="org-head"><span class="org-name"><a href="/employees/departments/${d.id}">${helpers.escapeHtml(d.name)}</a></span>
        <span class="badge muted">${helpers.pnum(members.length)} نفر</span></div>
        <ul class="org-members">${members.map((m) => `<li><span class="avatar xs">${helpers.escapeHtml(helpers.initials(m.full_name))}</span> <a href="/employees/${m.id}" class="link">${helpers.escapeHtml(m.full_name)}</a> <span class="muted small">${helpers.escapeHtml(titleMap[m.job_title_id] || '')}</span></li>`).join('') || '<li class="muted small">بدون عضو</li>'}</ul>
      </div>`;
    });
    res.render('page', {
      title: 'چارت سازمانی',
      page: { icon: 'sitemap', sections: [{ type: 'html', html: `<div class="org-chart">${html}</div>` }] },
    });
  } catch (err) { next(err); }
});

/* ------------------------------- پرونده ------------------------------- */
router.get('/:id', mw.requireAuth(), P('employees.view'), mw.moduleGate('employees'), async (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.id))) return next();
  try {
    const emp = await db.get(
      `SELECT e.*, d.name AS dept_name, jt.title AS job_title, l.name AS location_name, s.name AS shift_name
         FROM ${db.t('employees')} e
         LEFT JOIN ${db.t('departments')} d ON d.id = e.department_id
         LEFT JOIN ${db.t('job_titles')} jt ON jt.id = e.job_title_id
         LEFT JOIN ${db.t('locations')} l ON l.id = e.location_id
         LEFT JOIN ${db.t('work_shifts')} s ON s.id = e.work_shift_id
        WHERE e.id = ? AND e.deleted_at IS NULL`, [req.params.id]
    );
    if (!emp) return res.status(404).render('errors/404', { title: 'کارمند یافت نشد' });

    const year = jalali.toJalaali(new Date()).jy;
    const [contracts, documents, historyList, contacts, leaves, trainings, payslips, assets] = await Promise.all([
      db.query(`SELECT * FROM ${db.t('contracts')} WHERE employee_id = ? AND deleted_at IS NULL ORDER BY id DESC`, [emp.id]),
      db.query(`SELECT * FROM ${db.t('employee_documents')} WHERE employee_id = ? AND deleted_at IS NULL ORDER BY id DESC`, [emp.id]),
      db.query(`SELECT * FROM ${db.t('employee_history')} WHERE employee_id = ? ORDER BY effective_date DESC, id DESC LIMIT 30`, [emp.id]),
      db.query(`SELECT * FROM ${db.t('employee_contacts')} WHERE employee_id = ? AND deleted_at IS NULL`, [emp.id]),
      db.query(`SELECT l.*, t.name AS type_name FROM ${db.t('leave_requests')} l LEFT JOIN ${db.t('leave_types')} t ON t.id = l.leave_type_id WHERE l.employee_id = ? ORDER BY l.id DESC LIMIT 12`, [emp.id]),
      db.query(`SELECT n.*, c.title FROM ${db.t('enrollments')} n LEFT JOIN ${db.t('courses')} c ON c.id = n.course_id WHERE n.employee_id = ? ORDER BY n.id DESC LIMIT 12`, [emp.id]),
      db.query(`SELECT r.*, p.title AS period_title FROM ${db.t('payroll_runs')} r LEFT JOIN ${db.t('payroll_periods')} p ON p.id = r.period_id WHERE r.employee_id = ? ORDER BY r.id DESC LIMIT 12`, [emp.id]),
      db.query(`SELECT * FROM ${db.t('assets')} WHERE employee_id = ? AND deleted_at IS NULL`, [emp.id]),
    ]);
    const balances = await db.query(
      `SELECT b.*, t.name AS type_name FROM ${db.t('leave_balances')} b JOIN ${db.t('leave_types')} t ON t.id = b.leave_type_id WHERE b.employee_id = ? AND b.year = ?`, [emp.id, year]
    );
    const showSalary = authService.can(req.user, 'employees.view_salary');
    const showBank = authService.can(req.user, 'employees.view_bank');

    const dl = (pairs) => `<dl class="dl">${pairs.filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== '').map((p) => `<div><dt>${p[0]}</dt><dd>${p[2] !== undefined ? p[2] : helpers.escapeHtml(String(p[1]))}</dd></div>`).join('') || '<div class="muted">اطلاعاتی ثبت نشده است.</div>'}</dl>`;

    const personal = dl([
      ['نام و نام خانوادگی', emp.full_name], ['نام پدر', emp.father_name], ['کد ملی', emp.national_id ? helpers.pnum(emp.national_id) : ''], ['شماره شناسنامه', emp.id_number],
      ['تاریخ تولد', emp.birth_date, uikit.date(emp.birth_date)], ['محل صدور', emp.birth_place], ['جنسیت', emp.gender], ['وضعیت تأهل', emp.marital_status],
      ['نظام وظیفه', emp.military_status], ['دین/مذهب', [emp.religion, emp.mazhab].filter(Boolean).join(' / ')], ['موبایل', emp.mobile, `<span dir="ltr">${helpers.pnum(emp.mobile || '')}</span>`],
      ['تلفن ثابت', emp.phone, `<span dir="ltr">${helpers.pnum(emp.phone || '')}</span>`], ['ایمیل', emp.email], ['کد پستی', emp.postal_code],
      ['نشانی', emp.address], ['تماس اضطراری', [emp.emergency_name, emp.emergency_relative, emp.emergency_phone].filter(Boolean).join(' — ')],
    ]);
    const job = dl([
      ['کد پرسنلی', emp.personnel_code, helpers.pnum(emp.personnel_code || '')], ['واحد سازمانی', emp.dept_name], ['عنوان شغلی', emp.job_title],
      ['محل کار', emp.location_name], ['شیفت کاری', emp.shift_name], ['تاریخ استخدام', emp.hire_date, uikit.date(emp.hire_date)],
      ['نوع همکاری', emp.employment_type], ['پایان دوره آزمایشی', emp.probation_end_date, uikit.date(emp.probation_end_date)],
      ['وضعیت', emp.status, uikit.badge(emp.status, emp.status === 'active' ? 'success' : 'warning')],
      ['مدرک تحصیلی', emp.education_level], ['رشته تحصیلی', emp.field_of_study],
      ...(showSalary ? [['حقوق پایه', emp.base_salary, uikit.money(emp.base_salary) + ' ریال']] : []),
      ...(showBank ? [['بانک', emp.bank_name], ['شماره حساب', emp.bank_account], ['شبا', emp.iban], ['شماره بیمه', emp.insurance_no], ['روز بیمه', emp.insurance_days]] : []),
      ['یادداشت', emp.notes],
    ]);

    const kpis = [
      uikit.kpi('مانده مرخصی (روز)', balances.reduce((s, b) => s + Math.max(0, Number(b.entitled || 0) - Number(b.used || 0) - Number(b.pending || 0)), 0), { icon: 'calendar', color: 'primary' }),
      uikit.kpi('قراردادهای ثبت‌شده', contracts.length, { icon: 'file-signature', color: 'info' }),
      uikit.kpi('مدارک پرسنلی', documents.length, { icon: 'folder', color: 'success' }),
      uikit.kpi('دوره‌های آموزشی', trainings.length, { icon: 'book', color: 'warning' }),
    ];

    const sections = [
      { type: 'html', title: 'مشخصات فردی', icon: 'user', html: personal },
      { type: 'html', title: 'اطلاعات شغلی و مالی', icon: 'briefcase', html: job },
      ...(balances.length ? [{ type: 'table', title: `مانده مرخصی سال ${helpers.pnum(year)}`, icon: 'calendar', compact: true, columns: [{ label: 'نوع مرخصی' }, { label: 'استحقاق' }, { label: 'استفاده‌شده' }, { label: 'در انتظار' }, { label: 'مانده' }], rows: balances.map((b) => ({ cells: [helpers.escapeHtml(b.type_name), helpers.pnum(b.entitled || 0), helpers.pnum(b.used || 0), helpers.pnum(b.pending || 0), `<b>${helpers.pnum(Math.max(0, Number(b.entitled || 0) - Number(b.used || 0) - Number(b.pending || 0)))}</b>`] })) }] : []),
      { type: 'table', title: 'قراردادها', icon: 'file-signature', empty: 'قراردادی ثبت نشده است.', columns: [{ label: 'کد' }, { label: 'نوع' }, { label: 'شروع' }, { label: 'پایان' }, { label: 'وضعیت' }, { label: 'فایل' }], rows: contracts.map((c) => ({ cells: [helpers.escapeHtml(c.code || '—'), helpers.escapeHtml(c.type || '—'), uikit.date(c.start_date), uikit.date(c.end_date), uikit.badge(c.status), c.file ? `<a class="link" href="/files/${encodeURIComponent(c.file)}" target="_blank">دانلود</a>` : '—'] })) },
      ...(authService.can(req.user, 'employees.view_documents') ? [{ type: 'table', title: 'مدارک پرسنلی', icon: 'folder', empty: 'مدرکی ثبت نشده است.', columns: [{ label: 'عنوان' }, { label: 'نوع' }, { label: 'شماره' }, { label: 'انقضا' }, { label: 'وضعیت' }, { label: 'فایل' }], rows: documents.map((d) => ({ cells: [helpers.escapeHtml(d.title), helpers.escapeHtml(d.type || '—'), helpers.escapeHtml(d.number || '—'), uikit.date(d.expires_at), uikit.badge(d.status), d.file ? `<a class="link" href="/files/${encodeURIComponent(d.file)}" target="_blank">مشاهده</a>` : '—'] })) }] : []),
      { type: 'table', title: 'مرخصی‌ها', icon: 'calendar', empty: 'مرخصی ثبت نشده است.', columns: [{ label: 'نوع' }, { label: 'از' }, { label: 'تا' }, { label: 'روز' }, { label: 'وضعیت' }], rows: leaves.map((l) => ({ cells: [helpers.escapeHtml(l.type_name || '—'), uikit.date(l.from_date), uikit.date(l.to_date), helpers.pnum(l.days || 0), uikit.badge(l.status)] })) },
      { type: 'table', title: 'آموزش‌ها', icon: 'book', empty: 'دوره‌ای ثبت نشده است.', columns: [{ label: 'دوره' }, { label: 'پیشرفت' }, { label: 'نمره' }, { label: 'وضعیت' }, { label: 'تاریخ تکمیل' }], rows: trainings.map((t) => ({ cells: [helpers.escapeHtml(t.title || '—'), helpers.pnum(t.progress || 0) + '٪', helpers.pnum(t.score || '—'), uikit.badge(t.status), uikit.date(t.completed_at)] })) },
      ...(showSalary ? [{ type: 'table', title: 'فیش‌های حقوقی', icon: 'receipt', empty: 'فیشی صادر نشده است.', columns: [{ label: 'دوره' }, { label: 'خالص پرداختی' }, { label: 'وضعیت پرداخت' }, { label: '' }], rows: payslips.map((p) => ({ cells: [helpers.escapeHtml(p.period_title || '—'), uikit.money(p.net), uikit.badge(p.payment_status), `<a class="link" href="/payroll/runs/${p.id}">مشاهده فیش</a>`] })) }] : []),
      { type: 'table', title: 'اموال تحویلی', icon: 'package', empty: 'مالی تحویل داده نشده است.', columns: [{ label: 'عنوان' }, { label: 'کد' }, { label: 'سریال' }, { label: 'وضعیت' }], rows: assets.map((a) => ({ cells: [helpers.escapeHtml(a.title), helpers.pnum(a.code || '—'), helpers.escapeHtml(a.serial || '—'), uikit.badge(a.status)] })) },
      { type: 'table', title: 'تاریخچه پرسنلی', icon: 'activity', empty: 'رکوردی ثبت نشده است.', columns: [{ label: 'رویداد' }, { label: 'عنوان' }, { label: 'از' }, { label: 'به' }, { label: 'تاریخ اجرا' }], rows: historyList.map((hh) => ({ cells: [helpers.escapeHtml(hh.event_type), helpers.escapeHtml(hh.title), helpers.escapeHtml(hh.from_value || '—'), helpers.escapeHtml(hh.to_value || '—'), uikit.date(hh.effective_date)] })) },
      ...(contacts.length ? [{ type: 'table', title: 'افراد تحت پوشش / بستگان', icon: 'users', compact: true, columns: [{ label: 'نام' }, { label: 'نسبت' }, { label: 'کد ملی' }, { label: 'موبایل' }, { label: 'تحت پوشش' }], rows: contacts.map((c) => ({ cells: [helpers.escapeHtml(c.name), helpers.escapeHtml(c.relation || '—'), helpers.pnum(c.national_id || '—'), helpers.pnum(c.mobile || '—'), c.is_dependent ? 'بله' : 'خیر'] })) }] : []),
    ];

    res.render('page', {
      title: emp.full_name,
      page: {
        icon: 'user',
        subtitle: `${helpers.escapeHtml(emp.dept_name || '')}${emp.job_title ? ' — ' + helpers.escapeHtml(emp.job_title) : ''}`,
        kpis,
        actions: [
          ...(authService.can(req.user, 'employees.edit') ? [{ label: 'ویرایش پرونده', url: `/employees/${emp.id}/edit`, icon: 'edit', class: 'btn-primary' }] : []),
          { label: 'ثبت رویداد پرسنلی', url: `/employees/history/new?employee_id=${emp.id}`, icon: 'activity' },
          { label: 'افزودن مدرک', url: `/employees/documents/new?employee_id=${emp.id}`, icon: 'folder' },
          { label: 'صدور نامه/گواهی', url: `/requests/new?employee_id=${emp.id}`, icon: 'file-text' },
        ],
        sections,
      },
    });
  } catch (err) { next(err); }
});

/* --------------------------- فرم افزودن/ویرایش --------------------------- */
function renderFormFields(fields, values, errors) {
  const icons = require('../lib/icons');
  const groups = [];
  fields.forEach((f) => {
    const g = f.group || 'اطلاعات';
    if (!groups.find((x) => x.name === g)) groups.push({ name: g, fields: [] });
    groups.find((x) => x.name === g).fields.push(f);
  });
  const lookups = {};
  return { groups, icons, lookups };
}

async function loadLookups(fields) {
  const map = {};
  for (const f of fields) {
    if (f.type === 'lookup' && f.source) {
      try { map[f.name] = (await db.query(typeof f.source === 'function' ? f.source() : f.source)).map((r) => ({ value: r.id, label: r.label ?? r.name ?? r.title })); }
      catch (_) { map[f.name] = []; }
    }
  }
  return map;
}

router.get('/new', mw.requireAuth(), P('employees.create'), mw.moduleGate('employees'), async (req, res, next) => {
  try {
    res.render('employees/form', {
      title: 'افزودن کارمند', row: {}, isNew: true, fields: EMP_FIELDS,
      lookups: await loadLookups(EMP_FIELDS), errors: {}, employee: null,
      roles: await authService.listRoles(),
    });
  } catch (err) { next(err); }
});

router.get('/:id(\\d+)/edit', mw.requireAuth(), P('employees.edit'), mw.moduleGate('employees'), async (req, res, next) => {
  try {
    const emp = await db.get(`SELECT * FROM ${db.t('employees')} WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!emp) return res.status(404).render('errors/404', { title: 'کارمند یافت نشد' });
    res.render('employees/form', {
      title: `ویرایش پرونده ${emp.full_name}`, row: emp, isNew: false, fields: EMP_FIELDS,
      lookups: await loadLookups(EMP_FIELDS), errors: {}, employee: emp,
      roles: await authService.listRoles(),
    });
  } catch (err) { next(err); }
});

function castEmployee(body, fields) {
  const data = {};
  for (const f of fields) {
    const raw = body[f.name];
    if (f.type === 'file') { data[f.name] = body[`${f.name}_file`] ? String(body[`${f.name}_file`]) : (body[f.name] ? String(body[f.name]) : null); continue; }
    if (raw === undefined) continue;
    let v = typeof raw === 'string' ? raw.trim() : raw;
    if (f.type === 'money' || f.type === 'number') v = v === '' ? null : helpers.toNumber(String(v).replace(/,/g, ''), null);
    if (f.type === 'date') v = v ? db.nowSql(jalali.parseJalaali(String(v)) || new Date()).slice(0, 10) : null;
    if (v === '') v = f.nullable === false ? '' : null;
    data[f.name] = v;
  }
  return data;
}

async function saveEmployee(req, res, next, id) {
  try {
    const data = castEmployee(req.body, EMP_FIELDS);
    const errors = {};
    if (!data.first_name) errors.first_name = 'نام الزامی است.';
    if (!data.last_name) errors.last_name = 'نام خانوادگی الزامی است.';
    if (data.national_id) {
      const dup = await db.get(`SELECT id FROM ${db.t('employees')} WHERE national_id = ? AND id <> ?`, [data.national_id, id || 0]);
      if (dup) errors.national_id = 'کارمندی با این کد ملی قبلاً ثبت شده است.';
    }
    if (data.personnel_code) {
      const dup = await db.get(`SELECT id FROM ${db.t('employees')} WHERE personnel_code = ? AND id <> ?`, [data.personnel_code, id || 0]);
      if (dup) errors.personnel_code = 'این کد پرسنلی قبلاً استفاده شده است.';
    }
    if (Object.keys(errors).length) {
      return res.status(422).render('employees/form', {
        title: id ? 'ویرایش کارمند' : 'افزودن کارمند', row: { ...(id ? await db.get(`SELECT * FROM ${db.t('employees')} WHERE id = ?`, [id]) : {}), ...req.body },
        isNew: !id, fields: EMP_FIELDS, lookups: await loadLookups(EMP_FIELDS), errors, employee: id ? { id } : null,
      });
    }
    data.full_name = `${data.first_name} ${data.last_name}`;
    if (!id && !data.personnel_code) {
      // تولید خودکار کد پرسنلی یکتا در صورت خالی بودن
      let n = Number((await db.get(`SELECT COUNT(*) AS c FROM ${db.t('employees')}`)).c) + 1;
      let code = `EMP-${String(n).padStart(4, '0')}`;
      let guard = 0;
      while (guard < 500 && await db.get(`SELECT id FROM ${db.t('employees')} WHERE personnel_code = ?`, [code])) {
        n += 1; guard += 1;
        code = `EMP-${String(n).padStart(4, '0')}`;
      }
      data.personnel_code = code;
    }
    if (!id) {
      data.created_at = db.nowSql();
      const newId = await db.insert('employees', data);
      await db.run(`INSERT INTO ${db.t('employee_history')} (employee_id, event_type, title, effective_date, created_by, created_at) VALUES (?,?,?,?,?,?)`,
        [newId, 'استخدام', 'شروع همکاری', data.hire_date || db.nowSql().slice(0, 10), req.user.id, db.nowSql()]);
      // ایجاد کاربر برای کارمند در صورت درخواست
      if (req.body.create_user === '1') {
        const requested = String(req.body.username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
        const exists = requested
          ? await db.get(`SELECT id FROM ${db.t('users')} WHERE username = ?`, [requested])
          : (data.mobile ? await db.get(`SELECT id FROM ${db.t('users')} WHERE mobile = ? AND deleted_at IS NULL`, [data.mobile]) : null);
        if (!exists) {
          const role = req.body.role_id
            ? await db.get(`SELECT id FROM ${db.t('roles')} WHERE id = ?`, [Number(req.body.role_id)])
            : await db.get(`SELECT id FROM ${db.t('roles')} WHERE rkey = 'employee'`);
          const username = requested || ((data.personnel_code || `emp${newId}`).toLowerCase().replace(/[^a-z0-9._-]/g, ''));
          const tempPassword = String(req.body.temp_password || '').trim() || (require('../lib/security').randomToken(5) + Math.floor(10 + Math.random() * 89));
          const userId = await db.insert('users', {
            username, password_hash: require('../lib/security').hashPassword(tempPassword), full_name: data.full_name,
            mobile: data.mobile, role_id: role ? role.id : null, employee_id: newId, status: 'active',
            must_change_password: 1, created_at: db.nowSql(),
          });
          await db.run(`UPDATE ${db.t('employees')} SET user_id = ? WHERE id = ?`, [userId, newId]);
          req.setFlash('info', `حساب کاربری ساخته شد — نام کاربری: ${username} — گذرواژه موقت: ${tempPassword}`);
        }
      }
      await audit.log(req, { action: 'create', module: 'employees', entity: 'employees', entityId: newId, title: `افزودن کارمند ${data.full_name}` });
      req.setFlash('success', 'کارمند با موفقیت ثبت شد.');
      return res.redirect(`/employees/${newId}`);
    }
    data.updated_at = db.nowSql();
    await db.update('employees', data, 'id = ?', [id]);
    await audit.log(req, { action: 'update', module: 'employees', entity: 'employees', entityId: id, title: `ویرایش پرونده ${data.full_name}` });
    req.setFlash('success', 'تغییرات ذخیره شد.');
    res.redirect(`/employees/${id}`);
  } catch (err) { next(err); }
}

router.post('/', mw.requireAuth(), P('employees.create'), mw.moduleGate('employees'), formBody, (req, res, next) => saveEmployee(req, res, next, null));
router.post('/:id(\\d+)', mw.requireAuth(), P('employees.edit'), mw.moduleGate('employees'), formBody, (req, res, next) => saveEmployee(req, res, next, Number(req.params.id)));

router.post('/:id(\\d+)/delete', mw.requireAuth(), P('employees.delete'), mw.moduleGate('employees'), async (req, res, next) => {
  try {
    const emp = await db.get(`SELECT * FROM ${db.t('employees')} WHERE id = ?`, [req.params.id]);
    if (!emp) return res.status(404).render('errors/404', { title: 'کارمند یافت نشد' });
    await db.run(`UPDATE ${db.t('employees')} SET deleted_at = ?, status = 'terminated' WHERE id = ?`, [db.nowSql(), emp.id]);
    await audit.log(req, { action: 'delete', module: 'employees', entity: 'employees', entityId: emp.id, title: `بایگانی کارمند ${emp.full_name}` });
    req.setFlash('success', 'پرونده کارمند بایگانی شد.');
    res.redirect('/employees');
  } catch (err) { next(err); }
});

/** تبدیل داوطلب به کارمند (استفاده در ماژول جذب) */
async function hireFromApplication(req, applicationId) {
  const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [applicationId]);
  if (!app) return { ok: false, error: 'پرونده داوطلب یافت نشد.' };
  const existing = await db.get(`SELECT id FROM ${db.t('employees')} WHERE national_id = ? AND deleted_at IS NULL`, [app.national_id || '']);
  if (existing) return { ok: false, error: 'کارمندی با این کد ملی قبلاً ثبت شده است.' };
  const job = app.job_req_id ? await db.get(`SELECT * FROM ${db.t('job_reqs')} WHERE id = ?`, [app.job_req_id]) : null;
  const countRow = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('employees')}`);
  const code = `EMP-${String(Number(countRow.c) + 1).padStart(4, '0')}`;
  const id = await db.insert('employees', {
    full_name: `${app.first_name} ${app.last_name}`,
    first_name: app.first_name, last_name: app.last_name,
    national_id: app.national_id || null, mobile: app.mobile || null, email: app.email || null,
    birth_date: app.birth_date || null, gender: app.gender || null, marital_status: app.marital_status || null,
    education_level: app.education_level || null, field_of_study: app.field_of_study || null,
    personnel_code: code, hire_date: db.nowSql().slice(0, 10), status: 'active',
    employment_type: job ? job.employment_type : null,
    department_id: job ? job.department_id : null, job_title_id: job ? job.job_title_id : null,
    location_id: job ? job.location_id : null,
    photo: app.photo || null, address: app.city || null,
    created_at: db.nowSql(),
  });
  await db.run(`UPDATE ${db.t('applications')} SET status = 'hired', decision = 'hire', decided_at = ?, hired_employee_id = ? WHERE id = ?`,
    [db.nowSql(), id, app.id]);
  await db.run(`INSERT INTO ${db.t('employee_history')} (employee_id, event_type, title, effective_date, created_by, created_at) VALUES (?,?,?,?,?,?)`,
    [id, 'استخدام', `استخدام از پرونده داوطلب ${app.code || app.id}`, db.nowSql().slice(0, 10), req ? req.user.id : null, db.nowSql()]);
  // کپی پاسخ‌های فرم استخدام به پرونده کارمند
  const answers = await db.query(`SELECT * FROM ${db.t('application_answers')} WHERE application_id = ?`, [app.id]);
  for (const a of answers) {
    if (a.fkey === 'insurance_no' || a.fkey === 'bank_account') {
      await db.run(`UPDATE ${db.t('employees')} SET ${a.fkey} = ? WHERE id = ?`, [a.value, id]).catch(() => {});
    }
  }
  // آغاز فرآیند بدو ورود
  try {
    const tpl = await db.get(`SELECT * FROM ${db.t('onboarding_templates')} WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1`);
    if (tpl) {
      const onbId = await db.insert('employee_onboarding', { employee_id: id, template_id: tpl.id, status: 'in_progress', progress: 0, started_at: db.nowSql(), created_at: db.nowSql() });
      const tasks = await db.query(`SELECT * FROM ${db.t('onboarding_tasks')} WHERE template_id = ? ORDER BY sort_order`, [tpl.id]);
      for (const t of tasks) {
        await db.insert('employee_onboarding_tasks', {
          onboarding_id: onbId, task_id: t.id, employee_id: id, title: t.title, category: t.category,
          due_date: db.nowSql(new Date(Date.now() + (Number(t.due_days) || 3) * 864e5)).slice(0, 10),
          status: 'pending', created_at: db.nowSql(),
        });
      }
    }
  } catch (_) {}
  await db.run(`UPDATE ${db.t('job_reqs')} SET hired_count = COALESCE(hired_count,0) + 1 WHERE id = ?`, [app.job_req_id]).catch(() => {});
  return { ok: true, employeeId: id, code };
}

module.exports = router;
module.exports.hireFromApplication = hireFromApplication;
module.exports.maps = maps;
