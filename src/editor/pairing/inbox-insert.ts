/**
 * Inserting a received card into the document — shared by the receive pill
 * (click to insert / drag-out) and the rebindable "insert most recent received"
 * keyboard shortcuts, so both paths behave identically.
 */

import { Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../../schema/index.js';
import { rewriteHeadingIds } from '../drag-controller.js';
import { readModePlugin } from '../read-mode-plugin.js';
import { READ_MODE_DRAG_META } from '../reading-marker.js';
import { inboxStore, type InboxItem } from './inbox-store.js';

/** Insert a received card into `view`: at the cursor by default, or at the end
 *  of the document when `atEnd` (or whenever read mode is on — there's no
 *  editing caret to target then). Heading ids are rewritten so they can't
 *  collide with the doc's existing ids. The item is left in the inbox (insertion
 *  isn't consumption — matching the pill). Returns false if the slice can't be
 *  decoded. */
export function insertReceivedItem(view: EditorView, item: InboxItem, atEnd: boolean): boolean {
  let slice: Slice;
  try {
    slice = Slice.fromJSON(schema, item.sliceJson as Parameters<typeof Slice.fromJSON>[1]);
  } catch {
    return false;
  }
  const rewritten = rewriteHeadingIds(slice);
  const inReadMode = readModePlugin.getState(view.state)?.on === true;
  const insertPos =
    atEnd || inReadMode ? view.state.doc.content.size : view.state.selection.head;
  const tr = view.state.tr
    .insert(insertPos, rewritten.content)
    .setMeta(READ_MODE_DRAG_META, true);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** Grab the most-recently-received card (the last item in the inbox) and insert
 *  it via {@link insertReceivedItem}. No-op (returns false) when the inbox is
 *  empty. */
export function insertMostRecentReceived(view: EditorView, atEnd: boolean): boolean {
  const item = inboxStore.list().at(-1);
  if (!item) return false;
  return insertReceivedItem(view, item, atEnd);
}
