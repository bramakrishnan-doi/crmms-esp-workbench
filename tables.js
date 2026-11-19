"use strict";
/* =========================================================================
 * Custom table presets — monthly / water-year / calendar-year / annual
 * tables with trace, year-range, month and value-condition filters
 * (value conditions mirror the App's analysis-preset vocabulary).
 * ========================================================================= */

const TABLE_ROWS_LABELS = {
  monthly: "Monthly values",
  water_year: "Water-year aggregation (Oct\u2013Sep)",
  calendar_year: "Calendar-year aggregation",
  annual: "Annual values",
};

/* Volume-in-time slots that must never be summed (a sum of elevations,
 * storages in an area sense, etc. is meaningless) — these default to
 * end-of-period aggregation instead. */
const NON_SUM_SLOT_PATTERNS = [
  "pool elevation", "storage", "surface area",
  "power plant cap fraction", "peak flow",
];
function slotAllowsSum(slotName) {
  const n = String(slotName || "").toLowerCase();
  return !NON_SUM_SLOT_PATTERNS.some(p => n.includes(p));
}

function normalizeTableBlock(block) {
  const b = Object.assign({}, block);
  b.rows = ["monthly", "water_year", "calendar_year", "annual"].indexOf(b.rows) >= 0 ? b.rows : "monthly";
  b.stat = ["sum", "avg", "min", "max", "end"].indexOf(b.stat) >= 0 ? b.stat : "sum";
  if (b.stat === "sum" && !slotAllowsSum(b.slot)) b.stat = "end";  // elevations etc. are never summed
  b.filters = Object.assign({ traces: "visible", yearFrom: "", yearTo: "", months: [], conditions: [], logic: "all" }, b.filters || {});
  b.filters.months = Array.isArray(b.filters.months)
    ? b.filters.months.map(Number).filter(m => m >= 1 && m <= 12)
    : String(b.filters.months || "").split(/[ ,;]+/).map(Number).filter(m => Number.isFinite(m) && m >= 1 && m <= 12);
  b.filters.conditions = Array.isArray(b.filters.conditions) ? b.filters.conditions : [];
  b.filters.logic = b.filters.logic === "any" ? "any" : "all";
  b.pageFilter = Object.assign({ op: "<", value: "", value2: "", mode: "filter" }, b.pageFilter || {});
  if (b.pageFilter.mode !== "highlight") b.pageFilter.mode = "filter";
  b.scale = [1, 1000, 1000000].includes(Number(b.scale)) ? Number(b.scale) : 1;  // display divisor
  b.wyTotals = !!b.wyTotals;
  b.cyTotals = !!b.cyTotals;
  b.decimals = Number.isFinite(Number(b.decimals)) ? Number(b.decimals) : 2;
  b.title = b.title || "";
  return b;
}

function tableTracesForBlock(block, slotData) {
  const mode = block.filters.traces || "visible";
  let traces;
  if (mode === "all") traces = slotData.traces;
  else if (mode === "ensemble") traces = slotData.traces.filter(tr => model.roles.get(tr.traceNumber) === "ensemble");
  else traces = tracesForSlot(slotData);
  return traces;
}

function valuePass(v, cond) {
  const op = cond.op || "any";
  if (op === "any") return true;
  const value = Number(cond.value);
  if (op === "between") {
    const a = Number(cond.value), b = Number(cond.value2);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return Number.isFinite(v) && v >= lo && v <= hi;
  }
  if (!Number.isFinite(value)) return true;
  switch (op) {
    case "<": return Number.isFinite(v) && v < value;
    case "<=": return Number.isFinite(v) && v <= value;
    case ">": return Number.isFinite(v) && v > value;
    case ">=": return Number.isFinite(v) && v >= value;
    case "=": return Number.isFinite(v) && v === value;
    case "!=": return !(Number.isFinite(v) && v === value);
    default: return true;
  }
}

function parseYearsList(text) {
  return String(text || "").split(/[ ,;]+/).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n));
}

function groupValuesByBasis(points, basis, years) {
  const groups = new Map();  // year -> ordered point objects
  for (const p of points) {
    if (p.value == null || !Number.isFinite(p.value)) continue;
    const y = basis === "water" ? p.year + ((p.month != null && p.month >= WY_START_MONTH) ? 1 : 0) : p.year;
    if (years.length && !years.includes(y)) continue;
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(p);
  }
  return groups;
}

/* Evaluate value conditions — mirrors the App's analysis-preset semantics:
 * the result is a set of trace::year pairs; the table keeps the matching
 * trace columns and matching year rows. Returns null when there are no
 * conditions. */
function evaluateTableConditions(conditions, logic) {
  if (!conditions || !conditions.length) return null;
  const pairSets = [];
  for (const cond of conditions) {
    if (!cond || !cond.slot) continue;
    const slotData = model.slots.get(cond.slot);
    if (!slotData) continue;
    const calc = cond.calculation || "individual";
    const years = parseYearsList(cond.years);
    const pairs = new Set();
    for (const tr of slotData.traces) {
      if (model.roles.get(tr.traceNumber) === "deterministic") continue;  // App: Max/Min/Most excluded
      if (calc === "individual") {
        for (const p of tr.points) {
          if (cond.month && Number(cond.month) > 0 && p.month !== Number(cond.month)) continue;
          if (years.length && !years.includes(p.year)) continue;
          if (valuePass(p.value, cond)) pairs.add(tr.traceNumber + "::" + p.year);
        }
      } else {
        const basis = calc.startsWith("water") ? "water" : "calendar";
        const statName = calc.split("_")[1] || "sum";
        const groups = groupValuesByBasis(tr.points, basis, years);
        for (const [y, vals] of groups) {
          if (valuePass(statApply(statName, vals, basis === "water" ? "water_year" : "calendar_year"), cond)) pairs.add(tr.traceNumber + "::" + y);
        }
      }
    }
    pairSets.push(pairs);
  }
  if (!pairSets.length) return null;
  const merged = logic === "any"
    ? new Set(pairSets.flatMap(s => [...s]))
    : new Set(pairSets.reduce((acc, s) => acc.filter(p => s.has(p)), [...pairSets[0]]));
  const traces = new Set(), yrs = new Set();
  for (const pair of merged) {
    const [tn, y] = pair.split("::");
    traces.add(Number(tn));
    yrs.add(Number(y));
  }
  return { pairs: merged, traces: traces, years: yrs };
}

function statApply(stat, items, rowsMode) {
  if (!items || !items.length) return null;

  if (stat === "end") {
    // For calendar year aggregation of monthly data: end of period is December (month 12)
    if (rowsMode === "calendar_year") {
      const dec = items.slice().reverse().find(pt => (pt && typeof pt === "object") ? pt.month === 12 : false);
      if (dec) return Number.isFinite(dec.value) ? dec.value : null;
      const isMonthly = items.some(pt => pt && typeof pt === "object" && pt.month != null);
      if (isMonthly) return null;  // Incomplete calendar year (no December data)
      const last = items[items.length - 1];
      const val = (last && typeof last === "object") ? last.value : last;
      return Number.isFinite(val) ? val : null;
    }
    // For water year aggregation of monthly data: end of period is September (month 9)
    if (rowsMode === "water_year") {
      const sep = items.slice().reverse().find(pt => (pt && typeof pt === "object") ? pt.month === 9 : false);
      if (sep) return Number.isFinite(sep.value) ? sep.value : null;
      const isMonthly = items.some(pt => pt && typeof pt === "object" && pt.month != null);
      if (isMonthly) return null;  // Incomplete water year (no September data)
      const last = items[items.length - 1];
      const val = (last && typeof last === "object") ? last.value : last;
      return Number.isFinite(val) ? val : null;
    }
    // For monthly or native annual slots: last value
    const last = items[items.length - 1];
    const val = (last && typeof last === "object") ? last.value : last;
    return Number.isFinite(val) ? val : null;
  }

  const vals = items.map(pt => (pt && typeof pt === "object") ? pt.value : pt).filter(v => Number.isFinite(v));
  if (!vals.length) return null;
  switch (stat) {
    case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "min": return Math.min(...vals);
    case "max": return Math.max(...vals);
    default: return vals.reduce((a, b) => a + b, 0);  // sum
  }
}

/* Build the row groups for a table block:
 * [{key, label, sortKey, values: Map(traceNumber -> [point objects]), count}] */
function tableRowGroups(slotData, block, traces) {
  const groups = new Map();
  const rowsMode = block.rows === "annual" && slotData.timestepType !== "annual" ? "calendar_year" : block.rows;

  const ensure = key => {
    let g = groups.get(key);
    if (!g) { g = { key: key, label: key, values: new Map() }; groups.set(key, g); }
    return g;
  };

  if (rowsMode === "monthly") {
    for (const tr of traces) {
      for (const p of tr.points) {
        if (p.value == null || !Number.isFinite(p.value)) continue;
        if (block.filters.yearFrom !== "" && block.filters.yearFrom != null && p.year < Number(block.filters.yearFrom)) continue;
        if (block.filters.yearTo !== "" && block.filters.yearTo != null && p.year > Number(block.filters.yearTo)) continue;
        if (block.filters.months.length && !block.filters.months.includes(p.month)) continue;
        const key = p.periodDate || p.timestep || String(p.idx);
        const g = ensure(key);
        g.label = periodLabel(p);
        g.sortKey = key;
        if (!g.values.has(tr.traceNumber)) g.values.set(tr.traceNumber, []);
        g.values.get(tr.traceNumber).push(p);
      }
    }
  } else {
    const basis = rowsMode === "water_year" ? "water" : "calendar";
    for (const tr of traces) {
      for (const p of tr.points) {
        if (p.value == null || !Number.isFinite(p.value)) continue;
        const y = basis === "water" ? p.year + ((p.month != null && p.month >= WY_START_MONTH) ? 1 : 0) : p.year;
        if (block.filters.yearFrom !== "" && block.filters.yearFrom != null && y < Number(block.filters.yearFrom)) continue;
        if (block.filters.yearTo !== "" && block.filters.yearTo != null && y > Number(block.filters.yearTo)) continue;
        const g = ensure(String(y));
        g.label = rowsMode === "water_year" ? "WY " + y : String(y);
        g.sortKey = y;
        if (!g.values.has(tr.traceNumber)) g.values.set(tr.traceNumber, []);
        g.values.get(tr.traceNumber).push(p);
      }
    }
  }

  const list = [...groups.values()];
  list.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey), undefined, { numeric: true }));
  // NOTE: values stay in period order (points are pre-sorted) — required for the "end" statistic
  return { rowsMode: rowsMode, groups: list };
}

const TABLE_STAT_LABELS = { sum: "Sum", avg: "Average", min: "Minimum", max: "Maximum", end: "End of period" };

function newTableBlock(slot) {
  return {
    slot: slot || "",
    rows: "monthly",
    stat: slotAllowsSum(slot) ? "sum" : "end",  // elevations etc. default to end of period
    wyTotals: false,
    cyTotals: false,
    title: "",
    decimals: 2,
    scale: 1,
    pageFilter: { op: "<", value: "", value2: "", mode: "filter" },
    filters: { traces: "visible", yearFrom: "", yearTo: "", months: "", conditions: [], logic: "all" },
  };
}

function tableControlSelect(field, options, value) {
  const sel = document.createElement("select");
  sel.dataset.tfield = field;
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o[0];
    opt.textContent = o[1];
    if (String(o[0]) === String(value)) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

function tableControlInput(field, value, type) {
  const input = document.createElement("input");
  input.type = type || "text";
  input.dataset.tfield = field;
  if (type === "checkbox") {
    input.checked = value === true || value === "true";  // reflect real state — .value does not
  } else {
    input.value = value == null ? "" : String(value);
  }
  return input;
}

function tableControlWrap(labelText, el) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = labelText;
  label.appendChild(span);
  label.appendChild(el);
  return label;
}

function renderTableBlock(section, rawBlock) {
  const block = normalizeTableBlock(rawBlock);
  clearCellSelection();  // selection lives in the old DOM — re-renders invalidate it
  section.innerHTML = "";  // re-renders (filter changes) must replace, not append
  const head = document.createElement("div");
  head.className = "table-block-head";
  section.appendChild(head);

  const slotData = model.slots.get(block.slot);
  const addRemoveBtn = () => {  // every table can be removed for this session
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mini-button table-remove";
    rm.textContent = "Remove";
    rm.title = resCurrentPage
      ? "Hide this slot's table (unticks it on the reservoir card)"
      : section._isSession
        ? "Remove this added table (this session)"
        : "Hide this table for this session — reload the page to restore it";
    rm.addEventListener("click", () => {
      if (resCurrentPage) {
        // reservoir page: Remove = untick this slot; the other tables stay
        const slotName = String(section._blockKey).slice("reservoir:".length);
        resCheckedSet(resCurrentPage).delete(slotName);
        renderResCardsPanel(resCurrentPage);
        renderReservoirTables(resCurrentPage);
        return;
      }
      if (section._isSession) {
        const i = sessionTableBlocks.findIndex(b => b.__uid === Number(String(section._blockKey).slice("session#".length)));
        if (i >= 0) sessionTableBlocks.splice(i, 1);
      } else {
        removedPresetBlocks.add(section._blockKey);
      }
      tableBlockSession.delete(section._blockKey);
      renderTablePreset(TABLE_PRESETS[currentTablePresetIndex]);
    });
    head.appendChild(rm);
  };
  if (!slotData) {
    head.innerHTML = "<strong>" + escapeHtml(block.title || block.slot) + "</strong>" +
      '<span class="table-block-sub"><span class="warn-line">Slot not found in the loaded RDF files: <code>' + escapeHtml(block.slot) + "</code></span></span>";
    addRemoveBtn();
    return;
  }

  // on-page Filter & aggregate panel (session-level view adjustments)
  const panel = document.createElement("details");
  panel.className = "filters-panel";
  if (section._filtersOpen) panel.open = true;
  panel.addEventListener("toggle", () => { section._filtersOpen = panel.open; });
  const pSummary = document.createElement("summary");
  pSummary.textContent = "Filter & aggregate";
  panel.appendChild(pSummary);
  const pGrid = document.createElement("div");
  pGrid.className = "filters-grid";
  const isMonthly = block.rows === "monthly";
  const allowsSum = slotAllowsSum(block.slot);
  const slotNames = [...model.slots.keys()];
  pGrid.appendChild(tableControlWrap("Slot", tableControlSelect("slot", slotNames.map(s => [s, s]), block.slot)));
  pGrid.appendChild(tableControlWrap("Rows", tableControlSelect("rows", [
    ["monthly", "Monthly values"],
    ["water_year", "Water-year (Oct\u2013Sep)"],
    ["calendar_year", "Calendar-year"],
    ["annual", "Annual values"],
  ], block.rows)));
  const decWrap = tableControlWrap("Decimals", tableControlSelect("decimals", [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"]], String(block.decimals)));
  decWrap.title = "Decimal places shown (0 = round to the nearest integer)";
  pGrid.appendChild(decWrap);
  const scaleWrap = tableControlWrap("Divide by", tableControlSelect("scale", [["1", "Raw"], ["1000", "\u00f7 1,000"], ["1000000", "\u00f7 1,000,000"]], String(block.scale || 1)));
  scaleWrap.title = "Rescale displayed values (e.g. acre-ft \u2192 thousand acre-ft). The value filter compares the rescaled values.";
  pGrid.appendChild(scaleWrap);
  // aggregated rows show only the per-year statistic; monthly rows show raw values
  const statOptions = [["avg", "Average"], ["min", "Minimum"], ["max", "Maximum"], ["end", "End of period"]];
  if (allowsSum) statOptions.unshift(["sum", "Sum"]);  // elevations, storage, area, cap fraction, peak flow: never summed
  const statWrap = tableControlWrap("Statistic (per year)", tableControlSelect("stat", statOptions, block.stat));
  if (isMonthly) statWrap.style.display = "none";
  pGrid.appendChild(statWrap);
  // year/month dropdowns populated from the slot's own data
  const dataYears = [...new Set(slotData.traces.flatMap(tr => tr.points.map(p => p.year).filter(y => y != null)))].sort((a, b) => a - b);
  const dataMonths = [...new Set(slotData.traces.flatMap(tr => tr.points.map(p => p.month).filter(m => m != null)))].sort((a, b) => a - b);
  const yearOpts = [["", "Any"]].concat(dataYears.map(y => [String(y), String(y)]));
  const monthOpts = [["", "All months"]].concat(dataMonths.map(m => [String(m), MONTH_NAMES[m - 1] + " (" + m + ")"]));
  const monthsValue = Array.isArray(block.filters.months) ? String(block.filters.months[0] || "") : String(block.filters.months || "");
  pGrid.appendChild(tableControlWrap("Traces", tableControlSelect("traces", [["visible", "Currently visible"], ["ensemble", "Ensemble only"], ["all", "All traces"]], block.filters.traces)));
  pGrid.appendChild(tableControlWrap("Year from", tableControlSelect("yearFrom", yearOpts, block.filters.yearFrom)));
  pGrid.appendChild(tableControlWrap("Year to", tableControlSelect("yearTo", yearOpts, block.filters.yearTo)));
  pGrid.appendChild(tableControlWrap("Months", tableControlSelect("months", monthOpts, monthsValue)));
  // total-column checkboxes sit directly in the grid (monthly tables only)
  const wyCheck = tableControlInput("wyTotals", block.wyTotals, "checkbox");
  const cyCheck = tableControlInput("cyTotals", block.cyTotals, "checkbox");
  const wyLbl = document.createElement("label");
  wyLbl.className = "check-row";
  wyLbl.title = "Append each trace's water-year total as an extra column (monthly tables only)";
  wyLbl.appendChild(wyCheck);
  wyLbl.appendChild(document.createTextNode("WY sum"));
  const cyLbl = document.createElement("label");
  cyLbl.className = "check-row";
  cyLbl.title = "Append each trace's calendar-year total as an extra column (monthly tables only)";
  cyLbl.appendChild(cyCheck);
  cyLbl.appendChild(document.createTextNode("CY sum"));
  if (isMonthly) { pGrid.appendChild(wyLbl); pGrid.appendChild(cyLbl); }
  if (block.filters.conditions && block.filters.conditions.length) {
    const condNote = document.createElement("div");
    condNote.className = "hint";
    condNote.style.gridColumn = "1 / -1";
    condNote.textContent = "Value conditions from this preset are active (" + block.filters.conditions.length +
      "), keeping only matching trace/year combinations. Edit them in the Preset Builder.";
    pGrid.appendChild(condNote);
  }
  // on-page value filter — applies to the value shown (monthly value, or the
  // per-year aggregation): non-matching cells are blanked, or matching cells
  // are highlighted when mode is "highlight"
  const pfOpWrap = tableControlWrap("Value filter", tableControlSelect("pageFilterOp", [["<", "<"], ["<=", "≤"], [">", ">"], [">=", "≥"], ["=", "="], ["!=", "≠"], ["between", "between"]], block.pageFilter.op));
  pfOpWrap.title = "Filters the value shown (monthly value, or per-year aggregation)";
  pGrid.appendChild(pfOpWrap);
  const pfValWrap = tableControlWrap("Filter value", tableControlInput("pageFilterValue", block.pageFilter.value));
  pfValWrap.title = "Empty = filter off";
  pGrid.appendChild(pfValWrap);
  const pf2Wrap = tableControlWrap("and value", tableControlInput("pageFilterValue2", block.pageFilter.value2));
  pf2Wrap.title = "Second bound for the between operator";
  if (block.pageFilter.op !== "between") pf2Wrap.style.display = "none";
  pGrid.appendChild(pf2Wrap);
  pGrid.appendChild(tableControlWrap("Filter mode", tableControlSelect("pageFilterMode", [
    ["filter", "Filter non-matching"],
    ["highlight", "Highlight matching"],
  ], block.pageFilter.mode)));
  panel.appendChild(pGrid);
  panel.querySelectorAll("[data-tfield]").forEach(el => {
    el.addEventListener("change", () => {
      const f = el.dataset.tfield;
      if (f === "wyTotals" || f === "cyTotals") section._block[f] = el.checked;
      else if (f === "traces" || f === "logic") section._block.filters[f] = el.value;
      else if (f === "yearFrom" || f === "yearTo" || f === "months") section._block.filters[f] = el.value;
      else if (f === "pageFilterOp") { section._block.pageFilter.op = el.value; if (el.value !== "between") section._block.pageFilter.value2 = ""; }
      else if (f === "pageFilterValue") section._block.pageFilter.value = el.value;
      else if (f === "pageFilterValue2") section._block.pageFilter.value2 = el.value;
      else if (f === "pageFilterMode") section._block.pageFilter.mode = el.value;
      else if (f === "decimals" || f === "scale") section._block[f] = Number(el.value);
      else section._block[f] = el.value;
      if (section._blockKey) tableBlockSession.set(section._blockKey, section._block);  // keep across preset switches
      renderTableBlock(section, section._block);  // panel state preserved via section._filtersOpen
    });
  });
  // trace-column click -> highlight that trace everywhere (like the main table)
  const blockTable = () => section.querySelector(".scatter-points-table");
  panel.addEventListener("change", () => {
    const bt = blockTable();
    if (bt) bt.querySelectorAll("thead th[data-trace]").forEach(th => {
      th.classList.toggle("dt-hl", highlightedTrace != null && highlightedTrace === Number(th.dataset.trace));
    });
  });
  section.appendChild(panel);

  // trace columns: block filter + value conditions (trace::year pairs —
  // matching trace columns AND matching year rows are kept)
  let traces = tableTracesForBlock(block, slotData);
  const kept = evaluateTableConditions(block.filters.conditions, block.filters.logic);
  if (kept) traces = traces.filter(tr => kept.traces.has(tr.traceNumber));
  traces = [...traces].sort((a, b) => a.traceNumber - b.traceNumber);

  const unit = slotData.unit || "Value";
  const statText = block.rows === "monthly" ? "" : " \u00b7 " + (TABLE_STAT_LABELS[block.stat] || block.stat);
  const scaleText = (block.scale || 1) > 1 ? " \u00b7 values \u00f7 " + Number(block.scale).toLocaleString("en-US") : "";
  head.innerHTML =
    "<strong>" + escapeHtml(block.title || block.slot) + "</strong>" +
    '<span class="table-block-sub">' + escapeHtml(block.slot) + " \u00b7 " +
    (TABLE_ROWS_LABELS[block.rows] || block.rows) + statText + " \u00b7 unit: " + escapeHtml(unit) +
    scaleText +
    " \u00b7 " + traces.length + " traces</span>";
  addRemoveBtn();

  const built = tableRowGroups(slotData, block, traces);
  const scroll = document.createElement("div");
  scroll.className = "dt-scroll";
  section.appendChild(scroll);

  if (!built.groups.length || !traces.length) {
    scroll.innerHTML = '<div style="padding: 10px 2px; color: var(--ink-faint); font-size: 12px;">No data rows for the selected filters.</div>';
    return;
  }

  // optional monthly WY/CY total columns per trace
  const totalCols = [];
  if (built.rowsMode === "monthly" && block.wyTotals) totalCols.push({ label: "WY sum", basis: "water" });
  if (built.rowsMode === "monthly" && block.cyTotals) totalCols.push({ label: "CY sum", basis: "calendar" });
  const totalsByTrace = new Map();
  for (const t of totalCols) {
    for (const tr of traces) {
      const groups = groupValuesByBasis(tr.points, t.basis, []);
      const sums = new Map();
      for (const [y, vals] of groups) sums.set(y, statApply("sum", vals));
      if (!totalsByTrace.has(tr.traceNumber)) totalsByTrace.set(tr.traceNumber, new Map());
      totalsByTrace.get(tr.traceNumber).set(t.basis, sums);
    }
  }

  // on-page value filter — filter mode blanks cells that do not meet the
  // criteria; highlight mode marks the matching cells instead
  const pfCond = () => ({ op: block.pageFilter.op, value: Number(block.pageFilter.value), value2: Number(block.pageFilter.value2) });
  const pfOn = block.pageFilter.value !== "" && (block.pageFilter.op === "between"
    ? (Number.isFinite(Number(block.pageFilter.value)) && Number.isFinite(Number(block.pageFilter.value2)))
    : Number.isFinite(Number(block.pageFilter.value)));
  const pfBlanking = block.pageFilter.mode !== "highlight";
  const pfPass = v => pfOn && v != null && Number.isFinite(v) && valuePass(v, pfCond());
  const pfBlank = v => pfOn && pfBlanking && !pfPass(v);

  const scaleDiv = block.scale || 1;
  const scaled = v => (v == null || !Number.isFinite(v)) ? v : v / scaleDiv;
  const fmt = v => (v == null || !Number.isFinite(v)) ? "\u2014"
    : v.toLocaleString("en-US", { minimumFractionDigits: block.decimals, maximumFractionDigits: block.decimals });

  const table = document.createElement("table");
  table.className = "scatter-points-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.textContent = built.rowsMode === "monthly" ? "Period" : (built.rowsMode === "water_year" ? "Water year" : built.rowsMode === "annual" ? "Year" : "Calendar year");
  hr.appendChild(th0);
  for (const tr of traces) {
    const label = model.labels.get(tr.traceNumber) || traceLabel(tr.traceNumber);
    const th = document.createElement("th");
    th.dataset.trace = String(tr.traceNumber);
    th.title = "Click to highlight this trace in every chart";
    th.textContent = label + " (" + tr.traceNumber + ")";
    if (highlightedTrace === tr.traceNumber) th.classList.add("dt-hl");
    hr.appendChild(th);
    for (const t of totalCols) {
      const thT = document.createElement("th");
      thT.textContent = label + " " + t.label;
      thT.classList.add("total-col");
      hr.appendChild(thT);
    }
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  // value-cell click toggles the trace highlight (header clicks are now
  // column selection — see enableTableCellSelection)
  table.addEventListener("click", e => {
    const cell = e.target.closest("td[data-trace]");
    if (!cell) return;
    const tn = parseInt(cell.dataset.trace, 10);
    highlightedTrace = highlightedTrace === tn ? null : tn;
    renderTableBlock(section, section._block);
    refreshHighlight();
  });

  // row year helpers — monthly rows sit in a calendar year; their water year
  // is rowYear + 1 when the month is Oct-Dec
  const rowMeta = g => {
    const rowYear = Number(String(g.sortKey).slice(0, 4));
    let rowMonth = null;
    if (built.rowsMode === "monthly") {
      for (const tr of traces) {
        const p = tr.points.find(pt => (pt.periodDate || pt.timestep) === g.key);
        if (p && p.month != null) { rowMonth = p.month; break; }
      }
    }
    const wy = rowMonth != null ? rowYear + (rowMonth >= WY_START_MONTH ? 1 : 0) : rowYear;
    return { rowYear: rowYear, wy: wy };
  };

  const tbody = document.createElement("tbody");
  for (const g of built.groups) {
    if (kept && !kept.years.has(Number(g.sortKey))) continue;  // value conditions also filter rows
    const rowValues = traces.map(tr => {
      const items = g.values.get(tr.traceNumber) || [];
      return built.rowsMode === "monthly"
        ? (items.length ? (typeof items[0] === "object" ? items[0].value : items[0]) : null)
        : statApply(block.stat, items, built.rowsMode);
    });
    const hasAnyValue = rowValues.some(v => v != null && Number.isFinite(v));
    if (!hasAnyValue) continue;

    const meta = rowMeta(g);
    const rowEl = document.createElement("tr");
    rowEl.title = "Click to highlight this period row";
    const td0 = document.createElement("td");
    td0.className = "period";
    td0.textContent = g.label;
    rowEl.appendChild(td0);
    traces.forEach((tr, traceIdx) => {
      const v = rowValues[traceIdx];
      const pairKey = tr.traceNumber + "::" + meta.rowYear;
      const pairBlank = kept && !kept.pairs.has(pairKey);
      const td = document.createElement("td");
      td.dataset.trace = String(tr.traceNumber);  // click toggles the trace highlight
      const sv = scaled(v);
      td.textContent = (pairBlank || pfBlank(sv) || sv == null || !Number.isFinite(sv)) ? "—" : fmt(sv);
      if (pfOn && !pfBlanking && pfPass(sv)) td.classList.add("page-hl");
      if (highlightedTrace === tr.traceNumber) td.classList.add("dt-hl");
      rowEl.appendChild(td);
      for (const t of totalCols) {
        const tdT = document.createElement("td");
        tdT.classList.add("total-col");
        const sums = totalsByTrace.get(tr.traceNumber) && totalsByTrace.get(tr.traceNumber).get(t.basis);
        const y = t.basis === "water" ? meta.wy : meta.rowYear;
        const v = sums ? sums.get(y) : null;
        tdT.textContent = (v == null || !Number.isFinite(v)) ? "\u2014" : fmt(scaled(v));
        rowEl.appendChild(tdT);
      }
    });
    tbody.appendChild(rowEl);
  }
  table.appendChild(tbody);
  enableTableCellSelection(table);
  scroll.appendChild(table);

  // actions: copy + CSV
  const actionsBar = document.createElement("div");
  actionsBar.className = "scatter-data-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button"; copyBtn.className = "mini-button"; copyBtn.textContent = "Copy for Excel";
  const csvBtn = document.createElement("button");
  csvBtn.type = "button"; csvBtn.className = "mini-button"; csvBtn.textContent = "Download CSV";
  actionsBar.appendChild(copyBtn); actionsBar.appendChild(csvBtn);
  section.appendChild(actionsBar);

  const serialize = delimiter => {
    const header = [built.rowsMode === "monthly" ? "Period" : "Year"];
    for (const tr of traces) {
      const label = model.labels.get(tr.traceNumber) || traceLabel(tr.traceNumber);
      header.push(label + " (" + tr.traceNumber + ")");
      for (const t of totalCols) header.push(label + " " + t.label);
    }
    const lines = [header];
    built.groups.forEach(g => {
      const rowValues = traces.map(tr => {
        const items = g.values.get(tr.traceNumber) || [];
        return built.rowsMode === "monthly"
          ? (items.length ? (typeof items[0] === "object" ? items[0].value : items[0]) : null)
          : statApply(block.stat, items, built.rowsMode);
      });
      const hasAnyValue = rowValues.some(v => v != null && Number.isFinite(v));
      if (!hasAnyValue) return;

      const rowYear = Number(String(g.sortKey).slice(0, 4));
      const tr0 = traces[0];
      const p = built.rowsMode === "monthly" && tr0 ? tr0.points.find(pt => (pt.periodDate || pt.timestep) === g.key) : null;
      const rowMonth = p ? p.month : null;
      const wy = built.rowsMode === "monthly" && rowMonth != null ? rowYear + (rowMonth >= WY_START_MONTH ? 1 : 0) : rowYear;
      const row = [g.label];
      traces.forEach((tr, traceIdx) => {
        const v = rowValues[traceIdx];
        const pairKey = tr.traceNumber + "::" + rowYear;
        const pairBlank = kept && !kept.pairs.has(pairKey);
        const shown = scaled(v);
        row.push((pairBlank || pfBlank(shown) || shown == null || !Number.isFinite(shown)) ? "\u2014" : fmt(shown));
        for (const t of totalCols) {
          const sums = totalsByTrace.get(tr.traceNumber) && totalsByTrace.get(tr.traceNumber).get(t.basis);
          const y = t.basis === "water" ? wy : rowYear;
          const v = sums && sums.get(y);
          row.push((v == null || !Number.isFinite(v)) ? "\u2014" : fmt(scaled(v)));
        }
      });
      lines.push(row);
    });
    return lines.map(row => row.map(cell => {
      const text = String(cell == null ? "" : cell);
      return delimiter === "," ? '"' + text.replaceAll('"', '""') + '"' : text.replaceAll("\t", " ");
    }).join(delimiter)).join("\r\n");
  };

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(serialize("\t"));
      copyBtn.textContent = "Copied";
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = serialize("\t");
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      copyBtn.textContent = "Copied";
    }
    setTimeout(() => { copyBtn.textContent = "Copy for Excel"; }, 3000);
  });
  csvBtn.addEventListener("click", () => {
    const name = String((block.title || block.slot) + "-" + built.rowsMode).replace(/[^A-Za-z0-9_.-]+/g, "_");
    downloadBlob(new Blob([serialize(",")], { type: "text/csv;charset=utf-8" }), name + ".csv");
  });
}

/* =========================================================================
 * Operating Condition Probability Table Preset Engine
 * ========================================================================= */

const probabilityTableSession = new Map();

function evaluateArithmetic(expr) {
  const tokens = [];
  let i = 0;
  const s = String(expr || "").trim();
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')') {
      tokens.push(ch);
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < s.length && /[0-9.]/.test(s[i])) {
        numStr += s[i];
        i++;
      }
      tokens.push(parseFloat(numStr));
    } else {
      i++;
    }
  }

  let pos = 0;
  function parseExpr() {
    let val = parseTerm();
    while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const op = tokens[pos++];
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm() {
    let val = parseFactor();
    while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
      const op = tokens[pos++];
      const rhs = parseFactor();
      val = op === '*' ? val * rhs : (rhs !== 0 ? val / rhs : 0);
    }
    return val;
  }

  function parseFactor() {
    if (pos >= tokens.length) return 0;
    const t = tokens[pos++];
    if (typeof t === 'number') return t;
    if (t === '-') return -parseFactor();
    if (t === '+') return parseFactor();
    if (t === '(') {
      const val = parseExpr();
      if (pos < tokens.length && tokens[pos] === ')') pos++;
      return val;
    }
    return 0;
  }

  return parseExpr();
}

function getTraceAnnualPoint(slotData, traceNumber, year) {
  if (!slotData || !slotData.traces) return null;
  for (const tr of slotData.traces) {
    if (tr.traceNumber === traceNumber) {
      for (const p of tr.points) {
        const y = p.year != null ? p.year : (typeof pointYear === "function" ? pointYear(p) : null);
        if (y === year) return p;
      }
      return null;
    }
  }
  return null;
}

function computeSlotProbability(slotName, year, activeTraces) {
  const slotData = model.slots.get(slotName);
  if (!slotData || !activeTraces.length) return 0;
  let flagCount = 0;
  for (const t of activeTraces) {
    const p = getTraceAnnualPoint(slotData, t, year);
    if (p && p.value > 0) flagCount += 1;
  }
  return (flagCount / activeTraces.length) * 100;
}

function computeFormulaProbability(formula, year, activeTraces, calculatedRowMap) {
  if (!formula) return 0;
  const resolved = formula.replace(/\[([^\]]+)\]/g, (match, token) => {
    const rawToken = token.trim();
    if (calculatedRowMap && calculatedRowMap.has(rawToken)) {
      return String(calculatedRowMap.get(rawToken));
    }
    const val = computeSlotProbability(rawToken, year, activeTraces);
    return String(val);
  });
  const res = evaluateArithmetic(resolved);
  return Number.isFinite(res) ? res : 0;
}

function collectProbabilityYears(presetRows, presetYears) {
  if (Array.isArray(presetYears) && presetYears.length) {
    return presetYears.slice().sort((a, b) => a - b);
  }
  const years = new Set();
  const slotNames = new Set();
  for (const row of presetRows) {
    if (row.slot) slotNames.add(row.slot);
    if (row.formula) {
      const matches = row.formula.matchAll(/\[([^\]]+)\]/g);
      for (const m of matches) slotNames.add(m[1].trim());
    }
  }
  for (const slotName of slotNames) {
    const slotData = model.slots.get(slotName);
    if (!slotData) continue;
    for (const tr of slotData.traces) {
      for (const p of tr.points) {
        const y = p.year != null ? p.year : (typeof pointYear === "function" ? pointYear(p) : null);
        if (y != null && y >= 1900 && y <= 2100) years.add(y);
      }
    }
  }
  if (!years.size) {
    for (const [slotName, slotData] of model.slots) {
      if (typeof isAnnualSlot === "function" && isAnnualSlot(slotData)) {
        for (const tr of slotData.traces) {
          for (const p of tr.points) {
            const y = p.year != null ? p.year : (typeof pointYear === "function" ? pointYear(p) : null);
            if (y != null && y >= 1900 && y <= 2100) years.add(y);
          }
        }
      }
    }
  }
  return [...years].sort((a, b) => a - b);
}

function renderProbabilityTablePreset(preset) {
  const grid = document.getElementById("plotGrid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = "minmax(0, 1fr)";

  const presetKey = preset.id || ("probPreset" + currentTablePresetIndex);
  if (!probabilityTableSession.has(presetKey)) {
    probabilityTableSession.set(presetKey, JSON.parse(JSON.stringify(preset.rows || [])));
  }
  const rows = probabilityTableSession.get(presetKey);

  const vfilter = typeof visibleTraceFilter === "function" ? visibleTraceFilter() : null;
  const activeTraces = vfilter
    ? [...vfilter]
    : (model && model.traceNumbers ? [...model.traceNumbers] : []);
  const years = collectProbabilityYears(rows, preset.years);

  const card = document.createElement("section");
  card.className = "table-block prob-table-block";
  grid.appendChild(card);

  // Header
  const head = document.createElement("div");
  head.className = "table-block-head";
  const titleGroup = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = preset.name || "Operating Condition Probabilities";
  titleGroup.appendChild(strong);
  if (preset.description || (preset.notes && preset.notes.length)) {
    const sub = document.createElement("div");
    sub.className = "table-block-sub";
    sub.textContent = preset.description || preset.notes[0];
    titleGroup.appendChild(sub);
  }
  head.appendChild(titleGroup);

  // Toolbar actions
  const actions = document.createElement("div");
  actions.className = "prob-table-actions";
  actions.style.cssText = "display:flex; align-items:center; gap:8px; flex-wrap:wrap;";

  const infoBadge = document.createElement("span");
  infoBadge.className = "hint";
  infoBadge.textContent = activeTraces.length + " active traces · " + years.length + " years";
  actions.appendChild(infoBadge);

  const toggleAddBtn = document.createElement("button");
  toggleAddBtn.type = "button";
  toggleAddBtn.className = "mini-button";
  toggleAddBtn.textContent = "+ Add row";
  actions.appendChild(toggleAddBtn);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "mini-button";
  copyBtn.textContent = "Copy for Excel";
  actions.appendChild(copyBtn);

  const csvBtn = document.createElement("button");
  csvBtn.type = "button";
  csvBtn.className = "mini-button";
  csvBtn.textContent = "Download CSV";
  actions.appendChild(csvBtn);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "mini-button";
  resetBtn.textContent = "Reset table";
  resetBtn.title = "Reset session changes back to preset defaults";
  resetBtn.addEventListener("click", () => {
    probabilityTableSession.set(presetKey, JSON.parse(JSON.stringify(preset.rows || [])));
    renderProbabilityTablePreset(preset);
  });
  actions.appendChild(resetBtn);

  head.appendChild(actions);
  card.appendChild(head);

  // Add Row collapsible builder panel
  let editingRowIdx = null;
  const addPanel = document.createElement("div");
  addPanel.className = "prob-add-row-panel";
  addPanel.style.cssText = "display:none; margin: 10px 0 16px; padding: 12px; background: #fbfcfc; border: 1px solid var(--line); border-radius: 8px;";
  
  addPanel.innerHTML = `
    <div id="probPanelTitle" style="font-weight: 700; font-size: 12px; margin-bottom: 8px; color: var(--ink);">Add Row to Table</div>
    <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end;">
      <label style="display:grid; gap:3px; font-size:11px;">
        <span>Row Type</span>
        <select id="probNewType" style="padding:4px 6px;">
          <option value="slot">Slot Flag</option>
          <option value="formula">Formula (Expression)</option>
          <option value="header">Section Header</option>
        </select>
      </label>
      <label style="display:grid; gap:3px; font-size:11px; flex:1; min-width:180px;">
        <span>Row Label</span>
        <input id="probNewLabel" type="text" placeholder="e.g. Annual release > 8.23 maf" style="padding:4px 6px;">
      </label>
      <label id="probSlotField" style="display:grid; gap:3px; font-size:11px; flex:1; min-width:200px;">
        <span>Slot</span>
        <select id="probNewSlot" style="padding:4px 6px;"></select>
      </label>
      <div id="probFormulaField" style="display:none; gap:6px; font-size:11px; flex:2; min-width:320px; flex-direction:column;">
        <label style="display:grid; gap:3px;">
          <span>Formula (e.g. [SlotA] + [SlotB])</span>
          <input id="probNewFormula" type="text" placeholder="e.g. [SlotA] + [SlotB]" style="padding:4px 6px; font-family:monospace; font-size:11.5px;">
        </label>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; background:#edf3f6; padding:6px 8px; border-radius:6px; border:1px solid #d4e0e5;">
          <span style="font-weight:600; color:var(--ink-soft); font-size:10.5px;">Insert Slot:</span>
          <select id="probFormulaSlotPick" style="padding:3px 6px; font-size:11px; max-width:240px;"></select>
          <button type="button" id="probInsertSlotBtn" class="mini-button" style="height:24px; padding:2px 8px; font-size:11px;">+ Insert</button>
          <span style="border-left:1px solid #cbd7dc; height:16px; margin:0 2px;"></span>
          <button type="button" class="mini-button prob-op-btn" data-op=" + " title="Add" style="padding:2px 6px; font-size:11px;">+</button>
          <button type="button" class="mini-button prob-op-btn" data-op=" - " title="Subtract" style="padding:2px 6px; font-size:11px;">−</button>
          <button type="button" class="mini-button prob-op-btn" data-op=" * " title="Multiply" style="padding:2px 6px; font-size:11px;">×</button>
          <button type="button" class="mini-button prob-op-btn" data-op=" / " title="Divide" style="padding:2px 6px; font-size:11px;">÷</button>
          <button type="button" class="mini-button prob-op-btn" data-op="(" title="Open parenthesis" style="padding:2px 6px; font-size:11px;">(</button>
          <button type="button" class="mini-button prob-op-btn" data-op=")" title="Close parenthesis" style="padding:2px 6px; font-size:11px;">)</button>
          <button type="button" class="mini-button prob-op-btn" data-op="100 - " title="Invert (100 - X)" style="padding:2px 6px; font-size:11px;">100 −</button>
          <button type="button" id="probClearFormulaBtn" class="mini-button danger" style="height:24px; padding:2px 6px; font-size:11px; margin-left:auto;" title="Clear formula">Clear</button>
        </div>
      </div>
      <label id="probColorField" style="display:none; gap:3px; font-size:11px;">
        <span>Header Color</span>
        <select id="probNewColor" style="padding:4px 6px;">
          <option value="#fff2cc">Yellow (#fff2cc)</option>
          <option value="#f2f2f2">Light Gray (#f2f2f2)</option>
          <option value="#deebf7">Light Blue (#deebf7)</option>
          <option value="#e2efda">Light Green (#e2efda)</option>
          <option value="#ffffff">White (#ffffff)</option>
        </select>
      </label>
      <label id="probIndentField" style="display:grid; gap:3px; font-size:11px;">
        <span>Indent</span>
        <select id="probNewIndent" style="padding:4px 6px;">
          <option value="0">None (0)</option>
          <option value="1">Indented (1)</option>
          <option value="2">Double (2)</option>
        </select>
      </label>
      <div style="display:flex; gap:6px;">
        <button type="button" id="probSubmitAddBtn" class="mini-button" style="height:28px;">Add</button>
        <button type="button" id="probCancelAddBtn" class="mini-button" style="height:28px;">Cancel</button>
      </div>
    </div>
  `;
  card.appendChild(addPanel);

  // Wire addPanel fields
  const slotSel = addPanel.querySelector("#probNewSlot");
  const formulaSlotPick = addPanel.querySelector("#probFormulaSlotPick");
  const sortedSlotNames = [...model.slots.keys()].sort();
  for (const s of sortedSlotNames) {
    const opt1 = document.createElement("option");
    opt1.value = s;
    opt1.textContent = s;
    slotSel.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = s;
    opt2.textContent = s;
    formulaSlotPick.appendChild(opt2);
  }

  const typeSel = addPanel.querySelector("#probNewType");
  const slotField = addPanel.querySelector("#probSlotField");
  const formulaField = addPanel.querySelector("#probFormulaField");
  const colorField = addPanel.querySelector("#probColorField");
  const indentField = addPanel.querySelector("#probIndentField");

  typeSel.addEventListener("change", () => {
    const t = typeSel.value;
    slotField.style.display = t === "slot" ? "grid" : "none";
    formulaField.style.display = t === "formula" ? "flex" : "none";
    colorField.style.display = t === "header" ? "grid" : "none";
    indentField.style.display = t !== "header" ? "grid" : "none";
  });

  function insertIntoFormula(str) {
    const input = addPanel.querySelector("#probNewFormula");
    if (!input) return;
    const start = input.selectionStart != null ? input.selectionStart : input.value.length;
    const end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
    const v = input.value;
    input.value = v.slice(0, start) + str + v.slice(end);
    const newPos = start + str.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
  }

  addPanel.querySelector("#probInsertSlotBtn").addEventListener("click", () => {
    if (formulaSlotPick.value) {
      insertIntoFormula("[" + formulaSlotPick.value + "]");
    }
  });

  addPanel.querySelectorAll(".prob-op-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      insertIntoFormula(btn.dataset.op);
    });
  });

  addPanel.querySelector("#probClearFormulaBtn").addEventListener("click", () => {
    const input = addPanel.querySelector("#probNewFormula");
    if (input) {
      input.value = "";
      input.focus();
    }
  });

  toggleAddBtn.addEventListener("click", () => {
    if (addPanel.style.display === "none") {
      editingRowIdx = null;
      addPanel.querySelector("#probPanelTitle").textContent = "Add Row to Table";
      addPanel.querySelector("#probSubmitAddBtn").textContent = "Add";
      addPanel.querySelector("#probNewLabel").value = "";
      addPanel.querySelector("#probNewFormula").value = "";
      addPanel.style.display = "block";
    } else {
      addPanel.style.display = "none";
    }
  });
  addPanel.querySelector("#probCancelAddBtn").addEventListener("click", () => {
    editingRowIdx = null;
    addPanel.style.display = "none";
  });

  addPanel.querySelector("#probSubmitAddBtn").addEventListener("click", () => {
    const t = typeSel.value;
    const label = addPanel.querySelector("#probNewLabel").value.trim() || "Untitled";
    const indent = parseInt(addPanel.querySelector("#probNewIndent").value, 10) || 0;
    let newRowObj;
    if (t === "header") {
      newRowObj = { type: "header", label: label, color: addPanel.querySelector("#probNewColor").value };
    } else if (t === "formula") {
      newRowObj = { type: "formula", label: label, formula: addPanel.querySelector("#probNewFormula").value.trim(), indent: indent };
    } else {
      newRowObj = { type: "slot", label: label, slot: slotSel.value, indent: indent };
    }

    if (editingRowIdx != null && editingRowIdx >= 0 && editingRowIdx < rows.length) {
      rows[editingRowIdx] = newRowObj;
      editingRowIdx = null;
    } else {
      rows.push(newRowObj);
    }
    renderProbabilityTablePreset(preset);
  });

  if (!years.length) {
    const emptyNote = document.createElement("div");
    emptyNote.className = "empty-note";
    emptyNote.textContent = "No annual run years found in the currently loaded RDF data for this table. Check that an RDF with annual flag slots is loaded.";
    card.appendChild(emptyNote);
    return;
  }

  // Scroll wrapper + Table
  const scroll = document.createElement("div");
  scroll.className = "dt-scroll";
  const table = document.createElement("table");
  table.className = "data-table prob-matrix-table";

  // thead
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.className = "period";
  th0.style.minWidth = "280px";
  th0.textContent = "Operating Condition";
  htr.appendChild(th0);

  for (const y of years) {
    const th = document.createElement("th");
    th.textContent = String(y);
    th.style.textAlign = "center";
    th.style.minWidth = "64px";
    htr.appendChild(th);
  }
  const thAct = document.createElement("th");
  thAct.className = "prob-action-col";
  thAct.textContent = "Actions";
  thAct.style.width = "95px";
  thAct.style.textAlign = "center";
  htr.appendChild(thAct);
  thead.appendChild(htr);
  table.appendChild(thead);

  // tbody
  const tbody = document.createElement("tbody");
  const calculatedRowMap = new Map();

  rows.forEach((row, rowIdx) => {
    const tr = document.createElement("tr");
    if (row.type === "header") {
      tr.className = "prob-header-row";
      tr.style.backgroundColor = row.color || "#fff2cc";
      const td = document.createElement("td");
      td.colSpan = years.length + 1;
      td.style.fontWeight = "700";
      td.style.padding = "6px 10px";
      td.style.color = "#1f2937";
      td.textContent = row.label;
      tr.appendChild(td);

      const tdAct = document.createElement("td");
      tdAct.className = "prob-action-cell";
      tdAct.style.textAlign = "center";
      renderRowActions(tdAct, rowIdx);
      tr.appendChild(tdAct);
    } else {
      tr.className = "prob-data-row";
      const tdLabel = document.createElement("td");
      tdLabel.className = "period prob-label-cell";
      const indentPx = (row.indent || 0) * 16 + 10;
      tdLabel.style.paddingLeft = indentPx + "px";
      if (row.indent) {
        tdLabel.style.fontStyle = "italic";
        tdLabel.style.color = "var(--ink-soft)";
      } else {
        tdLabel.style.fontWeight = "600";
        tdLabel.style.color = "var(--ink)";
      }
      tdLabel.textContent = row.label;
      if (row.slot) tdLabel.title = "Slot: " + row.slot;
      if (row.formula) tdLabel.title = "Formula: " + row.formula;
      tr.appendChild(tdLabel);

      for (const y of years) {
        const td = document.createElement("td");
        td.className = "prob-val-cell";
        td.style.textAlign = "center";
        td.style.fontVariantNumeric = "tabular-nums";
        
        let pct = 0;
        if (row.formula) {
          pct = computeFormulaProbability(row.formula, y, activeTraces, calculatedRowMap);
        } else if (row.slot) {
          pct = computeSlotProbability(row.slot, y, activeTraces);
        }
        pct = Math.max(0, Math.min(100, pct));
        calculatedRowMap.set(row.label, pct);

        td.textContent = Math.round(pct) + "%";
        tr.appendChild(td);
      }

      const tdAct = document.createElement("td");
      tdAct.className = "prob-action-cell";
      tdAct.style.textAlign = "center";
      renderRowActions(tdAct, rowIdx);
      tr.appendChild(tdAct);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  scroll.appendChild(table);
  card.appendChild(scroll);

  function renderRowActions(td, rowIdx) {
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "mini-button";
    upBtn.textContent = "↑";
    upBtn.title = "Move row up";
    upBtn.disabled = rowIdx === 0;
    upBtn.style.padding = "2px 5px";
    upBtn.style.fontSize = "10px";
    upBtn.addEventListener("click", () => {
      if (rowIdx > 0) {
        const tmp = rows[rowIdx - 1];
        rows[rowIdx - 1] = rows[rowIdx];
        rows[rowIdx] = tmp;
        renderProbabilityTablePreset(preset);
      }
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "mini-button";
    downBtn.textContent = "↓";
    downBtn.title = "Move row down";
    downBtn.disabled = rowIdx === rows.length - 1;
    downBtn.style.padding = "2px 5px";
    downBtn.style.fontSize = "10px";
    downBtn.addEventListener("click", () => {
      if (rowIdx < rows.length - 1) {
        const tmp = rows[rowIdx + 1];
        rows[rowIdx + 1] = rows[rowIdx];
        rows[rowIdx] = tmp;
        renderProbabilityTablePreset(preset);
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "mini-button danger";
    delBtn.textContent = "✕";
    delBtn.title = "Remove row";
    delBtn.style.padding = "2px 5px";
    delBtn.style.fontSize = "10px";
    delBtn.addEventListener("click", () => {
      rows.splice(rowIdx, 1);
      renderProbabilityTablePreset(preset);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "mini-button";
    editBtn.textContent = "✎";
    editBtn.title = "Edit row";
    editBtn.style.padding = "2px 5px";
    editBtn.style.fontSize = "10px";
    editBtn.addEventListener("click", () => {
      editingRowIdx = rowIdx;
      const r = rows[rowIdx];
      addPanel.querySelector("#probPanelTitle").textContent = "Edit Row: " + (r.label || "Untitled");
      addPanel.querySelector("#probSubmitAddBtn").textContent = "Save Changes";
      addPanel.style.display = "block";

      const t = r.type || (r.formula ? "formula" : (r.slot ? "slot" : "header"));
      typeSel.value = t;
      typeSel.dispatchEvent(new Event("change"));

      addPanel.querySelector("#probNewLabel").value = r.label || "";
      if (t === "header") {
        addPanel.querySelector("#probNewColor").value = r.color || "#fff2cc";
      } else if (t === "formula") {
        addPanel.querySelector("#probNewFormula").value = r.formula || "";
        addPanel.querySelector("#probNewIndent").value = String(r.indent || 0);
      } else {
        if (r.slot) addPanel.querySelector("#probNewSlot").value = r.slot;
        addPanel.querySelector("#probNewIndent").value = String(r.indent || 0);
      }
      addPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    td.appendChild(upBtn);
    td.appendChild(downBtn);
    td.appendChild(editBtn);
    td.appendChild(delBtn);
  }

  function serializeMatrix(delim) {
    const lines = [];
    lines.push(["Operating Condition", ...years.map(String)].map(c => `"${String(c).replace(/"/g, '""')}"`).join(delim));

    for (const row of rows) {
      if (row.type === "header") {
        lines.push([`=== ${row.label} ===`, ...years.map(() => "")].map(c => `"${String(c).replace(/"/g, '""')}"`).join(delim));
      } else {
        const cells = [row.label];
        for (const y of years) {
          let pct = 0;
          if (row.formula) pct = computeFormulaProbability(row.formula, y, activeTraces, calculatedRowMap);
          else if (row.slot) pct = computeSlotProbability(row.slot, y, activeTraces);
          pct = Math.max(0, Math.min(100, pct));
          cells.push(Math.round(pct) + "%");
        }
        lines.push(cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(delim));
      }
    }
    return lines.join("\n");
  }

  copyBtn.addEventListener("click", async () => {
    const text = serializeMatrix("\t");
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied!";
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      copyBtn.textContent = "Copied!";
    }
    setTimeout(() => { copyBtn.textContent = "Copy for Excel"; }, 3000);
  });

  csvBtn.addEventListener("click", () => {
    const name = String(preset.id || preset.name || "operating_conditions").replace(/[^A-Za-z0-9_.-]+/g, "_");
    downloadBlob(new Blob([serializeMatrix(",")], { type: "text/csv;charset=utf-8" }), name + ".csv");
  });
}

function renderTablePreset(preset) {
  if (preset && (preset.type === "probability_matrix" || preset.kind === "probability_matrix" || Array.isArray(preset.rows))) {
    renderProbabilityTablePreset(preset);
    return;
  }
  const grid = document.getElementById("plotGrid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = "minmax(0, 1fr)";  // clamp track so wide tables scroll inside .dt-scroll, not the page

  // add-a-slot-table control (session-level: cleared when you switch presets)
  const addRow = document.createElement("div");
  addRow.className = "add-slot-row";
  const addSel = document.createElement("select");
  addSel.id = "addSlotSelect";
  for (const name of model.slots.keys()) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    addSel.appendChild(o);
  }
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "mini-button";
  addBtn.textContent = "+ Add slot table";
  addBtn.addEventListener("click", () => {
    const slot = addSel.value;
    if (!slot) return;
    sessionTableBlocks.push(newTableBlock(slot));
    renderTablePreset(TABLE_PRESETS[currentTablePresetIndex]);
  });
  addRow.appendChild(addSel);
  addRow.appendChild(addBtn);
  const addHint = document.createElement("span");
  addHint.className = "hint";
  addHint.textContent = "Adds a filterable table for any slot (kept, with its settings, for this session).";
  addRow.appendChild(addHint);
  grid.appendChild(addRow);

  const blocks = (preset.tables || []).concat(sessionTableBlocks);
  const presetKey = preset.id || ("preset" + currentTablePresetIndex);
  const presetCount = (preset.tables || []).length;
  const keyFor = (block, i) => i < presetCount
    ? presetKey + "#" + i
    : "session#" + (block.__uid != null ? block.__uid : (block.__uid = ++sessionBlockUid));
  const visible = blocks
    .map((block, i) => [block, keyFor(block, i)])
    .filter(([, key]) => !removedPresetBlocks.has(key));
  if (!visible.length) {
    const note = document.createElement("div");  // keep the add-table row above the note
    note.className = "empty-note";
    note.textContent = "No tables — add one with \u201c+ Add slot table\u201d above, or reload the page to restore the preset defaults.";
    grid.appendChild(note);
    return;
  }
  for (const [block, key] of visible) {
    const section = document.createElement("section");
    section.className = "table-block";
    grid.appendChild(section);
    section._blockKey = key;
    section._isSession = key.startsWith("session#");
    // restore this block's session state (panel edits survive preset switches)
    section._block = tableBlockSession.has(key)
      ? normalizeTableBlock(tableBlockSession.get(key))
      : normalizeTableBlock(block);
    tableBlockSession.set(key, section._block);
    renderTableBlock(section, section._block);
  }
}

function renderTablePresetBar() {
  const bar = document.getElementById("tablePresetBar");
  const dataPages = RESERVOIR_PAGES.filter(pg => pg.kind === "data" &&
    (!model || pg.reservoirs.some(name => reservoirSlots(pg, name).length)));
  if (!TABLE_PRESETS.length && !dataPages.length) { bar.style.display = "none"; return; }
  bar.style.display = "flex";
  bar.innerHTML = '<span class="bar-label">Tables</span>';
  TABLE_PRESETS.forEach((preset, idx) => {
    const btn = document.createElement("button");
    btn.textContent = preset.name || preset.id;
    btn.dataset.idx = String(idx);
    btn.addEventListener("click", () => selectTablePreset(idx));
    bar.appendChild(btn);
  });
  for (const pg of dataPages) {
    const btn = document.createElement("button");
    btn.textContent = pg.name;
    btn.dataset.resPage = pg.id;
    btn.title = "Per-reservoir tables: " + pg.slots.join(", ");
    btn.addEventListener("click", () => selectReservoirPage(pg));
    bar.appendChild(btn);
  }
}

