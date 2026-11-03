// Vite config: one codebase, two builds (web for GitHub Pages, electron for the desktop app).
import { readFileSync } from 'node:fs';
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

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 3Dmol contains one eval() that only runs if a callback is passed as a *string* (a py3Dmol
// feature). We never do that, and the strict CSP would block it anyway, so the build replaces it
// with a thrown error: the shipped bundle contains no eval. The build fails if the code changes.
function noEvalPlugin() {
  const EVAL_CALL = 'callback = eval("(" + callback + ")");';
  return {
    name: 'variantscope-no-eval',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('3Dmol.es6.js')) return null;
      if (!code.includes(EVAL_CALL))
        throw new Error('3Dmol eval call not found: update noEvalPlugin.');
      return code.replace(EVAL_CALL, 'throw new Error("String callbacks are not supported.");');
    },
  };
}

export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron';
  return {
    root: 'src',
    // Electron serves files from its own app:// protocol; Pages needs the repo-name subpath.
    base: isElectron ? './' : (process.env.VITE_BASE ?? '/'),
    define: { __APP_VERSION__: JSON.stringify(version), __E2E__: JSON.stringify(mode === 'e2e') },
    plugins: [noEvalPlugin(), cspPlugin(isElectron)],
    server: { port: 5173, strictPort: true },
    build: {
      outDir: isElectron
        ? '../dist/electron-renderer'
        : mode === 'e2e'
          ? '../dist/e2e'
          : '../dist/web',
      emptyOutDir: true,
      target: 'es2022',
    },
  };
});
