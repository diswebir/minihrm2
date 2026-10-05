'use strict';
/**
 * داده‌های اولیه سامانه (Seed)
 * ----------------------------------------------------------------------------
 *  • مجوزها و نقش‌های پیش‌فرض از رجیستری ماژول‌ها ساخته می‌شوند
 *  • فرم استخدام بر اساس «فرم استخدام.xlsx» (کد مدرک OF-FR-01-03) ساخته می‌شود
 *  • آزمون روان‌شناسی MBTI بر اساس «آزمون روانشناسی شخصیتی.docx» (OF-FR-05-00)
 *  • اقلام حقوق و دستمزد، پله‌های مالیات و تنظیمات قانونی سال ۱۴۰۴
 *
 * این فایل idempotent است: اجرای مکرر آن داده‌های تکراری نمی‌سازد.
 */
const db = require('./index');
const registry = require('../modules');
const { MODULES, ROLES, allPermissions, expandPerms } = registry;

/* ================================================================== */
/* ۱) فرم استخدام — برگرفته از فایل اکسل شرکت                           */
/* ================================================================== */

const FORM_TEMPLATE = {
  tkey: 'of-fr-01-03',
  name: 'فرم استخدام شرکت (OF-FR-01-03)',
  description: 'فرم جامع استخدام برگرفته از فرم رسمی شرکت — مشخصات متقاضی، سوابق کاری، تحصیلات، مهارت‌ها، انتظارات و الزامات شغلی',
  scope: 'recruitment',
  is_default: 1,
  thank_you_text: 'از وقتی که گذاشتید سپاسگزاریم. کارشناسان منابع انسانی پرونده شما را بررسی می‌کنند و نتیجه از طریق پیامک اطلاع‌رسانی می‌شود.',
};

const FORM_SECTIONS = [
  { title: 'مشخصات متقاضی', icon: 'user', description: 'اطلاعات هویتی و تماس شما' },
  { title: 'سوابق کاری', icon: 'briefcase', description: 'تجربه‌های شغلی پیشین (می‌توانید چند مورد اضافه کنید)', repeatable: 1 },
  { title: 'تحصیلات', icon: 'graduation', description: 'سوابق تحصیلی (می‌توانید چند مورد اضافه کنید)', repeatable: 1 },
  { title: 'زبان خارجی', icon: 'language', description: 'زبان‌هایی که با آن‌ها آشنایید', repeatable: 1 },
  { title: 'مهارت‌های نرم‌افزاری', icon: 'monitor', description: 'نرم‌افزارها و سطح مهارت', repeatable: 1 },
  { title: 'دوره‌های آموزشی', icon: 'award', description: 'دوره‌هایی که گذرانده‌اید', repeatable: 1 },
  { title: 'دیدگاه‌ها و انتظارات شما', icon: 'message', description: 'انتظارات شغلی و شرایط همکاری' },
  { title: 'شرایط و الزامات شغل', icon: 'check', description: 'پاسخ صادقانه شما به انتخاب بهتر کمک می‌کند' },
  { title: 'اطلاعات معرف', icon: 'users', description: 'شخصی که در صورت نیاز با ایشان تماس گرفته می‌شود' },
  { title: 'تعهد و ارسال', icon: 'shield-check', description: 'تأیید نهایی صحت اطلاعات' },
];

/** فیلدهای هر بخش — type: text|textarea|number|money|select|radio|checkbox|date|jalali|file|phone|email|national_id|multi */
const FORM_FIELDS = {
  'مشخصات متقاضی': [
    ['first_name', 'نام', 'text', 1, { width: 'half' }],
    ['last_name', 'نام خانوادگی', 'text', 1, { width: 'half' }],
    ['father_name', 'نام پدر', 'text', 1, { width: 'half' }],
    ['national_id', 'کد ملی', 'national_id', 1, { width: 'half', help: '۱۰ رقم بدون خط تیره', unique: 1 }],
    ['id_number', 'شماره شناسنامه', 'text', 1, { width: 'half' }],
    ['birth_date', 'تاریخ تولد', 'jalali', 1, { width: 'half' }],
    ['birth_place', 'محل صدور شناسنامه', 'text', 0, { width: 'half' }],
    ['gender', 'جنسیت', 'radio', 1, { width: 'half', options: ['مرد', 'زن'] }],
    ['marital_status', 'وضعیت تأهل', 'radio', 1, { width: 'half', options: ['مجرد', 'متاهل', 'سایر'] }],
    ['religion', 'دین', 'select', 0, { width: 'half', options: ['اسلام', 'مسیحیت', 'زرتشتی', 'سایر'] }],
    ['mazhab', 'مذهب', 'select', 0, { width: 'half', options: ['شیعه', 'سنی', 'سایر'] }],
    ['mobile', 'تلفن همراه', 'phone', 1, { width: 'half', help: 'کد تأیید پیامکی به همین شماره ارسال می‌شود' }],
    ['phone', 'تلفن ثابت', 'text', 0, { width: 'half' }],
    ['email', 'ایمیل', 'email', 0, { width: 'half' }],
    ['address', 'آدرس محل سکونت', 'textarea', 1, { width: 'full', rows: 2 }],
    ['postal_code', 'کد پستی', 'text', 0, { width: 'half' }],
    ['military_status', 'وضعیت نظام وظیفه', 'radio', 1, { width: 'half', options: ['پایان خدمت', 'معافیت', 'مشمول', 'مشمول نیستم'] }],
    ['insurance_history', 'سابقه بیمه', 'radio', 0, { width: 'half', options: ['دارد', 'ندارد'] }],
    ['insurance_no', 'شماره بیمه', 'text', 0, { width: 'half', help: 'در صورت داشتن سابقه بیمه' }],
    ['insurance_years', 'سنوات بیمه (سال)', 'number', 0, { width: 'half' }],
    ['spouse_name', 'نام و نام خانوادگی همسر', 'text', 0, { width: 'half', depends_on: 'marital_status', depends_value: 'متاهل' }],
    ['spouse_phone', 'تلفن تماس همسر', 'text', 0, { width: 'half', depends_on: 'marital_status', depends_value: 'متاهل' }],
    ['spouse_job', 'شغل و محل کار همسر', 'text', 0, { width: 'half', depends_on: 'marital_status', depends_value: 'متاهل' }],
    ['children_count', 'تعداد فرزند', 'number', 0, { width: 'half' }],
    ['photo', 'عکس پرسنلی', 'file', 0, { width: 'half', help: 'فرمت jpg یا png — حداکثر ۲ مگابایت' }],
  ],
  'سوابق کاری': [
    ['company_name', 'نام شرکت', 'text', 1],
    ['position', 'سمت سازمانی', 'text', 1],
    ['work_from', 'تاریخ شروع', 'jalali', 1, { width: 'half' }],
    ['work_to', 'تاریخ پایان', 'jalali', 1, { width: 'half' }],
    ['work_duration', 'مدت همکاری', 'text', 0, { width: 'half' }],
    ['last_salary', 'آخرین حقوق دریافتی', 'money', 0, { width: 'half' }],
    ['leave_reason', 'علت قطع همکاری', 'text', 0, { width: 'half' }],
    ['company_phone', 'تلفن تماس محل کار', 'text', 0, { width: 'half' }],
  ],
  'تحصیلات': [
    ['degree', 'مقطع تحصیلی', 'select', 1, { width: 'half', options: ['زیر دیپلم', 'دیپلم', 'کاردانی', 'کارشناسی', 'کارشناسی ارشد', 'دکتری'] }],
    ['field_of_study', 'رشته یا گرایش', 'text', 1, { width: 'half' }],
    ['university', 'محل تحصیل', 'text', 1, { width: 'half' }],
    ['grad_year', 'سال اخذ مدرک', 'number', 0, { width: 'half', help: 'مثال: 1398' }],
    ['gpa', 'معدل', 'number', 0, { width: 'half' }],
  ],
  'زبان خارجی': [
    ['language', 'عنوان زبان خارجی', 'text', 1, { width: 'half' }],
    ['level', 'سطح تسلط', 'radio', 1, { width: 'half', options: ['بسیار خوب', 'خوب', 'متوسط', 'ضعیف'] }],
    ['certificate', 'مدرک زبان', 'text', 0, { width: 'half' }],
  ],
  'مهارت‌های نرم‌افزاری': [
    ['software', 'نام نرم‌افزار', 'text', 1, { width: 'half' }],
    ['level', 'سطح تسلط', 'radio', 1, { width: 'half', options: ['عالی', 'خوب', 'متوسط', 'مقدماتی'] }],
    ['years', 'سابقه کار (سال)', 'number', 0, { width: 'half' }],
  ],
  'دوره‌های آموزشی': [
    ['course_title', 'نام دوره آموزشی', 'text', 1, { width: 'half' }],
    ['institute', 'نام موسسه آموزشی', 'text', 0, { width: 'half' }],
    ['duration', 'مدت دوره', 'text', 0, { width: 'half' }],
    ['cert_status', 'وضعیت مدرک', 'radio', 0, { width: 'half', options: ['مدرک دارد', 'مدرک ندارد'] }],
  ],
  'دیدگاه‌ها و انتظارات شما': [
    ['satisfaction_factors', 'عواملی که موجب رضایت شما از محیط کار می‌شود را ذکر کنید', 'textarea', 1, { rows: 2 }],
    ['dissatisfaction_factors', 'عواملی که موجب عدم رضایت شما از محیط کار می‌شود را ذکر کنید', 'textarea', 1, { rows: 2 }],
    ['cooperation_type', 'نوع همکاری', 'radio', 1, { options: ['تمام وقت', 'پاره وقت', 'دورکاری', 'پروژه‌ای'] }],
    ['part_time_details', 'در صورت انتخاب پاره‌وقت، روزها و ساعات مورد نظر را ذکر نمایید', 'textarea', 0, { rows: 2, depends_on: 'cooperation_type', depends_value: 'پاره وقت' }],
    ['expected_salary', 'میزان حقوق و دستمزد مورد انتظار', 'money', 1, { help: 'مبلغ ماهانه به ریال' }],
    ['desired_position', 'تمایل به اخذ چه سمتی در شرکت دارید؟', 'text', 1],
    ['ready_date', 'تاریخ و زمان آمادگی جهت شروع کار', 'jalali', 1],
    ['referral_source', 'نحوه آشنایی شما با شرکت', 'select', 1, { options: ['آگهی استخدامی', 'معرفی آشنایان', 'شبکه‌های اجتماعی', 'سایت شرکت', 'مراجعه حضوری', 'سایر'] }],
    ['referrer_name', 'نام معرف (در صورت وجود)', 'text', 0, { depends_on: 'referral_source', depends_value: 'معرفی آشنایان' }],
  ],
  'شرایط و الزامات شغل': [
    ['overtime_ready', 'آیا آمادگی لازم جهت انجام اضافه‌کاری در روزهای عادی و تعطیل را دارید؟', 'radio', 1, {
      options: ['بله، آمادگی کامل دارم', 'بله، در شرایط خاص و با اطلاع قبلی', 'خیر، امکان اضافه‌کاری ندارم'],
    }],
    ['mission_ready', 'در صورت نیاز شرکت، میزان آمادگی شما برای مأموریت‌های کاری چقدر است؟', 'checkbox', 1, {
      options: [
        'فقط مأموریت‌های کوتاه‌مدت داخلی (چند روز تا چند هفته)',
        'مأموریت‌های کوتاه‌مدت و بلندمدت داخلی (چند روز تا چند ماه)',
        'فقط مأموریت‌های کوتاه‌مدت خارجی (چند روز تا چند هفته)',
        'مأموریت‌های کوتاه‌مدت و بلندمدت خارجی (چند روز تا چند ماه)',
        'امکان انجام مأموریت کاری را ندارم',
      ],
      help: 'می‌توانید بیش از یک گزینه انتخاب کنید',
    }],
    ['health_status', 'آیا در حال حاضر از نظر سلامت جسمی و روانی در وضعیت مطلوب هستید؟', 'radio', 1, { options: ['بله', 'خیر'] }],
    ['illness', 'در صورت ابتلا به بیماری خاص، نوع بیماری را ذکر نمایید', 'text', 0, { depends_on: 'health_status', depends_value: 'خیر' }],
    ['has_relative_in_company', 'آیا از بستگان شما در این شرکت شاغل است؟', 'radio', 0, { options: ['خیر', 'بله'] }],
    ['relative_name', 'نام و نسبت بستگان شاغل در شرکت', 'text', 0, { depends_on: 'has_relative_in_company', depends_value: 'بله' }],
  ],
  'اطلاعات معرف': [
    ['ref_name', 'نام و نام خانوادگی معرف', 'text', 1, { width: 'half' }],
    ['ref_relation', 'نسبت فرد با شما', 'text', 1, { width: 'half' }],
    ['ref_phone', 'تلفن تماس معرف', 'phone', 1, { width: 'half' }],
    ['ref_job', 'شغل معرف', 'text', 0, { width: 'half' }],
  ],
  'تعهد و ارسال': [
    ['confirmation', 'اینجانب صحت کلیه اطلاعات مندرج در این فرم را تأیید و گواهی می‌نمایم.', 'checkbox_one', 1, { help: 'برای ارسال فرم باید این مورد را تأیید کنید' }],
    ['signature_name', 'نام و نام خانوادگی (امضای دیجیتال)', 'text', 1, { width: 'half' }],
    ['signature_date', 'تاریخ تکمیل فرم', 'jalali', 1, { width: 'half', default_value: 'today' }],
  ],
};

/* ================================================================== */
/* ۲) آزمون MBTI — برگرفته از فایل «آزمون روانشناسی شخصیتی.docx»        */
/* ================================================================== */

const MBTI_QUESTIONS = [
  [1, 'EI', 'من علاقه به توسعه عقایدم از طریق .......... دارم.', 'گفت‌وگو و تبادل نظر', 'E', 'تأمل و بررسی فردی', 'I'],
  [2, 'SN', 'معمولاً با چه نوع افرادی راحت‌تر ارتباط برقرار می‌کنم؟', 'کسانی که خلاق و آینده‌نگرند', 'N', 'کسانی که واقع‌گرا و عمل‌گرا هستند', 'S'],
  [3, 'TF', 'در تعامل با دیگران، بیشتر به چه چیزی توجه می‌کنم؟', 'احساسات و نیازهای عاطفی افراد', 'F', 'اصول، قوانین و حقوق هر فرد', 'T'],
  [4, 'JP', 'وقتی از من درخواست شود پروژه‌ای را انجام دهم، ترجیح می‌دهم:', 'به اتمام و تکمیل پروژه فکر کنم', 'J', 'روی فرآیند و یا مراحل عملیاتی پروژه تمرکز کنم', 'P'],
  [5, 'EI', 'محیط کاری مطلوبم محیطی است که:', 'متنوع، پرتحرک و پویا باشد', 'E', 'آرام و مناسب تمرکز باشد', 'I'],
  [6, 'SN', 'در انجام کار گروهی معمولاً:', 'روش پذیرفته‌شده گروه را دنبال می‌کنم', 'S', 'ترجیح می‌دهم روش خود را ارائه و اجرا کنم', 'N'],
  [7, 'TF', 'تصمیم‌گیری‌هایم معمولاً بیشتر تحت تأثیر کدام مورد است؟', 'ملاحظات شخصی و انسانی', 'F', 'تحلیل منطقی و واقع‌بینانه', 'T'],
  [8, 'JP', 'در تصمیم‌گیری:', 'سریع نتیجه‌گیری می‌کنم', 'J', 'تصمیم را عقب می‌اندازم تا گزینه‌های بیشتری را بررسی کنم', 'P'],
  [9, 'EI', 'هنگام کار کردن ترجیح می‌دهم:', 'دیگران در اطرافم باشند', 'E', 'تنها باشم و کسی نزدیکم نشود', 'I'],
  [10, 'SN', 'چه عاملی بیشتر باعث ناخشنودی شما می‌شود؟', 'نظریه‌ها و ایده‌های بسیار انتزاعی', 'S', 'کار با افرادی که به مفاهیم نظری توجه نمی‌کنند', 'N'],
  [11, 'TF', 'در بسیاری از موقعیت‌ها:', 'احساساتم تصمیمم را جهت می‌دهد', 'F', 'تحلیل‌های ذهنی‌ام تصمیم را تعیین می‌کند', 'T'],
  [12, 'JP', 'احساس راحت‌تری دارم اگر:', 'موضوعات را هرچه زودتر تجزیه و تحلیل کرده و به نتیجه‌گیری برسم', 'J', 'موضوعات را در لحظه‌های آخر تصمیم‌گیری کنم تا بتوانم تغییرات لازم را بدهم', 'P'],
  [13, 'EI', 'من موضوعات جدید را از طریق .......... یاد می‌گیرم.', 'صحبت کردن و انجام دادن', 'E', 'مطالعه و تفکر کردن', 'I'],
  [14, 'SN', 'کدام ویژگی برایم ارزشمندتر است؟', 'رویاپردازی و نگاه بلندمدت', 'N', 'واقع‌گرایی و توجه به امور ملموس', 'S'],
  [15, 'TF', 'کدام‌یک از دو عمل زیر کمتر اهمیت دارد؟', 'ابراز صمیمیت زیاد', 'T', 'حفظ فاصله احساسی و عدم همدلی', 'F'],
  [16, 'JP', 'بهترین عملکردم زمانی است که:', 'کار خود را برنامه‌ریزی کرده و طبق آن عمل کنم', 'J', 'امکان تغییر و انعطاف همراه کار وجود داشته باشد', 'P'],
  [17, 'EI', 'اغلب اوقات من:', 'اول صحبت می‌کنم و بعداً راجع به آن فکر می‌کنم', 'E', 'قبل از صحبت یا عمل، ابتدا راجع به آن فکر می‌کنم', 'I'],
  [18, 'SN', 'اگر معلم بودم، ترجیح می‌دادم تدریس موضوعاتی را بر عهده بگیرم که:', 'شامل مفاهیم و نظریه‌ها هستند', 'N', 'مبتنی بر اطلاعات واقعی و قابل مشاهده‌اند', 'S'],
  [19, 'TF', 'کدام مفهوم برایم مهم‌تر است؟', 'همدلی', 'F', 'دورنگری و تحلیل آینده', 'T'],
  [20, 'JP', 'بیشتر اوقات:', 'تلاش می‌کنم کارها را قبل از موعد انجام دهم', 'J', 'معمولاً در فشار زمان بهتر عمل می‌کنم', 'P'],
  [21, 'EI', 'ترجیح می‌دهم با دیگران از طریق .......... ارتباط برقرار کنم.', 'صحبت کردن', 'E', 'نامه نوشتن', 'I'],
  [22, 'SN', 'کدام واژه برایم جذاب‌تر است؟', 'تولید و اجرا', 'S', 'طراحی و ابداع', 'N'],
  [23, 'TF', 'کدام ارزش برایم مهم‌تر است؟', 'عدالت', 'T', 'دل‌رحمی', 'F'],
  [24, 'JP', 'اغلب اوقات من .......... هستم.', 'رسمی و جدی', 'J', 'غیررسمی و خودمانی', 'P'],
  [25, 'EI', 'در یک محفل اجتماعی با کسانی معاشرت می‌کنم که:', 'از قبل آن‌ها را می‌شناسم', 'I', 'قبلاً با آن‌ها آشنایی نداشته‌ام', 'E'],
  [26, 'SN', 'کدام مورد برایم بنیادی‌تر است؟', 'ایده‌ها و امکانات', 'N', 'واقعیات و داده‌های ملموس', 'S'],
  [27, 'TF', 'کدام لغت اهمیت بیشتری دارد؟', 'انعطاف‌پذیری', 'F', 'قاطع بودن', 'T'],
  [28, 'JP', 'قبل از رفتن به سفر:', 'مایل هستم همه چیز برنامه‌ریزی شده باشد', 'J', 'مایل هستم انعطاف‌پذیر باشم و در لحظه‌های آخر تصمیم بگیرم', 'P'],
];

/* ================================================================== */
/* ۳) سایر داده‌های پایه                                              */
/* ================================================================== */

const RECRUITMENT_STAGES = [
  ['جدید', 'new', '#64748b', 0],
  ['بررسی اولیه پرونده', 'screening', '#0ea5e9', 0],
  ['مصاحبه تلفنی', 'phone_interview', '#8b5cf6', 0],
  ['مصاحبه فنی / تخصصی', 'technical', '#6366f1', 0],
  ['آزمون روان‌شناسی', 'assessment', '#f59e0b', 0],
  ['مصاحبه منابع انسانی', 'hr_interview', '#14b8a6', 0],
  ['مصاحبه مدیریت', 'management_interview', '#3b82f6', 0],
  ['پیشنهاد شغلی', 'offer', '#22c55e', 0],
  ['استخدام‌شده', 'hired', '#16a34a', 1],
  ['رد صلاحیت', 'rejected', '#ef4444', 1],
  ['انصراف داوطلب', 'withdrawn', '#94a3b8', 1],
  ['استعداد برتر (بانک اطلاعاتی)', 'talent_pool', '#a855f7', 1],
];

const LEAVE_TYPES = [
  ['annual', 'استحقاقی', '#2563eb', 1, 26, 2.17, 1, 0, 1, 0],
  ['sick', 'استعلاجی', '#ef4444', 0, 0, 0, 1, 1, 0, 0],
  ['unpaid', 'بدون حقوق', '#64748b', 0, 0, 0, 1, 0, 0, 0],
  ['maternity', 'زایمان', '#db2777', 1, 270, 0, 1, 1, 0, 0],
  ['paternity', 'پدری', '#0ea5e9', 1, 3, 0, 1, 0, 0, 0],
  ['marriage', 'ازدواج', '#a855f7', 1, 3, 0, 1, 0, 0, 0],
  ['bereavement', 'فوت بستگان', '#334155', 1, 3, 0, 1, 0, 0, 0],
  ['hourly', 'مرخصی ساعتی', '#f59e0b', 1, 0, 0, 1, 0, 0, 0],
  ['pilgrimage', 'سفر زیارتی', '#16a34a', 1, 7, 0, 1, 0, 0, 0],
  ['study', 'تحصیلی / آزمون', '#8b5cf6', 1, 5, 0, 1, 0, 0, 0],
  ['miscarriage', 'سقط جنین', '#f43f5e', 1, 10, 0, 1, 1, 0, 1],
  ['remote', 'دورکاری', '#0891b2', 1, 0, 0, 1, 0, 0, 0],
];

/** اقلام حقوق و دستمزد: [key, name, type, category, calc_type, default, taxable, insurable, employer_cost, order, description] */
const PAYROLL_COMPONENTS = [
  ['base_salary', 'حقوق پایه', 'earning', 'base', 'days', 0, 1, 1, 0, 10, 'پایه حقوق ماهانه بر اساس کارکرد'],
  ['seniority_pay', 'پایه سنوات', 'earning', 'base', 'fixed', 0, 1, 1, 0, 20, 'پایه سنوات (مشوق ماندگاری)'],
  ['housing', 'حق مسکن', 'earning', 'allowance', 'fixed', 9000000, 1, 1, 0, 30, 'حق مسکن مصوب شورای عالی کار — معاف از مالیات'],
  ['food_allowance', 'حق بن کارگری (خواربار)', 'earning', 'allowance', 'fixed', 22000000, 1, 1, 0, 40, 'بن کارگری مصوب ۱۴۰۴ — معاف از مالیات'],
  ['marriage_allowance', 'حق تأهل', 'earning', 'allowance', 'fixed', 5000000, 1, 1, 0, 50, 'حق تأهل مصوب — معاف از مالیات'],
  ['child_allowance', 'حق اولاد', 'earning', 'allowance', 'fixed', 0, 0, 0, 0, 60, 'حق اولاد به ازای هر فرزند — معاف از مالیات و بیمه'],
  ['overtime', 'اضافه‌کاری', 'earning', 'overtime', 'hours', 0, 1, 1, 0, 70, 'اضافه‌کاری روزهای عادی با ضریب ۱٫۴'],
  ['holiday_overtime', 'اضافه‌کاری تعطیل', 'earning', 'overtime', 'hours', 0, 1, 1, 0, 80, 'اضافه‌کاری روزهای تعطیل با ضریب ۲'],
  ['night_shift', 'فوق‌العاده نوبت شب', 'earning', 'allowance', 'hours', 0, 1, 1, 0, 90, 'شب‌کاری با ضریب ۱٫۳۵'],
  ['mission_allowance', 'فوق‌العاده مأموریت', 'earning', 'allowance', 'manual', 0, 1, 1, 0, 100, 'هزینه و فوق‌العاده مأموریت'],
  ['productivity', 'فوق‌العاده بهره‌وری', 'earning', 'bonus', 'percent', 0, 1, 1, 0, 110, 'پاداش بهره‌وری — قابل تنظیم به‌صورت درصدی'],
  ['bonus', 'پاداش عملکرد', 'earning', 'bonus', 'manual', 0, 1, 0, 0, 120, 'پاداش عملکرد دوره‌ای'],
  ['eid_bonus', 'عیدی و پاداش سالانه', 'earning', 'bonus', 'manual', 0, 1, 0, 0, 130, 'عیدی پایان سال (حداکثر ۳ برابر حقوق پایه)'],
  ['severance', 'سنوات پایان خدمت', 'earning', 'settlement', 'manual', 0, 0, 0, 0, 140, 'ذخیره سنوات (در تسویه پرداخت می‌شود)'],
  ['car_allowance', 'حق خودرو / ایاب و ذهاب', 'earning', 'allowance', 'manual', 0, 1, 0, 0, 150, 'کمک‌هزینه ایاب و ذهاب یا حق خودرو'],
  ['remote_allowance', 'حق دورکاری', 'earning', 'allowance', 'manual', 0, 1, 0, 0, 160, 'هزینه‌های ارتباطی و تجهیزات دورکاری'],
  ['other_earnings', 'سایر مزایا', 'earning', 'other', 'manual', 0, 1, 0, 0, 170, 'هر نوع مزیت دیگر — با توضیح در فیش'],
  ['insurance_employee', 'بیمه تأمین اجتماعی (سهم کارمند)', 'deduction', 'insurance', 'percent', 7, 0, 0, 0, 200, '۷٪ حقوق مشمول بیمه'],
  ['income_tax', 'مالیات بر درآمد', 'deduction', 'tax', 'formula', 0, 0, 0, 0, 210, 'محاسبه پلکانی بر اساس جدول مالیات سال'],
  ['loan_installment', 'قسط وام', 'deduction', 'loan', 'manual', 0, 0, 0, 0, 220, 'کسر قسط وام از حقوق'],
  ['advance', 'مساعده', 'deduction', 'loan', 'manual', 0, 0, 0, 0, 230, 'کسر مساعده پرداخت‌شده'],
  ['absence_deduction', 'کسر غیبت', 'deduction', 'absence', 'days', 0, 0, 0, 0, 240, 'کسر روزهای غیبت غیرمجاز'],
  ['late_deduction', 'کسر تأخیر و تعجیل', 'deduction', 'absence', 'manual', 0, 0, 0, 0, 250, 'کسر تأخیر ورود / تعجیل خروج'],
  ['disciplinary_deduction', 'کسر انتظامی', 'deduction', 'other', 'manual', 0, 0, 0, 0, 260, 'بر اساس پرونده انتظامی تأییدشده'],
  ['other_deductions', 'سایر کسورات', 'deduction', 'other', 'manual', 0, 0, 0, 0, 270, 'هر نوع کسر دیگر — با توضیح'],
  ['insurance_employer', 'بیمه تأمین اجتماعی (سهم کارفرما)', 'deduction', 'insurance', 'percent', 20, 0, 0, 1, 300, '۲۰٪ سهم کارفرما — هزینه شرکت، از حقوق کسر نمی‌شود'],
  ['unemployment_insurance', 'بیمه بیکاری (سهم کارفرما)', 'deduction', 'insurance', 'percent', 3, 0, 0, 1, 310, '۳٪ بیمه بیکاری — هزینه شرکت'],
];

/** پله‌های مالیات حقوق ۱۴۰۴ — مبالغ به ریال (سقف معافیت ماهانه ۲۴ میلیون تومان) */
const TAX_BRACKETS_1404 = [
  [1, 0, 240000000, 0, 240000000],
  [2, 240000000, 300000000, 10, 0],
  [3, 300000000, 380000000, 15, 0],
  [4, 380000000, 500000000, 20, 0],
  [5, 500000000, 666000000, 25, 0],
  [6, 666000000, 0, 30, 0],
];

const DEPARTMENTS = [
  ['منابع انسانی', 'HR', 'مدیریت سرمایه انسانی، جذب، آموزش، رفاهیات و امور اداری'],
  ['مالی و اداری', 'FIN', 'حسابداری، خزانه، بودجه، حقوق و دستمزد'],
  ['فنی و مهندسی', 'ENG', 'مهندسی طراحی، تحقیق و توسعه و پشتیبانی فنی'],
  ['تولید و عملیات', 'OPS', 'خط تولید، کنترل کیفیت، انبار و لجستیک'],
  ['فروش و بازاریابی', 'SAL', 'فروش، بازاریابی، خدمات پس از فروش'],
  ['فناوری اطلاعات', 'IT', 'زیرساخت، نرم‌افزار و امنیت اطلاعات'],
  ['حقوقی و امور شرکت', 'LEG', 'قراردادها، پرونده‌های حقوقی، امور ثبتی و مجوزها'],
  ['تأمین و خرید', 'PRC', 'تأمین کالا، خرید داخلی و خارجی، انبار'],
];

const ONBOARDING_TEMPLATE = {
  name: 'چک‌لیست استاندارد بدو ورود',
  description: 'کارهای لازم برای استقرار کارمند جدید در ۳۰ روز اول',
  tasks: [
    ['تکمیل و تحویل مدارک پرسنلی (شناسنامه، کارت ملی، آخرین مدرک تحصیلی، عکس)', 'hr', 'hr', 3],
    ['انجام معاینات پزشکی و ثبت کارت سلامت', 'hr', 'hr', 7],
    ['ثبت نام در سامانه بیمه تأمین اجتماعی و دریافت کد بیمه', 'hr', 'hr', 10],
    ['انعقاد و امضای قرارداد کار', 'hr', 'hr', 3],
    ['تشکیل پرونده پرسنلی فیزیکی و الکترونیکی', 'document', 'hr', 5],
    ['معرفی به واحد مربوطه و معرفی همکار راهنما (Buddy)', 'intro', 'hr', 1],
    ['تحویل تجهیزات و اموال (لپ‌تاپ، موبایل، کارت شناسایی، لباس فرم)', 'it', 'manager', 2],
    ['ساخت حساب کاربری ایمیل سازمانی و دسترسی‌های سامانه', 'it', 'manager', 2],
    ['آموزش قوانین و مقررات، آیین‌نامه‌های داخلی و ایمنی', 'training', 'hr', 7],
    ['توضیح ساختار سازمانی و شرح وظایف شغلی', 'intro', 'manager', 3],
    ['آموزش سیستم‌ها و فرآیندهای کاری واحد', 'training', 'manager', 14],
    ['انتخاب و ثبت اهداف و شاخص‌های عملکرد ۳ ماهه', 'hr', 'manager', 20],
    ['جلسه بازخورد پایان دوره آزمایشی و تصمیم تثبیت', 'hr', 'manager', 90],
  ],
};

const OFFBOARDING_TEMPLATES = [
  ['تسویه انبار و تحویل اموال', 'finance', 'انبار و اموال', ['بازگشت لپ‌تاپ/موبایل', 'بازگشت ابزار و تجهیزات', 'تحویل کارت شناسایی و لباس فرم', 'تسویه انبار']],
  ['تسویه فناوری اطلاعات', 'it', 'فناوری اطلاعات', ['غیرفعال‌سازی ایمیل', 'بازگشت دسترسی‌ها و کارت ورود', 'تحویل اطلاعات و فایل‌های کاری', 'پاک‌سازی سیستم']],
  ['تسویه مالی', 'finance', 'مالی و اداری', ['تسویه مساعده و وام', 'تسویه هزینه‌های مأموریت', 'تسویه کارت بانکی/اعتباری']],
  ['تسویه منابع انسانی', 'hr', 'منابع انسانی', ['تحویل تسویه نهایی', 'تسویه مرخصی‌های باقی‌مانده', 'ثبت اسناد در پرونده']],
  ['تسویه نگهبانی و ورود و خروج', 'security', 'نگهبانی', ['لغو مجوز ورود', 'بازگشت کارت تردد', 'تحویل کلید و رمز']],
];

const LETTER_TEMPLATES = [
  ['employment_certificate', 'گواهی اشتغال به کار', 'certificate', 'گواهی می‌شود آقای/خانم {{full_name}} فرزند {{father_name}} با کد ملی {{national_id}} از تاریخ {{hire_date}} تا کنون در این شرکت به عنوان {{job_title}} در واحد {{department}} مشغول به کار بوده و هم‌اکنون نیز از همکاران فعال این شرکت می‌باشد. این گواهی به درخواست ایشان و جهت ارائه به مراجع ذی‌ربط صادر گردیده است.'],
  ['salary_certificate', 'گواهی حقوق و مزایا', 'certificate', 'گواهی می‌شود آقای/خانم {{full_name}} با کد پرسنلی {{personnel_code}} در این شرکت مشغول به کار بوده و میانگین حقوق ماهانه ایشان در سه ماه گذشته مبلغ {{salary_amount}} ریال و دستمزد ماهانه ایشان مبلغ {{base_salary}} ریال می‌باشد.'],
  ['bank_letter', 'معرفی‌نامه بانکی', 'introduction', 'بدین‌وسیله آقای/خانم {{full_name}} با کد ملی {{national_id}} را که از همکاران این شرکت می‌باشد، جهت افتتاح حساب/دریافت تسهیلات به آن بانک محترم معرفی می‌نماییم. لازم به ذکر است ایشان از تاریخ {{hire_date}} در شرکت مشغول به کار می‌باشد.'],
  ['intro_letter', 'معرفی‌نامه عمومی', 'introduction', 'بدین‌وسیله آقای/خانم {{full_name}}، {{job_title}} این شرکت، جهت انجام امور مربوطه به آن سازمان محترم معرفی می‌گردد. خواهشمند است دستور فرمایید همکاری لازم مبذول گردد.'],
  ['work_experience_reference', 'گواهی سابقه کار', 'certificate', 'گواهی می‌شود آقای/خانم {{full_name}} از تاریخ {{hire_date}} تا {{end_date}} به مدت {{duration}} در این شرکت با سمت {{job_title}} اشتغال داشته و از ایشان تشکر و قدردانی می‌گردد.'],
  ['settlement_letter', 'نامه تسویه حساب پایان کار', 'settlement', 'با سلام، بدین‌وسیله گواهی می‌شود که حساب‌های آقای/خانم {{full_name}} در تاریخ {{settlement_date}} تسویه و مبلغ {{net_payable}} ریال به عنوان مطالبات پایان کار به ایشان پرداخت/تخصیص گردید.'],
];

const ASSET_TYPES = ['لپ‌تاپ', 'کیس کامپیوتر', 'مانیتور', 'گوشی موبایل', 'میز و صندلی', 'کمد', 'ابزار دستی', 'ابزار برقی', 'خودرو', 'دوچرخه', 'تجهیزات ایمنی', 'سایر'];
const WELFARE_FACILITIES = [
  ['سالن ورزش', 'gym', 20, 'هر روز ۷ تا ۱۹'],
  ['نمازخانه', 'prayer', 50, 'در ساعات کاری'],
  ['اتاق استراحت', 'rest', 10, '۲۴ ساعته'],
  ['کتابخانه', 'library', 15, '۸ تا ۱۷'],
  ['مهد کودک', 'nursery', 12, '۷ تا ۱۷'],
];

/* ================================================================== */
/* اجرای Seed                                                        */
/* ================================================================== */

async function exists(table, where, params = []) {
  try {
    const row = await db.get(`SELECT COUNT(*) AS c FROM ${db.t(table)} WHERE ${where}`, params);
    return Number(row.c) > 0;
  } catch (_) { return false; }
}

/* -------------------------- نقش‌ها و مجوزها -------------------------- */

async function seedPermissionsAndRoles() {
  const perms = allPermissions();
  const allKeys = perms.map((p) => p.key);

  // ۱) مجوزها
  let i = 0;
  for (const p of perms) {
    i += 1;
    const row = await db.get(`SELECT id FROM ${db.t('permissions')} WHERE pkey = ?`, [p.key]);
    if (row) {
      await db.run(
        `UPDATE ${db.t('permissions')} SET module=?, action=?, name=?, group_name=?, sort_order=? WHERE id=?`,
        [p.module, p.action, p.name, p.group, i, row.id]
      );
    } else {
      await db.run(
        `INSERT INTO ${db.t('permissions')} (pkey, module, action, name, group_name, sort_order, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [p.key, p.module, p.action, p.name, p.group, i, db.nowSql()]
      );
    }
  }

  // ۲) نقش‌ها
  let order = 0;
  for (const role of ROLES) {
    order += 1;
    let row = await db.get(`SELECT id FROM ${db.t('roles')} WHERE rkey = ?`, [role.key]);
    if (!row) {
      const id = await db.insert('roles', {
        rkey: role.key, name: role.name, description: role.description, scope: role.scope,
        is_system: 1, is_locked: role.locked ? 1 : 0, sort_order: order, status: 'active',
      });
      row = { id };
    } else {
      await db.run(`UPDATE ${db.t('roles')} SET name=?, description=?, scope=?, sort_order=? WHERE id=?`,
        [role.name, role.description, role.scope, order, row.id]);
    }
    // ۳) اتصال مجوزها
    const granted = expandPerms(role.perms, allKeys);
    const permRows = await db.query(`SELECT id, pkey FROM ${db.t('permissions')}`);
    const idByKey = new Map(permRows.map((r) => [r.pkey, r.id]));
    const current = await db.query(`SELECT permission_id FROM ${db.t('role_permissions')} WHERE role_id = ?`, [row.id]);
    const currentSet = new Set(current.map((r) => r.permission_id));
    for (const key of granted) {
      const pid = idByKey.get(key);
      if (pid && !currentSet.has(pid)) {
        await db.run(`INSERT INTO ${db.t('role_permissions')} (role_id, permission_id) VALUES (?,?)`, [row.id, pid]);
      }
    }
  }

  // ۴) نقش سوپر ادمین را با «همه مجوزها» به‌روز نگه دار
  const admin = await db.get(`SELECT id FROM ${db.t('roles')} WHERE rkey = 'admin'`);
  if (admin) {
    const permRows = await db.query(`SELECT id FROM ${db.t('permissions')}`);
    const current = await db.query(`SELECT permission_id FROM ${db.t('role_permissions')} WHERE role_id = ?`, [admin.id]);
    const currentSet = new Set(current.map((r) => r.permission_id));
    for (const p of permRows) {
      if (!currentSet.has(p.id)) {
        await db.run(`INSERT INTO ${db.t('role_permissions')} (role_id, permission_id) VALUES (?,?)`, [admin.id, p.id]);
      }
    }
  }
  return { permissions: perms.length, roles: ROLES.length };
}

/* ------------------------------ ماژول‌ها ------------------------------ */

async function seedModules() {
  let idx = 0;
  for (const m of MODULES) {
    idx += 1;
    const row = await db.get(`SELECT id, is_enabled FROM ${db.t('modules')} WHERE mkey = ?`, [m.key]);
    const perms = (m.perms || []).map((p) => `${m.key}.${p[0]}`);
    if (!row) {
      await db.run(
        `INSERT INTO ${db.t('modules')} (mkey, name, description, category, icon, version, is_enabled, is_core, is_licensed, dependencies, permissions, sort_order, menu_group, installed_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [m.key, m.name, m.description || '', m.category || '', m.icon || '', '1.0.0',
          m.core ? 1 : (m.defaultEnabled === false ? 0 : 1), m.core ? 1 : 0, 1,
          JSON.stringify(m.deps || []), JSON.stringify(perms), idx, m.category || '', db.nowSql(), db.nowSql()]
      );
    } else {
      await db.run(
        `UPDATE ${db.t('modules')} SET name=?, description=?, category=?, icon=?, dependencies=?, permissions=?, sort_order=?, menu_group=? WHERE id=?`,
        [m.name, m.description || '', m.category || '', m.icon || '', JSON.stringify(m.deps || []),
          JSON.stringify(perms), idx, m.category || '', row.id]
      );
    }
  }
  return MODULES.length;
}

/* --------------------------- فرم استخدام --------------------------- */

async function seedFormTemplate() {
  let tpl = await db.get(`SELECT id FROM ${db.t('form_templates')} WHERE tkey = ?`, [FORM_TEMPLATE.tkey]);
  if (!tpl) {
    const id = await db.insert('form_templates', { ...FORM_TEMPLATE, version: 1, is_active: 1, allow_save_draft: 1, show_progress: 1, auto_save: 1 });
    tpl = { id };
  }
  const tplId = tpl.id;

  let order = 0;
  for (const sec of FORM_SECTIONS) {
    order += 1;
    let section = await db.get(`SELECT id FROM ${db.t('form_sections')} WHERE template_id = ? AND title = ?`, [tplId, sec.title]);
    if (!section) {
      const id = await db.insert('form_sections', {
        template_id: tplId, title: sec.title, description: sec.description || '',
        icon: sec.icon || '', sort_order: order, is_active: 1, is_repeatable: sec.repeatable || 0,
      });
      section = { id };
    }
    const fields = FORM_FIELDS[sec.title] || [];
    let forder = 0;
    for (const [key, label, type, required, extra = {}] of fields) {
      forder += 1;
      const existing = await db.get(`SELECT id FROM ${db.t('form_fields')} WHERE template_id = ? AND fkey = ?`, [tplId, key]);
      const data = {
        template_id: tplId,
        section_id: section.id,
        fkey: key,
        label,
        help_text: extra.help || '',
        placeholder: extra.placeholder || '',
        type,
        options: extra.options ? JSON.stringify(extra.options) : null,
        validation: extra.validation ? JSON.stringify(extra.validation) : null,
        default_value: extra.default_value || '',
        is_required: required ? 1 : 0,
        is_enabled: 1,
        is_system: 1,
        visible_roles: 'hr,admin',
        depends_on: extra.depends_on || '',
        depends_value: extra.depends_value || '',
        width: extra.width || 'full',
        sort_order: forder,
        min_length: extra.min_length || null,
        max_length: extra.max_length || null,
        unit: extra.unit || '',
        note_hr: extra.note_hr || '',
      };
      if (existing) await db.update('form_fields', data, 'id = ?', [existing.id]);
      else await db.insert('form_fields', data);
    }
  }
  return tplId;
}

/* ------------------------------ آزمون MBTI ------------------------------ */

async function seedAssessment() {
  let test = await db.get(`SELECT id FROM ${db.t('assessment_tests')} WHERE akey = ?`, ['mbti']);
  const testData = {
    akey: 'mbti',
    name: 'آزمون روان‌شناسی شخصیتی (MBTI)',
    type: 'mbti',
    description: 'آزمون ۲۸ سؤالی سنجش تیپ شخصیتی بر اساس چهار محور E/I، S/N، T/F و J/P',
    instructions: 'در هر سؤال، گزینه‌ای را انتخاب کنید که اغلب رفتار شما را بهتر توصیف می‌کند. پاسخ درست یا غلط وجود ندارد.',
    duration_minutes: 15,
    question_count: MBTI_QUESTIONS.length,
    is_active: 1,
    is_locked: 0,
    is_public: 1,
    version: 1,
    show_to_candidate: 0,
    result_visibility: 'hr_only',
    intro_text: 'این آزمون برای شناخت بهتر سبک کاری شماست و نتیجه آن در فرآیند بررسی پرونده استفاده می‌شود.',
    thanks_text: 'پاسخ‌های شما ثبت شد. از همکاری شما سپاسگزاریم.',
    scoring_key: JSON.stringify({ E: 'EI', I: 'EI', S: 'SN', N: 'SN', T: 'TF', F: 'TF', J: 'JP', P: 'JP' }),
  };
  if (!test) {
    const id = await db.insert('assessment_tests', testData);
    test = { id };
  } else {
    await db.update('assessment_tests', testData, 'id = ?', [test.id]);
  }
  const count = await db.get(`SELECT COUNT(*) AS c FROM ${db.t('assessment_questions')} WHERE test_id = ?`, [test.id]);
  if (!Number(count.c)) {
    for (const [number, axis, text, optA, valA, optB, valB] of MBTI_QUESTIONS) {
      await db.insert('assessment_questions', {
        test_id: test.id, number, code: `Q${number}`, question_text: text, axis,
        option_a: optA, option_a_value: valA, option_b: optB, option_b_value: valB,
        sort_order: number, is_active: 1,
      });
    }
  }
  return test.id;
}

/* --------------------------- سایر داده‌ها --------------------------- */

async function seedLookups() {
  // مراحل استخدام
  if (!(await exists('recruitment_stages', '1=1'))) {
    let i = 0;
    for (const [name, key, color, isFinal] of RECRUITMENT_STAGES) {
      i += 1;
      await db.insert('recruitment_stages', { name, key, color, is_final: isFinal, sort_order: i, is_active: 1 });
    }
  }

  // انواع مرخصی
  if (!(await exists('leave_types', '1=1'))) {
    let i = 0;
    for (const [key, name, color, paid, maxDays, accrual, needsApproval, needsDoc, carry, encash] of LEAVE_TYPES) {
      i += 1;
      await db.insert('leave_types', {
        lkey: key, name, color, is_paid: paid, max_days_year: maxDays, monthly_accrual: accrual,
        requires_approval: needsApproval, requires_doc: needsDoc, carry_forward: carry, encashable: encash,
        status: 'active', sort_order: i,
      });
    }
  }

  // اقلام حقوق و دستمزد
  for (const [key, name, type, category, calc, val, taxable, insurable, employerCost, order, desc] of PAYROLL_COMPONENTS) {
    const row = await db.get(`SELECT id, is_active FROM ${db.t('payroll_components')} WHERE ckey = ?`, [key]);
    const data = {
      ckey: key, name, type, category, calc_type: calc, default_value: val,
      taxable, insurable, affects_net: employerCost ? 0 : 1,
      is_system: 1, is_active: 1, show_on_payslip: 1, is_employer_cost: employerCost,
      sort_order: order, description: desc,
    };
    if (!row) await db.insert('payroll_components', data);
    else await db.update('payroll_components', { ...data, is_active: row.is_active }, 'id = ?', [row.id]);
  }

  // پله‌های مالیات ۱۴۰۴
  const year = 1404;
  const hasBrackets = await exists('tax_brackets', 'year = ?', [year]);
  if (!hasBrackets) {
    let i = 0;
    for (const [order, from, to, rate, exemption] of TAX_BRACKETS_1404) {
      i += 1;
      await db.insert('tax_brackets', {
        year, from_amount: from, to_amount: to, rate_percent: rate, exemption,
        title: order === 1 ? 'معافیت پایه' : `پله ${order}`, is_active: 1, sort_order: order,
      });
    }
  }

  // تنظیمات قانونی حقوق ۱۴۰۴ (قابل ویرایش از پنل)
  const payrollSettings = [
    ['tax_year', '1404', 'سال مالیاتی جاری'],
    ['tax_exemption_monthly', '240000000', 'سقف معافیت مالیاتی ماهانه (ریال) — سال ۱۴۰۴'],
    ['insurance_employee_percent', '7', 'درصد بیمه تأمین اجتماعی سهم کارمند'],
    ['insurance_employer_percent', '23', 'درصد بیمه تأمین اجتماعی سهم کارفرما (شامل ۳٪ بیمه بیکاری)'],
    ['unemployment_percent', '3', 'درصد بیمه بیکاری (از سهم کارفرما)'],
    ['min_base_salary_daily', '3463656', 'حداقل دستمزد روزانه ۱۴۰۴ (ریال)'],
    ['min_base_salary_monthly', '107373336', 'حداقل دستمزد ماهانه ۱۴۰۴ — ماه ۳۱ روزه (ریال)'],
    ['eid_days', '60', 'عیدی سالانه معادل چند روز حقوق پایه'],
    ['eid_min_days', '60', 'حداقل عیدی (روز)'],
    ['eid_max_days', '90', 'حداکثر عیدی (روز)'],
    ['seniority_days', '30', 'سنوات سالانه (روز) به ازای هر سال خدمت'],
    ['overtime_rate', '1.4', 'ضریب اضافه‌کاری روز عادی'],
    ['holiday_overtime_rate', '2', 'ضریب اضافه‌کاری روز تعطیل'],
    ['night_rate', '1.35', 'ضریب فوق‌العاده شب‌کاری'],
    ['housing_allowance', '9000000', 'حق مسکن ماهانه (ریال)'],
    ['food_allowance', '22000000', 'بن کارگری ماهانه (ریال)'],
    ['marriage_allowance', '5000000', 'حق تأهل ماهانه (ریال)'],
    ['child_allowance', '0', 'حق اولاد ماهانه به ازای هر فرزند (ریال)'],
    ['insurance_days_default', '30', 'روز بیمه پیش‌فرض در ماه'],
  ];
  for (const [skey, value, title] of payrollSettings) {
    const row = await db.get(`SELECT id FROM ${db.t('payroll_settings')} WHERE skey = ?`, [skey]);
    if (!row) await db.insert('payroll_settings', { skey, value, year, title, description: '' });
  }

  // تنظیمات عمومی سامانه
  const appSettings = [
    ['app.name', 'مینی HRM'],
    ['app.tagline', 'سامانه جامع منابع انسانی، جذب و استخدام'],
    ['payroll.employee_insurance_percent', '7'],
    ['payroll.employer_insurance_percent', '23'],
    ['payroll.unemployment_percent', '3'],
  ];
  for (const [k, v] of appSettings) {
    const row = await db.get(`SELECT skey FROM ${db.t('settings')} WHERE skey = ?`, [k]);
    if (!row) await db.run(`INSERT INTO ${db.t('settings')} (skey, value, updated_at) VALUES (?,?,?)`, [k, v, db.nowSql()]);
  }

  // واحدهای سازمانی نمونه
  if (!(await exists('departments', '1=1'))) {
    let i = 0;
    for (const [name, code, description] of DEPARTMENTS) {
      i += 1;
      await db.insert('departments', { name, code, description, sort_order: i, status: 'active' });
    }
  }

  // انواع اموال، امکانات رفاهی
  if (!(await exists('welfare_facilities', '1=1'))) {
    for (const [name, type, capacity, hours] of WELFARE_FACILITIES) {
      await db.insert('welfare_facilities', { name, type, capacity, open_hours: hours, status: 'active' });
    }
  }

  // قالب‌های نامه
  for (const [key, title, category, body] of LETTER_TEMPLATES) {
    const row = await db.get(`SELECT id FROM ${db.t('letter_templates')} WHERE tkey = ?`, [key]);
    if (!row) {
      await db.insert('letter_templates', { tkey: key, title, category, body, is_active: 1 });
    }
  }

  // قالب بدو ورود
  if (!(await exists('onboarding_templates', '1=1'))) {
    const tplId = await db.insert('onboarding_templates', {
      name: ONBOARDING_TEMPLATE.name, description: ONBOARDING_TEMPLATE.description, is_active: 1, is_default: 1,
    });
    let i = 0;
    for (const [title, category, ownerRole, dueDays] of ONBOARDING_TEMPLATE.tasks) {
      i += 1;
      await db.insert('onboarding_tasks', {
        template_id: tplId, title, category, owner_role: ownerRole, due_days: dueDays, is_required: 1, sort_order: i,
      });
    }
  }

  // مراحل تسویه ترک کار (به‌عنوان قالب کارهای پیش‌فرض)
  if (!(await exists('offboarding_tasks', '1=1')) && !(await exists('offboarding_requests', '1=1'))) {
    // فقط به‌عنوان راهنما نگه داشته می‌شود؛ هنگام ساخت درخواست ترک کار استفاده می‌شود
    await db.run(`INSERT INTO ${db.t('settings')} (skey, value, updated_at) VALUES (?,?,?)`, [
      'offboarding.default_clearances',
      JSON.stringify(OFFBOARDING_TEMPLATES.map(([title, key, dept, items]) => ({ title, key, department: dept, items }))),
      db.nowSql(),
    ]).catch(() => {});
  }
}

/* ------------------------------ اجرای کل ------------------------------ */

async function seedAll({ createSuperAdmin } = {}) {
  const out = {};
  out.permissionsRoles = await seedPermissionsAndRoles();
  out.modules = await seedModules();
  out.formTemplateId = await seedFormTemplate();
  out.assessmentTestId = await seedAssessment();
  await seedLookups();

  if (createSuperAdmin) {
    const { username, password, fullName, mobile, email } = createSuperAdmin;
    const adminRole = await db.get(`SELECT id FROM ${db.t('roles')} WHERE rkey = 'admin'`);
    const existing = await db.get(`SELECT id FROM ${db.t('users')} WHERE username = ?`, [username]);
    if (existing) throw new Error('این نام کاربری قبلاً ثبت شده است.');
    out.superAdminId = await db.insert('users', {
      username,
      password_hash: createSuperAdmin.passwordHash,
      full_name: fullName,
      email: email || null,
      mobile: mobile || null,
      role_id: adminRole ? adminRole.id : null,
      is_superadmin: 1,
      status: 'active',
      must_change_password: 0,
      password_changed_at: db.nowSql(),
    });
  }
  await db.run(`INSERT INTO ${db.t('schema_migrations')} (version, name, applied_at) VALUES (?,?,?)`,
    ['1.0.0', 'initial-schema', db.nowSql()]);
  return out;
}

module.exports = {
  seedAll, seedPermissionsAndRoles, seedModules, seedFormTemplate, seedAssessment, seedLookups,
  FORM_TEMPLATE, FORM_SECTIONS, FORM_FIELDS, MBTI_QUESTIONS, PAYROLL_COMPONENTS, TAX_BRACKETS_1404,
  LETTER_TEMPLATES, ONBOARDING_TEMPLATE, OFFBOARDING_TEMPLATES, RECRUITMENT_STAGES, LEAVE_TYPES,
};
