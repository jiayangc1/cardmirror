/**
 * Right-click context menu for image nodes inside the editor.
 *
 * Currently surfaces two AI-driven actions:
 *   - "Generate alt text from image (AI)"
 *   - "Generate table from image (AI)"
 *
 * Both are gated on `aiFeaturesEnabled` and the user having an
 * Anthropic API key set; the menu items render as disabled with a
 * tooltip explaining why when those preconditions aren't met, so the
 * affordance is discoverable even before the user has wired AI up.
 *
 * The menu reuses the styling + close-on-outside-click plumbing
 * already in `nav-panel.ts`'s context menu (`.pmd-nav-context-menu`)
 * so it looks consistent across surfaces.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { settings } from './settings.js';
import { runGenerateAltText, runGenerateTable } from './ai/image-ai.js';

/** PM plugin. Installed via `buildEditorPlugins` so every editor
 *  view (single-doc + each multi-pane slot) picks it up. */
export const imageContextMenuPlugin: Plugin = new Plugin({
  props: {
    handleDOMEvents: {
      contextmenu(view, event) {
        const target = event.target as HTMLElement | null;
        if (!target) return false;
        const imgEl = target.closest?.('[data-pmd-image]') as HTMLElement | null;
        if (!imgEl) return false;

        const pos = posOfImageElement(view, imgEl);
        if (pos == null) return false;
        const node = view.state.doc.nodeAt(pos);
        if (!node || node.type.name !== 'image') return false;

        event.preventDefault();
        showImageContextMenu(event.clientX, event.clientY, view, pos, node);
        return true;
      },
    },
  },
});

/** Walk the PM view-desc tree to find the doc position of the
 *  given DOM element. PM exposes `posAtDOM` which does this
 *  cleanly; we ask for the position right BEFORE the image so
 *  `doc.nodeAt(pos)` returns the image node itself. */
function posOfImageElement(view: EditorView, el: HTMLElement): number | null {
  try {
    // `posAtDOM(el, 0)` returns the doc position corresponding to
    // offset 0 inside `el`. For an atomic inline image that's the
    // image's own start position — exactly what we want.
    return view.posAtDOM(el, 0);
  } catch {
    return null;
  }
}

interface MenuItem {
  label: string;
  /** Disabled items render greyed-out and don't fire. Used for AI
   *  options when AI features are off / no API key. */
  disabled?: boolean;
  /** Tooltip text — explains the disabled state. */
  title?: string;
  action: () => void;
}

let openMenuEl: HTMLElement | null = null;

function showImageContextMenu(
  x: number,
  y: number,
  view: EditorView,
  imagePos: number,
  imageNode: PMNode,
): void {
  closeImageContextMenu();

  const aiOn = settings.get('aiFeaturesEnabled');
  const hasKey = settings.get('anthropicApiKey').trim().length > 0;
  const aiBlockedReason =
    !aiOn ? 'AI features are disabled — enable them in Settings.'
    : !hasKey ? 'Set an Anthropic API key in Settings to use AI features.'
    : null;

  const items: MenuItem[] = [
    {
      label: 'Generate alt text from image (AI)',
      disabled: aiBlockedReason !== null,
      title: aiBlockedReason ?? undefined,
      action: () => runGenerateAltText(view, imagePos, imageNode),
    },
    {
      label: 'Generate table from image (AI)',
      disabled: aiBlockedReason !== null,
      title: aiBlockedReason ?? undefined,
      action: () => runGenerateTable(view, imagePos, imageNode),
    },
  ];

  const menu = document.createElement('div');
  menu.className = 'pmd-nav-context-menu';

  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-nav-context-item';
    btn.textContent = item.label;
    if (item.disabled) {
      btn.disabled = true;
      btn.classList.add('pmd-nav-context-item-disabled');
    }
    if (item.title) btn.title = item.title;
    btn.addEventListener('click', () => {
      if (item.disabled) return;
      closeImageContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // Clamp into viewport — match nav-panel's positioning logic so the
  // menu never spawns off-screen.
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menu.style.left = `${Math.min(x, Math.max(0, maxX))}px`;
  menu.style.top = `${Math.min(y, Math.max(0, maxY))}px`;

  openMenuEl = menu;
  // Defer registration so the contextmenu's own mousedown doesn't
  // immediately close the menu we just opened.
  setTimeout(() => {
    window.addEventListener('mousedown', maybeCloseImageContextMenu, { capture: true });
    window.addEventListener('keydown', maybeCloseImageContextMenu, { capture: true });
  });
}

function closeImageContextMenu(): void {
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  window.removeEventListener('mousedown', maybeCloseImageContextMenu, { capture: true });
  window.removeEventListener('keydown', maybeCloseImageContextMenu, { capture: true });
}

function maybeCloseImageContextMenu(e: MouseEvent | KeyboardEvent): void {
  if (e instanceof KeyboardEvent) {
    if (e.key === 'Escape') closeImageContextMenu();
    return;
  }
  if (!openMenuEl) return;
  if (!openMenuEl.contains(e.target as Node)) closeImageContextMenu();
}
