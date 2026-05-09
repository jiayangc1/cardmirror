# Implementation plan

Tracking what's planned, what's in progress, what's done. Living
document — update as we go.

Reference docs:
- [`PROJECT.md`](./PROJECT.md) — objectives
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — design decisions
- [`NOTES-verbatim.md`](./NOTES-verbatim.md) — Verbatim docx data model
- [`NOTES-custom-macros.md`](./NOTES-custom-macros.md) — Advanced Verbatim feature inventory
- [`DECISIONS.md`](./DECISIONS.md) — implementation decision log

## Build order (per ARCHITECTURE.md §2)

1. **Schema** — typed-tree definitions, validation, ID generation.
2. **Exporter** — schema → OOXML, tested by hand-constructing schema
   trees and verifying docx renders correctly.
3. **Importer** — OOXML → schema, tested via round-trip on the
   example docs.
4. **Editor** — once schema is proven sound under round-trip.

Round-trip is the dominant correctness criterion; everything else
serves it.

## Phases

### Phase 1: Project scaffolding ✅
- TypeScript + Vite + Vitest config — done.
- Folder structure — done (`src/`, `tests/`, `benchmarks/`, `bin/`).
- Initial dependencies installed.
- Node.js 24 LTS installed user-locally (no sudo available).

### Phase 2: Schema ✅
- ProseMirror schema (`src/schema/`) — done.
- Stable heading IDs via `crypto.randomUUID()` — done.
- 27 schema unit tests — passing.

### Phase 3: OOXML utilities ✅
- Zip read/write via jszip (`src/ooxml/docx.ts`) — done.
- XML parse/emit (`src/ooxml/{parse,xml}.ts`) — done.
- Canonical Verbatim styles.xml (`src/ooxml/styles.ts`) — done.

### Phase 4: Exporter ✅
- Schema tree → document.xml (`src/export/exporter.ts`) — done.
- Static styles.xml block (canonical Verbatim) — done.
- Heading bookmarks (`pmd-heading-<uuid>`) — done.
- Hyperlink relationship registration — done.
- 30 exporter unit tests — passing.

### Phase 5: Importer ✅
- .docx → schema tree (`src/import/importer.ts`) — done.
- Style mapping (Heading1 → pocket, Style13ptBold → cite_mark, etc.) — done.
- Direct formatting → marks — done.
- Card grouping pass (Tag → card boundary) — done.
- Hyperlink rels resolution — done.
- 33 importer unit tests — passing.

### Phase 6: Round-trip tests ✅
- 18 real-doc structural round-trip tests — passing.
- 13 mark-fidelity round-trip tests — passing.
- 5 structural validity tests — passing.
- All three example docs round-trip with exact preservation of:
  structural counts, heading IDs, text length, named-style emphasis,
  direct-formatting marks, #555555 reference text, #D2D2D2 shading.

### Phase 7: Performance benchmarks ✅
- `benchmarks/round-trip.bench.ts` — done.
- Baseline: Aff (1.8 MB) round-trips in ~826 ms, DA (1.0 MB) in ~642 ms,
  CP (252 KB) in ~130 ms. Well within tolerable bounds for v0.

### Phase 8: Editor (basic) ✅
- `index.html` + `src/editor/` — minimal browser editor.
- ProseMirror EditorView with our schema.
- Default rendering matches Verbatim canonical layout (Pocket box,
  Hat centered double underline, Block centered single underline,
  Tag bold, Analytic dark blue, Undertag green italic).
- Drop-a-docx-to-load + click-to-export buttons.
- Vite build succeeds (366 KB JS bundle, 112 KB gzipped).
- This is *visual sanity check* level — editing UX features
  (NodeViews, navigation panel, drag-drop, read mode, etc.) are still
  later work per `ARCHITECTURE.md`.

## Test counts

```
schema/schema.test.ts                       27 tests
import/importer.test.ts                     33 tests
import/merge-marks.test.ts                   6 tests
export/exporter.test.ts                     30 tests
round-trip/real-docs.test.ts                18 tests
round-trip/mark-fidelity.test.ts            13 tests
round-trip/structural-validity.test.ts       5 tests
─────────────────────────────────────────
total                                      132 tests, all passing
```

## Out of scope for this autonomous session

(per `ARCHITECTURE.md §17`)

- NodeViews + interactive editing UX polish (the editor only renders
  the schema; commands beyond base undo/redo/text-input aren't wired)
- Multi-doc workspace coordinator
- Read mode CSS-class toggle UI (CSS hooks placed; trigger pending)
- Send-to-speech command + speech-doc UX
- Search index (workspace or corpus)
- Transclusion picker / back-ref tracking
- Drag-and-drop within and between docs
- Navigation panel / outline view
- AI-assisted formatting
- Desktop / web platform packaging
- Stylepox cleaner v2 (current: aggressive cleanup as a side effect of import)

## Known limitations / TODOs identified during this session

- **Cite-paragraph round-trip is heuristic.** When the importer sees a
  Tag followed by a Normal-styled paragraph, it classifies the Normal
  as `cite_paragraph` (always, for v0). A smarter heuristic could
  classify based on content shape (short, ends with date or URL).
- **Schema doesn't preserve cite_paragraph distinctly across round-trip
  if the input was hand-constructed without a tag.** A standalone
  `cite_paragraph` exports as a Normal paragraph and re-imports as
  `paragraph` (since there's no signal to mark it as a cite). Since
  cite_paragraph virtually never appears outside a card in practice,
  this is fine.
- **No table support yet.** Aff has 2 tables, DA/CP have none. The
  importer currently skips `<w:tbl>` elements silently. Real fidelity
  for tables is a v2+ feature.
- **No image support yet.** Aff has 9 images, DA has 3, CP has 0. Same
  treatment as tables — silently dropped on import.
- **No comments support yet.** Per ARCHITECTURE.md §17, comments
  preservation through round-trip without rendering is the goal; not
  implemented yet.
- **No pilcrow round-trip yet.** Schema slot exists in design notes;
  no node defined in v0 since real corpus has zero pilcrows.
- **Run-merging on import not implemented.** Adjacent same-marks runs
  remain as separate ProseMirror text nodes (PM doesn't auto-merge
  these in `createChecked`). Output XML still gets one run per text
  node. Cosmetic, not correctness-affecting.
- **No paragraph-level inheritance for paragraph-default rPr.** If a
  paragraph has default run properties on `<w:pPr><w:rPr>` (e.g. mass
  highlighting), runs without their own properties don't inherit them
  yet. Real docs do use this pattern (see survey). To fix when we
  encounter a doc whose round-trip degrades because of it.
