const { Jimp } = require('jimp');
const path = require('path');
const fs = require('fs');

async function main() {
  const outDir = path.join(__dirname, '..', 'store-assets');
  fs.mkdirSync(outDir, { recursive: true });

  // 1) Play Store app icon: 512x512, 32-bit PNG
  const icon = await Jimp.read(path.join(__dirname, '..', 'assets', 'icon.png'));
  await icon.clone().resize({ w: 512, h: 512 }).write(path.join(outDir, 'icon-512.png'));

  // 2) Feature graphic: 1024x500, brand background + centered logo
  const bg = new Jimp({ width: 1024, height: 500, color: 0x0e0e10ff });
  const logo = await Jimp.read(path.join(__dirname, '..', 'assets', 'icon.png'));
  const logoSize = 380;
  logo.resize({ w: logoSize, h: logoSize });
  const x = Math.round((1024 - logoSize) / 2);
  const y = Math.round((500 - logoSize) / 2);
  bg.composite(logo, x, y);
  await bg.write(path.join(outDir, 'feature-graphic-1024x500.png'));

  console.log('OK ->', outDir);
}

main().catch((e) => { console.error(e); process.exit(1); });
