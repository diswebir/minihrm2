'use strict';
/**
 * تعریف منابع ماژول «کارکنان و ساختار سازمانی»
 */
const db = require('../db');
const helpers = require('../lib/helpers');
const settings = require('../lib/settings');

const ref = (label) => ({ label });

module.exports = [
  /* -------------------------------- واحدها -------------------------------- */
  {
    key: 'departments', module: 'employees', table: 'departments', basePath: 'employees/departments',
    title: 'واحدهای سازمانی', titleSingular: 'واحد سازمانی', icon: 'building',
    newLabel: 'افزودن واحد',
    perm: { view: 'employees.view', create: 'employees.org.manage', edit: 'employees.org.manage', delete: 'employees.org.manage', export: 'employees.export' },
    search: ['name', 'code', 'description'],
    orderBy: 'sort_order ASC, id ASC',
    exportColumns: [{ field: 'name', label: 'نام واحد' }, { field: 'code', label: 'کد' }, { field: 'description', label: 'توضیحات' }],
    listColumns: [
      { field: 'name', label: 'نام واحد' },
      { field: 'code', label: 'کد' },
      { field: 'parent_id', label: 'واحد بالادستی' },
      { field: 'manager_user_id', label: 'مدیر' },
      { field: 'status', label: 'وضعیت', badge: true },
    ],
    fields: [
      { name: 'name', label: 'نام واحد', type: 'text', required: true, group: 'مشخصات', col: 6 },
      { name: 'code', label: 'کد واحد', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'parent_id', label: 'واحد بالادستی', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('departments')} WHERE deleted_at IS NULL ORDER BY sort_order`, group: 'ساختار', col: 6 },
      { name: 'manager_user_id', label: 'مدیر واحد', type: 'lookup', source: () => `SELECT id, full_name AS label FROM ${db.t('users')} WHERE status='active' ORDER BY full_name`, group: 'ساختار', col: 6 },
      { name: 'location_id', label: 'محل استقرار', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('locations')} ORDER BY name`, group: 'ساختار', col: 6 },
      { name: 'cost_center', label: 'مرکز هزینه', type: 'text', group: 'ساختار', col: 6 },
      { name: 'sort_order', label: 'ترتیب نمایش', type: 'number', group: 'ساختار', col: 6 },
      { name: 'status', label: 'وضعیت', type: 'select', options: [{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }], group: 'ساختار', col: 6, nullable: false },
      { name: 'description', label: 'توضیحات', type: 'textarea', group: 'تکمیلی' },
    ],
  },

  /* ------------------------------ عناوین شغلی ------------------------------ */
  {
    key: 'job-titles', module: 'employees', table: 'job_titles', basePath: 'employees/job-titles',
    title: 'عناوین شغلی', titleSingular: 'عنوان شغلی', icon: 'briefcase',
    newLabel: 'افزودن عنوان شغلی',
    perm: { view: 'employees.view', create: 'employees.org.manage', edit: 'employees.org.manage', delete: 'employees.org.manage', export: 'employees.export' },
    search: ['title', 'code', 'description'],
    listColumns: [
      { field: 'title', label: 'عنوان شغلی' },
      { field: 'code', label: 'کد' },
      { field: 'department_id', label: 'واحد' },
      { field: 'grade', label: 'گروه شغلی' },
      { field: 'status', label: 'وضعیت', badge: true },
    ],
    fields: [
      { name: 'title', label: 'عنوان شغلی', type: 'text', required: true, group: 'مشخصات', col: 6 },
      { name: 'code', label: 'کد شغلی', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'department_id', label: 'واحد سازمانی', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('departments')} WHERE deleted_at IS NULL`, group: 'مشخصات', col: 6 },
      { name: 'grade', label: 'گروه/رتبه شغلی', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'min_salary', label: 'حداقل حقوق', type: 'money', group: 'حقوق', col: 6 },
      { name: 'max_salary', label: 'حداکثر حقوق', type: 'money', group: 'حقوق', col: 6 },
      { name: 'duties', label: 'شرح وظایف', type: 'textarea', group: 'شرح شغل', rows: 4 },
      { name: 'requirements', label: 'شرایط احراز', type: 'textarea', group: 'شرح شغل', rows: 3 },
      { name: 'description', label: 'توضیحات', type: 'textarea', group: 'شرح شغل' },
      { name: 'status', label: 'وضعیت', type: 'select', options: [{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }], group: 'مشخصات', col: 6, nullable: false },
    ],
  },

  /* -------------------------------- پست‌ها -------------------------------- */
  {
    key: 'job-positions', module: 'employees', table: 'job_positions', basePath: 'employees/positions',
    title: 'پست‌های سازمانی', titleSingular: 'پست سازمانی', icon: 'sitemap',
    perm: { view: 'employees.view', create: 'employees.org.manage', edit: 'employees.org.manage', delete: 'employees.org.manage' },
    search: ['title', 'code'],
    listColumns: [
      { field: 'title', label: 'عنوان پست' },
      { field: 'code', label: 'کد پست' },
      { field: 'headcount', label: 'ظرفیت', type: 'number' },
      { field: 'occupied', label: 'تعداد پرشده', type: 'number' },
      { field: 'status', label: 'وضعیت', badge: true },
    ],
    fields: [
      { name: 'title', label: 'عنوان پست', type: 'text', required: true, group: 'مشخصات', col: 6 },
      { name: 'code', label: 'کد پست', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'department_id', label: 'واحد', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('departments')} WHERE deleted_at IS NULL`, group: 'مشخصات', col: 6 },
      { name: 'job_title_id', label: 'عنوان شغلی', type: 'lookup', source: () => `SELECT id, title AS label FROM ${db.t('job_titles')} WHERE deleted_at IS NULL`, group: 'مشخصات', col: 6 },
      { name: 'location_id', label: 'محل کار', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('locations')}`, group: 'مشخصات', col: 6 },
      { name: 'reports_to_user_id', label: 'سرپرست/مدیر مستقیم', type: 'lookup', source: () => `SELECT id, full_name AS label FROM ${db.t('users')} WHERE status='active'`, group: 'مشخصات', col: 6 },
      { name: 'headcount', label: 'ظرفیت پست', type: 'number', group: 'ظرفیت', col: 6 },
      { name: 'occupied', label: 'تعداد پرشده', type: 'number', group: 'ظرفیت', col: 6 },
      { name: 'status', label: 'وضعیت', type: 'select', options: [{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }], group: 'مشخصات', col: 6, nullable: false },
      { name: 'description', label: 'توضیحات', type: 'textarea', group: 'تکمیلی' },
    ],
  },

  /* ------------------------------- محل‌ها ------------------------------- */
  {
    key: 'locations', module: 'employees', table: 'locations', basePath: 'employees/locations',
    title: 'محل‌های کار', titleSingular: 'محل کار', icon: 'pin',
    perm: { view: 'employees.view', create: 'employees.org.manage', edit: 'employees.org.manage', delete: 'employees.org.manage' },
    search: ['name', 'city', 'address'],
    listColumns: [{ field: 'name', label: 'نام' }, { field: 'type', label: 'نوع' }, { field: 'city', label: 'شهر' }, { field: 'phone', label: 'تلفن' }, { field: 'status', label: 'وضعیت', badge: true }],
    fields: [
      { name: 'name', label: 'نام محل', type: 'text', required: true, group: 'مشخصات', col: 6 },
      { name: 'type', label: 'نوع', type: 'select', options: ['اداری', 'کارخانه', 'انبار', 'سایت پروژه', 'فروشگاه'], group: 'مشخصات', col: 6 },
      { name: 'city', label: 'شهر', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'phone', label: 'تلفن', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'address', label: 'نشانی', type: 'textarea', group: 'مشخصات' },
      { name: 'status', label: 'وضعیت', type: 'select', options: [{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }], group: 'مشخصات', col: 6, nullable: false },
    ],
  },

  /* ------------------------------ شیفت‌های کاری ------------------------------ */
  {
    key: 'work-shifts', module: 'employees', table: 'work_shifts', basePath: 'employees/shifts',
    title: 'شیفت‌های کاری', titleSingular: 'شیفت کاری', icon: 'clock',
    perm: { view: 'employees.view', create: 'employees.org.manage', edit: 'employees.org.manage', delete: 'employees.org.manage' },
    search: ['name'],
    listColumns: [
      { field: 'name', label: 'نام شیفت' },
      { field: 'start_time', label: 'شروع' }, { field: 'end_time', label: 'پایان' },
      { field: 'break_minutes', label: 'استراحت (دقیقه)' },
      { field: 'weekly_hours', label: 'ساعت هفتگی' },
      { field: 'status', label: 'وضعیت', badge: true },
    ],
    fields: [
      { name: 'name', label: 'نام شیفت', type: 'text', required: true, group: 'مشخصات', col: 6 },
      { name: 'start_time', label: 'ساعت شروع', type: 'time', group: 'مشخصات', col: 3 },
      { name: 'end_time', label: 'ساعت پایان', type: 'time', group: 'مشخصات', col: 3 },
      { name: 'break_minutes', label: 'مدت استراحت (دقیقه)', type: 'number', group: 'مشخصات', col: 4 },
      { name: 'weekly_hours', label: 'ساعت کاری هفتگی', type: 'number', group: 'مشخصات', col: 4 },
      { name: 'flexible', label: 'شیفت شناور', type: 'checkbox', checkLabel: 'ساعت ورود و خروج شناور است', group: 'مشخصات', col: 4 },
      { name: 'description', label: 'توضیحات', type: 'textarea', group: 'تکمیلی' },
      { name: 'status', label: 'وضعیت', type: 'select', options: [{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }], group: 'مشخصات', col: 4, nullable: false },
    ],
  },

  /* -------------------------------- قراردادها -------------------------------- */
  {
    key: 'contracts', module: 'employees', table: 'contracts', basePath: 'employees/contracts',
    title: 'قراردادهای کار', titleSingular: 'قرارداد', icon: 'file-signature',
    perm: { view: 'employees.view', create: 'employees.create', edit: 'employees.edit', delete: 'employees.delete', export: 'employees.export' },
    search: ['code', 'number'],
    filters: [{ name: 'status', label: 'وضعیت', type: 'lookup', source: () => 'SELECT 1' }, { name: 'end_date', label: 'تاریخ پایان', type: 'date_range' }],
    listColumns: [
      { field: 'code', label: 'کد قرارداد' },
      { field: 'employee_id', label: 'کارمند' },
      { field: 'type', label: 'نوع' },
      { field: 'start_date', label: 'شروع', type: 'date' },
      { field: 'end_date', label: 'پایان', type: 'date' },
      { field: 'base_salary', label: 'حقوق پایه', type: 'money' },
      { field: 'status', label: 'وضعیت', badge: true },
    ],
    exportColumns: [{ field: 'code', label: 'کد' }, { field: 'employee_id', label: 'شناسه کارمند' }, { field: 'type', label: 'نوع' }, { field: 'start_date', label: 'شروع' }, { field: 'end_date', label: 'پایان' }, { field: 'base_salary', label: 'حقوق پایه' }, { field: 'status', label: 'وضعیت' }],
    fields: [
      { name: 'employee_id', label: 'کارمند', type: 'lookup', required: true, source: () => `SELECT id, CONCAT(first_name,' ',last_name,' (' , COALESCE(personnel_code,'') , ')') AS label FROM ${db.t('employees')} WHERE deleted_at IS NULL ORDER BY last_name`, group: 'طرفین قرارداد', col: 6 },
      { name: 'code', label: 'کد قرارداد', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'type', label: 'نوع قرارداد', type: 'select', options: ['مشخص مدت (دائم)', 'موقت (پروژه‌ای)', 'پاره‌وقت', 'آزمایشی', 'ساعتی', 'کارآموزی'], group: 'مشخصات', col: 6, required: true, nullable: false },
      { name: 'number', label: 'شماره قرارداد', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'start_date', label: 'تاریخ شروع', type: 'date', required: true, group: 'مدت', col: 4 },
      { name: 'end_date', label: 'تاریخ پایان', type: 'date', group: 'مدت', col: 4 },
      { name: 'signed_at', label: 'تاریخ امضا', type: 'date', group: 'مدت', col: 4 },
      { name: 'base_salary', label: 'حقوق پایه ماهانه', type: 'money', group: 'شرایط مالی', col: 6 },
      { name: 'working_hours', label: 'ساعت کاری هفتگی', type: 'number', group: 'شرایط مالی', col: 6 },
      { name: 'job_title_id', label: 'عنوان شغلی', type: 'lookup', source: () => `SELECT id, title AS label FROM ${db.t('job_titles')} WHERE deleted_at IS NULL`, group: 'سازمانی', col: 4 },
      { name: 'department_id', label: 'واحد', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('departments')} WHERE deleted_at IS NULL`, group: 'سازمانی', col: 4 },
      { name: 'location_id', label: 'محل کار', type: 'lookup', source: () => `SELECT id, name AS label FROM ${db.t('locations')}`, group: 'سازمانی', col: 4 },
      { name: 'status', label: 'وضعیت', type: 'select', options: [{ value: 'draft', label: 'پیش‌نویس' }, { value: 'active', label: 'جاری' }, { value: 'expired', label: 'منقضی' }, { value: 'terminated', label: 'خاتمه‌یافته' }], group: 'وضعیت', col: 6, nullable: false },
      { name: 'file', label: 'فایل قرارداد', type: 'file', group: 'وضعیت', col: 6 },
      { name: 'terms', label: 'شرایط و تبصره‌ها', type: 'textarea', group: 'متن قرارداد', rows: 4 },
      { name: 'note', label: 'یادداشت', type: 'textarea', group: 'متن قرارداد' },
    ],
  },

  /* ----------------------------- مدارک پرسنلی ----------------------------- */
  {
    key: 'documents', module: 'employees', table: 'employee_documents', basePath: 'employees/documents',
    title: 'مدارک پرسنلی', titleSingular: 'مدرک', icon: 'folder',
    perm: { view: 'employees.view_documents', create: 'employees.create', edit: 'employees.edit', delete: 'employees.delete' },
    search: ['title', 'number', 'issuer'],
    filters: [{ name: 'expires_at', label: 'تاریخ انقضا', type: 'date_range' }],
    listColumns: [
      { field: 'employee_id', label: 'کارمند' },
      { field: 'title', label: 'عنوان مدرک' },
      { field: 'type', label: 'نوع' },
      { field: 'issued_at', label: 'تاریخ صدور', type: 'date' },
      { field: 'expires_at', label: 'تاریخ انقضا', type: 'date' },
      { field: 'status', label: 'وضعیت', badge: true },
    ],
    fields: [
      { name: 'employee_id', label: 'کارمند', type: 'lookup', required: true, source: () => `SELECT id, CONCAT(first_name,' ',last_name) AS label FROM ${db.t('employees')} WHERE deleted_at IS NULL ORDER BY last_name`, group: 'مشخصات', col: 6 },
      { name: 'title', label: 'عنوان مدرک', type: 'text', required: true, group: 'مشخصات', col: 6 },
      { name: 'type', label: 'نوع مدرک', type: 'select', options: ['شناسنامه', 'کارت ملی', 'آخرین مدرک تحصیلی', 'کارت پایان خدمت', 'گواهی عدم سوءپیشینه', 'معاینات پزشکی', 'قرارداد', 'بیمه', 'سایر'], group: 'مشخصات', col: 6 },
      { name: 'number', label: 'شماره مدرک', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'issuer', label: 'صادرکننده', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'issued_at', label: 'تاریخ صدور', type: 'date', group: 'اعتبار', col: 6 },
      { name: 'expires_at', label: 'تاریخ انقضا', type: 'date', group: 'اعتبار', col: 6 },
      { name: 'status', label: 'وضعیت', type: 'select', options: ['معتبر', 'منقضی', 'در حال تمدید'], group: 'اعتبار', col: 6 },
      { name: 'file', label: 'تصویر مدرک', type: 'file', group: 'فایل', col: 6 },
      { name: 'note', label: 'یادداشت', type: 'textarea', group: 'فایل' },
    ],
  },

  /* ------------------------------ بستگان کارمند ------------------------------ */
  {
    key: 'employee-contacts', module: 'employees', table: 'employee_contacts', basePath: 'employees/contacts',
    title: 'بستگان و افراد تحت پوشش', titleSingular: 'فرد وابسته', icon: 'users',
    perm: { view: 'employees.view', create: 'employees.create', edit: 'employees.edit', delete: 'employees.delete' },
    search: ['name', 'national_id'],
    listColumns: [
      { field: 'employee_id', label: 'کارمند' },
      { field: 'name', label: 'نام' }, { field: 'relation', label: 'نسبت' },
      { field: 'national_id', label: 'کد ملی' }, { field: 'mobile', label: 'موبایل' },
      { field: 'is_dependent', label: 'تحت پوشش بیمه', type: 'checkbox' },
    ],
    fields: [
      { name: 'employee_id', label: 'کارمند', type: 'lookup', required: true, source: () => `SELECT id, CONCAT(first_name,' ',last_name) AS label FROM ${db.t('employees')} WHERE deleted_at IS NULL`, group: 'مشخصات', col: 6 },
      { name: 'name', label: 'نام و نام خانوادگی', type: 'text', required: true, group: 'مشخصات', col: 6 },
      { name: 'relation', label: 'نسبت', type: 'select', options: ['همسر', 'فرزند', 'پدر', 'مادر', 'خواهر', 'برادر', 'سایر'], group: 'مشخصات', col: 6 },
      { name: 'national_id', label: 'کد ملی', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'birth_date', label: 'تاریخ تولد', type: 'date', group: 'مشخصات', col: 6 },
      { name: 'mobile', label: 'شماره تماس', type: 'text', group: 'مشخصات', col: 6 },
      { name: 'insurance_code', label: 'کد بیمه', type: 'text', group: 'بیمه', col: 6 },
      { name: 'is_dependent', label: 'تحت پوشش بیمه تکمیلی', type: 'checkbox', group: 'بیمه', col: 6 },
      { name: 'note', label: 'یادداشت', type: 'textarea', group: 'تکمیلی' },
    ],
  },

  /* ---------------------------- تاریخچه پرسنلی ---------------------------- */
  {
    key: 'history', module: 'employees', table: 'employee_history', basePath: 'employees/history',
    title: 'تاریخچه پرسنلی', titleSingular: 'رکورد تاریخچه', icon: 'activity',
    perm: { view: 'employees.view', create: 'employees.create', edit: 'employees.edit', delete: 'employees.delete' },
    search: ['title', 'description'],
    listColumns: [
      { field: 'employee_id', label: 'کارمند' },
      { field: 'event_type', label: 'نوع رویداد' },
      { field: 'title', label: 'عنوان' },
      { field: 'effective_date', label: 'تاریخ اجرا', type: 'date' },
      { field: 'from_value', label: 'از' }, { field: 'to_value', label: 'به' },
    ],
    fields: [
      { name: 'employee_id', label: 'کارمند', type: 'lookup', required: true, source: () => `SELECT id, CONCAT(first_name,' ',last_name) AS label FROM ${db.t('employees')} WHERE deleted_at IS NULL`, group: 'رویداد', col: 6 },
      { name: 'event_type', label: 'نوع رویداد', type: 'select', options: ['استخدام', 'تثبیت', 'ارتقا', 'انتقال واحد', 'تغییر سمت', 'افزایش حقوق', 'تغییر شیفت', 'مرخصی بدون حقوق', 'تذکر', 'تشویق', 'خاتمه همکاری'], required: true, group: 'رویداد', col: 6, nullable: false },
      { name: 'title', label: 'عنوان رویداد', type: 'text', required: true, group: 'رویداد', col: 6 },
      { name: 'effective_date', label: 'تاریخ اجرا', type: 'date', required: true, group: 'رویداد', col: 6 },
      { name: 'from_value', label: 'مقدار قبلی', type: 'text', group: 'جزئیات', col: 6 },
      { name: 'to_value', label: 'مقدار جدید', type: 'text', group: 'جزئیات', col: 6 },
      { name: 'amount', label: 'مبلغ مرتبط (در صورت وجود)', type: 'money', group: 'جزئیات', col: 6 },
      { name: 'description', label: 'توضیحات', type: 'textarea', group: 'جزئیات' },
    ],
  },
];

/** نقشه نام کارمندان برای نمایش در فهرست‌ها */
async function employeeMap() {
  const rows = await db.query(`SELECT id, CONCAT(first_name, ' ', last_name) AS name, personnel_code FROM ${db.t('employees')} WHERE deleted_at IS NULL`);
  const map = {};
  rows.forEach((r) => { map[r.id] = `${r.name}${r.personnel_code ? ' (' + r.personnel_code + ')' : ''}`; });
  return map;
}

module.exports.employeeMap = employeeMap;
module.exports.ref = ref;
