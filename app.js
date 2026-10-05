'use strict';
/**
 * فایل شروع جایگزین (برای هاست‌هایی که فایل شاخص می‌خواهند)
 * ----------------------------------------------------------------------------
 * برای Passenger در cPanel: مسیر /home/USER/nodeapps/app  و فایل شروع app.js
 */
const config = require('./src/config');
config.ensureDirs();
const { createApp } = require('./src/app');

if (require.main === module) {
  (async () => {
    const app = await createApp();
    const port = Number(process.env.PORT || config.get('app.port', 3000)) || 3000;
    app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`اجرا روی پورت ${port}`));
  })();
} else {
  module.exports = createApp();
}
