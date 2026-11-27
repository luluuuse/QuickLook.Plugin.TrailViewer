// Automated guardrail for TrailViewer theme consistency:
// 1. Verifies 5-way theme registry sync (theme.js, ViewerPreferences.cs, i18n.js, tokens.css, toolbox.css).
// 2. Verifies every theme defines all required core semantic tokens.
// 3. Verifies WCAG AA (>= 4.5:1) contrast for core text and primary button pairs.
// 4. Guards against negative :not([data-theme=...]) ornament selectors outside allowlisted structural rules.
// 5. Guards against theme button background overrides that lack a matching :hover rule.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function check(condition, label, detail = '') {
  if (condition) {
    console.log(`PASS  theme: ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures.push(`${label}${detail ? ` (${detail})` : ''}`);
    console.error(`FAIL  theme: ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function parseHexOrRgba(raw, fallbackBg = [24, 24, 24]) {
  const value = (raw || '').trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    const r = Number(rgba[1]);
    const g = Number(rgba[2]);
    const b = Number(rgba[3]);
    const a = rgba[4] !== undefined ? Number(rgba[4]) : 1;
    return [
      Math.round(r * a + fallbackBg[0] * (1 - a)),
      Math.round(g * a + fallbackBg[1] * (1 - a)),
      Math.round(b * a + fallbackBg[2] * (1 - a)),
    ];
  }
  return null;
}

function luminance([r, g, b]) {
  const toLinear = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function extractCssBlock(css, headerRegex) {
  const match = headerRegex.exec(css);
  if (!match) return null;
  let depth = 0;
  let start = -1;
  for (let i = match.index; i < css.length; i += 1) {
    if (css[i] === '{') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) return css.slice(start, i);
    }
  }
  return null;
}

function parseTokens(block) {
  const map = new Map();
  if (!block) return map;
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block)) !== null) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

// 1. Registry sync
const themeJs = read('viewer/theme.js');
const themeJsMatch = themeJs.match(/THEMES\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/);
const jsThemes = themeJsMatch
  ? [...themeJsMatch[1].matchAll(/['"]([a-z0-9_-]+)['"]/gi)].map((m) => m[1])
  : [];

const prefsCs = read('src/ViewerPreferences.cs');
const prefsMatch = prefsCs.match(/\["theme"\]\s*=\s*new\[\]\s*\{([^}]+)\}/);
const csThemes = prefsMatch
  ? [...prefsMatch[1].matchAll(/"([a-z0-9_-]+)"/gi)].map((m) => m[1])
  : [];

check(jsThemes.length >= 3, 'viewer/theme.js defines THEMES', jsThemes.join(', '));
check(
  JSON.stringify([...jsThemes].sort()) === JSON.stringify([...csThemes].sort()),
  'ViewerPreferences.cs theme allowlist matches viewer/theme.js',
  `js=[${jsThemes.join(',')}] cs=[${csThemes.join(',')}]`,
);

const i18nJs = read('viewer/i18n.js');
const tokensCss = read('viewer/css/tokens.css');
const toolboxCss = read('viewer/css/toolbox.css');

const REQUIRED_TOKENS = [
  '--bg', '--panel', '--panel-solid', '--hud-shadow', '--track-casing',
  '--text', '--text-bright', '--muted', '--accent', '--accent-hover', '--accent-text',
  '--tool-panel-background', '--surface-card', '--surface-control', '--surface-input', '--surface-hover',
  '--border-hairline', '--border-subtle', '--border-control', '--border-strong',
  '--panel-radius', '--control-radius', '--toolbar-radius',
  '--icon-color', '--icon-active', '--icon-active-background', '--icon-active-line',
  '--btn-primary-bg', '--btn-primary-hover', '--btn-primary-text',
  '--scrollbar-thumb', '--scrollbar-thumb-hover',
];

const swissBlock = extractCssBlock(tokensCss, /:root,\s*:root\[data-theme="swiss"\]\s*\{/);
const swissTokens = parseTokens(swissBlock);

for (const id of jsThemes) {
  const keyMatches = [...i18nJs.matchAll(new RegExp(`'theme\\.${id}'\\s*:`, 'g'))];
  const hintMatches = [...i18nJs.matchAll(new RegExp(`'theme\\.${id}Hint'\\s*:`, 'g'))];
  check(keyMatches.length >= 2, `i18n.js has EN+ZH label for theme "${id}"`, `found ${keyMatches.length}`);
  check(hintMatches.length >= 2, `i18n.js has EN+ZH hint for theme "${id}"`, `found ${hintMatches.length}`);

  const swatchPresent = new RegExp(`\\.toolbox-theme-option\\[data-theme-option="${id}"\\]`).test(toolboxCss);
  check(swatchPresent, `toolbox.css defines miniature swatch for theme "${id}"`);

  const block = id === 'swiss'
    ? swissBlock
    : extractCssBlock(tokensCss, new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{`));
  check(Boolean(block), `tokens.css defines :root[data-theme="${id}"]`);

  const merged = new Map(swissTokens);
  for (const [k, v] of parseTokens(block)) merged.set(k, v);
  const missing = REQUIRED_TOKENS.filter((token) => !merged.has(token));
  check(missing.length === 0, `theme "${id}" defines all required semantic tokens`, missing.join(', ') || 'complete');

  // WCAG AA contrast audit on solid panel & primary CTA
  const panelBg = parseHexOrRgba(merged.get('--panel-solid'));
  const textFg = parseHexOrRgba(merged.get('--text'), panelBg || [24, 24, 24]);
  const mutedFg = parseHexOrRgba(merged.get('--muted'), panelBg || [24, 24, 24]);
  const btnBg = parseHexOrRgba(merged.get('--btn-primary-bg'), panelBg || [24, 24, 24]);
  const btnFg = parseHexOrRgba(merged.get('--btn-primary-text'), btnBg || [0, 102, 214]);

  if (panelBg && textFg) {
    const ratio = contrastRatio(textFg, panelBg);
    check(ratio >= 4.5, `theme "${id}" text contrast >= 4.5:1`, `${ratio.toFixed(2)}:1`);
  }
  if (panelBg && mutedFg) {
    const ratio = contrastRatio(mutedFg, panelBg);
    check(ratio >= 4.5, `theme "${id}" muted text contrast >= 4.5:1`, `${ratio.toFixed(2)}:1`);
  }
  if (btnBg && btnFg) {
    const ratio = contrastRatio(btnFg, btnBg);
    check(ratio >= 4.5, `theme "${id}" primary button contrast >= 4.5:1`, `${ratio.toFixed(2)}:1`);
  }
  const accentTextFg = parseHexOrRgba(merged.get('--accent-text'), panelBg || [24, 24, 24]);
  if (panelBg && accentTextFg) {
    const ratio = contrastRatio(accentTextFg, panelBg);
    check(ratio >= 4.5, `theme "${id}" accent-text contrast >= 4.5:1`, `${ratio.toFixed(2)}:1`);
  }
  if (id !== 'ios') {
    const accentBg = parseHexOrRgba(merged.get('--accent'), panelBg || [24, 24, 24]);
    const accentHoverBg = parseHexOrRgba(merged.get('--accent-hover'), panelBg || [24, 24, 24]);
    if (accentBg) {
      const ratio = contrastRatio([255, 255, 255], accentBg);
      check(ratio >= 4.5, `theme "${id}" solid accent fill contrast >= 4.5:1`, `${ratio.toFixed(2)}:1`);
    }
    if (accentHoverBg) {
      const ratio = contrastRatio([255, 255, 255], accentHoverBg);
      check(ratio >= 4.5, `theme "${id}" solid accent hover contrast >= 4.5:1`, `${ratio.toFixed(2)}:1`);
    }
  }
}

// Check adaptive light-tone block for ios
const iosDarkTokens = new Map(swissTokens);
for (const [k, v] of parseTokens(extractCssBlock(tokensCss, /:root\[data-theme="ios"\]\s*\{/))) {
  iosDarkTokens.set(k, v);
}
const iosLightBlock = extractCssBlock(tokensCss, /:root\[data-theme="ios"\]\[data-map-tone="light"\]\s*\{/);
if (iosLightBlock) {
  const iosLightTokens = new Map(iosDarkTokens);
  for (const [k, v] of parseTokens(iosLightBlock)) iosLightTokens.set(k, v);
  const panelBg = parseHexOrRgba(iosLightTokens.get('--panel-solid'));
  const textFg = parseHexOrRgba(iosLightTokens.get('--text'), panelBg);
  const mutedFg = parseHexOrRgba(iosLightTokens.get('--muted'), panelBg);
  const btnBg = parseHexOrRgba(iosLightTokens.get('--btn-primary-bg'), panelBg);
  const btnFg = parseHexOrRgba(iosLightTokens.get('--btn-primary-text'), btnBg);
  check(contrastRatio(textFg, panelBg) >= 4.5, 'theme "ios" (light map) text contrast >= 4.5:1', `${contrastRatio(textFg, panelBg).toFixed(2)}:1`);
  check(contrastRatio(mutedFg, panelBg) >= 4.5, 'theme "ios" (light map) muted text contrast >= 4.5:1', `${contrastRatio(mutedFg, panelBg).toFixed(2)}:1`);
  check(contrastRatio(btnFg, btnBg) >= 4.5, 'theme "ios" (light map) primary button contrast >= 4.5:1', `${contrastRatio(btnFg, btnBg).toFixed(2)}:1`);
}

// 4. No negative :not([data-theme=...]) ornament selectors outside allowlisted #info .stats dividers
const cssDir = path.join(root, 'viewer', 'css');
const badNegatives = [];
for (const file of fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
  const content = fs.readFileSync(path.join(cssDir, file), 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes(':not([data-theme=')) return;
    if (file === 'panels.css' && line.includes('#info .stats')) return;
    badNegatives.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}
check(badNegatives.length === 0, 'no negative :not([data-theme=...]) ornament selectors in CSS', badNegatives.join('; ') || 'clean');

// 5. Swatch size lock: no theme-specific width/height override on .toolbox-theme-option
const swatchOverrides = [...toolboxCss.matchAll(/\.toolbox-theme-option\[data-theme-option="[^"]+"\]\s*\{([^}]+)\}/g)]
  .filter((m) => /\b(width|height)\s*:/i.test(m[1]));
check(swatchOverrides.length === 0, 'all theme miniature swatches share locked dimensions');

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} theme check(s) failed`);
  process.exit(1);
}
console.log('all theme consistency checks passed');
