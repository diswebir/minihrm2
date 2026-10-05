'use strict';
/**
 * رجیستری ماژول‌ها — قلب معماری ماژولار سامانه
 * ----------------------------------------------------------------------------
 * هر قابلیت سامانه یک «ماژول» است:
 *   • می‌توان آن را از پنل مدیر (تنظیمات › ماژول‌ها) روشن یا خاموش کرد
 *   • تا وقتی ماژولی خاموش باشد مسیرها، منوها و مجوزهای آن غیرفعال می‌شوند
 *   • وابستگی ماژول‌ها کنترل می‌شود (مثلاً «حقوق و دستمزد» نیازمند «کارکنان»)
 *   • برای افزودن قابلیت جدید کافی است یک ورودی به این آرایه اضافه شود
 *
 * قالب هر ماژول:
 *   key        : شناسه یکتا (لاتین) — همان مقدار ستون modules.mkey
 *   name       : نام فارسی نمایشی
 *   icon       : نام آیکون (در assets/icons)
 *   category   : گروه در تنظیمات › ماژول‌ها
 *   menus      : آیتم‌های منو؛ هر آیتم: { label, url, perm, icon?, exact?, children? }
 *   perms      : مجوزهای ماژول به‌صورت [کلید عملیات, عنوان]
 *   deps       : ماژول‌هایی که باید روشن باشند
 *   core       : ماژول پایه — قابل خاموش‌شدن نیست
 */
const jalali = require('../lib/jalali');

const MODULES = [
  {
    key: 'core',
    name: 'هسته سامانه',
    icon: 'grid',
    category: 'زیرساخت',
    description: 'داشبورد، کاربران، نقش‌ها، تنظیمات، لاگ‌ها و پشتیبان‌گیری',
    core: true,
    defaultEnabled: true,
    deps: [],
    perms: [
      ['view', 'مشاهده داشبورد'],
      ['settings.manage', 'مدیریت تنظیمات سامانه'],
      ['users.manage', 'مدیریت کاربران'],
      ['roles.manage', 'مدیریت نقش‌ها و سطوح دسترسی'],
      ['modules.manage', 'مدیریت ماژول‌ها (روشن/خاموش کردن)'],
      ['audit.view', 'مشاهده لاگ عملیات'],
      ['backup.manage', 'پشتیبان‌گیری و بازیابی'],
    ],
    menus: [
      { label: 'داشبورد', url: '/dashboard', icon: 'home', exact: true, perm: 'core.view' },
    ],
  },
  {
    key: 'employees',
    name: 'کارکنان و ساختار سازمانی',
    icon: 'users',
    category: 'منابع انسانی',
    description: 'پرونده پرسنلی، قراردادها، مدارک، واحدها، پست‌ها و تاریخچه شغلی',
    defaultEnabled: true,
    deps: ['core'],
    perms: [
      ['view', 'مشاهده کارکنان'], ['create', 'افزودن کارمند'], ['edit', 'ویرایش پرونده'],
      ['delete', 'حذف/بایگانی کارمند'], ['view_salary', 'مشاهده اطلاعات حقوقی'],
      ['view_bank', 'مشاهده اطلاعات بانکی'], ['view_documents', 'مشاهده مدارک پرسنلی'],
      ['export', 'خروجی گرفتن از اطلاعات کارکنان'], ['org.manage', 'مدیریت چارت و ساختار سازمانی'],
    ],
    menus: [
      { label: 'کارکنان', url: '/employees', icon: 'users', perm: 'employees.view' },
      { label: 'چارت سازمانی', url: '/employees/org-chart', icon: 'sitemap', perm: 'employees.view' },
      { label: 'واحدها', url: '/employees/departments', icon: 'building', perm: 'employees.org.manage' },
      { label: 'عناوین شغلی', url: '/employees/job-titles', icon: 'briefcase', perm: 'employees.org.manage' },
      { label: 'قراردادها', url: '/employees/contracts', icon: 'file-signature', perm: 'employees.view' },
      { label: 'مدارک پرسنلی', url: '/employees/documents', icon: 'folder', perm: 'employees.view_documents' },
    ],
  },
  {
    key: 'recruitment',
    name: 'جذب و استخدام',
    icon: 'user-plus',
    category: 'منابع انسانی',
    description: 'درخواست جذب، آگهی شغلی، فرم استخدام پویا، QR و OTP، مصاحبه، کانبان داوطلبان',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده داوطلبان'], ['create', 'ایجاد درخواست جذب و آگهی'],
      ['edit', 'ویرایش پرونده داوطلب'], ['delete', 'حذف داوطلب'],
      ['form.manage', 'مدیریت فرم استخدام و سؤالات (اجباری/اختیاری)'],
      ['invite.manage', 'ساخت لینک/QR دعوت و ارسال پیامک'],
      ['interview.manage', 'مدیریت مصاحبه‌ها'], ['hire', 'تبدیل داوطلب به کارمند'],
      ['export', 'خروجی داوطلبان'], ['view_notes', 'مشاهده نظر مصاحبه‌کننده و مدیریت'],
      ['stages.manage', 'مدیریت مراحل استخدام'],
    ],
    menus: [
      { label: 'داشبورد جذب', url: '/recruitment', icon: 'chart', exact: true, perm: 'recruitment.view' },
      { label: 'داوطلبان', url: '/recruitment/applications', icon: 'users', perm: 'recruitment.view' },
      { label: 'کانبان استخدام', url: '/recruitment/kanban', icon: 'kanban', perm: 'recruitment.view' },
      { label: 'درخواست‌های جذب', url: '/recruitment/jobs', icon: 'briefcase', perm: 'recruitment.view' },
      { label: 'مصاحبه‌ها', url: '/recruitment/interviews', icon: 'calendar', perm: 'recruitment.interview.manage' },
      { label: 'لینک‌ها و QR دعوت', url: '/recruitment/invites', icon: 'qrcode', perm: 'recruitment.invite.manage' },
      { label: 'فرم استخدام و سؤالات', url: '/recruitment/forms', icon: 'form', perm: 'recruitment.form.manage' },
      { label: 'مراحل استخدام', url: '/recruitment/stages', icon: 'steps', perm: 'recruitment.stages.manage' },
    ],
  },
  {
    key: 'assessment',
    name: 'آزمون‌های روان‌شناسی (MBTI)',
    icon: 'brain',
    category: 'منابع انسانی',
    description: 'آزمون شخصیت‌شناسی MBTI، تحلیل هوشمند و گزارش محرمانه برای منابع انسانی و مدیریت',
    defaultEnabled: true,
    deps: ['recruitment'],
    perms: [
      ['view', 'مشاهده فهرست آزمون‌ها'], ['create', 'ایجاد/ویرایش آزمون'],
      ['questions.manage', 'مدیریت سؤالات و کلید امتیازگذاری'],
      ['assign', 'تخصیص آزمون به داوطلب یا کارمند'],
      ['view_results', 'مشاهده تحلیل شخصیتی (محرمانه)'],
      ['analysis.view', 'مشاهده تحلیل تفصیلی و تناسب شغلی'],
      ['export', 'خروجی گزارش آزمون'],
    ],
    menus: [
      { label: 'فهرست آزمون‌ها', url: '/assessment', icon: 'brain', exact: true, perm: 'assessment.view' },
      { label: 'سؤالات MBTI', url: '/assessment/questions', icon: 'list', perm: 'assessment.questions.manage' },
      { label: 'آزمون‌های انجام‌شده', url: '/assessment/results', icon: 'chart', perm: 'assessment.view_results' },
      { label: 'آزمون‌های در جریان', url: '/assessment/assignments', icon: 'clock', perm: 'assessment.assign' },
    ],
  },
  {
    key: 'onboarding',
    name: 'بدو ورود و آموزش اولیه',
    icon: 'flag',
    category: 'منابع انسانی',
    description: 'چک‌لیست استقرار کارمند جدید، معرفی به همکار راهنما، تحویل تجهیزات و آموزش‌های شروع',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [['view', 'مشاهده فرآیندهای بدو ورود'], ['create', 'ایجاد'], ['edit', 'ویرایش'], ['templates.manage', 'مدیریت قالب‌های بدو ورود'], ['task.complete', 'تکمیل کارها']],
    menus: [
      { label: 'در جریان', url: '/onboarding', icon: 'flag', exact: true, perm: 'onboarding.view' },
      { label: 'قالب‌های چک‌لیست', url: '/onboarding/templates', icon: 'form', perm: 'onboarding.templates.manage' },
    ],
  },
  {
    key: 'training',
    name: 'آموزش و توسعه',
    icon: 'graduation',
    category: 'منابع انسانی',
    description: 'دوره‌های داخلی/آنلاین، تخصیص دوره به کارمند، درخواست آموزش، گواهی‌نامه و آزمون',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده دوره‌ها'], ['create', 'ایجاد دوره'], ['edit', 'ویرایش دوره'], ['delete', 'حذف دوره'],
      ['assign', 'تخصیص دوره به کارمند'], ['content.manage', 'مدیریت درس‌ها و محتوا'],
      ['request.create', 'ثبت درخواست آموزش'], ['request.approve', 'تأیید درخواست آموزش'],
      ['certificate.manage', 'مدیریت گواهی‌نامه‌ها'], ['export', 'خروجی گزارش آموزش'],
    ],
    menus: [
      { label: 'داشبورد آموزش', url: '/training', icon: 'graduation', exact: true, perm: 'training.view' },
      { label: 'دوره‌ها', url: '/training/courses', icon: 'book', perm: 'training.view' },
      { label: 'ثبت‌نام‌ها', url: '/training/enrollments', icon: 'list', perm: 'training.view' },
      { label: 'درخواست‌های آموزش', url: '/training/requests', icon: 'inbox', perm: 'training.request.create' },
      { label: 'گواهی‌نامه‌ها', url: '/training/certificates', icon: 'award', perm: 'training.certificate.manage' },
    ],
  },
  {
    key: 'attendance',
    name: 'حضور، مرخصی و اضافه‌کاری',
    icon: 'clock',
    category: 'منابع انسانی',
    description: 'مانده مرخصی، درخواست و تأیید مرخصی، اضافه‌کاری، مأموریت و کارکرد',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده حضور و مرخصی‌ها'], ['create', 'ثبت درخواست (جانب کارمند)'],
      ['edit', 'ویرایش'], ['delete', 'حذف'], ['approve', 'تأیید مرخصی و اضافه‌کاری'],
      ['types.manage', 'مدیریت انواع مرخصی'], ['balances.manage', 'مدیریت مانده مرخصی'],
      ['import', 'ورود کارکرد از فایل'], ['report', 'گزارش کارکرد'], ['mission.manage', 'مدیریت مأموریت‌ها'],
    ],
    menus: [
      { label: 'داشبورد حضور', url: '/attendance', icon: 'clock', exact: true, perm: 'attendance.view' },
      { label: 'مرخصی‌ها', url: '/attendance/leaves', icon: 'calendar-off', perm: 'attendance.view' },
      { label: 'مانده مرخصی', url: '/attendance/balances', icon: 'scale', perm: 'attendance.view' },
      { label: 'اضافه‌کاری', url: '/attendance/overtime', icon: 'plus-clock', perm: 'attendance.view' },
      { label: 'مأموریت‌ها', url: '/attendance/missions', icon: 'map', perm: 'attendance.mission.manage' },
      { label: 'انواع مرخصی', url: '/attendance/types', icon: 'settings', perm: 'attendance.types.manage' },
    ],
  },
  {
    key: 'payroll',
    name: 'حقوق و دستمزد',
    icon: 'wallet',
    category: 'مالی و اداری',
    description: 'دوره‌های حقوق، مزایا و کسورات، موارد خاص هر فیش، بیمه و مالیات، وام، فیش PDF و پرداخت',
    defaultEnabled: true,
    deps: ['employees', 'attendance'],
    perms: [
      ['view', 'مشاهده حقوق و دستمزد'], ['run', 'محاسبه دوره حقوق'], ['edit', 'ویرایش اقلام فیش'],
      ['approve', 'تأیید و قفل دوره حقوق'], ['pay', 'ثبت پرداخت و خروجی بانک'],
      ['components.manage', 'مدیریت مزایا و کسورات'], ['employee.manage', 'تعیین مزایای اختصاصی کارمند'],
      ['adjustment.create', 'افزودن/کسر مورد خاص فیش'], ['adjustment.approve', 'تأیید موارد خاص'],
      ['payslip.issue', 'صدور فیش حقوقی'], ['payslip.print', 'چاپ/دانلود PDF فیش'],
      ['loan.manage', 'مدیریت وام و مساعده'], ['loan.approve', 'تأیید وام'],
      ['settings.manage', 'تنظیمات قانونی حقوق (مالیات، بیمه، عیدی)'],
      ['tax.manage', 'مدیریت پله‌های مالیات'], ['export', 'خروجی لیست حقوق'],
    ],
    menus: [
      { label: 'داشبورد حقوق', url: '/payroll', icon: 'wallet', exact: true, perm: 'payroll.view' },
      { label: 'دوره‌های حقوق', url: '/payroll/periods', icon: 'calendar', perm: 'payroll.view' },
      { label: 'مزایا و کسورات', url: '/payroll/components', icon: 'list', perm: 'payroll.components.manage' },
      { label: 'موارد خاص فیش‌ها', url: '/payroll/adjustments', icon: 'edit', perm: 'payroll.adjustment.create' },
      { label: 'وام و مساعده', url: '/payroll/loans', icon: 'hand-coins', perm: 'payroll.loan.manage' },
      { label: 'فیش‌های صادرشده', url: '/payroll/payslips', icon: 'receipt', perm: 'payroll.payslip.issue' },
      { label: 'پرداخت‌ها', url: '/payroll/payments', icon: 'bank', perm: 'payroll.pay' },
      { label: 'پله‌های مالیات', url: '/payroll/tax', icon: 'percent', perm: 'payroll.tax.manage' },
      { label: 'تنظیمات حقوق', url: '/payroll/settings', icon: 'settings', perm: 'payroll.settings.manage' },
    ],
  },
  {
    key: 'offboarding',
    name: 'تصفیه و ترک کار',
    icon: 'logout',
    category: 'منابع انسانی',
    description: 'استعفا و خاتمه همکاری، تسویه بین واحدی، محاسبه سنوات و مطالبات، مصاحبه پایانی',
    defaultEnabled: true,
    deps: ['employees', 'payroll'],
    perms: [
      ['view', 'مشاهده فرآیندهای ترک کار'], ['create', 'ثبت درخواست استعفا/ترک کار'],
      ['edit', 'ویرایش'], ['approve', 'تأیید مراحل'], ['clearance.manage', 'مدیریت تسویه بین واحدی'],
      ['settlement.manage', 'محاسبه صورت تسویه'], ['settlement.approve', 'تأیید تسویه'],
      ['exit_interview', 'ثبت مصاحبه پایانی'], ['reports', 'گزارش ترک کار'], ['cancel', 'لغو درخواست'],
    ],
    menus: [
      { label: 'داشبورد ترک کار', url: '/offboarding', icon: 'logout', exact: true, perm: 'offboarding.view' },
      { label: 'درخواست‌ها', url: '/offboarding/requests', icon: 'list', perm: 'offboarding.view' },
      { label: 'تسویه بین واحدی', url: '/offboarding/clearances', icon: 'check-square', perm: 'offboarding.clearance.manage' },
      { label: 'صورت‌های تسویه', url: '/offboarding/settlements', icon: 'calculator', perm: 'offboarding.settlement.manage' },
      { label: 'مصاحبه‌های پایانی', url: '/offboarding/exit-interviews', icon: 'message', perm: 'offboarding.exit_interview' },
    ],
  },
  {
    key: 'transport',
    name: 'ایاب و ذهاب',
    icon: 'bus',
    category: 'رفاهیات',
    description: 'ناوگان و رانندگان، مسیرها و ایستگاه‌ها، تخصیص سرویس به کارکنان، سفرها و هزینه‌ها',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده ایاب و ذهاب'], ['vehicles.manage', 'مدیریت خودروها و رانندگان'],
      ['routes.manage', 'مدیریت مسیرها و ایستگاه‌ها'], ['subscriptions.manage', 'مدیریت تخصیص سرویس'],
      ['subscription.request', 'درخواست سرویس (کارمند)'], ['trips.manage', 'ثبت سفر و کارکرد روزانه'],
      ['costs.manage', 'هزینه‌ها و صورت‌حساب'], ['reports', 'گزارش‌های سرویس'], ['export', 'خروجی'],
    ],
    menus: [
      { label: 'داشبورد سرویس', url: '/transport', icon: 'bus', exact: true, perm: 'transport.view' },
      { label: 'خودروها و رانندگان', url: '/transport/vehicles', icon: 'car', perm: 'transport.vehicles.manage' },
      { label: 'مسیرها', url: '/transport/routes', icon: 'route', perm: 'transport.routes.manage' },
      { label: 'تخصیص سرویس', url: '/transport/subscriptions', icon: 'users', perm: 'transport.subscriptions.manage' },
      { label: 'گزارش سفرها', url: '/transport/trips', icon: 'map', perm: 'transport.trips.manage' },
      { label: 'هزینه‌ها', url: '/transport/costs', icon: 'coins', perm: 'transport.costs.manage' },
    ],
  },
  {
    key: 'kitchen',
    name: 'آشپزخانه و تغذیه',
    icon: 'utensils',
    category: 'رفاهیات',
    description: 'برنامه غذایی، رزرو غذا، ثبت مصرف، انبار و هزینه‌های آشپزخانه',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده آشپزخانه'], ['menus.manage', 'مدیریت برنامه غذایی و طرح تغذیه'],
      ['reservation.manage', 'مدیریت رزروها'], ['reservation.self', 'رزرو غذا (کارمند)'],
      ['serving.record', 'ثبت مصرف غذا'], ['inventory.manage', 'مدیریت انبار مواد اولیه'],
      ['costs.manage', 'هزینه‌ها و صورت‌حساب پیمانکار'], ['staff.manage', 'مدیریت نیروهای آشپزخانه'],
      ['reports', 'گزارش‌ها'], ['export', 'خروجی'],
    ],
    menus: [
      { label: 'داشبورد آشپزخانه', url: '/kitchen', icon: 'utensils', exact: true, perm: 'kitchen.view' },
      { label: 'برنامه غذایی', url: '/kitchen/menus', icon: 'calendar', perm: 'kitchen.menus.manage' },
      { label: 'رزروها و مصرف', url: '/kitchen/reservations', icon: 'utensils', perm: 'kitchen.view' },
      { label: 'طرح تغذیه', url: '/kitchen/plans', icon: 'file', perm: 'kitchen.menus.manage' },
      { label: 'انبار', url: '/kitchen/inventory', icon: 'box', perm: 'kitchen.inventory.manage' },
      { label: 'هزینه‌ها', url: '/kitchen/costs', icon: 'coins', perm: 'kitchen.costs.manage' },
    ],
  },
  {
    key: 'security',
    name: 'نگهبانی و امنیت',
    icon: 'shield',
    category: 'رفاهیات',
    description: 'شیفت نگهبانی، گشت و گزارش‌ها، وقایع امنیتی، دفتر مهمانان و مجوز خروج کالا',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده نگهبانی'], ['shifts.manage', 'مدیریت شیفت‌ها'],
      ['patrol.manage', 'ثبت گشت و گزارش'], ['incident.manage', 'ثبت و پیگیری وقایع'],
      ['visitors.manage', 'دفتر ورود و خروج مهمان'], ['gatepass.manage', 'مجوز خروج کالا'],
      ['reports', 'گزارش‌ها'], ['export', 'خروجی'], ['guard.record', 'ثبت توسط نگهبان'],
    ],
    menus: [
      { label: 'داشبورد نگهبانی', url: '/security', icon: 'shield', exact: true, perm: 'security.view' },
      { label: 'شیفت‌ها', url: '/security/shifts', icon: 'clock', perm: 'security.shifts.manage' },
      { label: 'گزارش گشت', url: '/security/patrols', icon: 'route', perm: 'security.patrol.manage' },
      { label: 'وقایع امنیتی', url: '/security/incidents', icon: 'alert', perm: 'security.incident.manage' },
      { label: 'دفتر مهمانان', url: '/security/visitors', icon: 'users', perm: 'security.visitors.manage' },
      { label: 'مجوز خروج کالا', url: '/security/gate-passes', icon: 'truck', perm: 'security.gatepass.manage' },
    ],
  },
  {
    key: 'welfare',
    name: 'رفاهیات و امکانات',
    icon: 'heart',
    category: 'رفاهیات',
    description: 'درخواست‌های رفاهی، امکانات و رزرو، اردو و جشن، بیمه تکمیلی',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده رفاهیات'], ['requests.manage', 'مدیریت درخواست‌های رفاهی'],
      ['request.create', 'ثبت درخواست رفاهی (کارمند)'], ['approve', 'تأیید درخواست'],
      ['facilities.manage', 'مدیریت امکانات و رزرو'], ['events.manage', 'مدیریت اردو و جشن'],
      ['insurance.manage', 'مدیریت بیمه تکمیلی'], ['reports', 'گزارش‌ها'], ['export', 'خروجی'],
    ],
    menus: [
      { label: 'داشبورد رفاهیات', url: '/welfare', icon: 'heart', exact: true, perm: 'welfare.view' },
      { label: 'درخواست‌های رفاهی', url: '/welfare/requests', icon: 'inbox', perm: 'welfare.view' },
      { label: 'امکانات و رزرو', url: '/welfare/facilities', icon: 'sparkles', perm: 'welfare.view' },
      { label: 'اردو و رویدادها', url: '/welfare/events', icon: 'gift', perm: 'welfare.events.manage' },
      { label: 'بیمه تکمیلی', url: '/welfare/insurance', icon: 'shield-check', perm: 'welfare.insurance.manage' },
    ],
  },
  {
    key: 'licensing',
    name: 'مجوزها و پروانه‌ها',
    icon: 'certificate',
    category: 'امور شرکت',
    description: 'مجوزها، پروانه‌ها و گواهی‌نامه‌ها با یادآور تمدید و مسئول پیگیری',
    defaultEnabled: true,
    deps: ['core'],
    perms: [['view', 'مشاهده مجوزها'], ['create', 'افزودن مجوز'], ['edit', 'ویرایش'], ['delete', 'حذف'], ['renew', 'ثبت تمدید'], ['export', 'خروجی'], ['reports', 'گزارش انقضا']],
    menus: [
      { label: 'داشبورد مجوزها', url: '/licensing', icon: 'certificate', exact: true, perm: 'licensing.view' },
      { label: 'فهرست مجوزها', url: '/licensing/list', icon: 'list', perm: 'licensing.view' },
      { label: 'یادآورهای تمدید', url: '/licensing/renewals', icon: 'bell', perm: 'licensing.view' },
    ],
  },
  {
    key: 'knowledge',
    name: 'امور دانش‌بنیان',
    icon: 'atom',
    category: 'امور شرکت',
    description: 'ارزیابی و سطح دانش‌بنیان، معافیت‌ها، نسبت‌های قانونی و تعهدات',
    defaultEnabled: true,
    deps: ['core'],
    perms: [['view', 'مشاهده'], ['edit', 'ویرایش'], ['create', 'ایجاد'], ['delete', 'حذف'], ['reports', 'گزارش'], ['export', 'خروجی']],
    menus: [{ label: 'دانش‌بنیان', url: '/knowledge-based', icon: 'atom', perm: 'knowledge.view' }],
  },
  {
    key: 'ip',
    name: 'مالکیت فکری',
    icon: 'bulb',
    category: 'امور شرکت',
    description: 'ثبت اختراع، علامت تجاری، طرح صناعی، هزینه‌های سالانه و یادآورها',
    defaultEnabled: true,
    deps: ['core'],
    perms: [['view', 'مشاهده'], ['create', 'افزودن'], ['edit', 'ویرایش'], ['delete', 'حذف'], ['costs.manage', 'هزینه‌ها'], ['export', 'خروجی']],
    menus: [{ label: 'مالکیت فکری', url: '/ip', icon: 'bulb', perm: 'ip.view' }],
  },
  {
    key: 'shareholders',
    name: 'مدیریت سهام‌داران',
    icon: 'pie',
    category: 'امور شرکت',
    description: 'سهام‌داران حقیقی/حقوقی، گردش سهام، هیئت‌مدیره، مجامع و تغییرات سرمایه',
    defaultEnabled: true,
    deps: ['core'],
    perms: [
      ['view', 'مشاهده سهام‌داران'], ['create', 'افزودن سهام‌دار'], ['edit', 'ویرایش'],
      ['delete', 'حذف'], ['transaction.manage', 'ثبت گردش سهام'], ['board.manage', 'مدیریت هیئت‌مدیره'],
      ['meeting.manage', 'مدیریت مجامع'], ['capital.manage', 'تغییرات سرمایه'],
      ['reports', 'گزارش ترکیب سهام'], ['export', 'خروجی'],
    ],
    menus: [
      { label: 'داشبورد سهام', url: '/shareholders', icon: 'pie', exact: true, perm: 'shareholders.view' },
      { label: 'فهرست سهام‌داران', url: '/shareholders/list', icon: 'users', perm: 'shareholders.view' },
      { label: 'گردش سهام', url: '/shareholders/transactions', icon: 'exchange', perm: 'shareholders.transaction.manage' },
      { label: 'هیئت‌مدیره', url: '/shareholders/board', icon: 'user-tie', perm: 'shareholders.board.manage' },
      { label: 'مجامع', url: '/shareholders/meetings', icon: 'gavel', perm: 'shareholders.meeting.manage' },
      { label: 'سرمایه شرکت', url: '/shareholders/capital', icon: 'coins', perm: 'shareholders.capital.manage' },
    ],
  },
  {
    key: 'corporate',
    name: 'امور ثبتی شرکت',
    icon: 'stamp',
    category: 'امور شرکت',
    description: 'آگهی‌های روزنامه رسمی، تغییرات ثبتی، اساسنامه، کارت بازرگانی و اسناد شرکت',
    defaultEnabled: true,
    deps: ['core'],
    perms: [['view', 'مشاهده'], ['create', 'افزودن'], ['edit', 'ویرایش'], ['delete', 'حذف'], ['export', 'خروجی']],
    menus: [{ label: 'امور ثبتی', url: '/corporate', icon: 'stamp', perm: 'corporate.view' }],
  },
  {
    key: 'legal',
    name: 'امور حقوقی و قراردادها',
    icon: 'gavel',
    category: 'امور شرکت',
    description: 'قراردادهای شرکت، پرونده‌های قضایی، الزامات قانونی و پیگیری‌ها',
    defaultEnabled: true,
    deps: ['core'],
    perms: [
      ['view', 'مشاهده'], ['contracts.manage', 'مدیریت قراردادها'], ['cases.manage', 'مدیریت پرونده‌ها'],
      ['compliance.manage', 'الزامات قانونی'], ['export', 'خروجی'], ['reports', 'گزارش'],
    ],
    menus: [
      { label: 'داشبورد حقوقی', url: '/legal', icon: 'gavel', exact: true, perm: 'legal.view' },
      { label: 'قراردادها', url: '/legal/contracts', icon: 'file-signature', perm: 'legal.view' },
      { label: 'پرونده‌های قضایی', url: '/legal/cases', icon: 'gavel', perm: 'legal.view' },
      { label: 'الزامات قانونی', url: '/legal/compliance', icon: 'check-square', perm: 'legal.compliance.manage' },
    ],
  },
  {
    key: 'assets',
    name: 'اموال و تجهیزات',
    icon: 'box',
    category: 'امور اداری',
    description: 'ثبت اموال، تحویل/بازگشت به کارمند، استهلاک، فرم تحویل و پیگیری گم‌شدنی‌ها',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [['view', 'مشاهده'], ['create', 'افزودن'], ['edit', 'ویرایش'], ['delete', 'حذف'], ['assign', 'تحویل/بازگشت'], ['reports', 'گزارش'], ['export', 'خروجی']],
    menus: [
      { label: 'اموال', url: '/assets', icon: 'box', perm: 'assets.view' },
      { label: 'تحویل‌ها', url: '/assets/assignments', icon: 'hand', perm: 'assets.view' },
    ],
  },
  {
    key: 'performance',
    name: 'ارزیابی عملکرد',
    icon: 'trending-up',
    category: 'منابع انسانی',
    description: 'شاخص‌های کلیدی (KPI)، ارزیابی دوره‌ای مدیر و ۳۶۰ درجه، اهداف و بازخورد',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [
      ['view', 'مشاهده ارزیابی‌ها'], ['kpi.manage', 'مدیریت شاخص‌ها'], ['review.create', 'ایجاد ارزیابی'],
      ['review.fill', 'ثبت ارزیابی'], ['review.approve', 'تأیید نهایی'], ['reports', 'گزارش عملکرد'],
      ['self.fill', 'ثبت خودارزیابی'], ['export', 'خروجی'],
    ],
    menus: [
      { label: 'داشبورد عملکرد', url: '/performance', icon: 'trending-up', exact: true, perm: 'performance.view' },
      { label: 'ارزیابی‌ها', url: '/performance/reviews', icon: 'clipboard', perm: 'performance.view' },
      { label: 'شاخص‌های KPI', url: '/performance/kpis', icon: 'target', perm: 'performance.kpi.manage' },
    ],
  },
  {
    key: 'requests',
    name: 'درخواست‌های پرسنلی',
    icon: 'inbox',
    category: 'منابع انسانی',
    description: 'گواهی اشتغال، نامه‌های اداری، مساعده و سایر درخواست‌های کارکنان با گردش تأیید',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [['view', 'مشاهده درخواست‌ها'], ['create', 'ثبت درخواست'], ['edit', 'ویرایش'], ['approve', 'تأیید/رد'], ['issue', 'صدور نامه/گواهی'], ['templates.manage', 'مدیریت قالب نامه‌ها'], ['export', 'خروجی']],
    menus: [
      { label: 'درخواست‌ها', url: '/requests', icon: 'inbox', perm: 'requests.view' },
      { label: 'قالب نامه‌ها', url: '/requests/templates', icon: 'file', perm: 'requests.templates.manage' },
    ],
  },
  {
    key: 'announcements',
    name: 'اطلاعیه‌ها و تقویم',
    icon: 'megaphone',
    category: 'امور اداری',
    description: 'اطلاعیه‌ها و بخشنامه‌های داخلی، تقویم رویدادها و کارهای محول‌شده',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [['view', 'مشاهده'], ['create', 'انتشار اطلاعیه'], ['edit', 'ویرایش'], ['delete', 'حذف'], ['calendar.manage', 'مدیریت تقویم'], ['tasks.manage', 'مدیریت کارها']],
    menus: [
      { label: 'اطلاعیه‌ها', url: '/announcements', icon: 'megaphone', perm: 'announcements.view' },
      { label: 'تقویم', url: '/calendar', icon: 'calendar', perm: 'announcements.view' },
      { label: 'کارهای من', url: '/tasks', icon: 'check-square', perm: 'announcements.view' },
    ],
  },
  {
    key: 'reports',
    name: 'گزارش‌ها و تحلیل',
    icon: 'chart',
    category: 'زیرساخت',
    description: 'داشبوردهای مدیریتی، گزارش‌های پرسنلی و خروجی‌های اکسل/CSV',
    defaultEnabled: true,
    deps: ['employees'],
    perms: [['view', 'مشاهده گزارش‌ها'], ['hr', 'گزارش‌های منابع انسانی'], ['payroll', 'گزارش‌های حقوق'], ['recruitment', 'گزارش‌های جذب'], ['welfare', 'گزارش‌های رفاهی'], ['export', 'خروجی'], ['management', 'داشبورد مدیریتی']],
    menus: [
      { label: 'داشبورد مدیریتی', url: '/reports', icon: 'chart', perm: 'reports.view' },
      { label: 'گزارش پرسنلی', url: '/reports/hr', icon: 'users', perm: 'reports.hr' },
      { label: 'گزارش جذب', url: '/reports/recruitment', icon: 'user-plus', perm: 'reports.recruitment' },
      { label: 'گزارش حقوق', url: '/reports/payroll', icon: 'wallet', perm: 'reports.payroll' },
      { label: 'گزارش رفاهیات', url: '/reports/welfare', icon: 'heart', perm: 'reports.welfare' },
    ],
  },
  {
    key: 'messaging',
    name: 'پیامک و اطلاع‌رسانی',
    icon: 'message',
    category: 'زیرساخت',
    description: 'اتصال به سامانه پیامکی آی‌پی‌پنل، الگوهای پیامک، ارسال OTP و پیامک گروهی',
    defaultEnabled: true,
    deps: ['core'],
    perms: [['view', 'مشاهده'], ['settings.manage', 'تنظیمات آی‌پی‌پنل'], ['send', 'ارسال پیامک'], ['templates.manage', 'مدیریت الگوها'], ['logs', 'مشاهده گزارش ارسال']],
    menus: [
      { label: 'تنظیمات پیامک', url: '/messaging', icon: 'message', exact: true, perm: 'messaging.settings.manage' },
      { label: 'ارسال گروهی', url: '/messaging/send', icon: 'send', perm: 'messaging.send' },
      { label: 'گزارش ارسال', url: '/messaging/logs', icon: 'list', perm: 'messaging.logs' },
    ],
  },
];

/* ------------------------- نقش‌های پیش‌فرض ------------------------- */
/**
 * هر نقش: کلید، نام، سطح، و فهرست مجوزها
 * wildcard «*» = همه مجوزهای فعال سامانه (برای سوپر ادمین / مدیر منابع انسانی)
 */
const ROLES = [
  {
    key: 'admin', name: 'مدیر سامانه (سوپر ادمین)', scope: 'admin',
    description: 'دسترسی کامل به همه ماژول‌ها، تنظیمات، کاربران و نقش‌ها',
    perms: ['*'], locked: true,
  },
  {
    key: 'hr_manager', name: 'مدیر منابع انسانی', scope: 'hr',
    description: 'مدیریت کامل امور منابع انسانی، تأیید نهایی، مشاهده تحلیل آزمون‌ها و اطلاعات حقوقی',
    perms: [
      'core.view', 'core.settings.manage', 'core.users.manage', 'core.audit.view',
      'employees.*', 'recruitment.*', 'assessment.*', 'onboarding.*', 'training.*',
      'attendance.*', 'payroll.*', 'offboarding.*', 'performance.*', 'requests.*',
      'assets.*', 'announcements.*', 'reports.*',
      'transport.view', 'transport.subscriptions.manage', 'transport.reports', 'transport.export',
      'kitchen.view', 'kitchen.reports', 'kitchen.export', 'kitchen.reservation.manage',
      'security.view', 'security.reports', 'security.export',
      'welfare.*', 'licensing.view', 'licensing.reports', 'knowledge.view', 'ip.view',
      'shareholders.view', 'corporate.view', 'legal.view', 'messaging.view', 'messaging.send', 'messaging.logs',
    ],
  },
  {
    key: 'hr_officer', name: 'کارمند / کارشناس منابع انسانی', scope: 'hr',
    description: 'انجام امور روزمره منابع انسانی: پرونده پرسنلی، جذب، آموزش، حضور و مرخصی، رفاهیات',
    perms: [
      'core.view',
      'employees.view', 'employees.create', 'employees.edit', 'employees.view_documents', 'employees.export',
      'recruitment.view', 'recruitment.create', 'recruitment.edit', 'recruitment.form.manage',
      'recruitment.invite.manage', 'recruitment.interview.manage', 'recruitment.export', 'recruitment.view_notes',
      'assessment.view', 'assessment.assign', 'assessment.view_results', 'assessment.analysis.view',
      'onboarding.view', 'onboarding.create', 'onboarding.edit', 'onboarding.task.complete',
      'training.view', 'training.create', 'training.edit', 'training.assign', 'training.content.manage',
      'training.request.create', 'training.certificate.manage',
      'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.approve', 'attendance.report',
      'attendance.balances.manage', 'attendance.mission.manage',
      'payroll.view', 'payroll.payslip.print',
      'offboarding.view', 'offboarding.create', 'offboarding.edit', 'offboarding.clearance.manage', 'offboarding.exit_interview',
      'performance.view', 'performance.review.create', 'performance.review.fill',
      'requests.view', 'requests.create', 'requests.edit', 'requests.issue',
      'assets.view', 'assets.assign', 'announcements.view', 'announcements.create',
      'reports.view', 'reports.hr', 'reports.recruitment',
      'transport.view', 'transport.subscription.request', 'transport.subscriptions.manage',
      'kitchen.view', 'kitchen.reservation.manage', 'security.view', 'security.visitors.manage',
      'welfare.view', 'welfare.requests.manage', 'welfare.request.create', 'welfare.facilities.manage',
    ],
  },
  {
    key: 'recruiter', name: 'کارشناس جذب و استخدام', scope: 'hr',
    description: 'تمرکز بر جذب: مدیریت آگهی‌ها، داوطلبان، مصاحبه‌ها و آزمون‌ها',
    perms: [
      'core.view', 'employees.view',
      'recruitment.view', 'recruitment.create', 'recruitment.edit', 'recruitment.form.manage',
      'recruitment.invite.manage', 'recruitment.interview.manage', 'recruitment.export', 'recruitment.view_notes',
      'recruitment.stages.manage',
      'assessment.view', 'assessment.assign', 'assessment.view_results', 'assessment.analysis.view', 'assessment.export',
      'onboarding.view', 'onboarding.create', 'reports.view', 'reports.recruitment',
      'announcements.view', 'messaging.send',
    ],
  },
  {
    key: 'payroll_officer', name: 'کارشناس حقوق و دستمزد', scope: 'hr',
    description: 'محاسبه و صدور فیش حقوقی، وام، پرداخت‌ها و تنظیمات حقوق',
    perms: [
      'core.view', 'employees.view', 'employees.view_salary', 'employees.view_bank',
      'payroll.view', 'payroll.run', 'payroll.edit', 'payroll.components.manage', 'payroll.employee.manage',
      'payroll.adjustment.create', 'payroll.payslip.issue', 'payroll.payslip.print', 'payroll.loan.manage',
      'payroll.settings.manage', 'payroll.tax.manage', 'payroll.export',
      'attendance.view', 'attendance.report', 'reports.view', 'reports.payroll', 'offboarding.view', 'offboarding.settlement.manage',
    ],
  },
  {
    key: 'manager', name: 'مدیر واحد / سرپرست', scope: 'manager',
    description: 'مدیریت تیم خود: تأیید مرخصی و اضافه‌کاری، آموزش و ارزیابی عملکرد زیرمجموعه‌ها',
    perms: [
      'core.view', 'employees.view', 'attendance.view', 'attendance.approve', 'attendance.report',
      'training.view', 'training.assign', 'training.request.create',
      'performance.view', 'performance.review.create', 'performance.review.fill', 'performance.self.fill',
      'onboarding.view', 'onboarding.task.complete',
      'requests.view', 'announcements.view', 'reports.view',
      'transport.view', 'transport.subscription.request', 'kitchen.view', 'kitchen.reservation.self',
      'welfare.view', 'welfare.request.create', 'offboarding.view', 'offboarding.create',
    ],
  },
  {
    key: 'employee', name: 'کارمند شرکت', scope: 'employee',
    description: 'سلف‌سرویس کارمند: پروفایل، فیش حقوقی، مرخصی، دوره‌ها، درخواست‌ها و رفاهیات',
    perms: [
      'core.view', 'self.profile', 'self.leave', 'self.payslip', 'self.training', 'self.request',
      'self.attendance', 'self.welfare', 'self.transport', 'self.meal', 'self.assessment',
      'announcements.view', 'training.view', 'attendance.view', 'requests.view', 'requests.create',
      'welfare.view', 'welfare.request.create', 'transport.view', 'transport.subscription.request',
      'kitchen.view', 'kitchen.reservation.self', 'performance.view', 'performance.self.fill',
    ],
  },
  {
    key: 'guard', name: 'نگهبانی', scope: 'employee',
    description: 'دسترسی محدود به دفتر مهمانان، مجوز خروج کالا و ثبت گزارش گشت',
    perms: ['core.view', 'security.view', 'security.visitors.manage', 'security.gatepass.manage', 'security.guard.record', 'announcements.view', 'self.profile'],
  },
  {
    key: 'auditor', name: 'بازرس / حسابرس', scope: 'admin',
    description: 'دسترسی فقط‌خواندنی به اطلاعات برای بازرسی و حسابرسی',
    perms: [
      'core.view', 'core.audit.view', 'employees.view', 'attendance.view', 'payroll.view',
      'recruitment.view', 'reports.view', 'licensing.view', 'knowledge.view', 'ip.view',
      'shareholders.view', 'corporate.view', 'legal.view', 'assets.view', 'transport.view', 'kitchen.view',
    ],
  },
  {
    key: 'candidate', name: 'داوطلب استخدام', scope: 'candidate',
    description: 'دسترسی فقط به فرم استخدام، آزمون و پیگیری وضعیت درخواست خود',
    perms: ['public.apply', 'public.assessment', 'public.status'],
  },
];

/** مجوزهای سراسری (خارج از ماژول‌ها) */
const GLOBAL_PERMS = [
  ['self.profile', 'مشاهده و ویرایش پروفایل خودم', 'self'],
  ['self.leave', 'ثبت و پیگیری مرخصی خودم', 'self'],
  ['self.payslip', 'مشاهده و دریافت فیش حقوقی خودم', 'self'],
  ['self.training', 'شرکت در دوره‌های آموزشی خودم', 'self'],
  ['self.request', 'ثبت درخواست پرسنلی', 'self'],
  ['self.attendance', 'مشاهده کارکرد خودم', 'self'],
  ['self.welfare', 'مشاهده رفاهیات خودم', 'self'],
  ['self.transport', 'مدیریت سرویس ایاب و ذهاب خودم', 'self'],
  ['self.meal', 'مدیریت رزرو غذای خودم', 'self'],
  ['self.assessment', 'شرکت در آزمون‌های تعیین‌شده برای من', 'self'],
  ['public.apply', 'تکمیل فرم استخدام (داوطلب)', 'public'],
  ['public.assessment', 'شرکت در آزمون استخدامی (داوطلب)', 'public'],
  ['public.status', 'پیگیری وضعیت درخواست (داوطلب)', 'public'],
];

/** آزادسازی wildcard نقش‌ها به فهرست کامل مجوزها */
function expandPerms(list, allKeys) {
  const out = new Set();
  for (const p of list || []) {
    if (p === '*') { allKeys.forEach((k) => out.add(k)); continue; }
    if (p.endsWith('.*')) {
      const mod = p.slice(0, -2);
      allKeys.filter((k) => k.startsWith(mod + '.')).forEach((k) => out.add(k));
      continue;
    }
    out.add(p);
  }
  return [...out];
}

/** فهرست کامل مجوزهای سامانه */
function allPermissions() {
  const list = [];
  for (const m of MODULES) {
    for (const [action, title] of m.perms) {
      list.push({
        key: `${m.key}.${action}`,
        module: m.key,
        action,
        name: `${m.name} — ${title}`,
        shortName: title,
        group: m.category,
        groupName: m.name,
      });
    }
  }
  for (const [key, name, group] of GLOBAL_PERMS) {
    const [mod, action] = key.split('.');
    list.push({ key, module: mod, action, name, shortName: name, group, groupName: group === 'self' ? 'سلف‌سرویس' : 'داوطلب' });
  }
  return list;
}

module.exports = {
  MODULES,
  ROLES,
  GLOBAL_PERMS,
  allPermissions,
  expandPerms,
  moduleKeys: () => MODULES.map((m) => m.key),
  getModule: (key) => MODULES.find((m) => m.key === key),
  getRole: (key) => ROLES.find((r) => r.key === key),
  jalali,
};
