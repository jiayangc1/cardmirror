import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  serializeNative,
  parseNative,
  looksLikeNative,
  NATIVE_FILE_EXTENSION,
} from '../../src/native/index.js';
import type { Thread } from '../../src/editor/comments-plugin.js';

const { nodes, marks } = schema;

function makeSampleDoc(): PMNode {
  return nodes['doc']!.createChecked(null, [
    nodes['pocket']!.create({ id: newHeadingId() }, schema.text('Pocket title')),
    nodes['card']!.create(null, [
      nodes['tag']!.create({ id: newHeadingId() }, schema.text('Card tag')),
      nodes['cite_paragraph']!.create(null, [
        schema.text('Smith 24', [marks['cite_mark']!.create()]),
        schema.text(', professor, '),
        schema.text('Title', [marks['italic']!.create()]),
      ]),
      nodes['card_body']!.create(null, [
        schema.text('Plain text plus '),
        schema.text('underlined', [marks['underline_mark']!.create()]),
        schema.text(' and '),
        schema.text('highlighted', [marks['highlight']!.create({ color: 'yellow' })]),
        schema.text(' content.'),
      ]),
    ]),
    nodes['paragraph']!.create(null, schema.text('Loose paragraph after the card.')),
  ]);
}

describe('native format (.cmir)', () => {
  it('exposes the canonical extension', () => {
    expect(NATIVE_FILE_EXTENSION).toBe('cmir');
  });

  it('serializes + parses back to a structurally-equal doc', () => {
    const original = makeSampleDoc();
    const bytes = serializeNative(original);
    const { doc, threads } = parseNative(bytes);
    expect(threads).toEqual([]);
    // Compare via toJSON — PMNode.eq cares about marks too and is
    // the right semantic equality check for round-trip.
    expect(doc.toJSON()).toEqual(original.toJSON());
    expect(doc.eq(original)).toBe(true);
  });

  it('preserves heading IDs', () => {
    const original = makeSampleDoc();
    const bytes = serializeNative(original);
    const { doc } = parseNative(bytes);
    const originalIds: string[] = [];
    original.descendants((n) => {
      const id = n.attrs['id'];
      if (typeof id === 'string' && id) originalIds.push(id);
      return true;
    });
    const roundTripped: string[] = [];
    doc.descendants((n) => {
      const id = n.attrs['id'];
      if (typeof id === 'string' && id) roundTripped.push(id);
      return true;
    });
    expect(roundTripped).toEqual(originalIds);
  });

  it('round-trips threads', () => {
    const original = makeSampleDoc();
    const threads: Thread[] = [
      {
        id: 'thread-1',
        comments: [
          {
            id: 'thread-1',
            author: 'Anthony',
            initials: 'AT',
            date: '2026-05-15T20:00:00.000Z',
            text: 'Solid card',
            kind: 'human',
            parentId: null,
          },
          {
            id: 'thread-1-reply',
            author: 'Coach',
            initials: 'C',
            date: '2026-05-15T20:01:00.000Z',
            text: 'Agree',
            kind: 'human',
            parentId: 'thread-1',
          },
        ],
      },
    ];
    const bytes = serializeNative(original, { threads });
    const parsed = parseNative(bytes);
    expect(parsed.threads).toEqual(threads);
  });

  it('preserves AI comment kind through round-trip', () => {
    // The whole point of the native format vs docx: kind: 'ai'
    // survives. Docx export drops it (Word has no concept).
    const original = makeSampleDoc();
    const threads: Thread[] = [
      {
        id: 't-ai',
        comments: [
          {
            id: 't-ai',
            author: 'AI',
            initials: 'AI',
            date: '2026-05-15T20:00:00.000Z',
            text: 'Synthesis comment',
            kind: 'ai',
            parentId: null,
          },
        ],
      },
    ];
    const bytes = serializeNative(original, { threads });
    const parsed = parseNative(bytes);
    expect(parsed.threads[0]!.comments[0]!.kind).toBe('ai');
  });

  it('refuses non-CardMirror JSON', () => {
    const bytes = new TextEncoder().encode('{"hello": "world"}');
    expect(() => parseNative(bytes)).toThrow(/not a cardmirror file/i);
  });

  it('refuses non-JSON bytes', () => {
    const bytes = new TextEncoder().encode('plain text, no JSON');
    expect(() => parseNative(bytes)).toThrow(/cardmirror/i);
  });

  it('refuses files from a newer format version', () => {
    const payload = JSON.stringify({
      format: 'cardmirror-doc',
      formatVersion: 99,
      createdBy: 'future-cardmirror',
      createdAt: '2999-01-01T00:00:00.000Z',
      doc: { type: 'doc', content: [] },
    });
    const bytes = new TextEncoder().encode(payload);
    expect(() => parseNative(bytes)).toThrow(/newer than this build/i);
  });

  it('looksLikeNative recognizes valid bytes and rejects others', () => {
    const valid = serializeNative(makeSampleDoc());
    expect(looksLikeNative(valid)).toBe(true);
    expect(looksLikeNative(new TextEncoder().encode('plain text'))).toBe(false);
    expect(looksLikeNative(new TextEncoder().encode('{"other": true}'))).toBe(false);
  });
});
