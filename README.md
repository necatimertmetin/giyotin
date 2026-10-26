# Giyotin (Guillotine Paper Cutting Optimizer)

A browser-based tool for print shops. Given an order (many rectangular products with quantities) and an
inventory of paper sheets and reusable offcuts, it computes **guillotine-executable cutting plans** that
consume as little material as possible, shows them to scale, walks the operator through the cuts, and – once
a plan is confirmed – updates the inventory and keeps reusable offcuts for the next job.

The user interface is in **Turkish**; code identifiers and this documentation are in English.
No LLM, AI API or other external service is used – all optimisation runs locally and is deterministic.

## Quick start

Requirements: Node.js ≥ 22.13 (developed on 24; SQLite comes from the built-in `node:sqlite`, no native build).

```bash
npm install
npm run dev          # API on :3001, Vite dev server on http://localhost:5173
```

Production-style run (single process, serves the built client):

```bash
npm run build        # client -> dist/client, server -> dist/server
npm start            # http://localhost:3001
```

Environment variables: `PORT` (3001), `HOST` (0.0.0.0), `DB_PATH` (`data/giyotin.db`), `SEED=0` to skip
the sample data that is created on the first start of an empty database.

```bash
npm run typecheck    # strict TypeScript
npm test             # Vitest: engine, geometry, property-based, reference solver, server/DB
npm run test:e2e     # builds, then Playwright (Chromium) end-to-end workflow
npx playwright install chromium   # once, before the e2e tests
```

## Browser-only build (GitHub Pages)

`npm run build:pages` builds a version that needs no server: the same route handlers run in the page on an
sql.js (SQLite → WebAssembly) database stored in IndexedDB, and the optimiser runs in a Web Worker. It is served
under `/giyotin/` with hash URLs (`#/yeni-is`). Data lives only in the visitor's browser; the first visit is seeded
with the sample data. `npm run preview:pages` serves it locally, `npm run deploy:pages` publishes `dist/pages`
to the `gh-pages` branch. The server build (`npm run build && npm start`) is unchanged.

## Using it

1. **Kağıt Envanteri** – add sheets (preset A0–A10, B0–B10, US Letter/Legal/Tabloid/Executive or custom
   formats; width/height are always editable). Quantity, unit cost, GSM, colour, finish and grain
   direction are optional attributes. Stock with the same name + GSM + colour + finish is the same *material*.
2. **Yeni Kesim İşi** – enter/save an order (product, size, quantity, rotation, required material), adjust the
   cutting settings and press *Kesim planı oluştur*. Changing the order or any setting (e.g. the kerf)
   recalculates automatically. Up to six alternative plans are compared (material consumed, cost, waste,
   reusable offcut area, number of cuts); the best value per criterion is marked.
3. **Kesim Planı Detayı** – to-scale SVG of every sheet (zoom, pan, fit, minimap), selectable pieces/cuts/offcuts,
   *Adımlar* (step-by-step cutting instructions), *Ağaç* (the cut tree) and *Artık* tabs.
4. **Planı onayla** – only now is stock consumed (in one transaction). Offcuts can be added to the inventory
   immediately or later from the job page.
5. **Artık Parçalar** – offcut inventory, separate from full sheets; offcuts can be excluded (damaged, reserved)
   and are automatically used by later optimisations, never mixed across materials.
6. **Kesim Geçmişi** – every confirmed job with its original plan, independent of later stock edits.

## Architecture

```
src/engine/      pure TypeScript optimisation engine (no React/DOM/network) – unit tested on its own
  types.ts       domain model: PieceSpec, StockSpec, cut tree (CutNode/PieceNode/OffcutNode/WasteNode), Plan
  geometry.ts    integer grid, cut geometry (kerf), orientation/grain rules, tree walking, area accounting
  sheetSearch.ts single-sheet beam search producing guillotine trees
  optimizer.ts   multi-sheet allocation, objective profiles, local improvement, plan assembly
  validate.ts    independent validator of every geometric/accounting invariant of a Plan
  reference.ts   exhaustive reference solver for tiny single-sheet instances (tests only)
src/shared/      paper presets and API DTOs shared by client and server
server/          Fastify API + SQLite (node:sqlite); optimisation runs in a worker thread
src/client/      React + MUI (v7) single-page app, SVG cutting-plan viewer
tests/           Vitest suites;   e2e/  Playwright workflow tests
```

### Data model and integrity

* **Preview ≠ confirmation.** `POST /api/optimize` only stores an `optimization_runs` row; it never touches stock.
  `POST /api/runs/:id/confirm` re-validates the plan with the engine validator, checks that the stock rows are
  unchanged (version counter) and sufficient, decrements quantities, writes the job + offcut rows, and marks the
  run as confirmed – all inside one `BEGIN IMMEDIATE` transaction. A second confirmation returns `409`.
* **History survives edits.** A job stores a full snapshot of the engine input (stock attributes at that time)
  and the plan with its cut trees. Stock deletion is a soft delete.
* **Offcuts** are leaves of the cut tree (never "empty areas"); they become stock only when approved, keep the
  material attributes of their source sheet and reference the source job.

### Geometry conventions

All lengths are mm; the engine works on an integer grid of 0.01 mm so there is no floating-point drift. A
cut node has a direction, a position (distance of the blade's leading edge from the region's left/top edge),
the kerf it consumes and two children. For a vertical cut at `p` in region `(x, y, w, h)`: first child
`(x, y, p, h)`, kerf strip `[x+p, x+p+k]`, second child `(x+p+k, y, w-p-k, h)`. If the remainder is not wider
than the kerf the blade simply hangs off the edge (`second = null`). Cut numbers are assigned depth-first
from the tree, so the shop-floor sequence is always derived from the real cut tree.
Area accounting per sheet: `pieces + kerf + unusable waste (incl. edge trim) + reusable offcuts = sheet area`.

## The optimisation algorithm (and its limits)

1. **Pre-flight** – every piece is checked (positive size, integer quantity, eligible material, fits at least one
   eligible stock item after edge trim, honouring rotation/grain). Problems are reported, the rest is optimised.
2. **Single sheet (`sheetSearch.ts`)** – beam search over *states* = open rectangular regions + remaining demand.
   A move either places a block of `cx × cy` identical pieces in the region's corner and separates it with two
   guillotine cuts (vertical-first or horizontal-first), or makes a pure guillotine cut at a *normal-pattern*
   position (sums of piece sizes + kerfs). Every state therefore is a valid recursive cut tree by construction.
   States are ranked by an optimistic bound, and each candidate is completed by a greedy rollout so that the
   ranking is based on achievable patterns; duplicates are pruned by (regions, demand) keys. Leaves that contain
   no piece are merged so that no useless cuts remain; leaves ≥ the minimum size become offcuts.
3. **Multi-sheet allocation (`optimizer.ts`)** – an outer beam search over (remaining demand, remaining stock)
   chooses, for every state, the best few patterns of every stock type and repeats a pattern as often as demand
   and stock allow. Offcuts are ordinary stock items, so they compete with full sheets. Demand beyond what one
   sheet can hold is capped to make single-sheet results reusable (cache).
4. **Objective** – lower is better: `(1−cw)·(stock area − credit·reusable offcut area) + cw·cost·areaPerCost +
   cutPenalty·cuts + 1000·unfulfilled area`. Completing the order dominates; then material (or cost when unit
   costs exist and the cost weight is raised); then reusable offcuts and the number of cuts. Several profiles
   (balanced, minimum material, minimum cost, maximum offcut, minimum cuts) are searched and the distinct
   results are offered as alternatives.
5. **Local improvement** – bounded: (a) every sheet's tree is re-searched with a wider beam for exactly the same
   pieces and replaced if better; (b) the last 1–3 sheet groups are undone and the rest of the plan is searched
   again with a wider beam (this also compares alternative stock formats and re-assigns pieces between sheets).

**Limitations.** The 2-D guillotine cutting-stock problem is NP-hard. The engine is a heuristic: it reports "the
best plan found within the search budget" and never claims optimality (`provenOptimal` is always `false`).
Only blocks of identical pieces are produced by the placement move (mixed rows come from consecutive moves),
pure cuts consider a limited number of positions, and the objective weights are fixed constants. On tiny
instances the engine is compared with an exhaustive solver (`reference.ts`): it was equal to the optimum in
all 300 random instances tried and never better (which would indicate an invalid plan). Results are deterministic
for identical input and settings unless the runtime limit is hit; the *seed* only breaks ties between equal scores.
Minimum acceptable piece sizes and grain handling on partially-rotatable stock are stored/modelled but grain
is only a hard constraint (no soft preference); minimum piece sizes are informational.

### Cutting settings

The UI exposes only what a print shop reasons about; settings are saved as named **profiles** (stored in SQLite).

| Setting | Meaning |
|---|---|
| Kerf (mm) | Material lost per cut; included in all fit checks and accounting. |
| Edge margin (mm) | Strip trimmed off all four edges of every stock item; counted as waste. |
| Min. offcut width/height | Leftover rectangles smaller than this (rotation-agnostic) are waste, not offcuts. |

Not user-facing (fixed by the app): rotation – every product and sheet may be turned by 90°; search effort
(beam width 6, 8 s limit – narrower beams measurably produce worse multi-sheet plans: 49 instead of 30 sheets on
the sample order); seed and cost weight keep their defaults. The engine still supports per-piece/stock rotation
flags, grain, cost weights and a seed through `CuttingSettings`; the API accepts them.

## API (JSON)

`GET/POST /api/stock`, `PUT/DELETE /api/stock/:id` · `GET/POST /api/papers`, `PUT/DELETE /api/papers/:id` ·
`GET/PUT /api/settings` · `GET/POST /api/orders`, `GET/PUT/DELETE /api/orders/:id` ·
`POST /api/optimize` → run with plans · `GET /api/runs/:id` · `POST /api/runs/:id/confirm {planId, approvedOffcuts[]}` ·
`GET /api/jobs`, `GET /api/jobs/:id` · `POST /api/jobs/:id/offcuts/:offcutId/add|discard`.

Example (preview an order for the current stock):

```bash
curl -s localhost:3001/api/optimize -H 'content-type: application/json' -d '{
  "orderId": null,
  "lines": [{"name":"Flyer","width":100,"height":150,"quantity":500,"notes":null,"allowRotation":true,
             "materialKey":null,"grain":"any","minWidth":null,"minHeight":null}],
  "settings": {"kerf":3,"edgeMargin":0,"minOffcutWidth":100,"minOffcutHeight":100,
               "maxRuntimeMs":8000,"searchWidth":5,"costWeight":0,"seed":1}}'
```

Using the engine directly:

```ts
import { optimize, validatePlan, DEFAULT_SETTINGS } from './src/engine';
const input = { settings: { ...DEFAULT_SETTINGS, kerf: 3 }, pieces: [...], stocks: [...] };
const result = optimize(input);
result.plans.forEach((p) => console.assert(validatePlan(p, input).length === 0));
```

## Tests

* `tests/geometry.test.ts` – cut geometry, kerf, orientation/grain, area accounting.
* `tests/optimizer.test.ts` – single pieces, rotation, multiple products/stocks, limited stock, kerf, margins,
  cut-sequence replay, offcut geometry and reuse, determinism, cancellation, comparison with the exhaustive
  reference solver, and property-based invariants (no overlap, inside the sheet, valid guillotine tree, counts
  reconcile) checked with an independent validator.
* `tests/server.test.ts` – preview never mutates stock, transactional confirmation incl. rollback on failure,
  double-confirmation guard, stale-stock detection, offcut lifecycle and reuse, history integrity.
* `e2e/workflow.spec.ts` – create order → plan → preview → inspect/step through cuts → confirm → offcut → reuse.

## Known limitations of this release

* Single user, no authentication (intended for a LAN / single workstation).
* Pieces are plain rectangles; no bleed/gutter handling, no multi-pass stack-height (cutter capacity) rules.
* Offcut records are not merged; each approved leaf becomes its own stock row.
* The grain setting is a hard rule on stock/pieces that declare it; mixed-grain optimisation preferences are not modelled.
