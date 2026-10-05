/* ==========================================================================
   مینی HRM — اسکریپت سمت مرورگر
   شامل: تاریخ‌گزین شمسی، منو، اعلان‌ها، تأییدیه‌ها، انتخاب گروهی، کانبان،
         جست‌وجوی سراسری، برچسب‌گذاری مبالغ و سنجش قدرت گذرواژه
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  /* ------------------------------------------------------------------ */
  /* تبدیل تاریخ شمسی (نسخه سبک مرورگر — هم‌ارز jalaali-js)               */
  /* ------------------------------------------------------------------ */
  const J = (function () {
    const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    const div = (a, b) => Math.trunc(a / b);
    const mod = (a, b) => a - Math.floor(a / b) * b;
    function jalCal(jy) {
      const bl = breaks.length; const gy = jy + 621; let leapJ = -14; let jp = breaks[0]; let jm; let jump = 0;
      for (let i = 1; i < bl; i += 1) {
        jm = breaks[i]; jump = jm - jp;
        if (jy < jm) break;
        leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm;
      }
      let n = jy - jp;
      leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
      if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
      const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
      const march = 20 + leapJ - leapG;
      if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
      let leap = mod(mod(n + 1, 33) - 1, 4); if (leap === -1) leap = 4;
      return { leap, gy, march };
    }
    function g2d(gy, gm, gd) {
      let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
      d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
      return d;
    }
    function d2g(jdn) {
      let j = 4 * jdn + 139361631;
      j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
      const i = div(mod(j, 1461), 4) * 5 + 308;
      return { gy: div(j, 1461) - 100100 + div(8 - div(mod(i, 153), 5) - 1, 6) * 0 + div(8 - (mod(div(i, 153), 12) + 1), 6), gm: mod(div(i, 153), 12) + 1, gd: div(mod(i, 153), 5) + 1 };
    }
    function toJalaali(date) {
      const jdn = g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
      const gy = (function (jdn2) {
        let j = 4 * jdn2 + 139361631;
        j = j + div(div(4 * jdn2 + 183187720, 146097) * 3, 4) * 4 - 3908;
        const i = div(mod(j, 1461), 4) * 5 + 308;
        return { gy: div(j, 1461) - 100100 + div(8 - (mod(div(i, 153), 12) + 1), 6), gm: mod(div(i, 153), 12) + 1, gd: div(mod(i, 153), 5) + 1 };
      })(jdn).gy;
      let jy = gy - 621; const r = jalCal(jy); const jdn1f = g2d(gy, 3, r.march);
      let k = jdn - jdn1f; let jm; let jd;
      if (k >= 0) {
        if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy, jm, jd }; }
        k -= 186;
      } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
      jm = 7 + div(k, 30); jd = mod(k, 30) + 1; return { jy, jm, jd };
    }
    function j2d(jy, jm, jd) { const r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1; }
    function toGregorian(jy, jm, jd) {
      const jdn = j2d(jy, jm, jd); let j = 4 * jdn + 139361631;
      j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
      const i = div(mod(j, 1461), 4) * 5 + 308;
      return { gy: div(j, 1461) - 100100 + div(8 - (mod(div(i, 153), 12) + 1), 6), gm: mod(div(i, 153), 12) + 1, gd: div(mod(i, 153), 5) + 1 };
    }
    function monthLength(jy, jm) { if (jm <= 6) return 31; if (jm <= 11) return 30; return jalCal(jy).leap === 1 ? 30 : 29; }
    return { toJalaali, toGregorian, monthLength, d2g };
  })();

  const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];      // شنبه تا جمعه
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (v) => String(v === null || v === undefined ? '' : v).replace(/[0-9]/g, (d) => FA[+d]);

  /* ------------------------------------------------------------------ */
  /* تاریخ‌گزین شمسی                                                     */
  /* ------------------------------------------------------------------ */
  let activePicker = null;

  function buildPicker(input) {
    const wrap = document.createElement('div');
    wrap.className = 'jdp';
    wrap.style.cssText = 'position:absolute;z-index:200;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);padding:.7rem;width:290px';
    wrap.innerHTML =
      '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem">' +
      '<button type="button" class="btn btn-ghost btn-icon" data-nav="prev" aria-label="ماه قبل">‹</button>' +
      '<div style="flex:1;text-align:center;font-weight:600" data-title></div>' +
      '<button type="button" class="btn btn-ghost btn-icon" data-nav="next" aria-label="ماه بعد">›</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;font-size:.72rem;color:var(--text-muted);margin-bottom:.25rem">' +
      WEEKDAYS.map((w) => '<div>' + w + '</div>').join('') + '</div>' +
      '<div data-grid style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px"></div>' +
      '<div style="display:flex;gap:.4rem;margin-top:.6rem;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-sm" data-today>امروز</button>' +
      '<button type="button" class="btn btn-sm" data-clear>پاک کردن</button>' +
      '<button type="button" class="btn btn-sm btn-outline-primary" data-close style="margin-right:auto">بستن</button>' +
      '</div>';
    return wrap;
  }

  function offsetDays(jdn) { return Math.round(jdn); }

  function openPicker(input) {
    closePicker();
    const picker = buildPicker(input);
    document.body.appendChild(picker);
    const rect = input.getBoundingClientRect();
    const scrollY = window.scrollY; const scrollX = window.scrollX;
    let left = rect.left + scrollX;
    if (left + 300 > window.innerWidth + scrollX) left = Math.max(scrollX + 8, window.innerWidth + scrollX - 300);
    picker.style.top = (rect.bottom + scrollY + 6) + 'px';
    picker.style.left = left + 'px';

    let current = (() => {
      const v = input.value || input.dataset.iso || '';
      const parsed = parseJalaliInput(v);
      if (parsed) return { jy: parsed.jy, jm: parsed.jm };
      const now = new Date();
      const j = J.toJalaali(now);
      return { jy: j.jy, jm: j.jm };
    })();
    const selected = parseJalaliInput(input.dataset.iso || input.value || '');

    function parseJalaliInput(v) {
      const digits = String(v || '').replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[-.]/g, '/');
      const m = digits.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (m) return { jy: +m[1], jm: +m[2], jd: +m[3] };
      const iso = digits.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) { const j = J.toJalaali(new Date(+iso[1], +iso[2] - 1, +iso[3])); return { jy: j.jy, jm: j.jm, jd: j.jd }; }
      return null;
    }

    function render() {
      $('[data-title]', picker).textContent = J_MONTHS[current.jm - 1] + ' ' + fa(current.jy);
      const grid = $('[data-grid]', picker);
      grid.innerHTML = '';
      const first = J.toGregorian(current.jy, current.jm, 1);
      const jsDay = first.getDay();             // 0=یکشنبه … 6=شنبه
      const lead = (jsDay + 1) % 7;             // شنبه = ۰
      for (let i = 0; i < lead; i += 1) grid.appendChild(document.createElement('div'));
      const len = J.monthLength(current.jy, current.jm);
      const todayJ = J.toJalaali(new Date());
      for (let d = 1; d <= len; d += 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = fa(d);
        const isSel = selected && selected.jy === current.jy && selected.jm === current.jm && selected.jd === d;
        const isToday = todayJ.jy === current.jy && todayJ.jm === current.jm && todayJ.jd === d;
        btn.style.cssText = 'padding:.35rem 0;border-radius:7px;border:1px solid transparent;cursor:pointer;font-family:inherit;font-size:.82rem;background:' +
          (isSel ? 'var(--primary)' : 'transparent') + ';color:' + (isSel ? '#fff' : 'var(--text)') + ';' +
          (isToday && !isSel ? 'border-color:var(--primary);font-weight:700' : '');
        btn.addEventListener('mouseenter', () => { if (!isSel) btn.style.background = 'var(--slate-100)'; });
        btn.addEventListener('mouseleave', () => { if (!isSel) btn.style.background = 'transparent'; });
        btn.addEventListener('click', () => {
          const g = J.toGregorian(current.jy, current.jm, d);
          const iso = g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
          const display = current.jy + '/' + String(current.jm).padStart(2, '0') + '/' + String(d).padStart(2, '0');
          input.value = fa(display);
          input.dataset.iso = iso;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('jalali:change', { bubbles: true }));
          closePicker();
        });
        grid.appendChild(btn);
      }
    }

    $$('[data-nav]', picker).forEach((b) => on(b, 'click', () => {
      const dir = b.dataset.nav === 'prev' ? -1 : 1;
      current.jm += dir;
      if (current.jm < 1) { current.jm = 12; current.jy -= 1; }
      if (current.jm > 12) { current.jm = 1; current.jy += 1; }
      render();
    }));
    on($('[data-today]', picker), 'click', () => {
      const t = J.toJalaali(new Date());
      const g = J.toGregorian(t.jy, t.jm, t.jd);
      input.value = fa(t.jy + '/' + String(t.jm).padStart(2, '0') + '/' + String(t.jd).padStart(2, '0'));
      input.dataset.iso = g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('jalali:change', { bubbles: true }));
      closePicker();
    });
    on($('[data-clear]', picker), 'click', () => {
      input.value = ''; input.dataset.iso = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closePicker();
    });
    on($('[data-close]', picker), 'click', closePicker);
    render();
    activePicker = { picker, input };
    setTimeout(() => document.addEventListener('mousedown', outsideClose), 0);
  }

  function outsideClose(e) {
    if (!activePicker) return;
    if (activePicker.picker.contains(e.target) || activePicker.input === e.target) return;
    closePicker();
  }

  function closePicker() {
    if (!activePicker) return;
    activePicker.picker.remove();
    document.removeEventListener('mousedown', outsideClose);
    activePicker = null;
  }

  function initDatePickers(root) {
    $$('input[data-jalali]', root).forEach((input) => {
      if (input.dataset.jdpReady) return;
      input.dataset.jdpReady = '1';
      input.setAttribute('readonly', 'readonly');
      input.style.cursor = 'pointer';
      input.setAttribute('inputmode', 'numeric');
      on(input, 'focus', () => openPicker(input));
      on(input, 'click', () => openPicker(input));
      on(input, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openPicker(input); } });
      // اگر کاربر دستی تایپ کرد
      on(input, 'blur', () => {
        const v = input.value.trim();
        if (!v) { input.dataset.iso = ''; return; }
        const digits = v.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[-.]/g, '/');
        const m = digits.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
        if (m) {
          const g = J.toGregorian(+m[1], +m[2], +m[3]);
          input.dataset.iso = g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* رابط کاربری عمومی                                                  */
  /* ------------------------------------------------------------------ */
  function initSidebar() {
    $$('[data-sidebar-toggle]').forEach((btn) => on(btn, 'click', () => {
      const sb = $('#sidebar'); const ov = $('.sidebar-overlay');
      sb.classList.toggle('open');
      ov.classList.toggle('show');
    }));
    $$('[data-collapse]').forEach((btn) => on(btn, 'click', () => {
      const target = document.getElementById(btn.dataset.collapse);
      if (!target) return;
      target.classList.toggle('open');
      btn.setAttribute('aria-expanded', target.classList.contains('open') ? 'true' : 'false');
    }));
    $$('[data-menu-toggle]').forEach((btn) => on(btn, 'click', (e) => {
      e.stopPropagation();
      const panel = $('[data-menu-panel]', btn.parentElement);
      if (!panel) return;
      panel.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', panel.classList.contains('hidden') ? 'false' : 'true');
    }));
    document.addEventListener('click', (e) => {
      $$('[data-menu-panel]').forEach((p) => { if (!p.contains(e.target) && !e.target.closest('[data-menu-toggle]')) p.classList.add('hidden'); });
    });
  }

  function toast(type, message, timeout) {
    const stack = $('#toastStack');
    if (!stack) return;
    const colors = { success: 'var(--success)', danger: 'var(--danger)', error: 'var(--danger)', warning: 'var(--warning)', info: 'var(--info)' };
    const div = document.createElement('div');
    div.className = 'toast';
    div.setAttribute('role', 'status');
    div.innerHTML = '<span style="width:4px;border-radius:4px;background:' + (colors[type] || colors.info) + '"></span>' +
      '<div style="flex:1;font-size:.87rem">' + message + '</div>' +
      '<button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="بستن">✕</button>';
    stack.appendChild(div);
    const close = () => { div.style.opacity = '0'; setTimeout(() => div.remove(), 200); };
    on($('button', div), 'click', close);
    setTimeout(close, timeout || 6000);
  }

  function initFlash() {
    const tpl = $('#flashData');
    if (tpl) { toast(tpl.dataset.type, tpl.dataset.message, 7000); tpl.remove(); }
  }

  function initTheme() {
    const KEY = 'hrm-theme';
    const saved = localStorage.getItem(KEY);
    if (saved) document.documentElement.dataset.theme = saved;
    $$('[data-theme-toggle]').forEach((btn) => on(btn, 'click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(KEY, next);
    }));
  }

  function initConfirm() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-confirm]');
      if (!el) return;
      e.preventDefault();
      const msg = el.dataset.confirm || 'آیا از انجام این عملیات اطمینان دارید؟';
      if (window.confirm(msg)) {
        if (el.tagName === 'A') window.location = el.href;
        else if (el.form) el.form.submit();
        else if (el.dataset.submitTarget) { const f = document.getElementById(el.dataset.submitTarget); if (f) f.submit(); }
      }
    });
  }

  function initBulk() {
    const boxes = () => $$('input[name="ids"]');
    const bar = () => $('#bulkBar');
    function refresh() {
      const checked = boxes().filter((b) => b.checked);
      const b = bar();
      if (b) b.classList.toggle('hidden', checked.length === 0);
      const c = $('#bulkCount');
      if (c) c.textContent = fa(checked.length);
      const holder = $('#bulkIds');
      if (holder) {
        holder.innerHTML = '';
        checked.forEach((cb) => {
          const inp = document.createElement('input');
          inp.type = 'hidden'; inp.name = 'ids'; inp.value = cb.value;
          holder.appendChild(inp);
        });
      }
      const all = $('#checkAll');
      if (all) all.checked = checked.length > 0 && checked.length === boxes().length;
    }
    document.addEventListener('change', (e) => {
      if (e.target.id === 'checkAll') {
        boxes().forEach((b) => { b.checked = e.target.checked; });
        refresh();
      } else if (e.target.matches('input[name="ids"]')) refresh();
    });
    document.addEventListener('click', (e) => {
      const cancel = e.target.closest('[data-bulk-cancel]');
      if (cancel) { boxes().forEach((b) => { b.checked = false; }); refresh(); }
    });
    setTimeout(refresh, 0);
  }

  function initTabs() {
    $$('[data-tabs]').forEach((group) => {
      $$('[data-tab]', group).forEach((btn) => on(btn, 'click', () => {
        $$('[data-tab]', group).forEach((b) => b.classList.toggle('active', b === btn));
        const target = btn.dataset.tab;
        const container = document.querySelector(group.dataset.tabs) || document;
        $$('[data-tab-panel]', container).forEach((p) => p.classList.toggle('active', p.dataset.tabPanel === target));
      }));
    });
  }

  function initAmounts() {
    $$('input[data-money]').forEach((input) => {
      const fmt = () => {
        const raw = input.value.replace(/[^\d.-]/g, '');
        if (!raw) return;
        const n = Number(raw);
        if (Number.isFinite(n)) input.value = n.toLocaleString('en-US');
      };
      on(input, 'blur', fmt);
      on(input, 'focus', () => { input.value = input.value.replace(/,/g, ''); });
      input.setAttribute('inputmode', 'numeric');
    });
  }

  function initPasswordStrength() {
    const input = $('#passwordInput');
    const bar = $('#strengthBar');
    if (!input || !bar) return;
    const label = $('#strengthLabel');
    on(input, 'input', () => {
      const s = input.value;
      let score = 0;
      if (s.length >= 8) score += 25;
      if (s.length >= 12) score += 15;
      if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score += 15;
      if (/\d/.test(s)) score += 15;
      if (/[^A-Za-z0-9]/.test(s)) score += 20;
      if (s.length >= 16) score += 10;
      if (s.length < 6) score = Math.min(score, 15);
      const color = score < 40 ? 'var(--danger)' : score < 70 ? 'var(--warning)' : 'var(--success)';
      bar.innerHTML = '<span style="width:' + score + '%;background:' + color + '"></span>';
      if (label) label.textContent = score < 40 ? 'گذرواژهٔ ضعیف' : score < 70 ? 'گذرواژهٔ متوسط' : 'گذرواژهٔ قوی';
    });
    $$('[data-toggle-password]').forEach((btn) => on(btn, 'click', () => {
      const t = document.getElementById(btn.dataset.togglePassword);
      if (t) t.type = t.type === 'password' ? 'text' : 'password';
    }));
  }

  function initSearch() {
    const input = $('#globalSearch');
    const results = $('#globalSearchResults');
    if (!input || !results) return;
    let timer = null;
    on(input, 'input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { results.classList.add('hidden'); return; }
      timer = setTimeout(async () => {
        try {
          const res = await fetch('/search?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
          const data = await res.json();
          if (!data.items || !data.items.length) {
            results.innerHTML = '<div style="padding:.7rem .9rem;color:var(--text-muted);font-size:.85rem">نتیجه‌ای یافت نشد</div>';
          } else {
            results.innerHTML = data.items.map((it) =>
              '<a href="' + it.url + '"><span class="badge muted">' + it.type + '</span><span>' + it.title + '</span>' +
              (it.sub ? '<span class="muted small" style="margin-right:auto">' + it.sub + '</span>' : '') + '</a>').join('');
          }
          results.classList.remove('hidden');
        } catch (_) { results.classList.add('hidden'); }
      }, 250);
    });
    on(document, 'click', (e) => { if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden'); });
    on(document, 'keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
      if (e.key === 'Escape') { results.classList.add('hidden'); closePicker(); }
    });
  }

  function initKanban() {
    const board = $('[data-kanban]');
    if (!board) return;
    let dragged = null;
    $$('.kanban-card', board).forEach((card) => {
      card.draggable = true;
      on(card, 'dragstart', () => { dragged = card; card.classList.add('dragging'); });
      on(card, 'dragend', () => { card.classList.remove('dragging'); dragged = null; $$('.kanban-col').forEach((c) => c.classList.remove('drag-over')); });
    });
    $$('.kanban-col', board).forEach((col) => {
      on(col, 'dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      on(col, 'dragleave', () => col.classList.remove('drag-over'));
      on(col, 'drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!dragged) return;
        const stageId = col.dataset.stageId;
        const id = dragged.dataset.id;
        const target = $('.kanban-cards', col);
        target.appendChild(dragged);
        try {
          const res = await fetch(board.dataset.kanban + '/' + id + '/stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__csrf },
            body: JSON.stringify({ stage_id: stageId }),
          });
          const data = await res.json();
          if (data.ok) toast('success', data.message || 'مرحله داوطلب به‌روزرسانی شد.');
          else toast('danger', data.error || 'خطا در به‌روزرسانی');
        } catch (err) { toast('danger', 'ارتباط با سرور برقرار نشد.'); }
      });
    });
  }

  function initFormGuards() {
    // هشدار هنگام ترک فرم تغییر‌یافته
    $$('form[data-guard]').forEach((form) => {
      let dirty = false;
      on(form, 'input', () => { dirty = true; });
      on(form, 'submit', () => { dirty = false; });
      window.addEventListener('beforeunload', (e) => {
        if (dirty && !form.dataset.submitted) { e.preventDefault(); e.returnValue = ''; }
      });
    });
    // ارسال فرم با دکمه‌های data-submit
    $$('[data-submit]').forEach((btn) => on(btn, 'click', () => {
      const form = document.getElementById(btn.dataset.submit);
      if (form) form.submit();
    }));
    // دکمه تکراری‌نشدن ارسال
    $$('form').forEach((form) => on(form, 'submit', () => {
      form.dataset.submitted = '1';
      $$('button[type="submit"]', form).forEach((b) => { b.disabled = true; setTimeout(() => { b.disabled = false; }, 4000); });
    }));
  }

  function initOtp() {
    const boxes = $$('.otp-boxes input');
    if (!boxes.length) return;
    boxes.forEach((box, i) => {
      on(box, 'input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        if (box.value && boxes[i + 1]) boxes[i + 1].focus();
        const hidden = $('#otpValue');
        if (hidden) hidden.value = boxes.map((b) => b.value).join('');
      });
      on(box, 'keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
        if (e.key === 'ArrowLeft' && boxes[i + 1]) boxes[i + 1].focus();
        if (e.key === 'ArrowRight' && boxes[i - 1]) boxes[i - 1].focus();
      });
      on(box, 'paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!text) return;
        e.preventDefault();
        text.split('').forEach((ch, k) => { if (boxes[k]) boxes[k].value = ch; });
        const hidden = $('#otpValue');
        if (hidden) hidden.value = boxes.map((b) => b.value).join('');
        const next = boxes[Math.min(text.length, boxes.length - 1)];
        if (next) next.focus();
      });
    });
    if (boxes[0]) boxes[0].focus();
    // شمارش معکوس ارسال مجدد
    const resend = $('#resendBtn');
    if (resend && resend.dataset.wait) {
      let left = Number(resend.dataset.wait);
      resend.disabled = true;
      const tick = () => {
        resend.textContent = 'ارسال مجدد تا ' + fa(left) + ' ثانیه';
        left -= 1;
        if (left < 0) { resend.disabled = false; resend.textContent = 'ارسال مجدد کد'; clearInterval(timer); }
      };
      const timer = setInterval(tick, 1000); tick();
    }
  }

  function initCopy() {
    document.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-copy]');
      if (!el) return;
      e.preventDefault();
      let text = el.dataset.copy;
      if (text && (text.startsWith('#') || text.startsWith('.'))) {
        const target = $(text);
        text = target ? (target.value || target.textContent || '').trim() : '';
      }
      try {
        await navigator.clipboard.writeText(text);
        toast('success', 'در حافظه کپی شد.');
      } catch (_) { window.prompt('برای کپی، متن را انتخاب کنید:', text); }
    });
  }

  function initChoiceCards() {
    $$('.choice-card input').forEach((input) => {
      const sync = () => {
        const name = input.name;
        $$('input[name="' + name + '"]').forEach((i) => i.closest('.choice-card')?.classList.toggle('selected', i.checked));
      };
      on(input, 'change', sync);
      sync();
    });
    // چک‌باکس‌های ساده
    $$('.check input').forEach((input) => {
      const sync = () => input.closest('.check')?.classList.toggle('checked', input.checked);
      on(input, 'change', sync); sync();
    });
  }

  function initAutoSaveForm() {
    const form = $('form[data-autosave]');
    if (!form) return;
    const key = 'hrm-draft-' + (form.dataset.autosave || 'form');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
    if (saved && !form.dataset.dirtyGuard) {
      const same = Array.from(form.elements).some((el) => el.name && saved[el.name] && String(el.value || '') !== String(saved[el.name]));
      if (same && window.confirm('پیش‌نویس ذخیره‌نشده‌ای از این فرم وجود دارد. بازیابی شود؟')) {
        Object.entries(saved).forEach(([k, v]) => {
          const el = form.elements[k];
          if (!el) return;
          if (el.type === 'checkbox' || el.type === 'radio') return;
          el.value = v;
        });
        toast('info', 'پیش‌نویس بازیابی شد.');
      }
    }
    setInterval(() => {
      const data = {};
      Array.from(form.elements).forEach((el) => { if (el.name && el.type !== 'file' && el.type !== 'submit') data[el.name] = el.value; });
      try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
    }, 5000);
    on(form, 'submit', () => { try { localStorage.removeItem(key); } catch (_) {} });
  }

  function initModals() {
    $$('[data-modal-open]').forEach((btn) => on(btn, 'click', () => {
      const m = document.getElementById(String(btn.dataset.modalOpen).replace(/^#/, ''));
      if (m) m.classList.remove('hidden');
    }));
    $$('[data-modal-close]').forEach((btn) => on(btn, 'click', () => {
      const m = btn.closest('.modal-backdrop');
      if (m) m.classList.add('hidden');
    }));
    document.addEventListener('click', (e) => {
      if (e.target.classList && e.target.classList.contains('modal-backdrop') && !e.target.dataset.keepOpen) e.target.classList.add('hidden');
    });
    on(document, 'keydown', (e) => { if (e.key === 'Escape') $$('.modal-backdrop').forEach((m) => m.classList.add('hidden')); });
  }

  /* ------------------------------------------------------------------ */
  /* شروع                                                               */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* فراخوانی سرور (JSON) — همراه با توکن امنیتی                        */
  /* ------------------------------------------------------------------ */
  async function api(url, opts) {
    const options = Object.assign({ method: 'GET' }, opts || {});
    const headers = Object.assign({ Accept: 'application/json', 'X-CSRF-Token': window.__csrf || '' }, options.headers || {});
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(url, { method: options.method, headers, body, credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch (_) { data = { ok: res.ok, message: '' }; }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || data.message || 'خطا در ارتباط با سرور');
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  }

  function postForm(url, values) {
    const params = new URLSearchParams();
    Object.keys(values || {}).forEach((k) => params.append(k, values[k]));
    params.append('_csrf', window.__csrf || '');
    return api(url, { method: 'POST', body: params.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  }

  function money(value) {
    const n = Number(String(value === null || value === undefined ? 0 : value).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) return '—';
    return fa(n.toLocaleString('en-US'));
  }

  function ask(message) { return window.confirm(message || 'آیا از انجام این عملیات اطمینان دارید؟'); }

  document.addEventListener('DOMContentLoaded', () => {
    var csrfInput = $('input[name="_csrf"]');
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    window.__csrf = (csrfInput && csrfInput.value) || (csrfMeta && csrfMeta.content) || '';
    initSidebar(); initFlash(); initTheme(); initConfirm(); initBulk(); initTabs();
    initAmounts(); initPasswordStrength(); initSearch(); initKanban(); initFormGuards();
    initOtp(); initCopy(); initChoiceCards(); initAutoSaveForm(); initModals();
    initDatePickers(document);
  });

  // API عمومی برای استفاده در قالب‌ها
  window.HRM = {
    toast, fa, J, openPicker, initDatePickers, closePicker, api, money, ask,
    get: (url) => api(url, { method: 'GET' }),
    post: (url, body) => api(url, { method: 'POST', body: body || {} }),
    postForm,
    reload: (delay) => setTimeout(() => window.location.reload(), delay || 400),
    go: (url) => { window.location = url; },
  };
})();
