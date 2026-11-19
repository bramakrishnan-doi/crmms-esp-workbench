# CRMMS ESP Standalone RDF Plot Viewer — App Overview

Reference document for the standalone viewer application. Written for anyone
(including AI assistants) picking up development of the viewer; describes what
the app is, how it is structured, what every feature does, and which behaviors
are deliberate.

---

## 1. What it is

A **serverless web application** for plotting RiverWare **RDF** (Riverware
Data Format) ensemble forecast output — the CRMMS ESP (Ensemble Streamflow
Prediction) runs for the Colorado River basin (Lake Powell / Lake Mead and
tributary reservoirs). It renders the same preset plots, tables and analysis
recipes as the CRMMS ESP Compare & Report Builder desktop application
(FastAPI/Python), but entirely **client-side in the browser**: no server, no
backend, no install. All parsing, transforms, plotting, aggregation, export
and report generation happen in JavaScript in the page.

**Two operating modes, one code path:**

- **Web-served mode** (any static file server): the RDF files listed in the
  `RDF_FILES` config array are fetched same-origin automatically on page load —
  the page comes up fully populated with **zero clicks**.
- **Disk mode** (`file://` double-click): browsers block automatic file
  reading, so the page falls back to a **drag-and-drop / file-picker zone**
  (same parser pipeline; files are processed locally, nothing is uploaded).

---

## 2. File layout

The application is a **folder of 10 files** that must stay together
(classic `<script src>` tags — no bundler, no build step, works from disk):

| File | Size | Role |
|---|---|---|
| `index.html` | ~42 KB | CSS + page markup + the **CONFIG ZONE** (see §3) |
| `plotly.min.js` | 4.8 MB | Plotly 3.3.1, verbatim library — **never edited** |
| `parser.js` | ~15 KB | RDF parser (`parseRdf`) + multi-file merge (`mergeFiles`) |
| `plots.js` | ~58 KB | Transforms, plot engine, shared UI state, chart controls, plot cards |
| `tables.js` | ~45 KB | Table-preset engine (Slot Analysis, Operating Condition Probability matrix) |
| `reservoir.js` | ~9 KB | Reservoir card pages engine |
| `toolbar.js` | ~8 KB | Toolbar (trace visibility, layout, add plot, files popover, reset) |
| `data-tables.js` | ~27 KB | Global data table, Excel-style cell selection, scatter data tables |
| `report.js` | ~6 KB | Printable report overlay builder |
| `bootstrap.js` | ~11 KB | `loadedFiles` registry, `model`, `loadData`, `boot()`, drop zone — **must always be the last script tag** |

Scripts load in the order listed (parser → plots → tables → reservoir →
toolbar → data-tables → report → bootstrap). They are classic scripts sharing
one global lexical scope, so top-level `const/let` declared in one chunk is
visible to the others; the only top-level *executable* code is the DOCS wiring
inside `index.html` and the final `loadUiState(); setupDropZone(); boot();`
in `bootstrap.js`.

---

## 3. Configuration zone (in `index.html`)

Near the end of `index.html`, under a "CONFIGURATION — EDIT THIS" banner, is a
deliberately **pure-data** block (no code identifiers) that a non-programmer
edits by hand:

- `RDF_FILES` — array of paths relative to the HTML file,
  e.g. `["./data/res.rdf"]`. Multiple files are merged into one combined run.
- `PAGE_TITLE` — browser tab / header title.
- `DOCS_URL` — optional link shown as "User guide" in the header; empty hides it.
- `RESERVOIR_PAGES` — array of `{id, name, kind: "data"|"charts", reservoirs[],
  slots[]}`; each entry generates one button in the Tables/Plots bar (see §6).
- `DEFAULT_PRESET` — optional preset `id` to open on load.
- `const PRESETS = /* PRESETS:START */[...]/* PRESETS:END */;` — plot presets.
- `const TABLE_PRESETS = /* TABLE_PRESETS:START */[...]/* TABLE_PRESETS:END */;`
  — table presets (Slot Analysis or Operating Condition Probability matrices).

**Critical layout rule:** the `/* MARKER:START/END */` comments must hug ONLY
the array literal, never the `const x =` declaration. An external offline tool
(the Preset Builder, a separate HTML file) splices updated preset arrays
between those markers; a declaration-wrapping layout once produced a corrupted
file and is now explicitly rejected by that tool.

### Preset schema (shared vocabulary with the desktop app)

**Plot presets:**
`{id, name, description, layout: {columns, plot_height}, plots: [...]}` where
each plot item has `slot` (required), `plot_type` (line / scatter / bar /
stacked / box), `transform` (raw / water_year_sum / calendar_year_sum /
annual_sum ...), optional `components` (for stacked bar), optional `y_slot`,
scaling, reference lines (`value | label | color | dash | width | axis` —
`axis: "x"` gives a vertical line at a date/label; an explicitly empty label
renders no label), and per-plot titles.

**Table presets (two distinct kinds):**

1. **Standard Slot Analysis Tables:**
   `{id, name, description, tables: [...]}` where each block has
   `slot`, `rows` (monthly / water_year / calendar_year / annual), `stat`
   (sum / avg / min / max / end), `wyTotals`, `cyTotals`, `title`, `decimals`,
   `filters` (traces / yearFrom / yearTo / months / conditions / logic), and
   `pageFilter` (`{op, value, value2, mode: "filter"|"highlight"}`).

2. **Operating Condition Probability Tables:**
   `{id, name, type: "probability_matrix", description, notes: [...], rows: [...]}`
   where each row definition has:
   - `{type: "header", label, color}` — Section header banner row with
     background shading (`#fff2cc` yellow, `#f2f2f2` gray, etc.).
   - `{type: "slot", label, slot, indent}` — Single flag slot row displaying
     the percentage of active ensemble traces where flag is `1` (or `> 0`).
   - `{type: "formula", label, formula, indent}` — Computed row evaluating an
     arithmetic expression of slot percentages or raw counts across run years
     (e.g. `[Powell.Tier1] + [Powell.Tier2]`, `[UpperBalancing] - [Balancing823]`,
     `100 - [EqTier]`).

---

## 4. Data model & file registry

- **In-Memory File Registry (`loadedFiles = new Map<fileName, parsedFile>()`):**
  Files added through the initial drop zone, the toolbar **"+ Add RDF files"**
  picker, or global window drag-and-drop are held in an in-memory registry map.
  Adding an RDF merges it into the registry; `mergeFiles([...loadedFiles.values()])`
  recomputes the unified model without dropping previously loaded slots or
  forcing preset resets.
- **File Management:** Toolbar **"Files: N"** popover lists all currently loaded
  RDF files by name with their slot/trace counts, per-file `✕` unload buttons,
  and an "Unload all" action.
- **Traces & Slots:** RDF files parse into **traces** and **slots**. Trace 1 is
  the ensemble; explicit **Max / Min / Most** traces exist and are opt-in.
  The real test dataset: 32 traces (30 ensemble ESP 1991–2020 + 2 deterministic),
  103 slots, monthly, March 2023 → September 2028.
- **Trace visibility defaults to ensemble-only.** Max/Min/Most appear only if
  ticked in the Traces popover. Storage semantics: `null` = "never set" (gets
  defaulted), array = explicit persisted choice.
- **Timestep support:** Supports both standard monthly timesteps and native
  **annual timesteps** (`time_step_unit: year` or single annual endpoints such as
  `YYYY-12-31`). Annual slots are automatically detected and handle annual-year
  selection without monthly aggregation.
- Literal `NaN` lines occur in real RDF (e.g. `MorrowPoint.Bank Storage`);
  both parser paths exclude non-finite values.
- **All-zero slots plot as invisible bars** — the page adds an amber "all
  plotted values are zero" note. Always inspect the data before assuming a
  rendering bug.
- Package `create_date` metadata becomes the "Model run: <Month Year>" header
  badge (latest across merged files).
- RiverWare monthly data sits on **month-end dates** — vertical reference
  lines for a specific month must use the month-end ISO date (`2024-07-31`).

---

## 5. Feature inventory

**Plots (Plotly 3.x, `react()`):**
- Per-card "Plot settings" panel (plot type, transform, axes, x-range, unit
  scaling, reference lines incl. vertical, X/Y axis titles).
- On-plot **Year selector** for annual-sum bar/stacked/scatter plots and native
  **annual timestep bar charts** (`annual_year` / `scatter_year` overrides).
  Annual timestep slots automatically show the Year selector populated with
  the run years and hide irrelevant monthly aggregation toggles.
- **Stacked Bar Component Slot Picker:** Stacked bar cards include an "Add
  component slot" dropdown and "+ Add" button directly in card settings.
- **Categorical Bar Sorting:** Both single-bar and stacked-bar plots enforce
  Plotly `categoryorder: "array"` with the sorted trace-number array so bar
  sorting (by trace, ascending, descending, or slot) reorders bars reliably.
- Global trace-visibility popover; grid columns + plot height overrides;
  "Add plot" picker; per-card Remove; "Reset preset".

**Highlighting:**
Clicking a trace (or a value cell in any table) highlights that trace teal and
dims the others across ALL charts and tables; clicking again clears. The
highlight view shows a single combined table with one column per plotted slot,
built from `plottedSlots()` over `presetItems()` (which includes "Add plot"
additions — never iterate `preset.plots` directly).

**Tables (Slot Analysis & Operating Condition Matrix):**
- **Slot Analysis Tables:** monthly / WY / CY / annual rows; per-year
  statistic; **non-sum slots** (pool elevation, storage, surface area, power
  plant cap fraction, peak flow) coerce to end-of-period and offer no Sum;
  per-block "Filter & aggregate" panel; "+ Add slot table"; Remove on every
  block.
- **Operating Condition Probability Tables:**
  - Standard Reclamation tier/condition matrix across run years (e.g. 2026–2030).
  - Each cell displays the whole percentage of active ensemble traces meeting
    the condition: $\text{Percent} = \frac{\sum \text{flags}}{\text{active traces}} \times 100$.
  - Arithmetic formula row evaluation (`+`, `-`, `*`, `/`, `(`, `)`) across
    slots (e.g., combining mutually exclusive tiers or computing non-balancing
    remainders).
  - Shaded section header banner rows and indented sub-condition rows.
  - Interactive "+ Add row" panel (Slot, Formula, or Header), row reordering
    (`↑`, `↓`), row removal (`✕`), and "Reset table" to preset defaults.
  - "Copy for Excel" (TSV) and "Download CSV" buttons.
- **Value conditions** in Slot Analysis filters return trace::year **PAIRS** —
  matching trace columns AND matching year rows are kept, unmatched cells
  blanked (App analysis semantics; "any year" union semantics alone keep
  everything).

**Cell selection (Excel-style):**
Multi-region drag rectangles on all table types; floating stats bar (N / Sum /
Avg / Min / Max computed from displayed text, expanding fmtVal's B/M suffixes
and stripping commas); whole-row select via period cells, whole-column via
header click/drag (Ctrl adds/toggles); Copy → TSV (one block per region);
Escape / ✕ clears. Plain clicks still toggle trace highlight; selection state
must be cleared at the top of every re-render.

**Reservoir card pages** (generated purely from the `RESERVOIR_PAGES` config):
Cards per reservoir (Powell, Mead, Fontenelle, Flaming Gorge, BlueMesa,
MorrowPoint, Crystal, Navajo, TaylorPark, Vallecito, Mohave, Havasu) showing
which of Pool Elevation / Inflow / Outflow / Energy / Storage / Spill exist.
Cards are collapsed ("▸ Name  N slots"); clicking expands one accordion card
at a time. Kind "data": ticking a slot shows its table below; name click does
nothing, a "show all / hide all" link toggles all slots of that reservoir.
Kind "charts": a synthetic preset covering all page slots; ticking drives a
derived "removed" list while a checked-Set stays the source of truth, and
stable per-slot ids keep Plot-settings overrides across check/uncheck.
Each page has fully independent state.

**Report:**
"Build report" → full-page overlay with editable title / notes / assumptions
(drafts persisted), per-chart PNGs (`Plotly.toImage` scale 2), and the data
table split into chunks of 11 trace columns so it stays readable in print.
Print → browser "Save as PDF" via `@page { size: a4 portrait }`.
The overlay must be a **direct child of `<body>`** or the print rule blanks
the output.

**Look and feel:**
Inter font, ink `#122331` / line `#dbe5e9` palette, teal radial-gradient page
background, soft-shadow 16px-radius cards with `.card-head` header bars, boxed
collapsible settings panels, 1220px content width, Plotly SVG text styling
forced to match the surrounding CSS.

---

## 6. State model & persistence

- **Session-only persistence for presets (`sessionStorage`):**
  In-browser preset overrides (card settings, added plots, slot changes) are
  stored in `sessionStorage` (`crmmsPlotterUI.session.v1`), meaning adjustments
  stay intact while navigating between tabs and presets during a session, but
  **a page reload or unloading data starts fresh from the presets in `index.html`**.
  Any legacy `localStorage` preset overrides are automatically purged on load.
- **Safe slot fallback:** If an in-session override points to a slot not
  present in the currently loaded model, the card gracefully falls back to the
  preset's default slot rather than failing or disappearing.
- **localStorage (`crmmsPlotterUI.v1`):** Retains strictly global user
  viewing preferences (`tracesVisible`) across sessions. `crmmsPlotterUI.report`
  retains report drafts.
- **In-memory Maps (cleared on preset change / reload):**
  `tableBlockSession` Map, `probabilityTableSession` Map, session-added tables,
  `removedPresetBlocks` Set, reservoir page state Maps, `viewMode`.
- `viewMode`: `"plots"` | `"tables"` | `"reservoirs"` | `"reservoirCharts"`;
  the global data table section is visible only in plot mode.

---

## 7. Debug & testing hooks

- URL `?debug=1` exposes `window.__RDF_DEBUG__` (parsed files + slot data) for
  cross-checking parsed values against ground truth.
- Known-good verification: a synthetic 2-file RDF fixture with a
  Python-generated ground truth matched **21,168 data points exactly**.
- Local serving for tests: `py -3 -m http.server <port>` in the app folder;
  open `http://127.0.0.1:<port>/`.

---

## 8. Engineering gotchas (apply automatically when editing)

1. **Plotly 3 `react()` clears inline styles — re-assert
   `plotDiv.style.height` before EVERY draw**, or plots collapse to zero
   height.
2. `#reportOverlay` must be a **direct child of `<body>`**; nested inside
   `.wrap` the print rule hides its own ancestor → blank PDF.
3. DOM-rebuild functions must **clear their container first** — but never wipe
   a container that also holds controls appended elsewhere (the "+ Add slot
   table" row once got erased by an empty-state branch).
4. Delegated listeners attach only to nodes that **survive re-renders** (the
   stable `#dtTables` container), never per-render ids. The `#dataTable` id no
   longer exists — style/script tables via `.data-table` /
   `.scatter-points-table`.
5. Checkboxes must set `.checked`, not `.value` — re-renders silently reset
   state otherwise.
6. Wide tables inside grid tracks need `minmax(0, 1fr)` + `min-width: 0`, or
   the track sizes to the table's min-content width and pushes page-wide
   scroll.
7. Verify features through the **real UI click path** (buttons, tabs), not by
   calling render functions directly — direct calls once hid a ReferenceError
   for two builds.
8. Grep removed/renamed identifiers after refactors — an undefined helper
   called inside `loadData` once silently killed all rendering.
9. Shared controls with a hard-coded "re-render X" must be audited for every
   `viewMode` that hosts them.
10. When a click target's behavior moves (header → value cell), migrate every
    table variant sharing that header in the same change.
11. **Bar & Stacked Bar Sorting on Categorical Axes:** Always ensure
    `xaxis.type = "category"` and pass `categoryorder = "array"` with the
    explicitly sorted `categoryarray = [...]` list to Plotly layout; otherwise,
    Plotly positions bars along a numeric axis by trace-number value, ignoring
    array sort order.
12. **Picker `<select>` in Card Settings:** Controls intended solely as action
    pickers (such as the stacked-bar "+ Add component slot" dropdown) must
    **NOT** have a `data-field` attribute; otherwise, `readCardControls()` will
    sweep their temporary value into the saved preset item on every panel change.
13. **Session vs. Local Storage for Presets:** Preset card adjustments must
    always use `sessionStorage`, never `localStorage`. Storing card overrides in
    `localStorage` causes stale edits to persist across page reloads and breaks
    preset rendering when switching RDF runs.
14. **End of Period Statistic Requirements:** For monthly slots aggregated to
    Calendar Year (`calendar_year`), the "End of period" (`stat: "end"`) statistic
    strictly requires December (month 12) data. For Water Year (`water_year`), it
    strictly requires September (month 9) data. If a run terminates prior to the
    period's ending month (e.g. data ends in September for a calendar year), the
    end-of-period value evaluates to `null` (`—`) rather than mistakenly taking
    the last available monthly timestep in the file. If no traces possess data for
    that ending period, the incomplete period row is cleanly omitted.

---

## 9. Deliberate behaviors — do not "fix" without asking

- Ensemble-only trace visibility default; Max/Min/Most are opt-in.
- Value conditions blank trace::year pairs (pair semantics), not whole rows.
- Non-sum slots coerce to end-of-period aggregation.
- Scatter y-title fallback is `y_slot (unit)` (desktop app uses unit only).
- Scatter default year on year-sum axes is the earliest year (desktop app's
  quirk, kept intentionally).
- Operating Condition Probability table rows always display whole percentages
  relative to currently active/visible ensemble traces.
- The hosted page is view-only for permanent presets; preset composition
  happens in the separate Preset Builder tool (`preset-builder.html`) and is
  pasted back through the markers (§3).
