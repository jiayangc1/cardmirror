import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';

// Replicates the benchmark's editing-sequence position math (without a live
// EditorView) to prove the card body lands as a NEW block inside our own card,
// not merged into the cite or applied to pre-existing content.

function findById(doc: any, id: string): { node: any; pos: number } | null {
  let found: { node: any; pos: number } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (found) return false;
    if (node.attrs?.['id'] === id) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

function cardOf(doc: any, tagId: string): any {
  const tg = findById(doc, tagId)!;
  const $pos = doc.resolve(tg.pos);
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === 'card') return $pos.node(d);
  }
  return null;
}

describe('benchmark editing-sequence inserts', () => {
  it('inserts heading → card+tag → cite → card_body as a distinct block in our card', () => {
    // Start with a pre-existing card so we can confirm we never touch it.
    const preTag = schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Existing tag'));
    const preBody = schema.nodes['card_body']!.create(null, schema.text('pre-existing body'));
    const preCard = schema.nodes['card']!.createChecked(null, [preTag, preBody]);
    let state = EditorState.create({ doc: schema.nodes['doc']!.createChecked(null, [preCard]), schema });

    const pocketId = newHeadingId();
    const tagId = newHeadingId();
    const BODY = 'A long realistic card body that should land below the cite.';

    // 1. new pocket at top
    state = state.apply(
      state.tr.insert(0, schema.nodes['pocket']!.create({ id: pocketId }, schema.text('Benchmark'))),
    );
    // 3. new card+tag after the pocket
    const pk = findById(state.doc, pocketId)!;
    const at1 = pk.pos + pk.node.nodeSize;
    state = state.apply(
      state.tr.insert(
        at1,
        schema.nodes['card']!.createChecked(null, [
          schema.nodes['tag']!.create({ id: tagId }, schema.text('Bench tag')),
        ]),
      ),
    );
    // 5. cite after the tag (inside the card)
    const tg = findById(state.doc, tagId)!;
    const citeAt = tg.pos + tg.node.nodeSize;
    state = state.apply(
      state.tr.insert(citeAt, schema.nodes['cite_paragraph']!.create(null, schema.text('Smith 2024'))),
    );
    // 7. card_body after the cite (the "paste" — must be a NEW block below it)
    const tg2 = findById(state.doc, tagId)!;
    const at2 = tg2.pos + tg2.node.nodeSize;
    const cite = state.doc.nodeAt(at2)!;
    expect(cite.type.name).toBe('cite_paragraph');
    const after = at2 + cite.nodeSize;
    state = state.apply(
      state.tr.insert(after, schema.nodes['card_body']!.create(null, schema.text(BODY))),
    );

    // Our card should be exactly [tag, cite_paragraph, card_body].
    const myCard = cardOf(state.doc, tagId);
    const kinds = [] as string[];
    myCard.forEach((c: any) => kinds.push(c.type.name));
    expect(kinds).toEqual(['tag', 'cite_paragraph', 'card_body']);
    // The body is its OWN block (not merged into the cite) with our text.
    expect(myCard.lastChild.type.name).toBe('card_body');
    expect(myCard.lastChild.textContent).toBe(BODY);
    // The pre-existing card is untouched.
    const docText = state.doc.textContent;
    expect(docText).toContain('pre-existing body');
  });
});
