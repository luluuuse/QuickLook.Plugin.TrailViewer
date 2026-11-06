// Crops a region of a PNG at 2x, for looking at small details of a rendered overlay.
//   node tools/crop.cjs <in.png> <out.png> <x%> <y%> <w%> <h%>
const fs = require('fs');
const { chromium } = require('playwright-core');

const [, , input, output, xp, yp, wp, hp] = process.argv;
const png = 'data:image/png;base64,' + fs.readFileSync(input).toString('base64');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
  const page = await browser.newPage();
  const data = await page.evaluate(async ({ src, xp, yp, wp, hp }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const x = Math.round(img.width * xp);
    const y = Math.round(img.height * yp);
    const w = Math.round(img.width * wp);
    const h = Math.round(img.height * hp);
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y, w, h, 0, 0, w * 2, h * 2);
    return canvas.toDataURL('image/png');
  }, { src: png, xp: Number(xp), yp: Number(yp), wp: Number(wp), hp: Number(hp) });
  fs.writeFileSync(output, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${output}: ${(fs.statSync(output).size / 1024).toFixed(0)} KB`);
  await browser.close();
})();
