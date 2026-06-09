/**
 * Italic-caret plugin.
 *
 * When the next typed character would be italic — a collapsed cursor whose
 * effective marks (stored marks, or the marks at the cursor) include the
 * `italic` mark — the native caret can't convey that (browsers don't slant
 * the caret). So we hide the native caret (`caret-color: transparent` via a
 * class on `.ProseMirror`) and draw our own thin, slanted, blinking caret
 * at the cursor's screen position. The moment typing wouldn't be italic, the
 * native caret comes back and ours is hidden.
 *
 * The custom caret is a single `position: fixed` element positioned from
 * `view.coordsAtPos` (viewport coordinates), repositioned on every
 * selection change, scroll, resize, and focus change.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../schema/index.js';

/** True when a collapsed cursor would type italic text. */
function italicPending(state: EditorState): boolean {
  const sel = state.selection;
  if (!sel.empty) return false;
  const italic = schema.marks['italic'];
  if (!italic) return false;
  const marks = state.storedMarks ?? sel.$from.marks();
  return marks.some((m) => m.type === italic);
}

export const italicCaretPlugin = new Plugin({
  props: {
    attributes(state): { [name: string]: string } {
      // Hide the native caret only while ours is showing.
      return italicPending(state) ? { class: 'pmd-italic-caret-active' } : {};
    },
  },
  view(view: EditorView) {
    const caret = document.createElement('div');
    caret.className = 'pmd-italic-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.style.display = 'none';
    document.body.appendChild(caret);

    let raf = 0;

    const reposition = (): void => {
      raf = 0;
      if (!view.editable || !view.hasFocus() || !italicPending(view.state)) {
        caret.style.display = 'none';
        return;
      }
      let coords;
      try {
        coords = view.coordsAtPos(view.state.selection.head);
      } catch {
        caret.style.display = 'none';
        return;
      }
      caret.style.display = 'block';
      caret.style.left = `${coords.left}px`;
      caret.style.top = `${coords.top}px`;
      caret.style.height = `${Math.max(1, coords.bottom - coords.top)}px`;
    };

    const schedule = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(reposition);
    };

    // Scroll (capture, to catch the inner editor scrollers), resize, and
    // focus changes don't fire plugin `update`, so listen explicitly.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    view.dom.addEventListener('focus', schedule);
    view.dom.addEventListener('blur', schedule);
    reposition();

    return {
      update: () => schedule(),
      destroy: () => {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('scroll', schedule, true);
        window.removeEventListener('resize', schedule);
        view.dom.removeEventListener('focus', schedule);
        view.dom.removeEventListener('blur', schedule);
        caret.remove();
      },
    };
  },
});
