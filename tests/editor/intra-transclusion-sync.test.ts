// @vitest-environment jsdom
/**
 * Branch C in a real EditorView: create an intra-doc self-zone, then drive the
 * debounced reconcile directly (`syncSelfZones`) and assert the source section
 * and its mirror converge — source→mirror, mirror→source, non-overlapping
 * diff3 merge, and a true conflict left untouched for the prompt.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { SELF_SOURCE_REF } from '../../src/editor/intra-transclusion.js';
import { contentHash, createTransclusionNode, isTransclusionNode } from '../../src/editor/transclusion.js';
import { syncSelfZones, __clearIntraBaselines } from '../../src/editor/intra-transclusion-plugin.js';

beforeEach(() => __clearIntraBaselines());

const block = (text: string, id: string) => schema.nodes['block']!.create({ id }, schema.text(text));
function card(tag: string, body: string, id = newHeadingId()): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
function selfZone(headingId: string, instanceId: string, cards: PMNode[]): PMNode {
  const content = Fragment.fromArray(cards);
  return createTransclusionNode(
    schema,
    {
      source_ref: SELF_SOURCE_REF,
      source_ref_base: 'doc',
      source_heading_id: headingId,
      source_abs: instanceId,
      source_content_hash: contentHash(content),
      last_refreshed: 0,
      source_label: '↳ Src',
    },
    content,
  );
}
function makeView(children: PMNode[]): EditorView {
  const doc = schema.nodes['doc']!.create(null, children);
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: EditorState.create({ doc }) });
}

const SRC = 'source-heading';
/** Build a doc: a "Source" section [A,B,C], an "Elsewhere" heading, then a
 *  self-zone mirroring Source (fresh mirror ids, identical content). */
function buildView(inst: string): EditorView {
  return makeView([
    block('Source', SRC),
    card('A', 'alpha'),
    card('B', 'bravo'),
    card('C', 'charlie'),
    block('Elsewhere', 'oth'),
    selfZone(SRC, inst, [card('A', 'alpha'), card('B', 'bravo'), card('C', 'charlie')]),
  ]);
}
function zonePos(view: EditorView): number {
  let p = -1;
  view.state.doc.forEach((n, off) => {
    if (p < 0 && isTransclusionNode(n)) p = off;
  });
  return p;
}
/** Replace the first `oldText` found within [from, to) with `newText`. */
function editText(view: EditorView, oldText: string, newText: string, from: number, to: number): void {
  let at = -1;
  view.state.doc.nodesBetween(from, to, (n, pos) => {
    if (at < 0 && n.isText && n.text?.includes(oldText)) at = pos + n.text.indexOf(oldText);
    return at < 0;
  });
  if (at < 0) throw new Error(`not found in range: ${oldText}`);
  view.dispatch(view.state.tr.insertText(newText, at, at + oldText.length));
}
/** The card body texts of the source section, then of the mirror zone. */
function sourceBodies(view: EditorView): string[] {
  const zp = zonePos(view);
  const out: string[] = [];
  view.state.doc.nodesBetween(0, zp, (n) => {
    if (n.type.name === 'card_body') out.push(n.textContent);
    return true;
  });
  return out;
}
function mirrorBodies(view: EditorView): string[] {
  const zp = zonePos(view);
  const zone = view.state.doc.nodeAt(zp)!;
  const out: string[] = [];
  zone.descendants((n) => {
    if (n.type.name === 'card_body') out.push(n.textContent);
    return true;
  });
  return out;
}
/** Prime the baseline while source == mirror (mimics create-in-sync). */
function prime(view: EditorView): void {
  syncSelfZones(view);
}

describe('intra-doc transclusion — bidirectional debounced sync', () => {
  it('source edit → pushes into the mirror', () => {
    const view = buildView(newHeadingId());
    prime(view);
    editText(view, 'bravo', 'BRAVO', 0, zonePos(view)); // edit the SOURCE card B
    expect(syncSelfZones(view).conflicts).toHaveLength(0);
    expect(mirrorBodies(view)).toEqual(['alpha', 'BRAVO', 'charlie']);
    expect(sourceBodies(view)).toEqual(['alpha', 'BRAVO', 'charlie']);
    view.destroy();
  });

  it('mirror edit → pushes back into the source section', () => {
    const view = buildView(newHeadingId());
    prime(view);
    const zp = zonePos(view);
    editText(view, 'charlie', 'CHARLIE', zp, view.state.doc.content.size); // edit the MIRROR card C
    expect(syncSelfZones(view).conflicts).toHaveLength(0);
    expect(sourceBodies(view)).toEqual(['alpha', 'bravo', 'CHARLIE']);
    expect(mirrorBodies(view)).toEqual(['alpha', 'bravo', 'CHARLIE']);
    view.destroy();
  });

  it('edits to DIFFERENT blocks → diff3 auto-merge into both', () => {
    const view = buildView(newHeadingId());
    prime(view);
    editText(view, 'alpha', 'ALPHA', 0, zonePos(view)); // source edits A
    editText(view, 'charlie', 'CHARLIE', zonePos(view), view.state.doc.content.size); // mirror edits C
    expect(syncSelfZones(view).conflicts).toHaveLength(0);
    expect(sourceBodies(view)).toEqual(['ALPHA', 'bravo', 'CHARLIE']);
    expect(mirrorBodies(view)).toEqual(['ALPHA', 'bravo', 'CHARLIE']);
    view.destroy();
  });

  it('edits to the SAME block → conflict, both sides left untouched', () => {
    const view = buildView(newHeadingId());
    prime(view);
    editText(view, 'bravo', 'bravo-SRC', 0, zonePos(view)); // source edits B
    editText(view, 'bravo', 'bravo-MIR', zonePos(view), view.state.doc.content.size); // mirror edits B
    const { conflicts } = syncSelfZones(view);
    expect(conflicts).toHaveLength(1);
    // Neither side was overwritten — the caller prompts to resolve.
    expect(sourceBodies(view)).toEqual(['alpha', 'bravo-SRC', 'charlie']);
    expect(mirrorBodies(view)).toEqual(['alpha', 'bravo-MIR', 'charlie']);
    view.destroy();
  });

  it('no edits → in-sync, no transaction', () => {
    const view = buildView(newHeadingId());
    prime(view);
    const before = view.state.doc.toJSON();
    expect(syncSelfZones(view).conflicts).toHaveLength(0);
    expect(view.state.doc.toJSON()).toEqual(before);
    view.destroy();
  });
});
