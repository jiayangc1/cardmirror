/**
 * Settings modal UI.
 *
 * Click the gear icon in the header → opens a modal listing every entry
 * in `SETTING_METADATA`. The modal renders the appropriate control
 * (toggle / number / etc.) for each setting and writes through to the
 * settings store immediately.
 */

import { SETTING_METADATA, settings, type SettingMeta, type ReaderConfig } from './settings.js';

class SettingsModal {
  private overlay: HTMLDivElement;
  private dialog: HTMLDivElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'pmd-settings-overlay';
    this.overlay.style.display = 'none';

    this.dialog = document.createElement('div');
    this.dialog.className = 'pmd-settings-dialog';
    this.overlay.appendChild(this.dialog);

    // Click outside the dialog → close.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Escape closes.
    document.addEventListener('keydown', (e) => {
      if (this.overlay.style.display !== 'none' && e.key === 'Escape') {
        this.close();
      }
    });

    document.body.appendChild(this.overlay);
  }

  open(): void {
    this.render();
    this.overlay.style.display = '';
  }

  close(): void {
    this.overlay.style.display = 'none';
  }

  private render(): void {
    this.dialog.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'pmd-settings-header';
    const title = document.createElement('h2');
    title.textContent = 'Settings';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pmd-settings-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);
    this.dialog.appendChild(header);

    const list = document.createElement('div');
    list.className = 'pmd-settings-list';
    for (const meta of SETTING_METADATA) {
      list.appendChild(this.renderEntry(meta));
    }
    if (SETTING_METADATA.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pmd-settings-empty';
      empty.textContent = 'No settings to configure yet.';
      list.appendChild(empty);
    }
    this.dialog.appendChild(list);
  }

  private renderEntry(meta: SettingMeta): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pmd-settings-row';

    const label = document.createElement('label');
    label.className = 'pmd-settings-row-label';

    const text = document.createElement('div');
    text.className = 'pmd-settings-row-text';
    const head = document.createElement('span');
    head.className = 'pmd-settings-row-title';
    head.textContent = meta.label;
    text.appendChild(head);
    if (meta.description) {
      const desc = document.createElement('span');
      desc.className = 'pmd-settings-row-desc';
      desc.textContent = meta.description;
      text.appendChild(desc);
    }
    label.appendChild(text);

    if (meta.kind === 'toggle') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'pmd-settings-toggle';
      checkbox.checked = !!settings.get(meta.key);
      checkbox.addEventListener('change', () => {
        settings.set(meta.key as 'showCitePreview', checkbox.checked as never);
      });
      label.appendChild(checkbox);
    } else if (meta.kind === 'readers') {
      // Description above, list editor below — different shape from
      // the inline label+toggle layout.
      row.appendChild(text);
      row.appendChild(buildReadersEditor());
      return row;
    }

    row.appendChild(label);
    return row;
  }
}

function buildReadersEditor(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pmd-readers-editor';

  const list = document.createElement('div');
  list.className = 'pmd-readers-list';
  wrap.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pmd-readers-add';
  addBtn.textContent = '+ Add reader';
  wrap.appendChild(addBtn);

  function commit(readers: ReaderConfig[]): void {
    settings.set('readers', readers);
  }

  function render(): void {
    list.innerHTML = '';
    const readers = settings.get('readers');

    readers.forEach((reader, idx) => {
      const row = document.createElement('div');
      row.className = 'pmd-reader-row';

      const primary = document.createElement('span');
      primary.className = 'pmd-reader-rank';
      primary.textContent = idx < 2 ? `#${idx + 1}` : '';
      primary.title = idx < 2 ? 'Shown live in the status bar' : 'Shown in Word Count Selection only';
      row.appendChild(primary);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'pmd-reader-name';
      nameInput.value = reader.name;
      nameInput.placeholder = 'Name';
      nameInput.addEventListener('change', () => {
        const next = settings.get('readers').map((r, i) =>
          i === idx ? { ...r, name: nameInput.value.trim() || r.name } : r,
        );
        commit(next);
      });
      row.appendChild(nameInput);

      const wpmInput = document.createElement('input');
      wpmInput.type = 'number';
      wpmInput.className = 'pmd-reader-wpm';
      wpmInput.min = '1';
      wpmInput.step = '1';
      wpmInput.value = String(reader.wpm);
      wpmInput.addEventListener('change', () => {
        const v = parseInt(wpmInput.value, 10);
        if (!Number.isFinite(v) || v <= 0) {
          wpmInput.value = String(reader.wpm);
          return;
        }
        const next = settings.get('readers').map((r, i) =>
          i === idx ? { ...r, wpm: v } : r,
        );
        commit(next);
      });
      row.appendChild(wpmInput);

      const wpmLabel = document.createElement('span');
      wpmLabel.className = 'pmd-reader-wpm-label';
      wpmLabel.textContent = 'wpm';
      row.appendChild(wpmLabel);

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'pmd-reader-move';
      upBtn.textContent = '↑';
      upBtn.title = 'Move up';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', () => {
        const cur = [...settings.get('readers')];
        if (idx === 0) return;
        [cur[idx - 1], cur[idx]] = [cur[idx]!, cur[idx - 1]!];
        commit(cur);
      });
      row.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'pmd-reader-move';
      downBtn.textContent = '↓';
      downBtn.title = 'Move down';
      downBtn.disabled = idx === readers.length - 1;
      downBtn.addEventListener('click', () => {
        const cur = [...settings.get('readers')];
        if (idx >= cur.length - 1) return;
        [cur[idx], cur[idx + 1]] = [cur[idx + 1]!, cur[idx]!];
        commit(cur);
      });
      row.appendChild(downBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'pmd-reader-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Remove reader';
      delBtn.addEventListener('click', () => {
        const next = settings.get('readers').filter((_, i) => i !== idx);
        if (next.length === 0) return; // keep at least one
        commit(next);
      });
      row.appendChild(delBtn);

      list.appendChild(row);
    });
  }

  addBtn.addEventListener('click', () => {
    const cur = settings.get('readers');
    commit([...cur, { name: `Reader ${cur.length + 1}`, wpm: 200 }]);
  });

  // Re-render when readers change (e.g., from elsewhere or own edits).
  const unsubscribe = settings.subscribe((s) => {
    // Only re-render if the readers list changed.
    void s;
    render();
  });
  // Also re-render once now.
  render();

  // Best-effort cleanup if the editor is detached (modal closes & rebuilds).
  wrap.addEventListener('DOMNodeRemoved', () => {
    unsubscribe();
  });

  return wrap;
}

let singleton: SettingsModal | null = null;

export function openSettings(): void {
  if (!singleton) singleton = new SettingsModal();
  singleton.open();
}
