'use strict';
/**
 * ماژول جذب و استخدام
 * ----------------------------------------------------------------------------
 *  • فهرست و پرونده داوطلبان + کانبان مراحل + تبدیل به کارمند
 *  • ساخت لینک/QR دعوت (کد ملی + موبایل + کد یک‌بارمصرف پیامکی)
 *  • سازندهٔ فرم استخدام: بخش‌ها، فیلدها، اجباری/اختیاری، ترتیب
 *  • آگهی‌های شغلی، مصاحبه‌ها و نظرهای مصاحبه‌کننده/مدیریت
 */
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const audit = require('../lib/audit');
const uikit = require('../lib/uikit');
const security = require('../lib/security');
const mw = require('../middleware');
const authService = require('../services/auth');
const sms = require('../services/sms');
const settings = require('../lib/settings');
const employeesModule = require('./employees');
const notify = require('../lib/notify');

const router = express.Router();
const P = (perm) => mw.requirePerm(perm);
const gate = mw.moduleGate('recruitment');

/* ------------------------------ کمک‌کننده ------------------------------ */
async function stages() {
  return db.query(`SELECT * FROM ${db.t('recruitment_stages')} WHERE is_active = 1 ORDER BY sort_order`).catch(() => []);
}

function baseUrl(req) {
  const configured = (config.load().app || {}).publicBaseUrl;
  if (configured) return String(configured).replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/* =============================== داشبورد =============================== */
router.get('/', mw.requireAuth(), P('recruitment.view'), gate, async (req, res, next) => {
  try {
    const st = await stages();
    const stageRows = [];
    for (const s of st) {
      const row = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('applications')} WHERE stage_key = ? AND deleted_at IS NULL`, [s.key]);
      stageRows.push({ key: s.key, name: s.name, color: s.color, count: Number(row.c) });
    }
    const [total, open, interviewsToday, results] = await Promise.all([
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('applications')} WHERE deleted_at IS NULL`),
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('job_reqs')} WHERE status='open' AND deleted_at IS NULL`),
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('interviews')} WHERE status='scheduled' AND scheduled_at >= ? AND scheduled_at <= ?`, [db.nowSql().slice(0, 10) + ' 00:00:00', db.nowSql().slice(0, 10) + ' 23:59:59']),
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('assessment_results')}`),
    ]);
    res.render('page', {
      title: 'داشبورد جذب و استخدام',
      page: {
        icon: 'user-plus',
        kpis: [
          uikit.kpi('کل داوطلبان', Number(total.c), { icon: 'users', color: 'primary', url: '/recruitment/applications' }),
          uikit.kpi('آگهی‌های باز', Number(open.c), { icon: 'briefcase', color: 'success', url: '/recruitment/jobs' }),
          uikit.kpi('مصاحبه‌های امروز', Number(interviewsToday.c), { icon: 'calendar', color: 'warning', url: '/recruitment/interviews' }),
          uikit.kpi('آزمون‌های انجام‌شده', Number(results.c), { icon: 'brain', color: 'info', url: '/assessment/results' }),
        ],
        bars: stageRows.map((s) => ({ label: s.name, value: s.count, color: s.color || 'primary' })),
        barsTitle: 'توزیع داوطلبان در مراحل استخدام',
        sections: [
          {
            type: 'tiles', items: [
              { title: 'داوطلبان', url: '/recruitment/applications', icon: 'users', desc: 'فهرست، جست‌وجو و پرونده' },
              { title: 'کانبان استخدام', url: '/recruitment/kanban', icon: 'kanban', desc: 'جابه‌جایی داوطلبان بین مراحل' },
              { title: 'لینک و QR دعوت', url: '/recruitment/invites', icon: 'qrcode', desc: 'برای مراجعه حضوری داوطلب' },
              { title: 'فرم استخدام و سؤالات', url: '/recruitment/forms', icon: 'form', desc: 'مدیریت فیلدها و اجباری‌ها' },
              { title: 'آزمون MBTI', url: '/assessment', icon: 'brain', desc: 'سؤالات و تحلیل شخصیتی' },
              { title: 'مصاحبه‌ها', url: '/recruitment/interviews', icon: 'calendar', desc: 'زمان‌بندی و نتیجه' },
              { title: 'آگهی‌های شغلی', url: '/recruitment/jobs', icon: 'briefcase', desc: 'انتشار در سایت فرصت‌های شغلی' },
              { title: 'مراحل استخدام', url: '/recruitment/stages', icon: 'steps', desc: 'تعریف مراحل و رنگ‌ها' },
            ],
          },
        ],
      },
    });
  } catch (err) { next(err); }
});

/* ============================== داوطلبان ============================== */
router.get('/applications', mw.requireAuth(), P('recruitment.view'), gate, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 20;
    const where = ['a.deleted_at IS NULL'];
    const params = [];
    if (req.query.q) { where.push('(a.full_name LIKE ? OR a.mobile LIKE ? OR a.national_id LIKE ? OR a.code LIKE ?)'); const like = `%${req.query.q}%`; params.push(like, like, like, like); }
    if (req.query.stage) { where.push('a.stage_key = ?'); params.push(req.query.stage); }
    if (req.query.job) { where.push('a.job_req_id = ?'); params.push(Number(req.query.job)); }
    const total = Number((await db.get(`SELECT COUNT(*) AS c FROM ${db.t('applications')} a WHERE ${where.join(' AND ')}`, params)).c);
    const list = await db.query(
      `SELECT a.*, j.title AS job_title, u.full_name AS assignee
         FROM ${db.t('applications')} a
         LEFT JOIN ${db.t('job_reqs')} j ON j.id = a.job_req_id
         LEFT JOIN ${db.t('users')} u ON u.id = a.assigned_to
        WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      params
    );
    const st = await stages();
    const jobs = await db.query(`SELECT id, title FROM ${db.t('job_reqs')} WHERE deleted_at IS NULL ORDER BY id DESC`);
    const mbti = await db.query(`SELECT application_id, type_code FROM ${db.t('assessment_results')} WHERE application_id IS NOT NULL`);
    const mbtiMap = mbti.reduce((a, r) => { a[r.application_id] = r.type_code; return a; }, {});
    const stColors = st.reduce((a, s) => { a[s.key] = s.color; return a; }, {});
    res.render('page', {
      title: 'داوطلبان استخدام',
      page: {
        icon: 'users',
        subtitle: `مجموع ${helpers.pnum(total)} داوطلب`,
        actions: [
          ...(authService.can(req.user, 'recruitment.invite.manage') ? [{ label: 'ساخت QR / لینک دعوت', url: '/recruitment/invites/new', icon: 'qrcode', class: 'btn-primary' }] : []),
          { label: 'کانبان', url: '/recruitment/kanban', icon: 'kanban' },
        ],
        sections: [
          {
            type: 'form', method: 'get', action: '/recruitment/applications', submit: 'فیلتر', title: null,
            html: `<div class="form-row">
              <div class="col-4"><div class="form-group mb-0"><label class="field-label">جست‌وجو</label><input type="search" name="q" value="${helpers.escapeHtml(req.query.q || '')}" placeholder="نام، موبایل، کد ملی یا کد پرونده"></div></div>
              <div class="col-4"><div class="form-group mb-0"><label class="field-label">مرحله</label><select name="stage"><option value="">همه مراحل</option>${st.map((s) => `<option value="${s.key}" ${req.query.stage === s.key ? 'selected' : ''}>${helpers.escapeHtml(s.name)}</option>`).join('')}</select></div></div>
              <div class="col-4"><div class="form-group mb-0"><label class="field-label">موقعیت شغلی</label><select name="job"><option value="">همه موقعیت‌ها</option>${jobs.map((j) => `<option value="${j.id}" ${String(req.query.job) === String(j.id) ? 'selected' : ''}>${helpers.escapeHtml(j.title)}</option>`).join('')}</select></div></div>
            </div>`,
          },
          uikit.table(
            [{ label: 'کد' }, { label: 'نام داوطلب' }, { label: 'موقعیت' }, { label: 'موبایل' }, { label: 'مرحله' }, { label: 'آزمون MBTI' }, { label: 'امتیاز' }, { label: 'تاریخ ثبت' }],
            list.map((a) => ({
              url: `/recruitment/applications/${a.id}`,
              cells: [
                `<span dir="ltr">${helpers.escapeHtml(a.code || '')}</span>`,
                `<a href="/recruitment/applications/${a.id}" class="link strong">${helpers.escapeHtml(a.full_name)}</a>`,
                helpers.escapeHtml(a.job_title || '—'),
                `<span dir="ltr">${helpers.pnum(a.mobile || '')}</span>`,
                uikit.badge(a.stage_key, stColors[a.stage_key] || 'primary'),
                mbtiMap[a.id] ? `<span class="badge info" dir="ltr">${helpers.escapeHtml(mbtiMap[a.id])}</span>` : '<span class="muted small">—</span>',
                helpers.pnum(a.score || '—'),
                uikit.date(a.created_at),
              ],
              actions: [{ icon: 'eye', title: 'پرونده', url: `/recruitment/applications/${a.id}` }],
            })),
            { empty: 'داوطلبی با این شرایط یافت نشد.' }
          ),
        ],
      },
      meta: helpers.paginationMeta(total, page, perPage),
    });
  } catch (err) { next(err); }
});

/* ------------------------------- کانبان ------------------------------- */
router.get('/kanban', mw.requireAuth(), P('recruitment.view'), gate, async (req, res, next) => {
  try {
    const st = await stages();
    const list = await db.query(
      `SELECT a.id, a.full_name, a.stage_key, a.mobile, a.created_at, a.score, j.title AS job_title
         FROM ${db.t('applications')} a LEFT JOIN ${db.t('job_reqs')} j ON j.id = a.job_req_id
        WHERE a.deleted_at IS NULL ORDER BY a.id DESC LIMIT 400`
    );
    const columns = st.map((s) => {
      const items = list.filter((a) => a.stage_key === s.key || (!a.stage_key && s.sort_order === 1));
      return {
        key: s.key, name: s.name, color: s.color, count: items.length,
        cards: items.map((a) => ({
          id: a.id, name: a.full_name, job: a.job_title, mobile: a.mobile,
          date: jalali.formatJalaali(a.created_at), score: a.score, url: `/recruitment/applications/${a.id}`,
        })),
      };
    });
    res.render('recruitment/kanban', { title: 'کانبان استخدام', columns, canMove: authService.can(req.user, 'recruitment.edit') });
  } catch (err) { next(err); }
});

router.post('/applications/:id/stage', mw.requireAuth(), P('recruitment.edit'), gate, async (req, res, next) => {
  try {
    const stage = String(req.body.stage || '');
    const valid = (await stages()).find((s) => s.key === stage);
    if (!valid) return res.jsonErr('مرحله نامعتبر است.');
    const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [req.params.id]);
    if (!app) return res.jsonErr('داوطلب یافت نشد.', 404);
    await db.run(`UPDATE ${db.t('applications')} SET stage_key = ?, stage_id = ?, status = ?, updated_at = ? WHERE id = ?`,
      [valid.key, valid.id, valid.is_final ? (valid.key === 'hired' ? 'hired' : 'rejected') : 'in_progress', db.nowSql(), app.id]);
    await db.run(`INSERT INTO ${db.t('application_stage_log')} (application_id, from_stage, to_stage, user_id, created_at) VALUES (?,?,?,?,?)`,
      [app.id, app.stage_key || null, valid.key, req.user.id, db.nowSql()]);
    await audit.log(req, { action: 'update', module: 'recruitment', entity: 'applications', entityId: app.id, title: `تغییر مرحله ${app.full_name} به ${valid.name}` });
    res.jsonOk({ message: `مرحله به «${valid.name}» تغییر کرد.` });
  } catch (err) { next(err); }
});

/* ---------------------------- پرونده داوطلب ---------------------------- */
router.get('/applications/:id', mw.requireAuth(), P('recruitment.view'), gate, async (req, res, next) => {
  try {
    const app = await db.get(
      `SELECT a.*, j.title AS job_title, j.department_id, u.full_name AS assignee_name
         FROM ${db.t('applications')} a
         LEFT JOIN ${db.t('job_reqs')} j ON j.id = a.job_req_id
         LEFT JOIN ${db.t('users')} u ON u.id = a.assigned_to
        WHERE a.id = ?`, [req.params.id]
    );
    if (!app) return res.status(404).render('errors/404', { title: 'داوطلب یافت نشد' });
    const [answers, notes, interviews, attachments, result, stageLog, sections] = await Promise.all([
      db.query(`SELECT * FROM ${db.t('application_answers')} WHERE application_id = ? ORDER BY sort_order, id`, [app.id]),
      db.query(`SELECT * FROM ${db.t('application_notes')} WHERE application_id = ? ORDER BY id DESC`, [app.id]),
      db.query(`SELECT * FROM ${db.t('interviews')} WHERE application_id = ? ORDER BY id DESC`, [app.id]),
      db.query(`SELECT * FROM ${db.t('application_attachments')} WHERE application_id = ? ORDER BY id DESC`, [app.id]),
      db.get(`SELECT * FROM ${db.t('assessment_results')} WHERE application_id = ? ORDER BY id DESC LIMIT 1`, [app.id]).catch(() => null),
      db.query(`SELECT * FROM ${db.t('application_stage_log')} WHERE application_id = ? ORDER BY id DESC LIMIT 20`, [app.id]),
      db.query(`SELECT id, title, sort_order FROM ${db.t('form_sections')} WHERE template_id = ? ORDER BY sort_order`, [app.form_template_id || 0]).catch(() => []),
    ]);
    const sectionTitle = {};
    sections.forEach((s) => { sectionTitle[s.id] = s.title; });
    const grouped = {};
    answers.forEach((a) => {
      const t = sectionTitle[a.section_id] || 'سایر اطلاعات';
      (grouped[t] = grouped[t] || []).push(a);
    });
    const canSeeAnalysis = authService.can(req.user, 'assessment.analysis.view') && authService.can(req.user, 'assessment.view_results');
    const jobTitle = await getJobTitle(app);

    res.render('recruitment/detail', {
      title: `پرونده ${app.full_name}`,
      app, grouped, notes, interviews, attachments, result: canSeeAnalysis ? result : null,
      resultLocked: !canSeeAnalysis && Boolean(result),
      stageLog, canSeeAnalysis, jobTitle,
      canHire: authService.can(req.user, 'recruitment.hire') && app.status !== 'hired' && !app.hired_employee_id,
      mbtiHtml: canSeeAnalysis && result ? buildMbtiHtml(result) : null,
    });
    async function getJobTitle(a) { return a.job_title || (a.job_req_id ? (await db.get(`SELECT title FROM ${db.t('job_reqs')} WHERE id = ?`, [a.job_req_id]) || {}).title : null); }
  } catch (err) { next(err); }
});

/** کارت تحلیل MBTI برای نمایش در پرونده (فقط منابع انسانی/مدیریت) */
function asList(v) {
  if (Array.isArray(v)) return v;
  const parsed = helpers.jsonParse(v, null);
  if (Array.isArray(parsed)) return parsed;
  if (typeof v === 'string' && v.trim()) return v.split('\n').map((s) => s.trim()).filter(Boolean);
  return [];
}

function buildMbtiHtml(result) {
  const axisScores = helpers.jsonParse(result.axis_scores, {}) || {};
  const percentages = helpers.jsonParse(result.percentages, {}) || {};
  const strengths = asList(result.strengths);
  const watchouts = asList(result.watchouts);
  const suggestions = asList(result.suggestions);
  const jobFit = asList(result.job_fit);
  const borderline = asList(result.borderline_axes);
  const axisBox = (title, left, right, leftPct) => {
    const l = Number(leftPct);
    const r = 100 - l;
    return `<div class="axis">
      <div class="axis-head"><span class="axis-left ${l >= r ? 'strong' : ''}">${left} <b>${helpers.pnum(l)}٪</b></span>
      <span class="axis-right ${r > l ? 'strong' : ''}"><b>${helpers.pnum(r)}٪</b> ${right}</span></div>
      <div class="axis-track"><span style="width:${l}%"></span></div>
    </div>`;
  };
  return `
    <div class="mbti-head">
      <div class="mbti-type">${helpers.escapeHtml(result.type_code)}</div>
      <div>
        <div class="mbti-title">${helpers.escapeHtml(result.group_name || '')}</div>
        <div class="muted small">اعتماد تحلیل: ${uikit.badge(result.confidence, result.confidence === 'بالا' ? 'success' : result.confidence === 'پایین' ? 'danger' : 'warning')}
        ${borderline.length ? ' — محورهای مرزی: ' + borderline.map((a) => helpers.escapeHtml(a)).join('، ') : ''}</div>
      </div>
    </div>
    <div class="axes">
      ${axisBox('برون‌گرایی / درون‌گرایی', 'E', 'I', percentages.EI || 50)}
      ${axisBox('حسی / شهودی', 'S', 'N', percentages.SN || 50)}
      ${axisBox('فکری / احساسی', 'T', 'F', percentages.TF || 50)}
      ${axisBox('قضاوتی / ادراکی', 'J', 'P', percentages.JP || 50)}
    </div>
    <div class="mbti-cols">
      <div><h5>نقاط قوت</h5><ul>${strengths.map((s) => `<li>${helpers.escapeHtml(s)}</li>`).join('')}</ul></div>
      <div><h5>نکات قابل توجه</h5><ul>${watchouts.map((s) => `<li>${helpers.escapeHtml(s)}</li>`).join('')}</ul></div>
    </div>
    ${result.summary ? `<p class="muted">${helpers.escapeHtml(result.summary)}</p>` : ''}
    ${suggestions.length ? `<div><h5>پیشنهادهای مدیریتی</h5><ul>${suggestions.map((s) => `<li>${helpers.escapeHtml(s)}</li>`).join('')}</ul></div>` : ''}
    ${jobFit.length ? `<div><h5>تناسب با مشاغل</h5><div class="axes">${jobFit.map((f) => `<span class="chip">${helpers.escapeHtml(f.title || f)} ${f.fit ? '<b>' + helpers.pnum(f.fit) + '٪</b>' : ''}</span>`).join('')}</div></div>` : ''}
    ${result.risk_notes ? `<div class="alert alert-warning mt-2">${require('../lib/icons').icon('alert')}<div><b>ملاحظات ریسک (محرمانه):</b> ${helpers.escapeHtml(result.risk_notes)}</div></div>` : ''}
    <div class="muted small">${uikit.dateTime(result.created_at)} — محورها: ${Object.keys(axisScores).map((k) => `${k}:${helpers.pnum(axisScores[k])}`).join(' / ')}</div>`;
}

/* --------------------------- تغییر مرحله/نظر --------------------------- */
router.post('/applications/:id/note', mw.requireAuth(), P('recruitment.edit'), gate, async (req, res, next) => {
  try {
    const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [req.params.id]);
    if (!app) return res.jsonErr('داوطلب یافت نشد.', 404);
    const type = ['interview', 'hr', 'management', 'note'].includes(req.body.type) ? req.body.type : 'note';
    if (type !== 'hr' && !authService.can(req.user, 'recruitment.view_notes')) return res.jsonErr('دسترسی ندارید.', 403);
    await db.insert('application_notes', {
      application_id: app.id, author_id: req.user.id, author_name: req.user.full_name, type,
      content: req.body.content || '', decision: req.body.decision || null, score: req.body.score ? Number(req.body.score) : null,
      visibility: type === 'management' ? 'management' : 'hr', stage_key: app.stage_key, created_at: db.nowSql(),
    });
    if (req.body.score) await db.run(`UPDATE ${db.t('applications')} SET score = ?, updated_at = ? WHERE id = ?`, [Number(req.body.score), db.nowSql(), app.id]);
    await audit.log(req, { action: 'create', module: 'recruitment', entity: 'application_notes', entityId: app.id, title: `ثبت نظر پرونده ${app.full_name}` });
    req.setFlash('success', 'نظر ثبت شد.');
    res.redirect(`/recruitment/applications/${app.id}`);
  } catch (err) { next(err); }
});

router.post('/applications/:id/decision', mw.requireAuth(), P('recruitment.edit'), gate, async (req, res, next) => {
  try {
    const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [req.params.id]);
    if (!app) return res.jsonErr('داوطلب یافت نشد.', 404);
    const decision = String(req.body.decision || '');
    if (!['hire', 'review', 'reject'].includes(decision)) return res.jsonErr('تصمیم نامعتبر است.');
    await db.run(`UPDATE ${db.t('applications')} SET decision = ?, decided_at = ?, status = ?, rejection_reason = ? WHERE id = ?`,
      [decision, db.nowSql(), decision === 'reject' ? 'rejected' : (decision === 'hire' ? 'offer' : 'screening'), req.body.reason || null, app.id]);
    await db.insert('application_notes', {
      application_id: app.id, author_id: req.user.id, author_name: req.user.full_name, type: 'management',
      content: req.body.reason || '', decision, created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'update', module: 'recruitment', entity: 'applications', entityId: app.id, title: `تصمیم نهایی پرونده ${app.full_name}` });
    req.setFlash('success', 'تصمیم ثبت شد.');
    res.redirect(`/recruitment/applications/${app.id}`);
  } catch (err) { next(err); }
});

/* --------------------------- تبدیل به کارمند --------------------------- */
router.post('/applications/:id/hire', mw.requireAuth(), P('recruitment.hire'), gate, async (req, res, next) => {
  try {
    const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [req.params.id]);
    if (!app) return res.jsonErr('داوطلب یافت نشد.', 404);
    const result = await employeesModule.hireFromApplication(req, app.id);
    if (!result.ok) return res.jsonErr(result.error);
    await audit.log(req, { action: 'create', module: 'recruitment', entity: 'employees', entityId: result.employeeId, title: `استخدام ${app.full_name} با کد ${result.code}` });
    req.setFlash('success', `کارمند با کد پرسنلی ${result.code} ایجاد شد و فرآیند بدو ورود آغاز گردید.`);
    res.redirect(`/employees/${result.employeeId}`);
  } catch (err) { next(err); }
});

/* ============================ دعوت‌نامه / QR ============================ */
router.get('/invites', mw.requireAuth(), P('recruitment.invite.manage'), gate, async (req, res, next) => {
  try {
    const list = await db.query(
      `SELECT i.*, j.title AS job_title FROM ${db.t('recruitment_invites')} i
         LEFT JOIN ${db.t('job_reqs')} j ON j.id = i.job_req_id ORDER BY i.id DESC LIMIT 200`
    );
    const stColor = { created: 'muted', sent: 'info', opened: 'warning', verified: 'primary', submitted: 'success', used: 'success', expired: 'danger', revoked: 'danger', in_progress: 'warning' };
    res.render('page', {
      title: 'لینک‌ها و QR دعوت',
      page: {
        icon: 'qrcode',
        subtitle: 'برای داوطلب حضوری: یک QR بسازید، داوطلب اسکن می‌کند و پس از تأیید موبایل با کد پیامکی، فرم استخدام را گام‌به‌گام پر می‌کند.',
        actions: [{ label: 'ساخت دعوت‌نامه جدید', url: '/recruitment/invites/new', icon: 'plus', class: 'btn-primary' }],
        sections: [
          uikit.table(
            [{ label: 'کد' }, { label: 'نام داوطلب' }, { label: 'موقعیت' }, { label: 'موبایل' }, { label: 'وضعیت' }, { label: 'انقضا' }, { label: 'لینک / QR' }],
            list.map((i) => ({
              cells: [
                `<span dir="ltr">${helpers.escapeHtml(i.token.slice(0, 8))}</span>`,
                helpers.escapeHtml(i.name || '—'),
                helpers.escapeHtml(i.job_title || '—'),
                `<span dir="ltr">${helpers.pnum(i.mobile || '')}</span>`,
                uikit.badge(i.status, stColor[i.status] || 'muted'),
                uikit.dateTime(i.expires_at),
                `<a class="link" href="/apply/${i.token}" target="_blank">باز کردن فرم</a>`,
              ],
              actions: [
                { icon: 'qrcode', title: 'نمایش QR', url: `/recruitment/invites/${i.id}/qr` },
                { icon: 'send', title: 'ارسال پیامک لینک', url: `/recruitment/invites/${i.id}/send`, post: true, confirm: 'لینک فرم برای این شماره پیامک شود؟' },
                { icon: 'x', title: 'ابطال', url: `/recruitment/invites/${i.id}/revoke`, post: true, confirm: 'این دعوت‌نامه باطل شود؟' },
              ],
            })),
            { empty: 'هنوز دعوت‌نامه‌ای ساخته نشده است.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

router.get('/invites/new', mw.requireAuth(), P('recruitment.invite.manage'), gate, async (req, res, next) => {
  try {
    const jobs = await db.query(`SELECT id, title, require_mbti FROM ${db.t('job_reqs')} WHERE deleted_at IS NULL AND status = 'open' ORDER BY id DESC`);
    const templates = await db.query(`SELECT id, name FROM ${db.t('form_templates')} WHERE is_active = 1 ORDER BY is_default DESC, id`);
    res.render('page', {
      title: 'ساخت دعوت‌نامه استخدام',
      page: {
        icon: 'qrcode',
        sections: [{
          type: 'form', action: '/recruitment/invites', submit: 'ساخت لینک و QR', cancel: '/recruitment/invites',
          html: `<div class="form-row">
            <div class="col-6"><div class="form-group"><label class="field-label">نام و نام خانوادگی داوطلب</label><input type="text" name="name" placeholder="برای درج در فرم"></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">شماره موبایل <span class="req">*</span></label><input type="text" name="mobile" dir="ltr" placeholder="09123456789" required><span class="field-help">کد تأیید (OTP) به این شماره ارسال می‌شود.</span></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">کد ملی <span class="req">*</span></label><input type="text" name="national_id" dir="ltr" required><span class="field-help">برای تطبیق هویت در گام بعدی.</span></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">موقعیت شغلی</label><select name="job_req_id"><option value="">— انتخاب کنید —</option>${jobs.map((j) => `<option value="${j.id}">${helpers.escapeHtml(j.title)}</option>`).join('')}</select></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">قالب فرم استخدام</label><select name="form_template_id">${templates.map((t) => `<option value="${t.id}">${helpers.escapeHtml(t.name)}</option>`).join('')}</select></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">اعتبار لینک (روز)</label><input type="number" name="ttl_days" value="7" min="1" max="60"></div></div>
            <div class="col-12"><label class="check"><input type="checkbox" name="requires_otp" value="1" checked><span class="check-label">درخواست کد تأیید پیامکی (توصیه‌شده)</span></label></div>
          </div>`,
        }],
      },
    });
  } catch (err) { next(err); }
});

router.post('/invites', mw.requireAuth(), P('recruitment.invite.manage'), gate, async (req, res, next) => {
  try {
    const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
    const nationalId = jalali.toLatinDigits(String(req.body.national_id || '').trim());
    if (!/^09\d{9}$/.test(mobile)) { req.setFlash('error', 'شماره موبایل معتبر نیست.'); return res.redirect('/recruitment/invites/new'); }
    const tpl = Number(req.body.form_template_id) || (await db.get(`SELECT id FROM ${db.t('form_templates')} WHERE is_active = 1 ORDER BY is_default DESC, id LIMIT 1`) || {}).id;
    const token = security.randomToken(16).replace(/[^a-zA-Z0-9]/g, '');
    const ttlDays = Math.min(60, Math.max(1, Number(req.body.ttl_days) || (await settings.getNumber('recruitment.invite_ttl_days', 7))));
    const id = await db.insert('recruitment_invites', {
      token, job_req_id: Number(req.body.job_req_id) || null, name: req.body.name || null, mobile, national_id: nationalId,
      purpose: 'form', form_template_id: tpl || null, status: 'created', max_uses: 1, used_count: 0,
      requires_otp: req.body.requires_otp ? 1 : 0,
      expires_at: db.nowSql(new Date(Date.now() + ttlDays * 864e5)),
      created_by: req.user.id, created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'recruitment', entity: 'recruitment_invites', entityId: id, title: `ساخت دعوت‌نامه برای ${mobile}` });
    // ارسال پیامک لینک (اگر سرویس پیامک فعال باشد)
    const link = `${baseUrl(req)}/apply/${token}`;
    if (req.body.send_sms) {
      await sms.sendText(mobile, `فرم استخدام شرکت:\n${link}\nاعتبار: ${helpers.pnum(ttlDays)} روز`);
    }
    req.setFlash('success', 'دعوت‌نامه ساخته شد. QR را نمایش دهید یا لینک را برای داوطلب بفرستید.');
    res.redirect(`/recruitment/invites/${id}/qr`);
  } catch (err) { next(err); }
});

router.get('/invites/:id/qr', mw.requireAuth(), P('recruitment.invite.manage'), gate, async (req, res, next) => {
  try {
    const invite = await db.get(`SELECT * FROM ${db.t('recruitment_invites')} WHERE id = ?`, [req.params.id]);
    if (!invite) return res.status(404).render('errors/404', { title: 'دعوت‌نامه یافت نشد' });
    const link = `${baseUrl(req)}/apply/${invite.token}`;
    const dataUrl = await QRCode.toDataURL(link, { width: 520, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
    res.render('recruitment/invite-qr', { title: 'QR دعوت استخدام', invite, link, dataUrl, job: invite.job_req_id ? await db.get(`SELECT title FROM ${db.t('job_reqs')} WHERE id = ?`, [invite.job_req_id]) : null });
  } catch (err) { next(err); }
});

router.post('/invites/:id/send', mw.requireAuth(), P('recruitment.invite.manage'), gate, async (req, res, next) => {
  try {
    const invite = await db.get(`SELECT * FROM ${db.t('recruitment_invites')} WHERE id = ?`, [req.params.id]);
    if (!invite || !invite.mobile) { req.setFlash('error', 'دعوت‌نامه یا شماره موبایل یافت نشد.'); return res.redirect('/recruitment/invites'); }
    const link = `${baseUrl(req)}/apply/${invite.token}`;
    const out = await sms.sendText(invite.mobile, `لینک فرم استخدام:\n${link}`);
    if (!out.ok) req.setFlash('error', out.error || 'ارسال پیامک ناموفق بود.');
    else {
      await db.run(`UPDATE ${db.t('recruitment_invites')} SET status = 'sent', sent_at = ? WHERE id = ?`, [db.nowSql(), invite.id]);
      req.setFlash('success', 'لینک برای داوطلب پیامک شد.');
    }
    res.redirect('/recruitment/invites');
  } catch (err) { next(err); }
});

router.post('/invites/:id/revoke', mw.requireAuth(), P('recruitment.invite.manage'), gate, async (req, res, next) => {
  try {
    await db.run(`UPDATE ${db.t('recruitment_invites')} SET status = 'revoked' WHERE id = ?`, [req.params.id]);
    await audit.log(req, { action: 'delete', module: 'recruitment', entity: 'recruitment_invites', entityId: req.params.id, title: 'ابطال دعوت‌نامه' });
    req.setFlash('success', 'دعوت‌نامه باطل شد.');
    res.redirect('/recruitment/invites');
  } catch (err) { next(err); }
});

/* ============================ سازندهٔ فرم ============================ */
router.get('/forms', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const templates = await db.query(`SELECT * FROM ${db.t('form_templates')} ORDER BY is_default DESC, id`);
    const tplId = Number(req.query.template) || (templates[0] || {}).id;
    const [sections, fields] = await Promise.all([
      db.query(`SELECT * FROM ${db.t('form_sections')} WHERE template_id = ? ORDER BY sort_order`, [tplId]),
      db.query(`SELECT * FROM ${db.t('form_fields')} WHERE template_id = ? ORDER BY section_id, sort_order`, [tplId]),
    ]);
    const counts = {};
    fields.forEach((f) => { counts[f.section_id] = (counts[f.section_id] || 0) + 1; });
    res.render('recruitment/forms', {
      title: 'فرم استخدام و سؤالات',
      templates, tplId, sections, fields, counts,
      requiredCount: fields.filter((f) => f.is_required).length,
    });
  } catch (err) { next(err); }
});

router.post('/forms/sections', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const tplId = Number(req.body.template_id);
    const max = await db.get(`SELECT COALESCE(MAX(sort_order),0) AS m FROM ${db.t('form_sections')} WHERE template_id = ?`, [tplId]);
    await db.insert('form_sections', {
      template_id: tplId, title: req.body.title || 'بخش جدید', description: req.body.description || '',
      icon: req.body.icon || 'file-text', sort_order: Number(max.m) + 1, is_active: 1, is_repeatable: req.body.repeatable ? 1 : 0,
      created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'recruitment', entity: 'form_sections', title: `افزودن بخش «${req.body.title}»` });
    req.setFlash('success', 'بخش جدید اضافه شد.');
    res.redirect(`/recruitment/forms?template=${tplId}`);
  } catch (err) { next(err); }
});

router.post('/forms/sections/:id', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const sec = await db.get(`SELECT * FROM ${db.t('form_sections')} WHERE id = ?`, [req.params.id]);
    if (!sec) return res.status(404).render('errors/404', { title: 'بخش یافت نشد' });
    const data = {};
    ['title', 'description', 'icon'].forEach((k) => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
    if (req.body.sort_order !== undefined) data.sort_order = Number(req.body.sort_order);
    if (req.body.is_active !== undefined) data.is_active = req.body.is_active ? 1 : 0;
    data.updated_at = db.nowSql();
    await db.update('form_sections', data, 'id = ?', [sec.id]);
    req.setFlash('success', 'بخش به‌روزرسانی شد.');
    res.redirect(`/recruitment/forms?template=${sec.template_id}`);
  } catch (err) { next(err); }
});

router.post('/forms/sections/:id/delete', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const sec = await db.get(`SELECT * FROM ${db.t('form_sections')} WHERE id = ?`, [req.params.id]);
    if (!sec) { req.setFlash('error', 'بخش یافت نشد.'); return res.redirect('/recruitment/forms'); }
    const used = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('form_fields')} WHERE section_id = ?`, [sec.id]);
    if (Number(used.c) > 0) {
      req.setFlash('error', 'این بخش دارای فیلد است؛ ابتدا فیلدها را حذف یا منتقل کنید.');
      return res.redirect(`/recruitment/forms?template=${sec.template_id}`);
    }
    await db.run(`DELETE FROM ${db.t('form_sections')} WHERE id = ?`, [sec.id]);
    req.setFlash('success', 'بخش حذف شد.');
    res.redirect(`/recruitment/forms?template=${sec.template_id}`);
  } catch (err) { next(err); }
});

router.post('/forms/fields', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const tplId = Number(req.body.template_id);
    const sectionId = Number(req.body.section_id);
    const label = String(req.body.label || 'فیلد جدید').trim();
    const fkey = String(req.body.fkey || '').trim() || ('custom_' + security.randomToken(3).replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
    const max = await db.get(`SELECT COALESCE(MAX(sort_order),0) AS m FROM ${db.t('form_fields')} WHERE section_id = ?`, [sectionId]);
    const optionsRaw = String(req.body.options || '').split('\n').map((s) => s.trim()).filter(Boolean);
    await db.insert('form_fields', {
      template_id: tplId, section_id: sectionId, fkey, label,
      help_text: req.body.help_text || '', placeholder: req.body.placeholder || '',
      type: req.body.type || 'text',
      options: optionsRaw.length ? JSON.stringify(optionsRaw.map((o) => ({ value: o, label: o }))) : null,
      is_required: req.body.is_required ? 1 : 0, is_enabled: 1, is_system: 0, visible_roles: 'hr,admin',
      width: req.body.width || 'full', sort_order: Number(max.m) + 1,
      depends_on: req.body.depends_on || '', depends_value: req.body.depends_value || '',
      created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'recruitment', entity: 'form_fields', title: `افزودن فیلد «${label}»` });
    req.setFlash('success', 'فیلد جدید اضافه شد.');
    res.redirect(`/recruitment/forms?template=${tplId}`);
  } catch (err) { next(err); }
});

router.post('/forms/fields/:id', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const f = await db.get(`SELECT * FROM ${db.t('form_fields')} WHERE id = ?`, [req.params.id]);
    if (!f) return res.status(404).render('errors/404', { title: 'فیلد یافت نشد' });
    const data = {};
    if (req.body.label !== undefined) data.label = req.body.label;
    if (req.body.help_text !== undefined) data.help_text = req.body.help_text;
    if (req.body.placeholder !== undefined) data.placeholder = req.body.placeholder;
    if (req.body.type !== undefined) data.type = req.body.type;
    if (req.body.width !== undefined) data.width = req.body.width;
    if (req.body.section_id !== undefined) data.section_id = Number(req.body.section_id);
    if (req.body.is_required !== undefined) data.is_required = req.body.is_required ? 1 : 0;
    if (req.body.is_enabled !== undefined) data.is_enabled = req.body.is_enabled ? 1 : 0;
    if (req.body.sort_order !== undefined) data.sort_order = Number(req.body.sort_order);
    if (req.body.options !== undefined) {
      const optionsRaw = String(req.body.options || '').split('\n').map((s) => s.trim()).filter(Boolean);
      data.options = optionsRaw.length ? JSON.stringify(optionsRaw.map((o) => ({ value: o, label: o }))) : null;
    }
    if (req.body.depends_on !== undefined) data.depends_on = req.body.depends_on;
    if (req.body.depends_value !== undefined) data.depends_value = req.body.depends_value;
    data.updated_at = db.nowSql();
    await db.update('form_fields', data, 'id = ?', [f.id]);
    await audit.log(req, { action: 'update', module: 'recruitment', entity: 'form_fields', entityId: f.id, title: `ویرایش فیلد «${f.label}»` });
    if (req.body.ajax) return res.jsonOk({ message: 'ذخیره شد.' });
    req.setFlash('success', 'فیلد به‌روزرسانی شد.');
    res.redirect(`/recruitment/forms?template=${f.template_id}`);
  } catch (err) { next(err); }
});

router.post('/forms/fields/:id/toggle-required', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const f = await db.get(`SELECT * FROM ${db.t('form_fields')} WHERE id = ?`, [req.params.id]);
    if (!f) return res.jsonErr('فیلد یافت نشد.', 404);
    const next_ = f.is_required ? 0 : 1;
    await db.run(`UPDATE ${db.t('form_fields')} SET is_required = ?, updated_at = ? WHERE id = ?`, [next_, db.nowSql(), f.id]);
    await audit.log(req, { action: 'update', module: 'recruitment', entity: 'form_fields', entityId: f.id, title: `${next_ ? 'اجباری' : 'اختیاری'} کردن فیلد ${f.label}` });
    res.jsonOk({ message: next_ ? 'این فیلد اجباری شد.' : 'این فیلد اختیاری شد.', required: Boolean(next_) });
  } catch (err) { next(err); }
});

router.post('/forms/fields/:id/delete', mw.requireAuth(), P('recruitment.form.manage'), gate, async (req, res, next) => {
  try {
    const f = await db.get(`SELECT * FROM ${db.t('form_fields')} WHERE id = ?`, [req.params.id]);
    if (!f) { req.setFlash('error', 'فیلد یافت نشد.'); return res.redirect('/recruitment/forms'); }
    await db.run(`DELETE FROM ${db.t('form_fields')} WHERE id = ?`, [f.id]);
    await audit.log(req, { action: 'delete', module: 'recruitment', entity: 'form_fields', entityId: f.id, title: `حذف فیلد ${f.label}` });
    req.setFlash('success', 'فیلد حذف شد.');
    res.redirect(`/recruitment/forms?template=${f.template_id}`);
  } catch (err) { next(err); }
});

/* ------------------------- پیوست‌ها و آزمون ------------------------- */
router.get('/applications/:id/attachments/:aid/delete', mw.requireAuth(), P('recruitment.edit'), gate, async (req, res, next) => {
  try {
    await db.run(`DELETE FROM ${db.t('application_attachments')} WHERE id = ?`, [req.params.aid]);
    req.setFlash('success', 'پیوست حذف شد.');
    res.redirect(`/recruitment/applications/${req.params.id}`);
  } catch (err) { next(err); }
});

/** تبدیل داوطلب به کارمند از فهرست (مسیر کوتاه) */
router.post('/applications/:id/invite-assessment', mw.requireAuth(), P('assessment.assign'), mw.moduleGate('assessment'), async (req, res, next) => {
  try {
    const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [req.params.id]);
    if (!app) return res.jsonErr('داوطلب یافت نشد.', 404);
    const test = await db.get(`SELECT * FROM ${db.t('assessment_tests')} WHERE is_active = 1 ORDER BY id LIMIT 1`);
    if (!test) return res.jsonErr('آزمون فعالی یافت نشد.');
    const token = security.randomToken(14).replace(/[^a-zA-Z0-9]/g, '');
    const id = await db.insert('assessment_assignments', {
      test_id: test.id, application_id: app.id, token, status: 'pending',
      expires_at: db.nowSql(new Date(Date.now() + 7 * 864e5)), created_by: req.user.id, created_at: db.nowSql(),
    });
    const link = `${baseUrl(req)}/apply/assessment/${token}`;
    if (app.mobile) {
      await sms.sendText(app.mobile, `آزمون روان‌شناسی شخصیتی:\n${link}\nمدت: ${helpers.pnum(test.duration_minutes || 15)} دقیقه`);
    }
    await audit.log(req, { action: 'create', module: 'assessment', entity: 'assessment_assignments', entityId: id, title: `تخصیص آزمون به ${app.full_name}` });
    req.setFlash('success', `آزمون تخصیص یافت و لینک برای ${app.full_name} ارسال شد.`);
    res.redirect(`/recruitment/applications/${app.id}`);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.baseUrl = baseUrl;
