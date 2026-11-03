// Content-Security-Policy strings, shared by Vite (HTML <meta>) and Electron (response headers).
import { API_HOSTS } from './allowlist.js';

// Returns the CSP for a target: "electron" (no renderer network), "web" (API hosts), or "dev".
export function buildCsp(target) {
  const connect = {
    electron: "'none'",
    web: ["'self'", ...API_HOSTS.map((h) => `https://${h}`)].join(' '),
    // The Vite dev server uses a websocket for hot reload.
    dev: "'self' ws://localhost:5173",
  }[target];
  return [
    "default-src 'none'",
    "script-src 'self'",
    // Vite injects <style> tags while developing; production builds stay strict.
    target === 'dev' ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
