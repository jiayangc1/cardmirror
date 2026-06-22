/**
 * Clean — a home-screen utility that cleans a `.docx`'s styles to the
 * Verbatim-standard scheme (convert direct formatting to semantic styles,
 * rename/remove stray styles, strip hyperlinks). It can clean a single file or
 * a whole folder (recursed), writing cleaned copies into a chosen destination.
 *
 * The cleaning runs entirely client-side over the style cleaner in
 * `ooxml/style-clean`. Electron-only: needs recursive directory listing +
 * write-to-path, so the home screen only surfaces it on the desktop edition.
 */

import { cleanDocumentBytes } from '../ooxml/style-clean/style-cleaner.js';
import { getHost, getElectronHost } from './host/index.js';
import { setIcon } from './icons';

interface InputSel {
  kind: 'file' | 'folder';
  path: string;
  name: string;
  /** Bytes (file input only). */
  bytes?: Uint8Array;
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

/** Join a destination dir + relative path with a forward slash
 *  (Node's fs accepts it on every platform). */
function joinPath(dir: string, rel: string): string {
  return `${dir.replace(/[\\/]+$/, '')}/${rel.replace(/^[\\/]+/, '')}`;
}

/** Prefix the basename of a relative path with `cleaned_` (so output never
 *  overwrites a source file even if the destination is the source folder). */
function cleanedRel(rel: string): string {
  const norm = rel.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  const dir = slash >= 0 ? norm.slice(0, slash + 1) : '';
  const base = slash >= 0 ? norm.slice(slash + 1) : norm;
  return `${dir}cleaned_${base}`;
}

class CleanModal {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private inputPathEl!: HTMLDivElement;
  private outputPathEl!: HTMLDivElement;
  private cleanBtn!: HTMLButtonElement;
  private pruneCheckbox!: HTMLInputElement;
  private busy = false;
  private settled = false;

  private inputSel: InputSel | null = null;
  private outputDir: string | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'pmd-bulk-overlay';
    this.dialog = document.createElement('div');
    this.dialog.className = 'pmd-bulk-dialog';
    this.overlay.appendChild(this.dialog);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.addEventListener('keydown', this.onKey, true);
    this.render();
    document.body.appendChild(this.overlay);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !this.busy) {
      e.preventDefault();
      // Capture-phase: stop Escape from also reaching the home screen's
      // keydown handler (which would dismiss home under the closing modal).
      e.stopPropagation();
      this.close();
    }
  };

  private close(): void {
    if (this.settled || this.busy) return;
    this.settled = true;
    document.removeEventListener('keydown', this.onKey, true);
    this.overlay.remove();
  }

  private render(): void {
    const header = document.createElement('header');
    header.className = 'pmd-bulk-header';
    const h = document.createElement('h2');
    h.textContent = 'Clean';
    header.appendChild(h);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pmd-bulk-close';
    setIcon(close, 'close');
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    header.appendChild(close);
    this.dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'pmd-bulk-body';

    const blurb = document.createElement('p');
    blurb.className = 'pmd-bulk-blurb';
    blurb.textContent =
      'Cleans a .docx’s styles to the Verbatim standard — converting stray ' +
      'formatting to the right styles, removing junk styles, and stripping ' +
      'hyperlinks. Cleaned copies are written to the destination.';
    body.appendChild(blurb);

    // Options.
    this.pruneCheckbox = document.createElement('input');
    this.pruneCheckbox.type = 'checkbox';
    this.pruneCheckbox.checked = true;
    const pruneRow = document.createElement('label');
    pruneRow.className = 'pmd-bulk-radio';
    pruneRow.title = 'Strip unreferenced style definitions for a smaller file.';
    const pruneText = document.createElement('span');
    pruneText.textContent = 'Remove unused styles';
    pruneRow.append(this.pruneCheckbox, pruneText);
    const optField = document.createElement('div');
    optField.className = 'pmd-bulk-field';
    const optLabel = document.createElement('div');
    optLabel.className = 'pmd-bulk-field-label';
    optLabel.textContent = 'Options';
    optField.append(optLabel, pruneRow);
    body.appendChild(optField);

    // Input.
    const inField = document.createElement('div');
    inField.className = 'pmd-bulk-field';
    const inLabel = document.createElement('div');
    inLabel.className = 'pmd-bulk-field-label';
    inLabel.textContent = 'Input';
    inField.appendChild(inLabel);
    const inBtns = document.createElement('div');
    inBtns.className = 'pmd-bulk-pickrow';
    inBtns.append(
      button('Choose file…', () => void this.pickFile()),
      button('Choose folder…', () => void this.pickFolder()),
    );
    inField.appendChild(inBtns);
    this.inputPathEl = document.createElement('div');
    this.inputPathEl.className = 'pmd-bulk-path';
    inField.appendChild(this.inputPathEl);
    body.appendChild(inField);

    // Destination.
    const outField = document.createElement('div');
    outField.className = 'pmd-bulk-field';
    const outLabel = document.createElement('div');
    outLabel.className = 'pmd-bulk-field-label';
    outLabel.textContent = 'Destination';
    outField.appendChild(outLabel);
    const outBtns = document.createElement('div');
    outBtns.className = 'pmd-bulk-pickrow';
    outBtns.append(button('Choose destination…', () => void this.pickDestination()));
    outField.appendChild(outBtns);
    this.outputPathEl = document.createElement('div');
    this.outputPathEl.className = 'pmd-bulk-path';
    outField.appendChild(this.outputPathEl);
    body.appendChild(outField);

    // Clean.
    const actions = document.createElement('div');
    actions.className = 'pmd-bulk-actions';
    this.cleanBtn = button('Clean', () => void this.run());
    this.cleanBtn.classList.add('pmd-bulk-btn-primary');
    actions.appendChild(this.cleanBtn);
    body.appendChild(actions);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'pmd-bulk-status';
    body.appendChild(this.statusEl);

    this.dialog.appendChild(body);
    this.refresh();
  }

  /** Update path displays + the Clean button's enabled state. */
  private refresh(): void {
    this.inputPathEl.textContent = this.inputSel
      ? `${this.inputSel.kind === 'folder' ? 'Folder' : 'File'}: ${this.inputSel.path}`
      : 'None selected';
    this.inputPathEl.classList.toggle('pmd-bulk-path-set', !!this.inputSel);
    this.outputPathEl.textContent = this.outputDir ? this.outputDir : 'None selected';
    this.outputPathEl.classList.toggle('pmd-bulk-path-set', !!this.outputDir);
    this.cleanBtn.disabled = this.busy || !this.inputSel || !this.outputDir;
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.dialog.classList.toggle('pmd-bulk-busy', on);
    this.refresh();
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
  }

  // ── Pickers ───────────────────────────────────────────────────────

  private async pickFile(): Promise<void> {
    const opened = await getHost().openFile({
      filters: [{ name: '.docx', extensions: ['docx'] }],
    });
    if (!opened || typeof opened.handle !== 'string') return;
    this.inputSel = { kind: 'file', path: opened.handle, name: opened.name, bytes: opened.bytes };
    this.refresh();
  }

  private async pickFolder(): Promise<void> {
    const electron = getElectronHost();
    if (!electron) return;
    const folder = await electron.pickDirectory({ title: 'Choose a folder to clean' });
    if (!folder) return;
    this.inputSel = { kind: 'folder', path: folder, name: baseName(folder) };
    this.refresh();
  }

  private async pickDestination(): Promise<void> {
    const electron = getElectronHost();
    if (!electron) return;
    const dest = await electron.pickDirectory({ title: 'Choose a destination folder' });
    if (!dest) return;
    this.outputDir = dest;
    this.refresh();
  }

  // ── Clean ─────────────────────────────────────────────────────────

  private async run(): Promise<void> {
    if (this.busy || !this.inputSel || !this.outputDir) return;
    const electron = getElectronHost();
    if (!electron) {
      this.setStatus('Clean requires the desktop edition.');
      return;
    }
    const prune = this.pruneCheckbox.checked;
    const dest = this.outputDir;
    const input = this.inputSel;
    this.setBusy(true);
    try {
      if (input.kind === 'file') {
        this.setStatus(`Cleaning ${input.name}…`);
        const cleaned = await cleanDocumentBytes(input.bytes!, { pruneUnused: prune });
        await electron.writeFileAtPath(joinPath(dest, `cleaned_${input.name}`), cleaned);
        this.setStatus(`Cleaned “${input.name}”.`);
      } else {
        this.setStatus('Scanning…');
        const files = await electron.listFilesRecursive(input.path, 'docx');
        if (files.length === 0) {
          this.setStatus('No .docx files found in that folder.');
          return;
        }
        let ok = 0;
        let failed = 0;
        for (let i = 0; i < files.length; i++) {
          const f = files[i]!;
          this.setStatus(`Cleaning ${i + 1} / ${files.length}…`);
          try {
            const read = await electron.readFileAtPath(f.path);
            if (!read) throw new Error('unreadable');
            const cleaned = await cleanDocumentBytes(read.bytes, { pruneUnused: prune });
            await electron.writeFileAtPath(joinPath(dest, cleanedRel(f.relPath)), cleaned);
            ok++;
          } catch (err) {
            failed++;
            console.error('Clean failed for', f.path, err);
          }
        }
        this.setStatus(`Done — ${ok} cleaned${failed ? `, ${failed} failed (see console)` : ''}.`);
      }
    } catch (err) {
      this.setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.setBusy(false);
    }
  }
}

// ── Small DOM helper ──────────────────────────────────────────────────

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pmd-bulk-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function openClean(): void {
  new CleanModal();
}
