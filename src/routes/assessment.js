'use strict';
/**
 * ماژول آزمون شخصیت‌شناسی (MBTI)
 * ----------------------------------------------------------------------------
 *  • فهرست آزمون‌ها و تنظیمات آن‌ها
 *  • مدیریت سؤالات (افزودن/ویرایش/حذف/غیرفعال‌سازی/ورود گروهی)
 *  • تخصیص آزمون به کارکنان و داوطلبان و ارسال لینک پیامکی
 *  • فهرست نتایج و تحلیل کامل (فقط منابع انسانی/مدیریت — هرگز داوطلب)
 */
const express = require('express');
const db = require('../db');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const audit = require('../lib/audit');
const uikit = require('../lib/uikit');
const mbti = require('../lib/mbti');
const security = require('../lib/security');
const mw = require('../middleware');
const authService = require('../services/auth');
const modulesService = require('../services/modules');
const sms = require('../services/sms');
const notify = require('../lib/notify');

const router = express.Router();
const P = (perm) => mw.requirePerm(perm);
const gate = mw.moduleGate('assessment');

const HIDDEN = 'این تحلیل محرمانه است و فقط برای منابع انسانی و مدیریت نمایش داده می‌شود.';

/* ============================== داشبورد ============================== */
router.get('/', mw.requireAuth(), P('assessment.view'), gate, async (req, res, next) => {
  try {
    const [tests, results, assignments, dist] = await Promise.all([
      db.query(`SELECT t.*, (SELECT COUNT(*) FROM ${db.t('assessment_questions')} q WHERE q.test_id = t.id AND q.is_active = 1) AS active_questions FROM ${db.t('assessment_tests')} t ORDER BY t.id`),
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('assessment_results')}`).catch(() => ({ c: 0 })),
      db.get(`SELECT COUNT(*) AS c, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done FROM ${db.t('assessment_assignments')}`).catch(() => ({ c: 0, done: 0 })),
      db.query(`SELECT type_code, COUNT(*) AS c FROM ${db.t('assessment_results')} GROUP BY type_code ORDER BY c DESC LIMIT 8`).catch(() => []),
    ]);
    res.render('page', {
      title: 'آزمون شخصیت‌شناسی (MBTI)',
      page: {
        icon: 'brain',
        subtitle: mbtiNotice(),
        actions: [
          ...(authService.can(req.user, 'assessment.assign') ? [{ label: 'تخصیص آزمون', url: '/assessment/assignments?new=1', icon: 'send', class: 'btn-primary' }] : []),
          ...(authService.can(req.user, 'assessment.questions.manage') ? [{ label: 'مدیریت سؤالات', url: '/assessment/questions', icon: 'list' }] : []),
        ],
        kpis: [
          uikit.kpi('آزمون‌های فعال', helpers.pnum(tests.filter((t) => t.is_active).length), { icon: 'brain', color: 'primary' }),
          uikit.kpi('تخصیص‌ها', helpers.pnum(assignments.c), { icon: 'send', color: 'info' }),
          uikit.kpi('تکمیل‌شده', helpers.pnum(assignments.done), { icon: 'check', color: 'success' }),
          uikit.kpi('نتایج تحلیل‌شده', helpers.pnum(results.c), { icon: 'chart', color: 'warning', url: '/assessment/results' }),
        ],
        bars: dist.map((d) => ({ label: d.type_code, value: Number(d.c), color: 'primary' })),
        barsTitle: 'پراکندگی تیپ‌های شخصیتی',
        sections: [
          uikit.table(
            [{ label: 'آزمون' }, { label: 'نوع' }, { label: 'سؤال فعال' }, { label: 'مدت (دقیقه)' }, { label: 'نمایش نتیجه' }, { label: 'وضعیت' }],
            tests.map((t) => ({
              url: `/assessment/results?test=${t.id}`,
              cells: [
                `<a class="link strong" href="/assessment/questions?test=${t.id}">${helpers.escapeHtml(t.name)}</a>`,
                t.type === 'mbti' ? 'شخصیت‌شناسی MBTI' : helpers.escapeHtml(t.type || ''),
                helpers.pnum(t.active_questions),
                helpers.pnum(t.duration_minutes || 0),
                uikit.badge(t.result_visibility === 'hr_only' ? 'فقط منابع انسانی' : (t.result_visibility || ''), 'info'),
                t.is_active ? '<span class="badge success">فعال</span>' : '<span class="badge muted">غیرفعال</span>',
              ],
              actions: authService.can(req.user, 'assessment.questions.manage')
                ? [{ icon: 'settings', title: 'تنظیمات آزمون', url: `/assessment/tests/${t.id}` }, { icon: 'list', title: 'سؤالات', url: `/assessment/questions?test=${t.id}` }]
                : [],
            })),
            { title: 'آزمون‌ها', empty: 'آزمونی تعریف نشده است.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

function mbtiNotice() {
  return 'نتایج تحلیل شخصیتی فقط برای منابع انسانی و مدیریت قابل مشاهده است و هرگز به داوطلب نمایش داده نمی‌شود.';
}

/* ============================ تنظیمات آزمون ============================ */
router.get('/tests/:id', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    const test = await db.get(`SELECT * FROM ${db.t('assessment_tests')} WHERE id = ?`, [req.params.id]);
    if (!test) return res.status(404).render('errors/404', { title: 'آزمون یافت نشد' });
    res.render('page', {
      title: `تنظیمات آزمون — ${test.name}`,
      page: {
        icon: 'brain',
        actions: [{ label: 'سؤالات آزمون', url: `/assessment/questions?test=${test.id}`, icon: 'list' }],
        sections: [{
          type: 'form', action: `/assessment/tests/${test.id}`, submit: 'ذخیره',
          html: `<div class="form-row">
            <div class="col-6"><div class="form-group"><label class="field-label">نام آزمون</label><input type="text" name="name" value="${helpers.escapeHtml(test.name)}" required></div></div>
            <div class="col-3"><div class="form-group"><label class="field-label">مدت (دقیقه)</label><input type="number" name="duration_minutes" value="${test.duration_minutes || 15}" min="3" max="120"></div></div>
            <div class="col-3"><div class="form-group"><label class="field-label">تعداد سؤال نمایشی</label><input type="number" name="question_count" value="${test.question_count || 0}"><span class="field-help">صفر = همه سؤالات فعال</span></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">نمایش نتیجه به</label>
              <select name="result_visibility">
                <option value="hr_only" ${test.result_visibility === 'hr_only' ? 'selected' : ''}>فقط منابع انسانی و مدیریت (توصیه‌شده)</option>
                <option value="manager" ${test.result_visibility === 'manager' ? 'selected' : ''}>منابع انسانی و مدیر مستقیم</option>
              </select><span class="field-help">${HIDDEN}</span></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">وضعیت</label>
              <label class="check"><input type="checkbox" name="is_active" value="1" ${test.is_active ? 'checked' : ''}><span class="check-label">آزمون فعال است</span></label></div></div>
            <div class="col-12"><div class="form-group"><label class="field-label">دستورالعمل برای داوطلب</label><textarea name="instructions" rows="3">${helpers.escapeHtml(test.instructions || '')}</textarea></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">متن آغاز آزمون</label><textarea name="intro_text" rows="2">${helpers.escapeHtml(test.intro_text || '')}</textarea></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">متن پایان آزمون (شکرگزاری)</label><textarea name="thanks_text" rows="2">${helpers.escapeHtml(test.thanks_text || '')}</textarea></div></div>
          </div>`,
        }],
      },
    });
  } catch (err) { next(err); }
});

router.post('/tests/:id', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    await db.update('assessment_tests', {
      name: req.body.name, duration_minutes: Number(req.body.duration_minutes) || 15,
      question_count: Number(req.body.question_count) || 0,
      result_visibility: req.body.result_visibility === 'manager' ? 'manager' : 'hr_only',
      is_active: req.body.is_active ? 1 : 0, instructions: req.body.instructions || '',
      intro_text: req.body.intro_text || '', thanks_text: req.body.thanks_text || '', updated_at: db.nowSql(),
    }, 'id = ?', [req.params.id]);
    await audit.log(req, { action: 'update', module: 'assessment', entity: 'assessment_tests', entityId: req.params.id, title: 'ویرایش تنظیمات آزمون' });
    req.setFlash('success', 'تنظیمات آزمون ذخیره شد.');
    res.redirect(`/assessment/tests/${req.params.id}`);
  } catch (err) { next(err); }
});

/* ============================== سؤالات ============================== */
router.get('/questions', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    const tests = await db.query(`SELECT * FROM ${db.t('assessment_tests')} ORDER BY id`);
    const testId = Number(req.query.test) || (tests[0] || {}).id;
    const test = tests.find((t) => Number(t.id) === Number(testId)) || tests[0];
    const list = await db.query(`SELECT * FROM ${db.t('assessment_questions')} WHERE test_id = ? ORDER BY COALESCE(sort_order, number), id`, [testId]);
    const axisCount = { EI: 0, SN: 0, TF: 0, JP: 0 };
    list.forEach((q) => { if (axisCount[q.axis] !== undefined) axisCount[q.axis] += 1; });
    res.render('page', {
      title: 'سؤالات آزمون شخصیت‌شناسی',
      page: {
        icon: 'list',
        subtitle: `مجموع ${helpers.pnum(list.length)} سؤال — توزیع محورها: EI ${helpers.pnum(axisCount.EI)}، SN ${helpers.pnum(axisCount.SN)}، TF ${helpers.pnum(axisCount.TF)}، JP ${helpers.pnum(axisCount.JP)}`,
        actions: [{ label: 'تنظیمات آزمون', url: `/assessment/tests/${test.id}`, icon: 'settings' }],
        alerts: [{ type: 'info', text: 'خروجی تحلیل این آزمون محرمانه است و در پرونده داوطلب فقط برای منابع انسانی نمایش داده می‌شود.' }],
        sections: [
          {
            type: 'form', action: '/assessment/questions', submit: 'افزودن سؤال', title: 'افزودن سؤال جدید',
            html: `<input type="hidden" name="test_id" value="${test.id}">
            <div class="form-row">
              <div class="col-6"><div class="form-group"><label class="field-label">متن سؤال <span class="req">*</span></label><textarea name="question_text" rows="2" required></textarea></div></div>
              <div class="col-3"><div class="form-group"><label class="field-label">محور</label>
                <select name="axis"><option value="EI">EI — منبع انرژی</option><option value="SN">SN — دریافت اطلاعات</option><option value="TF">TF — تصمیم‌گیری</option><option value="JP">JP — سبک زندگی</option></select></div></div>
              <div class="col-3"><div class="form-group"><label class="field-label">شماره</label><input type="number" name="number" placeholder="خودکار"></div></div>
              <div class="col-4"><div class="form-group"><label class="field-label">گزینه الف (متن)</label><input type="text" name="option_a" required></div></div>
              <div class="col-2"><div class="form-group"><label class="field-label">قطب الف</label>
                <select name="option_a_value"><option value="">—</option><option value="E">E</option><option value="I">I</option><option value="S">S</option><option value="N">N</option><option value="T">T</option><option value="F">F</option><option value="J">J</option><option value="P">P</option></select></div></div>
              <div class="col-4"><div class="form-group"><label class="field-label">گزینه ب (متن)</label><input type="text" name="option_b" required></div></div>
              <div class="col-2"><div class="form-group"><label class="field-label">قطب ب</label>
                <select name="option_b_value"><option value="">—</option><option value="E">E</option><option value="I">I</option><option value="S">S</option><option value="N">N</option><option value="T">T</option><option value="F">F</option><option value="J">J</option><option value="P">P</option></select></div></div>
            </div>`,
          },
          {
            type: 'form', action: '/assessment/questions/import', submit: 'ورود گروهی', title: 'ورود گروهی سؤالات',
            html: `<input type="hidden" name="test_id" value="${test.id}">
            <div class="form-group"><label class="field-label">هر سطر یک سؤال — قالب: <code dir="ltr">متن سؤال | گزینه الف | قطب الف | گزینه ب | قطب ب | محور</code></label>
            <textarea name="bulk" rows="5" dir="ltr" placeholder="وقت خود را چگونه می‌گذرانید؟ | در جمع دوستان | E | تنها | I | EI"></textarea>
            <span class="field-help">ستون‌های اختیاری را می‌توانید حذف کنید؛ محور از قطب‌ها تشخیص داده می‌شود.</span></div>`,
          },
          uikit.table(
            [{ label: '#' }, { label: 'سؤال' }, { label: 'گزینه الف' }, { label: 'گزینه ب' }, { label: 'محور' }, { label: 'وضعیت' }],
            list.map((q) => ({
              url: `/assessment/questions/${q.id}`,
              cells: [
                helpers.pnum(q.number || ''),
                `<a class="link" href="/assessment/questions/${q.id}">${helpers.truncate(helpers.escapeHtml(q.question_text), 90)}</a>`,
                `${helpers.truncate(helpers.escapeHtml(q.option_a || ''), 40)} <span class="badge muted" dir="ltr">${helpers.escapeHtml(q.option_a_value || '')}</span>`,
                `${helpers.truncate(helpers.escapeHtml(q.option_b || ''), 40)} <span class="badge muted" dir="ltr">${helpers.escapeHtml(q.option_b_value || '')}</span>`,
                `<span class="badge info" dir="ltr">${helpers.escapeHtml(q.axis || '')}</span>`,
                q.is_active ? '<span class="badge success">فعال</span>' : '<span class="badge muted">غیرفعال</span>',
              ],
              actions: [
                { icon: 'edit', title: 'ویرایش', url: `/assessment/questions/${q.id}` },
                { icon: 'toggle', title: q.is_active ? 'غیرفعال‌سازی' : 'فعال‌سازی', url: `/assessment/questions/${q.id}/toggle`, post: true },
                { icon: 'trash', title: 'حذف', url: `/assessment/questions/${q.id}/delete`, post: true, confirm: 'این سؤال حذف شود؟' },
              ],
            })),
            { title: 'سؤالات آزمون', empty: 'سؤالی ثبت نشده است.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

router.post('/questions', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    const testId = Number(req.body.test_id);
    const axis = String(req.body.axis || 'EI').toUpperCase();
    const [pos, neg] = mbti.AXES[axis] ? [mbti.AXES[axis].positive, mbti.AXES[axis].negative] : ['E', 'I'];
    const max = await db.get(`SELECT COALESCE(MAX(COALESCE(sort_order, number)),0) AS m FROM ${db.t('assessment_questions')} WHERE test_id = ?`, [testId]);
    const number = Number(req.body.number) || Number(max.m) + 1;
    await db.insert('assessment_questions', {
      test_id: testId, number, code: `Q${number}`, question_text: req.body.question_text,
      axis, option_a: req.body.option_a, option_a_value: req.body.option_a_value || pos,
      option_b: req.body.option_b, option_b_value: req.body.option_b_value || neg,
      sort_order: number, is_active: 1, created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'assessment', entity: 'assessment_questions', title: `افزودن سؤال MBTI شماره ${number}` });
    req.setFlash('success', 'سؤال افزوده شد.');
    res.redirect(`/assessment/questions?test=${testId}`);
  } catch (err) { next(err); }
});

router.post('/questions/import', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    const testId = Number(req.body.test_id);
    const lines = String(req.body.bulk || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const LETTERS = ['E', 'I', 'S', 'N', 'T', 'F', 'J', 'P'];
    let inserted = 0;
    let max = Number((await db.get(`SELECT COALESCE(MAX(number),0) AS m FROM ${db.t('assessment_questions')} WHERE test_id = ?`, [testId])).m);
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 3) continue;
      const [text, a, aVal, b, bVal, ax] = parts;
      const letterA = LETTERS.includes(String(aVal || '').toUpperCase()) ? String(aVal).toUpperCase() : '';
      const letterB = LETTERS.includes(String(bVal || '').toUpperCase()) ? String(bVal).toUpperCase() : '';
      const axis = LETTERS.includes(String(ax || '').toUpperCase()) ? mbti.LETTER_AXIS[String(ax).toUpperCase()] || null : (letterA ? mbti.LETTER_AXIS[letterA] : null);
      if (!axis) continue;
      max += 1;
      await db.insert('assessment_questions', {
        test_id: testId, number: max, code: `Q${max}`, question_text: text, axis,
        option_a: a || '', option_a_value: letterA || mbti.AXES[axis].positive,
        option_b: b || '', option_b_value: letterB || mbti.AXES[axis].negative,
        sort_order: max, is_active: 1, created_at: db.nowSql(),
      });
      inserted += 1;
    }
    await audit.log(req, { action: 'create', module: 'assessment', entity: 'assessment_questions', title: `ورود گروهی ${inserted} سؤال MBTI` });
    req.setFlash('success', `${helpers.pnum(inserted)} سؤال اضافه شد.`);
    res.redirect(`/assessment/questions?test=${testId}`);
  } catch (err) { next(err); }
});

router.get('/questions/:id', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    const q = await db.get(`SELECT * FROM ${db.t('assessment_questions')} WHERE id = ?`, [req.params.id]);
    if (!q) return res.status(404).render('errors/404', { title: 'سؤال یافت نشد' });
    res.render('page', {
      title: `ویرایش سؤال #${helpers.pnum(q.number || q.id)}`,
      page: {
        icon: 'edit',
        actions: [{ label: 'بازگشت به سؤالات', url: `/assessment/questions?test=${q.test_id}`, icon: 'arrow-right' }],
        sections: [{
          type: 'form', action: `/assessment/questions/${q.id}`, submit: 'ذخیره تغییرات', cancel: `/assessment/questions?test=${q.test_id}`,
          html: `<div class="form-row">
            <div class="col-6"><div class="form-group"><label class="field-label">متن سؤال</label><textarea name="question_text" rows="3">${helpers.escapeHtml(q.question_text)}</textarea></div></div>
            <div class="col-3"><div class="form-group"><label class="field-label">محور</label>
              <select name="axis">${Object.keys(mbti.AXES).map((a) => `<option value="${a}" ${q.axis === a ? 'selected' : ''}>${a} — ${helpers.escapeHtml(mbti.AXES[a].label)}</option>`).join('')}</select></div></div>
            <div class="col-3"><div class="form-group"><label class="field-label">شماره</label><input type="number" name="number" value="${q.number || ''}"></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">گزینه الف</label><input type="text" name="option_a" value="${helpers.escapeHtml(q.option_a || '')}"></div></div>
            <div class="col-2"><div class="form-group"><label class="field-label">قطب</label><input type="text" name="option_a_value" value="${helpers.escapeHtml(q.option_a_value || '')}" maxlength="1" dir="ltr"></div></div>
            <div class="col-6"><div class="form-group"><label class="field-label">گزینه ب</label><input type="text" name="option_b" value="${helpers.escapeHtml(q.option_b || '')}"></div></div>
            <div class="col-2"><div class="form-group"><label class="field-label">قطب</label><input type="text" name="option_b_value" value="${helpers.escapeHtml(q.option_b_value || '')}" maxlength="1" dir="ltr"></div></div>
            <div class="col-12"><label class="check"><input type="checkbox" name="is_active" value="1" ${q.is_active ? 'checked' : ''}><span class="check-label">سؤال فعال است</span></label></div>
          </div>`,
        }],
      },
    });
  } catch (err) { next(err); }
});

router.post('/questions/:id', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    await db.update('assessment_questions', {
      question_text: req.body.question_text, axis: String(req.body.axis || 'EI').toUpperCase(),
      number: Number(req.body.number) || null, option_a: req.body.option_a, option_a_value: req.body.option_a_value,
      option_b: req.body.option_b, option_b_value: req.body.option_b_value, is_active: req.body.is_active ? 1 : 0,
      updated_at: db.nowSql(),
    }, 'id = ?', [req.params.id]);
    await audit.log(req, { action: 'update', module: 'assessment', entity: 'assessment_questions', entityId: req.params.id, title: 'ویرایش سؤال MBTI' });
    req.setFlash('success', 'سؤال ذخیره شد.');
    res.redirect(`/assessment/questions?test=${req.body.test_id || ''}`);
  } catch (err) { next(err); }
});

router.post('/questions/:id/toggle', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    const q = await db.get(`SELECT * FROM ${db.t('assessment_questions')} WHERE id = ?`, [req.params.id]);
    if (!q) { req.setFlash('error', 'سؤال یافت نشد.'); return res.redirect('/assessment/questions'); }
    await db.run(`UPDATE ${db.t('assessment_questions')} SET is_active = ?, updated_at = ? WHERE id = ?`, [q.is_active ? 0 : 1, db.nowSql(), q.id]);
    req.setFlash('success', 'وضعیت سؤال تغییر کرد.');
    res.redirect(`/assessment/questions?test=${q.test_id}`);
  } catch (err) { next(err); }
});

router.post('/questions/:id/delete', mw.requireAuth(), P('assessment.questions.manage'), gate, async (req, res, next) => {
  try {
    const q = await db.get(`SELECT * FROM ${db.t('assessment_questions')} WHERE id = ?`, [req.params.id]);
    if (!q) { req.setFlash('error', 'سؤال یافت نشد.'); return res.redirect('/assessment/questions'); }
    await db.run(`DELETE FROM ${db.t('assessment_questions')} WHERE id = ?`, [q.id]);
    await audit.log(req, { action: 'delete', module: 'assessment', entity: 'assessment_questions', entityId: q.id, title: 'حذف سؤال MBTI' });
    req.setFlash('success', 'سؤال حذف شد.');
    res.redirect(`/assessment/questions?test=${q.test_id}`);
  } catch (err) { next(err); }
});

/* ============================ تخصیص آزمون ============================ */
router.get('/assignments', mw.requireAuth(), P('assessment.assign'), gate, async (req, res, next) => {
  try {
    const list = await db.query(
      `SELECT a.*, t.name AS test_name,
              e.full_name AS employee_name, e.personnel_code,
              ap.full_name AS applicant_name, ap.code AS applicant_code
         FROM ${db.t('assessment_assignments')} a
         LEFT JOIN ${db.t('assessment_tests')} t ON t.id = a.test_id
         LEFT JOIN ${db.t('employees')} e ON e.id = a.employee_id
         LEFT JOIN ${db.t('applications')} ap ON ap.id = a.application_id
        ORDER BY a.id DESC LIMIT 300`
    );
    const tests = await db.query(`SELECT id, name FROM ${db.t('assessment_tests')} WHERE is_active = 1`);
    const employees = await db.query(`SELECT id, full_name, personnel_code FROM ${db.t('employees')} WHERE deleted_at IS NULL AND status='active' ORDER BY full_name`);
    res.render('page', {
      title: 'تخصیص آزمون شخصیت‌شناسی',
      page: {
        icon: 'send',
        subtitle: HIDDEN,
        sections: [
          {
            type: 'form', action: '/assessment/assignments', submit: 'تخصیص و ارسال لینک', title: 'تخصیص آزمون به کارکنان',
            html: `<div class="form-row">
              <div class="col-4"><div class="form-group"><label class="field-label">آزمون</label><select name="test_id">${tests.map((t) => `<option value="${t.id}">${helpers.escapeHtml(t.name)}</option>`).join('')}</select></div></div>
              <div class="col-4"><div class="form-group"><label class="field-label">کارکنان</label><select name="employee_ids" multiple size="6">${employees.map((e) => `<option value="${e.id}">${helpers.escapeHtml(e.full_name)} ${e.personnel_code ? '(' + helpers.escapeHtml(e.personnel_code) + ')' : ''}</option>`).join('')}</select><span class="field-help">با Ctrl چند نفر را انتخاب کنید.</span></div></div>
              <div class="col-4"><div class="form-group"><label class="field-label">اعتبار لینک (روز)</label><input type="number" name="ttl_days" value="7" min="1" max="60">
              <label class="check mt-1"><input type="checkbox" name="send_sms" value="1" checked><span class="check-label">ارسال پیامک لینک آزمون</span></label></div></div>
            </div>`,
          },
          uikit.table(
            [{ label: 'آزمون' }, { label: 'شخص' }, { label: 'وضعیت' }, { label: 'تاریخ تخصیص' }, { label: 'انقضا' }, { label: 'لینک' }],
            list.map((a) => ({
              cells: [
                helpers.escapeHtml(a.test_name || ''),
                helpers.escapeHtml(a.employee_name || a.applicant_name || '—'),
                uikit.badge(a.status, a.status === 'completed' ? 'success' : a.status === 'pending' ? 'warning' : 'muted'),
                uikit.dateTime(a.created_at),
                uikit.date(a.expires_at),
                `<a class="link" href="/apply/assessment/${a.token}" target="_blank">باز کردن</a>`,
              ],
              actions: [
                { icon: 'eye', title: 'نتیجه (در صورت تکمیل)', url: `/assessment/assignments/${a.id}` },
                { icon: 'x', title: 'ابطال', url: `/assessment/assignments/${a.id}/cancel`, post: true, confirm: 'این تخصیص باطل شود؟' },
              ],
            })),
            { empty: 'تخصیصی ثبت نشده است.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

router.post('/assignments', mw.requireAuth(), P('assessment.assign'), gate, async (req, res, next) => {
  try {
    const test = await db.get(`SELECT * FROM ${db.t('assessment_tests')} WHERE id = ?`, [Number(req.body.test_id)]);
    if (!test) { req.setFlash('error', 'آزمون یافت نشد.'); return res.redirect('/assessment/assignments'); }
    const ids = []
      .concat(req.body.employee_ids || [])
      .concat(req.body.employee_ids ? [] : [])
      .map((v) => Number(v)).filter(Boolean);
    const ttl = Math.min(60, Math.max(1, Number(req.body.ttl_days) || 7));
    let count = 0;
    const base = require('./recruitment').baseUrl(req);
    for (const employeeId of ids) {
      const emp = await db.get(`SELECT * FROM ${db.t('employees')} WHERE id = ?`, [employeeId]);
      if (!emp) continue;
      const token = security.randomToken(14).replace(/[^a-zA-Z0-9]/g, '');
      await db.insert('assessment_assignments', {
        test_id: test.id, employee_id: emp.id, token, status: 'pending',
        expires_at: db.nowSql(new Date(Date.now() + ttl * 864e5)), created_by: req.user.id, created_at: db.nowSql(),
      });
      count += 1;
      if (req.body.send_sms && emp.mobile) {
        await sms.sendText(emp.mobile, `آزمون شخصیت‌شناسی:\n${base}/apply/assessment/${token}\nلطفاً در ${helpers.pnum(test.duration_minutes || 15)} دقیقه پاسخ دهید.`).catch(() => {});
      }
    }
    await audit.log(req, { action: 'create', module: 'assessment', entity: 'assessment_assignments', title: `تخصیص آزمون به ${count} نفر` });
    req.setFlash('success', `${helpers.pnum(count)} تخصیص ثبت و لینک ارسال شد.`);
    res.redirect('/assessment/assignments');
  } catch (err) { next(err); }
});

router.post('/assignments/:id/cancel', mw.requireAuth(), P('assessment.assign'), gate, async (req, res, next) => {
  try {
    await db.run(`UPDATE ${db.t('assessment_assignments')} SET status = 'canceled' WHERE id = ?`, [req.params.id]);
    req.setFlash('success', 'تخصیص باطل شد.');
    res.redirect('/assessment/assignments');
  } catch (err) { next(err); }
});

router.get('/assignments/:id', mw.requireAuth(), P('assessment.view_results'), gate, async (req, res, next) => {
  try {
    const a = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE id = ?`, [req.params.id]);
    if (!a) return res.status(404).render('errors/404', { title: 'تخصیص یافت نشد' });
    const result = await db.get(`SELECT * FROM ${db.t('assessment_results')} WHERE assignment_id = ? ORDER BY id DESC LIMIT 1`, [a.id]);
    if (!result) { req.setFlash('info', 'این آزمون هنوز تکمیل نشده است.'); return res.redirect('/assessment/assignments'); }
    res.redirect(`/assessment/results/${result.id}`);
  } catch (err) { next(err); }
});

/* ============================== نتایج ============================== */
router.get('/results', mw.requireAuth(), P('assessment.view_results'), gate, async (req, res, next) => {
  try {
    const where = ['1=1'];
    const params = [];
    if (req.query.test) { where.push('r.test_id = ?'); params.push(Number(req.query.test)); }
    if (req.query.type) { where.push('r.type_code = ?'); params.push(String(req.query.type).toUpperCase()); }
    const list = await db.query(
      `SELECT r.*, e.full_name AS employee_name, e.personnel_code, ap.full_name AS applicant_name, ap.code AS applicant_code,
              t.name AS test_name
         FROM ${db.t('assessment_results')} r
         LEFT JOIN ${db.t('employees')} e ON e.id = r.employee_id
         LEFT JOIN ${db.t('applications')} ap ON ap.id = r.application_id
         LEFT JOIN ${db.t('assessment_tests')} t ON t.id = r.test_id
        WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 300`,
      params
    );
    const dist = await db.query(`SELECT type_code, COUNT(*) AS c FROM ${db.t('assessment_results')} GROUP BY type_code ORDER BY c DESC`);
    res.render('page', {
      title: 'نتایج آزمون شخصیت‌شناسی',
      page: {
        icon: 'chart',
        subtitle: HIDDEN,
        alerts: [{ type: 'warning', text: 'دسترسی به این صفحه تنها برای منابع انسانی و مدیریت مجاز است. این اطلاعات در ارزیابی‌های استخدام و جانشین‌پروری استفاده می‌شود و نباید به داوطلب یا کارمند نشان داده شود.' }],
        bars: dist.map((d) => ({ label: `${d.type_code} (${helpers.pnum(d.c)})`, value: Number(d.c), color: 'primary' })),
        barsTitle: 'توزیع تیپ‌های شخصیتی',
        sections: [
          uikit.table(
            [{ label: 'نام' }, { label: 'تیپ' }, { label: 'گروه' }, { label: 'اعتماد' }, { label: 'آزمون' }, { label: 'تاریخ' }],
            list.map((r) => ({
              url: `/assessment/results/${r.id}`,
              cells: [
                `<a class="link strong" href="/assessment/results/${r.id}">${helpers.escapeHtml(r.employee_name || r.applicant_name || '—')}</a>`,
                `<span class="badge info" dir="ltr">${helpers.escapeHtml(r.type_code || '')}</span>`,
                helpers.escapeHtml(r.group_name || ''),
                uikit.badge(r.confidence, r.confidence === 'بالا' ? 'success' : r.confidence === 'پایین' ? 'danger' : 'warning'),
                helpers.escapeHtml(r.test_name || ''),
                uikit.dateTime(r.created_at),
              ],
              actions: [{ icon: 'eye', title: 'تحلیل کامل', url: `/assessment/results/${r.id}` }],
            })),
            { empty: 'نتیجه‌ای ثبت نشده است.' }
          ),
        ],
      },
    });
  } catch (err) { next(err); }
});

router.get('/results/:id', mw.requireAuth(), P('assessment.analysis.view'), gate, async (req, res, next) => {
  try {
    const r = await db.get(
      `SELECT r.*, e.full_name AS employee_name, e.personnel_code, e.hire_date, e.job_title_id,
              ap.full_name AS applicant_name, ap.code AS applicant_code, ap.job_req_id, j.title AS job_title
         FROM ${db.t('assessment_results')} r
         LEFT JOIN ${db.t('employees')} e ON e.id = r.employee_id
         LEFT JOIN ${db.t('applications')} ap ON ap.id = r.application_id
         LEFT JOIN ${db.t('job_reqs')} j ON j.id = ap.job_req_id
        WHERE r.id = ?`, [req.params.id]
    );
    if (!r) return res.status(404).render('errors/404', { title: 'نتیجه یافت نشد' });
    const answers = await db.query(
      `SELECT a.*, q.question_text FROM ${db.t('assessment_answers')} a
         LEFT JOIN ${db.t('assessment_questions')} q ON q.id = a.question_id
        WHERE a.assignment_id = ? ORDER BY q.number, a.id`, [r.assignment_id]
    ).catch(() => []);
    res.render('assessment/result', { title: `تحلیل شخصیتی ${r.employee_name || r.applicant_name || ''}`, r, answers, mbti, helpers, uikit, jalali, jobMatch: r.job_title ? mbti.jobFit(r.type_code, r.job_title) : null });
  } catch (err) { next(err); }
});

router.post('/results/:id/note', mw.requireAuth(), P('assessment.analysis.view'), gate, async (req, res, next) => {
  try {
    const r = await db.get(`SELECT * FROM ${db.t('assessment_results')} WHERE id = ?`, [req.params.id]);
    if (!r) return res.jsonErr('نتیجه یافت نشد.', 404);
    await db.run(`UPDATE ${db.t('assessment_results')} SET fit_notes = ?, risk_notes = ? WHERE id = ?`, [req.body.fit_notes || null, req.body.risk_notes || null, r.id]);
    await audit.log(req, { action: 'update', module: 'assessment', entity: 'assessment_results', entityId: r.id, title: 'ثبت یادداشت مدیریتی روی تحلیل شخصیتی' });
    req.setFlash('success', 'یادداشت ذخیره شد.');
    res.redirect(`/assessment/results/${r.id}`);
  } catch (err) { next(err); }
});

module.exports = router;
