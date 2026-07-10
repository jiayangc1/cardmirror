/**
 * Modal text-prompt dialog. Drop-in replacement for the browser's
 * native `window.prompt` — Electron's BrowserWindows disable
 * `prompt()` outright (it throws "prompt() is not supported"), so
 * every prompt-style flow that needs to run on the desktop edition
 * routes through this helper instead.
 *
 * Returns the trimmed input on submit, or `null` on cancel (Esc,
 * Cancel button, or click outside the dialog box). Auto-focuses the
 * input on open; Enter submits, Esc cancels. Visual shape mirrors
 * the existing `pmd-route-dialog` overlays so it reads as part of
 * the same modal vocabulary.
 */

export interface TextPromptOptions {
  /** Title / question shown above the input. */
  message: string;
  /** Initial value of the input. Defaults to ''. */
  initial?: string;
  /** Placeholder when the input is empty. */
  placeholder?: string;
  /** Label on the submit button. Defaults to 'OK'. */
  okLabel?: string;
  /** Label on the cancel button. Defaults to 'Cancel'. */
  cancelLabel?: string;
  /** Render a `<textarea>` (multi-line) instead of `<input type=text>`.
   *  In multiline mode, Enter inserts a newline; Ctrl/Cmd+Enter submits. */
  multiline?: boolean;
}

export function promptForText(opts: TextPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pmd-route-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'pmd-route-dialog pmd-text-prompt-dialog';

    const header = document.createElement('div');
    header.className = 'pmd-route-header';
    header.textContent = opts.message;
    dialog.appendChild(header);

    const input: HTMLInputElement | HTMLTextAreaElement = opts.multiline
      ? document.createElement('textarea')
      : document.createElement('input');
    if (input instanceof HTMLInputElement) input.type = 'text';
    input.className = 'pmd-text-prompt-input';
    input.value = opts.initial ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    dialog.appendChild(input);

    const buttons = document.createElement('div');
    buttons.className = 'pmd-text-prompt-buttons';

    const cleanup = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pmd-route-cancel';
    cancelBtn.textContent = opts.cancelLabel ?? 'Cancel';
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });
    buttons.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'pmd-text-prompt-ok';
    okBtn.textContent = opts.okLabel ?? 'OK';
    okBtn.addEventListener('click', () => {
      cleanup();
      resolve(input.value.trim());
    });
    buttons.appendChild(okBtn);

    dialog.appendChild(buttons);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(null);
      } else if (e.key === 'Enter') {
        // Multiline: Enter inserts a newline; Ctrl/Cmd+Enter submits.
        // Single-line: Enter submits.
        if (opts.multiline && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        cleanup();
        resolve(input.value.trim());
      }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    // Focus + select so users can immediately type a replacement
    // when an initial value is supplied.
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

export interface ChoicePromptOptions<T extends string> {
  /** Title / question shown above the choice buttons. */
  message: string;
  /** Optional second-line body — used to show details the choice is
   *  about (e.g., the existing alt text the user is deciding to keep
   *  or replace). Rendered read-only beneath the message. */
  detail?: string;
  /** Buttons in left-to-right display order. Each button's `value` is
   *  what the returned promise resolves to. The button marked
   *  `primary: true` (or the first one if none is) is activated by
   *  Enter; Esc / overlay-click always resolves to null. */
  choices: { value: T; label: string; primary?: boolean }[];
  /** Label on the trailing cancel button. Defaults to 'Cancel'. */
  cancelLabel?: string;
}

/** Modal that asks the user to pick one of N options. Returns the
 *  chosen `value`, or `null` if the user cancels.
 *
 *  Visual shape mirrors `promptForText` so it reads as part of the
 *  same dialog vocabulary. */
export function promptForChoice<T extends string>(
  opts: ChoicePromptOptions<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pmd-route-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'pmd-route-dialog pmd-text-prompt-dialog';

    const header = document.createElement('div');
    header.className = 'pmd-route-header';
    header.textContent = opts.message;
    dialog.appendChild(header);

    if (opts.detail) {
      const detail = document.createElement('div');
      detail.className = 'pmd-choice-prompt-detail';
      detail.textContent = opts.detail;
      dialog.appendChild(detail);
    }

    const buttons = document.createElement('div');
    buttons.className = 'pmd-text-prompt-buttons';

    const cleanup = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pmd-route-cancel';
    cancelBtn.textContent = opts.cancelLabel ?? 'Cancel';
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });
    buttons.appendChild(cancelBtn);

    const primary = opts.choices.find((c) => c.primary) ?? opts.choices[0]!;
    for (const choice of opts.choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pmd-text-prompt-ok';
      btn.textContent = choice.label;
      btn.addEventListener('click', () => {
        cleanup();
        resolve(choice.value);
      });
      buttons.appendChild(btn);
    }

    dialog.appendChild(buttons);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cleanup();
        resolve(primary.value);
      }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
  });
}

export interface RouteChoiceOption<T extends string> {
  /** What the returned promise resolves to when this button is picked. */
  value: T;
  /** Bold first line. */
  label: string;
  /** Optional second line beneath the label (mirrors the Save-dialog's
   *  "Write to the existing file, then close." style). */
  description?: string;
}

export interface RouteChoiceOptions<T extends string> {
  /** Title / question shown above the buttons. */
  message: string;
  /** Buttons in display order, rendered as two-line `pmd-route-btn`s and
   *  numbered 1..N. Number keys 1-9 (no modifier) activate them; Enter picks
   *  the first; Esc / overlay-click / Cancel resolves to null. */
  choices: RouteChoiceOption<T>[];
  /** Label on the trailing cancel button. Defaults to 'Cancel'. */
  cancelLabel?: string;
}

/** Modal choice dialog in the SAME visual vocabulary as the unsaved-changes
 *  Save / Don't save / Cancel prompt (`confirmCloseUnsaved`): two-line buttons
 *  with number-key (1/2/3) shortcuts. Use for confirmations that should read as
 *  part of that family (the co-editing start / close / end flows). Returns the
 *  chosen `value`, or null on cancel. */
export function promptForRouteChoice<T extends string>(
  opts: RouteChoiceOptions<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pmd-route-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'pmd-route-dialog';

    const header = document.createElement('div');
    header.className = 'pmd-route-header';
    header.textContent = opts.message;
    dialog.appendChild(header);

    const buttons = document.createElement('div');
    buttons.className = 'pmd-route-buttons';

    const cleanup = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };

    const pick = (value: T): void => {
      cleanup();
      resolve(value);
    };

    for (const choice of opts.choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pmd-route-btn';
      const strong = document.createElement('strong');
      strong.textContent = choice.label;
      btn.appendChild(strong);
      if (choice.description) {
        btn.appendChild(document.createElement('br'));
        const span = document.createElement('span');
        span.textContent = choice.description;
        btn.appendChild(span);
      }
      btn.addEventListener('click', () => pick(choice.value));
      buttons.appendChild(btn);
    }
    dialog.appendChild(buttons);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pmd-route-cancel';
    cancel.textContent = opts.cancelLabel ?? 'Cancel';
    cancel.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });
    dialog.appendChild(cancel);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(null);
        return;
      }
      // Number keys mirror button order (1 = first). Skip when a modifier is
      // held so chords (e.g. Ctrl+1 slot focus) stay available.
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= opts.choices.length) {
        e.preventDefault();
        pick(opts.choices[n - 1]!.value);
      }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
  });
}
