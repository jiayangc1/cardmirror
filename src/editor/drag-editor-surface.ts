/**
 * Editor surface for cross-surface drag-and-drop.
 *
 * Phase 3a: when a nav-pane drag is active, this surface renders drop
 * indicators in the editor itself (horizontal lines spanning the
 * editor's width at top-of-each-heading positions) and exposes a
 * hit-test so the active drag controller can pick the editor as the
 * drop target. The drop transaction is the same as nav→nav — only
 * the source of the target position differs.
 *
 * Phase 3b will add text→nav (modifier-pickup of cards from the
 * editor surface). That's intentionally deferred to a separate
 * change.
 */

import type { EditorView } from 'prosemirror-view';
import { collectHeadings, computeHeadingRange } from './headings.js';
import { dragController } from './drag-controller.js';

/**
 * One drop indicator + its anchor position in the doc. Returned by
 * the hit-test so the calling pointermove handler can hand it to the
 * controller.
 */
export interface EditorDropHit {
  insertPos: number;
  /** Distance (in CSS px) from the indicator's center y to the
   *  pointer's y. Used by the cross-surface hit chooser to pick the
   *  closest target overall. */
  dy: number;
  /** The DOM element to highlight while it's the active hover. */
  el: HTMLElement;
}

interface IndicatorRecord {
  el: HTMLElement;
  insertPos: number;
  /** Center y in client coordinates, computed at render time. */
  centerClientY: number;
}

class EditorDragSurface {
  private view: EditorView | null = null;
  private indicators: IndicatorRecord[] = [];
  private host: HTMLElement | null = null;

  attach(view: EditorView, hostEl: HTMLElement): void {
    this.view = view;
    this.host = hostEl;
    if (!hostEl.style.position) hostEl.style.position = 'relative';
  }

  detach(): void {
    this.removeIndicators();
    this.view = null;
    this.host = null;
  }

  /**
   * Render drop indicators in the editor for a drag at the given
   * outline level. Slots appear above every heading whose level is
   * shallow enough to validly accept the dragged content, plus an
   * end-of-doc slot.
   */
  renderIndicators(draggedLevel: number): void {
    this.removeIndicators();
    if (!this.view || !this.host) return;
    const view = this.view;
    const host = this.host;
    const hostRect = host.getBoundingClientRect();

    const headings = collectHeadings(view.state.doc);
    const seenPositions = new Set<number>();

    const place = (insertPos: number, anchorY: number): void => {
      if (seenPositions.has(insertPos)) return;
      seenPositions.add(insertPos);
      const indicator = document.createElement('div');
      indicator.className = 'pmd-editor-drop-indicator';
      // Top is computed in editor-relative space (host's
      // padding/scroll account for via subtraction).
      indicator.style.top = `${anchorY - hostRect.top + host.scrollTop}px`;
      host.appendChild(indicator);
      this.indicators.push({ el: indicator, insertPos, centerClientY: anchorY });
    };

    for (const entry of headings) {
      if (entry.level > draggedLevel) continue;
      const range = computeHeadingRange(view.state.doc, entry);
      if (!range) continue;
      try {
        const coords = view.coordsAtPos(range.from);
        place(range.from, coords.top);
      } catch {
        // coordsAtPos can throw mid-doc-update; skip this slot.
      }
    }

    // End-of-doc slot.
    const docEnd = view.state.doc.content.size;
    try {
      const endCoords = view.coordsAtPos(docEnd);
      place(docEnd, endCoords.bottom);
    } catch {
      /* skip */
    }
  }

  removeIndicators(): void {
    for (const r of this.indicators) r.el.remove();
    this.indicators = [];
  }

  /**
   * Hit-test the indicators against a pointer position. Returns the
   * nearest indicator within tolerance, or null if the pointer is
   * outside the editor or too far from any indicator.
   *
   * Drop-on-self is handled by the caller (it sees the active drag
   * session's source ranges).
   */
  hitTest(clientX: number, clientY: number): EditorDropHit | null {
    if (!this.host) return null;
    const hostRect = this.host.getBoundingClientRect();
    if (
      clientX < hostRect.left ||
      clientX > hostRect.right ||
      clientY < hostRect.top - 16 ||
      clientY > hostRect.bottom + 16
    ) {
      return null;
    }

    let best: IndicatorRecord | null = null;
    let bestDy = Infinity;
    for (const r of this.indicators) {
      // Skip drop-on-self (insertPos strictly inside a source range).
      const session = dragController.getSession();
      if (session) {
        const onSelf = session.items.some(
          (it) => r.insertPos > it.from && r.insertPos < it.to,
        );
        if (onSelf) continue;
      }
      const dy = Math.abs(clientY - r.centerClientY);
      if (dy < bestDy) {
        bestDy = dy;
        best = r;
      }
    }
    if (!best || bestDy > 32) return null;
    return { insertPos: best.insertPos, dy: bestDy, el: best.el };
  }

  /** Highlight the given indicator (or none). Caller must have
   *  resolved which indicator wins across all surfaces. */
  highlight(el: HTMLElement | null): void {
    for (const r of this.indicators) {
      r.el.classList.toggle('pmd-editor-drop-indicator-active', r.el === el);
    }
  }
}

/**
 * Workspace-wide singleton. NavigationPanel queries this when hit-
 * testing across surfaces during a drag.
 */
export const editorDragSurface = new EditorDragSurface();
