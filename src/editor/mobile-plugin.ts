/**
 * Mobile-shell editor behavior (SPEC-mobile-view.md).
 *
 * The mobile shell is view-first: the ProseMirror view is never
 * contenteditable, which keeps the on-screen keyboard away entirely
 * while leaving decorations, history, and programmatic selection
 * fully alive. Commands target content via tap coordinates
 * (`posAtCoords` under the hood of `handleClick`'s `pos`), not via a
 * caret — there is no caret.
 *
 * Lives in its own module (not mobile-shell.ts) so `buildEditorPlugins`
 * can include it statically without importing the shell, which itself
 * imports from editor/index.ts (the same dynamic-import cycle-break
 * the multi-pane shell uses).
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import { readModePlugin } from './read-mode-plugin.js';
import { toggleReadingMarker } from './reading-marker.js';

/** Set once at boot, before any EditorView mounts. Never flips
 *  mid-session — the shell decision is per-load (see
 *  `resolveMobileLayout`). */
let mobileShellActive = false;

export function setMobileShellActive(on: boolean): void {
  mobileShellActive = on;
}

export function isMobileShellActive(): boolean {
  return mobileShellActive;
}

export const mobilePlugin: Plugin = new Plugin({
  props: {
    /** View-first: never contenteditable on mobile. */
    editable(): boolean {
      return !mobileShellActive;
    },
    /** In read mode, a tap toggles the reading-position marker at
     *  the tapped word — the touch equivalent of the Space/Enter
     *  binding (a non-editable view gets no key events at all). */
    handleClick(view, pos): boolean {
      if (!mobileShellActive) return false;
      if (!readModePlugin.getState(view.state)?.on) return false;
      const $pos = view.state.doc.resolve(pos);
      view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
      return toggleReadingMarker(view);
    },
  },
});
