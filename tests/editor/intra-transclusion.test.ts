import { describe, it, expect } from 'vitest';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { decideSync, syncKey, mergeSections } from '../../src/editor/intra-transclusion.js';

function card(tag: string, body: string, id = newHeadingId()): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
const frag = (...cards: PMNode[]) => Fragment.fromArray(cards);
const texts = (f: Fragment): string[] => {
  const out: string[] = [];
  f.forEach((c) => out.push(c.textContent));
  return out;
};

describe('syncKey — id-independent', () => {
  it('same content under different ids has the same key', () => {
    expect(syncKey(frag(card('A', 'aa', 'id-1')))).toBe(syncKey(frag(card('A', 'aa', 'id-2'))));
  });
  it('different content has a different key', () => {
    expect(syncKey(frag(card('A', 'aa')))).not.toBe(syncKey(frag(card('A', 'bb'))));
  });
});

describe('decideSync', () => {
  const B = 'base';
  it('nothing changed → in-sync', () => expect(decideSync(B, B, B)).toBe('in-sync'));
  it('source moved only → push to mirror', () =>
    expect(decideSync(B, 'x', B)).toBe('push-source-to-mirror'));
  it('mirror moved only → push to source', () =>
    expect(decideSync(B, B, 'y')).toBe('push-mirror-to-source'));
  it('both moved → merge', () => expect(decideSync(B, 'x', 'y')).toBe('merge'));
});

describe('mergeSections — block-level diff3, id-independent', () => {
  // Baseline content (source and mirror both descended from this, w/ different ids).
  const base = frag(card('A', 'a'), card('B', 'b'), card('C', 'c'));

  it('source edits one block, mirror unchanged → source wins that block', () => {
    const source = frag(card('A', 'a'), card('B', 'B-edited'), card('C', 'c'));
    const mirror = frag(card('A', 'a'), card('B', 'b'), card('C', 'c')); // fresh ids, same content
    const r = mergeSections(base, source, mirror);
    expect(r.ok).toBe(true);
    if (r.ok) expect(texts(r.merged)).toEqual(['Aa', 'BB-edited', 'Cc']);
  });

  it('source and mirror edit DIFFERENT blocks → both changes kept', () => {
    const source = frag(card('A', 'A-src'), card('B', 'b'), card('C', 'c')); // edited A
    const mirror = frag(card('A', 'a'), card('B', 'b'), card('C', 'C-mir')); // edited C
    const r = mergeSections(base, source, mirror);
    expect(r.ok).toBe(true);
    if (r.ok) expect(texts(r.merged)).toEqual(['AA-src', 'Bb', 'CC-mir']);
  });

  it('source adds a block, mirror unchanged → addition kept', () => {
    const source = frag(card('A', 'a'), card('B', 'b'), card('D', 'd'), card('C', 'c'));
    const mirror = frag(card('A', 'a'), card('B', 'b'), card('C', 'c'));
    const r = mergeSections(base, source, mirror);
    expect(r.ok).toBe(true);
    if (r.ok) expect(texts(r.merged)).toEqual(['Aa', 'Bb', 'Dd', 'Cc']);
  });

  it('source and mirror edit the SAME block differently → conflict', () => {
    const source = frag(card('A', 'a'), card('B', 'B-src'), card('C', 'c'));
    const mirror = frag(card('A', 'a'), card('B', 'B-mir'), card('C', 'c'));
    expect(mergeSections(base, source, mirror).ok).toBe(false);
  });

  it('both made the identical edit → clean (no conflict)', () => {
    const same = frag(card('A', 'a'), card('B', 'B2'), card('C', 'c'));
    const r = mergeSections(base, same, same);
    expect(r.ok).toBe(true);
    if (r.ok) expect(texts(r.merged)).toEqual(['Aa', 'BB2', 'Cc']);
  });
});
