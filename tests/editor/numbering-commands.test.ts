/**
 * Auto-numbering input commands (NUMBERING_PLAN.md §4). Whole-selection toggles:
 * a role command turns the in-scope card set ON if any lacks the role, else OFF;
 * number/sub are mutually exclusive; restart flips the cursor's block or card.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { type Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  toggleNumberRole,
  toggleSubRole,
  toggleNumRestart,
} from '../../src/editor/numbering-commands.js';

function card(tag: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text('body')),
  ]);
}
function block(text: string): PMNode {
  return schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(text));
}
function stateWith(children: PMNode[]): EditorState {
  return EditorState.create({ doc: schema.nodes['doc']!.create(null, children) });
}
/** A position inside the given text node's content. */
function posInText(doc: PMNode, text: string): number {
  let p = -1;
  doc.descendants((n, pos) => {
    if (p < 0 && n.isText && n.text === text) p = pos + 1;
    return p < 0;
  });
  if (p < 0) throw new Error(`text not found: ${text}`);
  return p;
}
function run(state: EditorState, cmd: Command): EditorState {
  let next = state;
  const ok = cmd(state, (tr) => {
    next = state.apply(tr);
  });
  if (!ok) throw new Error('command returned false');
  return next;
}
/** numRole of each card/analytic in document order. */
function roles(doc: PMNode): string[] {
  const out: string[] = [];
  doc.forEach((n) => {
    if (n.type.name === 'card' || n.type.name === 'analytic_unit') out.push(n.attrs['numRole']);
  });
  return out;
}

describe('toggleNumberRole / toggleSubRole — single card at the cursor', () => {
  it('toggles number on then off', () => {
    let s = stateWith([card('A')]);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posInText(s.doc, 'A'))));
    s = run(s, toggleNumberRole);
    expect(roles(s.doc)).toEqual(['number']);
    s = run(s, toggleNumberRole);
    expect(roles(s.doc)).toEqual(['none']);
  });

  it('number and sub are mutually exclusive (sub replaces number)', () => {
    let s = stateWith([card('A')]);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posInText(s.doc, 'A'))));
    s = run(s, toggleNumberRole);
    expect(roles(s.doc)).toEqual(['number']);
    s = run(s, toggleSubRole); // not all are 'sub' → set to 'sub'
    expect(roles(s.doc)).toEqual(['sub']);
  });
});

describe('toggleNumberRole — whole-selection set (§4)', () => {
  it('a mixed selection normalizes all to the role, then clears all on the second run', () => {
    let s = stateWith([card('A'), card('B'), card('C')]);
    // Pre-set the middle card to 'number' so the selection is mixed.
    let bCardPos = -1;
    s.doc.forEach((n, off, i) => {
      if (i === 1) bCardPos = off;
    });
    s = s.apply(s.tr.setNodeAttribute(bCardPos, 'numRole', 'number'));
    // Select across all three cards.
    const from = posInText(s.doc, 'A');
    const to = posInText(s.doc, 'C');
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
    expect(roles(s.doc)).toEqual(['none', 'number', 'none']); // mixed

    s = run(s, toggleNumberRole); // any not 'number' → set all
    expect(roles(s.doc)).toEqual(['number', 'number', 'number']);

    s = run(s, toggleNumberRole); // all 'number' → clear all
    expect(roles(s.doc)).toEqual(['none', 'none', 'none']);
  });
});

describe('toggleNumRestart — flips the cursor unit', () => {
  it('a card defaults to no restart; toggling turns it on', () => {
    let s = stateWith([card('A')]);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posInText(s.doc, 'A'))));
    expect(s.doc.child(0).attrs['numRestart']).toBe(false);
    s = run(s, toggleNumRestart);
    expect(s.doc.child(0).attrs['numRestart']).toBe(true);
  });

  it('a block defaults to restart; toggling makes it continue', () => {
    let s = stateWith([block('One'), card('A')]);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posInText(s.doc, 'One'))));
    expect(s.doc.child(0).attrs['numRestart']).toBe(true);
    s = run(s, toggleNumRestart);
    expect(s.doc.child(0).attrs['numRestart']).toBe(false);
  });
});
