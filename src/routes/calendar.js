'use strict';
/**
 * تقویم سازمانی (مسیر /calendar)
 * ----------------------------------------------------------------------------
 * نمای ماهانه شمسی از رویدادهای سازمان: تعطیلات رسمی، مرخصی‌های تأییدشده،
 * مأموریت‌ها، رویدادهای رفاهی، مجامع، قراردادها/مجوزهای در آستانه سررسید و
 * کارهای دارای سررسید. همه داده‌ها از ماژول‌های سامانه خوانده می‌شود.
 */
const express = require('express');
const db = require('../db');
const mw = require('../middleware');
const jalali = require('../lib/jalali');
const helpers = require('../lib/helpers');
const auth = require('../services/auth');

const router = express.Router();

const WEEK_START = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function safeQuery(sql, params = []) {
  try { return await db.query(sql, params); } catch (_) { return []; }
}

router.get('/', mw.requireAuth(), mw.requirePasswordChange(), async (req, res, next) => {
  try {
    const today = new Date();
    const tj = jalali.toJalaali(today);
    let jy = Number(req.query.y) || tj.jy;
    let jm = Number(req.query.m) || tj.jm;
    if (jm < 1) { jm = 12; jy -= 1; }
    if (jm > 12) { jm = 1; jy += 1; }
    if (jy < 1300) jy = 1300;
    if (jy > 1500) jy = 1500;

    const range = jalali.jalaaliMonthRange(jy, jm);
    const startIso = iso(range.start);
    const endIso = iso(range.end);
    const daysInMonth = Math.round((range.end - range.start) / 86400000) + 1;
    const firstCol = (range.start.getDay() + 1) % 7; // شنبه = ستون اول

    const can = (perm) => auth.can(req.user, perm);
    const events = {}; // 'YYYY-MM-DD' → [{ label, type, color, url }]
    const push = (date, ev) => {
      const key = String(date || '').slice(0, 10);
      if (!key || key < startIso || key > endIso) return;
      (events[key] = events[key] || []).push(ev);
    };

    const [holidays, leaves, missions, welfareEvents, meetings, renewals, licenses, tasks] = await Promise.all([
      safeQuery(`SELECT title, gdate, jdate FROM ${db.t('holidays')} WHERE gdate BETWEEN ? AND ?`, [startIso, endIso]),
      safeQuery(`SELECT lr.from_date, lr.to_date, lr.days, e.first_name, e.last_name, lt.name AS type_title
                   FROM ${db.t('leave_requests')} lr
                   LEFT JOIN ${db.t('employees')} e ON e.id = lr.employee_id
                   LEFT JOIN ${db.t('leave_types')} lt ON lt.id = lr.leave_type_id
                  WHERE lr.status = 'approved' AND lr.deleted_at IS NULL AND lr.from_date <= ? AND lr.to_date >= ?`, [endIso, startIso]),
      safeQuery(`SELECT m.title, m.destination, m.from_date, m.to_date, e.first_name, e.last_name
                   FROM ${db.t('missions')} m LEFT JOIN ${db.t('employees')} e ON e.id = m.employee_id
                  WHERE m.deleted_at IS NULL AND m.from_date <= ? AND m.to_date >= ?`, [endIso, startIso]),
      safeQuery(`SELECT title, start_date, end_date, location FROM ${db.t('welfare_events')}
                  WHERE deleted_at IS NULL AND start_date <= ? AND COALESCE(end_date, start_date) >= ?`, [endIso, startIso]),
      safeQuery(`SELECT title, meeting_date FROM ${db.t('general_meetings')} WHERE deleted_at IS NULL AND meeting_date BETWEEN ? AND ?`, [startIso, endIso]),
      safeQuery(`SELECT title, renewal_date, expiry_date FROM ${db.t('licenses')} WHERE deleted_at IS NULL AND (renewal_date BETWEEN ? AND ? OR expiry_date BETWEEN ? AND ?)`, [startIso, endIso, startIso, endIso]),
      safeQuery(`SELECT title, next_hearing FROM ${db.t('legal_cases')} WHERE deleted_at IS NULL AND next_hearing BETWEEN ? AND ?`, [startIso, endIso]),
      safeQuery(`SELECT title, due_date, status FROM ${db.t('tasks')} WHERE deleted_at IS NULL AND status <> 'done' AND due_date BETWEEN ? AND ?`, [startIso, endIso]),
    ]);

    holidays.forEach((h) => push(h.gdate, { label: h.title || 'تعطیل', type: 'holiday', color: 'danger', url: can('attendance.view') ? '/attendance/holidays' : null }));
    meetings.forEach((m) => push(m.meeting_date, { label: m.title || 'مجمع', type: 'meeting', color: 'purple', url: can('shareholders.meeting.manage') ? '/shareholders/meetings' : null }));
    renewals.forEach((l) => push(l.renewal_date || l.expiry_date, { label: `تمدید/انقضا: ${l.title || ''}`, type: 'license', color: 'warning', url: can('licensing.view') ? '/licensing/list' : null }));
    licenses.forEach((l) => push(l.next_hearing, { label: `جلسه دادگاه: ${l.title || ''}`, type: 'legal', color: 'danger', url: can('legal.view') ? '/legal/cases' : null }));
    tasks.forEach((t) => push(t.due_date, { label: `سررسید کار: ${t.title || ''}`, type: 'task', color: 'info', url: can('announcements.view') ? '/tasks' : null }));
    welfareEvents.forEach((e) => {
      const from = new Date(String(e.start_date).slice(0, 10));
      const to = new Date(String(e.end_date || e.start_date).slice(0, 10));
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        push(iso(d), { label: `رویداد: ${e.title || ''}`, type: 'event', color: 'success', url: can('welfare.view') ? '/welfare/events' : null });
      }
    });
    if (can('attendance.view')) {
      leaves.forEach((l) => {
        const from = new Date(String(l.from_date).slice(0, 10));
        const to = new Date(String(l.to_date).slice(0, 10));
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          push(iso(d), {
            label: `مرخصی ${l.type_title || ''}: ${`${l.first_name || ''} ${l.last_name || ''}`.trim()}`,
            type: 'leave', color: 'primary', url: '/attendance/leaves',
          });
        }
      });
      missions.forEach((m) => {
        const from = new Date(String(m.from_date).slice(0, 10));
        const to = new Date(String(m.to_date || m.from_date).slice(0, 10));
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          push(iso(d), {
            label: `مأموریت ${m.title || ''}${m.destination ? ' — ' + m.destination : ''}: ${`${m.first_name || ''} ${m.last_name || ''}`.trim()}`,
            type: 'mission', color: 'info', url: '/attendance/missions',
          });
        }
      });
    }

    // ساخت هفته‌ها
    const weeks = [];
    let week = new Array(firstCol).fill(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const g = jalali.toGregorian(jy, jm, day);
      const key = iso(g);
      week.push({ day, key, events: events[key] || [], isToday: key === iso(today), isFriday: g.getDay() === 5 });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }

    const legend = [
      { color: 'danger', label: 'تعطیل رسمی', url: '/attendance/holidays', perm: 'attendance.view' },
      { color: 'primary', label: 'مرخصی', url: '/attendance/leaves', perm: 'attendance.view' },
      { color: 'info', label: 'مأموریت', url: '/attendance/missions', perm: 'attendance.mission.manage' },
      { color: 'success', label: 'رویداد رفاهی', url: '/welfare/events', perm: 'welfare.view' },
      { color: 'purple', label: 'مجمع', url: '/shareholders/meetings', perm: 'shareholders.meeting.manage' },
      { color: 'warning', label: 'مجوز/تمدید', url: '/licensing/list', perm: 'licensing.view' },
    ].filter((x) => can(x.perm));

    res.render('calendar/index', {
      title: 'تقویم سازمانی',
      jy, jm, weeks,
      monthName: jalali.J_MONTHS[jm - 1],
      monthNames: jalali.J_MONTHS,
      weekStart: WEEK_START,
      daysInMonth,
      prev: jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 },
      next: jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 },
      todayLabel: jalali.formatJalaaliLong(today),
      legend,
      helpers,
    });
  } catch (err) { next(err); }
});

module.exports = router;
