#!/usr/bin/env bash
# ساخت بسته نصب cPanel — بدون نیاز به SSH روی هاست (آپلود ZIP و استفاده از Setup Node.js App)
# اجرا:  npm run zip:cpanel
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="$ROOT/dist"
NAME="minihrm-cpanel-${VERSION}"
ZIP="$OUT_DIR/${NAME}.zip"
STAGE="$OUT_DIR/${NAME}"

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE"

echo "→ آماده‌سازی فایل‌ها…"
# فایل‌های اصلی برنامه (بدون node_modules و داده‌های محلی)
cp -R src tools "$STAGE/"
cp server.js app.js package.json package-lock.json .gitignore "$STAGE/"
[ -f README.md ] && cp README.md "$STAGE/"

# فایل‌های SQL تولیدشده (نصب دستی در phpMyAdmin) — در صورت نبود، ساخته می‌شوند
if [ ! -f sql/schema-mysql.sql ]; then
  echo "→ تولید فایل‌های SQL…"
  node -e "require('./src/db/migrator').writeSqlFiles()" >/dev/null 2>&1 || true
fi
if [ -d sql ]; then
  mkdir -p "$STAGE/sql"
  cp sql/*.sql "$STAGE/sql/" 2>/dev/null || true
fi

# پوشه‌های لازم در هاست (توسط برنامه هم ساخته می‌شوند)
mkdir -p "$STAGE/storage/backups" "$STAGE/storage/uploads" "$STAGE/storage/logs"
cat > "$STAGE/storage/.gitkeep" <<'EOF'
EOF

# راهنمای سریع نصب روی همان بسته
cat > "$STAGE/نصب-سریع.txt" <<'EOF'
نصب مینی HRM روی cPanel (بدون SSH)
=================================
۱) فایل ZIP را در File Manager هاست آپلود و Extract کنید (مثلاً در پوشه nodeapps/minihrm).
۲) در cPanel → Setup Node.js App، یک برنامه بسازید:
      Application root : پوشه‌ای که Extract کردید
      Application startup file : server.js
      Node.js version : 18 یا بالاتر
۳) در همان صفحه، دکمه Run NPM Install را بزنید (وابستگی‌ها نصب می‌شوند).
۴) گزینه Restart را بزنید و سپس آدرس سایت را در مرورگر باز کنید.
۵) اگر برنامه نصب نشده باشد، به‌صورت خودکار به /install هدایت می‌شوید:
      – اطلاعات پایگاه‌داده MySQL (ساخته‌شده در MySQL Databases) را وارد کنید
      – نام کاربری و گذرواژه مدیر کل (سوپر ادمین) را تعیین کنید
      – پیش‌نیازهای هاست بررسی و جداول ساخته می‌شوند
۶) پس از نصب، با همان نام کاربری/گذرواژه وارد شوید و ماژول‌ها را فعال کنید.

نکته‌ها
-------
• برای MySQL مطمئن شوید کاربر پایگاه‌داده به دیتابیس دسترسی ALL PRIVILEGES دارد.
• اگر از SQLite استفاده می‌کنید، پوشه storage باید قابل نوشتن (755 یا 775) باشد.
• کرون روزانه (Cron Jobs → Add New Cron Job): دستور زیر با کلید امنیتی نمایش‌داده‌شده در
  «تنظیمات → یادآورها» و «تنظیمات → پشتیبان‌گیری» قابل تنظیم است:
      /usr/bin/curl -s "https://YOUR-DOMAIN/settings/reminders/cron?token=کلید" > /dev/null
      /usr/bin/curl -s "https://YOUR-DOMAIN/settings/backup/cron?token=کلید" > /dev/null
EOF

echo "→ فشرده‌سازی…"
(cd "$OUT_DIR" && zip -qr "$NAME.zip" "$NAME")
rm -rf "$STAGE"

SIZE="$(du -h "$ZIP" | cut -f1)"
echo "✔ بسته ساخته شد: $ZIP ($SIZE)"
echo "  محتوای بسته: کد برنامه، tools، package.json، sql، پوشه storage خالی و راهنمای نصب"
