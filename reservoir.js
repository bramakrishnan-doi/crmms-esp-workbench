"use strict";
/* ---- Reservoir Data view: one card per reservoir, tables per slot ---- */

/* ---- Reservoir card pages engine (driven by the RESERVOIR_PAGES config).
 * "data" pages render slot tables below the cards; "charts" pages render
 * slot charts. Checked slots, expanded card and chart settings are stored
 * per page id, so every page is independent. ---- */

function reservoirSlots(page, name) {
  const prefixes = [name, String(name).replace(/\s+/g, "")].filter((v, i, a) => a.indexOf(v) === i);
  const found = [];
  for (const sfx of page.slots) {
    for (const p of prefixes) {
      const slotName = p + "." + sfx;
      if (model && model.slots.has(slotName)) { found.push({ sfx: sfx, slotName: slotName }); break; }
    }
  }
  return found;
}

let _resCardsPanel = null;
const resPageChecked = new Map();   // pageId -> Set(slotName) with visible tables/charts
const resExpandedNames = new Map(); // pageId -> reservoir name whose picker is open
const resChartsPresets = new Map(); // pageId -> synthetic preset for "charts" pages
let resCurrentPage = null;          // page being viewed

function resCheckedSet(page) {
  if (!resPageChecked.has(page.id)) resPageChecked.set(page.id, new Set());
  return resPageChecked.get(page.id);
}

/* A synthetic preset covering every available slot of a charts page.
 * Visibility is driven by presetItems()' removed-list (synced from the
 * checked set), so each slot keeps a stable id and its chart settings
 * survive check/uncheck. */
function getResChartsPreset(page) {
  if (!resChartsPresets.has(page.id)) {
    const plots = [];
    for (const name of page.reservoirs) {
      for (const s of reservoirSlots(page, name)) {
        plots.push({ slot: s.slotName, plot_type: "line", transform: "raw" });
      }
    }
    resChartsPresets.set(page.id, {
      id: page.id,
      name: page.name,
      description: "",
      layout: { columns: 2, plot_height: 400 },
      plots: plots,
    });
  }
  return resChartsPresets.get(page.id);
}

function syncResChartsRemoved(page) {
  const preset = getResChartsPreset(page);
  const ui = presetUi(preset);
  const checked = resCheckedSet(page);
  ui.removed = preset.plots
    .map((p, i) => ({ id: page.id + ":p" + i, slot: p.slot }))
    .filter(x => !checked.has(x.slot))
    .map(x => x.id);
}

function resCardsPanel() {
  if (_resCardsPanel) return _resCardsPanel;
  const grid = document.getElementById("plotGrid");
  const panel = document.createElement("div");
  panel.id = "resCardsPanel";
  panel.style.display = "none";
  grid.parentNode.insertBefore(panel, grid);
  _resCardsPanel = panel;
  return panel;
}

function hideResCardsPanel() {
  const p = document.getElementById("resCardsPanel");
  if (p) p.style.display = "none";
}

function renderResCardsPanel(page) {
  const panel = resCardsPanel();
  panel.innerHTML = "";
  panel.style.display = "block";
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.style.cssText = "margin-bottom:12px;";
  hint.textContent = page.kind === "data"
    ? "Click a reservoir to pick its slots; tick slots to show their tables below."
    : "Click a reservoir to pick its slots; tick slots to show their charts below.";
  panel.appendChild(hint);
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:16px;";
  panel.appendChild(grid);
  const expandedName = resExpandedNames.get(page.id) || null;
  const checked = resCheckedSet(page);
  for (const name of page.reservoirs) {
    const slots = reservoirSlots(page, name);
    if (!slots.length) continue;
    const expanded = expandedName === name;
    const card = document.createElement("div");
    card.className = "res-card" + (expanded ? " res-card-open" : "");
    const nameEl = document.createElement("div");
    nameEl.className = "res-card-name";
    const chevron = document.createElement("span");
    chevron.className = "res-chevron";
    chevron.textContent = expanded ? "\u25be " : "\u25b8 ";
    nameEl.appendChild(chevron);
    nameEl.appendChild(document.createTextNode(name));
    const count = document.createElement("span");
    count.className = "res-card-count";
    count.textContent = slots.length + " slots";
    nameEl.appendChild(count);
    nameEl.title = expanded ? "Click to collapse" : "Click to pick slots";
    nameEl.addEventListener("click", () => {
      resExpandedNames.set(page.id, expanded ? null : name);  // one card open at a time
      renderResCardsPanel(page);
    });
    card.appendChild(nameEl);
    if (expanded) {
      const allRow = document.createElement("div");
      allRow.className = "res-check";
      const allLink = document.createElement("a");
      allLink.href = "#";
      allLink.textContent = resAllChecked(page, name) ? "hide all" : "show all";
      allLink.addEventListener("click", ev => {
        ev.preventDefault();
        toggleReservoirAll(page, name);
      });
      allRow.appendChild(allLink);
      card.appendChild(allRow);
      for (const s of slots) {
        const label = document.createElement("label");
        label.className = "res-check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = checked.has(s.slotName);
        cb.addEventListener("change", () => onResCheck(page, s.slotName, cb.checked));
        label.appendChild(cb);
        label.appendChild(document.createTextNode(s.sfx));
        card.appendChild(label);
      }
    }
    grid.appendChild(card);
  }
}

function resAllChecked(page, name) {
  const slots = reservoirSlots(page, name);
  const checked = resCheckedSet(page);
  return slots.length > 0 && slots.every(s => checked.has(s.slotName));
}

function toggleReservoirAll(page, name) {
  const makeChecked = !resAllChecked(page, name);
  const checked = resCheckedSet(page);
  for (const s of reservoirSlots(page, name)) {
    if (makeChecked) checked.add(s.slotName); else checked.delete(s.slotName);
  }
  if (page.kind === "charts") { syncResChartsRemoved(page); saveUiState(); }
  renderResCardsPanel(page);
  if (page.kind === "data") renderReservoirTables(page); else renderReservoirChartsContent(page);
}

function onResCheck(page, slotName, checked_) {
  const checked = resCheckedSet(page);
  if (checked_) checked.add(slotName); else checked.delete(slotName);
  if (page.kind === "charts") { syncResChartsRemoved(page); saveUiState(); }
  if (page.kind === "data") renderReservoirTables(page); else renderReservoirChartsContent(page);
}

function selectReservoirPage(page) {
  resCurrentPage = page;
  if (page.kind === "data") {
    currentPreset = null;
    viewMode = "reservoirs";
  } else {
    currentPreset = getResChartsPreset(page);
    viewMode = "reservoirCharts";
  }
  document.querySelectorAll("#presetBar button").forEach(b => {
    b.classList.toggle("active", page.kind === "charts" && b.dataset.resPage === page.id);
  });
  document.querySelectorAll("#tablePresetBar button").forEach(b => {
    b.classList.toggle("active", page.kind === "data" && b.dataset.resPage === page.id);
  });
  updateDataTableSectionVisibility();
  renderResCardsPanel(page);
  if (page.kind === "data") renderReservoirTables(page); else renderReservoirChartsContent(page);
}

function renderReservoirTables(page) {
  const grid = document.getElementById("plotGrid");
  clearCellSelection();
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = "minmax(0, 1fr)";
  const checked = resCheckedSet(page);
  const blocks = [];
  for (const name of page.reservoirs) {
    for (const s of reservoirSlots(page, name)) {
      if (checked.has(s.slotName)) blocks.push(s);
    }
  }
  if (!blocks.length) {
    grid.innerHTML = '<div class="empty-note">Tick slots on the cards above to show their tables.</div>';
    return;
  }
  for (const s of blocks) {
    const section = document.createElement("section");
    section.className = "table-block";
    grid.appendChild(section);
    const key = "reservoir:" + s.slotName;
    section._blockKey = key;
    section._isSession = false;
    const stored = tableBlockSession.get(key);
    const block = stored ? stored : newTableBlock(s.slotName);
    if (!block.title) block.title = s.sfx;
    section._block = normalizeTableBlock(block);
    tableBlockSession.set(key, section._block);
    renderTableBlock(section, section._block);
  }
}

function renderReservoirChartsContent(page) {
  const grid = document.getElementById("plotGrid");
  if (!resCheckedSet(page).size) {
    grid.innerHTML = '<div class="empty-note">Tick slots on the cards above to show their charts.</div>';
    return;
  }
  syncResChartsRemoved(page);
  renderPreset(getResChartsPreset(page));
}

