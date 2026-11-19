"use strict";
/* PARSER:START */
/* =========================================================================
 * RDF parsing — JavaScript port of rdf_reader.py (RWDataPlyr 0.6.6 format)
 * ========================================================================= */

function splitPair(line) {
  const idx = line.indexOf(":");
  if (idx < 0) return [line.trim(), null];
  return [line.slice(0, idx).trim(), line.slice(idx + 1).replace(/^\s+/, "")];
}

function coerceNumber(text, field) {
  const v = Number(String(text).trim());
  if (Number.isNaN(v)) {
    // Python float() also accepts nan/inf; mirror that.
    const t = String(text).trim().toLowerCase();
    if (t === "nan") return NaN;
    if (t === "inf" || t === "+inf") return Infinity;
    if (t === "-inf") return -Infinity;
    throw new Error("Invalid numeric " + field + ": " + JSON.stringify(String(text)));
  }
  return v;
}

function coerceInt(text, field) {
  const v = Math.trunc(coerceNumber(text, field));
  return v;
}

function normalizeTimestepType(unit, quantity) {
  if (unit == null) return null;
  const u = String(unit).trim().toLowerCase();
  const q = (quantity == null || quantity === 1) ? 1 : quantity;
  if (q === 1) {
    if (u === "month" || u === "months") return "monthly";
    if (u === "year" || u === "years") return "annual";
    if (u === "day" || u === "days") return "daily";
    if (u === "hour" || u === "hours") return "hourly";
    if (u === "minute" || u === "minutes") return "minutely";
  }
  return typeof q === "number" ? q + "-" + u : u;
}

/* Parse "2026-7-31 24:00" date label without 24:00 rollover.
 * Returns {periodDate: 'YYYY-MM-DD'|null, year, month, day}. */
function parsePeriodParts(timestep, timestepType) {
  const token = String(timestep).trim().split(/\s+/)[0] || "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token);
  if (!m) return { periodDate: null, year: null, month: null, day: null };
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  const mm = String(mo).padStart(2, "0"), dd = String(d).padStart(2, "0");
  return {
    periodDate: y + "-" + mm + "-" + dd,
    year: y,
    month: timestepType === "annual" ? null : mo,  // annual: month stays NA (rdf_reader.py:128-131)
    day: d,
  };
}

/* Parse one RDF file's text. Port of rdf_reader.py _scan(). */
function parseRdf(text, sourceName) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const errors = [];
  const meta = {};

  // --- package preamble ---
  let i = 0, sawPackageEnd = false;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (line === "END_PACKAGE_PREAMBLE") { sawPackageEnd = true; break; }
    if (!line.trim()) continue;
    const [k, v] = splitPair(line);
    meta[k] = v;
  }
  if (!sawPackageEnd) throw new Error(sourceName + ": END_PACKAGE_PREAMBLE was not found.");

  let expectedRuns = null;
  if (meta.number_of_runs) expectedRuns = coerceInt(meta.number_of_runs, "number_of_runs");

  const slots = new Map();  // object_slot -> {unit, scale, timestepType, traces: Map(traceNum -> {timesteps, values, isScalar})}
  let runIndex = 0;

  while (i < lines.length && (expectedRuns === null || runIndex < expectedRuns)) {
    while (i < lines.length && !lines[i].trim()) i += 1;
    if (i >= lines.length) break;
    runIndex += 1;

    // --- run preamble ---
    const header = {};
    let sawRunEnd = false;
    while (i < lines.length) {
      const line = lines[i];
      i += 1;
      if (line === "END_RUN_PREAMBLE") { sawRunEnd = true; break; }
      if (!line.trim()) continue;
      const [k, v] = splitPair(line);
      header[k] = v;
    }
    if (!sawRunEnd) throw new Error(sourceName + ": run " + runIndex + ": END_RUN_PREAMBLE was not found.");

    const nStepsText = header.time_steps != null ? header.time_steps : header.timesteps;
    if (nStepsText == null) throw new Error(sourceName + ": run " + runIndex + ": time_steps/timesteps is missing.");
    const nSteps = coerceInt(nStepsText, "time_steps");
    if (nSteps < 0) throw new Error(sourceName + ": run " + runIndex + ": time_steps cannot be negative.");
    if (i + nSteps > lines.length) throw new Error(sourceName + ": run " + runIndex + ": RDF ends before all timesteps are read.");
    const timesteps = lines.slice(i, i + nSteps);
    i += nSteps;

    const traceText = header.trace_num != null ? header.trace_num
      : header.trace != null ? header.trace
      : header.run_number;
    const traceNumber = traceText == null ? runIndex : coerceInt(traceText, "trace number");

    const timeStepUnit = header.time_step_unit != null ? header.time_step_unit : null;
    let timeStepQuantity = 1;
    if (header.unit_quantity != null && header.unit_quantity !== "") {
      const q = coerceNumber(header.unit_quantity, "unit_quantity");
      timeStepQuantity = Number.isInteger(q) ? q : q;
    }
    const timestepType = normalizeTimestepType(timeStepUnit, timeStepQuantity);

    // --- slot blocks ---
    while (i < lines.length) {
      while (i < lines.length && !lines[i].trim()) i += 1;
      if (i >= lines.length) break;
      if (lines[i] === "END_RUN") { i += 1; break; }

      // slot preamble
      const slotHeader = {};
      let sawSlotPreambleEnd = false;
      while (i < lines.length) {
        const line = lines[i];
        i += 1;
        if (line === "END_SLOT_PREAMBLE") { sawSlotPreambleEnd = true; break; }
        if (line === "END_RUN") throw new Error(sourceName + ": run " + runIndex + ": encountered END_RUN before END_SLOT_PREAMBLE.");
        if (!line.trim()) continue;
        const [k, v] = splitPair(line);
        slotHeader[k] = v;
      }
      if (!sawSlotPreambleEnd) throw new Error(sourceName + ": run " + runIndex + ": END_SLOT_PREAMBLE was not found.");
      const objectName = slotHeader.object_name, slotName = slotHeader.slot_name;
      if (!objectName || !slotName) throw new Error(sourceName + ": run " + runIndex + ": slot preamble is missing object_name or slot_name.");
      const objectSlot = objectName + "." + slotName;

      // units + scale lines come IMMEDIATELY after END_SLOT_PREAMBLE
      if (i >= lines.length) throw new Error(sourceName + ": run " + runIndex + ", " + objectSlot + ": unexpected end of file after slot header.");
      const [unitsKey, unit] = splitPair(lines[i]); i += 1;
      if (unitsKey !== "units") throw new Error(sourceName + ": run " + runIndex + ", " + objectSlot + ": expected 'units:' after END_SLOT_PREAMBLE, got " + JSON.stringify(unitsKey) + ".");
      if (i >= lines.length) throw new Error(sourceName + ": run " + runIndex + ", " + objectSlot + ": scale line is missing.");
      const [scaleKey, scaleText] = splitPair(lines[i]); i += 1;
      if (scaleKey !== "scale" || scaleText == null) throw new Error(sourceName + ": run " + runIndex + ", " + objectSlot + ": expected 'scale:' after units, got " + JSON.stringify(scaleKey) + ".");
      const scale = coerceNumber(scaleText, "scale");

      // data block: one value per line until END_SLOT
      const rawValues = [];
      let sawSlotEnd = false;
      while (i < lines.length) {
        const line = lines[i];
        i += 1;
        if (line === "END_SLOT") { sawSlotEnd = true; break; }
        if (line === "END_COLUMN") continue;
        if (!line || !line.trim()) continue;
        rawValues.push(line.trim());
      }
      if (!sawSlotEnd) throw new Error(sourceName + ": run " + runIndex + ", " + objectSlot + ": END_SLOT was not found.");

      const isScalar = rawValues.length === 1 && nSteps !== 1;
      if (rawValues.length !== 1 && rawValues.length !== nSteps) {
        throw new Error(sourceName + ": run " + runIndex + ", " + objectSlot + ": expected 1 scalar value or " + nSteps + " timestep values; found " + rawValues.length + ".");
      }

      if (!slots.has(objectSlot)) {
        slots.set(objectSlot, { unit: unit, scale: scale, timestepType: timestepType, traces: new Map() });
      }
      const slotRec = slots.get(objectSlot);
      const expanded = isScalar ? new Array(nSteps).fill(rawValues[0]) : rawValues;
      const values = expanded.map(v => coerceNumber(v, "value for " + objectSlot) * scale);
      slotRec.traces.set(traceNumber, {
        timesteps: timesteps,
        values: values,
        isScalar: isScalar,
      });
    }
  }

  if (expectedRuns !== null && runIndex !== expectedRuns) {
    throw new Error(sourceName + ": RDF metadata says number_of_runs=" + expectedRuns + ", but " + runIndex + " runs were parsed.");
  }
  return { name: sourceName, meta: meta, slots: slots, runCount: runIndex };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/* Parse a RiverWare create_date ("2023-3-10 12:55", "March 10, 2023",
 * "3/10/2023", ISO...) into {year, month, label} for the header badge. */
function parseCreateDate(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s) return null;
  let y = null, m = null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) { y = parseInt(match[1], 10); m = parseInt(match[2], 10); }
  if (m == null) {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (match) { m = parseInt(match[1], 10); y = parseInt(match[3], 10); }
  }
  if (m == null) {
    match = /^([A-Za-z]{3,})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
    if (match) {
      const idx = MONTH_NAMES.findIndex(n => n.toLowerCase().startsWith(match[1].slice(0, 3).toLowerCase()));
      if (idx >= 0) { m = idx + 1; y = parseInt(match[3], 10); }
    }
  }
  if (m == null) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) { y = d.getFullYear(); m = d.getMonth() + 1; }
  }
  if (y == null || m == null || m < 1 || m > 12) return null;
  return { year: y, month: m, label: MONTH_NAMES[m - 1] + " " + y, raw: s };
}

const CRMMS_ESP_MAPPING = {};  // trace 4 -> 1991 ... trace 33 -> 2020
for (let t = 4; t <= 33; t++) CRMMS_ESP_MAPPING[t] = 1987 + t;

function traceLabel(traceNumber) {
  if (CRMMS_ESP_MAPPING[traceNumber] != null) return String(CRMMS_ESP_MAPPING[traceNumber]);
  return "Trace " + traceNumber;
}

/* PARSER:END */

/* =========================================================================
 * Multi-file merge — mirrors main.py _build_explorer_payload dedupe rules:
 * duplicates keyed by (trace, timestep string) must agree; conflicting
 * values are reported; first occurrence wins.
 * ========================================================================= */

function classifyTraces(traceNumbers) {
  // main.py _explorer_trace_defaults: last 30 traces are the ESP ensemble;
  // preceding traces are deterministic (Max/Min/Most).
  const sorted = [...traceNumbers].sort((a, b) => a - b);
  const roles = new Map(), labels = new Map();
  const ensStart = Math.max(0, sorted.length - 30);
  const det = sorted.slice(0, ensStart);
  const detLabels = det.length === 3 ? ["Max", "Min", "Most"]
    : det.length === 2 ? ["Min", "Most"]
    : det.length === 1 ? ["Most"]
    : null;
  det.forEach((t, idx) => {
    roles.set(t, "deterministic");
    labels.set(t, detLabels ? detLabels[idx] : "Aux " + t);
  });
  sorted.slice(ensStart).forEach(t => {
    roles.set(t, "ensemble");
    labels.set(t, traceLabel(t));
  });
  return { roles: roles, labels: labels };
}

function mergeFiles(parsedFiles) {
  const slots = new Map();
  const conflicts = [];
  const traceNumbers = new Set();

  // model-run date: the latest create_date across the loaded files
  let runDate = null;
  for (const file of parsedFiles) {
    const parsed = parseCreateDate(file.meta && file.meta.create_date);
    if (parsed && (!runDate || parsed.year > runDate.year ||
        (parsed.year === runDate.year && parsed.month > runDate.month))) {
      runDate = parsed;
    }
  }

  for (const file of parsedFiles) {
    for (const [slotName, rec] of file.slots) {
      if (!slots.has(slotName)) {
        slots.set(slotName, {
          unit: rec.unit, scale: rec.scale, timestepType: rec.timestepType,
          traces: new Map(), files: new Set(),
        });
      }
      const target = slots.get(slotName);
      target.files.add(file.name);

      for (const [traceNumber, tr] of rec.traces) {
        traceNumbers.add(traceNumber);
        if (!target.traces.has(traceNumber)) {
          target.traces.set(traceNumber, { timesteps: tr.timesteps, values: tr.values.slice(), sourceFile: file.name });
          continue;
        }
        // duplicate (slot, trace): row-by-row on timestep string
        const existing = target.traces.get(traceNumber);
        for (let idx = 0; idx < tr.timesteps.length; idx++) {
          const ts = tr.timesteps[idx];
          const val = tr.values[idx];
          const pos = existing.timesteps.indexOf(ts);
          if (pos < 0) {
            existing.timesteps.push(ts);
            existing.values.push(val);
            continue;
          }
          const cur = existing.values[pos];
          const same = (cur === val) || (Number.isFinite(cur) && Number.isFinite(val) && cur === val);
          if (!same) {
            conflicts.push({
              slot: slotName, trace: traceNumber, timestep: ts,
              kept: { file: existing.sourceFile, value: cur },
              dropped: { file: file.name, value: val },
            });
          }
        }
      }
    }
  }

  // Build sorted point arrays per slot/trace
  const slotData = new Map();
  for (const [slotName, rec] of slots) {
    const traces = [];
    for (const [traceNumber, tr] of rec.traces) {
      const points = tr.timesteps.map((ts, idx) => {
        const tt = rec.timestepType;
        const parts = parsePeriodParts(ts, tt);
        return {
          timestep: ts,
          periodDate: parts.periodDate,
          year: parts.year, month: parts.month, day: parts.day,
          idx: idx + 1,
          value: tr.values[idx],
        };
      });
      points.sort((a, b) => {
        const ay = a.year == null ? Infinity : a.year, by = b.year == null ? Infinity : b.year;
        if (ay !== by) return ay - by;
        const am = a.month == null ? 9999 : a.month, bm = b.month == null ? 9999 : b.month;
        if (am !== bm) return am - bm;
        const ad = a.day == null ? 9999 : a.day, bd = b.day == null ? 9999 : b.day;
        if (ad !== bd) return ad - bd;
        return a.idx - b.idx;
      });
      traces.push({ traceNumber: traceNumber, points: points });
    }
    traces.sort((a, b) => a.traceNumber - b.traceNumber);
    slotData.set(slotName, {
      unit: rec.unit, scale: rec.scale, timestepType: rec.timestepType,
      traces: traces, files: [...rec.files],
    });
  }

  const { roles, labels } = classifyTraces(traceNumbers);

  // overall period range
  let minDate = null, maxDate = null;
  for (const [, sd] of slotData) {
    for (const tr of sd.traces) {
      for (const p of tr.points) {
        if (p.periodDate) {
          if (minDate === null || p.periodDate < minDate) minDate = p.periodDate;
          if (maxDate === null || p.periodDate > maxDate) maxDate = p.periodDate;
        }
      }
    }
  }

  return {
    files: parsedFiles.map(f => f.name),
    slots: slotData,
    traceNumbers: [...traceNumbers].sort((a, b) => a - b),
    roles: roles,
    labels: labels,
    conflicts: conflicts,
    period: minDate ? { min: minDate, max: maxDate } : null,
    runDate: runDate,
  };
}

