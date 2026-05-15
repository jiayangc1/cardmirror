/**
 * CardMirror desktop — Electron main process.
 *
 * Phase 2 scope (this file's job today): launch a window that
 * loads the CardMirror web bundle. Dev mode points at the local
 * Vite server (`npm run desktop:dev` runs Vite + Electron
 * together); packaged builds load the static `dist/` bundle from
 * disk (production work lands in Phase 5).
 *
 * Phase 3 will add native file dialogs / autosave / menus by
 * registering IPC handlers here and exposing them via preload.
 */

import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';

const DEV_SERVER_URL = 'http://localhost:5173';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'CardMirror',
    // Reasonable minimum so the multi-doc workspace stays usable.
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      // The preload bridge lives at dist/preload.js after `tsc`.
      // Both main and preload are emitted to the same output dir,
      // so the path is relative to this compiled main.js.
      preload: path.join(__dirname, 'preload.js'),
      // Modern Electron defaults: keep Node out of the renderer
      // and isolate contexts. The renderer gets only what the
      // preload script explicitly exposes via contextBridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // `app.isPackaged` is true in production builds (electron-builder
  // sets it via the asar packaging). Local `electron .` runs return
  // false, so we treat that as "dev mode" and load from the Vite
  // dev server. Production loads the static bundle.
  if (!app.isPackaged) {
    void win.loadURL(DEV_SERVER_URL);
    // Detached devtools so they don't fight the multi-pane layout.
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: the static dist/ from `npm run build` lives at
    // ../../../../dist relative to the compiled main.js
    //   (apps/desktop/dist/main.js → ../../../../dist/index.html
    //    = workspace-root/dist/index.html)
    // When electron-builder packages this it copies the bundle in
    // — for Phase 5 we'll switch to the asar-relative path.
    void win.loadFile(path.join(__dirname, '..', '..', '..', '..', 'dist', 'index.html'));
  }
}

void app.whenReady().then(() => {
  createWindow();

  // macOS convention: clicking the dock icon when no windows are
  // open reopens a window.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS where apps
// typically stay running until the user explicitly quits.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
