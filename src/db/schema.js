'use strict';
/**
 * تعریف پایگاه‌داده (تک‌منبع حقیقت برای MySQL و SQLite)
 * ----------------------------------------------------------------------------
 * همه جدول‌ها یک‌بار در پوشه ./tables تعریف می‌شوند و از همان تعریف، DDL هر دو
 * دیالکت ساخته می‌شود؛ بنابراین سازگاری MySQL (هاست cPanel) و حالت آزمایشی
 * SQLite تضمین می‌شود.
 *
 * انواع فیلد (توکن):
 *   id       : کلید اصلی خودافزاینده
 *   int/big  : عدد صحیح
 *   bool     : بله/خیر (۰/۱)
 *   str[:n]  : رشته کوتاه (پیش‌فرض ۱۹۱ برای سازگاری کلید یکتا در utf8mb4)
 *   text     : متن
 *   longtext/json : متن بلند / داده ساختاریافته
 *   date/dt  : تاریخ / تاریخ-ساعت ('YYYY-MM-DD HH:MM:SS')
 *   time     : ساعت
 *   money    : مبلغ (DECIMAL(18,2) در MySQL)
 *   float    : عدد اعشاری
 *
 * پرچم‌های ستون (flags):
 *   'nn'          : NOT NULL
 *   'u'           : یکتا
 *   'def:<value>' : مقدار پیش‌فرض
 */
const core = require('./tables/core');
const hr = require('./tables/hr');
const ops = require('./tables/ops');

const TABLES = [...core, ...hr, ...ops];

const CAP = 191; // حداکثر طول رشته برای کلید یکتا در utf8mb4

/**
 * جدول‌هایی که ستون deleted_at (حذف نرم) ندارند:
 * جدول‌های تنظیمات، لاگ‌ها، نشست‌ها و پاسخ‌های خام.
 * سایر جدول‌ها به‌صورت خودکار ستون deleted_at می‌گیرند تا حذف رکوردها
 * در سامانه منابع انسانی همیشه قابل بازگردانی و پیگیری باشد.
 */
const NO_SOFT_DELETE = new Set([
  'settings', 'roles', 'permissions', 'role_permissions', 'user_permissions', 'sessions',
  'login_logs', 'otp_codes', 'audit_logs', 'notifications', 'modules', 'module_events',
  'schema_migrations', 'application_answers', 'application_stage_log', 'interview_scores',
  'assessment_answers', 'enrollment_progress', 'meal_attendance', 'sms_logs', 'reminders',
  'transport_trip_passengers', 'employee_shifts', 'onboarding_kit_items', 'employee_onboarding_tasks',
  'clearances', 'review_items', 'loan_installments', 'payroll_items', 'issued_letters',
  'tax_brackets', 'recruitment_stages', 'letter_templates', 'form_fields', 'form_sections',
]);

/** ستون‌های نهایی جدول (با افزودن خودکار deleted_at) */
function tableCols(table) {
  const cols = table.cols.map((c) => [...c]);
  if (!NO_SOFT_DELETE.has(table.name) && !cols.some((c) => c[0] === 'deleted_at')) {
    cols.push(['deleted_at', 'dt']);
  }
  return cols;
}

function typeName(token, dialect) {
  const mysql = dialect === 'mysql';
  if (token === 'id') return mysql ? 'INT UNSIGNED NOT NULL AUTO_INCREMENT' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const [base, arg] = String(token).split(':');
  switch (base) {
    case 'int': return mysql ? 'INT' : 'INTEGER';
    case 'big': return mysql ? 'BIGINT' : 'INTEGER';
    case 'bool': return mysql ? 'TINYINT(1)' : 'INTEGER';
    case 'str': return `VARCHAR(${Math.min(Number(arg) || CAP, 500)})`;
    case 'text': return 'TEXT';
    case 'longtext': case 'json': return mysql ? 'LONGTEXT' : 'TEXT';
    case 'date': return mysql ? 'DATE' : 'TEXT';
    case 'dt': return mysql ? 'DATETIME' : 'TEXT';
    case 'time': return mysql ? 'TIME' : 'TEXT';
    case 'money': return mysql ? 'DECIMAL(18,2)' : 'REAL';
    case 'float': return mysql ? 'DOUBLE' : 'REAL';
    default: return mysql ? 'VARCHAR(191)' : 'TEXT';
  }
}

function quote(name, dialect) {
  return dialect === 'mysql' ? `\`${name}\`` : `"${name}"`;
}

function columnSql(name, token, flags, dialect) {
  const f = flags || [];
  name = quote(name, dialect);
  if (token === 'id') return `${name} ${typeName('id', dialect)}`;
  const nn = f.includes('nn');
  let out = `${name} ${typeName(token, dialect)}`;
  out += nn ? ' NOT NULL' : ' NULL';
  let def = null;
  for (const x of f) if (typeof x === 'string' && x.startsWith('def:')) def = x.slice(4);
  if (def === null && nn && token === 'dt') def = 'CURRENT_TIMESTAMP';
  if (def === null && nn && token === 'bool') def = '0';
  if (def !== null && !['text', 'longtext', 'json'].includes(token)) {
    const bare = ['CURRENT_TIMESTAMP', '0', '1', 'NULL'].includes(String(def));
    out += ` DEFAULT ${bare ? def : `'${String(def).replace(/'/g, "''")}'`}`;
  }
  if (f.includes('u')) out += ' UNIQUE';
  return out;
}

function createTableSql(table, dialect, prefix = '') {
  const mysql = dialect === 'mysql';
  const tname = prefix + table.name;
  const lines = tableCols(table).map(([name, token, flags]) => columnSql(name, token, flags, dialect));
  if (mysql) {
    lines.push('PRIMARY KEY (id)');
    for (const idx of table.indexes || []) {
      const colsList = Array.isArray(idx) ? idx : [idx];
      lines.push(`KEY idx_${table.name}_${colsList.join('_')} (${colsList.map((c) => quote(c, dialect)).join(', ')})`);
    }
  }
  const tail = mysql
    ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    : '';
  return `CREATE TABLE IF NOT EXISTS ${tname} (\n  ${lines.join(',\n  ')}\n)${tail};`;
}

function indexSql(table, dialect, prefix = '') {
  const out = [];
  for (const idx of table.indexes || []) {
    const colsList = Array.isArray(idx) ? idx : [idx];
    const name = `idx_${prefix}${table.name}_${colsList.join('_')}`;
    if (dialect === 'mysql') {
      // در MySQL ایندکس‌ها داخل CREATE TABLE ساخته می‌شوند
      continue;
    }
    out.push(`CREATE INDEX IF NOT EXISTS ${name} ON ${prefix}${table.name} (${colsList.map((c) => quote(c, dialect)).join(', ')});`);
  }
  return out;
}

/** همه دستورهای DDL برای یک دیالکت */
function statements(dialect = 'mysql', prefix = '') {
  const out = [];
  for (const table of TABLES) {
    out.push(createTableSql(table, dialect, prefix));
    out.push(...indexSql(table, dialect, prefix));
  }
  return out;
}

function tableNames() {
  return TABLES.map((t) => t.name);
}

function table(name) {
  const t = TABLES.find((x) => x.name === name);
  if (!t) return t;
  return { ...t, cols: tableCols(t) };
}

module.exports = { TABLES, statements, tableNames, table, createTableSql, typeName, tableCols, NO_SOFT_DELETE };

/* اجرای مستقیم: node src/db/schema.js [mysql|sqlite] */
if (require.main === module) {
  const dialect = process.argv[2] === 'sqlite' ? 'sqlite' : 'mysql';
  const out = statements(dialect);
  console.log(`-- ${TABLES.length} جدول — ${out.length} دستور (${dialect})`);
  if (process.argv.includes('--print')) console.log(out.join('\n'));
}
