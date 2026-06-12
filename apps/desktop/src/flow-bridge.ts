/**
 * Verbatim Flow bridge (Windows only).
 *
 * The renderer can't speak COM, so the main process spawns a fixed,
 * bundled Windows-PowerShell helper (`resources/flow/verbatim-flow.ps1`)
 * that drives the standard Excel object model — exactly what the Verbatim
 * Word add-in does, requiring NO modification to Verbatim Flow.
 *
 * Data goes IN via a temp JSON file (path passed as an arg — never
 * interpolated into the command line); the result comes back as a single
 * JSON object on stdout. On non-Windows hosts every call resolves to a
 * benign "windows-only" result and nothing is spawned.
 */

import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type Verb = 'available' | 'send' | 'pull' | 'create';

function helperScriptPath(): string {
  // Packaged: extraResources puts it under resourcesPath/flow. Dev: it
  // lives in apps/desktop/resources/flow (main.js runs from dist/).
  return app.isPackaged
    ? path.join(process.resourcesPath, 'flow', 'verbatim-flow.ps1')
    : path.join(__dirname, '..', 'resources', 'flow', 'verbatim-flow.ps1');
}

/** Spawn the PowerShell helper for one verb; resolve its parsed JSON. */
function runHelper(
  verb: Verb,
  opts: { payload?: unknown; force?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, available: false, error: 'windows-only' });
  }
  return new Promise((resolve) => {
    void (async (): Promise<void> => {
      let payloadFile = '';
      try {
        if (opts.payload !== undefined) {
          payloadFile = path.join(
            os.tmpdir(),
            `cardmirror-flow-${process.pid}-${Date.now()}.json`,
          );
          await fs.writeFile(payloadFile, JSON.stringify(opts.payload), 'utf8');
        }
        const args = [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          helperScriptPath(),
          '-Verb',
          verb,
        ];
        if (payloadFile) args.push('-PayloadFile', payloadFile);
        if (opts.force) args.push('-Force');

        const child = spawn('powershell.exe', args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', (err) => resolve({ ok: false, error: `spawn failed: ${err.message}` }));
        child.on('close', () => {
          if (payloadFile) void fs.unlink(payloadFile).catch(() => {});
          const text = stdout.trim();
          if (!text) {
            resolve({ ok: false, error: stderr.trim() || 'no output from helper' });
            return;
          }
          try {
            resolve(JSON.parse(text) as Record<string, unknown>);
          } catch {
            resolve({ ok: false, error: `bad helper output: ${text.slice(0, 200)}` });
          }
        });
      } catch (err) {
        if (payloadFile) void fs.unlink(payloadFile).catch(() => {});
        resolve({ ok: false, error: (err as Error).message });
      }
    })();
  });
}

/** Register the Flow IPC channels. Safe to call on any platform — the
 *  handlers just resolve "windows-only" off Windows. */
export function registerFlowIpc(): void {
  ipcMain.handle('host:flow-available', () => runHelper('available'));
  ipcMain.handle(
    'host:flow-send',
    (_e, payload: { cells: string[] }, force?: boolean) =>
      runHelper('send', { payload, force: !!force }),
  );
  ipcMain.handle('host:flow-pull', () => runHelper('pull'));
  ipcMain.handle('host:flow-create', (_e, templatePath?: string) =>
    runHelper('create', { payload: templatePath ? { templatePath } : {} }),
  );
}
