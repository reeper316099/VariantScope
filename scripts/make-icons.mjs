// Builds build/icon.png (1024), build/icon.ico and build/icon.icns from build/icon.svg.
// macOS only: it uses Electron to rasterise the SVG, `sips` to resize and `iconutil` for .icns.
// (On Linux/Windows, just commit the generated files; electron-builder does not need to run this.)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

const root = path.join(import.meta.dirname, '..');
const build = path.join(root, 'build');
const png = path.join(build, 'icon.png');

execFileSync(
  electronPath,
  [path.join(import.meta.dirname, 'render-icon.cjs'), path.join(build, 'icon.svg'), png],
  { stdio: 'inherit' },
);

// Resizes the master PNG to a square size with sips.
const resize = (size, out) =>
  execFileSync('sips', ['-z', String(size), String(size), png, '--out', out], { stdio: 'ignore' });
const work = mkdtempSync(path.join(tmpdir(), 'vs-icons-'));

// .icns: an .iconset folder of the sizes macOS expects, converted by iconutil.
const iconset = path.join(work, 'icon.iconset');
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  resize(size, path.join(iconset, `icon_${size}x${size}.png`));
  resize(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')]);

// .ico: a small container holding PNG images (supported by Windows Vista and newer).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => {
  const file = path.join(work, `ico-${size}.png`);
  resize(size, file);
  return { size, data: readFileSync(file) };
});
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
writeFileSync(
  path.join(build, 'icon.ico'),
  Buffer.concat([header, ...entries, ...images.map((i) => i.data)]),
);
rmSync(work, { recursive: true, force: true });
console.log('wrote icon.png, icon.ico, icon.icns in build/');
