/**
 * Host interface — the platform abstraction the editor talks to for
 * everything that isn't pure DOM manipulation.
 *
 * Why this exists: CardMirror runs in three contexts (regular browser
 * tab, installed PWA, native desktop binary wrapped by Electron /
 * Tauri). Each context offers a different way to open files, save
 * files, store settings, etc. The editor proper doesn't care which
 * context it's in — it calls `host.openFile()` and `host.saveAs()`
 * and the right thing happens.
 *
 * Adding a new platform = writing a new Host implementation. Adding
 * a new capability = extending this interface and implementing it in
 * each platform host.
 *
 * Lifecycle: `getHost()` (from `./index.ts`) returns the singleton
 * for the current platform, picked once at module load and never
 * swapped. Host implementations may hold internal state (e.g. cached
 * file handles for in-place saves); they're not assumed to be pure.
 */

/** File-type filter for native open/save dialogs. Mirrors Electron's
 *  `dialog.FileFilter` shape so the ElectronHost can pass it
 *  through verbatim; BrowserHost uses it to build the `<input
 *  accept="…">` attribute and the `showSaveFilePicker` types arg. */
export interface FileFilter {
  /** Human-readable label shown in the dialog (e.g. "CardMirror
   *  document"). */
  name: string;
  /** Extensions without the leading dot (e.g. `["docx"]`, `["cmir"]`,
   *  or `["docx", "cmir"]`). */
  extensions: string[];
}

/** Result of a successful `Host.openFile` — a file the user picked
 *  from a native dialog (or its web-platform equivalent). */
export interface OpenedFile {
  /** Display name (basename, no path). Used for chip labels, tab
   *  titles, and the slot-router prompt. */
  name: string;
  /** Full byte contents of the file. */
  bytes: Uint8Array;
  /** Opaque platform-specific handle that subsequent in-place saves
   *  (`Host.saveExisting`) can pass back to write to the same
   *  on-disk location. `undefined` when the platform doesn't expose
   *  a persistent reference — browsers without the File System
   *  Access API, for example. */
  handle?: unknown;
}

/** Result of a successful `Host.saveAs` — confirmation that the
 *  bytes hit storage at a user-chosen location. */
export interface SaveResult {
  /** Final filename the platform actually used. May differ from the
   *  `suggestedName` argument if the user renamed in the dialog
   *  (or if the browser's download path stripped extensions). */
  name: string;
  /** Opaque handle the future `Host.saveExisting` can use to write
   *  back to the same file without re-prompting. `undefined` when
   *  the platform can't hand one out. */
  handle?: unknown;
}

/** Options to `openFile`. */
export interface OpenFileOptions {
  /** Filters to show in the dialog. When omitted or empty, the
   *  dialog accepts any file (the BrowserHost's hidden input drops
   *  its `accept` attribute; Electron shows "All files"). The first
   *  filter is usually the default. */
  filters?: FileFilter[];
}

/** Options to `saveAs`. */
export interface SaveAsOptions {
  /** Filters to show in the save dialog. The first filter is
   *  usually used as the default format if the user doesn't pick
   *  a specific one. */
  filters?: FileFilter[];
}

/** The interface every platform host implements. New methods land
 *  here when the editor needs a new capability that varies between
 *  web and desktop. */
export interface Host {
  /** Identifier for telemetry / debug. Lowercase string, stable. */
  readonly kind: 'browser' | 'electron' | 'tauri';

  /** Show a native open-file picker. Resolve with the picked file's
   *  contents or `null` if the user cancelled. */
  openFile(opts?: OpenFileOptions): Promise<OpenedFile | null>;

  /** Show a native save-file picker pre-filled with `suggestedName`
   *  and write `bytes` to the user's chosen location. Resolve with
   *  the saved file's final name + a handle for future in-place
   *  saves, or `null` if the user cancelled. */
  saveAs(
    suggestedName: string,
    bytes: Uint8Array,
    opts?: SaveAsOptions,
  ): Promise<SaveResult | null>;

  /** Write `bytes` to the file referenced by `handle`. Used for the
   *  silent "Save" path (no dialog) — the caller already knows
   *  where the doc lives.
   *
   *  Throws when the handle is no longer writable (file deleted,
   *  moved, permissions revoked) or when the platform can't fulfil
   *  the contract — the caller can fall back to Save As in those
   *  cases. */
  saveExisting(handle: unknown, bytes: Uint8Array): Promise<void>;

  /** Whether this host can actually perform in-place saves. The
   *  caller uses this to decide whether to even surface the
   *  silent-Save affordance — when false, "Save" devolves into
   *  Save As. Browsers without the File System Access API return
   *  false; Electron / Tauri return true. */
  readonly supportsInPlaceSave: boolean;
}
