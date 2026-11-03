// Preload (sandboxed, so CommonJS): exposes exactly four validated functions as window.api.
const { contextBridge, ipcRenderer } = require('electron');

// Throws unless `value` is a non-empty string no longer than `max` characters.
function requireString(value, name, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new TypeError(`${name} must be a non-empty string (max ${max} characters).`);
  }
  return value;
}

contextBridge.exposeInMainWorld('api', {
  // Fetches an allowlisted API URL via the main process (CORS-free, rate-limited, cached).
  fetchJson(url, options = {}) {
    requireString(url, 'url', 4096);
    const clean = {};
    if (options.method !== undefined) {
      if (options.method !== 'GET' && options.method !== 'POST')
        throw new TypeError('method must be GET or POST.');
      clean.method = options.method;
    }
    if (options.body !== undefined) clean.body = requireString(options.body, 'body', 1_000_000);
    if (options.responseType !== undefined) {
      if (options.responseType !== 'json' && options.responseType !== 'text') {
        throw new TypeError('responseType must be json or text.');
      }
      clean.responseType = options.responseType;
    }
    if (options.noCache !== undefined) clean.noCache = options.noCache === true;
    return ipcRenderer.invoke('fetch-json', url, clean);
  },

  // Opens a native "Save as" dialog and writes the file; kind is "csv" or "png".
  saveFile(kind, suggestedName, data) {
    if (kind !== 'csv' && kind !== 'png') throw new TypeError('kind must be csv or png.');
    requireString(suggestedName, 'suggestedName', 200);
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
      throw new TypeError('data must be a string or Uint8Array.');
    }
    return ipcRenderer.invoke('save-file', kind, suggestedName, data);
  },

  // Asks the main process to open an allowlisted https link in the system browser.
  openExternal(url) {
    requireString(url, 'url', 4096);
    return ipcRenderer.invoke('open-external', url);
  },

  // Returns {name, version, platform, arch, electron, chrome} for the About box.
  getAppInfo() {
    return ipcRenderer.invoke('get-app-info');
  },
});
