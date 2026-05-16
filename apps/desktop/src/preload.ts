/**
 * Electron preload script.
 *
 * Runs in an isolated bridging context between the main process and
 * the renderer. Exposes a narrow `window.electronAPI` surface via
 * Electron's `contextBridge` so the renderer can call into native
 * code without having full Node access.
 *
 * The shape exposed here matches the `ElectronAPI` interface
 * declared inside `src/editor/host/electron-host.ts`. If you add a
 * method here, mirror it there (and ideally in the cross-platform
 * Host interface so BrowserHost grows the same capability).
 */

import { contextBridge, ipcRenderer } from 'electron';

interface FileFilter {
  name: string;
  extensions: string[];
}

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (opts: { filters: FileFilter[] }) =>
    ipcRenderer.invoke('host:open-file', opts),

  saveAs: (
    suggestedName: string,
    bytes: Uint8Array,
    opts: { filters: FileFilter[] },
  ) => ipcRenderer.invoke('host:save-as', suggestedName, bytes, opts),

  saveExisting: (handle: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('host:save-existing', handle, bytes),

  /** Subscribe to native-menu commands. Main process broadcasts
   *  `'menu-command'` events to the focused window's webContents
   *  whenever the user picks File → Open / Save / etc. The
   *  renderer routes them through its existing ribbon-command
   *  registry. */
  onMenuCommand(handler: (command: string) => void): () => void {
    const listener = (_evt: unknown, command: string): void => handler(command);
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  },
});
