// Vite config: one codebase, two builds (web for GitHub Pages, electron for the desktop app).
import { defineConfig } from 'vite';
import { buildCsp } from './electron/csp.js';

// Injects the CSP <meta> tag into built HTML only (the dev server needs inline styles for HMR).
function cspPlugin(isElectron) {
  return {
    name: 'variantscope-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: buildCsp(isElectron ? 'electron' : 'web'),
        },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron';
  return {
    root: 'src',
    // Electron serves files from its own app:// protocol; Pages needs the repo-name subpath.
    base: isElectron ? './' : (process.env.VITE_BASE ?? '/'),
    plugins: [cspPlugin(isElectron)],
    server: { port: 5173, strictPort: true },
    build: {
      outDir: isElectron ? '../dist/electron-renderer' : '../dist/web',
      emptyOutDir: true,
      target: 'es2022',
    },
  };
});
