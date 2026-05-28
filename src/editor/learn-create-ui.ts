/**
 * Create-flashcard dialog (SPEC-learn-system §9). A small modal — Q&A or
 * single-deletion cloze — anchored to the current selection. Returns the
 * card definition on submit, or null on cancel. Visual shape mirrors
 * `text-prompt.ts` so it reads as part of the same modal vocabulary.
 *
 * (v1: a standalone dialog. The eventual in-comments-column creation
 * surface is a later step; the card model is identical either way.)
 */

export interface NewCardDef {
  type: 'qa' | 'cloze';
  front: string;
  back: string;
}

export function openCreateFlashcard(opts: { selectedText: string }): Promise<NewCardDef | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pmd-route-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'pmd-route-dialog pmd-learn-create-dialog';

    const header = document.createElement('div');
    header.className = 'pmd-route-header';
    header.textContent = 'New flashcard';
    dialog.appendChild(header);

    const anchorNote = document.createElement('div');
    anchorNote.className = 'pmd-learn-create-anchor';
    const snippet = opts.selectedText.replace(/\s+/g, ' ').trim();
    anchorNote.textContent = `Anchored to: "${snippet.length > 90 ? snippet.slice(0, 90) + '…' : snippet}"`;
    dialog.appendChild(anchorNote);

    // Type toggle (Q&A / Cloze), mirroring the segmented controls.
    const types = document.createElement('div');
    types.className = 'pmd-theme-editor pmd-learn-create-type';
    let type: 'qa' | 'cloze' = 'qa';
    const mkType = (value: 'qa' | 'cloze', label: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pmd-theme-editor-btn';
      b.textContent = label;
      b.setAttribute('aria-pressed', value === type ? 'true' : 'false');
      b.addEventListener('click', () => {
        type = value;
        for (const x of types.querySelectorAll<HTMLButtonElement>('button')) {
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        }
        applyMode();
      });
      types.appendChild(b);
      return b;
    };
    mkType('qa', 'Q & A');
    mkType('cloze', 'Cloze');
    dialog.appendChild(types);

    // Q&A fields.
    const qaWrap = document.createElement('div');
    qaWrap.className = 'pmd-learn-create-fields';
    const front = textarea('Question', '');
    const back = textarea('Answer', opts.selectedText.trim());
    qaWrap.append(front.wrap, back.wrap);
    dialog.appendChild(qaWrap);

    // Cloze field.
    const clozeWrap = document.createElement('div');
    clozeWrap.className = 'pmd-learn-create-fields';
    clozeWrap.hidden = true;
    const cloze = textarea('Cloze sentence — wrap the deletion in {{double braces}}', opts.selectedText.trim());
    clozeWrap.append(cloze.wrap);
    dialog.appendChild(clozeWrap);

    function applyMode(): void {
      qaWrap.hidden = type !== 'qa';
      clozeWrap.hidden = type !== 'cloze';
      (type === 'qa' ? front.input : cloze.input).focus();
    }

    const note = document.createElement('div');
    note.className = 'pmd-learn-create-note';
    dialog.appendChild(note);

    const buttons = document.createElement('div');
    buttons.className = 'pmd-text-prompt-buttons';
    const cleanup = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pmd-route-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'pmd-text-prompt-ok';
    create.textContent = 'Create';
    create.addEventListener('click', submit);
    buttons.append(cancel, create);
    dialog.appendChild(buttons);

    function submit(): void {
      if (type === 'qa') {
        const f = front.input.value.trim();
        const b = back.input.value.trim();
        if (!f || !b) {
          note.textContent = 'A Q&A card needs both a question and an answer.';
          return;
        }
        cleanup();
        resolve({ type: 'qa', front: f, back: b });
        return;
      }
      const sentence = cloze.input.value.trim();
      if (!/\{\{.+?\}\}/.test(sentence)) {
        note.textContent = 'Mark the deletion by wrapping it in {{double braces}}.';
        return;
      }
      cleanup();
      resolve({ type: 'cloze', front: sentence, back: '' });
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        resolve(null);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    setTimeout(() => front.input.focus(), 0);
  });
}

function textarea(label: string, initial: string): { wrap: HTMLElement; input: HTMLTextAreaElement } {
  const wrap = document.createElement('label');
  wrap.className = 'pmd-learn-create-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('textarea');
  input.className = 'pmd-learn-create-input';
  input.rows = 2;
  input.value = initial;
  input.spellcheck = false;
  wrap.append(span, input);
  return { wrap, input };
}
