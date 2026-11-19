"use strict";
/* ---- data table (period rows x trace columns, linked highlight) ---- */

function fmtVal(v) {
  if (v == null || !Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return Math.round(v).toLocaleString("en-US");
  if (a >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

/* Unique slots plotted by the current plot preset (in card order) */
function plottedSlots() {
  if (!currentPreset || !currentPreset.plots) {
    const dtSlot = document.getElementById("dtSlot");
    return dtSlot && dtSlot.value && model && model.slots.has(dtSlot.value) ? [dtSlot.value] : [];
  }
  // presetItems() honors per-session overrides: added plots, removed plots,
  // and slot changes made in Plot settings — the highlight view must show
  // every slot currently on the page
  const names = [];
  for (const item of presetItems(currentPreset)) {
    for (const n of [item.slot, item.y_slot, ...(item.plot_slots || [])]) {
      if (n && model.slots.has(n) && !names.includes(n)) names.push(n);
    }
  }
  return names;
}

/* One bordered table group: optional slot heading + scrollable table of
 * period rows x trace columns (used by both data-table modes). */
function buildDataTableGroup(slotData, traces, headingName, highlightTrace) {
  const wrap = document.createElement("div");
  if (headingName) {
    const h = document.createElement("div");
    h.className = "dt-slot-heading";
    h.innerHTML = escapeHtml(headingName) +
      (slotData.unit ? ' <small>\u00b7 unit: ' + escapeHtml(slotData.unit) + "</small>" : "");
    wrap.appendChild(h);
  }
  const scroll = document.createElement("div");
  scroll.className = "dt-scroll";

  const table = document.createElement("table");
  table.className = "data-table";

  const rowMap = new Map();
  for (const tr of traces) {
    for (const p of tr.points) {
      const key = p.periodDate || p.timestep || String(p.idx);
      let row = rowMap.get(key);
      if (!row) {
        row = { key: key, label: periodLabel(p), vals: new Map() };
        rowMap.set(key, row);
      }
      row.vals.set(tr.traceNumber, p.value);
    }
  }
  const rows = [...rowMap.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.className = "period";
  th0.textContent = "Period";
  hr.appendChild(th0);
  for (const tr of traces) {
    const th = document.createElement("th");
    th.dataset.trace = String(tr.traceNumber);
    const label = model.labels.get(tr.traceNumber) || traceLabel(tr.traceNumber);
    th.textContent = label + " (" + tr.traceNumber + ")";
    if (highlightTrace != null && highlightTrace === tr.traceNumber) th.classList.add("dt-hl");
    else if (highlightTrace != null) th.classList.add("dt-dim");
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const rowEl = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.className = "period";
    td0.textContent = row.label;
    rowEl.appendChild(td0);
    for (const tr of traces) {
      const td = document.createElement("td");
      td.dataset.trace = String(tr.traceNumber);
      td.textContent = fmtVal(row.vals.get(tr.traceNumber));
      if (highlightTrace != null && highlightTrace === tr.traceNumber) td.classList.add("dt-hl");
      else if (highlightTrace != null) td.classList.add("dt-dim");
      rowEl.appendChild(td);
    }
    tbody.appendChild(rowEl);
  }
  table.appendChild(tbody);

  enableTableCellSelection(table);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

/* =========================================================================
 * Excel-style cell selection for every data table:
 * drag across value cells to select a rectangle, see live N / Sum / Avg /
 * Min / Max in a floating status bar, and copy the selection as TSV.
 * Plain clicks keep their existing behavior (trace highlight, etc.).
 * ========================================================================= */

function parseCellNumber(text) {
  const t = String(text == null ? "" : text).trim();
  if (!t || t === "\u2014") return null;
  let s = t.replaceAll(",", "");
  let mult = 1;
  if (/^[+-]?[\d.]+B$/i.test(s)) { mult = 1e9; s = s.slice(0, -1); }
  else if (/^[+-]?[\d.]+M$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
  const v = parseFloat(s);
  return Number.isFinite(v) ? v * mult : null;
}

function copyTextToClipboard(text, onDone) {
  const done = () => { if (onDone) onDone(true); };
  const fail = () => { if (onDone) onDone(false); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {
      fallbackCopy(text) ? done() : fail();
    });
  } else {
    fallbackCopy(text) ? done() : fail();
  }
}
function fallbackCopy(text) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch (err) { return false; }
}

const cellSelection = { table: null, regions: [], painted: [] };
let cellStatsBar = null;

function cellStatsBarEl() {
  if (cellStatsBar) return cellStatsBar;
  cellStatsBar = document.createElement("div");
  cellStatsBar.id = "cellStatsBar";
  const text = document.createElement("span");
  text.id = "cellStatsText";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.id = "cellCopySel";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy the selected cells (TSV \u2014 paste into Excel)";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.id = "cellClearSel";
  clearBtn.textContent = "\u2715";
  clearBtn.title = "Clear selection (Esc)";
  cellStatsBar.appendChild(text);
  cellStatsBar.appendChild(copyBtn);
  cellStatsBar.appendChild(clearBtn);
  document.body.appendChild(cellStatsBar);
  copyBtn.addEventListener("click", () => copyCellSelection());
  clearBtn.addEventListener("click", () => clearCellSelection());
  return cellStatsBar;
}

function clearCellSelection() {
  for (const el of cellSelection.painted) el.classList.remove("cell-sel");
  cellSelection.painted = [];
  cellSelection.regions = [];
  cellSelection.table = null;
  const bar = cellStatsBar;
  if (bar) bar.classList.remove("on");
}

/* regions: [{r0,c0,r1,c1}] in tbody row / cell indices (column 0 = period) */
function paintCellSelection() {
  for (const el of cellSelection.painted) el.classList.remove("cell-sel");
  cellSelection.painted = [];
  const table = cellSelection.table;
  if (!table) return;
  const body = table.tBodies[0];
  if (!body) return;
  const seen = new Set();
  for (const rect of cellSelection.regions) {
    const r0 = Math.min(rect.r0, rect.r1), r1 = Math.max(rect.r0, rect.r1);
    const c0 = Math.min(rect.c0, rect.c1), c1 = Math.max(rect.c0, rect.c1);
    for (let r = r0; r <= r1 && r < body.rows.length; r++) {
      const cells = body.rows[r].cells;
      for (let c = c0; c <= c1 && c < cells.length; c++) {
        const key = r + ":" + c;
        if (seen.has(key)) continue;
        seen.add(key);
        cells[c].classList.add("cell-sel");
        cellSelection.painted.push(cells[c]);
      }
    }
  }
}

function eachSelectedCell(cb) {
  const table = cellSelection.table;
  if (!table) return;
  const body = table.tBodies[0];
  if (!body) return;
  const seen = new Set();
  for (const rect of cellSelection.regions) {
    const r0 = Math.min(rect.r0, rect.r1), r1 = Math.max(rect.r0, rect.r1);
    const c0 = Math.min(rect.c0, rect.c1), c1 = Math.max(rect.c0, rect.c1);
    for (let r = r0; r <= r1 && r < body.rows.length; r++) {
      const cells = body.rows[r].cells;
      for (let c = c0; c <= c1 && c < cells.length; c++) {
        const key = r + ":" + c;
        if (seen.has(key)) continue;
        seen.add(key);
        cb(cells[c]);
      }
    }
  }
}

function selectionStats() {
  const values = [];
  eachSelectedCell(td => {
    const v = parseCellNumber(td.textContent);
    if (v != null) values.push(v);
  });
  const n = values.length;
  const sum = n ? values.reduce((a, b) => a + b, 0) : null;
  return {
    n: n,
    sum: sum,
    avg: n ? sum / n : null,
    min: n ? Math.min(...values) : null,
    max: n ? Math.max(...values) : null,
  };
}

function selectionTsv() {
  /* each region becomes its own TSV block (Excel multi-area style) */
  const table = cellSelection.table;
  if (!table) return "";
  const body = table.tBodies[0];
  if (!body) return "";
  const blocks = [];
  const regions = [...cellSelection.regions].sort((a, b) =>
    (Math.min(a.r0, a.r1) - Math.min(b.r0, b.r1)) || (Math.min(a.c0, a.c1) - Math.min(b.c0, b.c1)));
  for (const rect of regions) {
    const r0 = Math.min(rect.r0, rect.r1), r1 = Math.max(rect.r0, rect.r1);
    const c0 = Math.min(rect.c0, rect.c1), c1 = Math.max(rect.c0, rect.c1);
    const lines = [];
    for (let r = r0; r <= r1 && r < body.rows.length; r++) {
      const cells = body.rows[r].cells;
      const row = [];
      for (let c = c0; c <= c1 && c < cells.length; c++) row.push(cells[c].textContent.trim());
      lines.push(row.join("\t"));
    }
    if (lines.length) blocks.push(lines.join("\r\n"));
  }
  return blocks.join("\r\n");
}

function copyCellSelection() {
  if (!cellSelection.table || !cellSelection.regions.length) return;
  const tsv = selectionTsv();
  const bar = cellStatsBarEl();
  copyTextToClipboard(tsv, ok => {
    const btn = bar.querySelector("#cellCopySel");
    btn.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => { btn.textContent = "Copy"; }, 2500);
  });
}

function showCellStats() {
  if (!cellSelection.table || !cellSelection.regions.length) return;
  const s = selectionStats();
  const bar = cellStatsBarEl();
  bar.querySelector("#cellStatsText").textContent =
    "N: " + s.n +
    (s.n ? "  \u00b7  Sum: " + fmtVal(s.sum) + "  \u00b7  Avg: " + fmtVal(s.avg) +
          "  \u00b7  Min: " + fmtVal(s.min) + "  \u00b7  Max: " + fmtVal(s.max) : "");
  bar.classList.add("on");
}

/* Excel-style selection on any data table:
 * - drag value cells            -> rectangular selection (plain = replace, ctrl = add)
 * - ctrl+click / ctrl+drag on a column header -> select columns (plain click keeps
 *   its existing behavior, e.g. trace highlight)
 * - click / drag on a period (row header) cell -> select rows
 * The status bar shows N / Sum / Avg / Min / Max; Copy (or Ctrl+C) exports the
 * selection as TSV; Esc clears. */
function enableTableCellSelection(table) {
  if (!table || table.__cellSel) return;
  table.__cellSel = true;

  const suppressNextClick = () => {
    table.addEventListener("click", ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
  };
  const rectBounds = rect => ({
    r0: Math.min(rect.r0, rect.r1), r1: Math.max(rect.r0, rect.r1),
    c0: Math.min(rect.c0, rect.c1), c1: Math.max(rect.c0, rect.c1),
  });
  const sameRect = (a, b) => {
    const x = rectBounds(a), y = rectBounds(b);
    return x.r0 === y.r0 && x.r1 === y.r1 && x.c0 === y.c0 && x.c1 === y.c1;
  };

  table.addEventListener("mousedown", e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const body = table.tBodies[0];
    if (!body) return;
    const lastRow = body.rows.length - 1;
    const lastCol = body.rows[0] ? body.rows[0].cells.length - 1 : 0;
    const td = e.target.closest("td");
    const th = e.target.closest("th");
    const colRect = col => ({ r0: 0, c0: col, r1: lastRow, c1: col });
    const rowRect = row => ({ r0: row, c0: 0, r1: row, c1: lastCol });
    const baseRegions = () => (cellSelection.table === table ? cellSelection.regions.map(r => ({ ...r })) : []);
    const fire = (kind, rect) => {  // replace or extend the selection, repaint, update stats
      cellSelection.table = table;
      cellSelection.regions = kind === "add" ? baseRegions().concat([rect]) : [rect];
      paintCellSelection();
      showCellStats();
    };
    if (!td && !th) return;

    /* ---- column header: click / drag selects whole columns (ctrl adds/toggles) ---- */
    if (th) {
      if (th.classList.contains("period")) return;
      e.preventDefault();
      const anchorCol = th.cellIndex;
      let rect = colRect(anchorCol);
      let moved = false;
      // ctrl+click on an already-selected column toggles it off (unless dragging)
      const prevRegions = baseRegions();
      const existing = ctrl ? prevRegions.find(r => sameRect(r, rect)) : null;
      const onMove = ev => {
        const h = ev.target.closest("th");
        if (!h || !table.contains(h) || h.classList.contains("period")) return;
        const col = h.cellIndex;
        if (col === anchorCol && !moved) return;
        moved = true;
        rect = { r0: 0, c0: Math.min(anchorCol, col), r1: lastRow, c1: Math.max(anchorCol, col) };
        fire(ctrl ? "add" : "replace", rect);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        if (!moved) {
          if (existing) {
            cellSelection.table = table;
            cellSelection.regions = prevRegions.filter(r => r !== existing);
            paintCellSelection();
            if (cellSelection.regions.length) showCellStats(); else clearCellSelection();
          } else {
            fire(ctrl ? "add" : "replace", rect);
          }
        }
        suppressNextClick();  // header clicks select columns — leave trace toggling to value cells
      };
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      return;
    }

    /* ---- period (row header) cell: click / drag selects whole rows ---- */
    if (td.classList.contains("period")) {
      e.preventDefault();
      const anchorRow = td.parentElement.rowIndex - 1;
      let rect = rowRect(anchorRow);
      let moved = false;
      const onMove = ev => {
        const d = ev.target.closest("td.period");
        if (!d || !table.contains(d)) return;
        const r = d.parentElement.rowIndex - 1;
        if (r === anchorRow && !moved) return;
        moved = true;
        rect = { r0: Math.min(anchorRow, r), c0: 0, r1: Math.max(anchorRow, r), c1: lastCol };
        fire(ctrl ? "add" : "replace", rect);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        if (!moved) fire(ctrl ? "add" : "replace", rect);
        showCellStats();
      };
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      return;
    }

    /* ---- value cell: drag selects a rectangle ---- */
    e.preventDefault();
    const anchor = { r: td.parentElement.rowIndex - 1, c: td.cellIndex };
    let rect = { r0: anchor.r, c0: anchor.c, r1: anchor.r, c1: anchor.c };
    let moved = false;
    const onMove = ev => {
      const d = ev.target.closest("td");
      if (!d || !table.contains(d) || d.classList.contains("period")) return;
      const r = d.parentElement.rowIndex - 1;
      const c = d.cellIndex;
      if (r === anchor.r && c === anchor.c && !moved) return;
      moved = true;
      rect = { r0: Math.min(anchor.r, r), c0: Math.min(anchor.c, c), r1: Math.max(anchor.r, r), c1: Math.max(anchor.c, c) };
      fire(ctrl ? "add" : "replace", rect);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      if (!moved) {
        if (ctrl) {  // ctrl+click adds a single cell (no trace toggle)
          fire("add", rect);
          suppressNextClick();
        } else {
          clearCellSelection();  // plain click keeps its existing behavior
        }
        return;
      }
      showCellStats();
      // the browser fires click where the drag ended — suppress it so the
      // delegated trace-highlight handler does not also toggle
      suppressNextClick();
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });
}

document.addEventListener("keydown", e => {
  const inField = e.target && /^(input|textarea|select)$/i.test(e.target.tagName);
  if (e.key === "Escape" && !inField && cellSelection.painted.length) {
    clearCellSelection();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !inField && cellSelection.painted.length) {
    copyCellSelection();
  }
});

function renderDataTable() {
  clearCellSelection();  // selection lives in the old DOM — re-renders invalidate it
  const host = document.getElementById("dtTables");
  const info = document.getElementById("dtInfo");
  const section = document.getElementById("dataTableSection");
  if (!model) return;
  const isHighlight = highlightedTrace != null;
  section.classList.toggle("dt-highlight", isHighlight);

  if (isHighlight) {
    // App behavior: a selected trace shows a single combined table with one
    // column per plotted slot, so Powell and Mead values sit side by side
    host.innerHTML = "";
    const trLabel = (model.labels.get(highlightedTrace) || traceLabel(highlightedTrace)) + " (" + highlightedTrace + ")";
    const groups = [];
    for (const name of plottedSlots()) {
      const slotData = model.slots.get(name);
      const tr = slotData.traces.find(t => t.traceNumber === highlightedTrace);
      if (!tr) continue;
      groups.push({ name: name, slotData: slotData, points: tr.points });
    }
    const rowMap = new Map();
    for (const g of groups) {
      for (const p of g.points) {
        const key = p.periodDate || p.timestep || String(p.idx);
        let row = rowMap.get(key);
        if (!row) {
          row = { key: key, label: periodLabel(p), vals: new Map() };
          rowMap.set(key, row);
        }
        row.vals.set(g.name, p.value);
      }
    }
    const rows = [...rowMap.values()].sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));

    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.className = "period";
    th0.textContent = "Period";
    hr.appendChild(th0);
    for (const g of groups) {
      const th = document.createElement("th");
      th.textContent = g.name;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const rowEl = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.className = "period";
      td0.textContent = row.label;
      rowEl.appendChild(td0);
      for (const g of groups) {
        const td = document.createElement("td");
        td.textContent = fmtVal(row.vals.get(g.name));
        rowEl.appendChild(td);
      }
      tbody.appendChild(rowEl);
    }
    table.appendChild(tbody);
    enableTableCellSelection(table);
    const scroll = document.createElement("div");
    scroll.className = "dt-scroll";
    scroll.appendChild(table);
    host.appendChild(scroll);

    info.textContent = "Showing " + trLabel + " across " + groups.length + " plotted slot" +
      (groups.length === 1 ? "" : "s") + " — clear the selection to restore the full table";
    return;
  }

  const dtSlot = document.getElementById("dtSlot");
  const slotName = dtSlot.value;
  const slotData = model.slots.get(slotName);
  host.innerHTML = "";
  if (!slotData) {
    info.textContent = "";
    return;
  }
  const onlyVisible = document.getElementById("dtOnlyVisible").checked;
  const traces = onlyVisible ? tracesForSlot(slotData) : slotData.traces;
  host.appendChild(buildDataTableGroup(slotData, traces, null, null));
  info.textContent = traces.length + " traces \u00d7 " + (function () {
    const rows = new Set();
    for (const tr of traces) for (const p of tr.points) if (p.periodDate) rows.add(p.periodDate);
    return rows.size;
  })() + " periods" +
    (slotData.unit ? " \u00b7 unit: " + slotData.unit : "");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- per-scatter-card data table (App's renderScatterDataTables) ---- */

function renderScatterDataTable(cardEl, item) {
  let host = cardEl.querySelector(".scatter-data-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "scatter-data-host";
    cardEl.appendChild(host);
  }
  const div = cardEl.querySelector(".plot-area");
  const rows = [];
  if (div.data) {
    for (const trace of div.data) {
      if (trace.mode !== "markers" || !Array.isArray(trace.x) || !trace.x.length || !Array.isArray(trace.y) || !trace.y.length) continue;
      const meta = Array.isArray(trace.customdata && trace.customdata[0]) ? trace.customdata[0] : [];
      const tn = Number(meta[2]);
      if (!Number.isFinite(tn)) continue;
      if (highlightedTrace != null && tn !== highlightedTrace) continue;
      const label = (model && model.labels.get(tn)) || traceLabel(tn);
      rows.push({ trace: label + " (" + tn + ")", tn: tn, x: trace.x[0], y: trace.y[0] });
    }
  }

  const xTitle = item.slot;
  const yTitle = item.y_slot || "Y slot";
  const fmt = v => (v == null || v === "" || !Number.isFinite(Number(v))) ? "\u2014"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!rows.length) {
    host.innerHTML = '<div class="scatter-data-details"><div class="scatter-empty-note">No paired data points are available for the selected treatments/year.</div></div>';
    return;
  }

  const serialize = delimiter => {
    const lines = [["Trace", xTitle, yTitle]];
    for (const r of rows) lines.push([r.trace, String(r.x), String(r.y)]);
    return lines.map(row => row.map(cell => {
      const text = String(cell == null ? "" : cell);
      return delimiter === "," ? '"' + text.replaceAll('"', '""') + '"' : text.replaceAll("\t", " ");
    }).join(delimiter)).join("\r\n");
  };

  host.innerHTML = "";
  const detailsEl = document.createElement("details");
  detailsEl.className = "scatter-data-details";
  const summary = document.createElement("summary");
  summary.textContent = "Data used in this plot (" + rows.length + " points)";
  detailsEl.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "scatter-data-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button"; copyBtn.className = "mini-button"; copyBtn.textContent = "Copy for Excel";
  const csvBtn = document.createElement("button");
  csvBtn.type = "button"; csvBtn.className = "mini-button"; csvBtn.textContent = "Download CSV";
  const status = document.createElement("span");
  status.className = "scatter-copy-status";
  actions.appendChild(copyBtn); actions.appendChild(csvBtn); actions.appendChild(status);
  detailsEl.appendChild(actions);

  const cols = [{ key: "trace", label: "Trace" }, { key: "x", label: xTitle }, { key: "y", label: yTitle }];
  const scroll = document.createElement("div");
  scroll.className = "dt-scroll";
  scroll.style.maxHeight = "260px";
  const table = document.createElement("table");
  table.className = "scatter-points-table";

  const sortState = { key: null, direction: "asc" };
  const sortedRows = () => {
    if (!sortState.key) return rows;
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortState.key], bv = b[sortState.key];
      const an = Number(av), bn = Number(bv);
      const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn
        : String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv), undefined, { numeric: true, sensitivity: "base" });
      return sortState.direction === "asc" ? cmp : -cmp;
    });
    return sorted;
  };

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const col of cols) {
    const th = document.createElement("th");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = col.label;
    btn.addEventListener("click", () => {
      const direction = sortState.key === col.key && sortState.direction === "asc" ? "desc" : "asc";
      sortState.key = col.key;
      sortState.direction = direction;
      clearCellSelection();  // rows are rebuilt below
      fillBody();
    });
    th.appendChild(btn);
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  const fillBody = () => {
    tbody.innerHTML = "";
    for (const r of sortedRows()) {
      const tr = document.createElement("tr");
      for (const col of cols) {
        const td = document.createElement("td");
        td.textContent = col.key === "trace" ? r.trace : fmt(r[col.key]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  };
  fillBody();
  enableTableCellSelection(table);
  scroll.appendChild(table);
  detailsEl.appendChild(scroll);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(serialize("\t"));
      status.textContent = "Copied; paste into Excel.";
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = serialize("\t");
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      status.textContent = copied ? "Copied; paste into Excel." : "Copy failed.";
    }
    setTimeout(() => { status.textContent = ""; }, 4000);
  });
  csvBtn.addEventListener("click", () => {
    const name = String(item.slot + "-vs-" + (item.y_slot || "scatter")).replace(/[^A-Za-z0-9_.-]+/g, "_");
    downloadBlob(new Blob([serialize(",")], { type: "text/csv;charset=utf-8" }), name + ".csv");
  });

  host.appendChild(detailsEl);
}

