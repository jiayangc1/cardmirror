/**
 * Editor surface for cross-surface drag-and-drop.
 *
 * Phase 3a (nav→text): when ANY drag is active, this surface renders
 * drop indicators in the editor (horizontal lines spanning the
 * editor's width at top-of-each-heading positions, plus an end-of-doc
 * slot) and hits-tests them so the controller can land a drop here.
 * Indicator rendering is driven by subscription to the drag controller
 * — no need for the source surface to call us directly.
 *
 * Phase 3b (text→nav): when the user holds the pickup modifier
 * (Ctrl+Alt+Shift on Linux/Win, Cmd+Option+Shift on Mac), the editor
 * enters "pickup mode": the cursor changes to grab; hovering shows a
 * dashed-outline overlay around the smallest enclosing recognized
 * container under the pointer (Card / Block / Hat / Pocket / Analytic-
 * unit, smallest wins). A pointerdown in pickup mode begins a drag
 * with that container as the source. Releasing the modifier mid-drag
 * cancels.
 */

import type { EditorView } from 'prosemirror-view';
import { collectHeadings, computeHeadingRange, TYPE_TO_LEVEL } from './headings.js';
import { dragController, type DragItem, type DragSurface } from './drag-controller.js';

interface IndicatorRecord {
  el: HTMLElement;
  insertPos: number;
}

interface HoveredContainer {
  from: number;
  to: number;
  type: string;
  level: number;
  label: string;
}

class EditorDragSurface implements DragSurface {
  private view: EditorView | null = null;
  private host: HTMLElement | null = null;
  private indicators: IndicatorRecord[] = [];

  // Phase 3b state.
  private pickupModifierHeld = false;
  private hovered: HoveredContainer | null = null;
  private highlightBox: HTMLElement | null = null;
  private dragOriginatedHere = false;
  private editorPointerMoveAttached = false;

  // Subscriptions / cleanups.
  private unsubscribeDrag: (() => void) | null = null;
  private unregisterSurface: (() => void) | null = null;

  // Bound handlers.
  private boundOnKey = (e: KeyboardEvent) => this.onKey(e);
  private boundOnBlur = () => this.onBlur();
  private boundOnHostMove = (e: PointerEvent) => this.onHostPointerMove(e);
  private boundOnHostDown = (e: PointerEvent) => this.onHostPointerDown(e);
  private boundOnDocMove = (e: PointerEvent) => this.onDocPointerMoveDuringDrag(e);
  private boundOnDocUp = (e: PointerEvent) => this.onDocPointerUpDuringDrag(e);

  attach(view: EditorView, hostEl: HTMLElement): void {
    this.view = view;
    this.host = hostEl;
    if (!hostEl.style.position) hostEl.style.position = 'relative';

    this.unregisterSurface = dragController.registerSurface(this);
    this.unsubscribeDrag = dragController.subscribe((event) => {
      if (event === 'begin') {
        const session = dragController.getSession();
        if (session) this.renderIndicators(session.items[0]!.level);
      } else if (event === 'end') {
        this.removeIndicators();
        this.dragOriginatedHere = false;
        this.detachDragListeners();
        // Re-evaluate cursor based on current modifier state.
        this.applyPickupClass();
      }
    });

    document.addEventListener('keydown', this.boundOnKey);
    document.addEventListener('keyup', this.boundOnKey);
    window.addEventListener('blur', this.boundOnBlur);
    hostEl.addEventListener('pointermove', this.boundOnHostMove);
    hostEl.addEventListener('pointerdown', this.boundOnHostDown);
  }

  detach(): void {
    if (this.unregisterSurface) {
      this.unregisterSurface();
      this.unregisterSurface = null;
    }
    if (this.unsubscribeDrag) {
      this.unsubscribeDrag();
      this.unsubscribeDrag = null;
    }
    document.removeEventListener('keydown', this.boundOnKey);
    document.removeEventListener('keyup', this.boundOnKey);
    window.removeEventListener('blur', this.boundOnBlur);
    if (this.host) {
      this.host.removeEventListener('pointermove', this.boundOnHostMove);
      this.host.removeEventListener('pointerdown', this.boundOnHostDown);
      this.host.classList.remove('pmd-editor-pickup-mode');
      this.host.classList.remove('pmd-editor-dragging-mode');
    }
    this.detachDragListeners();
    this.removeIndicators();
    this.removeHighlight();
    this.hovered = null;
    this.pickupModifierHeld = false;
    this.dragOriginatedHere = false;
    this.view = null;
    this.host = null;
  }

  // ---- DragSurface implementation ----

  hitTest(clientX: number, clientY: number): { el: HTMLElement; insertPos: number; dy: number } | null {
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

    const session = dragController.getSession();
    let best: IndicatorRecord | null = null;
    let bestDy = Infinity;
    for (const r of this.indicators) {
      if (session) {
        const onSelf = session.items.some(
          (it) => r.insertPos > it.from && r.insertPos < it.to,
        );
        if (onSelf) continue;
      }
      const rect = r.el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dy = Math.abs(clientY - centerY);
      if (dy < bestDy) {
        bestDy = dy;
        best = r;
      }
    }
    if (!best || bestDy > 32) return null;
    return { el: best.el, insertPos: best.insertPos, dy: bestDy };
  }

  highlight(el: HTMLElement | null): void {
    for (const r of this.indicators) {
      r.el.classList.toggle('pmd-editor-drop-indicator-active', r.el === el);
    }
  }

  // ---- Indicator rendering (drop targets) ----

  private renderIndicators(draggedLevel: number): void {
    this.removeIndicators();
    if (!this.view || !this.host) return;
    const view = this.view;
    const host = this.host;
    const hostRect = host.getBoundingClientRect();

    const seen = new Set<number>();
    const place = (insertPos: number, anchorY: number): void => {
      if (seen.has(insertPos)) return;
      seen.add(insertPos);
      const indicator = document.createElement('div');
      indicator.className = 'pmd-editor-drop-indicator';
      indicator.style.top = `${anchorY - hostRect.top + host.scrollTop}px`;
      host.appendChild(indicator);
      this.indicators.push({ el: indicator, insertPos });
    };

    for (const entry of collectHeadings(view.state.doc)) {
      if (entry.level > draggedLevel) continue;
      const range = computeHeadingRange(view.state.doc, entry);
      if (!range) continue;
      try {
        const coords = view.coordsAtPos(range.from);
        place(range.from, coords.top);
      } catch {
        /* skip */
      }
    }

    const docEnd = view.state.doc.content.size;
    try {
      const endCoords = view.coordsAtPos(docEnd);
      place(docEnd, endCoords.bottom);
    } catch {
      /* skip */
    }
  }

  private removeIndicators(): void {
    for (const r of this.indicators) r.el.remove();
    this.indicators = [];
  }

  // ---- Modifier-pickup mode ----

  private onKey(e: KeyboardEvent): void {
    const nowHeld = this.isPickupModifierEvent(e);
    if (nowHeld === this.pickupModifierHeld) return;
    this.pickupModifierHeld = nowHeld;
    if (!nowHeld) {
      this.removeHighlight();
      this.hovered = null;
      // Modifier released mid-drag → cancel the drag.
      if (dragController.isActive() && this.dragOriginatedHere) {
        dragController.cancel();
      }
    }
    this.applyPickupClass();
  }

  private isPickupModifierEvent(e: KeyboardEvent): boolean {
    return e.shiftKey && e.altKey && (e.ctrlKey || e.metaKey);
  }

  private onBlur(): void {
    if (!this.pickupModifierHeld) return;
    this.pickupModifierHeld = false;
    this.removeHighlight();
    this.hovered = null;
    if (dragController.isActive() && this.dragOriginatedHere) {
      dragController.cancel();
    }
    this.applyPickupClass();
  }

  private applyPickupClass(): void {
    if (!this.host) return;
    const inPickup = this.pickupModifierHeld && !dragController.isActive();
    this.host.classList.toggle('pmd-editor-pickup-mode', inPickup);
    this.host.classList.toggle(
      'pmd-editor-dragging-mode',
      dragController.isActive() && this.dragOriginatedHere,
    );
  }

  private onHostPointerMove(e: PointerEvent): void {
    if (dragController.isActive()) return; // drag handlers take over
    if (!this.pickupModifierHeld) return;

    const container = this.findContainerAt(e.clientX, e.clientY);
    if (!container) {
      this.removeHighlight();
      this.hovered = null;
      return;
    }
    if (
      this.hovered &&
      this.hovered.from === container.from &&
      this.hovered.to === container.to
    ) {
      return; // unchanged
    }
    this.hovered = container;
    this.showHighlight(container.from, container.to);
  }

  private onHostPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!this.pickupModifierHeld) return;
    if (dragController.isActive()) return;
    if (!this.hovered || !this.view) return;

    e.preventDefault();
    e.stopPropagation();

    const item: DragItem = {
      from: this.hovered.from,
      to: this.hovered.to,
      id: null,
      type: this.hovered.type,
      level: this.hovered.level,
      label: this.hovered.label,
    };

    this.dragOriginatedHere = true;
    this.removeHighlight();
    this.hovered = null;

    dragController.begin({ view: this.view, items: [item] });
    this.applyPickupClass();
    this.attachDragListeners();
    this.createPickupPill(item);
    this.updatePickupPill(e.clientX, e.clientY);
    dragController.dispatchHit(e.clientX, e.clientY);
  }

  // ---- Drag listeners while a text→nav drag is active ----

  private attachDragListeners(): void {
    if (this.editorPointerMoveAttached) return;
    document.addEventListener('pointermove', this.boundOnDocMove);
    document.addEventListener('pointerup', this.boundOnDocUp);
    this.editorPointerMoveAttached = true;
  }

  private detachDragListeners(): void {
    if (!this.editorPointerMoveAttached) return;
    document.removeEventListener('pointermove', this.boundOnDocMove);
    document.removeEventListener('pointerup', this.boundOnDocUp);
    this.editorPointerMoveAttached = false;
    this.removePickupPill();
  }

  private onDocPointerMoveDuringDrag(e: PointerEvent): void {
    if (!dragController.isActive()) return;
    dragController.setPointer(e.clientX, e.clientY);
    this.updatePickupPill(e.clientX, e.clientY);
    dragController.dispatchHit(e.clientX, e.clientY);
    this.maybeAutoScroll(e.clientY);
  }

  private onDocPointerUpDuringDrag(_e: PointerEvent): void {
    if (!dragController.isActive()) return;
    dragController.commit();
    // The 'end' subscriber detaches drag listeners and clears state.
  }

  private maybeAutoScroll(clientY: number): void {
    if (!this.host) return;
    const margin = 30;
    const rect = this.host.getBoundingClientRect();
    if (clientY < rect.top + margin) this.host.scrollBy({ top: -10 });
    else if (clientY > rect.bottom - margin) this.host.scrollBy({ top: 10 });
  }

  // ---- Container detection ----

  private findContainerAt(clientX: number, clientY: number): HoveredContainer | null {
    if (!this.view) return null;
    let posInfo: { pos: number; inside: number } | null = null;
    try {
      posInfo = this.view.posAtCoords({ left: clientX, top: clientY });
    } catch {
      return null;
    }
    if (!posInfo) return null;

    const doc = this.view.state.doc;
    const $pos = doc.resolve(Math.min(posInfo.pos, doc.content.size));

    // Walk depths from inner to outer; return the smallest recognized
    // container — a card, an analytic_unit, or a heading paragraph.
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth);
      const t = node.type.name;

      if (t === 'card' || t === 'analytic_unit') {
        const from = $pos.before(depth);
        return {
          from,
          to: from + node.nodeSize,
          type: t,
          level: 4,
          label: this.firstHeadingText(node),
        };
      }

      if (t === 'pocket' || t === 'hat' || t === 'block') {
        const from = $pos.before(depth);
        const targetLevel = TYPE_TO_LEVEL[t]!;
        let to = doc.content.size;
        doc.nodesBetween(from + node.nodeSize, doc.content.size, (n, p) => {
          if (to !== doc.content.size) return false;
          const nt = n.type.name;
          if (nt in TYPE_TO_LEVEL && TYPE_TO_LEVEL[nt]! <= targetLevel) {
            to = p;
            return false;
          }
          return true;
        });
        return {
          from,
          to,
          type: t,
          level: targetLevel,
          label: node.textContent,
        };
      }
    }
    return null;
  }

  private firstHeadingText(node: import('prosemirror-model').Node): string {
    // For card/analytic_unit, the first child is the head (tag/analytic).
    const head = node.firstChild;
    return head ? head.textContent : '';
  }

  // ---- Highlight overlay ----

  private showHighlight(from: number, to: number): void {
    this.removeHighlight();
    if (!this.view || !this.host) return;
    try {
      const fromCoords = this.view.coordsAtPos(from);
      const toCoords = this.view.coordsAtPos(Math.max(from, to - 1));
      const hostRect = this.host.getBoundingClientRect();
      const top = fromCoords.top - hostRect.top + this.host.scrollTop;
      const bottom = toCoords.bottom - hostRect.top + this.host.scrollTop;
      const box = document.createElement('div');
      box.className = 'pmd-editor-pickup-highlight';
      box.style.top = `${top}px`;
      box.style.height = `${Math.max(2, bottom - top)}px`;
      this.host.appendChild(box);
      this.highlightBox = box;
    } catch {
      /* skip — coordsAtPos can throw mid-update */
    }
  }

  private removeHighlight(): void {
    if (this.highlightBox) {
      this.highlightBox.remove();
      this.highlightBox = null;
    }
  }

  // ---- Pickup pill (text-side drags get their own pill) ----

  private pickupPill: HTMLElement | null = null;

  private createPickupPill(item: DragItem): void {
    this.removePickupPill();
    const pill = document.createElement('div');
    pill.className = 'pmd-nav-pickup-pill';
    const label = item.label.trim() || `(empty ${item.type})`;
    pill.textContent = label.length > 40 ? label.slice(0, 38) + '…' : label;
    document.body.appendChild(pill);
    this.pickupPill = pill;
  }

  private updatePickupPill(x: number, y: number): void {
    if (!this.pickupPill) return;
    this.pickupPill.style.left = `${x + 12}px`;
    this.pickupPill.style.top = `${y + 12}px`;
  }

  private removePickupPill(): void {
    if (this.pickupPill) {
      this.pickupPill.remove();
      this.pickupPill = null;
    }
  }
}

/**
 * Workspace-wide singleton.
 */
export const editorDragSurface = new EditorDragSurface();
