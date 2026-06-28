/**
 * Load-time document migrations.
 *
 * These run on `parseNative` (see `native/index.ts`) right after a doc is
 * deserialized, so older `.cmir` files are repaired in place before they reach
 * the editor. Each migration is a pure `doc -> doc` walk that returns the same
 * node when nothing changed (so callers can skip a no-op dispatch).
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { schema } from './index.js';

/**
 * Split any `analytic` that sits INSIDE a card out into its own trailing
 * `analytic_unit`.
 *
 * `analytic` used to be legal card content (the "cite-slot" alternative). It no
 * longer is — an analytic anchors its own `analytic_unit` — so older docs (and
 * `.docx` imports that put an Analytic paragraph under a tag) can contain
 * `card[ tag, …, analytic, … ]`, which is now schema-invalid. This rewrites such
 * a card the same way pasting an analytic into a card does: the tag and the
 * children BEFORE the first analytic stay in the card; each analytic becomes the
 * head of a new `analytic_unit` that absorbs the children that follow it, up to
 * the next analytic. Several in-card analytics yield several units.
 *
 *   card[ tag, body, analytic A1, body, cite, analytic A2, body ]
 *     ->
 *   card[ tag, body ]
 *   analytic_unit[ analytic A1, body, cite ]
 *   analytic_unit[ analytic A2, body ]
 *
 * All card-content types (`card_body`/`undertag`/`cite_paragraph`/`table`) are
 * also valid `analytic_unit` content, so the absorbed children pass through
 * unchanged. Heading ids (tag + analytics) are preserved.
 *
 * Cards live only at the doc root, so a doc-level walk suffices.
 */
export function splitInCardAnalytics(doc: PMNode): PMNode {
  let changed = false;
  const out: PMNode[] = [];
  doc.forEach((child) => {
    if (child.type.name === 'card' && cardHasAnalytic(child)) {
      changed = true;
      out.push(...splitCardOnAnalytics(child));
    } else {
      out.push(child);
    }
  });
  if (!changed) return doc;
  return doc.type.create(doc.attrs, Fragment.fromArray(out), doc.marks);
}

function cardHasAnalytic(card: PMNode): boolean {
  let found = false;
  card.forEach((c) => {
    if (c.type.name === 'analytic') found = true;
  });
  return found;
}

function splitCardOnAnalytics(card: PMNode): PMNode[] {
  const kids: PMNode[] = [];
  card.forEach((c) => kids.push(c));

  const result: PMNode[] = [];
  let i = 0;

  // Children before the first analytic (the tag is always first) stay in the
  // card — all are still valid card content.
  const cardChildren: PMNode[] = [];
  while (i < kids.length && kids[i]!.type.name !== 'analytic') {
    cardChildren.push(kids[i]!);
    i++;
  }
  result.push(card.type.create(card.attrs, Fragment.fromArray(cardChildren), card.marks));

  // Each analytic heads a new unit, absorbing the children that follow it up to
  // the next analytic (or the end of the card).
  while (i < kids.length) {
    const unitChildren: PMNode[] = [kids[i]!]; // the analytic head
    i++;
    while (i < kids.length && kids[i]!.type.name !== 'analytic') {
      unitChildren.push(kids[i]!);
      i++;
    }
    result.push(
      schema.nodes['analytic_unit']!.create(null, Fragment.fromArray(unitChildren)),
    );
  }

  return result;
}
