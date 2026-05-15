/**
 * Electron preload script.
 *
 * Runs in an isolated bridging context between the main process and
 * the renderer. Used to expose a narrow `window.electronAPI`
 * surface via Electron's `contextBridge` so the renderer can call
 * into native code without having full Node access.
 *
 * Phase 2 (today): intentionally empty. By not exposing anything,
 * `window.electronAPI` is `undefined` in the renderer and the
 * editor's `getHost()` falls back to `BrowserHost` — meaning Save
 * As inside the Electron window uses `showSaveFilePicker` (which
 * works fine in Electron since Chromium ships the API). The
 * window opens; CardMirror is fully usable.
 *
 * Phase 3 will add the native bridge here. The expected shape:
 *
 *   import { contextBridge, ipcRenderer } from 'electron';
 *   contextBridge.exposeInMainWorld('electronAPI', {
 *     openFile: () => ipcRenderer.invoke('host:open-file'),
 *     saveAs: (name, bytes) => ipcRenderer.invoke('host:save-as', name, bytes),
 *     saveExisting: (handle, bytes) => ipcRenderer.invoke('host:save-existing', handle, bytes),
 *     // ... menus, autosave, etc.
 *   });
 *
 * Paired with an `ElectronHost` implementation in
 * `src/editor/host/electron-host.ts` that calls these methods, and
 * a detection seam in `src/editor/host/index.ts` that picks it up
 * when `window.electronAPI` is defined.
 */

export {};
