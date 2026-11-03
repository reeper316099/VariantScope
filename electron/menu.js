// Builds the application menu. Menu actions reach the page as fixed "vs:menu" DOM events.
import { Menu, dialog, shell, app } from 'electron';
import { isAllowedExternalLink } from './allowlist.js';

const REPO = 'https://github.com/reeper316099/VariantScope';

// Opens a link in the system browser, but only if it passes the allowlist.
function openLink(url) {
  if (isAllowedExternalLink(url)) shell.openExternal(url);
}

// Creates and installs the menu; `getWindow` returns the current BrowserWindow (or null).
export function installMenu({ getWindow, clearCache }) {
  const isMac = process.platform === 'darwin';

  // Tells the page about a menu action using a fixed string (never user data).
  const send = (action) => {
    const win = getWindow();
    if (!win) return;
    win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('vs:menu', { detail: ${JSON.stringify(action)} }))`,
    );
  };

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Export CSV', accelerator: 'CmdOrCtrl+E', click: () => send('export-csv') },
        { label: 'Export PNG', click: () => send('export-png') },
        { type: 'separator' },
        {
          label: 'Clear cache',
          click: async () => {
            await clearCache();
            send('cache-cleared');
          },
        },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Focus Search', accelerator: 'CmdOrCtrl+K', click: () => send('focus-search') },
        {
          label: 'Toggle Dark Mode',
          accelerator: 'CmdOrCtrl+D',
          click: () => send('toggle-theme'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About VariantScope',
          click: () =>
            dialog.showMessageBox(getWindow() ?? undefined, {
              type: 'info',
              title: 'About VariantScope',
              message: `VariantScope ${app.getVersion()}`,
              detail:
                'Explore where disease-linked protein variants cluster, using AlphaFold, ClinVar and gnomAD.\n\nEducational use only. Not medical advice.',
            }),
        },
        { label: 'GitHub Repository', click: () => openLink(REPO) },
        { label: 'Report an Issue', click: () => openLink(`${REPO}/issues`) },
        {
          label: 'Data Sources',
          submenu: [
            { label: 'UniProt', click: () => openLink('https://www.uniprot.org/') },
            { label: 'AlphaFold DB', click: () => openLink('https://alphafold.ebi.ac.uk/') },
            { label: 'ClinVar', click: () => openLink('https://www.ncbi.nlm.nih.gov/clinvar/') },
            { label: 'gnomAD', click: () => openLink('https://gnomad.broadinstitute.org/') },
          ],
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
