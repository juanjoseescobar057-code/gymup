// Algunos entornos Windows administrados devuelven ENOMEM desde uv_os_get_passwd
// en Node 24 aunque haya memoria disponible. tsx solo necesita el home para su
// carpeta temporal; este fallback mantiene las pruebas ejecutables y no toca la app.
const os = require('node:os');
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME || 'gymup-ci',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE || process.cwd(),
  });
}
