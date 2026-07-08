/**
 * PROTOTYPE — intra-document transclusion, the view layer (Branch C).
 *
 * A debounced, bidirectional reconcile between a self-zone and its source
 * section in the SAME doc. At a quiet moment `syncSelfZones` compares three
 * id-independent snapshots per zone — the content at last sync (baseline), the
 * source now, the mirror now — and:
 *   - only the source moved → push it into the mirror
 *   - only the mirror moved → push it back into the source section
 *   - both moved, non-overlapping → block-level diff3 auto-merge into both
 *   - both moved, overlapping → a true conflict → the caller prompts
 * Writes re-stamp heading ids fresh so the source and mirror never collide.
 *
 * Baseline is kept in-memory keyed by a per-zone instance id (stashed in the
 * unused `source_abs` attr). On first encounter it seeds to the mirror, so on a
 * cold load the SOURCE wins any not-yet-synced divergence. (Prototype scope:
 * baseline isn't persisted, and a section that itself contains nested live
 * zones isn't handled — assume plain card content.)
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { newHeadingId } from '../schema/index.js';
import { collectHeadings, computeHeadingRange } from './headings.js';
import { contentHash } from './transclusion.js';
import { insertZoneAtSelection } from './transclusion-actions.js';
import { showConfirm } from './confirm-dialog.js';
import {
  SELF_SOURCE_REF,
  isSelfZone,
  resolveSelfSection,
  decideSync,
  syncKey,
  mergeSections,
} from './intra-transclusion.js';
import { settings } from './settings.js';

const INTRA_SYNC_META = 'pmdIntraSync';
export const intraTransclusionKey = new PluginKey('intraTransclusion');

/** PROTOTYPE gate. The debounced sync plugin is always registered (inert
 *  without a self-zone in the doc), but the CREATE command — the only thing
 *  that mints a self-zone — is gated behind this flag. Flip to `false` to hide
 *  the feature entirely; a self-zone already in a doc still syncs. */
export const INTRA_TRANSCLUSION_ENABLED = true;

/** Per-zone baseline (content at last sync), id-independent by construction.
 *  Keyed by the zone's instance id (its `source_abs`). Prototype: in-memory. */
const baselineStore = new Map<string, Fragment>();

/** Test-only: drop all in-memory baselines (the store is module-global). */
export function __clearIntraBaselines(): void {
  baselineStore.clear();
}

/** Re-stamp every heading id in a fragment to a fresh unique one, preserving
 *  structure (unlike prepareZoneContent, this does NOT flatten nested zones —
 *  it's used writing back to a real doc section). */
function restampIds(frag: Fragment): Fragment {
  const out: PMNode[] = [];
  frag.forEach((node) => {
    const inner = node.content.size ? restampIds(node.content) : node.content;
    const attrs = 'id' in node.attrs ? { ...node.attrs, id: newHeadingId() } : node.attrs;
    out.push(
      attrs !== node.attrs || inner !== node.content
        ? node.type.create(attrs, inner, node.marks)
        : node,
    );
  });
  return Fragment.fromArray(out);
}

/** [from, to] of a heading's section CONTENT — the same span extractSection
 *  pulls, so replacing it swaps the section's body in place. */
function sectionRange(doc: PMNode, headingId: string): { from: number; to: number } | null {
  const entry = collectHeadings(doc, { skipCite: true }).find((h) => h.id === headingId);
  if (!entry) return null;
  const range = computeHeadingRange(doc, entry);
  if (!range) return null;
  let from = range.from;
  if (entry.type !== 'tag' && entry.type !== 'analytic') {
    const node = doc.nodeAt(entry.pos);
    if (!node) return null;
    from = entry.pos + node.nodeSize; // drop the header line for grouping headings
  }
  return from <= range.to ? { from, to: range.to } : null;
}

interface Edit {
  from: number;
  to: number;
  content: Fragment;
}

/** One reconcile pass over every self-zone. Applies all non-conflicting syncs
 *  in a single transaction; returns the zones left in conflict for the caller
 *  to resolve. Safe to call repeatedly (a synced zone reads as in-sync). */
export function syncSelfZones(view: EditorView): { conflicts: { pos: number; node: PMNode }[] } {
  const doc = view.state.doc;
  const edits: Edit[] = [];
  const baselineUpdates: { id: string; frag: Fragment }[] = [];
  const conflicts: { pos: number; node: PMNode }[] = [];

  doc.forEach((node, offset) => {
    if (!isSelfZone(node)) return;
    const headingId = String(node.attrs['source_heading_id'] ?? '');
    const instanceId = String(node.attrs['source_abs'] ?? '');
    const source = resolveSelfSection(doc, headingId);
    if (!source) return; // source heading gone — leave the cached mirror as-is
    const mirror = node.content;
    let baseline = baselineStore.get(instanceId);
    if (!baseline) {
      baseline = mirror; // seed → source wins a cold-load divergence
      baselineStore.set(instanceId, mirror);
    }
    const dir = decideSync(syncKey(baseline), syncKey(source), syncKey(mirror));
    const zoneInner = { from: offset + 1, to: offset + node.nodeSize - 1 };

    if (dir === 'in-sync') return;
    if (dir === 'push-source-to-mirror') {
      edits.push({ ...zoneInner, content: restampIds(source) });
      baselineUpdates.push({ id: instanceId, frag: source });
    } else if (dir === 'push-mirror-to-source') {
      const range = sectionRange(doc, headingId);
      if (!range) return;
      edits.push({ ...range, content: restampIds(mirror) });
      baselineUpdates.push({ id: instanceId, frag: mirror });
    } else {
      const merged = mergeSections(baseline, source, mirror);
      if (!merged.ok) {
        conflicts.push({ pos: offset, node });
        return;
      }
      const range = sectionRange(doc, headingId);
      if (!range) return;
      edits.push({ ...range, content: restampIds(merged.merged) });
      edits.push({ ...zoneInner, content: restampIds(merged.merged) });
      baselineUpdates.push({ id: instanceId, frag: merged.merged });
    }
  });

  if (edits.length) {
    const tr = view.state.tr;
    // Apply high position first so earlier ranges stay valid. Source sections and
    // their mirrors are disjoint regions (a self-zone inside its own source is a
    // cycle, banned at create), so descending order is safe.
    edits.sort((a, b) => b.from - a.from);
    for (const e of edits) tr.replaceWith(e.from, e.to, e.content);
    tr.setMeta(INTRA_SYNC_META, true);
    view.dispatch(tr);
    for (const u of baselineUpdates) baselineStore.set(u.id, u.frag);
  }
  return { conflicts };
}

/** Insert a self-zone at the cursor that mirrors the section under `headingId`
 *  in the current doc. Returns false if that heading has no content. */
export function insertSelfZone(view: EditorView, headingId: string): boolean {
  const doc = view.state.doc;
  const source = resolveSelfSection(doc, headingId);
  if (!source || source.size === 0) return false;
  const instanceId = newHeadingId();
  const content = restampIds(source);
  const entry = collectHeadings(doc, { skipCite: true }).find((h) => h.id === headingId);
  const label = entry?.text?.trim() || 'Section';
  const ok = insertZoneAtSelection(
    view,
    {
      source_ref: SELF_SOURCE_REF,
      source_ref_base: 'doc',
      source_heading_id: headingId,
      source_abs: instanceId,
      source_content_hash: contentHash(content),
      last_refreshed: Date.now(),
      source_label: `↳ ${label}`,
    },
    content,
  );
  if (ok) baselineStore.set(instanceId, source);
  return ok;
}

/** PROTOTYPE create entry: a minimal floating list of THIS doc's headings.
 *  Picking one inserts a self-zone at the cursor mirroring that section. Skips
 *  empty headings, headings already inside a live zone, and the section the
 *  cursor sits in (that would be a cycle). Self-contained (inline styles). */
export function openSelfZonePicker(view: EditorView): void {
  const doc = view.state.doc;
  const cursor = view.state.selection.from;
  const options = collectHeadings(doc, { skipCite: true }).filter((h) => {
    if (!h.id || h.zonePos !== null || !h.text.trim()) return false;
    const section = resolveSelfSection(doc, h.id);
    if (!section || section.size === 0) return false;
    const range = sectionRange(doc, h.id); // cycle guard — cursor inside the source
    if (range && cursor >= range.from && cursor <= range.to) return false;
    return true;
  });

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,0.28)';
  const box = document.createElement('div');
  box.style.cssText =
    'min-width:280px;max-width:min(460px,90vw);max-height:70vh;overflow:auto;' +
    'background:var(--pmd-color-surface,#fff);color:var(--pmd-color-text,#111);' +
    'border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.35);padding:10px 0';
  const title = document.createElement('div');
  title.textContent = 'Transclude a section of this document';
  title.style.cssText = 'padding:6px 16px 8px;font-weight:600;font-size:13px;opacity:0.8';
  box.appendChild(title);

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!options.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No eligible sections to transclude here.';
    empty.style.cssText = 'padding:8px 16px;opacity:0.7;font-size:13px';
    box.appendChild(empty);
  }
  for (const h of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = h.text.trim();
    btn.style.cssText =
      `display:block;width:100%;text-align:left;border:0;background:none;cursor:pointer;` +
      `font:inherit;color:inherit;padding:6px 16px 6px ${16 + Math.max(0, h.level - 1) * 14}px`;
    btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(127,127,127,0.14)'));
    btn.addEventListener('mouseleave', () => (btn.style.background = 'none'));
    btn.addEventListener('click', () => {
      close();
      insertSelfZone(view, h.id!);
      view.focus();
    });
    box.appendChild(btn);
  }

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey, true);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/** Resolve a conflicted self-zone by taking one side wholesale (the diff3
 *  fallback). Writes the winning content into BOTH the source section and the
 *  mirror, re-stamped, and re-baselines to it. */
export function resolveSelfConflict(
  view: EditorView,
  headingId: string,
  instanceId: string,
  winner: 'source' | 'mirror',
): void {
  const doc = view.state.doc;
  let zonePos = -1;
  let zoneNode: PMNode | null = null;
  doc.forEach((n, off) => {
    if (zonePos < 0 && isSelfZone(n) && String(n.attrs['source_abs'] ?? '') === instanceId) {
      zonePos = off;
      zoneNode = n;
    }
  });
  if (!zoneNode) return;
  const source = resolveSelfSection(doc, headingId);
  const winning = winner === 'source' ? source : (zoneNode as PMNode).content;
  if (!winning) return;
  const range = sectionRange(doc, headingId);
  const edits: Edit[] = [
    { from: zonePos + 1, to: zonePos + (zoneNode as PMNode).nodeSize - 1, content: restampIds(winning) },
  ];
  if (range) edits.push({ ...range, content: restampIds(winning) });
  const tr = view.state.tr;
  edits.sort((a, b) => b.from - a.from);
  for (const e of edits) tr.replaceWith(e.from, e.to, e.content);
  tr.setMeta(INTRA_SYNC_META, true);
  view.dispatch(tr);
  baselineStore.set(instanceId, winning);
}

/** Default conflict handler: prompt per conflicted zone (source-wins vs
 *  keep-my-edits) and apply — the "fall back to the existing prompt". */
async function promptAndResolve(
  view: EditorView,
  zones: { pos: number; node: PMNode }[],
): Promise<void> {
  for (const { node } of zones) {
    const headingId = String(node.attrs['source_heading_id'] ?? '');
    const instanceId = String(node.attrs['source_abs'] ?? '');
    const useSource = await showConfirm({
      title: 'Transclusion conflict',
      message:
        'This transcluded section and its source were both edited in ways that overlap. ' +
        'Keep the source version, or keep your edits here?',
      confirmLabel: 'Use source',
      cancelLabel: 'Keep my edits',
    });
    resolveSelfConflict(view, headingId, instanceId, useSource ? 'source' : 'mirror');
  }
}

/** The debounced sync plugin. Prototype: a fixed debounce, gated off in read
 *  mode; conflicts fall back to a per-zone confirm. */
const DEBOUNCE_MS = 600;

export function makeIntraTransclusionPlugin(
  onConflict: (view: EditorView, zones: { pos: number; node: PMNode }[]) => void = (view, zones) =>
    void promptAndResolve(view, zones),
): Plugin {
  return new Plugin({
    key: intraTransclusionKey,
    view(editorView) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const schedule = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (settings.get('readMode')) return; // never sync in read mode
          const { conflicts } = syncSelfZones(editorView);
          if (conflicts.length) onConflict(editorView, conflicts);
        }, DEBOUNCE_MS);
      };
      return {
        // A sync is idempotent (id-independent keys + baseline update), so its own
        // edit just produces one no-op pass — no loop guard needed.
        update(view, prevState) {
          if (!view.state.doc.eq(prevState.doc)) schedule();
        },
        destroy() {
          if (timer) clearTimeout(timer);
        },
      };
    },
  });
}
