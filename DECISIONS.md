# Decisions log

Append-only log of implementation decisions and their rationale. Each
entry has a date, a one-line summary, and the reasoning.

## 2026-05-08: TypeScript + raw ProseMirror + Vite + Vitest

**Stack:**
- **TypeScript 5.x** — universal for ProseMirror projects; strong
  typing helps with schema correctness.
- **Raw ProseMirror** (not TipTap) — direct schema control matters here
  because we have non-trivial schema requirements (custom node types,
  stable heading IDs, scratchpad nesting, link marks). TipTap is a
  productive wrapper but adds a layer of indirection we don't need.
- **Vite** — modern, fast, works for both library and app builds.
- **Vitest** — first-class TS support, integrates with Vite, fast.

**Rejected alternatives:**
- TipTap: see above.
- Webpack: heavyweight; Vite is the default for greenfield TS projects.
- Jest: slower than Vitest for TS, more config friction.

## 2026-05-08: jszip + fast-xml-parser for OOXML

**Stack:**
- **jszip** — well-known, mature, isomorphic (browser + Node).
- **fast-xml-parser** for parsing — fast, returns plain JS objects
  rather than DOM, easy to traverse.
- **Hand-rolled emission** for writing — OOXML output is templated and
  we control all the namespaces and formatting; a heavy XML lib adds
  more friction than it removes for our specific patterns.

**Rejected alternatives:**
- `@xmldom/xmldom`: full DOM API, but heavier than we need.
- `xmlbuilder2`: nice fluent emit API, but two-libs-one-job feels
  unnecessary when we control all the patterns.
- `xml2js`: older, less performant.

## 2026-05-08: Single package, monorepo deferred

Starting with a single package containing schema + import + export +
(eventually) editor. We'll split into a monorepo (`@prosemirror-debate/schema`,
`@prosemirror-debate/docx-converter`, etc.) only if web/desktop divergence
or external publication forces it. YAGNI for v0.

## 2026-05-08: Stable heading IDs via crypto.randomUUID()

Per `ARCHITECTURE.md §4`, every heading-level node gets an `id` attr.
Generated with `crypto.randomUUID()` (Node-built-in, no extra dep).
Round-tripped to docx as bracketing `<w:bookmarkStart w:name="..."/>` /
`<w:bookmarkEnd/>` markers around the heading paragraph.

The bookmark name pattern is `pmd-heading-<uuid>` — the `pmd-` prefix
namespaces our bookmarks so we can distinguish them from existing
Verbatim bookmarks (e.g., the VirtualTub flow uses bookmarks for its own
purposes per `NOTES-verbatim.md §4`).

## 2026-05-08: Inline node IDs not initially required

Heading IDs are required for transclusion targeting. Inline runs and
non-heading paragraphs do not need stable IDs in v0 — there's no feature
yet that targets them.

## 2026-05-08: Schema marks vs nodes for Cite/Analytic/Undertag

Per `ARCHITECTURE.md §4`, Cite/Analytic/Undertag are linked
paragraph+character pairs in OOXML. We model each as **both a block
node and a mark**:
- `<w:pStyle w:val="Analytic"/>` on a paragraph → block node `analytic`
- `<w:rStyle w:val="AnalyticChar"/>` on a run → mark `analytic_mark`
- Same for Undertag and Cite.

Export reverses: block-node → pStyle on the paragraph; mark → rStyle on
the run. This matches how Word's linked styles actually work and keeps
both representations available without forcing a one-shape-fits-all
decision.

## 2026-05-08: Direct-formatting marks chosen explicitly

Direct formatting captured as marks, not node attributes:
`bold`, `italic`, `font_color`, `font_size`, `highlight`, `shading`,
`link`, plus the named-style emphasis marks (cite_mark, underline_mark,
emphasis_mark, undertag_mark, analytic_mark).

Reasoning: marks compose freely on text ranges; attributes on nodes
would make sub-paragraph formatting awkward. ProseMirror's mark system
is exactly designed for this.

## 2026-05-08: "underline_mark" emits both rStyle AND direct underline

Per `NOTES-verbatim.md §5` gotcha #1, Verbatim's own code commits the
dual representation. Our exporter emits both `<w:rStyle w:val="StyleUnderline"/>`
*and* `<w:u w:val="single"/>` for any text carrying `underline_mark`.
Importer recognizes either form (style ref OR direct prop) as the mark.

## 2026-05-08: Node.js v24.15.0 LTS, installed user-local

Installed Node.js LTS to `~/.local/opt/node-v24.15.0-linux-x64/`,
symlinked binaries into `~/.local/bin/`. No system-wide install (no
sudo available). This affects only the project owner's user account.

## 2026-05-08: Schema design — heading-level nodes are flat paragraphs

Initial schema design had pocket/hat/block as tree containers with
their `inline` content nested inside. But docx represents these as
*paragraphs with Heading1-3 styles in document order*, with hierarchy
implicit via outline level — there is no docx-level "Pocket contains
Hat" containment. Round-tripping the tree-container model would
require synthesizing/dropping container boundaries on import/export,
which is awkward.

Resolution: pocket / hat / block / analytic / undertag are flat
paragraph nodes with `inline*` content. Card *is* a tree container
because the user values cards as objects (move-card, send-to-speech).
The "Pocket contains the following Hats and Blocks" tree-shaped view
is built dynamically by the navigation panel, not stored in the
schema.

Trade-off: the schema doesn't enforce well-formed outline hierarchy
(can't say "a Block inside a Pocket can't have a Hat between them").
That validation, if needed, lives at a higher layer.

## 2026-05-08: Cite paragraph classification on import is heuristic

When the importer sees `Tag → Normal → Normal → ...`, it classifies
the FIRST Normal as `cite_paragraph` and subsequent Normals as
`card_body`. Real docs always or nearly-always have this shape, so
the heuristic is fine for v0. A smarter classifier (text-shape based)
can replace it later if we encounter mis-classifications.

## 2026-05-08: Paragraph-default rPr inheritance with named-style guard

Real docx files (per `NOTES-verbatim.md §6`) put mass-applied
formatting on a paragraph's default run properties (`<w:pPr><w:rPr>`),
not per-run. Runs inherit these unless they specify a conflicting
property.

Subtle bug discovered during round-trip testing: named-style marks
(cite_mark, underline_mark, emphasis_mark, undertag_mark, analytic_mark)
all map to the same OOXML slot — `<w:rStyle>`. A run can only carry
one rStyle. If the paragraph default has rStyle=StyleUnderline and a
run has rStyle=Style13ptBold, naive merging gives the run BOTH marks
in our schema, but on re-export only one rStyle is emitted, silently
dropping the other.

Fix: in `mergeMarks`, named-style marks are treated as a single slot.
If a run has any named-style mark, ALL named-style marks from
defaults are dropped (run wins). Other mark types (highlight, bold,
font_color, etc.) merge normally.

Round-trip on real docs confirmed: all 126 tests pass with the merge
fix in place.
