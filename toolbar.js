"use strict";
/* ---- toolbar (trace visibility, layout, add plot, reset) ---- */

function syncToolbar() {
  if (!currentPreset || !model) return;
  const ui = presetUi(currentPreset);
  document.getElementById("gridColumns").value =
    String(ui.columns || (currentPreset.layout && currentPreset.layout.columns) || "2");
  document.getElementById("plotHeight").value =
    String(Math.min(700, Math.max(250, Number(ui.height || (currentPreset.layout && currentPreset.layout.plot_height)) || 400)));
  const vfilter = visibleTraceFilter();
  const shown = vfilter ? model.traceNumbers.filter(t => vfilter.has(t)).length : model.traceNumbers.length;
  document.getElementById("traceSummary").textContent =
    "Traces: " + shown + " / " + model.traceNumbers.length;
  const modified = Object.keys(ui.overrides || {}).length ||
    (ui.removed || []).length || (ui.added || []).length;
  document.getElementById("resetPresetBtn").textContent = modified ? "Reset preset (modified)" : "Reset preset";
}

function refreshTraceControls() {
  const container = document.getElementById("traceCheckboxes");
  container.innerHTML = "";
  const vfilter = visibleTraceFilter();
  for (const t of model.traceNumbers) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = String(t);
    cb.checked = !vfilter || vfilter.has(t);
    label.appendChild(cb);
    const role = model.roles.get(t) === "deterministic" ? " \u00b7 det" : "";
    label.appendChild(document.createTextNode((model.labels.get(t) || traceLabel(t)) + " (" + t + ")" + role));
    container.appendChild(label);
  }
}

function setupToolbar() {
  const toolbar = document.getElementById("chartToolbar");
  toolbar.style.display = "flex";
  refreshTraceControls();

  // populate the add-plot slot dropdown
  const addSlot = document.getElementById("addSlot");
  addSlot.innerHTML = "";
  for (const name of model.slots.keys()) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    addSlot.appendChild(o);
  }

  // populate the data-table slot dropdown
  const dtSlot = document.getElementById("dtSlot");
  dtSlot.innerHTML = "";
  for (const name of model.slots.keys()) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    dtSlot.appendChild(o);
  }
  dtSlot.value = defaultDataTableSlot();
  document.getElementById("dtOnlyVisible").checked = true;  // Max/Min/Most stay out of the table by default
  updateDataTableSectionVisibility();
  renderDataTable();

  if (toolbarWired) return;
  toolbarWired = true;

  document.getElementById("traceCheckboxes").addEventListener("change", () => {
    const checked = [...document.querySelectorAll("#traceCheckboxes input:checked")]
      .map(cb => parseInt(cb.value, 10));
    uiState.global.tracesVisible = checked;
    saveUiState();
    renderPreset(currentPreset);
    renderDataTable();
  });
  document.querySelectorAll("#traceControl [data-trace-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.traceAction;
      if (action === "all") uiState.global.tracesVisible = [...model.traceNumbers];
      else if (action === "none") uiState.global.tracesVisible = [];
      else uiState.global.tracesVisible = model.traceNumbers.filter(t => model.roles.get(t) === "ensemble");
      saveUiState();
      refreshTraceControls();
      renderPreset(currentPreset);
      renderDataTable();
    });
  });
  document.getElementById("gridColumns").addEventListener("change", e => {
    const ui = presetUi(currentPreset);
    ui.columns = e.target.value;
    saveUiState();
    renderPreset(currentPreset);
  });
  document.getElementById("plotHeight").addEventListener("change", e => {
    const ui = presetUi(currentPreset);
    const h = Math.min(700, Math.max(250, Number(e.target.value) || 400));
    ui.height = h;
    e.target.value = String(h);
    saveUiState();
    renderPreset(currentPreset);
  });
  document.getElementById("addPlotBtn").addEventListener("click", () => {
    if (!currentPreset) return;
    const slot = document.getElementById("addSlot").value;
    const type = document.getElementById("addType").value;
    if (!slot) return;
    const ui = presetUi(currentPreset);
    if (!ui.added) ui.added = [];
    const slotNames = [...model.slots.keys()];
    const item = {
      __id: (currentPreset.id || currentPreset.name || "preset") + ":c" + Date.now(),
      slot: slot,
      plot_type: type,
      transform: "raw",
      title: "",
      subtitle: "",
    };
    if (type === "scatter") item.y_slot = slotNames.find(s => s !== slot) || slot;
    ui.added.push(item);
    saveUiState();
    renderPreset(currentPreset);
    const cards = document.querySelectorAll(".plot-card");
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.getElementById("resetPresetBtn").addEventListener("click", () => {
    if (!currentPreset) return;
    delete uiState.presets[currentPreset.id || currentPreset.name || "preset"];
    const chartsPage = RESERVOIR_PAGES.find(pg => pg.kind === "charts" && currentPreset === getResChartsPreset(pg));
    if (chartsPage) {
      // reset = show every chart on this page; keep the checkboxes in sync
      for (const p of currentPreset.plots) resCheckedSet(chartsPage).add(p.slot);
      syncResChartsRemoved(chartsPage);
      renderResCardsPanel(chartsPage);
    }
    saveUiState();
    renderPreset(currentPreset);
  });
  document.getElementById("dtSlot").addEventListener("change", renderDataTable);
  document.getElementById("dtOnlyVisible").addEventListener("change", renderDataTable);
  document.getElementById("dtTables").addEventListener("click", e => {
    const cell = e.target.closest("[data-trace]");
    if (!cell) return;
    const tn = parseInt(cell.dataset.trace, 10);
    highlightedTrace = highlightedTrace === tn ? null : tn;
    refreshHighlight();
  });
  document.getElementById("buildReportBtn").addEventListener("click", () => { buildReport(); });
  document.getElementById("highlightInfo").addEventListener("click", clearHighlight);
  document.getElementById("addFilesBtn").addEventListener("click", () => document.getElementById("fileInput").click());
  const popAdd = document.getElementById("popAddFilesBtn");
  if (popAdd) popAdd.addEventListener("click", () => document.getElementById("fileInput").click());
  const unloadAll = document.getElementById("unloadAllFilesBtn");
  if (unloadAll) unloadAll.addEventListener("click", () => {
    if (confirm("Unload all loaded RDF files?")) unloadAllData();
  });
  document.addEventListener("click", e => {
    ["traceControl", "addPlotControl", "filesControl"].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.open && !el.contains(e.target)) el.open = false;
    });
  });
  document.getElementById("reportCloseBtn").addEventListener("click", closeReport);
  document.getElementById("reportPrintBtn").addEventListener("click", () => window.print());
  document.getElementById("reportTableToggle").addEventListener("change", e => {
    const wrap = document.querySelector("#reportPage .report-table-wrap");
    if (wrap) wrap.style.display = e.target.checked ? "" : "none";
  });
  // chunk splitting keeps each printed table page readable
  document.getElementById("reportPage").addEventListener("input", e => {
    if (e.target.isContentEditable) saveReportDraft();
  });
}

function defaultDataTableSlot() {
  if (currentPreset && currentPreset.plots && currentPreset.plots.length) {
    const first = currentPreset.plots[0];
    if (first && first.slot && model.slots.has(first.slot)) return first.slot;
  }
  return [...model.slots.keys()][0] || "";
}

