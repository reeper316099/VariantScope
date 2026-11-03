// Renders build/icon.svg to a transparent 1024x1024 PNG using Electron (run via make-icons.mjs).
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const [svgPath, outPath] = process.argv.slice(-2);
  const svg = fs.readFileSync(svgPath, 'utf8');
  // Offscreen rendering paints without a visible window (a hidden window never paints on macOS).
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg style="display:block" ')}</body>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the first frame paint
  const image = await win.webContents.capturePage();
  // On Retina screens the capture is larger than 1024; scale it back to exactly 1024x1024.
  const png = image.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG();
  fs.writeFileSync(path.resolve(outPath), png);
  console.log(`rendered ${outPath} (${nativeImage.createFromBuffer(png).getSize().width}px)`);
  app.quit();
});
