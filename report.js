"use strict";
/* ---- printable report (serverless counterpart of the App's Report Builder:
 * chart PNGs + editable notes/assumptions + data table, print to PDF) ---- */

const REPORT_DRAFT_KEY = "crmmsPlotterUI.report";

function loadReportDraft() {
  try { return JSON.parse(localStorage.getItem(REPORT_DRAFT_KEY) || "{}"); } catch (err) { return {}; }
}

function saveReportDraft() {
  const page = document.getElementById("reportPage");
  if (!page) return;
  const title = page.querySelector("#reportTitle");
  const notes = page.querySelector("#reportNotes");
  const assumptions = page.querySelector("#reportAssumptions");
  const draft = {
    title: title ? title.textContent : "",
    notes: notes ? notes.innerHTML : "",
    assumptions: assumptions ? assumptions.innerHTML : "",
  };
  try { localStorage.setItem(REPORT_DRAFT_KEY, JSON.stringify(draft)); } catch (err) { /* ignore */ }
}

function closeReport() {
  document.body.classList.remove("report-mode");
}

function reportHeading(item) {
  if (item.title) return item.title;
  if (item.plot_type === "scatter") return item.slot + " vs " + (item.y_slot || "Y slot");
  if (item.plot_type === "stacked_bar") {
    return [...new Set([item.slot, ...item.plot_slots].filter(Boolean))].join(" + ") + " \u00b7 Stacked bar";
  }
  return item.slot;
}

async function buildReport() {
  if (!model) return;
  const cards = [...document.querySelectorAll(".plot-card")].filter(
    c => c._item && c.querySelector(".plot-area") && c.querySelector(".plot-area").data
  );
  const page = document.getElementById("reportPage");
  const draft = loadReportDraft();
  page.innerHTML = "";

  const title = document.createElement("h1");
  title.id = "reportTitle";
  title.contentEditable = "true";
  title.textContent = draft.title || (PAGE_TITLE ? PAGE_TITLE + " \u2014 Report" : "CRMMS ESP Report");
  page.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "report-meta";
  const metaParts = [
    "Generated " + new Date().toLocaleString(),
    model.runDate ? "Model run: " + model.runDate.label : null,
    model.files.length + " RDF file" + (model.files.length > 1 ? "s" : "") + ": " + model.files.join(", "),
    model.traceNumbers.length + " traces \u00b7 " + model.slots.size + " slots",
    model.period ? model.period.min + " \u2192 " + model.period.max : "",
  ];
  meta.textContent = metaParts.filter(Boolean).join(" \u00b7 ");
  page.appendChild(meta);

  page.appendChild(Object.assign(document.createElement("h2"), { textContent: "Notes" }));
  const notes = document.createElement("p");
  notes.id = "reportNotes";
  notes.contentEditable = "true";
  notes.dataset.ph = "Click to add notes\u2026";
  notes.innerHTML = draft.notes || "";
  page.appendChild(notes);

  page.appendChild(Object.assign(document.createElement("h2"), { textContent: "Assumptions" }));
  const assumptions = document.createElement("p");
  assumptions.id = "reportAssumptions";
  assumptions.contentEditable = "true";
  assumptions.dataset.ph = "Click to add assumptions\u2026";
  assumptions.innerHTML = draft.assumptions || "";
  page.appendChild(assumptions);

  page.appendChild(Object.assign(document.createElement("h2"), { textContent: "Charts" }));
  for (const card of cards) {
    const item = card._item;
    const div = card.querySelector(".plot-area");
    const rect = div.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;

    const h3 = document.createElement("h3");
    h3.textContent = reportHeading(item);
    page.appendChild(h3);
    const renderedSub = div.layout && div.layout.annotations && div.layout.annotations[0]
      ? div.layout.annotations[0].text : "";
    const sub = document.createElement("div");
    sub.className = "report-sub";
    sub.textContent = item.subtitle || renderedSub || "";
    page.appendChild(sub);

    const png = await Plotly.toImage(div, {
      format: "png",
      width: Math.max(320, Math.round(rect.width)),
      height: Math.max(220, Math.round(rect.height)),
      scale: 2,
    });
    const img = document.createElement("img");
    img.className = "report-chart";
    img.src = png;
    page.appendChild(img);
  }

  const table = document.querySelector("#dtTables .data-table");
  if (table && table.querySelector("thead")) {
    const wrap = document.createElement("div");
    wrap.className = "report-table-wrap";
    page.appendChild(wrap);
    wrap.appendChild(Object.assign(document.createElement("h2"), {
      textContent: "Data table \u2014 " + document.getElementById("dtSlot").value +
        " (columns split across pages for readability)",
    }));
    // Split the trace columns into portrait-width chunks so the printed table
    // keeps a readable size instead of shrinking to fit 30+ columns.
    const PER_CHUNK = 11;
    const headCells = [...table.querySelectorAll("thead th")];
    const periodHead = headCells[0].cloneNode(true);
    const traceHeads = headCells.slice(1);
    const bodyRows = [...table.querySelectorAll("tbody tr")];
    for (let start = 0; start < traceHeads.length; start += PER_CHUNK) {
      const chunk = document.createElement("div");
      chunk.className = "report-table-chunk";
      const t = document.createElement("table");
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.appendChild(periodHead.cloneNode(true));
      for (const th of traceHeads.slice(start, start + PER_CHUNK)) hr.appendChild(th.cloneNode(true));
      thead.appendChild(hr);
      t.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const row of bodyRows) {
        const cells = [...row.querySelectorAll("td")];
        const tr = document.createElement("tr");
        tr.appendChild(cells[0].cloneNode(true));
        for (const td of cells.slice(start + 1, start + 1 + PER_CHUNK)) tr.appendChild(td.cloneNode(true));
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      chunk.appendChild(t);
      wrap.appendChild(chunk);
    }
  }

  document.body.classList.add("report-mode");
  document.getElementById("reportOverlay").scrollTop = 0;
}

