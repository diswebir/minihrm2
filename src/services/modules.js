'use strict';
/**
 * سرویس ماژول‌ها (روشن/خاموش کردن قابلیت‌ها در زمان اجرا)
 * ----------------------------------------------------------------------------
 * وضعیت فعال/غیرفعال هر ماژول در جدول modules نگهداری می‌شود. مدیر سامانه
 * می‌تواند از «تنظیمات › ماژول‌ها» هر قابلیت را بدون تغییر کد روشن یا خاموش کند.
 * منوها، مجوزها و مسیرهای هر ماژول به‌صورت خودکار غیرفعال می‌شوند.
 */
const db = require('../db');
const registry = require('../modules');
const { MODULES } = registry;
const auth = require('./auth');

let cache = null;      // Map(key → is_enabled)
let loadedAt = 0;
const TTL_MS = 20 * 1000;

async function loadState(force = false) {
  const now = Date.now();
  if (cache && !force && now - loadedAt < TTL_MS) return cache;
  const map = new Map();
  MODULES.forEach((m) => map.set(m.key, m.core ? true : m.defaultEnabled !== false));
  try {
    const rows = await db.query(`SELECT mkey, is_enabled FROM ${db.t('modules')}`);
    for (const r of rows) {
      if (map.has(r.mkey)) map.set(r.mkey, Boolean(r.is_enabled));
    }
  } catch (_) { /* پیش از نصب */ }
  cache = map;
  loadedAt = now;
  return map;
}

async function enabledKeys() {
  const map = await loadState();
  return MODULES.filter((m) => map.get(m.key)).map((m) => m.key);
}

async function isEnabled(key) {
  const map = await loadState();
  return Boolean(map.get(key));
}

/** ماژول‌های روشن که کاربر به آن‌ها دسترسی دارد */
async function allowed(user) {
  const keys = await enabledKeys();
  return MODULES.filter((m) => keys.includes(m.key) && auth.can(user, `${m.key}.view`));
}

/** بررسی وابستگی‌ها پیش از روشن کردن */
async function checkDependencies(key) {
  const mod = registry.getModule(key);
  if (!mod) return { ok: false, error: 'ماژول یافت نشد.' };
  const map = await loadState();
  const missing = (mod.deps || []).filter((d) => !map.get(d));
  if (missing.length) {
    const names = missing.map((d) => (registry.getModule(d) || {}).name || d);
    return { ok: false, error: `برای فعال‌سازی این ماژول ابتدا ماژول‌های زیر باید فعال باشند: ${names.join('، ')}` };
  }
  return { ok: true };
}

/** ماژول‌هایی که به این ماژول وابسته‌اند */
async function dependents(key) {
  return MODULES.filter((m) => (m.deps || []).includes(key));
}

/** روشن/خاموش کردن ماژول + ثبت رویداد */
async function setEnabled(key, enabled, user = null, ip = null) {
  const mod = registry.getModule(key);
  if (!mod) return { ok: false, error: 'ماژول یافت نشد.' };
  if (mod.core && !enabled) return { ok: false, error: 'ماژول‌های پایه سامانه قابل غیرفعال‌سازی نیستند.' };

  if (enabled) {
    const dep = await checkDependencies(key);
    if (!dep.ok) return dep;
  } else {
    const deps = await dependents(key);
    const activeDeps = [];
    const map = await loadState();
    for (const d of deps) if (map.get(d.key)) activeDeps.push(d.name);
    if (activeDeps.length) {
      return { ok: false, error: `ابتدا ماژول‌های وابسته را غیرفعال کنید: ${activeDeps.join('، ')}` };
    }
  }

  const table = db.t('modules');
  const row = await db.get(`SELECT id FROM ${table} WHERE mkey = ?`, [key]);
  if (row) {
    await db.run(`UPDATE ${table} SET is_enabled = ?, ${enabled ? 'enabled_at' : 'enabled_at'} = ?, updated_at = ? WHERE mkey = ?`,
      [enabled ? 1 : 0, enabled ? db.nowSql() : null, db.nowSql(), key]);
  } else {
    await db.run(
      `INSERT INTO ${table} (mkey, name, description, category, icon, version, is_enabled, is_core, dependencies, permissions, sort_order, installed_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mod.key, mod.name, mod.description || '', mod.category || '', mod.icon || '', '1.0.0',
        enabled ? 1 : 0, mod.core ? 1 : 0, JSON.stringify(mod.deps || []),
        JSON.stringify((mod.perms || []).map((p) => `${mod.key}.${p[0]}`)), MODULES.indexOf(mod) + 1, db.nowSql(), db.nowSql()]
    );
  }
  await db.run(
    `INSERT INTO ${db.t('module_events')} (mkey, action, user_id, detail, ip, created_at) VALUES (?,?,?,?,?,?)`,
    [key, enabled ? 'enable' : 'disable', user ? user.id : null, `${enabled ? 'فعال‌سازی' : 'غیرفعال‌سازی'} ماژول ${mod.name}`, ip, db.nowSql()]
  );
  cache = null; loadedAt = 0;
  return { ok: true };
}

/** منوی کناری کاربر بر اساس ماژول‌های فعال و مجوزها */
async function menusFor(user) {
  const map = await loadState();
  const groups = [];
  const groupOrder = ['منابع انسانی', 'مالی و اداری', 'رفاهیات', 'امور شرکت', 'امور اداری', 'زیرساخت', 'عمومی'];
  const byGroup = new Map();

  for (const mod of MODULES) {
    if (!map.get(mod.key)) continue;
    const items = (mod.menus || []).filter((mi) => !mi.perm || auth.can(user, mi.perm) || auth.can(user, `${mod.key}.view`));
    if (!items.length) continue;
    const group = mod.category || 'عمومی';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push({ module: mod.key, moduleName: mod.name, icon: mod.icon, items });
  }
  for (const g of groupOrder) if (byGroup.has(g)) groups.push({ name: g, modules: byGroup.get(g) });
  for (const [g, mods] of byGroup) if (!groupOrder.includes(g)) groups.push({ name: g, modules: mods });
  return groups;
}

/** فهرست ماژول‌ها برای صفحه تنظیمات با وضعیت، تعداد جداول و آمار */
async function inventory() {
  const map = await loadState();
  const out = [];
  for (const m of MODULES) {
    const [permsCount, events] = await Promise.all([
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('permissions')} WHERE module = ?`, [m.key]).catch(() => ({ c: 0 })),
      db.get(`SELECT COUNT(*) AS c FROM ${db.t('module_events')} WHERE mkey = ?`, [m.key]).catch(() => ({ c: 0 })),
    ]);
    out.push({
      ...m,
      enabled: Boolean(map.get(m.key)),
      permsCount: permsCount ? permsCount.c : 0,
      eventsCount: events ? events.c : 0,
      dependents: MODULES.filter((x) => (x.deps || []).includes(m.key)).map((x) => x.name),
    });
  }
  return out;
}

/** گیت مسیرها: اگر ماژول خاموش باشد → ۴۰۴ با پیام مناسب */
function requireModule(key) {
  return async (req, res, next) => {
    try {
      if (await isEnabled(key)) return next();
      return res.status(404).render('errors/404', {
        title: 'ماژول غیرفعال است',
        message: 'این بخش توسط مدیر سامانه غیرفعال شده است.',
      });
    } catch (err) { return next(err); }
  };
}

function invalidate() { cache = null; loadedAt = 0; }

module.exports = {
  loadState, enabledKeys, isEnabled, allowed, checkDependencies, dependents,
  setEnabled, menusFor, inventory, requireModule, invalidate,
};
