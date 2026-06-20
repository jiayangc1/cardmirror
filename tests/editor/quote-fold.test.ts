import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';
import type { Node as PMNode } from 'prosemirror-model';
import { foldQuotes } from '../../src/editor/word-break.js';
import {
  findReplacePlugin,
  findReplaceKey,
} from '../../src/editor/find-replace-plugin.js';

describe('foldQuotes', () => {
  it('folds curly single/double quotes to straight, length-preserving', () => {
    expect(foldQuotes('the court’s ‘view’')).toBe("the court's 'view'");
    expect(foldQuotes('“clear” rule')).toBe('"clear" rule');
    // length is unchanged so it never shifts match offsets
    const s = 'a’b“c”d';
    expect(foldQuotes(s).length).toBe(s.length);
  });
  it('leaves straight quotes and other text untouched', () => {
    expect(foldQuotes(`it's "fine"`)).toBe(`it's "fine"`);
    expect(foldQuotes('no quotes here')).toBe('no quotes here');
  });
});

// ---- find/replace honors curly quotes ----

const tag = (t: string) => schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(t));
const cardBody = (t: string) => schema.nodes['card_body']!.create(null, schema.text(t));
const card = (...k: PMNode[]) => schema.nodes['card']!.createChecked(null, k);
const doc = (...k: PMNode[]) => schema.nodes['doc']!.createChecked(null, k);

function findMatchesFor(d: PMNode, query: string) {
  let state = EditorState.create({ doc: d, plugins: [findReplacePlugin()] });
  state = state.apply(
    state.tr.setMeta(findReplaceKey, {
      type: 'setQuery',
      query,
      caseSensitive: false,
      wholeWord: false,
      anchor: 0,
      sortMode: 'uncategorized',
      categoryOrder: ['heading', 'tag', 'cite', 'other'],
    }),
  );
  return findReplaceKey.getState(state)!.matches;
}

describe('find matches across straight/curly quotes', () => {
  it('a straight-quote query finds smart-quote text', () => {
    const d = doc(card(tag('T'), cardBody('the court’s “clear” rule')));
    expect(findMatchesFor(d, "court's")).toHaveLength(1);
    expect(findMatchesFor(d, '"clear"')).toHaveLength(1);
  });
  it('a curly-quote query finds straight-quote text', () => {
    const d = doc(card(tag('T'), cardBody(`it's "fine"`)));
    expect(findMatchesFor(d, 'it’s')).toHaveLength(1);
    expect(findMatchesFor(d, '“fine”')).toHaveLength(1);
  });
  it('the match range still lands on the real (curly) characters', () => {
    const d = doc(card(tag('T'), cardBody('a court’s b')));
    const m = findMatchesFor(d, "court's");
    expect(m).toHaveLength(1);
    // the matched doc text is the original curly form
    expect(d.textBetween(m[0]!.from, m[0]!.to)).toBe('court’s');
  });
});
