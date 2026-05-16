/**
 * Host singleton + platform detection.
 *
 * Picks the right Host implementation once at module load and
 * returns the same instance from every `getHost()` call. The
 * detection seam is intentionally narrow — `window.electronAPI`
 * (and later `window.__TAURI__`) is the only thing the editor
 * looks at — so the desktop wrappers know exactly what to expose
 * for their Host implementation to be selected.
 */

import { BrowserHost } from './browser-host.js';
import { ElectronHost } from './electron-host.js';
import type { Host } from './types.js';

export type {
  Host,
  OpenedFile,
  SaveResult,
  FileFilter,
  OpenFileOptions,
  SaveAsOptions,
} from './types.js';

declare global {
  interface Window {
    /** Present only when the renderer is running inside an Electron
     *  shell that exposed the bridge from its preload script. */
    electronAPI?: unknown;
    /** Reserved for the eventual Tauri host. */
    __TAURI__?: unknown;
  }
}

let cached: Host | null = null;

export function getHost(): Host {
  if (cached) return cached;
  // Native wrappers win over plain browser since they expose richer
  // capabilities (real file paths, in-place saves, native menus).
  if (typeof window !== 'undefined' && window.electronAPI !== undefined) {
    cached = new ElectronHost();
    return cached;
  }
  // Tauri detection will land here when the Tauri host is built.
  cached = new BrowserHost();
  return cached;
}

/** Get the singleton as an ElectronHost (or null if we aren't
 *  running inside Electron). Used by the renderer to subscribe to
 *  native menu events without bloating the cross-platform Host
 *  surface. */
export function getElectronHost(): ElectronHost | null {
  const h = getHost();
  return h.kind === 'electron' ? (h as ElectronHost) : null;
}
