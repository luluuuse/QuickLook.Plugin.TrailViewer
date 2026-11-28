// Build the minified, code-split Release viewer assets into bin/Release/viewer.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const FIRST_SCREEN_CSS = [
  'tokens.css',
  'panels.css',
  'toolbox.css',
  'layers.css',
  'map-data.css',
  'photos.css',
];

const LEAFLET_FILES = [
  'leaflet.js',
  'leaflet.css',
  'LICENSE',
];

function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      const sub = dirStats(full);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, item.name);
    const destPath = path.join(dest, item.name);
    if (item.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function transformIndexHtml(html) {
  let replacedCss = false;
  const cssPattern = /^[ \t]*<link\s+rel="stylesheet"\s+href="css\/([^"]+)">[ \t]*\r?\n?/gm;
  let result = html.replace(cssPattern, (match, file) => {
    if (!FIRST_SCREEN_CSS.includes(file)) return match;
    if (replacedCss) return '';
    replacedCss = true;
    const indent = match.match(/^[ \t]*/)[0];
    const newline = match.endsWith('\r\n') ? '\r\n' : '\n';
    return `${indent}<link rel="stylesheet" href="css/app.css">${newline}`;
  });
  if (!replacedCss) {
    throw new Error('index.html did not contain expected first-screen CSS links');
  }

  const preloadPattern = /^[ \t]*<link\s+rel="modulepreload"\s+href="([^"]+)">[ \t]*\r?\n?/gm;
  result = result.replace(preloadPattern, (match, href) => (href === 'app.js' ? match : ''));
  return result;
}

async function buildViewer(root = path.resolve(__dirname, '..'), outDir = path.join(root, 'bin', 'Release', 'viewer')) {
  const srcDir = path.join(root, 'viewer');
  if (!fs.existsSync(srcDir)) throw new Error(`viewer source directory not found at ${srcDir}`);

  const before = dirStats(srcDir);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(srcDir, 'app.js')],
    outdir: outDir,
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: true,
    target: 'chrome115',
    legalComments: 'none',
    chunkNames: 'chunks/[name]-[hash]',
  });

  const cssOutDir = path.join(outDir, 'css');
  fs.mkdirSync(cssOutDir, { recursive: true });

  const combinedCss = FIRST_SCREEN_CSS
    .map((file) => fs.readFileSync(path.join(srcDir, 'css', file), 'utf8'))
    .join('\n');
  const appCss = esbuild.transformSync(combinedCss, {
    loader: 'css',
    minify: true,
    target: 'chrome115',
    legalComments: 'none',
  });
  fs.writeFileSync(path.join(cssOutDir, 'app.css'), appCss.code, 'utf8');

  const editorCssRaw = fs.readFileSync(path.join(srcDir, 'css', 'editor.css'), 'utf8');
  const editorCss = esbuild.transformSync(editorCssRaw, {
    loader: 'css',
    minify: true,
    target: 'chrome115',
    legalComments: 'none',
  });
  fs.writeFileSync(path.join(cssOutDir, 'editor.css'), editorCss.code, 'utf8');

  const indexHtml = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'index.html'), transformIndexHtml(indexHtml), 'utf8');

  copyDir(path.join(srcDir, 'assets'), path.join(outDir, 'assets'));

  const leafletOutDir = path.join(outDir, 'vendor', 'leaflet');
  fs.mkdirSync(leafletOutDir, { recursive: true });
  for (const file of LEAFLET_FILES) {
    fs.copyFileSync(path.join(srcDir, 'vendor', 'leaflet', file), path.join(leafletOutDir, file));
  }

  const after = dirStats(outDir);
  const savedPct = ((1 - after.bytes / before.bytes) * 100).toFixed(1);
  console.log(`viewer build: ${(before.bytes / 1024).toFixed(1)} KB (${before.files} files) -> `
    + `${(after.bytes / 1024).toFixed(1)} KB (${after.files} files, -${savedPct}%)`);

  return { before, after };
}

module.exports = { buildViewer };

if (require.main === module) {
  buildViewer().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
