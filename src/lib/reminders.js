'use strict';
/**
 * سامانه یادآورها (Reminders)
 * ----------------------------------------------------------------------------
 * اقلام سررسیدشده یا نزدیک به سررسید را بررسی و برای کاربران مرتبط اعلان می‌سازد.
 * اجرای دستی: POST /settings/reminders/run   —   اجرای کرون: GET /cron/reminders?token=…
 * هر یادآور در یک روز فقط یک‌بار برای هر کاربر ساخته می‌شود (ضدتکرار).
 */
const db = require('../db');
const jalali = require('./jalali');
const notify = require('./notify');
const settings = require('./settings');
const helpers = require('./helpers');

const dayKey = () => db.nowSql().slice(0, 10);

/** آیا امروز همین یادآور برای این کاربر ساخته شده است؟ */
async function alreadySent(userId, title) {
  const row = await db.get(
    `SELECT id FROM ${db.t('notifications')} WHERE user_id = ? AND title = ? AND created_at >= ?`,
    [userId, title, dayKey() + ' 00:00:00']
  ).catch(() => null);
  return Boolean(row);
}

/** تحلیل اقلام سررسید — بدون ارسال اعلان (برای نمایش در صفحه) */
async function inspect() {
  const today = dayKey();
  const in30 = jalali.addDays(today, 30).toISOString().slice(0, 10);
  const out = [];

  const add = (key, title, link, rows, level) => {
    if (!rows || !rows.length) return;
    out.push({ key, title, link, level: level || 'warning', count: rows.length, items: rows.slice(0, 8) });
  };

  const contracts = await db.query(
    `SELECT c.id, c.code, c.end_date, e.full_name FROM ${db.t('contracts')} c
       LEFT JOIN ${db.t('employees')} e ON e.id = c.employee_id
      WHERE c.deleted_at IS NULL AND c.status = 'active' AND c.end_date IS NOT NULL
        AND c.end_date <= ? AND c.end_date >= ? ORDER BY c.end_date LIMIT 50`, [in30, today]
  ).catch(() => []);
  add('contracts', 'قراردادهای رو به پایان', '/contracts?f_end_date_to=' + in30,
    contracts.map((c) => `${c.full_name || 'کارمند'} — پایان ${jalali.formatJalaali(c.end_date)}`));

  const licenses = await db.query(
    `SELECT id, title, expiry_date, reminder_days FROM ${db.t('licenses')}
      WHERE deleted_at IS NULL AND status <> 'expired' AND expiry_date IS NOT NULL
        AND expiry_date <= ? ORDER BY expiry_date LIMIT 50`, [in30]
  ).catch(() => []);
  add('licenses', 'مجوزها و گواهی‌های رو به انقضا', '/licenses',
    licenses.map((l) => `${l.title} — انقضا ${jalali.formatJalaali(l.expiry_date)}`));

  const tasks = await db.query(
    `SELECT id, title, due_date FROM ${db.t('tasks')}
      WHERE deleted_at IS NULL AND status NOT IN ('done','completed','canceled') AND due_date IS NOT NULL
        AND due_date < ? ORDER BY due_date LIMIT 50`, [today]
  ).catch(() => []);
  add('tasks', 'وظایف عقب‌افتاده', '/tasks?f_status=open',
    tasks.map((t) => `${t.title} — سررسید ${jalali.formatJalaali(t.due_date)}`), 'danger');

  const welfare = await db.query(
    `SELECT w.id, w.title, w.type, e.full_name FROM ${db.t('welfare_requests')} w
       LEFT JOIN ${db.t('employees')} e ON e.id = w.employee_id
      WHERE w.deleted_at IS NULL AND w.status = 'pending' ORDER BY w.id DESC LIMIT 50`
  ).catch(() => []);
  add('welfare', 'درخواست‌های رفاهی در انتظار بررسی', '/welfare/requests?f_status=pending',
    welfare.map((w) => `${w.full_name || 'کارمند'} — ${w.title || w.type || 'درخواست'}`));

  const settlements = await db.query(
    `SELECT s.id, s.net_payable, e.full_name FROM ${db.t('settlements')} s
       LEFT JOIN ${db.t('employees')} e ON e.id = s.employee_id
      WHERE s.deleted_at IS NULL AND s.status NOT IN ('paid','closed') ORDER BY s.id DESC LIMIT 50`
  ).catch(() => []);
  add('settlements', 'تسویه‌حساب‌های در انتظار پرداخت', '/offboarding/settlements',
    settlements.map((s) => `${s.full_name || 'کارمند'} — خالص ${helpers.pnum(helpers.formatNumber(s.net_payable || 0))} ریال`));

  const payroll = await db.query(
    `SELECT id, title, pay_date, status FROM ${db.t('payroll_periods')}
      WHERE deleted_at IS NULL AND status NOT IN ('paid','locked','closed') AND pay_date IS NOT NULL
        AND pay_date <= ? ORDER BY pay_date LIMIT 20`, [today]
  ).catch(() => []);
  add('payroll', 'دوره‌های حقوقی پرداخت‌نشده', '/payroll/periods',
    payroll.map((p) => `${p.title} — موعد پرداخت ${jalali.formatJalaali(p.pay_date)}`), 'danger');

  const inventory = await db.query(
    `SELECT id, title, qty, min_qty, unit FROM ${db.t('kitchen_inventory')}
      WHERE deleted_at IS NULL AND min_qty IS NOT NULL AND qty <= min_qty ORDER BY (qty - min_qty) LIMIT 50`
  ).catch(() => []);
  add('inventory', 'موجودی کم انبار آشپزخانه', '/kitchen/inventory',
    inventory.map((i) => `${i.title} — موجودی ${helpers.pnum(i.qty)} ${i.unit || ''}`.trim()));

  const birthdays = await db.query(
    `SELECT id, full_name, birth_date FROM ${db.t('employees')}
      WHERE deleted_at IS NULL AND status = 'active' AND birth_date IS NOT NULL LIMIT 500`
  ).catch(() => []);
  const t = jalali.toJalaali(new Date());
  const bday = birthdays.filter((e) => {
    const j = jalali.toJalaali(e.birth_date);
    return j && Number(j.jm) === Number(t.jm) && Number(j.jd) === Number(t.jd);
  });
  add('birthdays', 'تولدهای امروز', '/employees',
    bday.map((e) => `${e.full_name}`), 'info');

  return out;
}

/** ارسال اعلان‌های یادآور به کاربران مرتبط — خروجی: گزارش شمارش */
async function run() {
  const items = await inspect();
  const report = { at: db.nowSql(), items: [] };

  // کاربران HR/مدیریت برای اقلام عمومی
  const hrUsers = await db.query(
    `SELECT u.id FROM ${db.t('users')} u JOIN ${db.t('roles')} r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL AND u.status = 'active' AND (r.scope = 'hr' OR r.scope = 'admin')`
  ).catch(() => []);

  const permUsers = async (perm) => db.query(
    `SELECT DISTINCT u.id FROM ${db.t('users')} u
       LEFT JOIN ${db.t('role_permissions')} rp ON rp.role_id = u.role_id
       LEFT JOIN ${db.t('permissions')} p ON p.id = rp.permission_id
       LEFT JOIN ${db.t('user_permissions')} up ON up.user_id = u.id
      WHERE u.deleted_at IS NULL AND u.status = 'active'
        AND (u.is_superadmin = 1 OR p.pkey = ? OR (up.pkey = ? AND COALESCE(up.allow,1) = 1))`,
    [perm, perm]
  ).catch(() => []);

  for (const it of items) {
    const title = `یادآور: ${it.title} (${helpers.pnum(it.count)} مورد)`;
    const body = it.items.join(' • ') + (it.count > it.items.length ? ' …' : '');
    let users = hrUsers;
    if (it.key === 'payroll') users = await permUsers('payroll.view');
    if (it.key === 'welfare') users = await permUsers('welfare.requests.manage');
    if (it.key === 'inventory') users = await permUsers('kitchen.inventory.manage');
    if (it.key === 'licenses') users = await permUsers('licensing.view');
    if (it.key === 'tasks') users = Array.from(new Map([...hrUsers, ...(await permUsers('core.view'))].map((u) => [u.id, u])).values());
    let sent = 0;
    for (const u of users) {
      if (await alreadySent(u.id, title)) continue;
      await notify.notifyUser(u.id, title, body, it.link, it.level);
      sent += 1;
    }
    report.items.push({ key: it.key, title: it.title, count: it.count, notified: sent });
  }
  return report;
}

/** کلید امنیتی کرون — در صورت نبود، به‌صورت خودکار ساخته می‌شود */
async function cronToken(renew) {
  let token = await settings.get('backup.cron_token', '');
  if (!token || renew) {
    token = require('./security').randomToken(18).replace(/[^A-Za-z0-9]/g, '');
    await settings.set('backup.cron_token', token).catch(() => {});
  }
  return token;
}

module.exports = { inspect, run, cronToken };
