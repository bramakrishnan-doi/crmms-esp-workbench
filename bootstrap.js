"use strict";
/* =========================================================================
 * Data loading: automatic fetch (web) or drag-and-drop (local)
 * ========================================================================= */

let model = null;
const loadedFiles = new Map(); // fileName -> parsedFile

function setStatus(html, cls) {
  const panel = document.getElementById("statusPanel");
  panel.innerHTML = html ? '<div class="status-card ' + (cls || "") + '">' + html + "</div>" : "";
}

function showDropZone(note) {
  const zone = document.getElementById("dropZone");
  if (note) document.getElementById("dropZoneNote").textContent = note;
  zone.style.display = "block";
}

function summarize(model_) {
  const ensemble = model_.traceNumbers.filter(t => model_.roles.get(t) === "ensemble").length;
  const det = model_.traceNumbers.length - ensemble;
  const parts = [];
  parts.push("<b>" + model_.files.length + "</b> file" + (model_.files.length > 1 ? "s" : "") + " loaded");
  parts.push("<b>" + model_.traceNumbers.length + "</b> traces (" + ensemble + " ensemble ESP " +
    (ensemble ? traceLabel(model_.traceNumbers.filter(t => model_.roles.get(t) === "ensemble")[0]) : "") +
    (ensemble ? "\u2013" + traceLabel(model_.traceNumbers.filter(t => model_.roles.get(t) === "ensemble").slice(-1)[0]) : "") +
    (det ? ", " + det + " deterministic" : "") + ")");
  parts.push("<b>" + model_.slots.size + "</b> slots");
  if (model_.period) parts.push(model_.period.min + " \u2192 " + model_.period.max);
  return parts.join(" &middot; ");
}

function updateFilesPopover() {
  const summary = document.getElementById("filesSummary");
  if (summary) {
    summary.textContent = "Files: " + loadedFiles.size;
  }
  const list = document.getElementById("loadedFilesList");
  if (!list) return;

  if (loadedFiles.size === 0) {
    list.innerHTML = '<div style="padding:10px 4px; color:var(--ink-faint); font-size:11.5px; text-align:center;">No RDF files loaded</div>';
  } else {
    list.innerHTML = "";
    for (const [name, file] of loadedFiles) {
      const traceSet = new Set();
      if (file.slots) {
        for (const sd of file.slots.values()) {
          if (sd.traces) for (const tn of sd.traces.keys()) traceSet.add(tn);
        }
      }
      const item = document.createElement("div");
      item.className = "file-item";

      const info = document.createElement("div");
      info.className = "file-item-info";

      const nameEl = document.createElement("div");
      nameEl.className = "file-item-name";
      nameEl.textContent = name;
      nameEl.title = name;

      const metaEl = document.createElement("div");
      metaEl.className = "file-item-meta";
      metaEl.textContent = file.slots.size + " slot" + (file.slots.size === 1 ? "" : "s") +
        " \u00b7 " + traceSet.size + " trace" + (traceSet.size === 1 ? "" : "s");

      info.appendChild(nameEl);
      info.appendChild(metaEl);
      item.appendChild(info);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "file-remove-btn";
      removeBtn.title = "Unload " + name;
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", e => {
        e.stopPropagation();
        removeLoadedFile(name);
      });
      item.appendChild(removeBtn);

      list.appendChild(item);
    }
  }

  const unloadAllBtn = document.getElementById("unloadAllFilesBtn");
  if (unloadAllBtn) {
    unloadAllBtn.disabled = loadedFiles.size === 0;
    unloadAllBtn.style.opacity = loadedFiles.size === 0 ? "0.5" : "1";
    unloadAllBtn.style.cursor = loadedFiles.size === 0 ? "default" : "pointer";
  }
}

function removeLoadedFile(fileName) {
  if (!loadedFiles.has(fileName)) return;
  loadedFiles.delete(fileName);
  if (loadedFiles.size === 0) {
    unloadAllData();
  } else {
    rebuildModel({ preserveView: true });
  }
}

function unloadAllData() {
  loadedFiles.clear();
  model = null;
  highlightedTrace = null;
  updateHighlightHint();
  if (typeof uiState !== "undefined") uiState.presets = {};
  try { sessionStorage.removeItem("crmmsPlotterUI.v1"); } catch (err) {}
  if (typeof tableBlockSession !== "undefined") tableBlockSession.clear();
  if (typeof removedPresetBlocks !== "undefined") removedPresetBlocks.clear();

  const badge = document.getElementById("runDateBadge");
  if (badge) badge.style.display = "none";

  const toolbar = document.getElementById("chartToolbar");
  if (toolbar) toolbar.style.display = "none";

  const presetBar = document.getElementById("presetBar");
  if (presetBar) { presetBar.innerHTML = ""; presetBar.style.display = "none"; }

  const tablePresetBar = document.getElementById("tablePresetBar");
  if (tablePresetBar) { tablePresetBar.innerHTML = ""; tablePresetBar.style.display = "none"; }

  const grid = document.getElementById("plotGrid");
  if (grid) grid.innerHTML = "";

  hideResCardsPanel();
  updateDataTableSectionVisibility();
  updateFilesPopover();

  setStatus("", "");
  showDropZone("All RDF data has been unloaded. Drop one or more .rdf files here or use the file picker to load data.");
}

function rebuildModel(options) {
  options = options || {};
  const preserveView = !!options.preserveView;
  if (loadedFiles.size === 0) {
    unloadAllData();
    return;
  }
  model = mergeFiles([...loadedFiles.values()]);
  highlightedTrace = null;
  updateHighlightHint();

  // data is in — retire the drop-zone card
  document.getElementById("dropZone").style.display = "none";
  const summaryHtml = summarize(model) +
    (model.conflicts.length ? '<br><span class="conflict-line"><b>' + model.conflicts.length + '</b> conflicting duplicate value' +
      (model.conflicts.length > 1 ? "s" : "") + ' ignored (first file kept): e.g. ' +
      model.conflicts.slice(0, 3).map(c => c.slot + " trace " + c.trace + " @ " + c.timestep +
        " [" + c.kept.file + "=" + c.kept.value + " vs " + c.dropped.file + "=" + c.dropped.value + "]").join("; ") +
      "</span>" : "");
  setStatus(summaryHtml, "summary");

  // reconcile any persisted trace visibility with the loaded data
  const tv = uiState.global.tracesVisible;
  if (tv != null) {
    const existing = new Set(model.traceNumbers);
    const filtered = tv.filter(t => existing.has(t));
    uiState.global.tracesVisible = filtered.length ? filtered : null;
  }
  // Default: only the ESP ensemble traces. Max/Min/Most are opt-in via the
  // Traces menu (the data table follows via its "Only visible traces" filter).
  if (uiState.global.tracesVisible == null) {
    const ens = model.traceNumbers.filter(t => model.roles.get(t) === "ensemble");
    uiState.global.tracesVisible = ens.length ? ens : [...model.traceNumbers];
  }
  saveUiState();
  setupToolbar();
  updateFilesPopover();

  // model-run badge in the title area (from the RDF's create_date metadata)
  const badge = document.getElementById("runDateBadge");
  if (badge) {
    if (model.runDate) {
      badge.textContent = "Model run: " + model.runDate.label;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }

  renderPresetBar();
  renderTablePresetBar();

  if (preserveView && (currentPreset || (typeof viewMode !== "undefined" && (viewMode === "tables" || viewMode === "reservoirs" || viewMode === "reservoirCharts")))) {
    if (viewMode === "tables" && typeof currentTablePresetIndex === "number" && TABLE_PRESETS[currentTablePresetIndex]) {
      renderTablePreset(TABLE_PRESETS[currentTablePresetIndex]);
    } else if (viewMode === "reservoirs" && typeof resCurrentPage !== "undefined" && resCurrentPage) {
      renderReservoirTables(resCurrentPage);
    } else if (viewMode === "reservoirCharts" && typeof resCurrentPage !== "undefined" && resCurrentPage) {
      renderReservoirChartsContent(resCurrentPage);
    } else if (currentPreset) {
      renderPreset(currentPreset);
    }
    updateDataTableSectionVisibility();
    renderDataTable();
  } else {
    let idx = PRESETS.findIndex(p => p.id === DEFAULT_PRESET);
    if (idx < 0) idx = 0;
    selectPreset(idx);
  }

  if (new URLSearchParams(location.search).has("debug")) {
    window.__RDF_DEBUG__ = debugDump();
    window.__RDF_MODEL__ = {
      labels: model.labels, roles: model.roles,
      conflicts: model.conflicts, traceNumbers: model.traceNumbers,
    };
    window.__RDF_SET_HIGHLIGHT__ = function (tn) {
      highlightedTrace = (highlightedTrace === tn) ? null : tn;
      refreshHighlight();
    };
  }
}

function loadData(parsedFiles, options) {
  options = options || {};
  if (options.replace) {
    loadedFiles.clear();
  }
  for (const f of parsedFiles) {
    if (f && f.name) loadedFiles.set(f.name, f);
  }
  rebuildModel(options);
}

function debugDump() {
  const out = { files: model.files, slots: {} };
  for (const [slotName, sd] of model.slots) {
    const traces = {};
    for (const tr of sd.traces) {
      traces[String(tr.traceNumber)] = tr.points.map(p => [
        p.idx, p.periodDate, p.year, p.month, p.day, p.value,
      ]);
    }
    out.slots[slotName] = {
      unit: sd.unit || null,
      timestep_type: sd.timestepType || null,
      traces: traces,
    };
  }
  return out;
}

async function boot() {
  const files = (RDF_FILES || []).filter(s => String(s).trim());
  if (!files.length) {
    showDropZone("No RDF files are configured in this page (edit the RDF_FILES list in the HTML source), so load them here.");
    return;
  }
  setStatus("Loading " + files.length + " RDF file" + (files.length > 1 ? "s" : "") + "\u2026", "loading");
  const parsed = [];
  const failures = [];
  for (const path of files) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      parsed.push(parseRdf(text, path.split("/").pop()));
    } catch (err) {
      failures.push(path + " \u2014 " + (err && err.message ? err.message : err));
    }
  }
  // If at least one file loaded successfully, proceed with the available files
  if (parsed.length > 0) {
    try {
      loadData(parsed, { replace: true, preserveView: false });
      if (failures.length) {
        setStatus(
          "Loaded <b>" + parsed.length + "</b> file" + (parsed.length > 1 ? "s" : "") +
          ", but could not fetch: " + failures.map(f => "<code>" + f + "</code>").join(", "),
          "warning"
        );
      }
    } catch (err) {
      setStatus("Failed to process RDF data: " + (err && err.message ? err.message : err), "error");
    }
    return;
  }

  // Only show drop zone / error if all files failed
  if (failures.length) {
    const onDisk = location.protocol === "file:";
    setStatus(
      "Could not load: " + failures.map(f => "<code>" + f + "</code>").join(", ") +
      (onDisk
        ? "<br><span class='warn-line'>This page was opened from disk (file://), where browsers block automatic file reading. Drop the .rdf files below instead.</span>"
        : "<br><span class='warn-line'>Check the paths in the RDF_FILES configuration at the top of this HTML file.</span>"),
      "error"
    );
    showDropZone(onDisk
      ? "Browsers block automatic file reading from disk — drop your .rdf files here (they are processed locally, nothing is uploaded)."
      : "The configured RDF files could not be fetched — you can still drop .rdf files here.");
    return;
  }
}

/* ---- drag & drop / picker ---- */

function handleFiles(fileList) {
  const files = [...fileList].filter(f => /\.rdf$/i.test(f.name));
  if (!files.length) {
    setStatus("No .rdf files were dropped — expected one or more files ending in .rdf.", "error");
    return;
  }
  setStatus("Reading " + files.length + " dropped file" + (files.length > 1 ? "s" : "") + "\u2026", "loading");
  Promise.all(files.map(f => f.text().then(text => parseRdf(text, f.name))))
    .then(parsed => loadData(parsed, { replace: false, preserveView: loadedFiles.size > 0 }))
    .catch(err => setStatus("Failed to parse: " + (err && err.message ? err.message : err), "error"));
}

function setupDropZone() {
  const zone = document.getElementById("dropZone");
  const input = document.getElementById("fileInput");
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { handleFiles(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove("dragover");
  }));
  zone.addEventListener("drop", e => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // Global window drop allows dragging additional RDF files onto the page even after dropZone is hidden
  window.addEventListener("dragover", e => { e.preventDefault(); });
  window.addEventListener("drop", e => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      const hasRdf = [...e.dataTransfer.files].some(f => /\.rdf$/i.test(f.name));
      if (hasRdf) {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }
    }
  });
}

loadUiState();
setupDropZone();
boot();
