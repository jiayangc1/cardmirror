/**
 * Performance benchmarks for the round-trip pipeline.
 *
 * Run via `npm run test:bench`. These establish a baseline for
 * regression tracking.
 *
 * Targets (informal, based on the corpus we have):
 *   - Aff (1.8 MB, ~3,244 paragraphs / 242k words): <2s import, <2s export
 *   - DA (1.0 MB, ~2,786 paragraphs): <1.5s each
 *   - CP (252 KB, 999 paragraphs): <500ms each
 */

import { bench, describe, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromDocx } from '../src/import/index.js';
import { toDocx } from '../src/export/index.js';
import type { Node as PMNode } from 'prosemirror-model';

const DOCS_DIR = path.resolve(process.cwd(), 'reference-docs/example docs');

const FIXTURES = [
  'CP - Bifurcation PIC vs Fed Workers.docx',
  'DA - Reconciliation.docx',
  'Aff - Merp!.docx',
];

interface Fixture {
  name: string;
  bytes: Uint8Array;
  doc: PMNode;
}

const fixtures: Fixture[] = [];

beforeAll(async () => {
  for (const filename of FIXTURES) {
    const filePath = path.join(DOCS_DIR, filename);
    const buf = await readFile(filePath);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const doc = await fromDocx(bytes);
    fixtures.push({ name: filename, bytes, doc });
  }
});

describe('import (.docx → schema)', () => {
  for (const filename of FIXTURES) {
    bench(`import ${filename}`, async () => {
      const fix = fixtures.find((f) => f.name === filename)!;
      await fromDocx(fix.bytes);
    });
  }
});

describe('export (schema → .docx)', () => {
  for (const filename of FIXTURES) {
    bench(`export ${filename}`, async () => {
      const fix = fixtures.find((f) => f.name === filename)!;
      await toDocx(fix.doc);
    });
  }
});

describe('full round-trip (.docx → schema → .docx)', () => {
  for (const filename of FIXTURES) {
    bench(`round-trip ${filename}`, async () => {
      const fix = fixtures.find((f) => f.name === filename)!;
      const doc = await fromDocx(fix.bytes);
      await toDocx(doc);
    });
  }
});
