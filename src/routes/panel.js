'use strict';
/**
 * پنل کاربری — داشبورد، جست‌وجوی سراسری، تنظیمات، کاربران، نقش‌ها، لاگ
 * و سوار کردن خودکار همه منابع (ماژول‌ها) روی موتور resource
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const settings = require('../lib/settings');
const audit = require('../lib/audit');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const security = require('../lib/security');
const { resourceRouter } = require('../lib/resource');
const mw = require('../middleware');
const authService = require('../services/auth');
const modulesService = require('../services/modules');
const smsService = require('../services/sms');
const registry = require('../modules');
const resources = require('../modules/resources');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* ابزارهای آماری داشبورد                                             */
/* ------------------------------------------------------------------ */
async function count(sql, params = []) {
  try {
    const row = await db.get(sql, params);
    return Number(row ? row.c : 0);
  } catch (_) { return 0; }
}

async function sum(sql, params = []) {
  try {
    const row = await db.get(sql, params);
    return Number(row ? row.s : 0);
  } catch (_) { return 0; }
}

async function rows(sql, params = []) {
  try { return await db.query(sql, params); } catch (_) { return []; }
}

/** آیا کاربر مدیر/منابع انسانی است؟ */
function isHr(user) { return authService.isHr(user); }

/** شناسه کارمند متصل به کاربر جاری */
async function myEmployee(user) {
  if (!user) return null;
  try {
    return await db.get(`SELECT * FROM ${db.t('employees')} WHERE user_id = ? AND deleted_at IS NULL LIMIT 1`, [user.id]);
  } catch (_) { return null; }
}

async function dashboardData(user) {
  const scope = user.role_scope || 'employee';
  const data = { kpis: [], bars: [], lists: [], alerts: [], quick: [] };

  if (scope === 'admin' || scope === 'hr') {
    const year = jalali.toJalaali(new Date()).jy;
    const in30 = db.nowSql(new Date(Date.now() + 30 * 864e5)).slice(0, 10);
    const in45 = db.nowSql(new Date(Date.now() + 45 * 864e5)).slice(0, 10);
    const in60 = db.nowSql(new Date(Date.now() + 60 * 864e5)).slice(0, 10);
    const [empCount, activeContracts, applicants, openJobs] = await Promise.all([
      count(`SELECT COUNT(*) AS c FROM ${db.t('employees')} WHERE deleted_at IS NULL AND status = 'active'`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('contracts')} WHERE deleted_at IS NULL AND status = 'active'`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('applications')} WHERE deleted_at IS NULL`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('job_reqs')} WHERE deleted_at IS NULL AND status = 'open'`),
    ]);
    const [pendingLeave, pendingReq, courses, expiringDocs] = await Promise.all([
      count(`SELECT COUNT(*) AS c FROM ${db.t('leave_requests')} WHERE status = 'pending'`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('hr_requests')} WHERE status IN ('pending','in_progress')`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('enrollments')} WHERE status IN ('assigned','in_progress')`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('employee_documents')} WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?`, [in30]),
    ]);
    data.kpis = [
      { label: 'کارکنان فعال', value: empCount, icon: 'users', color: 'primary', url: '/employees' },
      { label: 'قراردادهای جاری', value: activeContracts, icon: 'file-signature', color: 'success', url: '/employees/contracts' },
      { label: 'داوطلبان', value: applicants, icon: 'user-plus', color: 'info', url: '/recruitment/applications' },
      { label: 'آگهی‌های باز', value: openJobs, icon: 'briefcase', color: 'warning', url: '/recruitment/jobs' },
      { label: 'مرخصی در انتظار', value: pendingLeave, icon: 'calendar', color: 'warning', url: '/attendance/leaves?f_status=pending' },
      { label: 'درخواست‌های باز', value: pendingReq, icon: 'inbox', color: 'info', url: '/requests' },
      { label: 'دوره‌های در جریان', value: courses, icon: 'book', color: 'primary', url: '/training/enrollments' },
      { label: 'مدارک نیازمند تمدید', value: expiringDocs, icon: 'alert-circle', color: 'danger', url: '/employees/documents' },
    ];

    // نمودار مراحل جذب
    const stages = await rows(
      `SELECT s.name, s.color, (SELECT COUNT(*) FROM ${db.t('applications')} a WHERE a.stage_key = s.key AND a.deleted_at IS NULL) AS c
         FROM ${db.t('recruitment_stages')} s WHERE s.is_active = 1 ORDER BY s.sort_order`
    );
    if (stages.length) data.bars = stages.map((s) => ({ label: s.name, value: Number(s.c), color: s.color || 'primary' }));

    data.lists.push({
      title: 'آخرین داوطلبان', icon: 'user-plus', url: '/recruitment/applications',
      columns: ['نام', 'موقعیت', 'مرحله', 'تاریخ'],
      items: (await rows(
        `SELECT a.id, a.full_name, a.stage_key, a.created_at, j.title AS job_title
           FROM ${db.t('applications')} a LEFT JOIN ${db.t('job_reqs')} j ON j.id = a.job_req_id
          WHERE a.deleted_at IS NULL ORDER BY a.id DESC LIMIT 6`
      )).map((r) => ({ url: `/recruitment/applications/${r.id}`, cells: [r.full_name, r.job_title || '—', helpers.statusLabel(r.stage_key) || r.stage_key || '—', jalali.formatJalaali(r.created_at)] })),
    });

    data.lists.push({
      title: 'مرخصی‌های در انتظار تأیید', icon: 'calendar', url: '/attendance/leaves?f_status=pending',
      columns: ['کارمند', 'از تاریخ', 'تا تاریخ', 'روز'],
      items: (await rows(
        `SELECT l.id, l.from_date, l.to_date, l.days, e.full_name
           FROM ${db.t('leave_requests')} l JOIN ${db.t('employees')} e ON e.id = l.employee_id
          WHERE l.status = 'pending' ORDER BY l.id DESC LIMIT 6`
      )).map((r) => ({ url: `/attendance/leaves/${r.id}`, cells: [r.full_name, jalali.formatJalaali(r.from_date), jalali.formatJalaali(r.to_date), helpers.pnum(r.days || 0)] })),
    });

    // هشدارها
    const expLicenses = await count(`SELECT COUNT(*) AS c FROM ${db.t('licenses')} WHERE deleted_at IS NULL AND expiry_date IS NOT NULL AND expiry_date <= ?`, [in60]);
    const expContracts = await count(`SELECT COUNT(*) AS c FROM ${db.t('contracts')} WHERE deleted_at IS NULL AND status = 'active' AND end_date IS NOT NULL AND end_date <= ?`, [in45]);
    const expInsurance = await count(`SELECT COUNT(*) AS c FROM ${db.t('transport_vehicles')} WHERE deleted_at IS NULL AND insurance_expiry IS NOT NULL AND insurance_expiry <= ?`, [in30]);
    if (expContracts) data.alerts.push({ text: `${helpers.pnum(expContracts)} قرارداد در ۴۵ روز آینده منقضی می‌شود.`, url: '/employees/contracts?f_end_date_to=' + in45, type: 'warning' });
    if (expLicenses) data.alerts.push({ text: `${helpers.pnum(expLicenses)} مجوز در ۶۰ روز آینده به پایان اعتبار می‌رسد.`, url: '/licensing/list', type: 'danger' });
    if (expInsurance) data.alerts.push({ text: `${helpers.pnum(expInsurance)} خودرو بیمه‌نامه نزدیک به انقضا دارند.`, url: '/transport/vehicles', type: 'warning' });
    void year;
  } else if (scope === 'manager') {
    const emp = await myEmployee(user);
    const deptId = emp ? emp.department_id : 0;
    const teamCount = await count(`SELECT COUNT(*) AS c FROM ${db.t('employees')} WHERE deleted_at IS NULL AND department_id = ?`, [deptId]);
    const [teamLeaves, teamTrainings, doneReviews] = await Promise.all([
      count(`SELECT COUNT(*) AS c FROM ${db.t('leave_requests')} l JOIN ${db.t('employees')} e ON e.id = l.employee_id WHERE l.status='pending' AND e.department_id = ?`, [deptId]),
      count(`SELECT COUNT(*) AS c FROM ${db.t('enrollments')} n JOIN ${db.t('employees')} e ON e.id = n.employee_id WHERE n.status IN ('assigned','in_progress') AND e.department_id = ?`, [deptId]),
      count(`SELECT COUNT(*) AS c FROM ${db.t('performance_reviews')} r JOIN ${db.t('employees')} e ON e.id = r.employee_id WHERE r.status <> 'done' AND e.department_id = ?`, [deptId]),
    ]);
    data.kpis = [
      { label: 'اعضای تیم', value: teamCount, icon: 'users', color: 'primary', url: '/employees' },
      { label: 'مرخصی در انتظار تأیید', value: teamLeaves, icon: 'calendar', color: 'warning', url: '/attendance/leaves?f_status=pending' },
      { label: 'دوره‌های در جریان تیم', value: teamTrainings, icon: 'book', color: 'info', url: '/training/enrollments' },
      { label: 'ارزیابی‌های ناتمام', value: doneReviews, icon: 'chart', color: 'danger', url: '/performance/reviews' },
    ];
    data.lists.push({
      title: 'مرخصی‌های در انتظار تأیید تیم من', icon: 'calendar', url: '/attendance/leaves?f_status=pending',
      columns: ['کارمند', 'از تاریخ', 'روز', 'وضعیت'],
      items: (await rows(
        `SELECT l.id, l.from_date, l.days, l.status, e.full_name FROM ${db.t('leave_requests')} l
           JOIN ${db.t('employees')} e ON e.id = l.employee_id
          WHERE l.status='pending' AND e.department_id = ? ORDER BY l.id DESC LIMIT 6`, [deptId]
      )).map((r) => ({ url: `/attendance/leaves/${r.id}`, cells: [r.full_name, jalali.formatJalaali(r.from_date), helpers.pnum(r.days || 0), helpers.statusLabel(r.status)] })),
    });
  } else {
    // کارمند / داوطلب
    const emp = await myEmployee(user);
    if (emp) {
      const [balance, courses, requests, lastPay] = await Promise.all([
        sum(`SELECT COALESCE(SUM(entitled - used - pending),0) AS s FROM ${db.t('leave_balances')} WHERE employee_id = ?`, [emp.id]),
        count(`SELECT COUNT(*) AS c FROM ${db.t('enrollments')} WHERE employee_id = ? AND status IN ('assigned','in_progress')`, [emp.id]),
        count(`SELECT COUNT(*) AS c FROM ${db.t('hr_requests')} WHERE employee_id = ? AND status IN ('pending','in_progress')`, [emp.id]),
        rows(`SELECT r.net, p.title, r.id FROM ${db.t('payroll_runs')} r LEFT JOIN ${db.t('payroll_periods')} p ON p.id = r.period_id WHERE r.employee_id = ? ORDER BY r.id DESC LIMIT 1`, [emp.id]),
      ]);
      data.kpis = [
        { label: 'مانده مرخصی (روز)', value: Math.max(0, Math.round(balance)), icon: 'calendar', color: 'primary', url: '/self/leaves' },
        { label: 'دوره‌های آموزشی من', value: courses, icon: 'book', color: 'info', url: '/self/trainings' },
        { label: 'درخواست‌های من', value: requests, icon: 'inbox', color: 'warning', url: '/requests' },
        { label: 'خالص آخرین حقوق', value: lastPay[0] ? helpers.formatNumber(lastPay[0].net) : 0, icon: 'wallet', color: 'success', url: '/self/payslips', money: true },
      ];
      data.quick = [
        { label: 'ثبت درخواست مرخصی', url: '/self/leaves/new', icon: 'calendar-plus' },
        { label: 'مشاهده فیش حقوقی', url: '/self/payslips', icon: 'receipt' },
        { label: 'دوره‌های آموزشی', url: '/self/trainings', icon: 'book' },
        { label: 'درخواست پرسنلی', url: '/requests/new', icon: 'inbox' },
        { label: 'سرویس ایاب و ذهاب', url: '/self/transport', icon: 'truck' },
        { label: 'رزرو غذا', url: '/self/meals', icon: 'utensils' },
      ];
    }
    data.lists.push({
      title: 'اطلاعیه‌های اخیر', icon: 'megaphone', url: '/announcements',
      columns: ['عنوان', 'تاریخ'],
      items: (await rows(
        `SELECT id, title, publish_at, created_at FROM ${db.t('announcements')} WHERE status='published' ORDER BY is_pinned DESC, id DESC LIMIT 5`
      )).map((r) => ({ url: `/announcements/${r.id}/edit`, cells: [r.title, jalali.formatJalaali(r.publish_at || r.created_at)] })),
    });
  }

  if (isHr(user)) {
    // فقط میان‌برهایی که کاربر مجوز آن‌ها را دارد نمایش داده می‌شود
    data.quick = [
      { label: 'دعوت داوطلب (QR)', url: '/recruitment/invites/new', icon: 'user-plus', perm: 'recruitment.invite.manage' },
      { label: 'کارمند جدید', url: '/employees/new', icon: 'user', perm: 'employees.create' },
      { label: 'محاسبه حقوق', url: '/payroll/periods', icon: 'calculator', perm: 'payroll.view' },
      { label: 'گزارش‌ها', url: '/reports', icon: 'chart', perm: 'reports.view' },
      { label: 'تنظیمات', url: '/settings', icon: 'settings', perm: 'core.settings.manage' },
      { label: 'کاربران', url: '/users', icon: 'shield', perm: 'core.users.manage' },
    ].filter((q) => authService.can(user, q.perm));
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* مسیرها                                                             */
/* ------------------------------------------------------------------ */
router.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.redirect('/dashboard');
});

router.get('/dashboard', mw.requireAuth(), async (req, res, next) => {
  try {
    const data = await dashboardData(req.user);
    res.render('dashboard', { title: 'داشبورد', data, payroll: null });
  } catch (err) { next(err); }
});

router.get('/dashboard/payroll', mw.requireAuth(), mw.requirePerm('payroll.view'), async (req, res, next) => {
  try {
    const current = await db.get(`SELECT * FROM ${db.t('payroll_periods')} ORDER BY id DESC LIMIT 1`);
    res.render('dashboard-payroll', { title: 'داشبورد حقوق و دستمزد', period: current });
  } catch (err) { next(err); }
});

/* --------------------------- جست‌وجوی سراسری --------------------------- */
router.get('/search', mw.requireAuth(), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.jsonOk({ results: [], items: [] });
  const like = `%${q}%`;
  const out = [];
  const push = (type, icon, title, sub, url) => out.push({ type, icon, title, sub, url });
  const canSee = (perm) => authService.can(req.user, perm);

  if (canSee('employees.view')) {
    const list = await rows(`SELECT id, full_name, personnel_code, mobile FROM ${db.t('employees')} WHERE deleted_at IS NULL AND (full_name LIKE ? OR personnel_code LIKE ? OR mobile LIKE ? OR national_id LIKE ?) LIMIT 6`, [like, like, like, like]);
    list.forEach((e) => push('کارمند', 'user', e.full_name, `کد پرسنلی: ${helpers.pnum(e.personnel_code || '—')}`, `/employees/${e.id}`));
  }
  if (canSee('recruitment.view')) {
    const list = await rows(`SELECT id, full_name, mobile, code FROM ${db.t('applications')} WHERE deleted_at IS NULL AND (full_name LIKE ? OR mobile LIKE ? OR national_id LIKE ? OR code LIKE ?) LIMIT 6`, [like, like, like, like]);
    list.forEach((a) => push('داوطلب', 'user-plus', a.full_name, `موبایل: ${helpers.pnum(a.mobile)}`, `/recruitment/applications/${a.id}`));
  }
  if (canSee('assets.view')) {
    const list = await rows(`SELECT id, title, code, serial FROM ${db.t('assets')} WHERE deleted_at IS NULL AND (title LIKE ? OR code LIKE ? OR serial LIKE ?) LIMIT 4`, [like, like, like]);
    list.forEach((a) => push('مال', 'package', a.title, `کد: ${a.code || '—'}`, `/assets/${a.id}`));
  }
  if (canSee('licensing.view')) {
    const list = await rows(`SELECT id, title, number FROM ${db.t('licenses')} WHERE deleted_at IS NULL AND (title LIKE ? OR number LIKE ?) LIMIT 4`, [like, like]);
    list.forEach((l) => push('مجوز', 'certificate', l.title, `شماره: ${helpers.pnum(l.number || '—')}`, `/licensing/list/${l.id}`));
  }
  if (canSee('requests.view')) {
    const list = await rows(`SELECT r.id, r.subject, e.full_name FROM ${db.t('hr_requests')} r LEFT JOIN ${db.t('employees')} e ON e.id = r.employee_id WHERE r.subject LIKE ? LIMIT 4`, [like]);
    list.forEach((r) => push('درخواست', 'inbox', r.subject, r.full_name || '', `/requests/${r.id}`));
  }
  res.jsonOk({ results: out, items: out });
});

/* -------------------------------- تنظیمات -------------------------------- */
router.get('/settings', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    const inventory = await modulesService.inventory();
    const stats = {
      employees: await count(`SELECT COUNT(*) AS c FROM ${db.t('employees')} WHERE deleted_at IS NULL`),
      users: await count(`SELECT COUNT(*) AS c FROM ${db.t('users')} WHERE deleted_at IS NULL`),
      applications: await count(`SELECT COUNT(*) AS c FROM ${db.t('applications')} WHERE deleted_at IS NULL`),
      audit: await count(`SELECT COUNT(*) AS c FROM ${db.t('audit_logs')}`),
      tables: (await db.query(db.isMysql()
        ? 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
        : "SELECT name FROM sqlite_master WHERE type='table'")).length,
    };
    res.render('settings/index', { title: 'تنظیمات سامانه', inventory, stats, cfg: config.load(), dbInfo: { driver: config.db.driver, database: config.db.driver === 'mysql' ? config.db.database : config.db.sqliteFile, prefix: db.prefix() } });
  } catch (err) { next(err); }
});

router.get('/settings/general', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    res.render('settings/general', { title: 'تنظیمات عمومی', all: await settings.loadAll(true), cfg: config.load() });
  } catch (err) { next(err); }
});

router.post('/settings/general', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    const appKeys = ['app.name', 'app.tagline', 'app.primary_color', 'app.footer_text', 'app.login_notice', 'app.allow_employee_otp_login', 'recruitment.require_mbti_by_default', 'recruitment.invite_ttl_days', 'assessment.hide_result_from_candidate', 'payroll.overtime_rate', 'payroll.holiday_overtime_rate', 'payroll.night_rate', 'attendance.work_hours_per_day', 'transport.require_approval', 'kitchen.require_reservation'];
    const payload = {};
    for (const key of appKeys) {
      if (req.body[key.replace(/\./g, '_')] !== undefined) payload[key] = String(req.body[key.replace(/\./g, '_')] === 'on' ? '1' : req.body[key.replace(/\./g, '_')]);
    }
    // چک‌باکس‌های خاموش
    for (const key of appKeys) {
      const name = key.replace(/\./g, '_');
      if (!req.body[name] && !['app.name', 'app.tagline', 'app.primary_color'].includes(key)) payload[key] = '0';
    }
    await settings.setMany(payload, req.user.id);
    // اطلاعات شرکت در storage/config.json
    const cfg = config.load();
    cfg.company = {
      ...(cfg.company || {}),
      name: req.body.company_name || '',
      legalName: req.body.company_legal_name || '',
      nationalId: req.body.company_national_id || '',
      registrationNo: req.body.company_registration_no || '',
      economicCode: req.body.company_economic_code || '',
      knowledgeBased: req.body.company_knowledge_based === 'on',
      address: req.body.company_address || '',
      phone: req.body.company_phone || '',
      email: req.body.company_email || '',
    };
    config.save(cfg);
    await audit.log(req, { action: 'update', module: 'core', entity: 'settings', title: 'ویرایش تنظیمات عمومی' });
    req.setFlash('success', 'تنظیمات ذخیره شد.');
    res.redirect('/settings/general');
  } catch (err) { next(err); }
});

router.get('/settings/modules', mw.requireAuth(), mw.requirePerm('core.modules.manage'), async (req, res, next) => {
  try {
    const inventory = await modulesService.inventory();
    const grouped = {};
    inventory.forEach((m) => { (grouped[m.category] = grouped[m.category] || []).push(m); });
    res.render('settings/modules', { title: 'مدیریت ماژول‌ها', grouped, inventory });
  } catch (err) { next(err); }
});

router.post('/settings/modules/:key/toggle', mw.requireAuth(), mw.requirePerm('core.modules.manage'), async (req, res, next) => {
  try {
    const key = req.params.key;
    const raw = req.body.enabled;
    const want = raw === true || raw === 1 || ['1', 'true', 'on', 'yes'].includes(String(raw).toLowerCase());
    const result = await modulesService.setEnabled(key, want, req.user, req.ip);
    if (!result.ok) return res.jsonErr(result.error);
    await audit.log(req, { action: want ? 'enable' : 'disable', module: 'core', entity: 'modules', title: `ماژول ${key}` });
    res.jsonOk({ message: want ? 'ماژول فعال شد.' : 'ماژول غیرفعال شد.', enabled: want });
  } catch (err) { next(err); }
});

router.get('/settings/sms', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    res.render('settings/sms', {
      title: 'تنظیمات پیامک و اطلاع‌رسانی',
      cfg: config.load(),
      smsStatus: await smsService.status(),
      logs: await rows(`SELECT * FROM ${db.t('sms_logs')} ORDER BY id DESC LIMIT 20`),
    });
  } catch (err) { next(err); }
});

router.post('/settings/sms', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    const cfg = config.load();
    cfg.sms = {
      enabled: req.body.enabled === 'on',
      apiKey: req.body.api_key || '',
      username: req.body.username || '',
      password: req.body.password ? security.encrypt(req.body.password) : (cfg.sms && cfg.sms.password) || '',
      sender: req.body.sender || '',
      otpPattern: req.body.otp_pattern || '',
      baseUrl: req.body.base_url || smsService.BASE_URL_DEFAULT,
      otpLength: Number(req.body.otp_length) || 5,
      otpTtl: Number(req.body.otp_ttl) || 120,
      resendSeconds: Number(req.body.resend_seconds) || 60,
    };
    config.save(cfg);
    await audit.log(req, { action: 'update', module: 'core', entity: 'settings', title: 'تنظیمات پیامک' });
    req.setFlash('success', 'تنظیمات پیامک ذخیره شد.');
    res.redirect('/settings/sms');
  } catch (err) { next(err); }
});

router.post('/settings/sms/test', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res) => {
  const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
  if (!/^09\d{9}$/.test(mobile)) return res.jsonErr('شماره موبایل معتبر نیست.');
  const result = await smsService.test(mobile);
  if (!result.ok) return res.jsonErr(result.error || 'ارسال ناموفق بود.');
  res.jsonOk({ message: 'پیامک آزمایشی ارسال شد.' });
});

router.get('/settings/backup', mw.requireAuth(), mw.requirePerm('core.backup.manage'), async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(config.STORAGE_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(dir).map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, at: st.mtime };
    }).sort((a, b) => b.at - a.at);
    res.render('settings/backup', { title: 'پشتیبان‌گیری و بازیابی', files, sqlDir: require('../db/migrator').SQL_DIR });
  } catch (err) { next(err); }
});

router.post('/settings/backup/sql', mw.requireAuth(), mw.requirePerm('core.backup.manage'), async (req, res, next) => {
  try {
    const migrator = require('../db/migrator');
    const out = migrator.writeSqlFiles();
    await audit.log(req, { action: 'export', module: 'core', entity: 'backup', title: 'تولید فایل SQL ساختار' });
    res.jsonOk({ message: `فایل‌های SQL ساخته شد (${helpers.pnum(out.mysql + out.sqlite)} دستور).`, dir: out.dir });
  } catch (err) { next(err); }
});

/** ساخت فایل پشتیبان (SQL یا فایل کامل SQLite) */
async function createBackup() {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(config.STORAGE_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = db.nowSql().replace(/[-: ]/g, '').slice(0, 14);
  if (db.isMysql && db.isMysql()) {
    const tables = await db.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    const lines = [`-- پشتیبان پایگاه‌داده ${config.db.database} — ${db.nowSql()}`, 'SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS=0;'];
    for (const t of tables) {
      const rows = await db.query(`SELECT * FROM ${t.name}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return "'" + String(v).split("\\").join("\\\\").split("'").join("\\'") + "'";
        });
        lines.push(`INSERT INTO ${t.name} (${cols.join(',')}) VALUES (${vals.join(',')});`);
      }
    }
    lines.push('SET FOREIGN_KEY_CHECKS=1;');
    const file = path.join(dir, `backup-${stamp}.sql`);
    fs.writeFileSync(file, '\ufeff' + lines.join('\n'), 'utf8');
    return path.basename(file);
  }
  const src = config.db.sqliteFile;
  const file = path.join(dir, `backup-${stamp}.sqlite`);
  // ابتدا داده‌های WAL را در فایل اصلی بنشان تا پشتیبان کامل باشد
  try { await db.run('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
  fs.copyFileSync(src, file);
  return path.basename(file);
}

router.post('/settings/backup', mw.requireAuth(), mw.requirePerm('core.backup.manage'), async (req, res, next) => {
  try {
    const name = await createBackup();
    await audit.log(req, { action: 'create', module: 'core', entity: 'backup', title: `ساخت پشتیبان ${name}` });
    req.setFlash('success', 'پشتیبان با موفقیت ساخته شد.');
    res.redirect('/settings/backup');
  } catch (err) { req.setFlash('error', 'ساخت پشتیبان ناموفق بود: ' + err.message); res.redirect('/settings/backup'); }
});

router.get('/settings/backup/download/:name', mw.requireAuth(), mw.requirePerm('core.backup.manage'), async (req, res, next) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const name = path.basename(String(req.params.name));
    const file = path.join(config.STORAGE_DIR, 'backups', name);
    if (!fs.existsSync(file)) return res.status(404).render('errors/404', { title: 'فایل پشتیبان یافت نشد' });
    await audit.log(req, { action: 'export', module: 'core', entity: 'backup', title: `دانلود پشتیبان ${name}` });
    res.download(file, name);
  } catch (err) { next(err); }
});

router.post('/settings/backup/delete', mw.requireAuth(), mw.requirePerm('core.backup.manage'), async (req, res, next) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const name = path.basename(String(req.body.name || ''));
    if (name) fs.unlinkSync(path.join(config.STORAGE_DIR, 'backups', name));
    await audit.log(req, { action: 'delete', module: 'core', entity: 'backup', title: `حذف پشتیبان ${name}` });
    req.setFlash('success', 'فایل پشتیبان حذف شد.');
    res.redirect('/settings/backup');
  } catch (err) { req.setFlash('error', 'حذف ناموفق بود.'); res.redirect('/settings/backup'); }
});

router.post('/settings/backup/restore', mw.requireAuth(), mw.requirePerm('core.backup.manage'), (req, res, next) => {
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }).single('file');
  upload(req, res, async (err) => {
    if (err) { req.setFlash('error', 'بارگذاری فایل ناموفق بود: ' + err.message); return res.redirect('/settings/backup'); }
    if (!req.file) { req.setFlash('error', 'فایلی انتخاب نشده است.'); return res.redirect('/settings/backup'); }
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(config.STORAGE_DIR, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const safety = path.join(dir, `before-restore-${db.nowSql().replace(/[-: ]/g, '').slice(0, 14)}.bak`);
      const isSqliteBinary = !(db.isMysql && db.isMysql()) &&
        req.file.buffer.slice(0, 15).toString('utf8') === 'SQLite format 3';
      if (isSqliteBinary) {
        // بازیابی فایل پایگاه‌داده SQLite (خروجی همین سامانه)
        fs.copyFileSync(config.db.sqliteFile, safety);
        await db.close();
        for (const suffix of ['-wal', '-shm']) {
          try { fs.unlinkSync(config.db.sqliteFile + suffix); } catch (_) {}
        }
        fs.writeFileSync(config.db.sqliteFile, req.file.buffer);
        await db.connect();
        await audit.log(req, { action: 'restore', module: 'core', entity: 'backup', title: 'بازیابی پشتیبان SQLite (فایل کامل)' });
        req.setFlash('success', 'پایگاه‌داده از فایل پشتیبان بازیابی شد. پیش از بازیابی نیز یک پشتیبان احتیاطی ذخیره شد.');
        return res.redirect('/settings/backup');
      }
      if (!db.isMysql || !db.isMysql()) fs.copyFileSync(config.db.sqliteFile, safety);
      const text = req.file.buffer.toString('utf8').replace(/^\ufeff/, '');
      const statements = text.split(/;\s*\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('--'));
      let done = 0;
      for (const stmt of statements) { try { await db.run(stmt); done += 1; } catch (_) { /* ردیف‌های تکراری نادیده گرفته می‌شوند */ } }
      await audit.log(req, { action: 'restore', module: 'core', entity: 'backup', title: `بازیابی پشتیبان (${done} دستور)` });
      req.setFlash('success', `بازیابی انجام شد (${helpers.pnum(done)} دستور اجرا شد). پیش از بازیابی نیز یک پشتیبان احتیاطی ذخیره شد.`);
      res.redirect('/settings/backup');
    } catch (e) {
      req.setFlash('error', 'بازیابی ناموفق بود: ' + e.message);
      res.redirect('/settings/backup');
    }
  });
});

router.get('/settings/backup/cron', async (req, res) => {
  try {
    const token = await reminders.cronToken();
    if (!token || String(req.query.token || '') !== String(token)) return res.status(403).json({ ok: false, error: 'دسترسی غیرمجاز' });
    const name = await createBackup();
    res.jsonOk({ message: 'پشتیبان ساخته شد.', file: name });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/* ------------------------------ یادآورها ------------------------------ */
const reminders = require('../lib/reminders');

router.get('/settings/reminders', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    const items = await reminders.inspect();
    const token = await reminders.cronToken();
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    res.render('settings/reminders', { title: 'یادآورها و سررسیدها', items, cronToken: token, base: `${proto}://${host}` });
  } catch (err) { next(err); }
});

router.post('/settings/reminders/run', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    const report = await reminders.run();
    const total = report.items.reduce((sum, i) => sum + i.notified, 0);
    await audit.log(req, { action: 'send', module: 'core', entity: 'reminders', title: `اجرای یادآورها (${helpers.pnum(total)} اعلان)`, meta: report });
    req.setFlash('success', report.items.length
      ? `بررسی سررسیدها انجام شد؛ ${helpers.pnum(report.items.length)} دسته یادآور و ${helpers.pnum(total)} اعلان ساخته شد.`
      : 'همه‌چیز مرتب است؛ موردی برای یادآوری یافت نشد.');
    res.redirect('/settings/reminders');
  } catch (err) { next(err); }
});

router.post('/settings/reminders/cron/rotate', mw.requireAuth(), mw.requirePerm('core.settings.manage'), async (req, res, next) => {
  try {
    await reminders.cronToken(true);
    await audit.log(req, { action: 'update', module: 'core', entity: 'settings', title: 'تولید کلید امنیتی جدید کرون' });
    req.setFlash('success', 'کلید امنیتی کرون بازتولید شد. آدرس جدید را در cPanel به‌روزرسانی کنید.');
    res.redirect('/settings/reminders');
  } catch (err) { next(err); }
});

router.get('/settings/reminders/cron', async (req, res) => {
  try {
    const token = await reminders.cronToken();
    if (!token || String(req.query.token || '') !== String(token)) return res.status(403).json({ ok: false, error: 'دسترسی غیرمجاز' });
    const report = await reminders.run();
    res.jsonOk({ message: 'یادآورها بررسی شد.', report });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/settings/audit', mw.requireAuth(), mw.requirePerm('core.audit.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 50;
    const where = ['1 = 1'];
    const params = [];
    if (req.query.q) { where.push('(title LIKE ? OR entity LIKE ? OR user_name LIKE ?)'); const like = `%${req.query.q}%`; params.push(like, like, like); }
    if (req.query.module) { where.push('module = ?'); params.push(req.query.module); }
    const total = await count(`SELECT COUNT(*) AS c FROM ${db.t('audit_logs')} WHERE ${where.join(' AND ')}`, params);
    const list = await rows(
      `SELECT * FROM ${db.t('audit_logs')} WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      params
    );
    res.render('settings/audit', { title: 'لاگ عملیات', list, meta: helpers.paginationMeta(total, page, perPage) });
  } catch (err) { next(err); }
});

/* -------------------------------- کاربران -------------------------------- */
router.get('/users', mw.requireAuth(), mw.requirePerm('core.users.manage'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 20;
    const where = ['u.deleted_at IS NULL'];
    const params = [];
    if (req.query.q) { where.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.mobile LIKE ?)'); const like = `%${req.query.q}%`; params.push(like, like, like); }
    if (req.query.role) { where.push('u.role_id = ?'); params.push(Number(req.query.role)); }
    const total = await count(`SELECT COUNT(*) AS c FROM ${db.t('users')} u WHERE ${where.join(' AND ')}`, params);
    const list = await rows(
      `SELECT u.*, r.name AS role_name, r.rkey AS role_key, e.personnel_code,
              (SELECT COUNT(*) FROM ${db.t('sessions')} s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions
         FROM ${db.t('users')} u
         LEFT JOIN ${db.t('roles')} r ON r.id = u.role_id
         LEFT JOIN ${db.t('employees')} e ON e.id = u.employee_id
        WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      [db.nowSql(), ...params]
    );
    res.render('users/index', { title: 'کاربران سامانه', list, meta: helpers.paginationMeta(total, page, perPage), roles: await authService.listRoles() });
  } catch (err) { next(err); }
});

router.get('/users/new', mw.requireAuth(), mw.requirePerm('core.users.manage'), async (req, res, next) => {
  try {
    res.render('users/form', {
      title: 'افزودن کاربر', row: {}, isNew: true,
      roles: await authService.listRoles(),
      employees: await rows(`SELECT id, full_name, personnel_code FROM ${db.t('employees')} WHERE deleted_at IS NULL AND (user_id IS NULL OR user_id = 0) ORDER BY full_name`),
      errors: {},
    });
  } catch (err) { next(err); }
});

function validateUser(body, isNew) {
  const errors = {};
  const username = String(body.username || '').trim().toLowerCase();
  const fullName = String(body.full_name || '').trim();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) errors.username = 'نام کاربری باید ۳ تا ۴۰ کاراکتر لاتین (حروف کوچک، عدد، نقطه، خط تیره) باشد.';
  if (!fullName) errors.full_name = 'نام و نام خانوادگی الزامی است.';
  if (body.mobile && !/^09\d{9}$/.test(jalali.toLatinDigits(String(body.mobile)))) errors.mobile = 'شماره موبایل معتبر نیست.';
  if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) errors.email = 'قالب ایمیل صحیح نیست.';
  if (isNew) {
    const pw = String(body.password || '');
    if (pw.length < 8) errors.password = 'گذرواژه باید حداقل ۸ کاراکتر باشد.';
    if (pw !== String(body.password2 || '')) errors.password2 = 'تکرار گذرواژه مطابقت ندارد.';
  }
  return { errors, username, fullName };
}

router.post('/users', mw.requireAuth(), mw.requirePerm('core.users.manage'), async (req, res, next) => {
  try {
    const { errors, username, fullName } = validateUser(req.body, true);
    const dup = await db.get(`SELECT id FROM ${db.t('users')} WHERE username = ?`, [username]);
    if (dup) errors.username = 'این نام کاربری قبلاً ثبت شده است.';
    if (Object.keys(errors).length) {
      return res.status(422).render('users/form', {
        title: 'افزودن کاربر', row: req.body, isNew: true, errors,
        roles: await authService.listRoles(),
        employees: await rows(`SELECT id, full_name, personnel_code FROM ${db.t('employees')} WHERE deleted_at IS NULL ORDER BY full_name`),
      });
    }
    const id = await db.insert('users', {
      username,
      password_hash: security.hashPassword(String(req.body.password)),
      full_name: fullName,
      email: req.body.email || null,
      mobile: req.body.mobile ? jalali.toLatinDigits(String(req.body.mobile)) : null,
      role_id: Number(req.body.role_id) || null,
      employee_id: Number(req.body.employee_id) || null,
      status: req.body.status || 'active',
      must_change_password: req.body.must_change_password ? 1 : 0,
      created_at: db.nowSql(),
    });
    if (req.body.employee_id) await db.run(`UPDATE ${db.t('employees')} SET user_id = ? WHERE id = ?`, [id, Number(req.body.employee_id)]);
    await audit.log(req, { action: 'create', module: 'core', entity: 'users', entityId: id, title: `ایجاد کاربر ${username}` });
    req.setFlash('success', 'کاربر ایجاد شد.');
    res.redirect('/users');
  } catch (err) { next(err); }
});

router.get('/users/:id/edit', mw.requireAuth(), mw.requirePerm('core.users.manage'), async (req, res, next) => {
  try {
    const row = await db.get(`SELECT * FROM ${db.t('users')} WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!row) return res.status(404).render('errors/404', { title: 'کاربر یافت نشد' });
    res.render('users/form', {
      title: `ویرایش کاربر ${row.username}`, row, isNew: false, errors: {},
      roles: await authService.listRoles(),
      employees: await rows(`SELECT id, full_name, personnel_code FROM ${db.t('employees')} WHERE deleted_at IS NULL ORDER BY full_name`),
      sessions: await rows(`SELECT * FROM ${db.t('sessions')} WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 10`, [row.id]),
      logins: await rows(`SELECT * FROM ${db.t('login_logs')} WHERE user_id = ? ORDER BY id DESC LIMIT 10`, [row.id]),
    });
  } catch (err) { next(err); }
});

router.post('/users/:id', mw.requireAuth(), mw.requirePerm('core.users.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await db.get(`SELECT * FROM ${db.t('users')} WHERE id = ?`, [id]);
    if (!row) return res.status(404).render('errors/404', { title: 'کاربر یافت نشد' });
    const { errors, username, fullName } = validateUser(req.body, false);
    const dup = await db.get(`SELECT id FROM ${db.t('users')} WHERE username = ? AND id <> ?`, [username, id]);
    if (dup) errors.username = 'این نام کاربری برای کاربر دیگری ثبت شده است.';
    if (Object.keys(errors).length) {
      return res.status(422).render('users/form', {
        title: 'ویرایش کاربر', row: { ...row, ...req.body }, isNew: false, errors,
        roles: await authService.listRoles(),
        employees: await rows(`SELECT id, full_name, personnel_code FROM ${db.t('employees')} WHERE deleted_at IS NULL ORDER BY full_name`),
        sessions: [], logins: [],
      });
    }
    const data = {
      username, full_name: fullName,
      email: req.body.email || null,
      mobile: req.body.mobile ? jalali.toLatinDigits(String(req.body.mobile)) : null,
      role_id: Number(req.body.role_id) || null,
      employee_id: Number(req.body.employee_id) || null,
      status: req.body.status || 'active',
      updated_at: db.nowSql(),
    };
    if (String(req.body.password || '').length >= 8) {
      data.password_hash = security.hashPassword(String(req.body.password));
      data.password_changed_at = db.nowSql();
      data.must_change_password = req.body.must_change_password ? 1 : 0;
    }
    await db.update('users', data, 'id = ?', [id]);
    await audit.log(req, { action: 'update', module: 'core', entity: 'users', entityId: id, title: `ویرایش کاربر ${username}` });
    req.setFlash('success', 'تغییرات ذخیره شد.');
    res.redirect(`/users/${id}/edit`);
  } catch (err) { next(err); }
});

router.post('/users/:id/toggle', mw.requireAuth(), mw.requirePerm('core.users.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.jsonErr('نمی‌توانید حساب خودتان را غیرفعال کنید.');
    const row = await db.get(`SELECT status, is_superadmin FROM ${db.t('users')} WHERE id = ?`, [id]);
    if (!row) return res.jsonErr('کاربر یافت نشد.', 404);
    const next_ = row.status === 'active' ? 'inactive' : 'active';
    await db.run(`UPDATE ${db.t('users')} SET status = ?, updated_at = ? WHERE id = ?`, [next_, db.nowSql(), id]);
    if (next_ === 'inactive') await authService.destroyAllSessions(id);
    await audit.log(req, { action: 'update', module: 'core', entity: 'users', entityId: id, title: `تغییر وضعیت کاربر به ${next_}` });
    res.jsonOk({ message: next_ === 'active' ? 'کاربر فعال شد.' : 'کاربر غیرفعال شد.', status: next_ });
  } catch (err) { next(err); }
});

router.post('/users/:id/reset-password', mw.requireAuth(), mw.requirePerm('core.users.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await db.get(`SELECT username FROM ${db.t('users')} WHERE id = ?`, [id]);
    if (!row) return res.jsonErr('کاربر یافت نشد.', 404);
    const temp = security.randomToken(6).replace(/[^a-zA-Z0-9]/g, '') + Math.floor(10 + Math.random() * 89);
    await db.run(`UPDATE ${db.t('users')} SET password_hash = ?, must_change_password = 1, password_changed_at = ? WHERE id = ?`,
      [security.hashPassword(temp), db.nowSql(), id]);
    await authService.destroyAllSessions(id);
    await audit.log(req, { action: 'update', module: 'core', entity: 'users', entityId: id, title: 'بازنشانی گذرواژه توسط مدیر' });
    res.jsonOk({ message: 'گذرواژه موقت ساخته شد.', password: temp });
  } catch (err) { next(err); }
});

/* --------------------------------- نقش‌ها --------------------------------- */
router.get('/roles', mw.requireAuth(), mw.requirePerm('core.roles.manage'), async (req, res, next) => {
  try {
    const roles = await rows(
      `SELECT r.*, (SELECT COUNT(*) FROM ${db.t('role_permissions')} rp WHERE rp.role_id = r.id) AS perms_count,
              (SELECT COUNT(*) FROM ${db.t('users')} u WHERE u.role_id = r.id AND u.deleted_at IS NULL) AS users_count
         FROM ${db.t('roles')} r ORDER BY r.sort_order`
    );
    res.render('roles/index', { title: 'نقش‌ها و سطوح دسترسی', roles });
  } catch (err) { next(err); }
});

router.post('/roles', mw.requireAuth(), mw.requirePerm('core.roles.manage'), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const rkey = String(req.body.rkey || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (!name || !rkey) {
      req.setFlash('danger', 'نام و کلید نقش الزامی است.');
      return res.redirect('/roles');
    }
    const dup = await db.get(`SELECT id FROM ${db.t('roles')} WHERE rkey = ? OR name = ?`, [rkey, name]);
    if (dup) {
      req.setFlash('danger', 'نقشی با این نام یا کلید از قبل وجود دارد.');
      return res.redirect('/roles');
    }
    const maxSort = await db.get(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${db.t('roles')}`);
    const id = await db.insert('roles', {
      name, rkey,
      description: String(req.body.description || '').trim() || null,
      is_system: 0, is_locked: 0, status: 'active',
      sort_order: Number(maxSort ? maxSort.m : 0) + 1,
      created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'core', entity: 'roles', entityId: id, title: `ایجاد نقش ${name}` });
    req.setFlash('success', 'نقش جدید ساخته شد؛ اکنون سطح دسترسی آن را تعیین کنید.');
    res.redirect(`/roles/${id}`);
  } catch (err) { next(err); }
});

router.get('/roles/:id', mw.requireAuth(), mw.requirePerm('core.roles.manage'), async (req, res, next) => {
  try {
    const role = await db.get(`SELECT * FROM ${db.t('roles')} WHERE id = ?`, [req.params.id]);
    if (!role) return res.status(404).render('errors/404', { title: 'نقش یافت نشد' });
    const granted = new Set((await db.query(`SELECT pkey FROM ${db.t('role_permissions')} rp JOIN ${db.t('permissions')} p ON p.id = rp.permission_id WHERE rp.role_id = ?`, [role.id])).map((r) => r.pkey));
    const grouped = {};
    registry.allPermissions().forEach((p) => {
      grouped[p.groupName] = grouped[p.groupName] || [];
      grouped[p.groupName].push({ ...p, granted: granted.has(p.key) });
    });
    res.render('roles/detail', {
      title: `نقش ${role.name}`, role, grouped,
      users: await rows(`SELECT id, full_name, username, status FROM ${db.t('users')} WHERE role_id = ? AND deleted_at IS NULL`, [role.id]),
    });
  } catch (err) { next(err); }
});

router.post('/roles/:id', mw.requireAuth(), mw.requirePerm('core.roles.manage'), async (req, res, next) => {
  try {
    const role = await db.get(`SELECT * FROM ${db.t('roles')} WHERE id = ?`, [req.params.id]);
    if (!role) return res.status(404).render('errors/404', { title: 'نقش یافت نشد' });
    if (role.is_locked && !req.user.is_superadmin) {
      req.setFlash('error', 'نقش‌های سیستمی فقط توسط مدیر سامانه قابل تغییر هستند.');
      return res.redirect(`/roles/${role.id}`);
    }
    const wanted = new Set([].concat(req.body.perms || []));
    const perms = await db.query(`SELECT id, pkey FROM ${db.t('permissions')}`);
    const current = await db.query(`SELECT permission_id FROM ${db.t('role_permissions')} WHERE role_id = ?`, [role.id]);
    const currentSet = new Set(current.map((r) => Number(r.permission_id)));
    for (const p of perms) {
      const should = wanted.has(p.pkey);
      const has = currentSet.has(Number(p.id));
      if (should && !has) await db.run(`INSERT INTO ${db.t('role_permissions')} (role_id, permission_id) VALUES (?,?)`, [role.id, p.id]);
      if (!should && has) await db.run(`DELETE FROM ${db.t('role_permissions')} WHERE role_id = ? AND permission_id = ?`, [role.id, p.id]);
    }
    await db.run(`UPDATE ${db.t('roles')} SET name = ?, description = ?, scope = ?, updated_at = ? WHERE id = ?`,
      [req.body.name || role.name, req.body.description || role.description, req.body.scope || role.scope, db.nowSql(), role.id]);
    await audit.log(req, { action: 'update', module: 'core', entity: 'roles', entityId: role.id, title: `ویرایش دسترسی‌های نقش ${role.name}` });
    req.setFlash('success', 'دسترسی‌های نقش ذخیره شد.');
    res.redirect(`/roles/${role.id}`);
  } catch (err) { next(err); }
});

/* --------------------------------- گزارش‌ها --------------------------------- */
router.get('/reports', mw.requireAuth(), mw.requirePerm('reports.view'), async (req, res, next) => {
  try {
    const [byDept, byStatus, byType, payrollTrend] = await Promise.all([
      rows(`SELECT d.name, (SELECT COUNT(*) FROM ${db.t('employees')} e WHERE e.department_id = d.id AND e.deleted_at IS NULL) AS c
              FROM ${db.t('departments')} d WHERE d.deleted_at IS NULL ORDER BY c DESC LIMIT 12`),
      rows(`SELECT status, COUNT(*) AS c FROM ${db.t('employees')} WHERE deleted_at IS NULL GROUP BY status`),
      rows(`SELECT employment_type AS t, COUNT(*) AS c FROM ${db.t('employees')} WHERE deleted_at IS NULL GROUP BY employment_type`),
      rows(`SELECT p.title, p.total_net, p.employee_count FROM ${db.t('payroll_periods')} p ORDER BY p.year DESC, p.month DESC LIMIT 12`),
    ]);
    res.render('reports/index', { title: 'گزارش‌ها و تحلیل', byDept, byStatus, byType, payrollTrend });
  } catch (err) { next(err); }
});

router.get('/reports/hr', mw.requireAuth(), mw.requirePerm('reports.hr'), async (req, res, next) => {
  try {
    const [headcount, hires, leaves, turnover] = await Promise.all([
      count(`SELECT COUNT(*) AS c FROM ${db.t('employees')} WHERE deleted_at IS NULL AND status='active'`),
      rows(`SELECT h.hire_date, e.full_name FROM ${db.t('employees')} e JOIN (SELECT id, hire_date FROM ${db.t('employees')}) h ON h.id = e.id WHERE e.hire_date IS NOT NULL ORDER BY e.hire_date DESC LIMIT 10`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('leave_requests')} WHERE status='approved'`),
      count(`SELECT COUNT(*) AS c FROM ${db.t('offboarding_requests')} WHERE status='completed'`),
    ]);
    res.render('reports/hr', { title: 'گزارش منابع انسانی', headcount, hires, leaves, turnover });
  } catch (err) { next(err); }
});

router.get('/reports/recruitment', mw.requireAuth(), mw.requirePerm('reports.recruitment'), async (req, res, next) => {
  try {
    const [byStage, byJob, sources, mbti] = await Promise.all([
      rows(`SELECT s.name, (SELECT COUNT(*) FROM ${db.t('applications')} a WHERE a.stage_key = s.key AND a.deleted_at IS NULL) AS c FROM ${db.t('recruitment_stages')} s ORDER BY s.sort_order`),
      rows(`SELECT j.title, (SELECT COUNT(*) FROM ${db.t('applications')} a WHERE a.job_req_id = j.id AND a.deleted_at IS NULL) AS c FROM ${db.t('job_reqs')} j WHERE j.deleted_at IS NULL ORDER BY c DESC LIMIT 10`),
      rows(`SELECT COALESCE(source,'نامشخص') AS s, COUNT(*) AS c FROM ${db.t('applications')} WHERE deleted_at IS NULL GROUP BY source`),
      rows(`SELECT r.type_code, COUNT(*) AS c FROM ${db.t('assessment_results')} r GROUP BY r.type_code ORDER BY c DESC`),
    ]);
    res.render('reports/recruitment', { title: 'گزارش جذب و استخدام', byStage, byJob, sources, mbti });
  } catch (err) { next(err); }
});

router.get('/reports/payroll', mw.requireAuth(), mw.requirePerm('reports.payroll'), async (req, res, next) => {
  try {
    const periods = await rows(`SELECT * FROM ${db.t('payroll_periods')} ORDER BY year DESC, month DESC LIMIT 24`);
    res.render('reports/payroll', { title: 'گزارش حقوق و دستمزد', periods });
  } catch (err) { next(err); }
});

router.get('/reports/welfare', mw.requireAuth(), mw.requirePerm('reports.welfare'), async (req, res, next) => {
  try {
    const [meals, transport, facilities] = await Promise.all([
      rows(`SELECT meal_date, COUNT(*) AS c, SUM(count) AS portions FROM ${db.t('meal_reservations')} GROUP BY meal_date ORDER BY meal_date DESC LIMIT 14`),
      rows(`SELECT r.name, (SELECT COUNT(*) FROM ${db.t('transport_subscriptions')} s WHERE s.route_id = r.id AND s.status='active') AS c FROM ${db.t('transport_routes')} r WHERE r.deleted_at IS NULL ORDER BY c DESC`),
      rows(`SELECT f.name, (SELECT COUNT(*) FROM ${db.t('facility_bookings')} b WHERE b.facility_id = f.id) AS c FROM ${db.t('welfare_facilities')} f ORDER BY c DESC`),
    ]);
    res.render('reports/welfare', { title: 'گزارش رفاهیات', meals, transport, facilities });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* سلف‌سرویس کارمند                                                   */
/* ------------------------------------------------------------------ */
router.get('/self', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) {
      req.setFlash('info', 'حساب کاربری شما به پرونده پرسنلی متصل نیست. برای استفاده از سلف‌سرویس با منابع انسانی تماس بگیرید.');
      return res.redirect('/profile');
    }
    return res.redirect('/self/leaves');
  } catch (err) { next(err); }
});

router.get('/self/leaves', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) {
      req.setFlash('info', 'حساب کاربری شما به پرونده پرسنلی متصل نیست. برای استفاده از سلف‌سرویس با منابع انسانی تماس بگیرید.');
      return res.redirect('/dashboard');
    }
    const year = jalali.toJalaali(new Date()).jy;
    const [types, balances, requests] = await Promise.all([
      rows(`SELECT * FROM ${db.t('leave_types')} WHERE status='active' ORDER BY sort_order`),
      rows(`SELECT b.*, t.name AS type_name FROM ${db.t('leave_balances')} b JOIN ${db.t('leave_types')} t ON t.id = b.leave_type_id WHERE b.employee_id = ? AND b.year = ?`, [emp.id, year]),
      rows(`SELECT l.*, t.name AS type_name FROM ${db.t('leave_requests')} l JOIN ${db.t('leave_types')} t ON t.id = l.leave_type_id WHERE l.employee_id = ? ORDER BY l.id DESC LIMIT 20`, [emp.id]),
    ]);
    res.render('self/leaves', { title: 'مرخصی‌های من', employee: emp, types, balances, requests, year });
  } catch (err) { next(err); }
});

router.post('/self/leaves', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.jsonErr('پرونده پرسنلی یافت نشد.');
    const type = await db.get(`SELECT * FROM ${db.t('leave_types')} WHERE id = ?`, [Number(req.body.leave_type_id)]);
    if (!type) return res.jsonErr('نوع مرخصی را انتخاب کنید.');
    const from = req.body.from_date ? jalali.parseJalaali(req.body.from_date) : null;
    const to = req.body.to_date ? jalali.parseJalaali(req.body.to_date) : null;
    if (!from || !to) return res.jsonErr('تاریخ‌ها را وارد کنید.');
    if (to < from) return res.jsonErr('تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.');
    const days = jalali.diffDays(to, from) + 1;
    const id = await db.insert('leave_requests', {
      employee_id: emp.id, leave_type_id: type.id,
      from_date: db.nowSql(from).slice(0, 10), to_date: db.nowSql(to).slice(0, 10),
      days, hours: Number(req.body.hours) || null, is_hourly: type.hourly && req.body.is_hourly ? 1 : 0,
      reason: req.body.reason || '',
      status: type.requires_approval ? 'pending' : 'approved',
      address_during_leave: req.body.address || null,
      contact_during_leave: req.body.contact || null,
      created_by: req.user.id, created_at: db.nowSql(),
    });
    // افزایش مانده در انتظار
    const balance = await db.get(`SELECT * FROM ${db.t('leave_balances')} WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
      [emp.id, type.id, jalali.toJalaali(from).jy]);
    if (balance) await db.run(`UPDATE ${db.t('leave_balances')} SET pending = COALESCE(pending,0) + ?, updated_at = ? WHERE id = ?`, [days, db.nowSql(), balance.id]);
    await audit.log(req, { action: 'create', module: 'attendance', entity: 'leave_requests', entityId: id, title: `درخواست مرخصی ${type.name} (${helpers.pnum(days)} روز)` });
    await notifyHr(`درخواست مرخصی ${emp.full_name}`, `${type.name} از ${jalali.formatJalaali(from)} به مدت ${helpers.pnum(days)} روز`, '/attendance/leaves');
    req.setFlash('success', 'درخواست مرخصی ثبت شد و برای تأیید ارسال گردید.');
    res.redirect('/self/leaves');
  } catch (err) { next(err); }
});

router.get('/self/attendance', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.redirect('/dashboard');
    const list = await rows(`SELECT * FROM ${db.t('attendance_records')} WHERE employee_id = ? ORDER BY work_date DESC LIMIT 60`, [emp.id]);
    const summary = await db.get(
      `SELECT COALESCE(SUM(worked_minutes),0) AS worked, COALESCE(SUM(overtime_minutes),0) AS overtime, COALESCE(SUM(late_minutes),0) AS late
         FROM ${db.t('attendance_records')} WHERE employee_id = ?`, [emp.id]
    );
    res.render('self/attendance', { title: 'کارکرد من', list, summary, employee: emp });
  } catch (err) { next(err); }
});

router.get('/self/payslips', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.redirect('/dashboard');
    const list = await rows(
      `SELECT r.*, p.title AS period_title, p.year, p.month, s.number AS slip_number, s.verify_code, s.issued_at
         FROM ${db.t('payroll_runs')} r
         LEFT JOIN ${db.t('payroll_periods')} p ON p.id = r.period_id
         LEFT JOIN ${db.t('payslips')} s ON s.run_id = r.id AND s.deleted_at IS NULL
        WHERE r.employee_id = ? AND r.status <> 'draft' ORDER BY r.id DESC`, [emp.id]
    );
    res.render('self/payslips', { title: 'فیش‌های حقوقی من', list, employee: emp });
  } catch (err) { next(err); }
});

router.get('/self/payslips/:id', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    const run = await db.get(`SELECT * FROM ${db.t('payroll_runs')} WHERE id = ?`, [req.params.id]);
    if (!emp || !run || Number(run.employee_id) !== Number(emp.id)) return res.status(404).render('errors/404', { title: 'فیش یافت نشد' });
    const payroll = require('./payroll');
    return payroll.renderPayslip(req, res, run, { self: true });
  } catch (err) { next(err); }
});

router.get('/self/trainings', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.redirect('/dashboard');
    const list = await rows(
      `SELECT n.*, c.title, c.type, c.duration_hours, c.has_certificate FROM ${db.t('enrollments')} n
         JOIN ${db.t('courses')} c ON c.id = n.course_id WHERE n.employee_id = ? ORDER BY n.id DESC`, [emp.id]
    );
    res.render('self/trainings', { title: 'دوره‌های آموزشی من', list, employee: emp });
  } catch (err) { next(err); }
});

router.get('/self/transport', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.redirect('/dashboard');
    const [subs, routes] = await Promise.all([
      rows(`SELECT s.*, r.name AS route_name, st.title AS stop_title FROM ${db.t('transport_subscriptions')} s
              LEFT JOIN ${db.t('transport_routes')} r ON r.id = s.route_id
              LEFT JOIN ${db.t('transport_stops')} st ON st.id = s.stop_id
             WHERE s.employee_id = ? ORDER BY s.id DESC`, [emp.id]),
      rows(`SELECT r.*, (SELECT COUNT(*) FROM ${db.t('transport_subscriptions')} s WHERE s.route_id = r.id AND s.status='active') AS taken
              FROM ${db.t('transport_routes')} r WHERE r.deleted_at IS NULL AND r.status='active' ORDER BY r.name`),
    ]);
    res.render('self/transport', { title: 'سرویس ایاب و ذهاب من', subs, routes, employee: emp });
  } catch (err) { next(err); }
});

router.post('/self/transport', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.jsonErr('پرونده پرسنلی یافت نشد.');
    const route = await db.get(`SELECT * FROM ${db.t('transport_routes')} WHERE id = ?`, [Number(req.body.route_id)]);
    if (!route) return res.jsonErr('مسیر را انتخاب کنید.');
    const id = await db.insert('transport_subscriptions', {
      employee_id: emp.id, route_id: route.id, stop_id: Number(req.body.stop_id) || null,
      from_date: req.body.from_date ? db.nowSql(jalali.parseJalaali(req.body.from_date)).slice(0, 10) : null,
      to_date: null, direction: req.body.direction || route.direction || 'both',
      status: (await settings.getBool('transport.require_approval', true)) ? 'requested' : 'active',
      fee: route.monthly_fee || null, created_by: req.user.id, created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'transport', entity: 'transport_subscriptions', entityId: id, title: `درخواست سرویس ${route.name}` });
    await notifyHr(`درخواست سرویس ایاب و ذهاب`, `${emp.full_name} برای مسیر «${route.name}» درخواست ثبت کرد.`, '/transport/subscriptions');
    req.setFlash('success', 'درخواست سرویس ثبت شد.');
    res.redirect('/self/transport');
  } catch (err) { next(err); }
});

router.get('/self/meals', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.redirect('/dashboard');
    const [menus, mine] = await Promise.all([
      rows(`SELECT * FROM ${db.t('kitchen_menus')} WHERE menu_date >= ? AND status <> 'closed' ORDER BY menu_date LIMIT 14`, [db.nowSql().slice(0, 10)]),
      rows(`SELECT * FROM ${db.t('meal_reservations')} WHERE employee_id = ? AND meal_date >= ? ORDER BY meal_date`, [emp.id, db.nowSql().slice(0, 10)]),
    ]);
    res.render('self/meals', { title: 'رزرو غذا', menus, mine, employee: emp });
  } catch (err) { next(err); }
});

router.post('/self/meals', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.jsonErr('پرونده پرسنلی یافت نشد.');
    const menu = await db.get(`SELECT * FROM ${db.t('kitchen_menus')} WHERE id = ?`, [Number(req.body.menu_id)]);
    if (!menu) return res.jsonErr('منو یافت نشد.');
    const existing = await db.get(`SELECT id FROM ${db.t('meal_reservations')} WHERE menu_id = ? AND employee_id = ?`, [menu.id, emp.id]);
    if (existing) {
      await db.run(`UPDATE ${db.t('meal_reservations')} SET status = 'reserved', count = ?, guest_count = ? WHERE id = ?`,
        [Number(req.body.count) || 1, Number(req.body.guest_count) || 0, existing.id]);
    } else {
      await db.insert('meal_reservations', {
        menu_id: menu.id, employee_id: emp.id, meal_date: menu.menu_date, meal_type: menu.meal_type,
        count: Number(req.body.count) || 1, guest_count: Number(req.body.guest_count) || 0,
        status: 'reserved', reserved_at: db.nowSql(), created_by: req.user.id, created_at: db.nowSql(),
      });
      await db.run(`UPDATE ${db.t('kitchen_menus')} SET reserved_count = COALESCE(reserved_count,0) + 1 WHERE id = ?`, [menu.id]);
    }
    req.setFlash('success', 'رزرو غذا ثبت شد.');
    res.redirect('/self/meals');
  } catch (err) { next(err); }
});

router.get('/self/assessment', mw.requireAuth(), async (req, res, next) => {
  try {
    const emp = await myEmployee(req.user);
    if (!emp) return res.redirect('/dashboard');
    const list = await rows(
      `SELECT a.*, t.name AS test_name, t.duration_minutes, t.question_count FROM ${db.t('assessment_assignments')} a
         JOIN ${db.t('assessment_tests')} t ON t.id = a.test_id WHERE a.employee_id = ? ORDER BY a.id DESC`, [emp.id]
    );
    res.render('self/assessment', { title: 'آزمون‌های من', list, employee: emp });
  } catch (err) { next(err); }
});

const notify = require('../lib/notify');
const notifyHr = notify.notifyHr;

/* ------------------------------------------------------------------ */
/* سوار کردن منابع (CRUD خودکار هر ماژول)                             */
/* ------------------------------------------------------------------ */
/* ماژول‌های تخصصی: داشبورد و فرآیندهای اختصاصی هر ماژول */
const MODULE_ROUTERS = [
  ['/employees', './employees'],
  ['/recruitment', './recruitment'],
  ['/assessment', './assessment'],
  ['/onboarding', './onboarding'],
  ['/training', './training'],
  ['/attendance', './attendance'],
  ['/payroll', './payroll'],
  ['/offboarding', './offboarding'],
  ['/transport', './transport'],
  ['/kitchen', './kitchen'],
  ['/security', './security'],
  ['/welfare', './welfare'],
  ['/licensing', './licensing'],
  ['/shareholders', './shareholders'],
  ['/legal', './legal'],
  ['/performance', './performance'],
  ['/messaging', './messaging'],
  ['/calendar', './calendar'],
  ['/ops', './ops-pages'],
];
const mountedModules = [];
for (const [mountPath, file] of MODULE_ROUTERS) {
  try {
    router.use(mountPath, require(file));
    mountedModules.push(mountPath);
  } catch (err) {
    console.warn(`[panel] ماژول ${file} بارگذاری نشد: ${err.message}`);
  }
}

for (const def of resources.all()) {
  const mountPath = '/' + def.basePath;
  router.use(
    mountPath,
    mw.requireAuth(),
    mw.requirePasswordChange(),
    mw.moduleGate(def.module),
    mw.requirePerm(def.perm.view),
    resourceRouter(def)
  );
}

module.exports = router;
module.exports.dashboardData = dashboardData;
module.exports.notifyHr = notifyHr;
module.exports.count = count;
module.exports.mountedModules = mountedModules;
module.exports.notify = notify;
