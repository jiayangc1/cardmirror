// @vitest-environment jsdom
/**
 * Sending a node-selected LIVE VIEW (`self_ref`). Clicking a live view selects
 * it as a whole node (the green box); the send-to-* commands (tilde, dropzone)
 * should then send that window — flattened to plain cards, since the live
 * reference can't travel out of the doc. A `self_ref` isn't a structural unit,
 * so `normalizeSelectionForSend` would drop it; `resolveSendRange` handles the
 * node-selection case directly.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { type Node as PMNode, type Slice } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { createSelfRefNode, isSelfRef } from '../../src/editor/self-transclusion.js';
import { resolveSendRange, resolveSendSlice, takeSendSlice } from '../../src/editor/speech-doc-send.js';

const block = (text: string, id: string): PMNode => schema.nodes['block']!.create({ id }, schema.text(text));
function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
function makeView(children: PMNode[]): EditorView {
  const doc = schema.nodes['doc']!.create(null, children);
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: EditorState.create({ doc }) });
}
function selfPos(view: EditorView): number {
  let p = -1;
  view.state.doc.forEach((n, off) => {
    if (p < 0 && isSelfRef(n)) p = off;
  });
  return p;
}
function selectSelfRef(view: EditorView): void {
  const pos = selfPos(view);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
}
function sliceBodies(slice: Slice): string[] {
  const out: string[] = [];
  slice.content.descendants((n) => {
    if (n.type.name === 'card_body') out.push(n.textContent);
    return true;
  });
  return out;
}
function sliceHasSelfRef(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((n) => {
    if (isSelfRef(n)) found = true;
    return true;
  });
  return found;
}

describe('resolveSendRange — a node-selected live view', () => {
  it('returns exactly the self_ref node range', () => {
    const view = makeView([
      block('Source', 'src'),
      card('Alpha', 'alpha'),
      block('Elsewhere', 'oth'),
      createSelfRefNode(schema, 'src', '↳ Source'),
    ]);
    selectSelfRef(view);
    const pos = selfPos(view);
    const node = view.state.doc.nodeAt(pos)!;
    const range = resolveSendRange(view)!;
    expect(range).toEqual({ from: pos, to: pos + node.nodeSize });
    view.destroy();
  });

  it('takeSendSlice flattens the window to plain cards (no live link travels)', () => {
    const view = makeView([
      block('Source', 'src'),
      card('Alpha', 'alpha'),
      card('Bravo', 'bravo'),
      block('Elsewhere', 'oth'),
      createSelfRefNode(schema, 'src', '↳ Source'),
    ]);
    selectSelfRef(view);
    const slice = takeSendSlice(view)!;
    expect(slice).not.toBeNull();
    // The projected cards come out as real cards…
    expect(sliceBodies(slice)).toEqual(['alpha', 'bravo']);
    // …and the self_ref itself never travels.
    expect(sliceHasSelfRef(slice)).toBe(false);
    view.destroy();
  });

  it('resolveSendSlice (non-taking) also sends the flattened window', () => {
    const view = makeView([
      block('Source', 'src'),
      card('Alpha', 'alpha'),
      block('Elsewhere', 'oth'),
      createSelfRefNode(schema, 'src', '↳ Source'),
    ]);
    selectSelfRef(view);
    const slice = resolveSendSlice(view)!;
    expect(sliceBodies(slice)).toEqual(['alpha']);
    expect(sliceHasSelfRef(slice)).toBe(false);
    view.destroy();
  });
});
