// App bootstrap: loads styles, wires the shell, and listens for desktop-menu actions.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { isElectron } from './core/http.js';
import { cacheClearResponses } from './core/cache.js';
import { initTheme, toggleTheme } from './ui/theme.js';

const searchInput = document.getElementById('gene-input');

initTheme(document.getElementById('theme-toggle'));

// Search is wired up in the UI phase; for now stop the form from reloading the page.
document
  .getElementById('search-form')
  .addEventListener('submit', (event) => event.preventDefault());

// Shows which build is running (desktop app with its version, or the web version).
async function showEnvironment() {
  const label = document.getElementById('env-label');
  if (!isElectron()) {
    label.textContent = 'Web version';
    return;
  }
  const info = await window.api.getAppInfo();
  label.textContent = `Desktop app v${info.version} (${info.platform})`;
}
showEnvironment();

// The Electron menu sends fixed action names as "vs:menu" events; unknown names are ignored.
window.addEventListener('vs:menu', (event) => {
  if (event.detail === 'focus-search') searchInput.focus();
  if (event.detail === 'toggle-theme') toggleTheme();
  if (event.detail === 'cache-cleared') cacheClearResponses();
});

// Browser build: Ctrl/Cmd+K focuses search, Ctrl/Cmd+D toggles dark mode (Electron uses the menu).
if (!isElectron()) {
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === 'k') {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === 'd') {
      event.preventDefault();
      toggleTheme();
    }
  });
}
