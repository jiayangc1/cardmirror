/**
 * ProseMirror node specs.
 *
 * Design choice (see DECISIONS.md):
 *
 *   Most heading-level nodes (pocket, hat, block, analytic) are *flat
 *   paragraphs with inline content*, not tree containers. This matches
 *   how Word represents them in OOXML (paragraphs with Heading1-3 /
 *   Analytic styles, hierarchy implicit in document order + outline
 *   level). Tree-shaped grouping ("the cards under hat 2") is a derived
 *   view — the navigation panel walks paragraphs grouped by outline
 *   level — not a schema constraint.
 *
 *   `card` *is* tree-structured: it has a required `tag` child, optional
 *   cite_paragraph or analytic, and zero+ card_body paragraphs. This
 *   matches the user's mental model of cards as objects we can move /
 *   send / drag / select as units.
 *
 *   Heading-like nodes (pocket, hat, block, tag, analytic) carry a
 *   stable `id` attribute (UUID) for transclusion targeting per
 *   ARCHITECTURE.md §4 and §12.
 */

import type { NodeSpec } from 'prosemirror-model';
import { newHeadingId } from './ids.js';

const headingAttrs = {
  id: {
    default: null as string | null,
    validate: (v: unknown) => (v === null || typeof v === 'string'),
  },
};

/** Generate a fresh ID at construction time if none provided. */
export function ensureId(attrs: Record<string, unknown> | null): { id: string } {
  if (attrs && typeof attrs['id'] === 'string' && attrs['id']) {
    return { id: attrs['id'] };
  }
  return { id: newHeadingId() };
}

/**
 * Block-level content that's legal inside a scratchpad and at the doc
 * root. Note: `tag` is *not* in this list — tags only appear as the
 * required first child of a `card`.
 */
const BLOCK_CONTENT =
  '(scratchpad | pocket | hat | block | analytic | card | paragraph | undertag | cite_paragraph | card_body)*';

export const nodes: { [name: string]: NodeSpec } = {
  /** Top-level container. Sequence of block-level content. */
  doc: { content: BLOCK_CONTENT },

  /** A run of inline content. Plain text + marks. */
  text: { group: 'inline' },

  /**
   * Heading paragraphs — flat in document order, hierarchy via the
   * derived outline view, not schema containment.
   */
  pocket: {
    content: 'inline*',
    attrs: headingAttrs,
    defining: true,
    parseDOM: [{ tag: 'h1.pmd-pocket' }],
    toDOM: (node) => [
      'h1',
      { class: 'pmd-pocket', 'data-id': node.attrs['id'] ?? '' },
      0,
    ],
  },

  hat: {
    content: 'inline*',
    attrs: headingAttrs,
    defining: true,
    parseDOM: [{ tag: 'h2.pmd-hat' }],
    toDOM: (node) => [
      'h2',
      { class: 'pmd-hat', 'data-id': node.attrs['id'] ?? '' },
      0,
    ],
  },

  block: {
    content: 'inline*',
    attrs: headingAttrs,
    defining: true,
    parseDOM: [{ tag: 'h3.pmd-block' }],
    toDOM: (node) => [
      'h3',
      { class: 'pmd-block', 'data-id': node.attrs['id'] ?? '' },
      0,
    ],
  },

  /**
   * A card: required tag, optional cite paragraph (or in-card analytic),
   * zero or more body paragraphs. This IS a real schema container — the
   * user cares about cards as objects.
   */
  card: {
    content: 'tag (cite_paragraph | analytic)? card_body*',
    defining: true,
    isolating: true,
    parseDOM: [{ tag: 'div.pmd-card' }],
    toDOM: () => ['div', { class: 'pmd-card' }, 0],
  },

  /** Card label. Heading-level outline-4 with stable id. Card-only. */
  tag: {
    content: 'inline*',
    attrs: headingAttrs,
    defining: true,
    parseDOM: [{ tag: 'h4.pmd-tag' }],
    toDOM: (node) => [
      'h4',
      { class: 'pmd-tag', 'data-id': node.attrs['id'] ?? '' },
      0,
    ],
  },

  /** Cite paragraph. Used inside a card or at the doc level. */
  cite_paragraph: {
    content: 'inline*',
    parseDOM: [{ tag: 'p.pmd-cite-para' }],
    toDOM: () => ['p', { class: 'pmd-cite-para' }, 0],
  },

  /** Card body paragraph — implicit Normal style on export. */
  card_body: {
    content: 'inline*',
    parseDOM: [{ tag: 'p.pmd-card-body' }],
    toDOM: () => ['p', { class: 'pmd-card-body' }, 0],
  },

  /**
   * Analytic — outline-level-4 paragraph, sibling to Tag, with stable id.
   * Distinct from a tag in styling (color #1F3864) and semantic role.
   * Can appear standalone at the block level OR inside a card.
   */
  analytic: {
    content: 'inline*',
    attrs: headingAttrs,
    defining: true,
    parseDOM: [{ tag: 'p.pmd-analytic' }],
    toDOM: (node) => [
      'p',
      { class: 'pmd-analytic', 'data-id': node.attrs['id'] ?? '' },
      0,
    ],
  },

  /** Undertag paragraph (linked to UndertagChar). */
  undertag: {
    content: 'inline*',
    parseDOM: [{ tag: 'p.pmd-undertag' }],
    toDOM: () => ['p', { class: 'pmd-undertag' }, 0],
  },

  /** Generic body paragraph — implicit Normal style. */
  paragraph: {
    content: 'inline*',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },

  /**
   * Scratchpad — schema escape hatch. Permissive content. Can nest.
   * Allowed wherever block-level content is legal (top-level, inside
   * other scratchpads).
   */
  scratchpad: {
    content: BLOCK_CONTENT,
    parseDOM: [{ tag: 'div.pmd-scratchpad' }],
    toDOM: () => ['div', { class: 'pmd-scratchpad' }, 0],
  },
};
