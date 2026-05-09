/**
 * Stable heading IDs.
 *
 * Per ARCHITECTURE.md §4, heading-level nodes (pocket, hat, block, tag,
 * analytic) carry a UUID `id` attr that survives edits and round-trips
 * to docx as a `pmd-heading-<uuid>` bookmark.
 */

export const HEADING_BOOKMARK_PREFIX = 'pmd-heading-';

export function newHeadingId(): string {
  // Node ≥ 19 has crypto.randomUUID() globally.
  return crypto.randomUUID();
}

export function bookmarkNameForId(id: string): string {
  return `${HEADING_BOOKMARK_PREFIX}${id}`;
}

export function idFromBookmarkName(name: string): string | null {
  return name.startsWith(HEADING_BOOKMARK_PREFIX)
    ? name.slice(HEADING_BOOKMARK_PREFIX.length)
    : null;
}
