// Renders the overlay canvas for one fixture and writes the PNG, so the design can be looked at.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const fixture = process.argv[2] || 'tests/fixtures/2026-02-01-alpine-snow-traverse-1793781751910.gpx';
const out = process.argv[3] || 'F:/AI/outdoor-gear/ql-src/shots/overlay.png';
const lang = process.argv[4] || 'zh';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gpx': 'application/gpx+xml' };

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('console', (m) => console.log('console:', m.text()));
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/viewer/index.html?src=${encodeURIComponent('../' + fixture)}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.body.classList.contains('failed'));

  // Idempotent: click only when the page is not already in the language asked for.
  await page.evaluate((want) => {
    if ((document.documentElement.lang === 'zh-CN') !== (want === 'zh')) {
      document.querySelector('.lang-switch button')?.click();
    }
  }, lang);
  await page.waitForTimeout(300);

  const data = await page.evaluate(async ({ photo, options }) => {
    const canvas = await window.gpxViewer.overlayCanvas(options);
    if (!photo) return canvas.toDataURL('image/png');
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d');
    if (photo.startsWith('#')) {
      ctx.fillStyle = photo;
      ctx.fillRect(0, 0, flat.width, flat.height);
    } else {
      const img = new Image();
      img.src = photo;
      await img.decode();
      const k = Math.max(flat.width / img.width, flat.height / img.height);
      ctx.drawImage(img, (flat.width - img.width * k) / 2, (flat.height - img.height * k) / 2,
        img.width * k, img.height * k);
    }
    ctx.drawImage(canvas, 0, 0);
    return flat.toDataURL('image/png');
  }, {
    photo: process.env.PHOTO || null,
    // SIZE and SCRIM mirror the panel; without them the page's own remembered settings are used.
    options: {
      ...(process.env.SIZE ? { size: process.env.SIZE } : {}),
      ...(process.env.INK ? { ink: process.env.INK } : {}),
      ...(process.env.SCRIM ? { scrim: process.env.SCRIM } : {}),
    },
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB  lang=${await page.evaluate(() => document.documentElement.lang)}`);
  await browser.close();
  server.close();
});
