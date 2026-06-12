/**
 * Verbatim Flow port (renderer side).
 *
 * Mirrors the Verbatim Word add-in's "Send to Flow": serialize the
 * selected blocks the way Verbatim does, then hand them to the Windows
 * COM bridge (`ElectronHost.flowSend`) which writes them down the Flow
 * workbook's active column. Windows-only; on any other host the commands
 * toast that and do nothing. Requires NO modification to Verbatim Flow.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { getElectronHost } from './host/index.js';
import type { FlowResult } from './host/electron-host.js';
import { showToast } from './toast.js';

/** Body prose — excluded in "headings only" mode (Verbatim's
 *  OutlineLevel<>BodyText filter). Everything else (pocket/hat/block/tag/
 *  analytic/cite/undertag) is a heading/label and is kept. */
const BODY_TYPE = 'card_body';

export interface SendOptions {
  /** cell = all blocks joined into ONE cell; column = one cell per block. */
  mode: 'cell' | 'column';
  /** Skip card body prose, sending only headings/tags/cites. */
  headingsOnly: boolean;
}

/** The selected blocks' text as the list of cell values to write. When
 *  the selection is collapsed, expand to the enclosing card/unit (the
 *  Verbatim "select heading and content" fallback). */
function selectionCells(view: EditorView, opts: SendOptions): string[] {
  const sel = view.state.selection;
  const blocks: string[] = [];
  const collect = (from: number, to: number): void => {
    view.state.doc.nodesBetween(from, to, (node: PMNode) => {
      if (!node.isTextblock) return true; // descend into containers
      if (opts.headingsOnly && node.type.name === BODY_TYPE) return false;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) blocks.push(text);
      return false; // don't descend into inline content
    });
  };

  if (sel.empty) {
    const $f = sel.$from;
    let from = $f.start();
    let to = $f.end();
    for (let d = $f.depth; d > 0; d--) {
      const t = $f.node(d).type.name;
      if (t === 'card' || t === 'analytic_unit') {
        from = $f.before(d);
        to = $f.after(d);
        break;
      }
    }
    collect(from, to);
  } else {
    collect(sel.from, sel.to);
  }

  if (blocks.length === 0) return [];
  return opts.mode === 'cell' ? [blocks.join('\n')] : blocks;
}

/** Map a bridge result to a user-facing message. */
function flowError(res: FlowResult | { error?: string }): string {
  switch (res.error) {
    case 'excel-not-open':
      return 'Open Excel with your Flow before sending.';
    case 'no-flow-workbook':
      return 'Open an Excel workbook with "Flow" in its name.';
    case 'no-active-sheet':
      return 'Your Flow workbook has no active sheet.';
    case 'template-not-found':
      return 'Verbatim Flow isn’t installed (Debate.xltm not found).';
    case 'windows-only':
    case 'unsupported':
      return 'The Verbatim Flow integration is Windows-only.';
    default:
      return `Flow: ${res.error ?? 'unknown error'}`;
  }
}

export async function runSendToFlow(view: EditorView, opts: SendOptions): Promise<void> {
  const host = getElectronHost();
  if (!host?.flowSend) {
    showToast('The Verbatim Flow integration is Windows-only.');
    return;
  }
  const cells = selectionCells(view, opts);
  if (cells.length === 0) {
    showToast('Nothing to send — select some text first.');
    return;
  }
  let res = await host.flowSend({ cells });
  if (res.needsConfirm) {
    const where = res.cell ? ` (${res.cell})` : '';
    if (!window.confirm(`There's already text where you're sending${where}. Overwrite?`)) return;
    res = await host.flowSend({ cells }, true);
  }
  if (res.ok) {
    const n = typeof res.written === 'number' ? res.written : cells.length;
    showToast(`Sent ${n} ${n === 1 ? 'entry' : 'entries'} to Flow.`);
  } else {
    showToast(flowError(res));
  }
}

export async function runPullFromFlow(view: EditorView): Promise<void> {
  const host = getElectronHost();
  if (!host?.flowPull) {
    showToast('The Verbatim Flow integration is Windows-only.');
    return;
  }
  const res = await host.flowPull();
  if (!res.ok) {
    showToast(flowError(res));
    return;
  }
  // PowerShell's ConvertTo-Json collapses a single-element array to a
  // scalar — coerce back to an array before filtering.
  const raw = res.cells;
  const cells = (Array.isArray(raw) ? raw : raw ? [raw as unknown as string] : []).filter((c) =>
    String(c).trim(),
  );
  if (cells.length === 0) {
    showToast('Select the cells to pull in your Flow first.');
    return;
  }
  view.dispatch(view.state.tr.insertText(cells.join('\n')).scrollIntoView());
  view.focus();
  showToast(`Pulled ${cells.length} ${cells.length === 1 ? 'cell' : 'cells'} from Flow.`);
}

export async function runCreateFlow(): Promise<void> {
  const host = getElectronHost();
  if (!host?.flowCreate) {
    showToast('The Verbatim Flow integration is Windows-only.');
    return;
  }
  showToast('Opening a new Flow…');
  const res = await host.flowCreate();
  if (!res.ok) showToast(flowError(res));
}
