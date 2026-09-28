// Inline motion.js and every asset (font, logo, avatar) into one self-contained HTML file.
import { readFileSync, writeFileSync } from 'node:fs';

const b64 = (file, mime) => `data:${mime};base64,${readFileSync(file).toString('base64')}`;
let html = readFileSync('index.html', 'utf8');
html = html
  .replace('url("assets/fonts/inter-latin-wght-normal.woff2")', `url("${b64('assets/fonts/inter-latin-wght-normal.woff2', 'font/woff2')}")`)
  .replace('src="assets/logo.png"', `src="${b64('assets/logo.png', 'image/png')}"`)
  .replace('src="assets/avatar.jpg"', `src="${b64('assets/avatar.jpg', 'image/jpeg')}"`)
  .replace('<script src="motion.js"></script>', () => `<script>\n${readFileSync('motion.js', 'utf8')}</script>`);
if (/assets\/|motion\.js/.test(html)) throw new Error('unresolved local reference left in bundle');
writeFileSync('seospace-dashboard-motion.html', html);
console.log('wrote seospace-dashboard-motion.html', (html.length / 1024).toFixed(0) + ' KB');
