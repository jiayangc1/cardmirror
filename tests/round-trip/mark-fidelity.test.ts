/**
 * Mark-fidelity tests: confirm that direct-formatting marks (highlight,
 * font_color, shading, underline_mark, etc.) survive round-trip on real
 * documents.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromDocx } from '../../src/import/index.js';
import { toDocx } from '../../src/export/index.js';
import type { Node as PMNode } from 'prosemirror-model';

const DOCS_DIR = path.resolve(process.cwd(), 'reference-docs/example docs');

function countMarks(doc: PMNode): Record<string, number> {
  const counts: Record<string, number> = {};
  doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      counts[mark.type.name] = (counts[mark.type.name] ?? 0) + 1;
    }
  });
  return counts;
}

function countSpecificColors(doc: PMNode, markName: string): Record<string, number> {
  const counts: Record<string, number> = {};
  doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name === markName) {
        const color = String(mark.attrs['color'] ?? '');
        counts[color] = (counts[color] ?? 0) + 1;
      }
    }
  });
  return counts;
}

interface DocFixture {
  filename: string;
  /** Expected non-zero marks based on the real-doc survey (NOTES-verbatim.md §6). */
  expectMarks: string[];
  /** Specific font-color values we expect to see. */
  expectFontColors?: string[];
  /** Specific shading values we expect to see. */
  expectShading?: string[];
}

const FIXTURES: DocFixture[] = [
  {
    filename: 'Aff - Merp!.docx',
    // Survey says: 16,211 underline_mark; 14,212 emphasis_mark; 387 cite_mark; 2,736 #555555 color; 684 #D2D2D2 shading
    expectMarks: ['underline_mark', 'emphasis_mark', 'cite_mark', 'highlight', 'font_color', 'shading'],
    expectFontColors: ['555555'],
    expectShading: ['D2D2D2'],
  },
  {
    filename: 'DA - Reconciliation.docx',
    expectMarks: ['underline_mark', 'emphasis_mark', 'cite_mark', 'highlight', 'font_color', 'shading'],
    expectFontColors: ['555555'],
    expectShading: ['D2D2D2'],
  },
  {
    filename: 'CP - Bifurcation PIC vs Fed Workers.docx',
    // CP has zero #555555 / D2D2D2 (smallest doc)
    expectMarks: ['underline_mark', 'emphasis_mark', 'cite_mark', 'highlight'],
  },
];

describe('mark fidelity — real docs', () => {
  for (const fixture of FIXTURES) {
    describe(fixture.filename, () => {
      let imported: PMNode;
      let roundTripped: PMNode;

      beforeAll(async () => {
        const filePath = path.join(DOCS_DIR, fixture.filename);
        const buf = await readFile(filePath);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        imported = await fromDocx(bytes);
        const exportedBytes = await toDocx(imported);
        roundTripped = await fromDocx(exportedBytes);
      }, 60000);

      it('imports the expected mark types', () => {
        const counts = countMarks(imported);
        for (const name of fixture.expectMarks) {
          expect(counts[name], `expected non-zero ${name} count`).toBeGreaterThan(0);
        }
      });

      it('preserves all named-style emphasis marks through round-trip', () => {
        const before = countMarks(imported);
        const after = countMarks(roundTripped);
        for (const name of ['underline_mark', 'emphasis_mark', 'cite_mark', 'undertag_mark', 'analytic_mark']) {
          expect(after[name] ?? 0, `${name} count must survive round-trip`).toBe(before[name] ?? 0);
        }
      });

      it('preserves direct-formatting marks through round-trip', () => {
        const before = countMarks(imported);
        const after = countMarks(roundTripped);
        for (const name of ['highlight', 'font_color', 'font_size', 'shading', 'bold', 'italic']) {
          expect(after[name] ?? 0, `${name} count must survive round-trip`).toBe(before[name] ?? 0);
        }
      });

      if (fixture.expectFontColors) {
        it('preserves the #555555 reference-text font color', () => {
          const colors = countSpecificColors(imported, 'font_color');
          for (const c of fixture.expectFontColors!) {
            expect(colors[c] ?? 0, `expected non-zero #${c} font_color count`).toBeGreaterThan(0);
          }
          const colorsAfter = countSpecificColors(roundTripped, 'font_color');
          for (const c of fixture.expectFontColors!) {
            expect(colorsAfter[c] ?? 0).toBe(colors[c] ?? 0);
          }
        });
      }

      if (fixture.expectShading) {
        it('preserves the #D2D2D2 protected-highlight shading', () => {
          const shades = countSpecificColors(imported, 'shading');
          for (const c of fixture.expectShading!) {
            expect(shades[c] ?? 0, `expected non-zero #${c} shading count`).toBeGreaterThan(0);
          }
          const shadesAfter = countSpecificColors(roundTripped, 'shading');
          for (const c of fixture.expectShading!) {
            expect(shadesAfter[c] ?? 0).toBe(shades[c] ?? 0);
          }
        });
      }
    });
  }
});
