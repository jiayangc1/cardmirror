/**
 * Save As modal. Promise-based — resolves with the user's chosen
 * filename + format + export options, or `null` if they cancelled.
 *
 * Two output formats:
 *   - `cmir` — CardMirror native (lossless JSON, no Verbatim round-
 *     trip). Recommended for docs that live entirely in CardMirror.
 *   - `docx` — Microsoft Word / Verbatim. Use for sharing with
 *     teammates still on Verbatim, or for any tournament-day round
 *     where the receiving party needs Word.
 *
 * The format radio drives the default filename extension and which
 * filter the OS dialog defaults to. Export-content toggles
 * (analytics / undertags / comments / read-mode) apply equally to
 * both formats — read-mode-as-export, in particular, is a content
 * filter not a format choice.
 */

export type SaveAsFormat = 'cmir' | 'docx';

export interface SaveAsResult {
  filename: string;
  /** Which on-disk format the user picked. */
  format: SaveAsFormat;
  /** Include comments in the saved doc. */
  includeComments: boolean;
  /** Include analytic content. When false, doc-level analytic_units
   *  drop entirely; in-card analytic paragraphs drop. */
  includeAnalytics: boolean;
  /** Include undertag paragraphs (doc-level and inside cards /
   *  analytic_units). */
  includeUndertags: boolean;
  /** Save only what's visible in read mode: headings, tags, in-card
   *  analytics, cite-marked text inside cite_paragraphs, highlighted
   *  text inside body paragraphs. Mutually exclusive with the three
   *  include-* options above. */
  readMode: boolean;
}

export interface OpenSaveAsOptions {
  /** Initial filename suggestion (with or without an extension — the
   *  dialog will normalize on confirm). */
  initialFilename: string;
  /** Default format to pre-select. Usually the current doc's format
   *  (so re-saving stays in the same format unless the user changes
   *  it). New docs default to `'cmir'` — the recommended forward-
   *  looking native format. */
  defaultFormat: SaveAsFormat;
}

export function openSaveAs(opts: OpenSaveAsOptions): Promise<SaveAsResult | null> {
  return new Promise((resolve) => {
    new SaveAsModal(opts, resolve);
  });
}

const FORMAT_LABELS: Record<SaveAsFormat, string> = {
  cmir: 'CardMirror native (.cmir)',
  docx: 'Microsoft Word (.docx)',
};

const FORMAT_BLURBS: Record<SaveAsFormat, string> = {
  cmir: 'Lossless. No conversion. Best for docs that stay in CardMirror.',
  docx: 'For sharing with Verbatim users or any Word-based workflow.',
};

class SaveAsModal {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private filenameInput!: HTMLInputElement;
  private commentsBox!: HTMLInputElement;
  private analyticsBox!: HTMLInputElement;
  private undertagsBox!: HTMLInputElement;
  private readModeBox!: HTMLInputElement;
  /** Radio inputs keyed by format id. */
  private formatRadios!: Record<SaveAsFormat, HTMLInputElement>;
  private settled = false;
  private currentFormat: SaveAsFormat;

  constructor(
    private readonly opts: OpenSaveAsOptions,
    private readonly settle: (r: SaveAsResult | null) => void,
  ) {
    this.currentFormat = opts.defaultFormat;
    this.overlay = document.createElement('div');
    this.overlay.className = 'pmd-save-as-overlay';

    this.dialog = document.createElement('div');
    this.dialog.className = 'pmd-save-as-dialog';
    this.overlay.appendChild(this.dialog);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.cancel();
    });

    document.addEventListener('keydown', this.handleKey);

    this.render();
    document.body.appendChild(this.overlay);

    requestAnimationFrame(() => {
      this.filenameInput.focus();
      // Select just the basename, not the extension, so the user can
      // type a new name without clobbering the extension.
      const dot = this.filenameInput.value.lastIndexOf('.');
      if (dot > 0) {
        this.filenameInput.setSelectionRange(0, dot);
      } else {
        this.filenameInput.select();
      }
    });
  }

  private readonly handleKey = (e: KeyboardEvent): void => {
    if (this.settled) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    }
  };

  private render(): void {
    const header = document.createElement('header');
    header.className = 'pmd-save-as-header';
    const title = document.createElement('h2');
    title.textContent = 'Save As';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pmd-save-as-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Cancel';
    closeBtn.addEventListener('click', () => this.cancel());
    header.appendChild(closeBtn);
    this.dialog.appendChild(header);

    const form = document.createElement('form');
    form.className = 'pmd-save-as-body';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.confirm();
    });

    // Format picker — radio buttons at the top so the rest of the
    // dialog reads as "you chose format X, here's how to configure
    // that save."
    form.appendChild(this.buildFormatPicker());

    // Filename field.
    const fileLabel = document.createElement('label');
    fileLabel.className = 'pmd-save-as-field';
    const fileSpan = document.createElement('span');
    fileSpan.className = 'pmd-save-as-field-label';
    fileSpan.textContent = 'File name';
    fileLabel.appendChild(fileSpan);
    this.filenameInput = document.createElement('input');
    this.filenameInput.type = 'text';
    this.filenameInput.className = 'pmd-save-as-input';
    this.filenameInput.value = withExtension(this.opts.initialFilename, this.currentFormat);
    this.filenameInput.spellcheck = false;
    this.filenameInput.autocomplete = 'off';
    fileLabel.appendChild(this.filenameInput);
    form.appendChild(fileLabel);

    // Export-content toggles — apply to both formats.
    const options = document.createElement('div');
    options.className = 'pmd-save-as-options';
    options.appendChild(this.buildOptionsHeading());

    this.commentsBox = this.buildCheckbox('Include comments', true);
    this.analyticsBox = this.buildCheckbox('Include analytics', true);
    this.undertagsBox = this.buildCheckbox('Include undertags', true);
    this.readModeBox = this.buildCheckbox(
      'Read mode (only headings, tags, analytics, cites, highlights)',
      false,
    );

    options.appendChild(this.commentsBox.parentElement!);
    options.appendChild(this.analyticsBox.parentElement!);
    options.appendChild(this.undertagsBox.parentElement!);
    options.appendChild(this.readModeBox.parentElement!);

    const groupedIncludes = [this.commentsBox, this.analyticsBox, this.undertagsBox];
    const refreshGroupState = (): void => {
      const readMode = this.readModeBox.checked;
      for (const box of groupedIncludes) {
        box.disabled = readMode;
        const label = box.parentElement as HTMLLabelElement;
        label.classList.toggle('pmd-save-as-option-disabled', readMode);
      }
    };
    this.readModeBox.addEventListener('change', () => {
      if (this.readModeBox.checked) {
        for (const box of groupedIncludes) box.checked = false;
      }
      refreshGroupState();
    });
    for (const box of groupedIncludes) {
      box.addEventListener('change', () => {
        if (box.checked) {
          this.readModeBox.checked = false;
          refreshGroupState();
        }
      });
    }

    form.appendChild(options);

    const footer = document.createElement('footer');
    footer.className = 'pmd-save-as-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pmd-save-as-btn pmd-save-as-btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.cancel());
    footer.appendChild(cancel);
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'pmd-save-as-btn pmd-save-as-btn-primary';
    save.textContent = 'Save';
    footer.appendChild(save);
    form.appendChild(footer);

    this.dialog.appendChild(form);
  }

  private buildFormatPicker(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'pmd-save-as-format';
    const heading = document.createElement('div');
    heading.className = 'pmd-save-as-options-heading';
    heading.textContent = 'Format';
    wrap.appendChild(heading);

    const groupName = `pmd-save-as-format-${Math.random().toString(36).slice(2, 8)}`;
    this.formatRadios = { cmir: null!, docx: null! };
    for (const id of ['cmir', 'docx'] as const) {
      const row = document.createElement('label');
      row.className = 'pmd-save-as-format-row';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.value = id;
      input.checked = id === this.currentFormat;
      input.addEventListener('change', () => {
        if (input.checked) this.setFormat(id);
      });
      this.formatRadios[id] = input;
      row.appendChild(input);
      const text = document.createElement('span');
      text.className = 'pmd-save-as-format-row-text';
      const label = document.createElement('span');
      label.className = 'pmd-save-as-format-row-label';
      label.textContent = FORMAT_LABELS[id];
      text.appendChild(label);
      const blurb = document.createElement('span');
      blurb.className = 'pmd-save-as-format-row-blurb';
      blurb.textContent = FORMAT_BLURBS[id];
      text.appendChild(blurb);
      row.appendChild(text);
      wrap.appendChild(row);
    }
    return wrap;
  }

  /** Update the format and swap the filename's extension to match. */
  private setFormat(format: SaveAsFormat): void {
    this.currentFormat = format;
    this.filenameInput.value = withExtension(this.filenameInput.value, format);
  }

  private buildOptionsHeading(): HTMLElement {
    const h = document.createElement('div');
    h.className = 'pmd-save-as-options-heading';
    h.textContent = 'Include';
    return h;
  }

  private buildCheckbox(labelText: string, defaultChecked: boolean): HTMLInputElement {
    const label = document.createElement('label');
    label.className = 'pmd-save-as-option';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = defaultChecked;
    label.appendChild(box);
    const text = document.createElement('span');
    text.textContent = labelText;
    label.appendChild(text);
    return box;
  }

  private confirm(): void {
    const trimmed = this.filenameInput.value.trim();
    if (!trimmed) return;
    const filename = withExtension(trimmed, this.currentFormat);
    const readMode = this.readModeBox.checked;
    this.finish({
      filename,
      format: this.currentFormat,
      includeComments: readMode ? false : this.commentsBox.checked,
      includeAnalytics: readMode ? false : this.analyticsBox.checked,
      includeUndertags: readMode ? false : this.undertagsBox.checked,
      readMode,
    });
  }

  private cancel(): void {
    this.finish(null);
  }

  private finish(result: SaveAsResult | null): void {
    if (this.settled) return;
    this.settled = true;
    document.removeEventListener('keydown', this.handleKey);
    this.overlay.remove();
    this.settle(result);
  }
}

/** Normalize a filename to end with the right extension for the
 *  chosen format. Strips other known extensions first so swapping
 *  the format radio replaces `.docx` with `.cmir` and vice versa
 *  without piling them up. */
function withExtension(filename: string, format: SaveAsFormat): string {
  let base = filename.trim();
  for (const ext of ['.cmir', '.docx']) {
    if (base.toLowerCase().endsWith(ext)) {
      base = base.slice(0, -ext.length);
      break;
    }
  }
  return `${base}.${format}`;
}
