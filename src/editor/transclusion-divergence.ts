/**
 * Live-zone DIVERGENCE detection (Feature 2).
 *
 * A live zone caches a snapshot of a section from another file. Separately from
 * whether the user has locally EDITED that snapshot (`isZoneEdited`), the SOURCE
 * itself may have moved on since it was pulled. This module answers "has the
 * source diverged from what this zone last pulled?" by re-reading the source and
 * comparing id-independent content shapes:
 *
 *   diverged  ⟺  shape(source now)  ≠  the zone's reference shape
 *
 * where the reference shape is the zone's stored `source_shape_hash` (or, for
 * zones predating that attr, the mirror's own shape when unedited — see
 * `zoneReferenceShape`). Both sides are hashed the SAME way the content was
 * originally prepared (nested zones flattened, ids ignored), so a match is exact
 * and an id-only reshuffle never reads as divergence.
 *
 * This is a read-only, advisory signal — it never writes the doc. The result
 * drives a badge on the zone glyph; the fix is the existing manual Refresh.
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import {
  isTransclusionNode,
  idIndependentHash,
  zoneReferenceShape,
  zoneIdentity,
  flattenZones,
  type SourceRefBase,
} from './transclusion.js';
import { SELF_SOURCE_REF } from './intra-transclusion.js';
import { resolveTransclusion } from './transclusion-resolve.js';
import { getViewDocPath } from './transclusion-doc-path.js';

/** A cross-file live zone whose source we can meaningfully re-check: a real
 *  transclusion, not an intra-doc self-zone, with a source ref to read. */
export function isInterDocZone(node: PMNode): boolean {
  if (!isTransclusionNode(node)) return false;
  const ref = String(node.attrs['source_ref'] ?? '');
  return ref !== '' && ref !== SELF_SOURCE_REF;
}

/** The id-independent shape of a freshly-read source section, comparable to a
 *  zone's stored `source_shape_hash`. Flattens nested zones exactly as
 *  `prepareZoneContent` did at pull time so the two are directly comparable. */
export function sourceShapeNow(sourceContent: Fragment): string {
  return idIndependentHash(flattenZones(sourceContent));
}

/** Whether `sourceContent` (a fresh read of the zone's source) differs from what
 *  the zone last pulled. False when the reference shape is unknown (an edited
 *  zone created before `source_shape_hash` existed) — we don't guess. */
export function zoneDiverged(node: PMNode, sourceContent: Fragment): boolean {
  const ref = zoneReferenceShape(node);
  if (ref === null) return false;
  return sourceShapeNow(sourceContent) !== ref;
}

/** A zone snapshot captured before the async source reads (positions may shift
 *  during the awaits, so we key results by the stable `zoneIdentity`). */
interface ZoneSnapshot {
  identity: string;
  node: PMNode;
}

export interface DivergenceCheckResult {
  /** Identities of zones whose source has diverged from their cached snapshot. */
  diverged: Set<string>;
  /** How many inter-doc zones were actually read (source reachable). */
  checked: number;
}

/**
 * Read every inter-doc zone's source and return the set of diverged zone
 * identities. Read-only: reads sources off disk (desktop only — on web every
 * read fails and nothing is flagged) but never touches the document. Sources
 * that can't be read (missing/emptied/unparseable) are left UNflagged rather
 * than reported as diverged — that's the job of the existing transient status.
 */
export async function checkAllZoneDivergence(view: EditorView): Promise<DivergenceCheckResult> {
  const docPath = getViewDocPath(view);
  const snapshots: ZoneSnapshot[] = [];
  view.state.doc.descendants((node) => {
    if (!isTransclusionNode(node)) return true;
    if (isInterDocZone(node)) snapshots.push({ identity: zoneIdentity(node), node });
    return false; // zones never nest — don't descend into one
  });

  const diverged = new Set<string>();
  let checked = 0;
  for (const { identity, node } of snapshots) {
    const outcome = await resolveTransclusion(
      docPath,
      String(node.attrs['source_ref'] ?? ''),
      node.attrs['source_ref_base'] === 'root' ? 'root' : ('doc' as SourceRefBase),
      String(node.attrs['source_heading_id'] ?? ''),
      String(node.attrs['source_abs'] ?? ''),
    );
    if (!outcome.ok || !outcome.result || outcome.result.content.size === 0) continue;
    checked++;
    if (zoneDiverged(node, outcome.result.content)) diverged.add(identity);
  }
  return { diverged, checked };
}
