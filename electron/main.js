// Electron main process: window, security settings, IPC handlers, disk cache.
import { app, BrowserWindow, dialog, ipcMain, protocol, screen, session, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isAllowedExternalLink } from './allowlist.js';
import { buildCsp } from './csp.js';
import { createDiskCache } from './disk-cache.js';
import { createFetcher } from './fetcher.js';
import { installMenu } from './menu.js';

const ROOT = path.join(import.meta.dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'dist', 'electron-renderer');
const APP_ORIGIN = 'app://local';
// Set by scripts/dev-electron.mjs so the window loads the Vite dev server instead of built files.
const DEV_URL = process.env.VARIANTSCOPE_DEV_URL || null;

// Returns "scheme://host[:port]" for a URL ("URL.origin" is the string "null" for custom schemes).
const originOf = (url) => {
  const { protocol, host } = new URL(url);
  return `${protocol}//${host}`;
};
const TRUSTED_ORIGIN = DEV_URL ? originOf(DEV_URL) : APP_ORIGIN;

// Tests can point the app at a throwaway data folder (must run before the app is ready).
if (process.env.VARIANTSCOPE_USER_DATA) app.setPath('userData', process.env.VARIANTSCOPE_USER_DATA);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Registers app:// as a secure scheme so the built UI gets a stable origin and real CSP headers.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow = null;
let cache;
let fetchJson;

// Serves files from dist/electron-renderer over app://, with the CSP header and no path escapes.
async function handleAppProtocol(request) {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const full = path.normalize(path.join(RENDERER_DIR, relative));
  if (!full.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const body = await readFile(full);
    const type = MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
    return new Response(body, {
      headers: { 'Content-Type': type, 'Content-Security-Policy': buildCsp('electron') },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// Adds the dev CSP to responses from the Vite dev server (the app:// scheme sets its own).
function installDevCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.url.startsWith(TRUSTED_ORIGIN))
      headers['Content-Security-Policy'] = [buildCsp('dev')];
    callback({ responseHeaders: headers });
  });
}

// Denies every permission request (camera, geolocation, notifications, ...) by default.
function denyPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

// Blocks navigation, new windows and webviews; allowlisted https links open in the system browser.
function lockDownWebContents(contents) {
  const openIfAllowed = (url) => {
    if (isAllowedExternalLink(url)) shell.openExternal(url);
  };
  contents.setWindowOpenHandler(({ url }) => {
    openIfAllowed(url);
    return { action: 'deny' };
  });
  const guard = (event, url) => {
    if (originOf(url) !== TRUSTED_ORIGIN) {
      event.preventDefault();
      openIfAllowed(url);
    }
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

// Returns true only for IPC messages that come from our own page (not an injected frame).
function isTrustedSender(event) {
  try {
    return originOf(event.senderFrame.url) === TRUSTED_ORIGIN;
  } catch {
    return false;
  }
}

// Registers the four IPC handlers behind the preload bridge.
function registerIpc() {
  ipcMain.handle('fetch-json', (event, url, options) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender.' };
    return fetchJson(String(url), options ?? {});
  });

  ipcMain.handle('open-external', (event, url) => {
    if (!isTrustedSender(event) || !isAllowedExternalLink(url)) return { ok: false };
    shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('get-app-info', (event) => {
    if (!isTrustedSender(event)) return null;
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    };
  });

  ipcMain.handle('save-file', async (event, kind, suggestedName, data) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender.' };
    if (kind !== 'csv' && kind !== 'png') return { ok: false, error: 'Unsupported file type.' };
    if (typeof data !== 'string' && !(data instanceof Uint8Array))
      return { ok: false, error: 'Bad data.' };
    if (data.length > 50 * 1024 * 1024) return { ok: false, error: 'File too large.' };
    const safeName = path.basename(String(suggestedName)).replace(/[^\w.-]+/g, '_');
    const defaultPath = safeName.toLowerCase().endsWith(`.${kind}`)
      ? safeName
      : `${safeName}.${kind}`;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await writeFile(result.filePath, data);
    return { ok: true, name: path.basename(result.filePath) };
  });
}

// Loads and stores the window's last size/position in the userData folder.
function windowStateStore() {
  const file = path.join(app.getPath('userData'), 'window-state.json');
  return {
    async load() {
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        // Ignore saved positions that are now off-screen (e.g. a monitor was unplugged).
        const visible = screen
          .getAllDisplays()
          .some(
            ({ bounds: b }) =>
              saved.x >= b.x &&
              saved.y >= b.y &&
              saved.x < b.x + b.width &&
              saved.y < b.y + b.height,
          );
        return visible ? saved : { width: saved.width, height: saved.height };
      } catch {
        return { width: 1280, height: 800 };
      }
    },
    save: (win) =>
      writeFile(
        file,
        JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }),
      ).catch(() => {}),
  };
}

// Creates the single main window with the hardened webPreferences.
async function createWindow() {
  const store = windowStateStore();
  const state = await store.load();
  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: 'VariantScope',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => store.save(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => lockDownWebContents(contents));

  app.whenReady().then(async () => {
    cache = createDiskCache(path.join(app.getPath('userData'), 'cache'));
    fetchJson = createFetcher({
      cache,
      userAgent: `VariantScope/${app.getVersion()} (+https://github.com/reeper316099/VariantScope)`,
    });
    protocol.handle('app', handleAppProtocol);
    if (DEV_URL) installDevCsp();
    denyPermissions();
    registerIpc();
    installMenu({ getWindow: () => mainWindow, clearCache: () => cache.clear() });
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
