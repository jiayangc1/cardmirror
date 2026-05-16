/**
 * CardMirror desktop — Electron main process.
 *
 * Responsibilities:
 *   - Create and manage the BrowserWindow that hosts the renderer.
 *   - Drive native open/save dialogs and read/write files from disk
 *     in response to renderer IPC. (Renderer-side Host abstraction
 *     in `src/editor/host/electron-host.ts`.)
 *   - Define the native menu bar; menu picks dispatch to the
 *     renderer as `'menu-command'` events, where they get routed
 *     through the same ribbon-command registry as keyboard
 *     shortcuts and ribbon buttons.
 *
 * Phase 3 scope (this file's job): native file I/O + menus. Phase 4
 * (autosave) and Phase 5 (packaged builds) layer on top.
 */

import {
  app,
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  dialog,
  ipcMain,
} from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const DEV_SERVER_URL = 'http://localhost:5173';

interface FileFilter {
  name: string;
  extensions: string[];
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'CardMirror',
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(
      path.join(__dirname, '..', '..', '..', '..', 'dist', 'index.html'),
    );
  }

  // Track the focused window so menu commands fire at the right
  // place when multiple windows exist (a Phase 6+ concern, but
  // wiring it now costs nothing).
  win.on('focus', () => {
    mainWindow = win;
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

/** Find the BrowserWindow that owns the renderer making an IPC
 *  call. Falls back to the focused window when sender lookup fails
 *  (shouldn't, but be defensive). */
function ownerWindow(sender: Electron.WebContents): BrowserWindow | null {
  return (
    BrowserWindow.fromWebContents(sender) ??
    BrowserWindow.getFocusedWindow() ??
    mainWindow
  );
}

/** Convert IPC-transferred bytes (which can arrive as a plain
 *  Uint8Array view, a Node Buffer, or even a structured-cloned
 *  ArrayBuffer depending on Electron version) into a Buffer the
 *  fs API will accept. */
function bytesToBuffer(bytes: unknown): Buffer {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  throw new TypeError('Unsupported bytes payload — expected Uint8Array / ArrayBuffer / Buffer.');
}

// ─── IPC handlers ──────────────────────────────────────────────────

ipcMain.handle('host:open-file', async (event, opts: { filters?: FileFilter[] }) => {
  const win = ownerWindow(event.sender);
  const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
    properties: ['openFile'],
    filters: opts?.filters?.length ? opts.filters : [],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0]!;
  const bytes = await fs.readFile(filePath);
  return {
    name: path.basename(filePath),
    bytes: new Uint8Array(bytes),
    handle: filePath,
  };
});

ipcMain.handle(
  'host:save-as',
  async (
    event,
    suggestedName: string,
    bytes: unknown,
    opts: { filters?: FileFilter[] },
  ) => {
    const win = ownerWindow(event.sender);
    const result = await dialog.showSaveDialog(win ?? new BrowserWindow({ show: false }), {
      defaultPath: suggestedName,
      filters: opts?.filters?.length ? opts.filters : [],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, bytesToBuffer(bytes));
    return {
      name: path.basename(result.filePath),
      handle: result.filePath,
    };
  },
);

ipcMain.handle('host:save-existing', async (_event, handle: string, bytes: unknown) => {
  if (typeof handle !== 'string' || handle.length === 0) {
    throw new Error('host:save-existing: handle must be a non-empty path string.');
  }
  await fs.writeFile(handle, bytesToBuffer(bytes));
});

// ─── Native menu bar ───────────────────────────────────────────────

/** Send a menu-command IPC event to the currently focused window. */
function dispatchMenuCommand(command: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!win) return;
  win.webContents.send('menu-command', command);
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Document',
        accelerator: 'CmdOrCtrl+Alt+N',
        click: () => dispatchMenuCommand('newDocument'),
      },
      {
        label: 'Open…',
        accelerator: 'CmdOrCtrl+O',
        click: () => dispatchMenuCommand('openFile'),
      },
      { type: 'separator' },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => dispatchMenuCommand('save'),
      },
      {
        label: 'Save As…',
        accelerator: 'Shift+CmdOrCtrl+S',
        click: () => dispatchMenuCommand('saveAs'),
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    fileMenu,
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];

  return Menu.buildFromTemplate(template);
}

// ─── App lifecycle ─────────────────────────────────────────────────

void app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
