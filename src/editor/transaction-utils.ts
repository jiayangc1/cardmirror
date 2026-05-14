/**
 * Small helpers shared across plugins that need to scope their work
 * to the regions of the doc that actually moved in the current
 * dispatch. Walking the full doc on every transaction is the
 * dominant per-keystroke cost in large workspaces; restricting to
 * `tr.steps`' mapped ranges keeps editing O(1) regardless of doc
 * size for the common typing case.
 */

import type { Transaction } from 'prosemirror-state';

/**
 * Union of every step's mapped range in the new doc, across the
 * given transactions. Returns `null` when none of the transactions
 * changed the doc.
 *
 * Each `Step.getMap().forEach` callback yields `(oldFrom, oldTo,
 * newFrom, newTo)`; we collect the new-side bounds because the
 * walk happens against the post-state doc.
 */
export function changedRange(
  transactions: readonly Transaction[],
): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  for (const tr of transactions) {
    if (!tr.docChanged) continue;
    for (let i = 0; i < tr.steps.length; i++) {
      tr.steps[i]!.getMap().forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        if (newFrom < from) from = newFrom;
        if (newTo > to) to = newTo;
      });
    }
  }
  if (from === Infinity) return null;
  return { from, to };
}
