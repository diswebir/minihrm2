'use strict';
/**
 * درگاه عمومی داوطلب استخدام
 * ----------------------------------------------------------------------------
 *  • ورود با QR/لینک دعوت + تأیید هویت با کد پیامکی (IPPanel)
 *  • فرم استخدام گام‌به‌گام (multi-step) با اجباری‌های تنظیم‌شده توسط منابع انسانی
 *  • آزمون شخصیت‌شناسی: داوطلب فقط سؤال‌ها را می‌بیند؛ نتیجه هرگز نمایش داده نمی‌شود
 *  • پیگیری وضعیت پرونده با کد رهگیری + شماره موبایل
 *  • صفحه فرصت‌های شغلی عمومی
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const helpers = require('../lib/helpers');
const jalali = require('../lib/jalali');
const security = require('../lib/security');
const mbti = require('../lib/mbti');
const settings = require('../lib/settings');
const audit = require('../lib/audit');
const modulesService = require('../services/modules');
const sms = require('../services/sms');
const notify = require('../lib/notify');
const qrcode = require('qrcode');
const filesRoutes = require('./files');
/** فرم گام‌به‌گام عمومی با enctype=multipart ارسال می‌شود */
const formBodyPublic = filesRoutes.upload.any();

const router = express.Router();
const APPLY_COOKIE = 'hrm_apply';
const OTP_PURPOSE = 'apply';

/* ------------------------------- ابزارها ------------------------------- */
function nowMs() { return Date.now(); }
const otpThrottle = new Map(); // key → آخرین زمان ارسال

function applyCookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: Boolean(config.load().app && config.load().app.secureCookies), maxAge: 12 * 3600 * 1000, path: '/' };
}
function setApplySession(res, value) { res.cookie(APPLY_COOKIE, security.sign(value), applyCookieOptions()); }
function getApplySession(req) {
  const raw = req.cookies ? req.cookies[APPLY_COOKIE] : null;
  if (!raw) return null;
  const value = security.unsign(raw);
  if (!value) return null;
  const [inviteId, token, verifiedAt] = String(value).split(':');
  return { inviteId: Number(inviteId), token, verifiedAt: Number(verifiedAt) || 0 };
}

async function findInvite(token) {
  const invite = await db.get(`SELECT * FROM ${db.t('recruitment_invites')} WHERE token = ?`, [token]);
  if (!invite) return { error: 'لینک دعوت معتبر نیست.' };
  if (invite.status === 'revoked') return { error: 'این لینک باطل شده است.' };
  if (invite.expires_at && new Date(String(invite.expires_at).replace(' ', 'T')) < new Date()) return { error: 'اعتبار این لینک به پایان رسیده است. لطفاً از منابع انسانی لینک جدید بگیرید.' };
  if (invite.max_uses && Number(invite.used_count) >= Number(invite.max_uses) && invite.status === 'used') return { error: 'این لینک قبلاً استفاده شده است.', used: true, invite };
  return { invite };
}

/** بارگذاری قالب فرم + بخش‌ها و فیلدهای فعال */
async function loadForm(templateId) {
  let template = templateId ? await db.get(`SELECT * FROM ${db.t('form_templates')} WHERE id = ?`, [templateId]) : null;
  if (!template) template = await db.get(`SELECT * FROM ${db.t('form_templates')} WHERE is_active = 1 ORDER BY is_default DESC, id LIMIT 1`);
  if (!template) return null;
  const sections = await db.query(`SELECT * FROM ${db.t('form_sections')} WHERE template_id = ? AND is_active = 1 ORDER BY sort_order`, [template.id]);
  const fields = await db.query(`SELECT * FROM ${db.t('form_fields')} WHERE template_id = ? AND is_enabled = 1 ORDER BY section_id, sort_order`, [template.id]);
  const steps = sections.map((s) => ({
    ...s,
    fields: fields.filter((f) => Number(f.section_id) === Number(s.id)),
  })).filter((s) => s.fields.length > 0);
  return { template, sections, fields, steps };
}

function parseOptions(field) {
  const opts = helpers.jsonParse(field.options, null);
  if (Array.isArray(opts)) return opts.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value || o.label, label: o.label || o.value }));
  return [];
}

/** نمایش خطای صفحه عمومی */
function publicError(res, title, message, status = 400) {
  return res.status(status).render('public/error', { layout: false, title, message });
}

/** پاسخ‌گویی به خطای اعتبارسنجی فرم (JSON یا ریدایرکت) */
function backWithErrors(req, res, errors, step) {
  if (req.xhr || (req.headers.accept || '').includes('json')) return res.jsonErr('لطفاً خطاهای فرم را برطرف کنید.', 422, { errors });
  req.setFlash('error', Object.values(errors).join(' — '));
  req.setFlash('old_errors', JSON.stringify(errors));
  if (step === 'review') return res.redirect(`/apply/${req.params.token}/review`);
  return res.redirect(`/apply/${req.params.token}/form?step=${step || 0}`);
}

/* ============================== لینک دعوت ============================== */
router.get('/:token([A-Za-z0-9]{8,64})', async (req, res, next) => {
  try {
    const { invite, error, used } = await findInvite(req.params.token);
    if (error && !used) return publicError(res, 'لینک نامعتبر', error, 410);
    if (!invite) {
      // وجود اپلیکیشن مرتبط با این توکن (بازگشت داوطلب)
      const app = await db.get(`SELECT a.*, i.token FROM ${db.t('applications')} a JOIN ${db.t('recruitment_invites')} i ON i.id = a.invite_id WHERE i.token = ?`, [req.params.token]);
      if (app) return res.redirect(`/apply/status?code=${encodeURIComponent(app.code || '')}`);
      return publicError(res, 'لینک نامعتبر', error || 'لینک یافت نشد.', 404);
    }
    const session = getApplySession(req);
    const verified = session && session.token === invite.token && session.verifiedAt > 0;
    if (invite.requires_otp && !verified) {
      return res.render('public/otp', {
        layout: false, title: 'تأیید هویت', invite,
        job: invite.job_req_id ? await db.get(`SELECT title FROM ${db.t('job_reqs')} WHERE id = ?`, [invite.job_req_id]) : null,
        company: await companyInfo(), step: 'request',
      });
    }
    if (String(invite.status) === 'used') {
      const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE invite_id = ? ORDER BY id DESC LIMIT 1`, [invite.id]);
      if (app) return res.redirect(`/apply/${invite.token}/done?code=${encodeURIComponent(app.code || '')}`);
    }
    res.redirect(`/apply/${invite.token}/form`);
  } catch (err) { next(err); }
});

async function companyInfo() {
  const c = config.load().company || {};
  const pick = async (key, fallback) => (await settings.get(key, '').catch(() => '')) || c[key] || fallback || '';
  return {
    name: await pick('name', 'شرکت'),
    logo: await pick('logo', ''),
    address: await pick('address', ''),
    phone: await pick('phone', ''),
    about: await pick('about', ''),
  };
}

/* ------------------------------ ورود با OTP ------------------------------ */
router.post('/:token([A-Za-z0-9]{8,64})/otp/request', async (req, res, next) => {
  try {
    const { invite, error } = await findInvite(req.params.token);
    if (!invite) return res.jsonErr(error || 'لینک نامعتبر است.', 410);
    const nationalId = jalali.toLatinDigits(String(req.body.national_id || '').trim());
    const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
    if (invite.national_id && nationalId && nationalId !== invite.national_id) return res.jsonErr('کد ملی با اطلاعات این دعوت‌نامه مطابقت ندارد.');
    if (invite.mobile && mobile && mobile !== invite.mobile) return res.jsonErr('شماره موبایل با اطلاعات این دعوت‌نامه مطابقت ندارد.');
    const target = invite.mobile || mobile;
    if (!/^09\d{9}$/.test(target)) return res.jsonErr('شماره موبایل معتبر نیست.');
    const key = `apply:${invite.id}:${target}`;
    const last = otpThrottle.get(key) || 0;
    if (nowMs() - last < 60000) return res.jsonErr(`کد قبلاً ارسال شده است؛ ${helpers.pnum(Math.ceil((60000 - (nowMs() - last)) / 1000))} ثانیه دیگر تلاش کنید.`);
    const out = await sms.issueOtp(target, OTP_PURPOSE, { name: invite.name, company: (config.load().company || {}).name || '' });
    otpThrottle.set(key, nowMs());
    await db.run(`UPDATE ${db.t('recruitment_invites')} SET status = CASE WHEN status = 'created' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?) WHERE id = ?`, [db.nowSql(), invite.id]).catch(() => {});
    if (!out.ok) return res.jsonErr(out.error || 'ارسال پیامک ناموفق بود.');
    return res.jsonOk({ message: out.debug ? 'حالت آزمایشی: کد تأیید روی صفحه نمایش داده می‌شود.' : 'کد تأیید ارسال شد.', mobile: target, debugCode: out.code || out.debugCode || null });
  } catch (err) { next(err); }
});

router.post('/:token([A-Za-z0-9]{8,64})/otp/verify', async (req, res, next) => {
  try {
    const { invite, error } = await findInvite(req.params.token);
    if (!invite) return res.jsonErr(error || 'لینک نامعتبر است.', 410);
    const code = jalali.toLatinDigits(String(req.body.code || '').trim());
    if (!/^\d{4,6}$/.test(code)) return res.jsonErr('کد تأیید را کامل وارد کنید.');
    const mobile = invite.mobile || jalali.toLatinDigits(String(req.body.mobile || '').trim());
    const out = await sms.verifyOtp(mobile, code, OTP_PURPOSE);
    if (!out.ok) return res.jsonErr(out.error || 'کد تأیید نادرست است.');
    setApplySession(res, `${invite.id}:${invite.token}:${nowMs()}`);
    await db.run(`UPDATE ${db.t('recruitment_invites')} SET status = CASE WHEN status IN ('created','sent') THEN 'opened' ELSE status END, opened_at = COALESCE(opened_at, ?) WHERE id = ?`, [db.nowSql(), invite.id]).catch(() => {});
    return res.jsonOk({ message: 'هویت شما تأیید شد.', redirect: `/apply/${invite.token}/form` });
  } catch (err) { next(err); }
});

/* ============================= فرم گام‌به‌گام ============================= */
async function requireVerified(req, res) {
  const { invite, error } = await findInvite(req.params.token);
  if (!invite) { publicError(res, 'لینک نامعتبر', error || 'لینک یافت نشد.', 410); return null; }
  if (invite.requires_otp) {
    const session = getApplySession(req);
    if (!(session && session.token === invite.token && session.verifiedAt)) {
      publicError(res, 'تأیید هویت لازم است', 'برای ورود به فرم، ابتدا هویت خود را با کد پیامکی تأیید کنید.', 403);
      return null;
    }
  }
  return invite;
}

/** خواندن پاسخ‌های ذخیره‌شده داوطلب */
async function loadAnswers(invite) {
  const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE invite_id = ? ORDER BY id DESC LIMIT 1`, [invite.id]);
  if (!app) return { app: null, answers: [], files: {} };
  const answers = await db.query(`SELECT * FROM ${db.t('application_answers')} WHERE application_id = ? ORDER BY row_index, sort_order, id`, [app.id]);
  return { app, answers, files: {} };
}

router.get('/:token([A-Za-z0-9]{8,64})/form', async (req, res, next) => {
  try {
    const invite = await requireVerified(req, res);
    if (!invite) return;
    const form = await loadForm(invite.form_template_id);
    if (!form) return publicError(res, 'فرمی موجود نیست', 'هنوز قالب فرم استخدامی فعال نشده است. لطفاً با منابع انسانی تماس بگیرید.', 503);
    const stepIndex = Math.max(0, Math.min(form.steps.length - 1, Number(req.query.step) || 0));
    const { app, answers } = await loadAnswers(invite);
    const jobs = await db.query(`SELECT id, title FROM ${db.t('job_reqs')} WHERE deleted_at IS NULL AND status = 'open' ORDER BY id DESC`);
    const company = await companyInfo();
    const job = invite.job_req_id ? await db.get(`SELECT id, title FROM ${db.t('job_reqs')} WHERE id = ?`, [invite.job_req_id]) : null;
    const assessmentOn = await modulesService.isEnabled('assessment').catch(() => true);
    res.render('public/form', {
      layout: false, title: 'فرم استخدام', invite, form, stepIndex, step: form.steps[stepIndex],
      app, answers, jobs, company, job, assessmentOn,
      progress: Math.round(((stepIndex) / form.steps.length) * 100),
      saved: req.query.saved === '1',
      mbtiQuestionsCount: 0,
    });
  } catch (err) { next(err); }
});

/** ذخیره یک گام (بخش) از فرم */
router.post('/:token([A-Za-z0-9]{8,64})/form', formBodyPublic, async (req, res, next) => {
  try {
    const invite = await requireVerified(req, res);
    if (!invite) return;
    const form = await loadForm(invite.form_template_id);
    if (!form) return publicError(res, 'فرمی موجود نیست', 'قالب فرم یافت نشد.', 503);
    const stepIndex = Math.max(0, Number(req.body.step) || 0);
    const section = form.steps[stepIndex];
    if (!section) return res.redirect(`/apply/${invite.token}/form`);

    // اپلیکیشن (پیش‌نویس) را بساز یا بیاب
    let app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE invite_id = ? ORDER BY id DESC LIMIT 1`, [invite.id]);
    const maxRow = Number((await db.get(`SELECT COALESCE(MAX(row_index),0) AS m FROM ${db.t('application_answers')} WHERE application_id = ? AND section_id = ?`, [app ? app.id : 0, section.id]).catch(() => ({ m: 0 }))).m);

    const errors = {};
    const collected = [];
    for (const f of section.fields) {
      const rows = section.is_repeatable ? Math.max(1, maxRow + 1, 1) : 1;
      for (let r = 0; r < rows; r += 1) {
        const name = r === 0 ? `f_${f.fkey}` : `f_${f.fkey}__${r}`;
        let value = req.body[name];
        if (Array.isArray(value)) value = value.filter(Boolean).join(',');
        const isEmpty = value === undefined || value === null || String(value).trim() === '';
        if (f.is_required && isEmpty && r === 0) errors[f.fkey] = `«${f.label}» الزامی است.`;
        if (isEmpty) continue;
        if (f.type === 'national_id' && !/^\d{10}$/.test(jalali.toLatinDigits(String(value).trim()))) errors[f.fkey] = `«${f.label}» باید ۱۰ رقم باشد.`;
        if (f.type === 'phone' && !/^09\d{9}$/.test(jalali.toLatinDigits(String(value).trim()))) errors[f.fkey] = `«${f.label}» معتبر نیست (مثل 09123456789).`;
        if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())) errors[f.fkey] = `«${f.label}» ایمیل معتبر نیست.`;
        collected.push({ field: f, row: r, value: String(value).trim(), file: f.type === 'file' ? String(value).trim() : null });
      }
    }
    if (Object.keys(errors).length) return backWithErrors(req, res, errors, stepIndex);

    // ایجاد/به‌روزرسانی پیش‌نویس
    const identity = {};
    collected.forEach((c) => {
      const v = c.value;
      if (['first_name', 'last_name', 'national_id', 'mobile', 'email', 'city', 'birth_date', 'gender', 'marital_status', 'education_level', 'field_of_study'].includes(c.field.fkey)) identity[c.field.fkey] = v;
    });
    if (!app) {
      const code = await nextApplicationCode();
      const fullName = [identity.first_name, identity.last_name].filter(Boolean).join(' ');
      const id = await db.insert('applications', {
        code, job_req_id: invite.job_req_id || null,
        full_name: fullName || invite.name || 'داوطلب', first_name: identity.first_name || invite.name || '', last_name: identity.last_name || '',
        national_id: identity.national_id || invite.national_id || null, mobile: identity.mobile || invite.mobile || req.body.mobile || null,
        email: identity.email || null, city: identity.city || null, birth_date: identity.birth_date || null,
        gender: identity.gender || null, marital_status: identity.marital_status || null,
        education_level: identity.education_level || null, field_of_study: identity.field_of_study || null,
        source: 'qr_invite', status: 'in_progress', stage_key: (await firstStageKey()), invite_id: invite.id,
        form_template_id: form.template.id, form_progress: 0, created_at: db.nowSql(), updated_at: db.nowSql(),
      });
      app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [id]);
      await db.run(`UPDATE ${db.t('recruitment_invites')} SET status = 'in_progress' WHERE id = ?`, [invite.id]).catch(() => {});
    } else {
      const patch = { form_template_id: form.template.id, updated_at: db.nowSql() };
      Object.entries(identity).forEach(([k, v]) => { patch[k] = v; });
      if (identity.first_name || identity.last_name) patch.full_name = [identity.first_name || app.first_name, identity.last_name || app.last_name].filter(Boolean).join(' ');
      await db.update('applications', patch, 'id = ?', [app.id]);
    }

    // ذخیره پاسخ‌ها (حذف قبلی‌ها و درج مجدد برای همان بخش)
    await db.run(`DELETE FROM ${db.t('application_answers')} WHERE application_id = ? AND section_id = ?`, [app.id, section.id]);
    let order = 0;
    for (const c of collected) {
      order += 1;
      await db.insert('application_answers', {
        application_id: app.id, field_id: c.field.id, fkey: c.field.fkey, section_id: section.id,
        label: c.field.label, value: c.value, file: c.file, row_index: c.row, sort_order: order, updated_at: db.nowSql(),
      });
    }
    const answered = await countAnswered(app.id);
    const totalFields = form.fields.length;
    const progress = Math.min(99, Math.round((answered / Math.max(1, totalFields)) * 100));
    await db.run(`UPDATE ${db.t('applications')} SET form_progress = ?, updated_at = ? WHERE id = ?`, [progress, db.nowSql(), app.id]);

    const nextStep = stepIndex + 1;
    if (nextStep >= form.steps.length) return res.redirect(`/apply/${invite.token}/review${req.body.ajax ? '?json=1' : ''}`);
    return res.redirect(`/apply/${invite.token}/form?step=${nextStep}${req.body.ajax ? '&json=1' : ''}`);
  } catch (err) { next(err); }
});

async function countAnswered(applicationId) {
  const row = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('application_answers')} WHERE application_id = ?`, [applicationId]).catch(() => ({ c: 0 }));
  return Number(row.c);
}
async function nextApplicationCode() {
  const row = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('applications')}`).catch(() => ({ c: 0 }));
  const n = Number(row.c) + 1;
  return `APP-${jalali.toJalaali(new Date()).jy}${String(n).padStart(4, '0')}`;
}
async function firstStageKey() {
  const s = await db.get(`SELECT key FROM ${db.t('recruitment_stages')} WHERE is_active = 1 ORDER BY sort_order LIMIT 1`).catch(() => null);
  return s ? s.key : 'new';
}

/* ------------------------------ بازبینی و ارسال ------------------------------ */
router.get('/:token([A-Za-z0-9]{8,64})/review', async (req, res, next) => {
  try {
    const invite = await requireVerified(req, res);
    if (!invite) return;
    const form = await loadForm(invite.form_template_id);
    const { app, answers } = await loadAnswers(invite);
    const groups = [];
    const bySection = {};
    answers.forEach((a) => {
      const key = a.section_id || 0;
      (bySection[key] = bySection[key] || []).push(a);
    });
    (form ? form.sections : []).forEach((s) => { if (bySection[s.id]) groups.push({ title: s.title, icon: s.icon, rows: bySection[s.id] }); });
    const missing = [];
    if (form) {
      const answeredKeys = new Set(answers.map((a) => a.fkey));
      form.fields.filter((f) => f.is_required && !answeredKeys.has(f.fkey)).forEach((f) => missing.push(f.label));
    }
    res.render('public/review', {
      layout: false, title: 'بازبینی و ارسال', invite, form, app, groups, missing,
      company: await companyInfo(),
      consentText: await settings.get('recruitment.consent_text', ''),
    });
  } catch (err) { next(err); }
});

router.post('/:token([A-Za-z0-9]{8,64})/submit', async (req, res, next) => {
  try {
    const invite = await requireVerified(req, res);
    if (!invite) return;
    if (!req.body.consent) return backWithErrors(req, res, { consent: 'برای ارسال، تأیید صحت اطلاعات الزامی است.' }, 'review');
    const form = await loadForm(invite.form_template_id);
    const { app, answers } = await loadAnswers(invite);
    if (!app) return res.redirect(`/apply/${invite.token}/form`);
    const answeredKeys = new Set(answers.map((a) => a.fkey));
    const missing = form ? form.fields.filter((f) => f.is_required && !answeredKeys.has(f.fkey)).map((f) => f.label) : [];
    if (missing.length) {
      req.setFlash('error', `تکمیل این موارد الزامی است: ${missing.join('، ')}`);
      return res.redirect(`/apply/${invite.token}/form`);
    }
    await db.update('applications', {
      status: 'submitted', stage_key: (await firstStageKey()), submitted_at: db.nowSql(),
      form_progress: 100, updated_at: db.nowSql(),
    }, 'id = ?', [app.id]);
    await db.run(`UPDATE ${db.t('recruitment_invites')} SET status = 'submitted', used_count = used_count + 1, last_seen_at = ? WHERE id = ?`, [db.nowSql(), invite.id]);
    await db.run(`DELETE FROM ${db.t('application_answers')} WHERE application_id = ? AND fkey = 'consent'`, [app.id]).catch(() => {});

    // آزمون شخصیت‌شناسی (در صورت فعال بودن ماژول و آزمون فعال)
    let assessmentToken = null;
    const assessmentOn = await modulesService.isEnabled('assessment').catch(() => true);
    if (assessmentOn && req.body.start_assessment !== '0') {
      const test = await db.get(`SELECT * FROM ${db.t('assessment_tests')} WHERE is_active = 1 ORDER BY id LIMIT 1`).catch(() => null);
      if (test) {
        const token = security.randomToken(14).replace(/[^a-zA-Z0-9]/g, '');
        await db.insert('assessment_assignments', {
          test_id: test.id, application_id: app.id, token, status: 'pending',
          expires_at: db.nowSql(new Date(Date.now() + 3 * 864e5)), created_at: db.nowSql(),
        });
        assessmentToken = token;
      }
    }
    const notifyTitle = `فرم استخدام تکمیل شد: ${app.full_name}`;
    await notify.notifyHr(notifyTitle, `داوطلب «${app.full_name}» فرم استخدام را تکمیل کرد.`, `/recruitment/applications/${app.id}`);
    await audit.log(req, { action: 'create', module: 'recruitment', entity: 'applications', entityId: app.id, title: `تکمیل فرم استخدام ${app.full_name} (${app.code})`, userLabel: app.full_name });
    res.redirect(`/apply/${invite.token}/done?code=${encodeURIComponent(app.code || '')}${assessmentToken ? `&assessment=${assessmentToken}` : ''}`);
  } catch (err) { next(err); }
});

router.get('/:token([A-Za-z0-9]{8,64})/done', async (req, res, next) => {
  try {
    const invite = await db.get(`SELECT * FROM ${db.t('recruitment_invites')} WHERE token = ?`, [req.params.token]);
    const app = invite ? await db.get(`SELECT * FROM ${db.t('applications')} WHERE invite_id = ? ORDER BY id DESC LIMIT 1`, [invite.id]) : null;
    const assessmentOn = await modulesService.isEnabled('assessment').catch(() => true);
    let assessment = null;
    if (assessmentOn && app) {
      assessment = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE application_id = ? ORDER BY id DESC LIMIT 1`, [app.id]).catch(() => null);
      if (assessment && assessment.status === 'completed') assessment = null;
    }
    res.render('public/done', {
      layout: false, title: 'ارسال موفق', invite, app, company: await companyInfo(),
      assessment, assessmentOn, code: req.query.code || (app && app.code) || '',
    });
  } catch (err) { next(err); }
});

/* ============================ آزمون شخصیت‌شناسی ============================ */
router.get('/assessment/:token', async (req, res, next) => {
  try {
    const a = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE token = ?`, [req.params.token]);
    if (!a) return publicError(res, 'لینک آزمون نامعتبر', 'این لینک آزمون معتبر نیست.', 404);
    if (a.status === 'completed') return res.render('public/assessment-done', { layout: false, title: 'آزمون تکمیل شده', done: true, company: await companyInfo() });
    const expired = a.expires_at && new Date(String(a.expires_at).replace(' ', 'T')) < new Date();
    if (expired) return publicError(res, 'اعتبار آزمون تمام شده', 'زمان این آزمون به پایان رسیده است. لطفاً از منابع انسانی بخواهید لینک جدید صادر کند.', 410);
    const test = await db.get(`SELECT * FROM ${db.t('assessment_tests')} WHERE id = ?`, [a.test_id]);
    const total = Number((await db.get(`SELECT COUNT(*) AS c FROM ${db.t('assessment_questions')} WHERE test_id = ? AND is_active = 1`, [a.test_id])).c);
    res.render('public/assessment-intro', { layout: false, title: 'آزمون شخصیت‌شناسی', assignment: a, test, total, company: await companyInfo(), done: false, duration: (test && Number(test.duration_minutes)) || 20 });
  } catch (err) { next(err); }
});

router.post('/assessment/:token/start', async (req, res, next) => {
  try {
    const a = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE token = ?`, [req.params.token]);
    if (!a) return res.jsonErr('لینک آزمون نامعتبر است.', 404);
    await db.run(`UPDATE ${db.t('assessment_assignments')} SET status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END, started_at = COALESCE(started_at, ?) WHERE id = ?`, [db.nowSql(), a.id]);
    res.jsonOk({ redirect: `/apply/assessment/${a.token}/test` });
  } catch (err) { next(err); }
});

router.get('/assessment/:token/test', async (req, res, next) => {
  try {
    const a = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE token = ?`, [req.params.token]);
    if (!a) return publicError(res, 'لینک آزمون نامعتبر', 'این لینک معتبر نیست.', 404);
    const test = await db.get(`SELECT * FROM ${db.t('assessment_tests')} WHERE id = ?`, [a.test_id]);
    let questions = await db.query(`SELECT id, number, question_text, axis, option_a, option_a_value, option_b, option_b_value, help_text FROM ${db.t('assessment_questions')} WHERE test_id = ? AND is_active = 1 ORDER BY COALESCE(sort_order, number), id`, [a.test_id]);
    if (test && Number(test.question_count) > 0) questions = questions.slice(0, Number(test.question_count));
    const answered = await db.query(`SELECT question_id, choice FROM ${db.t('assessment_answers')} WHERE assignment_id = ?`, [a.id]).catch(() => []);
    res.render('public/assessment-test', {
      layout: false, title: 'آزمون شخصیت‌شناسی', assignment: a, test, questions,
      answered: answered.reduce((m, x) => { m[x.question_id] = x.choice; return m; }, {}),
      company: await companyInfo(), duration: (test && Number(test.duration_minutes)) || 20,
    });
  } catch (err) { next(err); }
});

router.post('/assessment/:token/answer', async (req, res, next) => {
  try {
    const a = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE token = ?`, [req.params.token]);
    if (!a) return res.jsonErr('لینک آزمون نامعتبر است.', 404);
    if (a.status === 'completed') return res.jsonOk({ done: true, message: 'آزمون قبلاً تکمیل شده است.' });
    const questionId = Number(req.body.question_id);
    const choice = String(req.body.choice || '').toUpperCase();
    if (!questionId || !['A', 'B'].includes(choice)) return res.jsonErr('پاسخ نامعتبر است.');
    const q = await db.get(`SELECT * FROM ${db.t('assessment_questions')} WHERE id = ?`, [questionId]);
    if (!q) return res.jsonErr('سؤال یافت نشد.', 404);
    const value = choice === 'A' ? q.option_a_value : q.option_b_value;
    const existing = await db.get(`SELECT id FROM ${db.t('assessment_answers')} WHERE assignment_id = ? AND question_id = ?`, [a.id, questionId]);
    if (existing) await db.update('assessment_answers', { choice, value, axis: q.axis }, 'id = ?', [existing.id]);
    else await db.insert('assessment_answers', { assignment_id: a.id, question_id: questionId, choice, value, axis: q.axis, created_at: db.nowSql() });
    const count = Number((await db.get(`SELECT COUNT(*) AS c FROM ${db.t('assessment_answers')} WHERE assignment_id = ?`, [a.id])).c);
    await db.run(`UPDATE ${db.t('assessment_assignments')} SET answer_count = ?, status = 'in_progress' WHERE id = ?`, [count, a.id]);
    res.jsonOk({ message: 'ثبت شد', count });
  } catch (err) { next(err); }
});

router.post('/assessment/:token/finish', async (req, res, next) => {
  try {
    const a = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE token = ?`, [req.params.token]);
    if (!a) return res.jsonErr('لینک آزمون نامعتبر است.', 404);
    const questions = await db.query(`SELECT * FROM ${db.t('assessment_questions')} WHERE test_id = ? AND is_active = 1`, [a.test_id]);
    const answers = await db.query(`SELECT * FROM ${db.t('assessment_answers')} WHERE assignment_id = ?`, [a.id]);
    if (answers.length < Math.max(4, Math.floor(questions.length * 0.6))) {
      return res.jsonErr(`پاسخ ${helpers.pnum(answers.length)} سؤال از ${helpers.pnum(questions.length)} ثبت شده است؛ لطفاً همه سؤالات را پاسخ دهید.`);
    }
    const analysis = mbti.analyze(answers, questions);
    const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split('\n').map((s) => s.trim()).filter(Boolean));
    const jobTitle = a.application_id
      ? (await db.get(`SELECT j.title FROM ${db.t('applications')} ap LEFT JOIN ${db.t('job_reqs')} j ON j.id = ap.job_req_id WHERE ap.id = ?`, [a.application_id]) || {}).title
      : null;
    const resultId = await db.insert('assessment_results', {
      assignment_id: a.id, test_id: a.test_id, application_id: a.application_id || null, employee_id: a.employee_id || null,
      type_code: analysis.type_code, group_name: analysis.group_name,
      axis_scores: JSON.stringify(analysis.axis_scores), percentages: JSON.stringify(analysis.percentages),
      closeness: JSON.stringify(analysis.axes_detail || []), confidence: analysis.confidence,
      borderline_axes: JSON.stringify(analysis.borderline_axes || []), summary: analysis.summary,
      strengths: JSON.stringify(listOf(analysis.strengths)), watchouts: JSON.stringify(listOf(analysis.watchouts)),
      communication: analysis.communication, leadership: analysis.leadership, motivation: analysis.motivation,
      suggestions: JSON.stringify(listOf(analysis.suggestions)), fit_notes: analysis.fit_notes,
      job_fit: JSON.stringify(jobTitle ? [{ title: jobTitle, fit: mbti.jobFit(analysis.type_code, jobTitle) }] : []),
      risk_notes: analysis.risk_notes, created_at: db.nowSql(),
    });
    await db.run(`UPDATE ${db.t('assessment_assignments')} SET status = 'completed', completed_at = ?, answer_count = ? WHERE id = ?`, [db.nowSql(), answers.length, a.id]);
    if (a.application_id) {
      await db.run(`UPDATE ${db.t('applications')} SET updated_at = ? WHERE id = ?`, [db.nowSql(), a.application_id]);
      const app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE id = ?`, [a.application_id]);
      await notify.notifyHr(`آزمون شخصیت‌شناسی تکمیل شد: ${app ? app.full_name : ''}`, 'تحلیل شخصیتی در پرونده داوطلب آماده است (محرمانه).', `/recruitment/applications/${a.application_id}`);
    }
    await audit.log(req, { action: 'create', module: 'assessment', entity: 'assessment_results', entityId: resultId, title: 'تکمیل آزمون شخصیت‌شناسی' });
    res.jsonOk({ message: 'آزمون با موفقیت ثبت شد.', redirect: `/apply/assessment/${a.token}/thanks` });
  } catch (err) { next(err); }
});

router.get('/assessment/:token/thanks', async (req, res, next) => {
  try {
    const a = await db.get(`SELECT * FROM ${db.t('assessment_assignments')} WHERE token = ?`, [req.params.token]);
    const test = a ? await db.get(`SELECT * FROM ${db.t('assessment_tests')} WHERE id = ?`, [a.test_id]) : null;
    res.render('public/assessment-done', {
      layout: false, title: 'آزمون تکمیل شد', company: await companyInfo(), test, done: true,
      thanks: (test && test.thanks_text) || 'از وقتی که گذاشتید سپاسگزاریم. نتیجه آزمون توسط کارشناسان منابع انسانی بررسی می‌شود.',
    });
  } catch (err) { next(err); }
});

/* =============================== پیگیری وضعیت =============================== */
router.get('/status', async (req, res, next) => {
  try {
    const code = String(req.query.code || '').trim();
    const mobile = jalali.toLatinDigits(String(req.query.mobile || '').trim());
    let app = null;
    let stages = [];
    let logs = [];
    if (code || mobile) {
      const where = [];
      const params = [];
      if (code) { where.push('code = ?'); params.push(code); }
      if (mobile) { where.push('mobile = ?'); params.push(mobile); }
      app = await db.get(`SELECT * FROM ${db.t('applications')} WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 1`, params);
      if (app) {
        stages = await db.query(`SELECT * FROM ${db.t('recruitment_stages')} WHERE is_active = 1 ORDER BY sort_order`);
        logs = await db.query(`SELECT * FROM ${db.t('application_stage_log')} WHERE application_id = ? ORDER BY id DESC`, [app.id]).catch(() => []);
      }
    }
    res.render('public/status', {
      layout: false, title: 'پیگیری وضعیت پرونده', app, stages, logs, code, mobile,
      company: await companyInfo(),
      job: app && app.job_req_id ? await db.get(`SELECT title FROM ${db.t('job_reqs')} WHERE id = ?`, [app.job_req_id]) : null,
      notFound: Boolean((code || mobile) && !app),
    });
  } catch (err) { next(err); }
});

/* ============================ فرصت‌های شغلی ============================ */
async function careersData(req) {
  const allowPublicApply = await settings.getBool('recruitment.allow_public_apply', true);
  const jobs = await db.query(`SELECT * FROM ${db.t('job_reqs')} WHERE deleted_at IS NULL AND status = 'open' ORDER BY id DESC`);
  return { allowPublicApply, jobs };
}

router.get('/', async (req, res, next) => {
  try {
    const { allowPublicApply, jobs } = await careersData(req);
    res.render('public/apply', { layout: false, title: 'فرصت‌های شغلی', jobs, allowPublicApply, company: await companyInfo(), jobsCount: jobs.length });
  } catch (err) { next(err); }
});

/** ثبت درخواست بدون دعوت‌نامه (ورود مستقیم از سایت) */
router.post('/direct', async (req, res, next) => {
  try {
    const allowPublicApply = await settings.getBool('recruitment.allow_public_apply', true);
    if (!allowPublicApply) return res.jsonErr('ثبت درخواست آنلاین در حال حاضر غیرفعال است.', 403);
    const mobile = jalali.toLatinDigits(String(req.body.mobile || '').trim());
    if (!/^09\d{9}$/.test(mobile)) return res.jsonErr('شماره موبایل معتبر وارد کنید.');
    const jobId = Number(req.body.job_req_id) || null;
    const nationalId = jalali.toLatinDigits(String(req.body.national_id || '').trim()) || null;
    const existing = await db.get(`SELECT * FROM ${db.t('applications')} WHERE mobile = ? AND status NOT IN ('rejected') ORDER BY id DESC LIMIT 1`, [mobile]);
    if (existing) return res.jsonOk({ message: 'شما قبلاً درخواست ثبت کرده‌اید.', redirect: `/apply/status?code=${encodeURIComponent(existing.code || '')}&mobile=${mobile}` });
    // دعوت‌نامهٔ خودکار برای ادامهٔ فرم گام‌به‌گام
    const form = await loadForm(null);
    const token = security.randomToken(16).replace(/[^a-zA-Z0-9]/g, '');
    const inviteId = await db.insert('recruitment_invites', {
      token, job_req_id: jobId, name: req.body.name || null, mobile, national_id: nationalId,
      purpose: 'form', form_template_id: form ? form.template.id : null, status: 'opened', max_uses: 1, used_count: 0,
      requires_otp: 0, expires_at: db.nowSql(new Date(Date.now() + 14 * 864e5)), created_at: db.nowSql(),
    });
    await audit.log(req, { action: 'create', module: 'recruitment', entity: 'recruitment_invites', entityId: inviteId, title: `درخواست آنلاین از سایت (${mobile})`, userLabel: 'داوطلب' });
    res.jsonOk({ message: 'ثبت شد؛ اکنون فرم استخدام را تکمیل کنید.', redirect: `/apply/${token}/form` });
  } catch (err) { next(err); }
});

/* ------------------------------- بارگذاری فایل ------------------------------- */
/** بارگذاری فایل توسط داوطلب (فقط با توکن دعوت معتبر) */
router.post('/upload', filesRoutes.upload.single('file'), async (req, res, next) => {
  try {
    const token = String((req.body && req.body.token) || req.query.token || '').trim();
    const { invite, error } = token ? await findInvite(token) : { error: 'توکن ارسال نشد.' };
    if (!invite) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.jsonErr(error || 'اجازه بارگذاری ندارید.', 403);
    }
    if (!req.file) return res.jsonErr('فایلی دریافت نشد.');
    const rel = path.relative(filesRoutes.UPLOAD_DIR, req.file.path).split(path.sep).join('/');
    res.jsonOk({ file: rel, name: req.file.originalname, size: req.file.size });
  } catch (err) { next(err); }
});

/* -------------------------- چاپ کارت QR فرصت‌ها -------------------------- */
router.get('/jobs/:id/qr.png', async (req, res, next) => {
  try {
    const job = await db.get(`SELECT * FROM ${db.t('job_reqs')} WHERE id = ?`, [req.params.id]);
    if (!job) return res.status(404).end();
    const cfg = config.load() || {};
    const base = ((cfg.app || {}).publicUrl) || ((cfg.company || {}).publicUrl) || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${String(base).replace(/\/+$/, '')}/apply?job=${job.id}`;
    const buf = await qrcode.toBuffer(url, { width: 600, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.companyInfo = companyInfo;
module.exports.loadForm = loadForm;
