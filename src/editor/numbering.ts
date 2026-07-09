/**
 * Auto-numbering — the positional compute pass (NUMBERING_PLAN.md §2).
 *
 * Numbering is DISPLAY-ONLY: no number glyph is ever stored, only the authorial
 * skeleton (per-card `numRole` + `numRestart`, per-block `numRestart`). This
 * module derives the rendered numbers from that skeleton positionally — the one
 * source of truth both the on-screen render and (eventually) the `.docx`
 * `numId`/`ilvl` emit read from.
 *
 * Counting semantics (§2), two levels only:
 *   - NUMBER (role 'number'): counts `number` cards. CONTINUES across `none` and
 *     `sub` cards — a skip is a gap, it neither consumes a number nor breaks the
 *     run. Resets to 1 at any `restart` unit.
 *   - SUB (role 'sub'): subordinate to the number. Resets each time a `number`
 *     card advances the count (and at any `restart`), but is TRANSPARENT to
 *     skips — a `none` card never resets it. Renders as letters (a, b, c…).
 *   The only resets: a new NUMBER (resets sub) and a `restart` flag (resets
 *     both). Nothing else — a skip changes no counter.
 *
 * Scope boundaries reset both counters: a `block` (unless it's flagged to
 * CONTINUE, i.e. numRestart === false), and every higher heading (`pocket` /
 * `hat`, which always start a fresh scope). A card flagged `numRestart` restarts
 * the count at itself (before it is counted).
 *
 * NOT yet handled (follow-ups, see NUMBERING_PLAN §7): live views (`self_ref`)
 * don't yet flow their projected cards through the host count — they're treated
 * as transparent here. Linked copies (`transclusion_ref`) DO participate: their
 * real cards are counted in document order.
 */

import { type Node as PMNode } from 'prosemirror-model';

export type NumRole = 'none' | 'number' | 'sub';

export interface NumberLabel {
  /** Which counter produced this. */
  kind: 'number' | 'sub';
  /** 1-based ordinal within the current run. */
  value: number;
  /** Rendered glyph: `String(value)` for a number, letters for a sub. */
  text: string;
}

/** Lowercase bijective base-26: 1→a, 26→z, 27→aa, 28→ab … */
export function toLetters(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || 'a';
}

/** The card unit's stored role, defaulting to 'none' for anything unexpected. */
export function numRoleOf(node: PMNode): NumRole {
  const r = node.attrs['numRole'];
  return r === 'number' || r === 'sub' ? r : 'none';
}

/**
 * Compute the rendered label for every numbered card in the doc, keyed by the
 * card/analytic_unit's document position. Cards with role 'none' (the default)
 * are absent from the map. Positions are absolute (as from `Node.descendants`),
 * so a card inside a linked copy is keyed by its real position too.
 */
export function computeNumbering(doc: PMNode): Map<number, NumberLabel> {
  const out = new Map<number, NumberLabel>();
  let numCount = 0; // last NUMBER assigned in the current run
  let subCount = 0; // last SUB assigned under the current number

  const resetScope = (): void => {
    numCount = 0;
    subCount = 0;
  };

  doc.descendants((node, pos) => {
    switch (node.type.name) {
      case 'pocket':
      case 'hat':
        // A higher heading always starts a fresh numbering scope.
        resetScope();
        return false; // don't walk its inline text
      case 'block':
        // Blocks restart by default; a "continue" block (numRestart === false)
        // carries the running count across the heading.
        if (node.attrs['numRestart'] !== false) resetScope();
        return false;
      case 'card':
      case 'analytic_unit': {
        // A card flagged restart resets BOTH counters before it's counted.
        if (node.attrs['numRestart'] === true) resetScope();
        const role = numRoleOf(node);
        if (role === 'number') {
          numCount += 1;
          subCount = 0; // a new number resets its subs
          out.set(pos, { kind: 'number', value: numCount, text: String(numCount) });
        } else if (role === 'sub') {
          subCount += 1;
          out.set(pos, { kind: 'sub', value: subCount, text: toLetters(subCount) });
        }
        // role 'none': a transparent skip — no counter touched.
        return false; // a card's internals hold no numbered units
      }
      case 'transclusion_ref':
        // Linked copy: real cards live inside it — count them in document order.
        return true;
      case 'self_ref':
        // Live view: its projection isn't in the doc. Flowing it through the host
        // count is a follow-up (§7); treat it as transparent for now.
        return false;
      default:
        return true;
    }
  });

  return out;
}
