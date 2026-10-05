'use strict';
/**
 * فهرست یکپارچه منابع (Resource Definitions)
 * ----------------------------------------------------------------------------
 * هر منبع یک جدول را با فهرست/فرم/جزئیات کامل و مجوز ماژولی خود توصیف می‌کند.
 * مسیرها به‌صورت خودکار در routes/panel.js روی موتور resource.js سوار می‌شوند.
 */
const db = require('../db');
const employees = require('./resources-employees');
const hr = require('./resources-hr');
const ops = require('./resources-ops');

const ALL = [...employees, ...hr, ...ops];

/** نقشه نام کارمندان برای نمایش در فهرست‌ها */
async function employeeMaps() {
  const rows = await db.query(`SELECT id, full_name, personnel_code FROM ${db.t('employees')} WHERE deleted_at IS NULL`);
  const employeeMap = {};
  rows.forEach((r) => { employeeMap[r.id] = `${r.full_name}${r.personnel_code ? ' (' + r.personnel_code + ')' : ''}`; });
  return { employeeMap };
}

/** برچسب فارسی مقادیر رایج (برای ستون‌های وضعیت) */
const LABELS = {
  active: 'فعال', inactive: 'غیرفعال', draft: 'پیش‌نویس', open: 'باز', closed: 'بسته‌شده',
  pending: 'در انتظار', approved: 'تأییدشده', rejected: 'رد شده', canceled: 'لغو شده',
  done: 'انجام‌شده', published: 'منتشر شده', archived: 'بایگانی', paused: 'متوقف',
  completed: 'تکمیل‌شده', assigned: 'تخصیص‌یافته', in_progress: 'در حال انجام',
  failed: 'ناموفق', expired: 'منقضی', valid: 'معتبر', expiring: 'نزدیک به انقضا',
  renewing: 'در حال تمدید', revoked: 'لغو شده', settled: 'تسویه‌شده', paid: 'پرداخت‌شده',
  unpaid: 'پرداخت‌نشده', calculated: 'محاسبه‌شده', sent: 'ارسال‌شده', issued: 'صادرشده',
  requested: 'درخواست‌شده', suspended: 'معلق', repair: 'در تعمیر', available: 'در انبار',
  assigned_asset: 'تحویل‌شده', retired: 'از رده خارج', lost: 'مفقود', ok: 'عادی', low: 'کمبود',
  served: 'سرو شده', no_show: 'عدم حضور', reserved: 'رزرو شده', scheduled: 'برنامه‌ریزی‌شده',
  held: 'برگزار شده', planned: 'برنامه‌ریزی‌شده', submitted: 'ثبت‌شده', reviewed: 'بررسی‌شده',
  investigating: 'در حال بررسی', granted: 'دارای تأییدیه', filed: 'ثبت‌شده', won: 'به نفع ما',
  lost_case: 'به ضرر ما', appealed: 'تجدیدنظر', overdue: 'معوق', not_applicable: 'موضوعیت ندارد',
  expired_license: 'منقضی', main: 'اصلی', alternate: 'علی‌البدل', observer: 'ناظر',
};

/** تعریف منابع را با تنظیمات مشترک آماده می‌کند */
function prepare(def) {
  const out = { ...def };
  // فقط جدول‌هایی که ستون deleted_at دارند از حذف نرم پشتیبانی می‌کنند
  const hasSoftDelete = tableHasColumn(def.table, 'deleted_at');
  out.softDelete = out.softDelete === true ? true : (out.softDelete === false ? false : hasSoftDelete);
  out.statusLabels = LABELS;
  out.exportColumns = out.exportColumns || (out.listColumns || [])
    .filter((c) => !c.type || ['text', 'money', 'date', 'datetime', 'number'].includes(c.type))
    .map((c) => ({ field: c.field, label: c.label }));
  if (!out.perm) out.perm = {};
  // فهرست ستون‌های واقعی جدول تا فقط ستون‌های موجود پر شوند
  try {
    const t = require('../db/schema').table(def.table);
    out.columns = new Set((t ? t.cols : []).map((c) => c[0]));
  } catch (_) { out.columns = new Set(); }
  return out;
}

/** بررسی وجود یک ستون در جدول (بر پایه تعریف schema) */
function tableHasColumn(table, column) {
  try {
    const t = require('../db/schema').table(table);
    return Boolean(t && (t.cols || []).some((c) => c[0] === column));
  } catch (_) { return false; }
}

const RESOURCES = ALL.map(prepare);

/** همه منابع — با اعتبارسنجی وجود جدول در پایگاه‌داده */
function all() {
  const names = new Set(require('../db/schema').tableNames());
  return RESOURCES.map((def) => {
    if (!names.has(def.table)) throw new Error(`منبع «${def.key}» به جدول ناموجود «${def.table}» اشاره دارد.`);
    return def;
  });
}

module.exports = { RESOURCES, all, prepare, LABELS, employeeMaps };
