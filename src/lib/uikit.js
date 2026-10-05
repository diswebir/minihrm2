'use strict';
/**
 * ابزار ساخت «صفحه» برای صفحات ماژول‌ها
 * ----------------------------------------------------------------------------
 * هر ماژول می‌تواند با یک توصیف ساده (spec) صفحه حرفه‌ای بسازد: کارت آماری،
 * جدول، فیلتر، دکمه اقدام و بخش‌های کنار. قالب views/page.ejs آن را رندر می‌کند.
 */
const helpers = require('./helpers');
const jalali = require('./jalali');

/** کارت آماری */
function kpi(label, value, opts = {}) {
  return {
    label, value: opts.money ? helpers.money(value, { suffix: false }) : (opts.rawValue ? value : helpers.pnum(value ?? 0)),
    icon: opts.icon || 'chart', color: opts.color || 'primary', url: opts.url || null, hint: opts.hint || null,
  };
}

/**
 * جدول
 * columns: [{ label, align?, width? }]
 * rows:    [{ cells: [...], url?, html?: [bool,...], actions?: [{icon,title,url,confirm,post,body}] }]
 */
function table(columns, rows, opts = {}) {
  return { type: 'table', columns, rows, empty: opts.empty || 'موردی برای نمایش نیست.', compact: opts.compact, sum: opts.sum || null };
}

/** ردیف جدول */
function row(cells, opts = {}) {
  return { cells, ...opts };
}

/** بج رنگی برای وضعیت */
function badge(value, color) {
  if (value === null || value === undefined || value === '') return '—';
  return `<span class="badge ${color || helpers.statusColor(value)}">${helpers.escapeHtml(helpers.statusLabel(value) || String(value))}</span>`;
}

/** لینک */
function link(url, label) { return `<a href="${url}" class="link">${helpers.escapeHtml(label)}</a>`; }

/** مبلغ */
function money(v) { return helpers.money(v, { suffix: false }); }

/** تاریخ شمسی */
function date(v) { return v ? jalali.formatJalaali(v) : '—'; }

/** تاریخ و ساعت شمسی */
function dateTime(v) { return v ? jalali.formatJalaaliDateTime(v) : '—'; }

/** فهرست کارت‌های ماژول (برای صفحه اصلی ماژول) */
function tiles(items) { return { type: 'tiles', items }; }

/** فهرست عمودی ساده */
function list(title, rows, opts = {}) { return { type: 'list', title, rows, icon: opts.icon || 'list', url: opts.url || null, columns: opts.columns || [] }; }

/** خط زمانی */
function timeline(items) { return { type: 'timeline', items }; }

module.exports = { kpi, table, row, badge, link, money, date, dateTime, tiles, list, timeline };
