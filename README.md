# CRMMS ESP Visualization Tool

A serverless, client-side web application for visualizing and analyzing RiverWare **RDF** (RiverWare Data Format) ensemble streamflow forecast outputs — specifically CRMMS ESP (Colorado River Mid-term Modeling System Ensemble Streamflow Prediction) runs for Lake Powell, Lake Mead, and Lower/Upper Colorado River Basin reservoirs.

The tool renders interactive preset plots, slot analysis tables, operating condition probability matrices, reservoir summary pages, and printable PDF reports **entirely in the browser** without requiring a Python backend, database, or server installation.

---

## Key Features

- **100% Client-Side / Zero Install:**
  - Fast, in-browser parsing of RiverWare `.rdf` files using a pure JavaScript state machine.
  - No Python, Node.js, or server build step required — runs from any static file server or by opening `index.html` locally in a modern browser.
- **Dual Ingestion Modes:**
  - **Web-Served Mode:** Automatically fetches configured RDF files (`data/res.rdf`) on page load.
  - **Local Disk Mode (`file:///`):** Drag and drop one or multiple `.rdf` files or click to browse.
- **In-Memory File Registry & Manager:**
  - Additive multi-file merging (`mergeFiles`) with deduplication across runs.
  - Toolbar **Files (N)** manager popover: view loaded files, slot/trace counts, remove individual files (`✕`), or unload all data.
- **Interactive Visualizations (Plotly.js):**
  - **Chart Types:** Line (timeseries), Scatter (X vs. Y correlation), Bar (annual), Stacked Bar (multi-slot mass balance / storage components), and Box plots.
  - **Ensemble Cloud / Percentile Bands:**
    - Visualizes the 10th and 90th percentile envelope with distinct dotted boundaries.
    - 50th percentile (Median) center curve.
    - Filters out deterministic runs (Traces 1–3: Min, Most, Max) and computes statistical quantiles across historical ensemble traces (Traces 4–33: 1991–2020), matching Reclamation R script workflows.
    - Dedicated hover tooltips for statistical contours.
  - **Stacked Bar Trace Sorting:**
    - Sort stacked and standard bar charts by trace number, ascending value, descending value, or individual component slot.
    - Uses categorical axis ordering with historical hydrology trace years (1991–2020) displayed along the x-axis.
  - **Annual Timestep Detection:** Automatically detects native annual slots (`time_step_unit: year` or year-end timestamps) and provides an interactive Year selector.
- **Table Engines:**
  - **Slot Analysis Tables:** Monthly, Water Year (WY), Calendar Year (CY), or annual summary rows; customizable aggregation statistics (`Sum`, `Average`, `Minimum`, `Maximum`, `End of period`). Respects period-end boundaries (December for CY, September for WY).
  - **Operating Condition Probability Tables:**
    - Standard Reclamation operating condition / tier probability matrix across run years (e.g. 2026–2031).
    - Percentage calculation across active ensemble traces: $\frac{\sum \text{flags}}{\text{active traces}} \times 100$.
    - Shaded section header banners and indented sub-rows.
    - Arithmetic formula row evaluation (`+`, `−`, `×`, `÷`, `(`, `)`) across slots (e.g., `[UpperBalancing] - [Balancing823]`, `100 - [EqTier]`).
    - Interactive **Formula Assistant** to select and insert slots and operators.
    - In-place row editing (`✎`), row reordering (`↑`/`↓`), row deletion, and TSV/CSV export.
- **Global Cross-Highlighting & Data Tables:**
  - Click any trace in a plot or cell in a table to highlight that trace (teal) and dim all others across the entire page.
  - Excel-style multi-region drag selection with live summary statistics (Count, Sum, Avg, Min, Max) and TSV clipboard copy (`Ctrl+C`).
- **Reservoir System Pages:**
  - Accordion views organized by major reservoirs (Powell, Mead, Fontenelle, Flaming Gorge, Blue Mesa, Morrow Point, Crystal, Navajo, etc.).
- **Printable Report Builder:**
  - Generate full-page executive summaries with editable title, notes, and assumptions, high-resolution chart snapshots, and paginated data tables ready for PDF export.

---

## Repository Structure

```text
.
├── index.html               # Main viewer HTML shell, CSS styling, and CONFIG ZONE
├── parser.js                # RiverWare RDF state-machine parser and multi-file merger
├── plots.js                 # Plot transforms, Plotly rendering, and card controls
├── tables.js                # Slot analysis and Operating Condition probability engines
├── data-tables.js           # Global data tables and Excel-style cell selection
├── reservoir.js             # Accordion card pages for basin reservoirs
├── toolbar.js               # Toolbar UI, trace visibility filters, and file popover
├── report.js                # Printable report overlay generator
├── bootstrap.js             # File registry, model lifecycle, and boot logic
├── standalone-app-readme.md # Detailed technical architecture & developer reference
└── data/                    # (Optional) Default folder for auto-loaded .rdf files
    └── res.rdf
```

---

## Quick Start

### 1. Running Locally (No Web Server Needed)
1. Clone or download this repository.
2. Double-click `index.html` to open it in Google Chrome, Microsoft Edge, or Mozilla Firefox.
3. Drag and drop one or more `.rdf` files (e.g. `res.rdf`) onto the drop zone, or click **Browse for files…**.
4. The application will immediately parse the data, display the model run date (e.g. `Model run: July 2026`), and populate your charts and tables.

### 2. Serving via Local HTTP Server (Recommended for Development)
To enable automatic background loading from the `data/` directory:
```bash
# Using Python 3
python -m http.server 8000

# Or using Node.js / npx
npx serve .
```
Navigate to `http://localhost:8000/` in your browser.

---

## How to Use

### Navigating Presets
- Use the top navigation bar to switch between configured **Plot Presets**, **Table Presets**, and **Reservoir Pages**.
- Click **Traces** in the toolbar to toggle deterministic runs (Min, Most, Max) or isolate individual ensemble hydrology traces.
- Click **Files: N** in the toolbar to view loaded RDF files, add more files, or unload specific runs.

### Customizing Plots
- Click **Plot settings** (⚙) on any chart card to adjust:
  - Plot type (Line, Scatter, Bar, Stacked bar, Box)
  - Aggregation transform (Raw, Water Year Sum, Calendar Year Sum)
  - Unit scaling factor, offset, and display label
  - Y-axis limits and X-axis date range
  - Reference lines (horizontal thresholds or vertical date markers)
  - Percentile bands (toggle cloud, configure low/high quantiles)
- Use the **Year** dropdown on bar and stacked bar charts to inspect specific annual timesteps.

### Working with Tables
- **Slot Analysis Tables:** Use the **Filter & aggregate** panel to configure row basis (Monthly, CY, WY), period-end vs. sum statistics, year filters, and conditional value filters.
- **Operating Conditions Tables:**
  - View tier probabilities across all active ensemble traces.
  - Click **+ Add row** to create a Section Header, Slot Flag condition, or Formula expression.
  - Click **✎** on any row to edit its label, formula, or indent level in place.
  - Click **Copy for Excel** (TSV) or **Download CSV** to export data.

---

## Data Model & Conventions

- **Trace Mapping:**
  - Traces 1–3: Deterministic scenarios (Min, Most, Max). Opt-in via Traces filter.
  - Traces 4–33: Ensemble ESP historical hydrology runs corresponding to water years 1991 through 2020.
- **Reservoir Non-Sum Slots:** Slots representing state variables (Pool Elevation, Storage, Surface Area, Power Plant Cap Fraction, Peak Flow) automatically coerce to end-of-period statistics rather than summations.
- **Period Boundaries:** Calendar Year "End of Period" statistics strictly enforce December (month 12) data presence; Water Year enforces September (month 9) data.
- **State Storage:** User card customizations are stored in `sessionStorage` (`crmmsPlotterUI.session.v1`), ensuring adjustments persist while switching tabs during a session, while page refreshes always start clean from `index.html`.

---

## Technical Documentation

For in-depth developer documentation, architecture specifications, and engineering gotchas, refer to:
- [`standalone-app-readme.md`](standalone-app-readme.md): Architecture overview, file breakdown, and engineering gotchas.

---

## License & Attribution

Developed for the U.S. Department of the Interior / Bureau of Reclamation Colorado River Mid-term Modeling System (CRMMS) workflows.
Built with [Plotly.js](https://plotly.com/javascript/). Pure client-side open web technologies (HTML5, ES6 JavaScript, CSS3).