// Dark mode: follows the system by default, remembers the user's choice (storage is try/catch).
import { cacheGet, cacheSet } from '../core/cache.js';

// Applies "light" or "dark" to the <html> element.
function apply(theme) {
  document.documentElement.dataset.theme = theme;
}

// Returns the saved theme, else the system preference.
function initialTheme() {
  const saved = cacheGet('theme')?.value;
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Flips between light and dark and saves the choice.
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  apply(next);
  cacheSet('theme', next, null);
}

// Sets the starting theme and wires the toggle button.
export function initTheme(button) {
  apply(initialTheme());
  button.addEventListener('click', toggleTheme);
}
