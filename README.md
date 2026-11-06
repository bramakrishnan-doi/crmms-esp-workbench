# CRMMS ESP Workbench

**Compare, explore, and report on CRMMS ESP model runs.**

CRMMS ESP Workbench is a local Windows web application for reviewing CRMMS
Ensemble Streamflow Prediction (ESP) model output. It compares two runs,
summarizes the standard Lake Powell and Lake Mead metrics, lets you inspect any
RiverWare RDF `Object.Slot`, and produces a formatted Word report.

The application UI and FastAPI service identify themselves as **CRMMS ESP
Compare & Report Builder**.

## Features

- Compare Run A and Run B from RiverWare `.rdf` files or legacy
  `EnsembleOutput.xlsx` workbooks.
- Use one or many RDF files per run, with exact `Object.Slot` mappings.
- Preserve RiverWare trace numbers and optionally map Trace 4 through Trace 33
  to ESP years 1991 through 2020.
- Review standard comparison sections for Lake Powell, Lake Mead, lower-basin
  conditions, and flow analysis.
- Add custom slot tables with selectable statistics.
- Add custom line, box, or bar plots with independent trace selection.
- Inspect RDF slots interactively in the Data Explorer, including trace
  visibility, highlighting, aggregation, synchronized tables, CSV export, and
  chart export.
- Use saved Explorer presets and portable Explorer profiles.
- Inspect the Powell/Mead dashboard and filter ensemble traces with the data
  analysis view.
- Generate a publication-ready `.docx` report using the bundled CRMMS report
  template.
- Run as a portable one-file Windows executable with no Python installation on
  the target machine.

## Supported inputs

| Format | Details |
|---|---|
| RiverWare RDF | `.rdf` files, up to 24 files per run and 150 MB per file |
| Legacy Excel | `.xlsx` workbooks with the expected CRMMS input sheets, up to 50 MB |
| Report template | Bundled `reporting/report_template.docx` |

The default calculation traces are **4–33**. Plots and the Data Explorer can
also include deterministic traces, typically the first 2–3 traces in the file.
Trace selection for calculations is configured separately from trace selection
for plots.

## Quick start

### Option 1: Portable executable

If a built executable is available, run:

```text
dist\CRMMS_ESP_Compare.exe
```

The application starts a local server, opens the browser, and serves the UI at
`http://127.0.0.1:8000` (or the next free port from 8000–8019). Close the
console window or press `Ctrl+C` to stop it.

The executable is unsigned, so Windows SmartScreen may show a warning on first
launch. The `dist/` directory is generated locally and is not tracked by Git.

### Option 2: Windows batch launcher

Double-click:

```text
Start_CRMMS_Web_App.bat
```

The launcher checks the required files, creates `.venv` if needed, installs
dependencies when `requirements.txt` changes, starts Uvicorn on port 8000, and
opens the browser after the health endpoint responds.

### Option 3: Run from source

Requires Python 3.11 or newer. The project is currently tested with Python
3.13.7 on Windows.

```powershell
cd C:\Temp\CRMMS_App\App
py -3 -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python launcher.py
```

To start the server without the launcher's automatic browser opening, run
Uvicorn from the package parent directory:

```powershell
cd C:\Temp\CRMMS_App
App\.venv\Scripts\python.exe -m uvicorn App.main:app --host 127.0.0.1 --port 8000
```

Interactive API documentation is available at `http://127.0.0.1:8000/docs`
when the server is running.

## Typical workflow

1. Choose **Compare two runs** or **Explore data**.
2. Upload Run A and Run B files.
3. For RDF input, discover slots, map the standard CRMMS inputs to exact
   `Object.Slot` names, select calculation traces, and configure custom tables
   and plots.
4. Review the Overview, Lake Powell, Lake Mead, Flow analysis, and Selected RDF
   slots tabs.
5. Optionally open the Data Explorer to inspect traces, build plots, export
   CSV/charts, or add an Explorer plot to the report.
6. Open **Report Builder**, add notes and assumptions, and download the Word
   report.

## RDF behavior

- Slot matching is exact and case-sensitive.
- A logical CRMMS input can be mapped to any RiverWare `Object.Slot`.
- A slot can be split across multiple RDF files for the same run.
- Missing slots and traces are handled section-by-section where possible, so
  one unavailable input does not necessarily invalidate the whole comparison.
- Annual binary flag inputs are compared by summing their 0/1 values across the
  selected traces for each calendar year.
- Scalar slots are expanded across the run timesteps, matching RWDataPlyr's
  tabular behavior.
- RiverWare timestep strings such as `2026-7-31 24:00` are preserved. The
  normalized `period_date` uses the printed date without rolling `24:00` into
  the next day.
- The generic parser in `rdf_reader.py` remains slot-agnostic. CRMMS-specific
  mappings and report logic live in `comparison.py` and `main.py`.

## Project layout

```text
App/
  main.py                       FastAPI application and HTTP endpoints
  comparison.py                 CRMMS comparison engine and RDF adapter
  rdf_reader.py                 Generic RiverWare RDF reader
  runtime_paths.py              Source/frozen resource paths
  launcher.py                   Source and PyInstaller entry point
  launch_browser.py             Browser helper for the batch launcher
  __init__.py                   Python package marker
  explorer_presets.json         Default Explorer plot/analysis presets
  requirements.txt              Runtime dependencies
  CRMMS_ESP_Compare.spec        PyInstaller one-file build definition
  Start_CRMMS_Web_App.bat       Portable source launcher for Windows
  reporting/
    report.py                   Word report generation
    plots.py                    Matplotlib report figures
    report_template.docx        Bundled CRMMS report template
  static/
    index.html                  Application shell
    app.js                      Frontend logic
    styles.css                  Frontend styles
    plotly.min.js               Bundled Plotly runtime
```

Generated or local-only directories such as `.venv/`, `build/`, `dist/`, and
`__pycache__/` are excluded by `.gitignore`.

## Build the Windows executable

Install PyInstaller into the virtual environment, then run the spec:

```powershell
cd C:\Temp\CRMMS_App\App
.venv\Scripts\python.exe -m pip install pyinstaller
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean CRMMS_ESP_Compare.spec
```

The output is:

```text
dist\CRMMS_ESP_Compare.exe
```

The spec bundles the static UI, Explorer presets, report template, and required
`python-docx` data files, and collects the Uvicorn/AnyIO submodules used at
runtime.

## API overview

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check and backend version |
| `GET /api/rdf/schema` | Standard CRMMS logical inputs and groups |
| `POST /api/rdf/inspect` | Inspect one or more uploaded RDF files |
| `POST /api/rdf/session` | Create a cached RDF Explorer session |
| `GET /api/rdf/session/{id}/slot` | Read one slot from an Explorer session |
| `GET /api/rdf/session/{id}/slots` | Read multiple slots from an Explorer session |
| `POST /api/rdf/explore` | Explore one slot from uploaded RDF files |
| `POST /api/compare` | Compare Run A and Run B |
| `POST /api/report/plots` | Render report plot payloads |
| `POST /api/report` | Build and download the Word report |
| `GET /api/explorer/presets` | Read saved Explorer presets |
| `PUT /api/explorer/presets` | Replace saved Explorer presets |

## Configuration and limits

| Setting | Current value |
|---|---|
| Backend version | `6.0.0` |
| Maximum RDF files per run | 24 |
| Maximum RDF file size | 150 MB |
| Maximum Excel file size | 50 MB |
| Explorer session lifetime | 8 hours |
| Maximum retained Explorer sessions | 4 |
| Default calculation traces | 4–33 |
| Default ESP mapping | Trace 4 → 1991 through Trace 33 → 2020 |

In a frozen build, editable Explorer presets are stored under
`%LOCALAPPDATA%\CRMMS_ESP_Compare\explorer_presets.json`. The server binds to
`127.0.0.1` only.

## Performance notes

The RDF reader is designed for repeated interactive use:

- Discovery metadata is cached by resolved path, file size, and modification
  time.
- All requested slots for a file are read in one pass instead of one pass per
  slot.
- Timestep parsing is cached.
- The comparison layer preloads the slots needed by the standard report and
  custom tables/plots before calculating sections.

Performance depends on the number of RDF files, traces, slots, and timesteps.
Large daily files naturally produce more rows and take longer than small
monthly files.

## Troubleshooting

- **Port already in use:** the portable executable chooses the next free port
  between 8000 and 8019. The batch launcher checks for an existing server on
  port 8000.
- **SmartScreen warning:** the executable is not code-signed. Use
  **More info → Run anyway** only if you trust the build.
- **RDF slot not found:** confirm the exact, case-sensitive `Object.Slot` name
  from the RDF inspection output.
- **Missing traces or slots:** review the section-level warnings on the results
  page. A missing input may only affect the sections that use it.
- **Presets not persisting:** verify that `%LOCALAPPDATA%` is writable in a
  frozen build, or `explorer_presets.json` is writable when running from
  source.

## Acknowledgements

The RDF parser is derived from the public-domain RWDataPlyr 0.6.6
implementation (CC0; U.S. Bureau of Reclamation) and is validated against its
sample RDF formats.

The application uses FastAPI, Uvicorn, pandas, openpyxl, python-docx,
Matplotlib, and Plotly.

## License

No license file is currently included in this repository. Contact the
repository owner for reuse or distribution terms.
