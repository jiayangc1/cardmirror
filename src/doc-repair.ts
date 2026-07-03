/**
 * Deterministic document repair for structural states ProseMirror never
 * produces locally but external content can: DOCX imports with irregular
 * tables, and merged documents from a sync layer. Pure function of the
 * doc — identical input yields identical repairs everywhere, and the
 * pass is idempotent (a repaired doc yields no further repair).
 *
 * Three passes, in order:
 *   1. prosemirror-tables `fixTables` — pads ragged rows and clamps
 *      colspan overflow so every row spans the same width.
 *   2. `excludes` sweep — text carrying both members of a mutually
 *      exclusive mark pair keeps the earlier-declared mark and drops the
 *      later one. ProseMirror enforces `excludes` in `Mark.addToSet`
 *      (local editing) but not on node construction, so externally built
 *      content can carry both.
 *   3. Container first-child invariant — a `card` must open with `tag`,
 *      an `analytic_unit` with `analytic` (their content expressions
 *      require it, but `NodeType.create` does not validate); an empty
 *      heading is inserted when missing. Heading `id` stamping is left
 *      to `stampMissingHeadingIds` at load: ids are random, and this
 *      pass must stay deterministic.
 */
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { fixTables } from 'prosemirror-tables';
import { schema } from './schema/index.js';

/** [keep, drop] — drop is the later-declared mark of each `excludes`
 *  pair, so the sweep is deterministic under any input order. */
const EXCLUDE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['cite_mark', 'underline_mark'],
  ['cite_mark', 'emphasis_mark'],
  ['underline_mark', 'emphasis_mark'],
  ['bold', 'bold_off'],
  ['superscript', 'subscript'],
];

/** Build the repair transaction for `state`, or null when nothing needs
 *  repair. */
export function buildDocRepairTr(state: EditorState): Transaction | null {
  const tr = fixTables(state) ?? state.tr;

  // Mark sweep scans tr.doc so positions reflect any table fixes above;
  // removeMark never shifts positions, so one scan can batch all fixes.
  tr.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const names = new Set(node.marks.map((m) => m.type.name));
    for (const [keep, drop] of EXCLUDE_PAIRS) {
      if (names.has(keep) && names.has(drop)) {
        tr.removeMark(pos, pos + node.nodeSize, schema.marks[drop]!);
      }
    }
    return true;
  });

  // Insertions shift positions, so collect first and apply bottom-up.
  const inserts: Array<{ pos: number; type: 'tag' | 'analytic' }> = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'card' && node.firstChild?.type.name !== 'tag') {
      inserts.push({ pos: pos + 1, type: 'tag' });
    }
    if (node.type.name === 'analytic_unit' && node.firstChild?.type.name !== 'analytic') {
      inserts.push({ pos: pos + 1, type: 'analytic' });
    }
    return true;
  });
  inserts.sort((a, b) => b.pos - a.pos);
  for (const ins of inserts) {
    tr.insert(ins.pos, schema.nodes[ins.type]!.create());
  }

  return tr.steps.length ? tr : null;
}

/** Repair a standalone doc (no editor state), returning the repaired doc
 *  — or the same node when nothing needed repair. */
export function repairDoc(doc: PMNode): PMNode {
  const tr = buildDocRepairTr(EditorState.create({ doc }));
  return tr ? tr.doc : doc;
}
