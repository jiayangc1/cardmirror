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
      const stepMap = tr.steps[i]!.getMap();
      // Each step's `newFrom`/`newTo` are valid in the doc state
      // AFTER applying step `i`, NOT in the final state. For a
      // single-step typing tr that's the same thing — but for a
      // multi-step tr (send-to-speech, an undo / redo of one,
      // anything that splits structurally and inserts), the
      // intermediate ranges can extend past the final doc's
      // bounds. Map each step's range through subsequent step
      // maps so the result lands in the final state's
      // coordinates; otherwise callers like
      // `cite-classifier-plugin`'s `nodesBetween` walk off the
      // end of the doc and throw "Cannot read properties of
      // undefined (reading 'nodeSize')".
      const subMapping = tr.mapping.slice(i + 1);
      stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        const mappedFrom = subMapping.map(newFrom, -1);
        const mappedTo = subMapping.map(newTo, 1);
        if (mappedFrom < from) from = mappedFrom;
        if (mappedTo > to) to = mappedTo;
      });
    }
  }
  if (from === Infinity) return null;
  return { from, to };
}
