/**
 * Auto-numbering render pass (NUMBERING_PLAN.md §6) — PROTOTYPE.
 *
 * Draws the computed numbers as read-only widget decorations at the start of each
 * numbered card's tag. Numbers are never stored (see `numbering.ts`): the whole
 * set is recomputed from the skeleton whenever the doc changes. Display auto-shows
 * — a card with no role is simply absent from the set, so an un-numbered doc draws
 * nothing (matching "authoring auto-enables display": set a role, numbers appear).
 *
 * Prototype scope: format is fixed (`1.` / `a)`); a per-user format/on-off setting,
 * the cv:auto-safe custom-property mechanism, and the transclusion-window pass
 * (§7) are follow-ups. Full recompute on every docChanged is fine at this size
 * (numbering is inherently non-local); make it incremental later if it bites.
 */

import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { computeNumbering, type NumberLabel } from './numbering.js';

/** Prototype glyph format: number → "1.", sub → "a)". */
function glyphText(label: NumberLabel): string {
  return label.kind === 'number' ? `${label.text}.` : `${label.text})`;
}

function makeGlyph(label: NumberLabel): HTMLElement {
  const span = document.createElement('span');
  span.className = 'pmd-card-number';
  if (label.kind === 'sub') span.classList.add('pmd-card-number-sub');
  span.textContent = glyphText(label);
  // Chrome, not content: never editable, never a selection/caret target.
  span.setAttribute('contenteditable', 'false');
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function build(doc: PMNode): DecorationSet {
  const map = computeNumbering(doc);
  if (map.size === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const [cardPos, label] of map) {
    // card at cardPos → its `tag`/`analytic` heading at +1 → the heading's inline
    // content starts at +2. Sit the number at the very start of that line.
    const at = cardPos + 2;
    if (at > doc.content.size) continue;
    decos.push(
      Decoration.widget(at, () => makeGlyph(label), {
        side: -1,
        key: `cnum:${cardPos}:${label.kind}:${label.text}`,
        ignoreSelection: true,
      }),
    );
  }
  return DecorationSet.create(doc, decos);
}

export const cardNumberingPlugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
  state: {
    init: (_config, { doc }) => build(doc),
    apply: (tr, prev) => (tr.docChanged ? build(tr.doc) : prev),
  },
  props: {
    decorations(state) {
      return cardNumberingPlugin.getState(state);
    },
  },
});
