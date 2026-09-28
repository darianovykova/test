// Deterministic renderer: drives window.MOTION.seek(t) and captures frames.
//   node render.mjs beats  [out]   → one PNG per beat (storyboard check)
//   node render.mjs frames t1,t2…  → specific timestamps
//   node render.mjs video  [out]   → 60 fps, 4 sub-frames/frame, tmix motion blur, audio muxed
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const mode = process.argv[2] || 'beats';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const page_url = 'file://' + path.join(root, process.env.HTML || 'index.html') + '?render=1';

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1440 }, deviceScaleFactor: 1 });
await page.goto(page_url);
await page.evaluate(() => window.MOTION.ready);
const info = await page.evaluate(() => ({ T: window.MOTION.T, BEAT: window.MOTION.BEAT, ev: window.MOTION.SOUND_EVENTS }));

async function shot(t, file, type = 'png') {
  await page.evaluate(t => window.MOTION.seek(t), t);
  return page.screenshot({ path: file, type, ...(type === 'jpeg' ? { quality: 95 } : {}) });
}

if (mode === 'beats') {
  const out = process.argv[3] || 'out/beats'; mkdirSync(out, { recursive: true });
  const n = Math.round(info.T / info.BEAT);
  for (let b = 1; b <= n; b++) {
    const t = (b - 1) * info.BEAT;
    await shot(t, `${out}/beat_${String(b).padStart(2, '0')}.png`);
  }
  console.log(`wrote ${n} beat frames to ${out}`);
} else if (mode === 'frames') {
  const out = process.argv[4] || 'out/frames'; mkdirSync(out, { recursive: true });
  for (const s of process.argv[3].split(',')) await shot(parseFloat(s), `${out}/t_${s}.png`);
} else if (mode === 'video') {
  const out = process.argv[3] || 'out/seospace-dashboard-motion.mp4';
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync('out/sound_events.json', JSON.stringify({ T: info.T, events: info.ev }, null, 1));
  const FPS = 60, SUB = 4, frames = Math.round(info.T * FPS);
  const silent = out.replace(/\.mp4$/, '.silent.mp4');
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `tmix=frames=${SUB}:weights='1 1 1 1',select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB,format=yuv420p`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'animation', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    for (let s = 0; s < SUB; s++) {
      // 180° shutter centred on t = f/FPS: sub-frames span half a frame interval
      const SHUTTER = 0.5;
      const t = (f + ((s + 0.5) / SUB - 0.5) * SHUTTER) / FPS;
      const buf = await shot(((t % info.T) + info.T) % info.T, undefined, 'jpeg');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    }
    if (f % 120 === 0) console.log(`frame ${f}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await done;
  console.log('video frames done →', silent);
}
await browser.close();
