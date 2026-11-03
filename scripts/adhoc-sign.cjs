// electron-builder "afterPack" hook: gives the macOS app an ad-hoc signature (no certificate).
// Without it, Apple Silicon sees a broken signature (Electron's own signature no longer matches the
// modified bundle) and downloaded copies can show "is damaged". An ad-hoc signature is valid but
// not trusted: users still get the normal "unidentified developer" prompt (see README).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Runs after the app is assembled and before the DMG is built; does nothing on Windows/Linux.
exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  // codesign refuses files carrying extended attributes (e.g. com.apple.provenance), so clear them.
  execFileSync('xattr', ['-cr', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' }); // fail the build if invalid
};
