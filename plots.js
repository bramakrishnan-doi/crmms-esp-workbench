"use strict";
/* =========================================================================
 * Transforms — port of static/app.js transformExplorerTrace & helpers
 * ========================================================================= */

const MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WY_START_MONTH = 10;  // CRMMS water year: October through September

function periodLabel(point, timestepType) {
  if (timestepType === "annual" || point.month == null) {
    return point.year != null ? String(point.year) : point.timestep;
  }
  const yy = point.year != null ? String(point.year).slice(-2).padStart(2, "0") : "";
  return MONTH_ABBRS[(point.month || 1) - 1] + "-" + yy;
}

function transformTracePoints(points, transform) {
  const finite = points.filter(p => p.value != null && isFinite(p.value));
  if (transform === "water_year_sum" || transform === "calendar_year_sum") {
    const byYear = new Map();
    for (const p of finite) {
      const keyYear = transform === "water_year_sum"
        ? (p.year || 0) + ((p.month != null && p.month >= WY_START_MONTH) ? 1 : 0)
        : p.year;
      const bucketKey = String(keyYear);
      let bucket = byYear.get(bucketKey);
      if (!bucket) {
        const label = transform === "water_year_sum" ? "WY " + keyYear : String(keyYear);
        bucket = { key: label, x: label, label: label, value: 0, count: 0, year: keyYear, source: null };
        byYear.set(bucketKey, bucket);
      }
      bucket.value += p.value;
      bucket.count += 1;
    }
    return [...byYear.values()].sort((a, b) => a.year - b.year);
  }
  const out = [];
  for (const p of finite) {
    if (transform === "annual_raw") {
      out.push({ key: String(p.year), x: String(p.year), label: String(p.year), value: p.value, year: p.year, source: p });
    } else {  // raw
      const x = p.periodDate || p.timestep;
      out.push({ key: x, x: x, label: periodLabel(p), value: p.value, year: p.year, source: p });
    }
  }
  return out;
}

function applyUnitFactor(point, factor, offset) {
  if (factor === 1 && offset === 0) return point;
  const p = Object.assign({}, point);
  p.value = point.value * factor + offset;
  return p;
}

function quantile(values, q) {
  const arr = [...values].sort((a, b) => a - b);
  if (!arr.length) return null;
  const pos = (arr.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}

function percentileBandFor(series, low, high) {
  const byX = new Map();
  for (const s of series) {
    for (const p of s.points) {
      const k = String(p.x != null ? p.x : p.label);
      if (!byX.has(k)) byX.set(k, { label: p.label || k, values: [] });
      byX.get(k).values.push(p.value);
    }
  }
  const keys = [...byX.keys()].sort((a, b) => a.localeCompare(b));
  return {
    x: keys,
    labels: keys.map(k => byX.get(k).label),
    low: keys.map(k => quantile(byX.get(k).values, low)),
    median: keys.map(k => quantile(byX.get(k).values, 0.5)),
    high: keys.map(k => quantile(byX.get(k).values, high)),
  };
}

function pointYear(point) {
  if (point.year != null) return point.year;
  if (point.source && point.source.year != null) return point.source.year;
  const m = /20\d{2}/.exec(String(point.label != null ? point.label : point.x));
  return m ? parseInt(m[0], 10) : null;
}

function pickPoint(points, annualYear) {
  if (!annualYear) {
    return points.length ? points[points.length - 1] : null;
  }
  const target = parseInt(annualYear, 10);
  for (let i = points.length - 1; i >= 0; i--) {
    if (pointYear(points[i]) === target) return points[i];
  }
  return null;
}

/* Scatter snapshot — port of the app's snapshot() logic (app.js:2975-2990). */
function scatterSnapshot(series, transform, basis, scatterYear) {
  let pts = series.points;
  if (!scatterYear) return pts;
  const target = parseInt(scatterYear, 10);
  if (transform !== "raw") {
    pts = pts.filter(p => pointYear(p) === target);
    return pts;
  }
  // raw + year: end-of-year value
  if (basis === "water") {
    pts = pts.filter(p => p.source && (
      (p.source.year === target && p.source.month >= 1 && p.source.month <= 9) ||
      (p.source.year === target - 1 && p.source.month >= 10 && p.source.month <= 12) ||
      (p.source.year === target && p.source.month === 9)
    ));
    const endpoint = [...pts].reverse().find(p => p.source && p.source.month === 9);
    if (endpoint) return [endpoint];
    return pts.length ? [pts[pts.length - 1]] : [];
  }
  pts = pts.filter(p => p.source && p.source.year === target);
  const endpoint = [...pts].reverse().find(p => p.source && p.source.month === 12);
  if (endpoint) return [endpoint];
  return pts.length ? [pts[pts.length - 1]] : [];
}

/* =========================================================================
 * Plot engine — port of static/app.js renderOneExplorerPlot (single run)
 * ========================================================================= */

const RUN_COLOR = "#167c80";       // Run A teal (index.html:360)
const DIM_COLOR = "#9aa5aa";       // dimmed traces when highlighting (app.js:2965)
const ALPHA = 0.28;                // default trace opacity (app.js:2965)
const PLOT_FONT = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
const STACK_PALETTE = ["#167c80", "#d07a28", "#5577a8", "#8b6da8", "#6b9a55", "#c15b68", "#6b8793", "#b39b44"];

/* Linked highlighting: click a trace in any chart (or a table column) and the
 * same trace highlights everywhere while the others dim (app recipes:
 * highlight opacity 0.98 / width x2.3; dim #9aa5aa). */
let highlightedTrace = null;

function highlightState(traceNumber) {
  if (highlightedTrace == null) return "normal";
  return traceNumber === highlightedTrace ? "highlight" : "dim";
}

function lineVisual(item, state) {
  if (state === "highlight") return { color: rgba(RUN_COLOR, 0.98), width: Math.max(2.2, item.line_width * 2.3) };
  if (state === "dim") return { color: rgba(DIM_COLOR, Math.max(0.42, ALPHA * 1.15)), width: item.line_width };
  return { color: rgba(RUN_COLOR, ALPHA), width: item.line_width };
}

function pointVisual(baseColor, state, alphaNormal) {
  if (state === "highlight") return rgba(baseColor, 0.96);
  if (state === "dim") return rgba(DIM_COLOR, 0.5);
  return rgba(baseColor, alphaNormal);
}

function rgba(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
}

const TRANSFORM_LABELS = {
  raw: "Raw values",
  annual_raw: "Annual values",
  water_year_sum: "Water-year sum",
  calendar_year_sum: "Calendar-year sum",
};

function normalizeItem(item) {
  // defaults per static/app.js normalizeExplorerStackItem (app.js:2432-2468)
  const it = Object.assign({}, item);
  it.plot_type = it.plot_type || "line";
  it.slot = it.slot || "";
  it.plot_slots = Array.isArray(it.plot_slots) ? it.plot_slots : [];
  it.transform = it.transform || "raw";
  it.scatter_transform = it.scatter_transform || "raw";
  it.scatter_x_transform = it.scatter_x_transform || it.scatter_transform || "raw";
  it.scatter_y_transform = it.scatter_y_transform || it.scatter_transform || "raw";
  it.scatter_year = it.scatter_year != null ? String(it.scatter_year) : "";
  it.scatter_basis = it.scatter_basis === "water" ? "water" : "calendar";
  it.scatter_x_basis = it.scatter_x_basis === "water" ? "water" : "calendar";
  it.scatter_y_basis = it.scatter_y_basis === "water" ? "water" : "calendar";
  it.annual_year = it.annual_year != null ? String(it.annual_year) : "";
  it.bar_sort = it.bar_sort || "none";
  it.stacked_sort_slot = it.stacked_sort_slot || "";
  it.reference_lines = Array.isArray(it.reference_lines) ? it.reference_lines : [];
  it.title = it.title || "";
  it.subtitle = it.subtitle || "";
  it.x_axis_title = it.x_axis_title || "";
  it.y_axis_title = it.y_axis_title || "";
  it.line_width = Number(it.line_width) > 0 ? Number(it.line_width) : 1;
  it.show_grid = it.show_grid !== false;
  it.y_axis_mode = it.y_axis_mode || "auto";
  it.y_min = it.y_min != null ? it.y_min : "";
  it.y_max = it.y_max != null ? it.y_max : "";
  it.percentile_band = !!it.percentile_band;
  it.percentile_low = Number.isFinite(Number(it.percentile_low)) ? Number(it.percentile_low) : 10;
  it.percentile_high = Number.isFinite(Number(it.percentile_high)) ? Number(it.percentile_high) : 90;
  it.unit_factor = Number.isFinite(Number(it.unit_factor)) ? Number(it.unit_factor) : 1;
  it.unit_offset = Number.isFinite(Number(it.unit_offset)) ? Number(it.unit_offset) : 0;
  it.display_unit = it.display_unit || "";
  it.x_range_mode = it.x_range_mode || "full";
  it.x_range_start = it.x_range_start || "";
  it.x_range_end = it.x_range_end || "";
  it.y_slot = it.y_slot || "";
  it.stacked_legend_position = it.stacked_legend_position === "top" ? "top" : "bottom";
  it.box_line_overlay = it.box_line_overlay !== false;  // app default: checked (index.html:364)
  return it;
}

function normalizeRefLine(ref) {
  // app.js normalizeExplorerReferenceLine (app.js:2398-2412), extended with
  // axis: "y" (horizontal, default) or "x" (vertical at a date/category/number)
  const axis = ref && ref.axis === "x" ? "x" : "y";
  const raw = ref && ref.value;
  let value;
  if (axis === "x") {
    if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
    else if (typeof raw === "string" && raw.trim()) value = raw.trim();
    else return null;
  } else {
    value = Number(raw);
    if (!Number.isFinite(value)) return null;
  }
  let color = "#c0392b";
  if (ref && typeof ref.color === "string" && /^#[0-9a-f]{6}$/i.test(ref.color)) color = ref.color;
  const dashes = ["solid", "dot", "dash", "longdash", "dashdot", "longdashdot"];
  const dash = ref && dashes.indexOf(ref.dash) >= 0 ? ref.dash : "dash";
  let width = 1.25;
  if (ref && Number.isFinite(Number(ref.width)) && Number(ref.width) >= 0.5) width = Number(ref.width);
  // empty label ("") means no label; only an OMITTED label defaults to the value
  return { value: value, label: ref.label == null ? String(value) : String(ref.label), color: color, dash: dash, width: width, axis: axis };
}

function unitFor(slotData, item) {
  if (item.display_unit) return item.display_unit;
  if (slotData && slotData.unit) return slotData.unit;
  return "Value";
}

function visibleTraceFilter() {
  const tv = uiState.global.tracesVisible;
  if (tv == null) return null;
  return new Set(tv);
}

function tracesForSlot(slotData) {
  const vfilter = visibleTraceFilter();
  return vfilter ? slotData.traces.filter(tr => vfilter.has(tr.traceNumber)) : slotData.traces;
}

function seriesFor(slotData, item, transformOverride) {
  const transform = transformOverride || item.transform;
  return tracesForSlot(slotData).map(tr => ({
    traceNumber: tr.traceNumber,
    label: model.labels.get(tr.traceNumber) || traceLabel(tr.traceNumber),
    role: model.roles.get(tr.traceNumber) || "ensemble",
    points: transformTracePoints(tr.points, transform).map(p => applyUnitFactor(p, item.unit_factor, item.unit_offset)),
  }));
}

/* x-range — port of v63ConfiguredXRange (app.js:8256-8458). Applies only
 * when the plot's x values parse as dates; otherwise autorange. */
function computeXRange(item, plotTraces) {
  const mode = ["months12", "months24", "months36", "custom"].indexOf(item.x_range_mode) >= 0
    ? item.x_range_mode : "full";
  if (mode === "full") return null;
  const dates = [];
  for (const tr of plotTraces) {
    for (const v of (tr.x || [])) {
      if (typeof v !== "string") continue;  // numeric scatter/bar x values are not dates
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) dates.push(d);
    }
  }
  if (!dates.length) return null;
  dates.sort((a, b) => a - b);
  const start = dates[0], end = dates[dates.length - 1];

  function isoDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function monthStart(text, fallback) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(text || "").trim());
    if (!m) return fallback;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
  }
  function lastDayOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  if (mode === "custom") {
    let s = monthStart(item.x_range_start, start);
    let e = monthStart(item.x_range_end, end);
    e = lastDayOfMonth(e);
    if (s > e) { const tmp = s; s = e; e = tmp; }
    return [isoDate(s), isoDate(e)];
  }
  const n = mode === "months12" ? 12 : mode === "months36" ? 36 : 24;
  const e = new Date(start.getFullYear(), start.getMonth() + n, start.getDate() - 1);
  return [isoDate(start), isoDate(e)];
}

function refLineShapes(item) {
  const shapes = [], annotations = [];
  for (const raw of item.reference_lines) {
    const ref = normalizeRefLine(raw);
    if (!ref) continue;
    if (ref.axis === "x") {
      // vertical line: the value must match the x axis — dates ("2025-07-01"),
      // category labels, or numbers. A bare 4-digit year on a water-year-sum
      // category axis maps to its "WY yyyy" bucket label, and on a
      // calendar-year-sum axis to the "yyyy" category string.
      let xv = ref.value;
      const isYear = (typeof xv === "number" && Number.isInteger(xv) && xv >= 1900 && xv <= 2100) ||
        (typeof xv === "string" && /^\d{4}$/.test(xv));
      if (isYear) {
        const t = item.plot_type === "scatter" ? item.scatter_x_transform : item.transform;
        if (t === "water_year_sum") xv = "WY " + xv;
        else if (t === "calendar_year_sum") xv = String(xv);
      }
      shapes.push({
        type: "line", xref: "x", x0: xv, x1: xv,
        yref: "paper", y0: 0, y1: 1,
        line: { color: ref.color, width: ref.width, dash: ref.dash },
      });
      if (ref.label) {
        annotations.push({
          text: ref.label,
          xref: "x", x: xv, xanchor: "left", xshift: 5,
          yref: "paper", y: 1, yanchor: "top",
          showarrow: false, textangle: -90,
          bgcolor: "rgba(255,255,255,0.75)",
          borderpad: 2,
          font: { size: 9, color: ref.color },
        });
      }
      continue;
    }
    shapes.push({
      type: "line", xref: "paper", x0: 0, x1: 1,
      yref: "y", y0: ref.value, y1: ref.value,
      line: { color: ref.color, width: ref.width, dash: ref.dash },
    });
    if (ref.label) {
      annotations.push({
        text: ref.label,
        xref: "paper", x: 0.995, xanchor: "right",
        yref: "y", y: ref.value, yanchor: "bottom",
        showarrow: false,
        bgcolor: "rgba(255,255,255,0.75)",
        borderpad: 2,
        font: { size: 9, color: ref.color },
      });
    }
  }
  return { shapes: shapes, annotations: annotations };
}

function autoSubtitle(item, traceCount) {
  const parts = [];
  parts.push(TRANSFORM_LABELS[item.transform] || item.transform);
  if (item.plot_type === "scatter" && item.scatter_year) parts.push(item.scatter_year);
  parts.push(traceCount + (traceCount === 1 ? " trace" : " traces"));
  return parts.join(" \u00b7 ");
}

function baseLayout(item, opts) {
  const unit = opts.unit;
  const isScatter = item.plot_type === "scatter";
  const legend = opts.legend || null;
  // auto titles match the app (app.js:3073): scatter "X vs Y", stacked lists components
  const autoPlotTitle = item.plot_type === "scatter"
    ? item.slot + " vs " + (item.y_slot || "Y slot")
    : item.plot_type === "stacked_bar"
      ? [...new Set([item.slot, ...item.plot_slots].filter(Boolean))].join(" + ") + " \u00b7 Stacked bar"
      : item.slot;
  const title = item.title || autoPlotTitle;
  const subtitle = item.subtitle || autoSubtitle(item, opts.traceCount);

  const margin = { l: 72, r: 22, t: legend && legend.y > 1 ? 116 : (subtitle ? 76 : 58), b: 62 };
  if (legend && legend.y < 0) margin.b = 155;
  if (opts.categorical) margin.b = Math.max(margin.b, 118);

  const layout = {
    title: { text: title, x: 0.012, xanchor: "left", y: 0.985, yanchor: "top", font: { size: 17, color: "#2b3b43" } },
    annotations: [],
    hovermode: "closest",
    dragmode: "zoom",
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    margin: margin,
    showlegend: !!legend,
    font: { family: PLOT_FONT, size: 10, color: "#24343d" },
    hoverlabel: { font: { size: 10 }, namelength: 28, bgcolor: "#fff", bordercolor: "#aab5b9" },
    uirevision: item.slot + "|" + item.plot_type + "|" + (item.y_slot || ""),
    xaxis: {
      title: { text: item.x_axis_title || (isScatter ? item.slot : (opts.categorical || item.plot_type === "stacked_bar" ? "Trace" : (opts.dateAxis ? "Month" : "Period"))), font: { size: 11, color: "#44565f" } },
      automargin: true,
    },
    yaxis: {
      // scatter fallback shows the Y slot name with its unit (unit-only felt incomplete)
      title: { text: item.y_axis_title || (isScatter && item.y_slot ? item.y_slot + " (" + (opts.yUnit || unit) + ")" : unit), font: { size: 11, color: "#44565f" } },
      showgrid: item.show_grid !== false,
      gridcolor: "#e8ecee",
      zeroline: false,
      tickfont: { size: 10 },
      automargin: true,
      autorange: true,
    },
  };
  if (subtitle) {
    layout.annotations.push({
      text: subtitle, x: 0.012, y: 1.025, xref: "paper", yref: "paper",
      xanchor: "left", yanchor: "bottom", showarrow: false,
      font: { size: 10, color: "#718087" },
    });
  }
  if (legend) {
    layout.legend = Object.assign({ font: { size: 10 } }, legend);
  }
  // y-axis fixed range
  if (item.y_axis_mode === "fixed") {
    const ymin = Number(item.y_min), ymax = Number(item.y_max);
    if (Number.isFinite(ymin) && Number.isFinite(ymax) && ymax > ymin) {
      layout.yaxis.range = [ymin, ymax];
      layout.yaxis.autorange = false;
    }
  }
  // x-axis style
  if (opts.dateAxis) {
    layout.xaxis.type = "date";
    layout.xaxis.tickformat = "%b-%y";
    layout.xaxis.nticks = 12;
  } else if (opts.categorical) {
    layout.xaxis.tickangle = -90;
    layout.xaxis.tickfont = { size: 9 };
  }
  // Explicit bar/stacked-bar ordering: with a plain numeric x axis, Plotly
  // places each bar at its literal x value (the trace number), ignoring the
  // order of the data arrays -- so a "sort by slot" setting changed the array
  // order but never moved a bar on screen. A category axis positions bars by
  // array index instead, so categoryarray (the already-sorted trace numbers)
  // is what makes the sort visible.
  if (opts.categoryOrder) {
    layout.xaxis.type = "category";
    layout.xaxis.categoryorder = "array";
    layout.xaxis.categoryarray = opts.categoryOrder;
  }
  // x range (monthsN / custom)
  const xrange = computeXRange(item, opts.plotTraces || []);
  if (xrange) {
    layout.xaxis.range = xrange;
    layout.xaxis.autorange = false;
  }
  // reference lines
  const refs = refLineShapes(item);
  if (refs.shapes.length) {
    layout.shapes = refs.shapes;
    layout.annotations.push(...refs.annotations);
  }
  return layout;
}

const PLOTLY_CONFIG = { responsive: true, displaylogo: false, scrollZoom: true, displayModeBar: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] };

/* ---- line ---- */
function buildLineTraces(item, slotData, unit) {
  const traces = [];
  let series = seriesFor(slotData, item);
  const hasEnsemble = series.some(s => s.role !== "deterministic");
  const bandSeries = hasEnsemble ? series.filter(s => s.role !== "deterministic") : series;

  if (item.percentile_band) {
    const lowPct = Math.min(100, Math.max(0, item.percentile_low));
    const highPct = Math.min(100, Math.max(0, item.percentile_high));
    const low = lowPct / 100;
    const high = highPct / 100;
    const band = percentileBandFor(bandSeries, low, high);

    // Lower boundary trace (invisible base for tonexty fill, but carries outline line & hover)
    traces.push({
      type: "scatter", mode: "lines", x: band.x, y: band.low,
      line: { color: "rgba(13, 110, 110, 0.70)", width: 1.5, dash: "dot" },
      name: lowPct + "th Percentile",
      customdata: band.labels,
      hovertemplate: lowPct + "th Percentile<br>%{customdata}<br>%{y:.2f} " + unit + "<extra></extra>",
      showlegend: false,
    });

    // Upper boundary trace (fills down to lower boundary, carries outline line & hover)
    traces.push({
      type: "scatter", mode: "lines", x: band.x, y: band.high,
      fill: "tonexty", fillcolor: rgba(RUN_COLOR, 0.12),
      line: { color: "rgba(13, 110, 110, 0.70)", width: 1.5, dash: "dot" },
      name: highPct + "th Percentile",
      customdata: band.labels,
      hovertemplate: highPct + "th Percentile<br>%{customdata}<br>%{y:.2f} " + unit + "<extra></extra>",
      showlegend: false,
    });

    // 50th percentile (Median) line
    traces.push({
      type: "scatter", mode: "lines", x: band.x, y: band.median,
      line: { color: "#0d6e6e", width: 2.2, dash: "dash" },
      name: "Median (50th Percentile)",
      customdata: band.labels,
      hovertemplate: "Median (50th Percentile)<br>%{customdata}<br>%{y:.2f} " + unit + "<extra></extra>",
      showlegend: false,
    });
  }

  const dateAxis = item.transform === "raw";
  for (const s of series) {
    const vis = lineVisual(item, highlightState(s.traceNumber));
    traces.push({
      type: "scatter", mode: "lines",
      x: s.points.map(p => p.x),
      y: s.points.map(p => p.value),
      showlegend: false,
      line: { color: vis.color, width: vis.width },
      customdata: s.points.map(p => ["Current", s.label, s.traceNumber, p.label]),
      meta: s.traceNumber,
      hovertemplate: "%{customdata[1]} (Trace %{customdata[2]})<br>%{customdata[3]}<br>%{y:.2f} " + unit + "<extra></extra>",
    });
  }
  return { traces: traces, dateAxis: dateAxis, traceCount: series.length };
}

/* ---- scatter ---- */
function buildScatterTraces(item, xSlotData, ySlotData) {
  const xSeries = seriesFor(xSlotData, item, item.scatter_x_transform);
  const ySeries = seriesFor(ySlotData, item, item.scatter_y_transform);
  const yByTrace = new Map(ySeries.map(s => [s.traceNumber, s]));
  const traces = [];
  for (const xs of xSeries) {
    const ys = yByTrace.get(xs.traceNumber);
    if (!ys) continue;
    const xp = scatterSnapshot(xs, item.scatter_x_transform, item.scatter_x_basis, item.scatter_year);
    const yp = scatterSnapshot(ys, item.scatter_y_transform, item.scatter_y_basis, item.scatter_year);
    if (!xp.length || !yp.length) continue;
    const st = highlightState(xs.traceNumber);
    traces.push({
      type: "scatter", mode: "markers",
      x: [xp[0].value], y: [yp[0].value],
      marker: st === "highlight"
        ? { size: 9, color: rgba(RUN_COLOR, 1.0), opacity: 1.0 }
        : st === "dim"
          ? { size: 8, color: rgba(DIM_COLOR, 0.78), opacity: 0.55 }
          : { size: 8, color: rgba(RUN_COLOR, 0.78), opacity: 0.78 },
      customdata: [["Current", xp[0].label, xs.traceNumber, yp[0].label]],
      hovertemplate: "Trace %{customdata[2]}<br>X: %{x:.2f}<br>Y: %{y:.2f}<extra></extra>",
      showlegend: false,
      meta: xs.traceNumber,
    });
  }
  return traces;
}

/* ---- stacked bar ---- */
function buildStackedBarTraces(item, componentData) {
  const bySlot = new Map();   // slot -> Map(trace -> point)
  const traceSet = new Set();
  for (const [slotName, slotData] of componentData) {
    const series = seriesFor(slotData, item);
    const picked = new Map();
    for (const s of series) {
      const p = pickPoint(s.points, item.annual_year);
      if (p) picked.set(s.traceNumber, p);
      traceSet.add(s.traceNumber);
    }
    bySlot.set(slotName, picked);
  }
  let traceNumbers = [...traceSet].sort((a, b) => a - b);
  if (item.stacked_sort_slot && bySlot.has(item.stacked_sort_slot) && (item.bar_sort === "asc" || item.bar_sort === "desc")) {
    const sorter = bySlot.get(item.stacked_sort_slot);
    traceNumbers.sort((a, b) => {
      const va = sorter.has(a) ? sorter.get(a).value : -Infinity;
      const vb = sorter.has(b) ? sorter.get(b).value : -Infinity;
      const cmp = va - vb;
      return item.bar_sort === "asc" ? cmp : -cmp;
    });
  }
  const traces = [];
  componentData.forEach(([slotName], i) => {
    const picked = bySlot.get(slotName);
    const paletteColor = STACK_PALETTE[i % STACK_PALETTE.length];
    traces.push({
      type: "bar",
      x: traceNumbers.map(t => t),
      y: traceNumbers.map(t => (picked.has(t) ? picked.get(t).value : 0)),
      name: slotName,
      legendgroup: slotName,
      offsetgroup: "run",
      showlegend: true,
      marker: { color: traceNumbers.map(t => pointVisual(paletteColor, highlightState(t), 1)) },
      customdata: traceNumbers.map(t => {
        const p = picked.get(t);
        return [model.labels.get(t) || traceLabel(t), t, p ? p.label : ""];
      }),
      meta: traceNumbers,
      hovertemplate: "%{customdata[0]} (Trace %{customdata[1]})<br>" + slotName + ": %{y:.2f}<br>%{customdata[2]}<extra></extra>",
    });
  });
  const legend = item.stacked_legend_position === "top"
    ? { x: 0.5, xanchor: "center", y: 1.17, yanchor: "bottom", orientation: "h" }
    : { x: 0.5, xanchor: "center", y: -0.48, yanchor: "top", orientation: "h" };
  const ticktext = traceNumbers.map(t => (model && model.labels && model.labels.get(t)) || traceLabel(t));
  return { traces: traces, traceNumbers: traceNumbers, legend: legend, tickvals: traceNumbers, ticktext: ticktext };
}

/* ---- bar (one bar per trace) ---- */
function buildBarTraces(item, slotData) {
  const series = seriesFor(slotData, item);
  const picked = series.map(s => ({ s: s, p: pickPoint(s.points, item.annual_year) })).filter(e => e.p);
  if (item.bar_sort === "asc" || item.bar_sort === "desc") {
    picked.sort((a, b) => {
      const cmp = a.p.value - b.p.value;
      return item.bar_sort === "asc" ? cmp : -cmp;
    });
  }
  const traces = [{
    type: "bar",
    x: picked.map(e => e.s.traceNumber),
    y: picked.map(e => e.p.value),
    marker: { color: picked.map(e => pointVisual(RUN_COLOR, highlightState(e.s.traceNumber), 0.72)) },
    showlegend: false,
    customdata: picked.map(e => [e.s.label, e.s.traceNumber, e.p.label]),
    meta: picked.map(e => e.s.traceNumber),
    hovertemplate: "%{customdata[0]} (Trace %{customdata[1]})<br>%{customdata[2]}<br>%{y:.2f}<extra></extra>",
  }];
  const ticktext = picked.map(e => e.s.label + " (" + e.s.traceNumber + ")");
  return { traces: traces, tickvals: picked.map(e => e.s.traceNumber), ticktext: ticktext };
}

/* ---- box (per-period distribution; app recipe app.js:3016-3024) ---- */
function buildBoxTraces(item, slotData, unit) {
  const series = seriesFor(slotData, item);
  const traces = [];
  if (item.box_line_overlay) {
    for (const s of series) {
      const st = highlightState(s.traceNumber);
      traces.push({
        type: "scatter", mode: "lines",
        x: s.points.map(p => p.x),
        y: s.points.map(p => p.value),
        line: {
          color: st === "highlight" ? rgba(RUN_COLOR, 0.95) : st === "dim" ? rgba(DIM_COLOR, 0.42) : rgba(DIM_COLOR, 0.28),
          width: st === "highlight" ? Math.max(2.2, item.line_width * 2.3) : Math.max(0.5, item.line_width * 0.7),
        },
        hoverinfo: "skip", showlegend: false, meta: s.traceNumber,
      });
    }
  }
  const pooledX = [], pooledY = [];
  for (const s of series) {
    for (const p of s.points) {
      pooledX.push(String(p.x != null ? p.x : p.label));
      pooledY.push(p.value);
    }
  }
  if (pooledX.length) {
    traces.push({
      type: "box",
      x: pooledX, y: pooledY,
      marker: { color: RUN_COLOR },
      line: { color: RUN_COLOR, width: 0.9 },
      fillcolor: rgba(RUN_COLOR, 0.10),
      boxpoints: false,
      showlegend: false,
      meta: null,
    });
  }
  return { traces: traces, traceCount: series.length };
}

/* ---- on-plot year selector ----------------------------------------------
 * For bar / stacked-bar / scatter plots that filter by a single year
 * (water-year or calendar-year sum), the year lives on the card as a
 * dropdown populated with the years present in the data. */

const SUM_TRANSFORMS = ["water_year_sum", "calendar_year_sum"];

function isAnnualSlot(slotData) {
  if (!slotData) return false;
  if (slotData.timestepType === "annual" || slotData.timestepType === "year") return true;
  if (slotData.traces && slotData.traces.length > 0) {
    const pts = slotData.traces[0].points;
    if (pts && pts.length > 0 && pts[0].month == null && pts[0].year != null) return true;
  }
  return false;
}

function collectAnnualYears(slotData, years) {
  if (!slotData) return;
  for (const tr of tracesForSlot(slotData)) {
    for (const p of tr.points) {
      if (p.year != null) years.add(p.year);
    }
  }
}

function collectSumYears(slotData, transform, years) {
  if (!slotData) return;
  for (const tr of tracesForSlot(slotData)) {
    for (const p of transformTracePoints(tr.points, transform)) {
      if (p.year != null) years.add(p.year);
    }
  }
}

function yearOptionsFor(item) {
  if (!model) return null;
  if (item.plot_type === "bar" || item.plot_type === "stacked_bar") {
    const slotNames = item.plot_type === "stacked_bar"
      ? [item.slot, ...(item.plot_slots || [])].filter(Boolean)
      : [item.slot];
    const hasAnnual = slotNames.some(s => isAnnualSlot(model.slots.get(s)));
    if (hasAnnual) {
      const years = new Set();
      for (const s of slotNames) collectAnnualYears(model.slots.get(s), years);
      return years.size ? [...years].sort((a, b) => a - b) : null;
    }
    if (!SUM_TRANSFORMS.includes(item.transform)) return null;
    const years = new Set();
    for (const s of slotNames) collectSumYears(model.slots.get(s), item.transform, years);
    return years.size ? [...years].sort((a, b) => a - b) : null;
  }
  if (item.plot_type === "scatter") {
    const xSum = SUM_TRANSFORMS.includes(item.scatter_x_transform);
    const ySum = SUM_TRANSFORMS.includes(item.scatter_y_transform);
    if (!xSum && !ySum) return null;
    const xYears = new Set(), yYears = new Set();
    if (xSum) collectSumYears(model.slots.get(item.slot), item.scatter_x_transform, xYears);
    if (ySum) collectSumYears(model.slots.get(item.y_slot), item.scatter_y_transform, yYears);
    let years;
    if (xYears.size && yYears.size) {
      years = [...xYears].filter(y => yYears.has(y));  // years both axes can show
    } else {
      years = [...(xYears.size ? xYears : yYears)];
    }
    return years.length ? years.sort((a, b) => a - b) : null;
  }
  return null;
}

function yearFieldName(plotType) {
  return plotType === "scatter" ? "scatter_year" : "annual_year";
}

function applyCardYearChange(cardEl, preset, value) {
  const field = yearFieldName(cardEl._item.plot_type);
  const ui = presetUi(preset);
  const override = Object.assign({}, ui.overrides[cardEl._itemId] || {});
  override[field] = value;
  ui.overrides[cardEl._itemId] = override;
  saveUiState();
  cardEl._rawItem[field] = value;
  cardEl._item = normalizeItem(Object.assign({}, cardEl._rawItem));
  drawPlot(cardEl, cardEl._item, preset);
}

/* =========================================================================
 * Chart controls — per-plot settings, trace visibility, layout overrides.
 * Adjustments are persisted to localStorage per preset and can be undone
 * with the toolbar's "Reset preset" button.
 * ========================================================================= */

const UI_STORAGE_KEY = "crmmsPlotterUI.v1";
let uiState = { presets: {}, global: { tracesVisible: null } };
let currentPreset = null;
let currentPresetIndex = 0;
let currentTablePresetIndex = -1;
let sessionTableBlocks = [];
/* per-page-session table state: blockKey -> normalized block (panel edits
 * survive switching between table pages and plot presets; cleared on reload) */
const tableBlockSession = new Map();
const removedPresetBlocks = new Set();  // preset blocks hidden for this session via Remove
let sessionBlockUid = 0;  // stable keys for added tables (removal must not reshuffle state)
let viewMode = "plots";  // "plots" | "tables"
let toolbarWired = false;

function loadUiState() {
  // Purge any legacy persistent preset overrides from localStorage so old edits
  // don't corrupt preset chart definitions on reload.
  try {
    const rawLocal = localStorage.getItem(UI_STORAGE_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed && typeof parsed === "object") {
        if (parsed.global) uiState.global = parsed.global;
        if (parsed.presets) {
          delete parsed.presets;
          localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ global: uiState.global }));
        }
      }
    }
  } catch (err) { /* ignore */ }

  // Session-scoped preset overrides: edits survive switching between presets
  // during this tab session, but a reload or new file starts with fresh preset definitions.
  try {
    const rawSession = sessionStorage.getItem(UI_STORAGE_KEY);
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      if (parsed && typeof parsed === "object" && parsed.presets) {
        uiState.presets = parsed.presets;
      }
    }
  } catch (err) { /* storage unavailable — controls still work, just not persisted */ }
}

function saveUiState() {
  try { sessionStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ presets: uiState.presets })); } catch (err) { /* ignore */ }
  try { localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ global: uiState.global })); } catch (err) { /* ignore */ }
}

function presetUi(preset) {
  const id = preset.id || preset.name || "preset";
  if (!uiState.presets[id]) uiState.presets[id] = { overrides: {}, removed: [], added: [] };
  return uiState.presets[id];
}

function presetItems(preset) {
  const ui = presetUi(preset);
  const originals = (preset.plots || []).map((item, idx) => {
    const id = (preset.id || preset.name || "preset") + ":p" + idx;
    if ((ui.removed || []).indexOf(id) >= 0) return null;
    const merged = Object.assign({ __id: id }, item, ui.overrides[id] || {});
    // Fallback: If an edit pointed to a slot missing in the loaded model, but
    // the original preset has a valid slot, fall back to the preset's slot so
    // the chart does not break.
    if (model && model.slots && merged.slot && !model.slots.has(merged.slot) && item.slot && model.slots.has(item.slot)) {
      merged.slot = item.slot;
    }
    return merged;
  }).filter(Boolean);
  const customs = (ui.added || []).map(item => Object.assign({}, item, ui.overrides[item.__id] || {}));
  return originals.concat(customs);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function referenceLinesToText(refs) {
  return (refs || []).map(ref => {
    const fields = [
      String(ref.value), ref.label || "", ref.color || "#c0392b",
      ref.dash || "dash", String(ref.width != null ? ref.width : 1.25),
    ];
    if (ref.axis === "x") fields.push("x");
    return fields.join(" | ");
  }).join("\n");
}

function referenceLinesFromText(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split("|").map(p => p.trim());
    const axis = (parts[5] || "").toLowerCase() === "x" ? "x" : "y";
    let value;
    if (axis === "x") {
      if (!parts[0]) continue;
      // vertical lines may sit on date/category axes — keep strings intact
      value = parts[0] !== "" && Number.isFinite(Number(parts[0])) ? Number(parts[0]) : parts[0];
    } else {
      value = Number(parts[0]);
      if (!Number.isFinite(value)) continue;
    }
    out.push({
      value: value,
      label: parts.length > 1 ? (parts[1] || "") : undefined,  // empty field = no label
      color: /^#[0-9a-f]{6}$/i.test(parts[2] || "") ? parts[2] : "#c0392b",
      dash: parts[3] || "dash",
      width: Number(parts[4]) > 0 ? Number(parts[4]) : 1.25,
      axis: axis,
    });
  }
  return out;
}

/* ---- per-card controls panel ---- */

const PLOT_TYPE_OPTIONS = [
  ["line", "Line"], ["stacked_bar", "Stacked bar"], ["bar", "Bar (one per trace)"],
  ["scatter", "Scatter (X vs Y)"], ["box", "Box (per-period distribution)"],
];
const TRANSFORM_OPTIONS = [
  ["raw", "Raw values"], ["annual_raw", "Annual values (no sum)"],
  ["water_year_sum", "Water-year sum (Oct\u2013Sep)"], ["calendar_year_sum", "Calendar-year sum"],
];
const XRANGE_OPTIONS = [
  ["full", "Full period"], ["months12", "First 12 months"], ["months24", "First 24 months"],
  ["months36", "First 36 months"], ["custom", "Custom range"],
];
const BASIS_OPTIONS = [["calendar", "Calendar year"], ["water", "Water year (Oct\u2013Sep)"]];
const BARSORT_OPTIONS = [["none", "No sort"], ["asc", "Ascending"], ["desc", "Descending"]];
const LEGENDPOS_OPTIONS = [["bottom", "Bottom"], ["top", "Top"]];
const YAXIS_OPTIONS = [["auto", "Auto"], ["fixed", "Fixed range"]];

function controlField(labelText, el, opts) {
  const wrap = document.createElement("label");
  if (opts && opts.inline) wrap.className = "inline";
  if (opts && opts.span) wrap.classList.add("field-span");
  const span = document.createElement("span");
  span.textContent = labelText;
  wrap.appendChild(span);
  wrap.appendChild(el);
  return wrap;
}

function makeInput(type, value, field, attrs) {
  const el = document.createElement("input");
  el.type = type;
  el.value = value == null ? "" : String(value);
  el.dataset.field = field;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "span") continue;
      el.setAttribute(k, v);
    }
  }
  return el;
}

function makeCheckbox(checked, field) {
  const el = document.createElement("input");
  el.type = "checkbox";
  el.checked = !!checked;
  el.dataset.field = field;
  return el;
}

function makeSelect(options, value, field) {
  const el = document.createElement("select");
  el.dataset.field = field;
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt[0];
    o.textContent = opt[1];
    el.appendChild(o);
  }
  el.value = String(value == null ? options[0][0] : value);
  return el;
}

function buildCardControls(cardEl, details, item, preset, slotNames) {
  const panel = document.createElement("div");
  panel.className = "control-grid";
  details.appendChild(panel);

  const slotOptions = slotNames.map(s => [s, s]);
  const text = (label, value, name, attrs) => controlField(label, makeInput("text", value, name, attrs), { span: attrs && attrs.span });
  const number = (label, value, name, attrs) => controlField(label, makeInput("number", value, name, attrs || { step: "any" }));
  const checkbox = (label, checked, name) => controlField(label, makeCheckbox(checked, name), { inline: true });
  const select = (label, options, value, name) => controlField(label, makeSelect(options, value, name));

  panel.appendChild(select("Plot type", PLOT_TYPE_OPTIONS, item.plot_type, "plot_type"));

  if (item.plot_type === "line") {
    panel.appendChild(select("Transform", TRANSFORM_OPTIONS, item.transform, "transform"));
    panel.appendChild(number("Line width", item.line_width, "line_width", { min: 0.5, max: 8, step: 0.25 }));
    panel.appendChild(checkbox("Percentile band", item.percentile_band, "percentile_band"));
    panel.appendChild(number("Band low %", item.percentile_low, "percentile_low", { min: 0, max: 100 }));
    panel.appendChild(number("Band high %", item.percentile_high, "percentile_high", { min: 0, max: 100 }));
  } else if (item.plot_type === "scatter") {
    panel.appendChild(select("X slot", slotOptions, item.slot, "slot"));
    panel.appendChild(select("Y slot", slotOptions, item.y_slot, "y_slot"));
    panel.appendChild(select("X transform", TRANSFORM_OPTIONS, item.scatter_x_transform, "scatter_x_transform"));
    panel.appendChild(select("Y transform", TRANSFORM_OPTIONS, item.scatter_y_transform, "scatter_y_transform"));
    panel.appendChild(select("X basis", BASIS_OPTIONS, item.scatter_x_basis, "scatter_x_basis"));
    panel.appendChild(select("Y basis", BASIS_OPTIONS, item.scatter_y_basis, "scatter_y_basis"));
  } else if (item.plot_type === "stacked_bar") {
    panel.appendChild(select("Transform", TRANSFORM_OPTIONS, item.transform, "transform"));
    const components = [item.slot, ...item.plot_slots].filter((v, i, a) => v && a.indexOf(v) === i);
    const compField = text("Component slots (comma-separated)", components.join(", "), "plot_slots", { span: true });
    panel.appendChild(compField);
    const compInput = compField.querySelector("[data-field='plot_slots']");

    // quick-add picker: lets you append another slot to the stack without
    // having to type its exact name into the comma-separated box above
    // (this is the "options to add other slots" the text field alone lacked).
    const addWrap = document.createElement("label");
    addWrap.className = "field-span";
    const addLabel = document.createElement("span");
    addLabel.textContent = "Add component slot";
    addWrap.appendChild(addLabel);
    const addRow = document.createElement("div");
    addRow.style.cssText = "display:flex; gap:6px;";
    const remaining = slotOptions.filter(([s]) => !components.includes(s));
    const addSel = makeSelect(
      remaining.length ? remaining : [["", "(all slots already added)"]],
      remaining.length ? remaining[0][0] : "",
      ""
    );
    delete addSel.dataset.field;  // must NOT be swept by readCardControls() — it is a picker, not a saved field
    addSel.disabled = !remaining.length;
    addSel.addEventListener("change", e => e.stopPropagation());  // picking, not applying yet
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "mini-button";
    addBtn.textContent = "+ Add";
    addBtn.disabled = !remaining.length;
    addBtn.addEventListener("click", () => {
      if (!addSel.value) return;
      const next = [...components, addSel.value];
      compInput.value = next.join(", ");
      // apply directly (not via the panel's generic change listener) and force
      // a full card rebuild so the "Sort traces by slot" and this picker's
      // option lists refresh to include the newly added slot
      const ui = presetUi(preset);
      const prevOverride = ui.overrides[cardEl._itemId] || {};
      ui.overrides[cardEl._itemId] = Object.assign({}, prevOverride, { plot_slots: next });
      saveUiState();
      const effRaw = Object.assign({}, cardEl._rawItem, { plot_slots: next });
      renderPlotCard(cardEl, effRaw, preset);
    });
    addRow.appendChild(addSel);
    addRow.appendChild(addBtn);
    addWrap.appendChild(addRow);
    panel.appendChild(addWrap);

    const sortOptions = [["", "No sort"]].concat(components.map(s => [s, s]));
    panel.appendChild(select("Sort traces by slot", sortOptions, item.stacked_sort_slot, "stacked_sort_slot"));
    panel.appendChild(select("Bar sort", BARSORT_OPTIONS, item.bar_sort, "bar_sort"));
    panel.appendChild(select("Legend position", LEGENDPOS_OPTIONS, item.stacked_legend_position, "stacked_legend_position"));
  } else if (item.plot_type === "bar") {
    panel.appendChild(select("Transform", TRANSFORM_OPTIONS, item.transform, "transform"));
    panel.appendChild(select("Bar sort", BARSORT_OPTIONS, item.bar_sort, "bar_sort"));
  } else if (item.plot_type === "box") {
    panel.appendChild(select("Transform", TRANSFORM_OPTIONS, item.transform, "transform"));
    panel.appendChild(checkbox("Light trace lines behind boxes", item.box_line_overlay, "box_line_overlay"));
    panel.appendChild(number("Overlay line width", item.line_width, "line_width", { min: 0.5, max: 8, step: 0.25 }));
  }

  panel.appendChild(text("Title (empty = auto)", item.title, "title", { span: true, placeholder: item.slot }));
  panel.appendChild(text("Subtitle (empty = auto)", item.subtitle, "subtitle", { span: true }));
  panel.appendChild(text("X axis title (empty = auto)", item.x_axis_title, "x_axis_title"));
  panel.appendChild(text("Y axis title (empty = auto)", item.y_axis_title, "y_axis_title"));
  panel.appendChild(select("Y-axis scaling", YAXIS_OPTIONS, item.y_axis_mode, "y_axis_mode"));
  panel.appendChild(number("Y min", item.y_min, "y_min"));
  panel.appendChild(number("Y max", item.y_max, "y_max"));
  panel.appendChild(select("X range", XRANGE_OPTIONS, item.x_range_mode, "x_range_mode"));
  panel.appendChild(controlField("X range start", makeInput("month", item.x_range_start, "x_range_start")));
  panel.appendChild(controlField("X range end", makeInput("month", item.x_range_end, "x_range_end")));
  panel.appendChild(number("Unit factor", item.unit_factor, "unit_factor"));
  panel.appendChild(number("Unit offset", item.unit_offset, "unit_offset"));
  panel.appendChild(text("Display unit", item.display_unit, "display_unit", { placeholder: "auto" }));
  panel.appendChild(checkbox("Show grid", item.show_grid, "show_grid"));

  const refs = document.createElement("textarea");
  refs.dataset.field = "reference_lines_text";
  refs.value = referenceLinesToText(item.reference_lines);
  refs.placeholder = "value | label | color | dash | width | axis";
  panel.appendChild(controlField("Reference lines (one per line: value | label | color | dash | width | axis \u2014 add x for a vertical line at a date/category/number)", refs, { span: true }));

  panel.addEventListener("change", () => applyCardChanges(cardEl, preset));
}

function readCardControls(cardEl) {
  const patch = {};
  cardEl.querySelectorAll("[data-field]").forEach(el => {
    const f = el.dataset.field;
    patch[f] = el.type === "checkbox" ? el.checked : el.value;
  });
  if (typeof patch.plot_slots === "string") {
    patch.plot_slots = patch.plot_slots.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (patch.reference_lines_text != null) {
    patch.reference_lines = referenceLinesFromText(patch.reference_lines_text);
    delete patch.reference_lines_text;
  }
  return patch;
}

function applyCardChanges(cardEl, preset) {
  const prev = cardEl._item;
  const patch = readCardControls(cardEl);
  const ui = presetUi(preset);
  const prevOverride = ui.overrides[cardEl._itemId] || {};
  // the year lives on the card's Year dropdown, not in the settings panel —
  // carry the current year through panel edits so it is not dropped
  const carried = {};
  if (prevOverride.annual_year != null) carried.annual_year = prevOverride.annual_year;
  if (prevOverride.scatter_year != null) carried.scatter_year = prevOverride.scatter_year;
  ui.overrides[cardEl._itemId] = Object.assign({}, carried, patch);
  saveUiState();
  const effRaw = Object.assign({}, cardEl._rawItem, patch);
  const eff = normalizeItem(effRaw);
  const structural = patch.plot_type !== prev.plot_type || patch.x_range_mode !== prev.x_range_mode ||
    patch.transform !== prev.transform ||
    patch.scatter_x_transform !== prev.scatter_x_transform ||
    patch.scatter_y_transform !== prev.scatter_y_transform;
  if (structural) {
    renderPlotCard(cardEl, effRaw, preset);  // rebuild the controls panel too
  } else {
    cardEl._item = eff;
    drawPlot(cardEl, eff, preset);
  }
}

/* ---- card rendering ---- */

function drawPlot(cardEl, item, preset) {
  const plotDiv = cardEl.querySelector(".plot-area");
  // Plotly clears inline styles on react(), so the height must be re-asserted
  // before every draw or re-rendered plots collapse to zero height.
  plotDiv.style.height = preset._plotHeight + "px";
  let traces, layout;
  if (item.plot_type === "line") {
    const slotData = model.slots.get(item.slot);
    const unit = unitFor(slotData, item);
    const built = buildLineTraces(item, slotData, unit);
    traces = built.traces;
    layout = baseLayout(item, { unit: unit, traceCount: built.traceCount, dateAxis: built.dateAxis, plotTraces: traces });
  } else if (item.plot_type === "scatter") {
    const xData = model.slots.get(item.slot);
    const yData = model.slots.get(item.y_slot);
    const unit = unitFor(yData, item);  // y-axis title uses the Y slot's unit (app.js:3076)
    traces = buildScatterTraces(item, xData, yData);
    layout = baseLayout(item, { unit: unit, yUnit: unit, traceCount: traces.length, dateAxis: false, plotTraces: traces });
  } else if (item.plot_type === "stacked_bar") {
    const componentData = [];
    const seen = new Set();
    for (const name of [item.slot, ...item.plot_slots]) {
      if (name && !seen.has(name)) { seen.add(name); componentData.push([name, model.slots.get(name)]); }
    }
    const firstUnit = unitFor(componentData[0][1], item);
    const built = buildStackedBarTraces(item, componentData);
    traces = built.traces;
    layout = baseLayout(item, { unit: firstUnit, traceCount: built.traceNumbers.length, legend: built.legend, categorical: true, plotTraces: traces, categoryOrder: built.traceNumbers });
    layout.barmode = "relative";
    layout.xaxis.tickmode = "array";
    layout.xaxis.tickvals = built.tickvals;
    layout.xaxis.ticktext = built.ticktext;
  } else if (item.plot_type === "bar") {
    const slotData = model.slots.get(item.slot);
    const unit = unitFor(slotData, item);
    const built = buildBarTraces(item, slotData);
    traces = built.traces;
    layout = baseLayout(item, { unit: unit, traceCount: built.traces[0].x.length, categorical: true, plotTraces: traces, categoryOrder: built.traces[0].x });
    layout.barmode = "group";
    layout.xaxis.tickmode = "array";
    layout.xaxis.tickvals = built.tickvals;
    layout.xaxis.ticktext = built.ticktext;
  } else if (item.plot_type === "box") {
    const slotData = model.slots.get(item.slot);
    const unit = unitFor(slotData, item);
    const built = buildBoxTraces(item, slotData, unit);
    traces = built.traces;
    layout = baseLayout(item, { unit: unit, traceCount: built.traceCount, dateAxis: false, plotTraces: traces });
    layout.boxmode = "group";
  } else {
    plotDiv.innerHTML = '<div class="plot-slot-warning">Plot type "' + escapeHtml(item.plot_type) + '" is not supported by this viewer.</div>';
    return;
  }
  Plotly.react(plotDiv, traces, layout, PLOTLY_CONFIG);
  attachPlotClick(plotDiv);
  showPlotNote(cardEl, plotNoteFor(item, traces));
  if (item.plot_type === "scatter") {
    renderScatterDataTable(cardEl, item);
  } else {
    const staleHost = cardEl.querySelector(".scatter-data-host");
    if (staleHost) staleHost.remove();
  }
}

/* Zero-height bars and empty selections look like "nothing plotted" — show an
 * explanatory note on the card instead of a silently blank chart. */
function plotNoteFor(item, traces) {
  const ys = [];
  for (const t of traces) {
    for (const v of (t.y || [])) {
      if (Number.isFinite(v)) ys.push(v);
    }
  }
  if (!ys.length) {
    return "Nothing to plot — no visible traces or no finite values for this slot. Check the Traces menu in the toolbar and the slot's data.";
  }
  const allZero = ys.every(v => v === 0);
  if (!allZero) return null;
  if (item.plot_type === "bar" || item.plot_type === "stacked_bar" || item.plot_type === "box") {
    return "All plotted values are zero, so the bars/boxes have zero height (e.g., no spill events in the picked year). Try a different Annual year, transform, or slot in Plot settings.";
  }
  return null;
}

function showPlotNote(cardEl, text) {
  let note = cardEl.querySelector(".plot-note");
  if (!text) {
    if (note) note.remove();
    return;
  }
  if (!note) {
    note = document.createElement("div");
    note.className = "plot-note";
    const plotArea = cardEl.querySelector(".plot-area");
    cardEl.insertBefore(note, plotArea);
  }
  note.textContent = text;
}

function attachPlotClick(plotDiv) {
  if (!plotDiv.on) return;
  plotDiv.removeAllListeners("plotly_click");
  plotDiv.on("plotly_click", evt => {
    const pt = evt && evt.points && evt.points[0];
    if (!pt) return;
    const meta = pt.data && pt.data.meta;
    let tn = Array.isArray(meta) ? meta[pt.pointIndex] : meta;
    if (tn == null && pt.customdata && pt.customdata.length >= 3) tn = pt.customdata[2];
    tn = Number(tn);
    if (!Number.isFinite(tn)) return;
    highlightedTrace = highlightedTrace === tn ? null : tn;
    refreshHighlight();
  });
}

function refreshHighlight() {
  for (const card of document.querySelectorAll(".plot-card")) {
    if (card._item && card.querySelector(".plot-area")) {
      drawPlot(card, card._item, currentPreset);
    }
  }
  renderDataTable();
  updateHighlightHint();
}

function updateHighlightHint() {
  const el = document.getElementById("highlightInfo");
  if (!el) return;
  if (highlightedTrace == null) {
    el.classList.remove("active");
    el.textContent = "";
  } else {
    el.classList.add("active");
    const label = (model && model.labels.get(highlightedTrace)) || traceLabel(highlightedTrace);
    el.textContent = "Highlighted: " + label + " (trace " + highlightedTrace + ") \u2014 click it again to clear";
    el.style.cursor = "pointer";
    el.title = "Click to clear the highlight";
  }
}

function clearHighlight() {
  highlightedTrace = null;
  refreshHighlight();
}

function renderPlotCard(cardEl, rawItem, preset) {
  cardEl.innerHTML = "";
  cardEl._rawItem = Object.assign({}, rawItem);
  cardEl._itemId = rawItem.__id;
  const item = normalizeItem(rawItem);
  cardEl._item = item;

  const needed = item.plot_type === "scatter" ? [item.slot, item.y_slot]
    : item.plot_type === "stacked_bar" ? [item.slot, ...item.plot_slots]
    : [item.slot];
  const missing = needed.filter(name => name && !model.slots.has(name));

  const head = document.createElement("div");
  head.className = "card-head";

  // slot title block (App's .plot-card-slot)
  const slotBlock = document.createElement("div");
  slotBlock.className = "plot-card-slot";
  const slotTitle = document.createElement("strong");
  slotTitle.textContent = item.title || item.slot;
  slotTitle.title = item.slot;
  const slotSmall = document.createElement("small");
  slotSmall.textContent = item.plot_type === "scatter"
    ? item.slot + " \u00b7 " + (TRANSFORM_LABELS[item.scatter_x_transform] || item.scatter_x_transform) +
      " / " + (TRANSFORM_LABELS[item.scatter_y_transform] || item.scatter_y_transform)
    : item.slot + " \u00b7 " + (TRANSFORM_LABELS[item.transform] || item.transform);
  slotBlock.appendChild(slotTitle);
  slotBlock.appendChild(slotSmall);
  head.appendChild(slotBlock);

  // on-plot year selector for year-sum bar/stacked/scatter plots
  const yearOptions = missing.length ? null : yearOptionsFor(item);
  if (yearOptions) {
    const isScatter = item.plot_type === "scatter";
    const current = isScatter ? item.scatter_year : item.annual_year;
    const yearLabel = document.createElement("label");
    yearLabel.className = "card-year";
    yearLabel.title = "Year used by this plot's water-year/calendar-year sum";
    const yearSpan = document.createElement("span");
    yearSpan.textContent = "Year";
    const yearSel = document.createElement("select");
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = isScatter ? "Default (first year)" : "Latest year";
    yearSel.appendChild(defaultOpt);
    for (const y of yearOptions) {
      const o = document.createElement("option");
      o.value = String(y);
      o.textContent = (!isScatter && item.transform === "water_year_sum") ? "WY " + y : String(y);
      yearSel.appendChild(o);
    }
    yearSel.value = String(current);
    if (yearSel.selectedIndex < 0) yearSel.value = "";  // preset year not in this data
    yearSel.addEventListener("change", () => applyCardYearChange(cardEl, preset, yearSel.value));
    yearLabel.appendChild(yearSpan);
    yearLabel.appendChild(yearSel);
    head.appendChild(yearLabel);
    cardEl._yearSelect = yearSel;
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "card-remove";
  removeBtn.textContent = "Remove";
  removeBtn.title = "Remove this plot (undo with Reset preset)";
  head.appendChild(removeBtn);
  cardEl.appendChild(head);

  removeBtn.addEventListener("click", () => {
    const ui = presetUi(preset);
    if ((ui.added || []).some(a => a.__id === cardEl._itemId)) {
      ui.added = ui.added.filter(a => a.__id !== cardEl._itemId);
    } else if ((ui.removed || []).indexOf(cardEl._itemId) < 0) {
      ui.removed.push(cardEl._itemId);
    }
    delete ui.overrides[cardEl._itemId];
    saveUiState();
    renderPreset(currentPreset);
  });

  if (missing.length) {
    const warn = document.createElement("div");
    warn.className = "plot-slot-warning";
    warn.innerHTML = "<b>" + escapeHtml(item.title || item.slot || item.plot_type) + "</b><br>Slot" +
      (missing.length > 1 ? "s" : "") + " not found in the loaded RDF files: " +
      missing.map(m => "<code>" + escapeHtml(m) + "</code>").join(", ");
    cardEl.appendChild(warn);
    return;
  }

  // boxed Plot settings panel (App's .plot-display-settings)
  const details = document.createElement("details");
  details.className = "plot-display-settings";
  const summary = document.createElement("summary");
  summary.textContent = "Plot settings";
  details.appendChild(summary);
  cardEl.appendChild(details);
  buildCardControls(cardEl, details, item, preset, [...model.slots.keys()]);
  const plotDiv = document.createElement("div");
  plotDiv.className = "plot-area";
  cardEl.appendChild(plotDiv);
  drawPlot(cardEl, item, preset);
}

function renderPreset(preset) {
  const grid = document.getElementById("plotGrid");
  grid.innerHTML = "";
  const ui = presetUi(preset);
  const cols = String(ui.columns || (preset.layout && preset.layout.columns) || "2");
  grid.style.gridTemplateColumns =
    cols === "1" ? "1fr" :
    cols === "2" ? "repeat(2, minmax(0, 1fr))" :
    cols === "3" ? "repeat(3, minmax(0, 1fr))" :
    "repeat(auto-fit, minmax(480px, 1fr))";
  const height = Math.min(700, Math.max(250, Number(ui.height || (preset.layout && preset.layout.plot_height)) || 400));
  preset._plotHeight = height;
  const items = presetItems(preset);
  if (!items.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "All plots removed — use the toolbar's Add plot, or Reset preset to restore the saved plots.";
    grid.appendChild(note);
  }
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "plot-card";
    grid.appendChild(card);
    renderPlotCard(card, item, preset);
  }
  syncToolbar();
}

function renderPresetBar() {
  const bar = document.getElementById("presetBar");
  bar.style.display = "flex";
  bar.innerHTML = "";
  PRESETS.forEach((preset, idx) => {
    const btn = document.createElement("button");
    btn.textContent = preset.name || preset.id;
    btn.dataset.idx = String(idx);
    btn.addEventListener("click", () => selectPreset(idx));
    bar.appendChild(btn);
    if (idx === 0 && (preset.description || "")) {
      const desc = document.createElement("div");
      desc.className = "preset-desc";
      desc.textContent = preset.description;
      bar.appendChild(desc);
    }
  });
  const chartPages = RESERVOIR_PAGES.filter(pg => pg.kind === "charts");
  for (const pg of chartPages) {
    const resBtn = document.createElement("button");
    resBtn.textContent = pg.name;
    resBtn.dataset.resPage = pg.id;
    resBtn.title = "Per-reservoir charts: " + pg.slots.join(", ");
    resBtn.addEventListener("click", () => selectReservoirPage(pg));
    bar.appendChild(resBtn);
  }
}

function selectPreset(idx) {
  currentPresetIndex = idx;
  currentPreset = PRESETS[idx];
  viewMode = "plots";
  const bar = document.getElementById("presetBar");
  bar.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.idx === String(idx)));
  const tableBar = document.getElementById("tablePresetBar");
  if (tableBar) tableBar.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  hideResCardsPanel();
  updateDataTableSectionVisibility();
  renderPreset(currentPreset);
  if (model && document.getElementById("dtSlot").options.length) {
    document.getElementById("dtSlot").value = defaultDataTableSlot();
    renderDataTable();
  }
}

function selectTablePreset(idx) {
  currentTablePresetIndex = idx;
  currentPreset = null;
  viewMode = "tables";
  document.querySelectorAll("#presetBar button").forEach(b => b.classList.remove("active"));
  const tableBar = document.getElementById("tablePresetBar");
  tableBar.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.idx === String(idx)));
  hideResCardsPanel();
  updateDataTableSectionVisibility();
  renderTablePreset(TABLE_PRESETS[idx]);
}

/* the global data table lives on plot pages only — table presets replace it */
function updateDataTableSectionVisibility() {
  const section = document.getElementById("dataTableSection");
  if (section) section.style.display = (model && viewMode === "plots") ? "block" : "none";
}

