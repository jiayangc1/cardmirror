/**
 * Minimal browser editor — v0.
 *
 * Mounts a ProseMirror EditorView with our schema. Lets the user drop a
 * .docx, see it rendered, and export it back. This exists as a visual
 * sanity check while we build the foundation; full editor UX (read mode,
 * navigation panel, send-to-speech, drag-and-drop, etc.) is later work.
 */

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap } from 'prosemirror-commands';
import { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../schema/index.js';
import { fromDocx, toDocx } from '../index.js';

const editorEl = document.getElementById('editor')!;
const dropzone = document.getElementById('dropzone') as HTMLInputElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;

let currentDoc: PMNode = makeStarterDoc();
let view: EditorView | null = null;

function makeStarterDoc(): PMNode {
  return schema.nodes['doc']!.createChecked(null, [
    schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text('prosemirror-debate playground')),
    schema.nodes['paragraph']!.create(null, [
      schema.text('Drop a .docx in the input above to load it. The schema renders here as the canonical Verbatim layout (Pocket = box, Hat = centered double underline, Block = centered single underline, Tag = inline-bold).'),
    ]),
    schema.nodes['hat']!.create({ id: newHeadingId() }, schema.text('Example structures')),
    schema.nodes['block']!.create({ id: newHeadingId() }, schema.text('A block containing two cards')),
    schema.nodes['card']!.create(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Climate action delays catastrophic — IPCC')),
      schema.nodes['cite_paragraph']!.create(null, [
        schema.text('IPCC AR6 ', [schema.marks['cite_mark']!.create()]),
        schema.text('2023, '),
        schema.text('Synthesis Report', [schema.marks['italic']!.create()]),
        schema.text(', '),
        schema.text('https://ipcc.ch', [schema.marks['link']!.create({ href: 'https://www.ipcc.ch' })]),
      ]),
      schema.nodes['card_body']!.create(null, [
        schema.text('Plain context. '),
        schema.text('Underlined evidence claim ', [schema.marks['underline_mark']!.create()]),
        schema.text('plus highlighted ', [
          schema.marks['underline_mark']!.create(),
          schema.marks['highlight']!.create({ color: 'yellow' }),
        ]),
        schema.text('and emphasized.', [
          schema.marks['emphasis_mark']!.create(),
          schema.marks['highlight']!.create({ color: 'yellow' }),
        ]),
      ]),
    ]),
    schema.nodes['analytic']!.create(
      { id: newHeadingId() },
      schema.text('A standalone analytic between cards (dark blue).'),
    ),
    schema.nodes['undertag']!.create(null, schema.text('A loose undertag note (green italic).')),
    schema.nodes['scratchpad']!.create(null, [
      schema.nodes['paragraph']!.create(null, schema.text('Scratchpad text — schema escape hatch.')),
    ]),
  ]);
}

function mountView(doc: PMNode): void {
  if (view) view.destroy();
  const state = EditorState.create({
    doc,
    schema,
    plugins: [
      history(),
      keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }),
      keymap(baseKeymap),
    ],
  });
  view = new EditorView(editorEl, {
    state,
    dispatchTransaction(tx) {
      if (!view) return;
      const next = view.state.apply(tx);
      view.updateState(next);
      currentDoc = next.doc;
    },
  });
  currentDoc = doc;
  exportBtn.disabled = false;
}

dropzone.addEventListener('change', async () => {
  const file = dropzone.files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  try {
    const doc = await fromDocx(new Uint8Array(buf));
    mountView(doc);
    console.log(`Loaded ${file.name}: ${countSummary(doc)}`);
  } catch (err) {
    console.error('Failed to load docx:', err);
    alert(`Failed to load: ${err instanceof Error ? err.message : err}`);
  }
});

exportBtn.addEventListener('click', async () => {
  try {
    const bytes = await toDocx(currentDoc);
    // Copy into a regular ArrayBuffer for Blob's BlobPart contract.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exported.docx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export failed:', err);
    alert(`Export failed: ${err instanceof Error ? err.message : err}`);
  }
});

function countSummary(doc: PMNode): string {
  const counts: Record<string, number> = {};
  doc.descendants((node) => {
    counts[node.type.name] = (counts[node.type.name] ?? 0) + 1;
  });
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

mountView(currentDoc);
