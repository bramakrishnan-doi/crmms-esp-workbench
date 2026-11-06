const DEFAULT_EXPLORER_PRELOAD = {
  // Keep discovery lightweight. Only the two most commonly inspected
  // elevation slots are preloaded. All other slots lazy-load when selected
  // in the Object.Slot dropdown and are then cached for the session.
  patterns: ['Powell.Pool Elevation','Mead.Pool Elevation'],
  all_slots_files: []
};
const state = {
  currentFiles: [], previousFiles: [], result: null, reportPlots: {},
  workspaceMode: null,
  rdfInspection: { current: null, previous: null },
  rdfSessionId: null,
  rdfPreloaded: {current:new Set(), previous:new Set()},
  discoveredSlots: [],
  explorerSlotCache: new Map(),
  explorerPreload: JSON.parse(JSON.stringify(DEFAULT_EXPLORER_PRELOAD)),
  customRdfSlots: [],
  customRdfPlots: [],
  customSlotOpenTimestep: 'monthly',
  pendingReportSettings: null,
  explorerData: null,
  explorerVisibleTraces: [],
  explorerSelectedTraceColumns: new Set(),
  explorerSelectedRows: new Set(),
  explorerViewport: { x: null, y: null },
  explorerTableTraceFilter: null,
  explorerStackSlots: [],
  explorerStackOrder: [],
  explorerStackPlotTypes: {},
  // v4.4+ stack items are independent plot instances. Duplicate slots are allowed.
  explorerStackItems: [],
  explorerStackItemSeq: 0,
  explorerStackData: new Map(),
  pendingPortableExplorerProfile: null,
  explorerSyncingViewport: false,
  traceLabels: {},
  explorerSettings: {
    transform:'raw', plot_type:'line', wy_start_month:10, run_a_color:'#167c80', run_b_color:'#d07a28', dim_color:'#9aa5aa', annual_year:'', bar_sort:'none',
    alpha:0.28, title:'', subtitle:'', highlight_trace:'', box_line_overlay:true,
    x_axis_title:'', y_axis_title:'', line_width:1.0, plot_height:400, table_decimals:2, show_grid:true, overlay_alpha:0.28,
    y_axis_mode:'auto', y_min:'', y_max:'', percentile_band:false, percentile_low:10, percentile_high:90,
    unit_factor:1, unit_offset:0, display_unit:'', reference_lines:'', conditional_rules:'', stack_slots:[], stack_order:[], stack_plot_types:{}, stack_items:[]
  }
 };

window.addEventListener('error', event => {
  console.error('CRMMS JavaScript error:', event.error || event.message);
  const message=event?.error?.message || event?.message || 'Unknown JavaScript error';
  if(typeof showError==='function') showError(`JavaScript error: ${message}`);
});
window.addEventListener('unhandledrejection', event => {
  console.error('CRMMS unhandled promise rejection:', event.reason);
  const message=event?.reason?.message || String(event.reason || 'Unknown promise rejection');
  if(typeof showError==='function') showError(`JavaScript error: ${message}`);
});

const form = document.getElementById('compareForm');
const compareButton = document.getElementById('compareButton');
const fileCount = document.getElementById('fileCount');
const formError = document.getElementById('formError');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingTitle = document.getElementById('loadingTitle');
const loadingText = document.getElementById('loadingText');
const uploadSection = document.getElementById('uploadSection');
const resultsSection = document.getElementById('resultsSection');
const sourceFormat = document.getElementById('sourceFormat');
const rdfSettingsPanel = document.getElementById('rdfSettingsPanel');
const rdfSlotMapping = document.getElementById('rdfSlotMapping');
const rdfSlotOptions = document.getElementById('rdfSlotOptions');
const rdfDiscoveryStatus = document.getElementById('rdfDiscoveryStatus');
const rdfSelectionSummary = document.getElementById('rdfSelectionSummary');
const rdfProfileStatus = document.getElementById('rdfProfileStatus');
const rdfStandardInputSummary = document.getElementById('rdfStandardInputSummary');
const rdfCustomSlotSummary = document.getElementById('rdfCustomSlotSummary');
const rdfAvailableSlots = document.getElementById('rdfAvailableSlots');
const rdfSlotSearch = document.getElementById('rdfSlotSearch');
const rdfSlotPresenceFilter = document.getElementById('rdfSlotPresenceFilter');
const rdfCustomStatistic = document.getElementById('rdfCustomStatistic');
const rdfPlotConfigList = document.getElementById('rdfPlotConfigList');
const rdfPlotSummary = document.getElementById('rdfPlotSummary');
const dataExplorerSection = document.getElementById('dataExplorerSection');
const explorerSlot = document.getElementById('explorerSlot');
const explorerPlotType = document.getElementById('explorerPlotType');
const explorerTransform = document.getElementById('explorerTransform');
const explorerWyStartMonth = document.getElementById('explorerWyStartMonth');
const explorerHighlight = document.getElementById('explorerHighlight');
const explorerRunAColor = document.getElementById('explorerRunAColor');
const explorerRunBColor = document.getElementById('explorerRunBColor');
const explorerAlpha = document.getElementById('explorerAlpha');
const explorerAlphaValue = document.getElementById('explorerAlphaValue');
const explorerTraceList = document.getElementById('explorerTraceList');
const explorerSlotSearch = document.getElementById('explorerSlotSearch');
const explorerCacheStatus = document.getElementById('explorerCacheStatus');
const explorerBoxLineOverlay = document.getElementById('explorerBoxLineOverlay');
const explorerXAxisTitle = document.getElementById('explorerXAxisTitle');
const explorerYAxisTitle = document.getElementById('explorerYAxisTitle');
const explorerLineWidth = document.getElementById('explorerLineWidth');
const explorerLineWidthValue = document.getElementById('explorerLineWidthValue');
const explorerPlotHeight = document.getElementById('explorerPlotHeight');
const explorerPlotHeightValue = document.getElementById('explorerPlotHeightValue');
const explorerTableDecimals = document.getElementById('explorerTableDecimals');
const explorerShowGrid = document.getElementById('explorerShowGrid');
const explorerOverlayAlpha = document.getElementById('explorerOverlayAlpha');
const explorerOverlayAlphaValue = document.getElementById('explorerOverlayAlphaValue');
const explorerYAxisMode = document.getElementById('explorerYAxisMode');
const explorerYMin = document.getElementById('explorerYMin');
const explorerYMax = document.getElementById('explorerYMax');
const explorerPercentileBand = document.getElementById('explorerPercentileBand');
const explorerPercentileLow = document.getElementById('explorerPercentileLow');
const explorerPercentileHigh = document.getElementById('explorerPercentileHigh');
const explorerUnitFactor = document.getElementById('explorerUnitFactor');
const explorerUnitOffset = document.getElementById('explorerUnitOffset');
const explorerDisplayUnit = document.getElementById('explorerDisplayUnit');
const explorerReferenceLines = document.getElementById('explorerReferenceLines');
const explorerConditionalRules = document.getElementById('explorerConditionalRules');
const explorerStackSlots = document.getElementById('explorerStackSlots');
const explorerStackSummary = document.getElementById('explorerStackSummary');
const explorerRunBColorLabel = document.getElementById('explorerRunBColorLabel');
const EXPLORER_PROFILES_KEY = 'crmms-explorer-named-profiles-v1';
const loadExplorerSlotButton = document.getElementById('loadExplorerSlotButton');
const modeChooser = document.getElementById('modeChooser');
const explorerPreloadPatterns = document.getElementById('explorerPreloadPatterns');
const explorerPreloadFiles = document.getElementById('explorerPreloadFiles');
const traceLabelEditor = document.getElementById('traceLabelEditor');
const traceLabelSummary = document.getElementById('traceLabelSummary');
// Keep the existing browser-local profile key so approved v3.8 mappings and
// selections survive the Explorer upgrade; new cache/plot fields are optional.
const RDF_PROFILE_KEY = 'crmms-rdf-input-profile-v5';

const rdfLogicalInputs = [
  ['Powell', 'Powell.Pool Elevation'],
  ['Powell', 'PowellData.ReleaseTier'],
  ['Powell', 'UpperBalancingAt823'],
  ['Powell', 'PowellTargetAnnualReleaseVolume'],
  ['Powell', 'PowellConstrained3500Bypass'],
  ['Powell', 'PowellConstrained3500Less748'],
  ['Powell', 'Powell3525Annual'],
  ['Powell', 'Powell3490Annual'],
  ['Powell', 'PowellAJUnregInflow'],
  ['Mead', 'Mead.Pool Elevation'],
  ['Mead', 'DCPBWSP_Type'],
  ['Mead', 'AnnualShortageAnyTypeFlag'],
  ['Mead', 'MeadData.MeadBelow1035_Annual'],
  ['Mead', 'MeadData.MeadBelow1000_Annual'],
  ['Mead', 'MeadData.MeadBelow950_Annual'],
  ['Mead', 'MeadData.MeadBelow895_Annual'],
  ['Mead', 'Mead.Inflow'],
  ['Mead', 'Mead.Outflow'],
  ['Mead', 'Shortage.Shortage Flag'],
  ['Mead', 'Surplus.AnnualSurplusFlag']
];

const rdfDefaultEnabledInputs = [
  'Powell.Pool Elevation',
  'Mead.Pool Elevation'
];

// Fallback grouping before RDF discovery. After discovery the mapped slot's
// native timestep metadata wins, so a caller can remap an input without being
// locked to these defaults.
const rdfFallbackMonthlyInputs = new Set([
  'Powell.Pool Elevation',
  'Mead.Pool Elevation',
  'Mead.Inflow',
  'Mead.Outflow'
]);

const palette = {
  Eq: '#0072B2', UEBT: '#33CC33', MERT: '#E69F00', LEBT: '#CC6666', Unavailable: '#999999',
  'Surplus': '#ddd6ac', 'Normal': '#0072B2', 'Shortage - Level 1': '#33CC33',
  'Shortage - Level 2': '#E69F00', 'Shortage - Level 3': '#CC6666'
};

const analysisFieldIds = [
  'sourceFormat','traceNumbers','currentLabel','previousLabel','eocyYear','eocyMonth','powellYear','comparisonYears',
  'releaseYears','meadJan1Years','powellPlotYears','meadPlotYears','lowerBasinYears'
];

function fmtNumber(value, digits = 0) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function signed(value) {
  const num = Number(value);
  return `${num > 0 ? '+' : ''}${fmtNumber(num)}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function lines(value) {
  return String(value || '').split(/\r?\n/).map(x => x.replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean);
}
function icon(name) {
  const icons = {
    water: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z"/><path d="M9 15c.6 1.5 1.8 2.2 3.4 2.2"/></svg>',
    change: '<svg viewBox="0 0 24 24"><path d="M5 8h12M13 4l4 4-4 4M19 16H7M11 12l-4 4 4 4"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'
  };
  return icons[name] || icons.check;
}
function setLoading(title, text) {
  loadingTitle.textContent = title;
  loadingText.textContent = text;
  loadingOverlay.hidden = false;
}
function clearLoading() { loadingOverlay.hidden = true; }
function showError(message) { formError.textContent = message; formError.hidden = false; }
function hideError() { formError.hidden = true; formError.textContent = ''; }

function fileSummary(files) {
  if (!files.length) return '';
  const total = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;
  if (files.length === 1) return `${files[0].name} · ${total.toFixed(1)} MB`;
  return `${files.length} files · ${total.toFixed(1)} MB total`;
}
function canCompare() {
  if (state.workspaceMode === 'explore') return false;
  if (sourceFormat.value === 'rdf') return state.currentFiles.length > 0 && state.previousFiles.length > 0;
  return state.currentFiles.length === 1 && state.previousFiles.length === 1;
}
function updateFileUI(inputId) {
  const zone = document.querySelector(`[data-input="${inputId}"]`);
  const selected = zone.querySelector('.selected-file');
  const files = inputId === 'currentFile' ? state.currentFiles : state.previousFiles;
  zone.classList.toggle('has-file', files.length > 0);
  selected.textContent = fileSummary(files);
  fileCount.textContent = state.workspaceMode === 'explore' ? `${state.currentFiles.length} file${state.currentFiles.length===1?'':'s'} selected` : `${state.currentFiles.length} Run A · ${state.previousFiles.length} Run B`;
  compareButton.disabled = !canCompare();
}
function clearRdfInspection() {
  const preserved = currentRdfConfiguration();
  state.rdfInspection = { current: null, previous: null };
  state.rdfSessionId = null;
  state.rdfPreloaded = {current:new Set(), previous:new Set()};
  state.discoveredSlots = [];
  state.explorerSlotCache = new Map();
  state.explorerStackData = new Map();
  state.explorerStackSlots = [];
  pbiResetDashboardState();
  rdfSlotOptions.innerHTML = '';
  rdfDiscoveryStatus.textContent = state.workspaceMode === 'explore' ? 'Select RDF files for the run, then discover and cache available slots.' : 'Select RDF files for both runs, then discover available slots.';
  renderRdfMapping(preserved);
}
function assignFiles(inputId, fileList) {
  const files = Array.from(fileList || []);
  const mode = sourceFormat.value;
  const wanted = mode === 'rdf' ? '.rdf' : '.xlsx';
  const invalid = files.find(file => !file.name.toLowerCase().endsWith(wanted));
  if (invalid) {
    showError(`Please choose ${wanted} files in ${mode.toUpperCase()} mode. '${invalid.name}' does not match.`);
    return;
  }
  if (mode === 'xlsx' && files.length > 1) {
    showError('Legacy Excel mode accepts exactly one .xlsx workbook per run.');
    return;
  }
  hideError();
  if (inputId === 'currentFile') state.currentFiles = files;
  if (inputId === 'previousFile') state.previousFiles = files;
  if (mode === 'rdf') clearRdfInspection();
  updateFileUI(inputId);
}

for (const inputId of ['previousFile', 'currentFile']) {
  const input = document.getElementById(inputId);
  const zone = document.querySelector(`[data-input="${inputId}"]`);
  input.addEventListener('change', () => assignFiles(inputId, input.files));
  zone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  for (const eventName of ['dragenter', 'dragover']) zone.addEventListener(eventName, event => { event.preventDefault(); zone.classList.add('dragover'); });
  for (const eventName of ['dragleave', 'drop']) zone.addEventListener(eventName, event => { event.preventDefault(); zone.classList.remove('dragover'); });
  zone.addEventListener('drop', event => assignFiles(inputId, event.dataTransfer.files));
}


function setWorkspaceMode(mode) {
  state.workspaceMode = mode;
  modeChooser.hidden = true;
  uploadSection.hidden = false;
  document.body.classList.toggle('explore-only-mode', mode === 'explore');
  document.body.classList.remove('explorer-focused');
  const heroTitle = document.getElementById('heroTitle');
  const heroDescription = document.getElementById('heroDescription');
  const stepKicker = document.getElementById('stepKicker');
  const sourceFilesTitle = document.getElementById('sourceFilesTitle');
  if (mode === 'explore') {
    sourceFormat.value = 'rdf';
    configureSourceMode({clearFiles:true});
    heroTitle.textContent = 'Open one CRMMS run and explore the RiverWare results.';
    heroDescription.innerHTML = 'Load one or more <strong>RiverWare .rdf</strong> files for a single run, discover and cache the common result slots, then explore traces interactively. Report calculations are not required in this workspace.';
    if (stepKicker) stepKicker.textContent = 'Step 1 · Run files';
    if (sourceFilesTitle) sourceFilesTitle.textContent = 'Select Run source files';
    document.querySelector('[data-input="currentFile"] .drop-copy strong').textContent = 'Run · Results to explore';
    document.getElementById('currentFileHelp').textContent = 'Drop one or more .rdf files for the run you want to inspect';
    document.getElementById('explorerRunA').checked = true;
    document.getElementById('explorerRunB').checked = false;
    document.getElementById('explorerRunChooser').hidden = true;
    if (explorerRunBColorLabel) explorerRunBColorLabel.hidden = true;
    document.getElementById('saveExplorerAsReportPlotButton').hidden = true;
    document.querySelector('#dataExplorerSection .explorer-header h2').textContent = 'Inspect RiverWare results';
    document.querySelector('#dataExplorerSection .explorer-header p').textContent = 'Choose any discovered Object.Slot, show or hide traces, highlight traces, zoom, inspect the synchronized table, and export the values to CSV.';
    document.getElementById('closeDataExplorerButton').textContent = 'Change source files';
    document.querySelector('#explorerTableRun option[value="previous"]').hidden = true;
  } else if(plotType==='bar') {
    configureSourceMode({clearFiles:true});
    if (stepKicker) stepKicker.textContent = 'Step 1 · Comparison';
    if (sourceFilesTitle) sourceFilesTitle.textContent = 'Select Run A and Run B source files';
    heroTitle.textContent = 'Compare two CRMMS runs, then publish the Word report.';
    heroDescription.innerHTML = 'Compare Run A and Run B from <strong>RiverWare .rdf</strong> files (one or many files per run) or from legacy <strong>EnsembleOutput.xlsx</strong> workbooks. Configure exact RDF slots and traces, review the comparison, add notes and assumptions, and download a formatted <strong>.docx</strong>.';
    document.querySelector('[data-input="currentFile"] .drop-copy strong').textContent = 'Run A · New run';
    document.getElementById('explorerRunChooser').hidden = false;
    if (explorerRunBColorLabel) explorerRunBColorLabel.hidden = false;
    document.getElementById('saveExplorerAsReportPlotButton').hidden = false;
    document.querySelector('#dataExplorerSection .explorer-header h2').textContent = 'Inspect traces before building the report';
    document.querySelector('#dataExplorerSection .explorer-header p').textContent = 'Choose any discovered Object.Slot, show/hide individual traces, highlight one or several traces, change aggregation/plot treatment, and inspect the values in a synchronized table.';
    document.getElementById('closeDataExplorerButton').textContent = 'Close explorer';
    document.querySelector('#explorerTableRun option[value="previous"]').hidden = false;
  }
  updateFileUI('currentFile'); updateFileUI('previousFile');
  requestAnimationFrame(() => {
    document.getElementById('compareForm')?.scrollIntoView({behavior:'smooth', block:'start'});
    setTimeout(() => document.querySelector('[data-input="currentFile"]')?.focus({preventScroll:true}), 420);
  });
}

document.getElementById('chooseExploreMode')?.addEventListener('click', () => setWorkspaceMode('explore'));
document.getElementById('chooseCompareMode')?.addEventListener('click', () => setWorkspaceMode('compare'));
document.getElementById('changeModeButton')?.addEventListener('click', () => {
  dataExplorerSection.hidden = true; resultsSection.hidden = true; uploadSection.hidden = true; modeChooser.hidden = false; document.body.classList.remove('explore-only-mode','explorer-focused'); state.workspaceMode = null;
});

function configureSourceMode({clearFiles = true} = {}) {
  const rdf = sourceFormat.value === 'rdf';
  for (const inputId of ['previousFile', 'currentFile']) {
    const input = document.getElementById(inputId);
    input.accept = rdf ? '.rdf' : '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.multiple = rdf;
    input.value = '';
  }
  document.getElementById('previousFileHelp').textContent = rdf ? 'Drop one or more .rdf files for the baseline run' : 'Drop the baseline EnsembleOutput.xlsx here';
  document.getElementById('currentFileHelp').textContent = rdf ? 'Drop one or more .rdf files for the run you want reported' : 'Drop the new EnsembleOutput.xlsx here';
  document.getElementById('sourceModeNote').innerHTML = rdf
    ? 'RDF mode uses the generic RiverWare reader and lets you map each report input to an exact <code>Object.Slot</code>.'
    : 'Excel mode preserves the original workbook workflow and worksheet names.';
  rdfSettingsPanel.hidden = !rdf;
  if (clearFiles) {
    state.currentFiles = [];
    state.previousFiles = [];
    updateFileUI('currentFile'); updateFileUI('previousFile');
    clearRdfInspection();
  }
}
sourceFormat.addEventListener('change', () => configureSourceMode({clearFiles:true}));

function currentRdfConfiguration() {
  const rows = [...document.querySelectorAll('.rdf-map-row')];
  const mapping = {};
  const enabledInputs = [];
  rows.forEach(row => {
    const input = row.querySelector('.rdf-slot-input');
    const use = row.querySelector('.rdf-use-input');
    mapping[input.dataset.logical] = input.value.trim();
    if (use?.checked) enabledInputs.push(input.dataset.logical);
  });
  return {
    mapping,
    enabledInputs,
    customSlots: [...state.customRdfSlots],
    customStatistic: rdfCustomStatistic?.value || 'median',
    customPlots: state.customRdfPlots.map(x => ({...x}))
  };
}
function currentSlotMapping() {
  const cfg = currentRdfConfiguration();
  const enabled = new Set(cfg?.enabledInputs || []);
  const out = {};
  for (const [, logical] of rdfLogicalInputs) {
    const value = cfg?.mapping?.[logical] ?? logical;
    out[logical] = enabled.has(logical) ? String(value).trim() : '';
  }
  return out;
}
function normalizeRdfConfiguration(config = null) {
  const mapping = {};
  const all = rdfLogicalInputs.map(([, logical]) => logical);
  for (const logical of all) mapping[logical] = String(config?.mapping?.[logical] ?? logical).trim();
  let enabledInputs;
  if (Array.isArray(config?.enabledInputs)) enabledInputs = config.enabledInputs.filter(x => all.includes(x));
  else if (config?.mapping) enabledInputs = all.filter(logical => String(config.mapping[logical] ?? logical).trim() !== '');
  else enabledInputs = [...rdfDefaultEnabledInputs];
  const customSlots = Array.isArray(config?.customSlots)
    ? [...new Set(config.customSlots.map(x => String(x).trim()).filter(Boolean))]
    : [...state.customRdfSlots];
  const customStatistic = ['median','mean','min','max'].includes(config?.customStatistic) ? config.customStatistic : (rdfCustomStatistic?.value || 'median');
  const customPlots = Array.isArray(config?.customPlots)
    ? config.customPlots.map(item => ({
        slot: String(item?.slot || '').trim(),
        plot_type: ['line','bar','box'].includes(item?.plot_type) ? item.plot_type : 'line',
        title: String(item?.title || '').trim(),
        subtitle: String(item?.subtitle || '').trim(),
        transform: ['raw','water_year_sum','calendar_year_sum','annual_raw'].includes(item?.transform) ? item.transform : 'raw',
        wy_start_month: Number(item?.wy_start_month || 10),
        run_a_color: String(item?.run_a_color || '#167c80'),
        run_b_color: String(item?.run_b_color || '#d07a28'),
        alpha: Math.max(0.05, Math.min(1, Number(item?.alpha ?? 0.28))),
        trace_numbers: Array.isArray(item?.trace_numbers) ? item.trace_numbers.map(Number).filter(Number.isFinite) : [],
        trace_labels: (item?.trace_labels && typeof item.trace_labels === 'object') ? {...item.trace_labels} : {}
      })).filter(item => item.slot)
    : state.customRdfPlots.map(x => ({...x}));
  return { mapping, enabledInputs, customSlots, customStatistic, customPlots };
}

function currentExplorerPreload() {
  const patterns = String(explorerPreloadPatterns?.value || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const all_slots_files = String(explorerPreloadFiles?.value || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  return {patterns, all_slots_files};
}
function applyExplorerPreload(config) {
  const value = config && typeof config === 'object' ? config : DEFAULT_EXPLORER_PRELOAD;
  state.explorerPreload = {
    patterns: Array.isArray(value.patterns) ? value.patterns.map(String) : [...DEFAULT_EXPLORER_PRELOAD.patterns],
    all_slots_files: Array.isArray(value.all_slots_files) ? value.all_slots_files.map(String) : [...DEFAULT_EXPLORER_PRELOAD.all_slots_files]
  };
  if (explorerPreloadPatterns) explorerPreloadPatterns.value = state.explorerPreload.patterns.join('\n');
  if (explorerPreloadFiles) explorerPreloadFiles.value = state.explorerPreload.all_slots_files.join('\n');
  const summary=document.getElementById('explorerPreloadSummary');
  if(summary) summary.textContent=`${state.explorerPreload.patterns.length} slot patterns · ${state.explorerPreload.all_slots_files.length} whole-file preload rule${state.explorerPreload.all_slots_files.length===1?'':'s'}`;
}
explorerPreloadPatterns?.addEventListener('input',()=>applyExplorerPreload(currentExplorerPreload()));
explorerPreloadFiles?.addEventListener('input',()=>applyExplorerPreload(currentExplorerPreload()));
applyExplorerPreload(state.explorerPreload);

function rdfSlotStatus(value) {
  const currentSlots = new Set((state.rdfInspection.current?.slots || []).map(x => x.object_slot));
  const previousSlots = new Set((state.rdfInspection.previous?.slots || []).map(x => x.object_slot));
  const inspected = Boolean(state.rdfInspection.current && state.rdfInspection.previous);
  if (!inspected) return '<span class="slot-status neutral">not inspected</span>';
  const inA = currentSlots.has(value), inB = previousSlots.has(value);
  return inA && inB
    ? '<span class="slot-status ok">both runs</span>'
    : `<span class="slot-status missing">${inA ? 'Run B missing' : inB ? 'Run A missing' : 'not found'}</span>`;
}
function updateRdfSelectionSummary() {
  const enabled = document.querySelectorAll('.rdf-use-input:checked').length;
  const total = rdfLogicalInputs.length;
  const customCount = state.customRdfSlots.length;
  const plotCount = state.customRdfPlots.length;
  if (rdfSelectionSummary) rdfSelectionSummary.textContent = `${enabled}/${total} CRMMS inputs · ${customCount} added slot${customCount === 1 ? '' : 's'} · ${plotCount} plot${plotCount === 1 ? '' : 's'}`;
  if (rdfStandardInputSummary) rdfStandardInputSummary.textContent = `${enabled} of ${total} logical inputs enabled`;
  updateCustomSlotSummary();
  updateRdfPlotSummary();
}
function syncRdfRow(row) {
  const use = row.querySelector('.rdf-use-input');
  const input = row.querySelector('.rdf-slot-input');
  row.classList.toggle('is-disabled', !use.checked);
  input.disabled = !use.checked;
  const status = row.querySelector('.slot-status');
  if (status) status.outerHTML = rdfSlotStatus(input.value.trim());
}
function mappedSlotTimestepTypes(value) {
  const types = new Set();
  for (const inspection of [state.rdfInspection.current, state.rdfInspection.previous]) {
    const rec = (inspection?.slots || []).find(item => item.object_slot === value);
    for (const type of (rec?.timestep_types || [])) {
      const normalized = String(type || '').trim().toLowerCase();
      if (normalized) types.add(normalized);
    }
  }
  return types;
}
function rdfLogicalTimestep(logical, mappedSlot) {
  const types = mappedSlotTimestepTypes(mappedSlot);
  if (types.size === 1 && types.has('monthly')) return 'monthly';
  if (types.size === 1 && types.has('annual')) return 'annual';
  return rdfFallbackMonthlyInputs.has(logical) ? 'monthly' : 'annual';
}
function renderRdfMapRows(items, cfg, enabled) {
  let html = '';
  let basin = '';
  for (const item of items) {
    const { group, logical, value } = item;
    if (group !== basin) {
      basin = group;
      html += `<div class="rdf-map-group">${escapeHtml(basin)}</div>`;
    }
    const checked = enabled.has(logical);
    html += `<div class="rdf-map-row ${checked ? '' : 'is-disabled'}" title="${escapeHtml(logical)}">` +
      `<label class="rdf-use-cell"><input class="rdf-use-input" type="checkbox" data-logical="${escapeHtml(logical)}" ${checked ? 'checked' : ''}/><span>Use</span></label>` +
      `<span class="rdf-logical"><strong title="${escapeHtml(logical)}">${escapeHtml(logical)}</strong><small>Logical report input</small></span>` +
      `<span class="rdf-map-arrow">→</span>` +
      `<span class="rdf-slot-field"><input class="rdf-slot-input" data-logical="${escapeHtml(logical)}" list="rdfSlotOptions" value="${escapeHtml(value)}" spellcheck="false" title="${escapeHtml(value)}" ${checked ? '' : 'disabled'} />${rdfSlotStatus(value)}</span>` +
      `</div>`;
  }
  return html;
}
function renderRdfMapping(config = null) {
  const cfg = normalizeRdfConfiguration(config === null ? null : config);
  state.customRdfSlots = [...cfg.customSlots];
  state.customRdfPlots = cfg.customPlots.map(x => ({...x}));
  if (rdfCustomStatistic) rdfCustomStatistic.value = cfg.customStatistic;
  const enabled = new Set(cfg.enabledInputs);
  const grouped = { monthly: [], annual: [] };
  for (const [group, logical] of rdfLogicalInputs) {
    const value = cfg.mapping[logical] || logical;
    const timestep = rdfLogicalTimestep(logical, value);
    grouped[timestep].push({ group, logical, value });
  }
  const monthlyEnabled = grouped.monthly.filter(item => enabled.has(item.logical)).length;
  const annualEnabled = grouped.annual.filter(item => enabled.has(item.logical)).length;
  rdfSlotMapping.innerHTML = `
    <details class="rdf-timestep-group" data-timestep="monthly" open>
      <summary><span><strong>Monthly slots</strong><small>Elevation and monthly flow inputs</small></span><em>${monthlyEnabled}/${grouped.monthly.length} enabled</em></summary>
      <div class="rdf-timestep-rows">${renderRdfMapRows(grouped.monthly, cfg, enabled)}</div>
    </details>
    <details class="rdf-timestep-group" data-timestep="annual">
      <summary><span><strong>Annual slots</strong><small>Annual conditions, flags, release tiers and annual values</small></span><em>${annualEnabled}/${grouped.annual.length} enabled</em></summary>
      <div class="rdf-timestep-rows">${renderRdfMapRows(grouped.annual, cfg, enabled)}</div>
    </details>`;

  // Behave like a small accordion: opening one timestep group collapses the
  // other, while both remain independently collapsible.
  const timestepPanels = [...rdfSlotMapping.querySelectorAll('.rdf-timestep-group')];
  timestepPanels.forEach(panel => panel.addEventListener('toggle', () => {
    if (!panel.open) return;
    timestepPanels.forEach(other => { if (other !== panel) other.open = false; });
  }));
  document.querySelectorAll('.rdf-use-input').forEach(check => check.addEventListener('change', () => { syncRdfRow(check.closest('.rdf-map-row')); updateRdfSelectionSummary(); }));
  document.querySelectorAll('.rdf-slot-input').forEach(input => input.addEventListener('input', () => {
    input.title = input.value;
    const row = input.closest('.rdf-map-row');
    const status = row.querySelector('.slot-status');
    if (status) status.outerHTML = rdfSlotStatus(input.value.trim());
  }));
  renderAvailableRdfSlots();
  renderRdfPlotConfig();
  updateRdfSelectionSummary();
}
function discoveredRdfSlots() {
  const a = new Map((state.rdfInspection.current?.slots || []).map(x => [x.object_slot, x]));
  const b = new Map((state.rdfInspection.previous?.slots || []).map(x => [x.object_slot, x]));
  const names = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x.localeCompare(y));
  return names.map(name => ({ name, a: a.get(name) || null, b: b.get(name) || null }));
}
function slotMetaText(item, key) {
  const values = [...new Set([...(item.a?.[key] || []), ...(item.b?.[key] || [])].filter(x => x != null && String(x).trim() !== ''))];
  return values.length ? values.join(', ') : '—';
}
function slotPresence(item) {
  if (item.a && item.b) return { key:'both', label:'both runs' };
  if (item.a) return { key:'a-only', label:'Run A only' };
  return { key:'b-only', label:'Run B only' };
}
function slotTimestep(item) {
  const values = [...new Set([
    ...(item.a?.timestep_types || []),
    ...(item.b?.timestep_types || [])
  ].map(x => String(x || '').trim().toLowerCase()).filter(Boolean))];
  // RiverWare report RDFs used here are monthly or annual. If metadata is
  // mixed/unspecified, keep the slot visible with the monthly/other group
  // rather than hiding it from the caller.
  return values.length && values.every(x => x === 'annual') ? 'annual' : 'monthly';
}
function slotSourceFiles(item) {
  const a = (item.a?.files || []).map(x => String(x));
  const b = (item.b?.files || []).map(x => String(x));
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
}
function primarySlotSourceFile(item) {
  const a = (item.a?.files || []).map(x => String(x));
  const b = (item.b?.files || []).map(x => String(x));
  const common = a.filter(name => b.includes(name));
  const preferred = common.length ? common : (a.length ? a : b);
  return preferred.length ? preferred.join(' + ') : 'Unknown RDF file';
}
function isFlagsRdfName(filename) {
  return String(filename || '').trim().toLowerCase() === 'flags.rdf';
}
function visibleDiscoveredSlots() {
  const query = (rdfSlotSearch?.value || '').trim().toLowerCase();
  const filter = rdfSlotPresenceFilter?.value || 'both';
  return discoveredRdfSlots().filter(item => {
    const presence = slotPresence(item).key;
    if (filter !== 'all' && filter !== presence && !(filter === 'both' && presence === 'both')) return false;
    return !query || item.name.toLowerCase().includes(query) || slotMetaText(item, 'units').toLowerCase().includes(query);
  });
}
function updateCustomSlotSummary() {
  if (!rdfCustomSlotSummary) return;
  const discovered = discoveredRdfSlots();
  const commonCount = discovered.filter(x => x.a && x.b).length;
  const selected = state.customRdfSlots.length;
  if (!discovered.length) rdfCustomSlotSummary.textContent = selected ? `${selected} saved selection${selected === 1 ? '' : 's'} · discover RDFs to validate` : 'Discover RDFs to browse every available slot';
  else rdfCustomSlotSummary.textContent = `${selected} selected · ${commonCount} common · ${discovered.length} total discovered`;
}
function renderAvailableRdfSlots() {
  if (!rdfAvailableSlots) return;
  const discovered = discoveredRdfSlots();
  if (!discovered.length) {
    rdfAvailableSlots.classList.add('empty');
    rdfAvailableSlots.innerHTML = '<div class="rdf-slot-empty">Select RDF files and click <b>Discover RDF slots</b> to populate this list.</div>';
    updateCustomSlotSummary();
    return;
  }
  const visible = visibleDiscoveredSlots();
  const selected = new Set(state.customRdfSlots);
  rdfAvailableSlots.classList.remove('empty');
  const renderRows = items => items.map(item => {
    const presence = slotPresence(item);
    const checked = selected.has(item.name);
    const units = slotMetaText(item, 'units');
    const timesteps = slotMetaText(item, 'timestep_types');
    const sources = slotSourceFiles(item);
    const sourceText = sources.length ? sources.join(', ') : 'Unknown RDF';
    const flagSum = slotTimestep(item) === 'annual' && sources.some(isFlagsRdfName);
    return `<label class="rdf-available-slot-row ${checked ? 'is-selected' : ''}" data-slot="${escapeHtml(item.name)}" title="${escapeHtml(item.name)}">` +
      `<input class="rdf-custom-slot-check" type="checkbox" value="${escapeHtml(item.name)}" ${checked ? 'checked' : ''}/>` +
      `<span class="rdf-available-slot-name">${escapeHtml(item.name)}</span>` +
      `<span class="rdf-available-slot-meta">Units: ${escapeHtml(units)}</span>` +
      `<span class="rdf-available-slot-meta source-meta" title="${escapeHtml(sourceText)}">${flagSum ? '<b>Yearly sum</b> · ' : ''}${escapeHtml(sourceText)}${timesteps && timesteps !== '—' ? ` · ${escapeHtml(timesteps)}` : ''}</span>` +
      `<span class="rdf-available-slot-presence"><span class="rdf-slot-status-chip ${presence.key === 'both' ? 'both' : 'one'}">${escapeHtml(presence.label)}</span></span>` +
      `</label>`;
  }).join('');

  const monthly = visible.filter(item => slotTimestep(item) === 'monthly');
  const annual = visible.filter(item => slotTimestep(item) === 'annual');
  const monthlySelected = monthly.filter(item => selected.has(item.name)).length;
  const annualSelected = annual.filter(item => selected.has(item.name)).length;
  const annualByFile = new Map();
  annual.forEach(item => {
    const key = primarySlotSourceFile(item);
    if (!annualByFile.has(key)) annualByFile.set(key, []);
    annualByFile.get(key).push(item);
  });
  const annualHtml = [...annualByFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([filename, items]) => {
    const count = items.filter(item => selected.has(item.name)).length;
    const flags = items.some(item => slotSourceFiles(item).some(isFlagsRdfName));
    return `<section class="rdf-source-file-group ${flags ? 'is-flags-file' : ''}">` +
      `<div class="rdf-source-file-heading"><span><strong>${escapeHtml(filename)}</strong>${flags ? '<small>Annual 0/1 flags in this file are summed for each year.</small>' : '<small>Annual slots from this RDF file.</small>'}</span><em>${count}/${items.length} selected</em></div>` +
      `${renderRows(items)}` +
      `</section>`;
  }).join('');

  rdfAvailableSlots.innerHTML = visible.length ? `
    <details class="rdf-custom-timestep-group" data-custom-timestep="monthly" ${state.customSlotOpenTimestep === 'monthly' ? 'open' : ''}>
      <summary><span><strong>Monthly slots</strong><small>Monthly values use the selected generic report statistic.</small></span><em>${monthlySelected}/${monthly.length} selected</em></summary>
      <div class="rdf-custom-timestep-rows">${monthly.length ? renderRows(monthly) : '<div class="rdf-slot-empty">No monthly slots match this search/filter.</div>'}</div>
    </details>
    <details class="rdf-custom-timestep-group" data-custom-timestep="annual" ${state.customSlotOpenTimestep === 'annual' ? 'open' : ''}>
      <summary><span><strong>Annual slots</strong><small>Grouped by source RDF file; <code>flags.rdf</code> slots use yearly sums.</small></span><em>${annualSelected}/${annual.length} selected</em></summary>
      <div class="rdf-custom-timestep-rows">${annual.length ? annualHtml : '<div class="rdf-slot-empty">No annual slots match this search/filter.</div>'}</div>
    </details>` : '<div class="rdf-slot-empty">No discovered slots match this search/filter.</div>';

  const customTimestepPanels = [...rdfAvailableSlots.querySelectorAll('.rdf-custom-timestep-group')];
  customTimestepPanels.forEach(panel => panel.addEventListener('toggle', () => {
    if (!panel.open) return;
    state.customSlotOpenTimestep = panel.dataset.customTimestep || 'monthly';
    customTimestepPanels.forEach(other => { if (other !== panel) other.open = false; });
  }));
  document.querySelectorAll('.rdf-custom-slot-check').forEach(check => check.addEventListener('change', () => {
    const value = check.value;
    const set = new Set(state.customRdfSlots);
    if (check.checked) set.add(value); else set.delete(value);
    state.customRdfSlots = [...set].sort((a,b) => a.localeCompare(b));
    check.closest('.rdf-available-slot-row')?.classList.toggle('is-selected', check.checked);
    updateRdfSelectionSummary();
  }));
  updateCustomSlotSummary();
}

function updateRdfPlotSummary() {
  if (!rdfPlotSummary) return;
  const count = state.customRdfPlots.length;
  rdfPlotSummary.textContent = count ? `${count} custom plot${count === 1 ? '' : 's'} configured` : 'No custom RDF plots configured';
}
function parseClientTraceExpression(raw) {
  const values=[]; const seen=new Set();
  String(raw || '').split(/[;,\s]+/).filter(Boolean).forEach(part=>{
    if (part.includes('-')) {
      const [a,b]=part.split('-',2).map(Number); if (!Number.isFinite(a)||!Number.isFinite(b)) return;
      const step=a<=b?1:-1; for(let n=a; step>0?n<=b:n>=b; n+=step){if(n>0&&!seen.has(n)){seen.add(n);values.push(n);}}
    } else { const n=Number(part); if(Number.isFinite(n)&&n>0&&!seen.has(n)){seen.add(n);values.push(n);} }
  });
  return values;
}
function compactTraceExpression(values) {
  const arr=[...new Set((values||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(!arr.length) return '';
  const parts=[]; let start=arr[0], prev=arr[0];
  const flush=()=>parts.push(start===prev?String(start):`${start}-${prev}`);
  for(let i=1;i<arr.length;i++){const n=arr[i]; if(n===prev+1){prev=n;continue;} flush(); start=prev=n;} flush(); return parts.join(',');
}
function renderRdfPlotConfig() {
  if (!rdfPlotConfigList) return;
  const discovered = discoveredRdfSlots();
  if (!state.customRdfPlots.length) {
    rdfPlotConfigList.innerHTML = `<div class="rdf-slot-empty">${discovered.length ? 'Click <b>Add plot</b> to choose any discovered Object.Slot.' : 'Discover RDF slots first, then click <b>Add plot</b>.'}</div>`;
    updateRdfPlotSummary();
    return;
  }
  const slotOptions = (selected) => {
    const options = [];
    if (!selected) options.push('<option value="" selected disabled>Choose a discovered slot…</option>');
    if (selected && !discovered.some(item => item.name === selected)) {
      options.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (not found in current RDFs)</option>`);
    }
    for (const item of discovered) {
      const presence = slotPresence(item).label;
      const timestep = slotTimestep(item);
      const source = slotSourceFiles(item).join(', ');
      const label = `${item.name} · ${timestep}${source ? ` · ${source}` : ''} · ${presence}`;
      options.push(`<option value="${escapeHtml(item.name)}" ${item.name === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`);
    }
    return options.join('');
  };
  rdfPlotConfigList.innerHTML = state.customRdfPlots.map((spec, index) => {
    const item = discovered.find(x => x.name === spec.slot);
    const source = item ? slotSourceFiles(item).join(', ') : '';
    const annualFlag = Boolean(item && slotTimestep(item) === 'annual' && slotSourceFiles(item).some(isFlagsRdfName));
    const status = item ? slotPresence(item).label : (spec.slot ? (discovered.length ? 'not found' : 'not inspected') : 'choose a slot');
    return `<div class="rdf-plot-config-row" data-index="${index}">
      <label class="rdf-plot-slot-field">Object.Slot<select class="rdf-plot-slot">${slotOptions(spec.slot)}</select></label>
      <label>Plot type<select class="rdf-plot-type"><option value="line" ${spec.plot_type === 'line' ? 'selected' : ''}>Line — trace time series</option><option value="bar" ${spec.plot_type === 'bar' ? 'selected' : ''}>Bar — trace values</option><option value="box" ${spec.plot_type === 'box' ? 'selected' : ''}>Box — trace distribution</option></select></label>
      <label>Data treatment<select class="rdf-plot-transform"><option value="raw" ${(spec.transform || 'raw') === 'raw' ? 'selected' : ''}>Raw timestep values</option><option value="water_year_sum" ${spec.transform === 'water_year_sum' ? 'selected' : ''}>Water-year sum by trace</option><option value="calendar_year_sum" ${spec.transform === 'calendar_year_sum' ? 'selected' : ''}>Calendar-year sum by trace</option><option value="annual_raw" ${spec.transform === 'annual_raw' ? 'selected' : ''}>Annual values by trace</option></select></label>
      <label>WY start month<select class="rdf-plot-wy-start"><option value="10" ${Number(spec.wy_start_month || 10)===10?'selected':''}>October</option><option value="1" ${Number(spec.wy_start_month)===1?'selected':''}>January</option><option value="7" ${Number(spec.wy_start_month)===7?'selected':''}>July</option></select></label>
      <label>Plot traces<input class="rdf-plot-traces" value="${escapeHtml(compactTraceExpression(spec.trace_numbers || []))}" placeholder="blank = calculation traces; e.g. 1-33" /></label>
      <label class="rdf-plot-title-field">Plot title<input class="rdf-plot-title" value="${escapeHtml(spec.title || '')}" placeholder="Defaults to Object.Slot name" /></label>
      <label class="rdf-plot-subtitle-field">Plot subtitle<input class="rdf-plot-subtitle" value="${escapeHtml(spec.subtitle || '')}" placeholder="Leave blank for an automatic description" /></label>
      <label>Run A color<input class="rdf-plot-run-a-color" type="color" value="${escapeHtml(spec.run_a_color || '#167c80')}" /></label>
      <label>Run B color<input class="rdf-plot-run-b-color" type="color" value="${escapeHtml(spec.run_b_color || '#d07a28')}" /></label>
      <label>Line opacity<input class="rdf-plot-alpha" type="number" min="0.05" max="1" step="0.05" value="${Number(spec.alpha ?? 0.28).toFixed(2)}" /></label>
      <button class="text-button rdf-remove-plot" type="button">Remove</button>
      <div class="rdf-plot-row-meta">${escapeHtml(status)}${source ? ` · ${escapeHtml(source)}` : ''}${annualFlag ? ' · annual flags use yearly 0/1 sums for line/bar plots' : ` · data treatment: ${escapeHtml((spec.transform || 'raw').replaceAll('_',' '))} · plot traces are independent of calculation traces`}</div>
    </div>`;
  }).join('');
  rdfPlotConfigList.querySelectorAll('.rdf-plot-config-row').forEach(row => {
    const index = Number(row.dataset.index);
    const sync = (rerender=false) => {
      const slot = row.querySelector('.rdf-plot-slot').value.trim();
      const prior = state.customRdfPlots[index] || {};
      const traceExpression = row.querySelector('.rdf-plot-traces')?.value || '';
      state.customRdfPlots[index] = {
        ...prior,
        slot,
        plot_type: row.querySelector('.rdf-plot-type').value,
        title: row.querySelector('.rdf-plot-title').value.trim(),
        subtitle: row.querySelector('.rdf-plot-subtitle').value.trim(),
        transform: row.querySelector('.rdf-plot-transform')?.value || 'raw',
        wy_start_month: Number(row.querySelector('.rdf-plot-wy-start')?.value || 10),
        run_a_color: row.querySelector('.rdf-plot-run-a-color')?.value || '#167c80',
        run_b_color: row.querySelector('.rdf-plot-run-b-color')?.value || '#d07a28',
        alpha: Number(row.querySelector('.rdf-plot-alpha')?.value || 0.28),
        trace_numbers: traceExpression.trim() ? parseClientTraceExpression(traceExpression) : [],
        trace_labels: (prior.trace_labels && Object.keys(prior.trace_labels).length) ? prior.trace_labels : {...state.traceLabels}
      };
      updateRdfPlotSummary();
      if (rerender) renderRdfPlotConfig();
    };
    row.querySelector('.rdf-plot-slot').addEventListener('change', () => sync(true));
    row.querySelector('.rdf-plot-type').addEventListener('change', () => sync(false));
    row.querySelectorAll('.rdf-plot-transform,.rdf-plot-wy-start,.rdf-plot-run-a-color,.rdf-plot-run-b-color,.rdf-plot-alpha,.rdf-plot-traces').forEach(control => control?.addEventListener('change', () => sync(false)));
    row.querySelectorAll('.rdf-plot-title,.rdf-plot-subtitle').forEach(control => {
      control.addEventListener('change', () => sync(false));
      control.addEventListener('input', () => sync(false));
    });
    row.querySelector('.rdf-remove-plot').addEventListener('click', () => {
      state.customRdfPlots.splice(index, 1);
      renderRdfPlotConfig();
      updateRdfSelectionSummary();
    });
  });
  updateRdfPlotSummary();
}
document.getElementById('addRdfPlotButton')?.addEventListener('click', () => {
  const discovered = discoveredRdfSlots();
  if (!discovered.length) {
    showError('Discover RDF slots first, then add a custom plot.');
    rdfSettingsPanel.open = true;
    return;
  }
  const used = new Set(state.customRdfPlots.map(x => x.slot).filter(Boolean));
  const firstUnused = discovered.find(item => item.a && item.b && !used.has(item.name)) || discovered.find(item => !used.has(item.name)) || null;
  state.customRdfPlots.push({slot:firstUnused?.name || '', plot_type:'line', title:'', subtitle:'', transform:'raw', wy_start_month:10, run_a_color:'#167c80', run_b_color:'#d07a28', dim_color:'#9aa5aa', annual_year:'', bar_sort:'none', alpha:0.28});
  renderRdfPlotConfig();
  document.getElementById('rdfPlotConfigurationPanel').open = true;
  updateRdfSelectionSummary();
});
function readSavedRdfProfile() {
  try {
    const raw = localStorage.getItem(RDF_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function applyRdfProfile(profile, message = '') {
  if (!profile) return false;
  if (profile.trace_numbers != null) document.getElementById('traceNumbers').value = profile.trace_numbers;
  if (profile.add_esp_year != null) document.getElementById('addEspYear').checked = Boolean(profile.add_esp_year);
  if (profile.trace_labels && typeof profile.trace_labels === 'object') state.traceLabels = {...profile.trace_labels};
  if (profile.explorer_settings && typeof profile.explorer_settings === 'object') state.explorerSettings = {...state.explorerSettings, ...profile.explorer_settings};
  if (profile.explorer_preload && typeof profile.explorer_preload === 'object') applyExplorerPreload(profile.explorer_preload);
  renderRdfMapping({
    mapping: profile.mapping || {},
    enabledInputs: profile.enabled_inputs,
    customSlots: profile.custom_slots || [],
    customStatistic: profile.custom_statistic || 'median',
    customPlots: profile.custom_plots || []
  });
  if (rdfProfileStatus && message) rdfProfileStatus.textContent = message;
  return true;
}
function saveRdfProfile() {
  const cfg = normalizeRdfConfiguration(currentRdfConfiguration());
  const payload = {
    version: 1,
    mapping: cfg.mapping,
    enabled_inputs: cfg.enabledInputs,
    custom_slots: cfg.customSlots,
    custom_statistic: cfg.customStatistic,
    custom_plots: cfg.customPlots,
    trace_numbers: document.getElementById('traceNumbers').value,
    add_esp_year: document.getElementById('addEspYear').checked,
    trace_labels: {...state.traceLabels},
    explorer_settings: explorerSettingsSnapshot(),
    explorer_preload: currentExplorerPreload()
  };
  localStorage.setItem(RDF_PROFILE_KEY, JSON.stringify(payload));
  if (rdfProfileStatus) rdfProfileStatus.textContent = `Saved locally · ${cfg.enabledInputs.length} CRMMS inputs · ${cfg.customSlots.length} added slot${cfg.customSlots.length === 1 ? '' : 's'} · ${cfg.customPlots.length} plot${cfg.customPlots.length === 1 ? '' : 's'}`;
}
function setRdfInputSelection(mode) {
  const inspected = Boolean(state.rdfInspection.current && state.rdfInspection.previous);
  if (mode === 'available' && !inspected) { showError('Discover RDF slots first, then choose “Available in both”.'); rdfSettingsPanel.open = true; return; }
  document.querySelectorAll('.rdf-map-row').forEach(row => {
    const use = row.querySelector('.rdf-use-input');
    const input = row.querySelector('.rdf-slot-input');
    if (mode === 'all') use.checked = true;
    if (mode === 'none') use.checked = false;
    if (mode === 'available') {
      const a = new Set((state.rdfInspection.current?.slots || []).map(x => x.object_slot));
      const b = new Set((state.rdfInspection.previous?.slots || []).map(x => x.object_slot));
      use.checked = a.has(input.value.trim()) && b.has(input.value.trim());
    }
    syncRdfRow(row);
  });
  updateRdfSelectionSummary();
}

document.getElementById('selectAllRdfInputs').addEventListener('click', () => setRdfInputSelection('all'));
document.getElementById('selectAvailableRdfInputs').addEventListener('click', () => setRdfInputSelection('available'));
document.getElementById('clearRdfInputs').addEventListener('click', () => setRdfInputSelection('none'));
rdfSlotSearch?.addEventListener('input', renderAvailableRdfSlots);
rdfSlotPresenceFilter?.addEventListener('change', renderAvailableRdfSlots);
rdfCustomStatistic?.addEventListener('change', updateRdfSelectionSummary);
document.getElementById('selectVisibleRdfSlots')?.addEventListener('click', () => {
  const set = new Set(state.customRdfSlots);
  visibleDiscoveredSlots().forEach(item => set.add(item.name));
  state.customRdfSlots = [...set].sort((a,b) => a.localeCompare(b));
  renderAvailableRdfSlots();
  updateRdfSelectionSummary();
});
document.getElementById('clearCustomRdfSlots')?.addEventListener('click', () => {
  state.customRdfSlots = [];
  renderAvailableRdfSlots();
  updateRdfSelectionSummary();
});
document.getElementById('saveRdfDefaultButton').addEventListener('click', saveRdfProfile);
document.getElementById('restoreRdfDefaultButton').addEventListener('click', () => {
  const saved = readSavedRdfProfile();
  if (!saved) { if (rdfProfileStatus) rdfProfileStatus.textContent = 'No saved RDF default was found in this browser.'; return; }
  applyRdfProfile(saved, `Restored saved default · ${(saved.enabled_inputs || []).length} inputs enabled`);
});
document.getElementById('resetRdfDefaultButton').addEventListener('click', () => {
  localStorage.removeItem(RDF_PROFILE_KEY);
  document.getElementById('traceNumbers').value = '4-33';
  document.getElementById('addEspYear').checked = true;
  state.customRdfSlots = [];
  state.customRdfPlots = [];
  state.traceLabels = {};
  state.explorerStackSlots = [];
  state.explorerStackOrder = [];
  state.explorerStackPlotTypes = {};
  state.explorerSettings = { transform:'raw', plot_type:'line', wy_start_month:10, run_a_color:'#167c80', run_b_color:'#d07a28', dim_color:'#9aa5aa', annual_year:'', bar_sort:'none', alpha:0.28, title:'', subtitle:'', highlight_trace:'', box_line_overlay:true, x_axis_title:'', y_axis_title:'', line_width:1.0, plot_height:400, table_decimals:2, show_grid:true, overlay_alpha:0.28, y_axis_mode:'auto', y_min:'', y_max:'', percentile_band:false, percentile_low:10, percentile_high:90, unit_factor:1, unit_offset:0, display_unit:'', reference_lines:'', conditional_rules:'', stack_slots:[], stack_order:[], stack_plot_types:{}, stack_items:[] };
  applyExplorerPreload(DEFAULT_EXPLORER_PRELOAD);
  applyExplorerSettings(state.explorerSettings);
  if (rdfCustomStatistic) rdfCustomStatistic.value = 'median';
  renderRdfMapping({ mapping: {}, enabledInputs: [...rdfDefaultEnabledInputs], customSlots: [], customStatistic: 'median', customPlots: [] });
  if (rdfProfileStatus) rdfProfileStatus.textContent = 'Reset to factory mappings; no browser-local default is saved.';
});

const savedRdfProfile = readSavedRdfProfile();
if (savedRdfProfile) applyRdfProfile(savedRdfProfile, `Saved default loaded · ${(savedRdfProfile.enabled_inputs || []).length} inputs enabled`);
else { renderRdfMapping(); if (rdfProfileStatus) rdfProfileStatus.textContent = 'No browser-local default saved yet.'; }
configureSourceMode({clearFiles:false});

function populateExplorerSlotOptions(preserve=true) {
  const current = preserve ? explorerSlot.value : '';
  const q = String(explorerSlotSearch?.value || '').trim().toLowerCase();
  const visible = (state.discoveredSlots || []).filter(slot => !q || slot.toLowerCase().includes(q));
  explorerSlot.innerHTML = visible.length
    ? visible.map(slot => `<option value="${escapeHtml(slot)}">${escapeHtml(slot)}</option>`).join('')
    : '<option value="">No matching slots</option>';
  const preferred = [current, state.explorerSettings?.slot].find(x => x && visible.includes(x));
  if (preferred) explorerSlot.value = preferred;
  else if (visible.length) {
    const pool = visible.find(x => /pool elevation$/i.test(x));
    const preloaded = visible.find(x => state.rdfPreloaded.current.has(x) || state.rdfPreloaded.previous.has(x));
    explorerSlot.value = pool || preloaded || visible[0];
  }
  updateExplorerSlotLoadState();
}




async function getExplorerSlotPayload(slot, {force=false}={}) {
  if (!slot || !state.rdfSessionId) return null;
  const cacheKey = `${state.rdfSessionId}::${slot}`;
  let payload = !force ? state.explorerSlotCache.get(cacheKey) : null;
  if (!payload) {
    const response = await fetch(`/api/rdf/session/${encodeURIComponent(state.rdfSessionId)}/slot?slot=${encodeURIComponent(slot)}`);
    payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `Could not load RDF slot ${slot}.`);
    state.explorerSlotCache.set(cacheKey, payload);
  }
  return payload;
}


function explorerSlotCacheState(slot=explorerSlot?.value || '') {
  if (!slot || !state.rdfSessionId) return {browser:false, preloaded:false, fast:false};
  const cacheKey = `${state.rdfSessionId}::${slot}`;
  const browser = state.explorerSlotCache.has(cacheKey);
  const preloaded = state.rdfPreloaded.current.has(slot) || state.rdfPreloaded.previous.has(slot);
  return {browser, preloaded, fast:browser || preloaded};
}

function updateExplorerSlotLoadState() {
  const slot = explorerSlot?.value || '';
  const cache = explorerSlotCacheState(slot);

  // v4.5: slots now lazy-load automatically when selected, so the
  // separate manual Load slot button is no longer necessary.
  if (loadExplorerSlotButton) {
    loadExplorerSlotButton.hidden = true;
  }

  if (!slot) return;

  if (cache.browser && explorerCacheStatus) {
    explorerCacheStatus.textContent =
      `${slot} · cached in browser · selecting it loads immediately`;
  }
  else if (cache.preloaded && explorerCacheStatus) {
    explorerCacheStatus.textContent =
      `${slot} · preloaded in Explorer session · selecting it loads immediately`;
  }
  else if (state.rdfSessionId && explorerCacheStatus) {
    explorerCacheStatus.textContent =
      `${slot} · loads automatically when selected and is then cached`;
  }
}

function showExplorerSlotPending(slot) {
  state.explorerData = null;
  state.explorerSelectedTraceColumns = new Set();
  state.explorerSelectedRows = new Set();
  state.explorerViewport = {x:null,y:null};
  state.explorerTableTraceFilter = null;
  const plot=document.getElementById('explorerPlot');
  const table=document.getElementById('explorerTable');
  if (plot) plot.innerHTML = `<div class="empty-preview"><strong>${escapeHtml(slot)}</strong><p>This slot is not preloaded. Click <b>Load slot</b> next to the selector to read it once and cache it.</p></div>`;
  if (table) table.innerHTML = '<div class="rdf-slot-empty">Load the selected slot to inspect its data.</div>';
  renderExplorerTraceControls(false);
  updateExplorerSlotLoadState();
}

explorerSlotSearch?.addEventListener('input', () => populateExplorerSlotOptions(true));

state.runDisplayNames = state.runDisplayNames || {current:'',previous:''};
function rdfDescriptions(runKey='current'){return (state.rdfInspection?.[runKey]?.files||[]).map(f=>({filename:f.filename,...(f.description||{})}));}
function meaningfulRdfName(runKey='current'){const names=rdfDescriptions(runKey).map(x=>String(x.name||'').trim()).filter(Boolean);const generic=/^(rdf|results?|output|riverware|crmms|res|streamflow|flags)([ ._-]*rdf)?$/i;const candidates=names.filter(n=>!generic.test(n)&&n.length>5);return candidates.length&&new Set(candidates).size===1?candidates[0]:'';}
function formatRunMonth(value){if(!/^\\d{4}-\\d{2}$/.test(value||''))return '';const [y,m]=value.split('-').map(Number);return `${new Intl.DateTimeFormat('en-US',{month:'long'}).format(new Date(y,m-1,1))} ${y} CRMMS ESP`;}
function activeRunDisplayName(runKey='current'){return state.runDisplayNames?.[runKey] || meaningfulRdfName(runKey) || (runKey==='current'?'Run A':'Run B');}
function applyRunDisplayNames(){const a=activeRunDisplayName('current'),b=activeRunDisplayName('previous');document.querySelectorAll('#explorerRunA').forEach(()=>{});const la=document.querySelector('label[for="explorerRunA"]'); const source=document.getElementById('rdfSourceName');if(source)source.textContent=a;const sum=document.getElementById('rdfSourceSummary');if(sum){const files=state.rdfInspection?.current?.files?.length||0,slots=state.rdfInspection?.current?.slots?.length||0;sum.textContent=`${files} RDF file${files===1?'':'s'} · ${slots} discovered slots${state.rdfInspection?.previous?' · comparison session':''}`;}const runA=document.getElementById('explorerRunA')?.closest('label');if(runA)runA.querySelector('.checkbox-line').lastChild.textContent=` ${a}`;const runB=document.getElementById('explorerRunB')?.closest('label');if(runB)runB.querySelector('.checkbox-line').lastChild.textContent=` ${b}`;const sc=document.getElementById('slotCheckRun');if(sc){const oa=sc.querySelector('option[value="current"]'),ob=sc.querySelector('option[value="previous"]');if(oa)oa.textContent=a;if(ob)ob.textContent=b;}}
function renderRdfMetadata(){const body=document.getElementById('rdfMetadataBody');if(!body)return;const renderRun=(key,label)=>{const files=rdfDescriptions(key);if(!files.length)return '';return `<section class="rdf-meta-run"><h3>${escapeHtml(label)}</h3>${files.map(f=>`<details><summary>${escapeHtml(f.filename)}</summary><dl><dt>RDF name</dt><dd>${escapeHtml(f.name||'—')}</dd><dt>Owner</dt><dd>${escapeHtml(f.owner||'—')}</dd><dt>Description</dt><dd>${escapeHtml(f.description||'—')}</dd><dt>Created</dt><dd>${escapeHtml(f.create_date||'—')}</dd><dt>Runs</dt><dd>${escapeHtml(f.number_of_runs??'—')}</dd><dt>Slots</dt><dd>${escapeHtml(f.slot_count??'—')}</dd><dt>Timestep types</dt><dd>${escapeHtml((f.timestep_types||[]).join(', ')||'—')}</dd></dl></details>`).join('')}</section>`};body.innerHTML=renderRun('current',activeRunDisplayName('current'))+renderRun('previous',activeRunDisplayName('previous'));}
function openRdfMetadata(promptForName=false){renderRdfMetadata();const modal=document.getElementById('rdfMetadataModal');if(!modal)return;document.getElementById('rdfRunDisplayName').value=state.runDisplayNames.current||meaningfulRdfName('current')||'';modal.hidden=false;if(promptForName)document.getElementById('rdfRunMonth')?.focus();}
document.getElementById('openRdfMetadataButton')?.addEventListener('click',()=>openRdfMetadata(false));document.getElementById('editRunNameButton')?.addEventListener('click',()=>openRdfMetadata(true));document.getElementById('closeRdfMetadataButton')?.addEventListener('click',()=>document.getElementById('rdfMetadataModal').hidden=true);document.getElementById('rdfRunMonth')?.addEventListener('change',e=>{const name=formatRunMonth(e.target.value);if(name)document.getElementById('rdfRunDisplayName').value=name;});document.getElementById('saveRdfRunName')?.addEventListener('click',()=>{const name=document.getElementById('rdfRunDisplayName').value.trim();if(!name)return;state.runDisplayNames.current=name;applyRunDisplayNames();renderRdfMetadata();document.getElementById('rdfMetadataModal').hidden=true;renderExplorerPlot();renderExplorerTable();});

async function createExplorerSession() {
  const data = new FormData();
  data.set('current_label', document.getElementById('currentLabel').value || (state.workspaceMode === 'explore' ? 'Run' : 'Run A'));
  data.set('previous_label', document.getElementById('previousLabel').value || 'Run B');
  data.set('preload_json', JSON.stringify(currentExplorerPreload()));
  state.currentFiles.forEach(file => data.append('current_files', file));
  if (state.workspaceMode !== 'explore') state.previousFiles.forEach(file => data.append('previous_files', file));
  const response = await fetch('/api/rdf/session', {method:'POST', body:data});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || 'RDF discovery/session creation failed.');
  return payload;
}

document.getElementById('discoverRdfButton').addEventListener('click', async () => {
  const single = state.workspaceMode === 'explore';
  if (!state.currentFiles.length || (!single && !state.previousFiles.length)) {
    showError(single ? 'Select RDF files for the run before discovering slots.' : 'Select RDF files for both runs before discovering slots.');
    return;
  }
  hideError();
  const preserved = currentRdfConfiguration();
  setLoading(
    'Discovering RiverWare slots',
    'Reading RDF metadata and preparing the Explorer session. Only the core elevation slots are preloaded; other slots load automatically when selected.'
  );
  try {
    const payload = await createExplorerSession();
    state.rdfSessionId = payload.session_id;
    const current = payload.current || null, previous = payload.previous || null;
    state.rdfInspection = {current, previous};
    state.runDisplayNames.current = meaningfulRdfName('current');
    state.runDisplayNames.previous = meaningfulRdfName('previous');
    applyRunDisplayNames();
    setTimeout(()=>{ if(!state.runDisplayNames.current) openRdfMetadata(true); }, 250);
    state.rdfPreloaded = {
      current: new Set(payload.preloaded?.current || []),
      previous: new Set(payload.preloaded?.previous || [])
    };
    state.explorerSlotCache = new Map();
    const a = new Set((current?.slots || []).map(x => x.object_slot));
    const b = new Set((previous?.slots || []).map(x => x.object_slot));
    const union = [...new Set([...a, ...b])].sort();
    state.discoveredSlots = union;
    rdfSlotOptions.innerHTML = union.map(slot => `<option value="${escapeHtml(slot)}"></option>`).join('');
    populateExplorerSlotOptions(false);
    populateExplorerStackOptions();
    populateSlotCheckOptions();
    const restoringPortableProfile=Boolean(state.pendingPortableExplorerProfile);
    if (restoringPortableProfile) reapplyPendingPortableExplorerProfile();
    else applyExplorerSettings(state.explorerSettings);

    // If the saved primary slot is absent, select the first saved stack slot that
    // actually exists in this RDF set. The missing item remains in the profile.
    if(restoringPortableProfile) {
      const firstAvailable=(state.explorerStackItems || []).find(item=>union.includes(item.slot));
      if(firstAvailable && explorerSlot && [...explorerSlot.options].some(option=>option.value===firstAvailable.slot)) explorerSlot.value=firstAvailable.slot;
    }
    renderRdfMapping(preserved);
    renderAvailableRdfSlots();
    renderRdfPlotConfig();
    const cfg = normalizeRdfConfiguration(currentRdfConfiguration());
    const enabled = new Set(cfg.enabledInputs);
    const unavailableEnabled = rdfLogicalInputs.filter(([, logical]) => {
      if (!enabled.has(logical)) return false;
      const mapped = cfg.mapping[logical];
      return current && previous ? !(a.has(mapped) && b.has(mapped)) : !(a.has(mapped) || b.has(mapped));
    }).length;
    const preloadedUnion = new Set([...(payload.preloaded?.current || []), ...(payload.preloaded?.previous || [])]);
    const filesText = `${current?.files?.length || 0} Run A file(s)${previous ? `, ${previous?.files?.length || 0} Run B file(s)` : ''}`;
    rdfDiscoveryStatus.textContent = `${filesText} · ${union.length} slots discovered · ${preloadedUnion.size} Explorer slots preloaded${single ? '' : ` · ${cfg.enabledInputs.length} CRMMS inputs selected · ${unavailableEnabled} mapped input(s) need attention`}`;
    if (explorerCacheStatus) explorerCacheStatus.textContent =
      `${preloadedUnion.size} slots preloaded in this session. Other slots load automatically when selected, then stay cached.`;
    if (union.length) {
      dataExplorerSection.hidden = false;
      if (single) document.body.classList.add('explorer-focused');
      await loadExplorerSlot({silent:true,preserveStack:restoringPortableProfile});
      dataExplorerSection.scrollIntoView({behavior:'smooth', block:'start'});
    }
  } catch (error) {
    showError(error.message || 'RDF slot discovery failed.');
  } finally { clearLoading(); }
});


form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!canCompare()) return;
  hideError();
  const rdf = sourceFormat.value === 'rdf';
  setLoading('Analyzing CRMMS outputs', rdf
    ? 'Reading mapped RiverWare slots across the selected RDF files and calculating the selected-year metrics.'
    : 'Validating workbook sheets, calculating selected-year metrics, and building the comparison.');
  compareButton.disabled = true;
  const data = new FormData(form);
  data.set('source_format', sourceFormat.value);
  data.set('add_esp_year', document.getElementById('addEspYear').checked ? 'true' : 'false');
  if (rdf) {
    const rdfConfig = normalizeRdfConfiguration(currentRdfConfiguration());
    data.set('slot_mapping_json', JSON.stringify(currentSlotMapping()));
    data.set('selected_inputs_json', JSON.stringify(rdfConfig.enabledInputs));
    data.set('custom_slots_json', JSON.stringify(rdfConfig.customSlots));
    data.set('custom_slot_statistic', rdfConfig.customStatistic);
    data.set('custom_plots_json', JSON.stringify(rdfConfig.customPlots));
    state.currentFiles.forEach(file => data.append('current_files', file));
    state.previousFiles.forEach(file => data.append('previous_files', file));
  } else {
    data.append('current_file', state.currentFiles[0]);
    data.append('previous_file', state.previousFiles[0]);
  }
  try {
    const response = await fetch('/api/compare', { method: 'POST', body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || 'The comparison could not be completed.');
    state.result = payload;
    state.reportPlots = {};
    renderResults(payload);
    uploadSection.hidden = true;
    resultsSection.hidden = false;
    switchTab('overview');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showError(error.message || 'The comparison could not be completed.');
  } finally {
    clearLoading();
    compareButton.disabled = !canCompare();
  }
});

function renderResults(result) {
  const { meta, tables } = result;
  const summary = result.summary || {};
  document.getElementById('resultsTitle').textContent = `${meta.current_label} vs ${meta.previous_label}`;
  document.getElementById('resultsSubtitle').textContent = `EOCY ${meta.eocy_date} · Years ${meta.comparison_years.join(', ')} · ${meta.trace_count} traces`;
  const maxChangeText = tables.length ? (meta.max_change === 0 ? 'No change' : `${signed(meta.max_change)} pp`) : 'No table data';
  const req = Number(meta.selected_input_count ?? meta.required_input_count ?? meta.required_sheet_count ?? 0);
  const avail = Number(meta.available_selected_input_count ?? meta.available_input_count ?? req);
  const missingSelected = Number(meta.missing_selected_input_count ?? Math.max(0, req - avail));
  const excluded = Number(meta.excluded_input_count || 0);
  const validationParts = [];
  if (missingSelected) validationParts.push(`${missingSelected} selected unavailable`);
  if (excluded) validationParts.push(`${excluded} intentionally excluded`);
  if (!validationParts.length) validationParts.push(`${meta.trace_count} traces · ${(meta.source_format || 'xlsx').toUpperCase()}`);
  const validationFoot = validationParts.join(' · ');
  document.getElementById('kpiGrid').innerHTML = [
    kpi('Lake Powell EOCY', summary.powell ? `${fmtNumber(summary.powell.current.min, 2)}–${fmtNumber(summary.powell.current.max, 2)} ft` : 'Unavailable', summary.powell ? `${meta.current_label} projected range` : 'Required elevation input not available', 'water'),
    kpi('Lake Mead EOCY', summary.mead ? `${fmtNumber(summary.mead.current.min, 2)}–${fmtNumber(summary.mead.current.max, 2)} ft` : 'Unavailable', summary.mead ? `${meta.current_label} projected range` : 'Required elevation input not available', 'water'),
    kpi('Largest table shift', maxChangeText, tables.length ? meta.max_change_label : 'No comparison tables could be calculated', 'change'),
    kpi('Selected input availability', `${avail}/${req} selected inputs`, validationFoot, 'check')
  ].join('');
  renderOverview(result);
  renderTableSection('powell', tables.filter(t => t.section === 'powell'), 'Lake Powell metrics', 'Operating tiers, release scenarios, and elevation thresholds.', meta);
  renderTableSection('mead', tables.filter(t => t.section === 'mead'), 'Lake Mead metrics', 'DCP, shortage, and elevation threshold comparisons.', meta);
  renderFlows(result.flow_analysis || {}, meta);
  renderCustomSlotSection(result);
  renderReportBuilder(result);
}
function partialBanner(meta) {
  if (!meta.partial_report) return '';
  const skipped = meta.skipped_sections || [];
  const missingSelected = meta.missing_selected_inputs || meta.missing_inputs || [];
  const excluded = meta.excluded_inputs || [];
  const custom = Boolean(meta.custom_input_selection);
  const items = skipped.map(x => {
    const tag = x.omission_type === 'excluded' ? 'Excluded by selection' : 'Unavailable source data';
    return `<li><strong>${escapeHtml(x.title || x.id)}</strong> <span class="omission-tag">${escapeHtml(tag)}</span> — ${escapeHtml(x.reason || 'Required input unavailable')}</li>`;
  }).join('');
  const title = custom && !missingSelected.length ? 'Custom report selection' : custom ? 'Custom report with unavailable inputs' : 'Partial report generated';
  const body = custom
    ? `The report is using ${meta.selected_input_count} selected logical input${meta.selected_input_count === 1 ? '' : 's'}. Sections that depend on intentionally excluded inputs are omitted.${missingSelected.length ? ' Some selected inputs are also unavailable in the source RDFs.' : ''}`
    : 'The comparison continued even though some selected source inputs were unavailable. Only dependent tables, summaries, and plots were omitted.';
  const detailBits = [];
  if (excluded.length) detailBits.push(`${excluded.length} intentionally excluded input${excluded.length === 1 ? '' : 's'}`);
  if (missingSelected.length) detailBits.push(`${missingSelected.length} selected unavailable input${missingSelected.length === 1 ? '' : 's'}`);
  return `<div class="partial-banner">${icon('change')}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>${skipped.length ? `<details><summary>${skipped.length} omitted section${skipped.length === 1 ? '' : 's'}${detailBits.length ? ` · ${escapeHtml(detailBits.join(' · '))}` : ''}</summary><ul>${items}</ul></details>` : ''}</div></div>`;
}
function kpi(label, value, foot, iconName) {
  return `<article class="kpi-card"><div class="kpi-label"><span>${escapeHtml(label)}</span><span class="kpi-icon">${icon(iconName)}</span></div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-foot">${escapeHtml(foot)}</div></article>`;
}
function renderOverview(result) {
  const { meta, tables } = result;
  const summary = result.summary || {};
  const changes = [];
  for (const table of tables) table.rows[2].values.forEach((value, index) => { if (value !== 0) changes.push({ table: table.title, column: table.columns[index], value, unit: table.unit || '%' }); });
  changes.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const rows = changes.slice(0, 8).map(item => `<div class="change-row"><div><strong>${escapeHtml(item.table)}</strong><small>${escapeHtml(item.column)}</small></div>${deltaBadge(item.value, item.unit)}</div>`).join('') || `<div class="change-row"><div><strong>${tables.length ? 'No table changes' : 'No comparison tables available'}</strong><small>${tables.length ? 'All calculated percentages are unchanged.' : 'Tables that depend on unavailable inputs were omitted.'}</small></div><span class="delta-badge flat">${tables.length ? '0 pp' : '—'}</span></div>`;
  const rangeCards = [summary.powell ? rangeCard('Lake Powell', summary.powell, meta) : '', summary.mead ? rangeCard('Lake Mead', summary.mead, meta) : ''].join('');
  const rangeBlock = rangeCards || `<div class="section-empty-card"><strong>Projected elevation ranges unavailable</strong>The required Powell/Mead elevation inputs were not available for the selected EOCY period.</div>`;
  document.getElementById('panel-overview').innerHTML = `
    ${partialBanner(meta)}
    <div class="panel-heading"><div><h3>Executive summary</h3><p>Projected elevation ranges and the largest calculated table changes across the selected years.</p></div></div>
    <div class="summary-grid">${rangeBlock}</div>
    <div class="panel-heading" style="margin-top:22px"><div><h3>Largest changes</h3><p>${meta.changed_cells} calculated table cells changed from Run B.</p></div></div>
    <div class="change-list">${rows}</div>`;
}
function rangeCard(name, values, meta) {
  return `<article class="summary-card"><h4>${escapeHtml(name)} EOCY elevation range</h4><div class="range-comparison">
    <div class="range-block"><small>${escapeHtml(meta.previous_label)}</small><strong>${fmtNumber(values.previous.min,2)}–${fmtNumber(values.previous.max,2)} ft</strong></div>
    <div class="range-arrow">→</div><div class="range-block"><small>${escapeHtml(meta.current_label)}</small><strong>${fmtNumber(values.current.min,2)}–${fmtNumber(values.current.max,2)} ft</strong></div>
  </div></article>`;
}
function deltaBadge(value, unit = '%') {
  const cls = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const suffix = unit === '%' ? ' pp' : unit === 'count' ? '' : (unit ? ` ${unit}` : '');
  return `<span class="delta-badge ${cls}">${escapeHtml(signed(value))}${escapeHtml(suffix)}</span>`;
}
function renderTableSection(section, tables, title, subtitle, meta) {
  const skipped = (meta.skipped_sections || []).filter(x => x.kind === 'table' && x.section === section);
  const excludedCount = skipped.filter(x => x.omission_type === 'excluded').length;
  const notice = skipped.length ? `<div class="report-availability-note">${skipped.length} ${escapeHtml(section === 'powell' ? 'Powell' : 'Mead')} table${skipped.length === 1 ? '' : 's'} omitted${excludedCount ? ` · ${excludedCount} by your input selection` : ''}${skipped.length - excludedCount ? ` · ${skipped.length - excludedCount} from unavailable source data` : ''}.</div>` : '';
  const body = tables.length
    ? `<div class="table-stack">${tables.map(metricTable).join('')}</div>`
    : `<div class="section-empty-card"><strong>No ${escapeHtml(section === 'powell' ? 'Powell' : 'Mead')} tables selected/available</strong>Every table in this section depends on one or more inputs that were excluded or unavailable.</div>`;
  document.getElementById(`panel-${section}`).innerHTML = `<div class="panel-heading"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></div></div>${notice}${body}`;
}
function metricTable(table) {
  const head = table.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const body = table.rows.map(row => {
    const cells = row.values.map(value => {
      let cls = '';
      if (row.kind === 'difference') cls = value > 0 ? 'diff-up' : value < 0 ? 'diff-down' : 'diff-flat';
      const display = row.kind === 'difference' ? signed(value) : fmtNumber(value);
      const suffix = table.unit === '%' ? (row.kind === 'difference' ? ' pp' : '%') : '';
      return `<td class="${cls}">${escapeHtml(display)}${escapeHtml(suffix)}</td>`;
    }).join('');
    return `<tr class="${row.kind === 'difference' ? 'diff-row' : ''}"><td>${escapeHtml(row.label)}</td>${cells}</tr>`;
  }).join('');
  return `<article class="metric-card"><div class="metric-card-head"><h4>${escapeHtml(table.title)}</h4><p>${escapeHtml(table.subtitle)}</p></div><div class="table-scroll"><table><thead><tr><th>Run</th>${head}</tr></thead><tbody>${body}</tbody></table></div></article>`;
}
function customSlotMetricTable(table) {
  const head = table.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const digits = Number.isInteger(table.display_decimals) ? table.display_decimals : 2;
  const body = table.rows.map(row => {
    const cells = row.values.map(value => {
      if (value == null || Number.isNaN(Number(value))) return '<td>—</td>';
      const num = Number(value);
      const cls = row.kind === 'difference' ? (num > 0 ? 'diff-up' : num < 0 ? 'diff-down' : 'diff-flat') : '';
      const display = row.kind === 'difference' ? `${num > 0 ? '+' : ''}${fmtNumber(num, digits)}` : fmtNumber(num, digits);
      return `<td class="${cls}">${escapeHtml(display)}</td>`;
    }).join('');
    return `<tr class="${row.kind === 'difference' ? 'diff-row' : ''}"><td>${escapeHtml(row.label)}</td>${cells}</tr>`;
  }).join('');
  const subtitle = [table.subtitle, table.unit ? `Units: ${table.unit}` : '', table.scale_label ? `Scale: ${table.scale_label}` : '', table.timestep_label ? `Timestep: ${table.timestep_label}` : '', table.trace_count ? `${table.trace_count} traces` : ''].filter(Boolean).join(' · ');
  return `<article class="metric-card custom-slot-summary-card"><div class="metric-card-head"><h4 title="${escapeHtml(table.slot || table.title)}">${escapeHtml(table.title)}</h4><p class="metric-subtitle">${escapeHtml(subtitle)}</p></div><div class="table-scroll"><table><thead><tr><th>Run</th>${head}</tr></thead><tbody>${body}</tbody></table></div></article>`;
}
function renderCustomSlotSection(result) {
  const button = document.getElementById('customSlotsTabButton');
  const panel = document.getElementById('panel-slots');
  if (!button || !panel) return;
  const tables = result.custom_slot_tables || [];
  const requested = result.meta.custom_slots || [];
  const skipped = result.meta.custom_slot_skipped || [];
  const show = requested.length > 0 || tables.length > 0 || skipped.length > 0;
  button.hidden = !show;
  if (!show) { panel.innerHTML = ''; return; }
  const notice = skipped.length ? `<div class="report-availability-note">${skipped.length} selected RDF slot comparison${skipped.length === 1 ? '' : 's'} could not be calculated. ${escapeHtml(skipped.map(x => x.slot).join(', '))}</div>` : '';
  const body = tables.length ? `<div class="table-stack">${tables.map(customSlotMetricTable).join('')}</div>` : `<div class="section-empty-card"><strong>No additional slot tables available</strong>The selected slots were not present in both runs, did not contain values for the selected years/traces, or were otherwise incompatible for a generic comparison.</div>`;
  panel.innerHTML = `<div class="panel-heading"><div><h3>Selected RDF slots</h3><p>Generic comparisons for additional RiverWare <code>Object.Slot</code> values you selected after RDF discovery. These are separate from the established CRMMS derived metrics.</p></div></div>${notice}${body}`;
}

function renderFlows(flow, meta) {
  const panel = document.getElementById('panel-flows');
  const powell = flow.powell_inflow || [];
  const mead = flow.mead_flow || [];
  const lower = flow.lower_basin_conditions || [];
  const order = flow.condition_order || [];
  const powellCharts = powell.map(series => traceBarCard(series)).join('');
  const meadCharts = mead.map(series => meadFlowCard(series)).join('');
  const lowerChart = lower.length ? conditionCard(lower, order, meta) : '';
  const charts = `${powellCharts}${meadCharts}${lowerChart}`;
  const skippedPlots = (meta.skipped_sections || []).filter(x => x.kind === 'plot');
  const excludedPlots = skippedPlots.filter(x => x.omission_type === 'excluded').length;
  const notice = skippedPlots.length ? `<div class="report-availability-note">${skippedPlots.length} plot group${skippedPlots.length === 1 ? '' : 's'} omitted${excludedPlots ? ` · ${excludedPlots} by your input selection` : ''}${skippedPlots.length - excludedPlots ? ` · ${skippedPlots.length - excludedPlots} from unavailable source data` : ''}.</div>` : '';
  panel.innerHTML = `<div class="panel-heading"><div><h3>Flow analysis</h3><p>Interactive trace context. The Report Builder uses a separate publication renderer that mirrors the source Word report.</p></div></div>${notice}<div class="chart-stack">${charts || `<div class="section-empty-card"><strong>No flow plots available</strong>The report can still be generated with any available summary and table sections.</div>`}</div>`;
}
function traceBarCard(series) {
  const sorted = [...series.points].sort((a,b) => a.inflow-b.inflow);
  const max = Math.max(series.historic_p90 * 1.08, ...sorted.map(p => p.inflow));
  const legends = [...new Set(sorted.map(p => p.tier))].map(k => legend(k, palette[k] || palette.Unavailable)).join('');
  const bars = sorted.map(p => `<div class="bar-column"><div class="bar" style="height:${Math.max(1,p.inflow/max*100)}%;background:${palette[p.tier] || palette.Unavailable}"><span class="chart-tooltip">${escapeHtml(p.trace_label || p.trace_year)}<br>RiverWare trace ${escapeHtml(p.trace_number ?? p.trace)}<br>${fmtNumber(p.inflow,0)} KAF<br>${escapeHtml(p.tier)}</span></div><span class="bar-label">${escapeHtml(p.trace_label || p.trace_year)}</span></div>`).join('');
  const refs = [
    {v:series.historic_p90,label:'Historic 90th',cls:''},{v:series.historic_average,label:'Historic avg',cls:'avg'},{v:series.historic_p10,label:'Historic 10th',cls:''}
  ].map(r => `<div class="reference-line ${r.cls}" style="bottom:${r.v/max*100}%"><span>${r.label}</span></div>`).join('');
  return `<article class="chart-card"><div class="chart-head"><div><h4>Powell unregulated inflow · ${series.inflow_year}</h4><p>Sorted like the report; bars are colored by WY ${series.operating_year} operating tier.</p></div><div class="chart-legend">${legends}</div></div><div class="bar-chart-scroll"><div class="bar-chart">${refs}${bars}</div></div></article>`;
}
function meadFlowCard(series) {
  const sorted = [...series.points].sort((a,b) => a.inflow-b.inflow);
  const max = Math.max(...sorted.flatMap(p => [p.inflow,p.outflow]), 1);
  const bars = sorted.map(p => `<div class="flow-group"><div class="flow-bar in" style="height:${Math.max(1,p.inflow/max*100)}%;background:${palette[p.condition] || palette.Unavailable}"><span class="chart-tooltip">${escapeHtml(p.trace_label || p.trace_year)}<br>RiverWare trace ${escapeHtml(p.trace_number ?? p.trace)}<br>Inflow ${fmtNumber(p.inflow,0)} KAF<br>${escapeHtml(p.condition)}</span></div><div class="flow-bar out" style="height:${Math.max(1,p.outflow/max*100)}%;background:${palette[p.condition] || palette.Unavailable}"><span class="chart-tooltip">${escapeHtml(p.trace_label || p.trace_year)}<br>RiverWare trace ${escapeHtml(p.trace_number ?? p.trace)}<br>Outflow ${fmtNumber(p.outflow,0)} KAF<br>${escapeHtml(p.condition)}</span></div></div>`).join('');
  return `<article class="chart-card"><div class="chart-head"><div><h4>Lake Mead annual flows · ${series.flow_year}</h4><p>Annual inflow/outflow by hydrologic trace; operating condition is CY ${series.condition_year}.</p></div></div><div class="bar-chart-scroll"><div class="flow-pair-chart">${bars}</div></div></article>`;
}
function legend(label, color) { return `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${escapeHtml(label)}</span>`; }
function conditionCard(years, order, meta) {
  const columns = years.map(item => `<div class="condition-year"><strong>${item.year}</strong><div class="condition-pair">${stackColumn(item.current, order, meta.trace_count)}${stackColumn(item.previous, order, meta.trace_count)}</div><div class="stack-labels"><span>${escapeHtml(meta.current_label)}</span><span>${escapeHtml(meta.previous_label)}</span></div></div>`).join('');
  return `<article class="chart-card"><div class="chart-head"><div><h4>Lower Basin operating condition</h4><p>Number of traces by annual operating condition.</p></div><div class="chart-legend">${order.map(k => legend(k, palette[k])).join('')}</div></div><div class="condition-grid">${columns}</div></article>`;
}
function stackColumn(counts, order, traceCount = 30) {
  const denominator = Math.max(Number(traceCount) || 30, 1);
  return `<div class="stack-column">${order.map(key => `<div class="stack-segment" title="${escapeHtml(key)}: ${counts[key] || 0}" style="height:${(counts[key] || 0)/denominator*100}%;background:${palette[key]}"></div>`).join('')}</div>`;
}

function switchTab(name) {
  document.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
}
document.querySelectorAll('.tab-button').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.getElementById('openReportBuilderButton').addEventListener('click', () => { switchTab('report'); document.getElementById('panel-report').scrollIntoView({behavior:'smooth', block:'start'}); });

document.getElementById('newComparisonButton').addEventListener('click', () => {
  resultsSection.hidden = true;
  uploadSection.hidden = false;
  uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('exportJsonButton').addEventListener('click', () => {
  if (!state.result) return;
  downloadBlob(new Blob([JSON.stringify(state.result, null, 2)], { type: 'application/json' }), `crmms-comparison-${state.result.meta.eocy_year}.json`);
});

function tableYearOptions(table) {
  const years = [];
  for (const column of (table.columns || [])) {
    const match = String(column).match(/^\s*(20\d{2}|21\d{2})(?:\b|\s)/);
    if (match && !years.includes(match[1])) years.push(match[1]);
  }
  return years;
}
function defaultCustomDetailLine(table) {
  return [
    table.subtitle,
    table.unit ? `Units: ${table.unit}` : '',
    table.scale_label ? `Scale: ${table.scale_label}` : '',
    table.timestep_label ? `Timestep: ${table.timestep_label}` : '',
    table.trace_count ? `${table.trace_count} traces` : ''
  ].filter(Boolean).join(' · ');
}
function renderReportBuilder(result) {
  const reportTables = [...(result.tables || []), ...(result.custom_slot_tables || [])];
  const tableBlocks = reportTables.map(table => {
    const years = tableYearOptions(table);
    const yearControls = years.length ? `
      <div class="table-year-controls" data-table-id="${escapeHtml(table.id)}">
        <div class="table-year-heading"><span><strong>Years shown in this table</strong><small>Uncheck any year you do not want in the Word report.</small></span><span class="table-year-actions"><button class="mini-button year-action" data-action="first" type="button">Toggle first</button><button class="mini-button year-action" data-action="last" type="button">Toggle last</button><button class="mini-button year-action" data-action="all" type="button">All years</button></span></div>
        <div class="table-year-chips">${years.map(year => `<label><input class="table-year-check" type="checkbox" value="${year}" checked /> ${year}</label>`).join('')}</div>
      </div>` : '';
    const customText = table.section === 'custom' ? `
      <div class="custom-table-copy">
        <label>Report title<input class="table-title-override" type="text" value="${escapeHtml(table.slot || table.title || '')}" placeholder="Meaningful title for this slot" /></label>
        <label>Description / line below title<textarea class="table-subtitle-override" rows="2" placeholder="Optional explanatory line">${escapeHtml(defaultCustomDetailLine(table))}</textarea></label>
      </div>` : '';
    return `
    <div class="report-note-card" data-table-id="${escapeHtml(table.id)}">
      <div class="report-note-heading">
        <label class="check-line"><input class="include-table" type="checkbox" value="${escapeHtml(table.id)}" checked /> <span>Include</span></label>
        <strong>${escapeHtml(table.title)}</strong>
      </div>
      ${customText}
      ${yearControls}
      <textarea class="table-note" rows="2" placeholder="Optional notes below this table — one bullet per line"></textarea>
    </div>`;
  }).join('');
  const flow = result.flow_analysis || {};
  const hasPowell = (flow.powell_inflow || []).length > 0;
  const hasMead = (flow.mead_flow || []).length > 0;
  const hasLower = (flow.lower_basin_conditions || []).length > 0;
  const skipped = result.meta.skipped_sections || [];
  const availabilityNote = skipped.length
    ? `<div class="report-availability-note"><strong>Selected report scope:</strong> ${skipped.length} report section${skipped.length === 1 ? '' : 's'} will be omitted because its required inputs were excluded or unavailable. The Word report will be generated from the sections shown below.</div>`
    : '';
  const plotCard = (value, title, years, available, detail='') => `<label class="check-card ${available ? '' : 'is-unavailable'}"><input type="checkbox" class="include-plot" value="${escapeHtml(value)}" ${available ? 'checked' : 'disabled'} /><span><strong>${escapeHtml(title)}</strong><small>${available ? escapeHtml(detail || years.join(', ')) : 'Unavailable from selected inputs'}</small></span></label>`;
  const customPlotCards = (result.custom_slot_plots || []).map(plot => plotCard(
    plot.id,
    plot.title || plot.slot,
    plot.years || [],
    true,
    `${String(plot.plot_type || 'line').replace(/^./, c => c.toUpperCase())} · ${plot.aggregation === 'annual_flag_sum' ? 'yearly flag sum' : plot.transform === 'water_year_sum' ? 'water-year sum by trace' : plot.transform === 'calendar_year_sum' ? 'calendar-year sum by trace' : plot.transform === 'annual_raw' ? 'annual values by trace' : 'raw timestep values'} · ${(plot.years || []).join(', ')}`
  )).join('');
  const reportOrderEntries = [
    ...reportTables.map(table => ({key:`table:${table.id}`, label:`Table · ${table.title}`})),
    ...(hasPowell ? [{key:'plot:powell',label:'Plot group · Powell inflow'}] : []),
    ...(hasMead ? [{key:'plot:mead',label:'Plot group · Mead inflow/outflow'}] : []),
    ...(hasLower ? [{key:'plot:lower-basin',label:'Plot · Lower Basin conditions'}] : []),
    ...(result.custom_slot_plots || []).map(plot => ({key:`plot:${plot.id}`,label:`Plot · ${plot.title || plot.slot}`}))
  ];
  const reportOrderHtml = reportOrderEntries.map(item => `<div class="report-order-item" draggable="true" data-section-key="${escapeHtml(item.key)}"><span class="report-order-handle">⋮⋮</span><span>${escapeHtml(item.label)}</span></div>`).join('');
  document.getElementById('panel-report').innerHTML = `
    <div class="panel-heading report-builder-heading"><div><h3>Word Report Builder</h3><p>Configure narrative text, table titles/descriptions, visible years and plots, then re-render the preview whenever you make changes.</p></div><span class="word-badge">DOCX</span></div>
    ${availabilityNote}
    <div class="report-builder-grid">
      <aside class="report-controls">
        <section class="builder-section">
          <div class="builder-section-title"><span>1</span><div><strong>Report header</strong><small>Text that appears before the comparison tables.</small></div></div>
          <label>Report title<input id="reportTitle" type="text" value="CRMMS ESP Summary" /></label>
          <label>Report template<select id="reportTemplate" class="report-template-select"><option value="standard" selected>Standard CRMMS</option><option value="compact">Compact</option><option value="large_charts">Large charts</option></select></label>
          <label>Report period<input id="reportPeriod" type="text" value="${escapeHtml(defaultReportPeriod(result.meta))}" placeholder="February 2026" /></label>
          <label>Opening paragraph<textarea id="introText" rows="3" placeholder="Leave blank to use the standard CRMMS ESP sentence."></textarea></label>
          <label>Notes and assumptions<textarea id="assumptionsText" rows="5" placeholder="One bullet per line"></textarea></label>
        </section>
        <section class="builder-section">
          <div class="builder-section-title"><span>2</span><div><strong>Tables & notes</strong><small>Rename additional RDF slots, edit their description, and choose exactly which years appear in each table.</small></div></div>
          <div class="table-note-list">${tableBlocks || `<div class="section-empty-card"><strong>No comparison tables available</strong>You can still generate a report containing the report header, assumptions, any available EOCY summary, and plots.</div>`}</div>
        </section>
        <section class="builder-section">
          <div class="builder-section-title"><span>3</span><div><strong>Plots</strong><small>Includes the standard CRMMS plots plus any RDF slot plots configured before comparison.</small></div></div>
          <div class="plot-choice-grid">
            ${plotCard('powell', 'Powell inflow', result.meta.powell_plot_years || [], hasPowell)}
            ${plotCard('mead', 'Mead inflow/outflow', result.meta.mead_plot_years || [], hasMead)}
            ${plotCard('lower-basin', 'Lower Basin conditions', result.meta.lower_basin_years || [], hasLower)}
            ${customPlotCards}
          </div>
          <label>Lower Basin caption<textarea id="lowerBasinCaption" rows="3">Note: For modeling purposes, these projections assume a continuation of the Interim Guidelines, DCP and Minute 323 beyond 2026. These agreements expire at the end of 2026, and Reclamation is beginning a process to develop operating strategies for post-2026.</textarea></label>
          <label class="check-line metadata-check"><input type="checkbox" id="includeMetadata" /> Include a visible Report Metadata page</label>
        </section>
        <section class="builder-section">
          <div class="builder-section-title"><span>4</span><div><strong>Report section order</strong><small>Drag tables and plot groups into the order you want them to appear in the Word report.</small></div></div>
          <div id="reportOrderList" class="report-order-list">${reportOrderHtml}</div>
        </section>
        <section class="builder-section builder-actions">
          <button class="secondary-button" id="previewReportButton" type="button">Re-render report preview</button>
          <button class="primary-button" id="downloadReportButton" type="button">Download Word report</button>
          <div class="config-actions"><button class="text-button" id="saveSettingsButton" type="button">Export configuration JSON</button><button class="text-button" id="loadSettingsButton" type="button">Import configuration JSON</button></div><small class="config-json-help">The JSON stores RDF mappings/selections, years, report text, table-year visibility, notes and custom plot definitions. RDF source files are not embedded.</small>
          <div class="report-error" id="reportError" hidden></div>
        </section>
      </aside>
      <section class="report-preview-wrap">
        <div class="preview-toolbar"><div><strong>Report preview</strong><small>Rendered automatically from the current comparison. After editing settings, click Re-render report preview.</small></div><span id="previewStatus">Rendering…</span></div>
        <div id="reportPreview" class="word-preview"><div class="empty-preview"><strong>Rendering preview…</strong><p>The report tables appear immediately; report-quality plots are being generated on the server.</p></div></div>
      </section>
    </div>`;
  document.getElementById('previewReportButton').addEventListener('click', () => previewReport());
  document.getElementById('downloadReportButton').addEventListener('click', downloadReport);
  document.getElementById('saveSettingsButton').addEventListener('click', saveSettings);
  document.getElementById('loadSettingsButton').addEventListener('click', () => document.getElementById('settingsFileInput').click());
  const orderList=document.getElementById('reportOrderList');
  orderList?.querySelectorAll('.report-order-item').forEach(item=>{
    item.addEventListener('dragstart',()=>item.classList.add('dragging'));
    item.addEventListener('dragend',()=>{item.classList.remove('dragging');markReportPreviewDirty();});
  });
  orderList?.addEventListener('dragover',event=>{
    event.preventDefault(); const dragging=orderList.querySelector('.dragging'); if(!dragging)return;
    const after=[...orderList.querySelectorAll('.report-order-item:not(.dragging)')].find(el=>event.clientY < el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
    if(after)orderList.insertBefore(dragging,after);else orderList.appendChild(dragging);
  });
  document.querySelectorAll('.year-action').forEach(button => button.addEventListener('click', () => {
    const controls = button.closest('.table-year-controls');
    const checks = [...controls.querySelectorAll('.table-year-check')];
    if (!checks.length) return;
    if (button.dataset.action === 'all') checks.forEach(check => { check.checked = true; });
    if (button.dataset.action === 'first') checks[0].checked = !checks[0].checked;
    if (button.dataset.action === 'last') checks[checks.length - 1].checked = !checks[checks.length - 1].checked;
    if (!checks.some(check => check.checked)) checks[0].checked = true;
    markReportPreviewDirty();
  }));
  document.querySelector('.report-controls')?.addEventListener('input', markReportPreviewDirty);
  document.querySelector('.report-controls')?.addEventListener('change', event => {
    if (event.target.classList.contains('table-year-check')) {
      const group = event.target.closest('.table-year-controls');
      const checks = [...group.querySelectorAll('.table-year-check')];
      if (!checks.some(check => check.checked)) event.target.checked = true;
    }
    markReportPreviewDirty();
  });
  if (state.pendingReportSettings) applyReportSettings(state.pendingReportSettings);
  // Show a useful preview without requiring the user to click anything. Plot
  // rendering is quiet so it does not interrupt the results screen while the
  // user is still reviewing comparison outputs.
  setTimeout(() => previewReport({quiet:true}), 0);
}

function defaultReportPeriod(meta) {
  const labels = String(meta.current_label || '').trim();
  if (/^[A-Za-z]+$/.test(labels)) return `${labels} ${meta.eocy_year}`;
  return `${meta.current_label} ${meta.eocy_year}`.trim();
}
function collectReportSettings() {
  const tableNotes = {};
  const tableTitles = {};
  const tableSubtitles = {};
  const tableYears = {};
  document.querySelectorAll('.report-note-card').forEach(card => {
    const id = card.dataset.tableId;
    const note = card.querySelector('.table-note').value;
    tableNotes[id] = lines(note);
    const title = card.querySelector('.table-title-override');
    const subtitle = card.querySelector('.table-subtitle-override');
    if (title) tableTitles[id] = title.value.trim();
    if (subtitle) tableSubtitles[id] = subtitle.value.trim();
    const yearChecks = [...card.querySelectorAll('.table-year-check')];
    if (yearChecks.length) tableYears[id] = yearChecks.filter(x => x.checked).map(x => x.value);
  });
  return {
    report_title: document.getElementById('reportTitle').value.trim() || 'CRMMS ESP Summary',
    report_period: document.getElementById('reportPeriod').value.trim(),
    intro_text: document.getElementById('introText').value.trim(),
    assumptions: lines(document.getElementById('assumptionsText').value),
    table_notes: tableNotes,
    table_titles: tableTitles,
    table_subtitles: tableSubtitles,
    table_years: tableYears,
    included_tables: [...document.querySelectorAll('.include-table:checked')].map(x => x.value),
    included_plots: [...document.querySelectorAll('.include-plot:checked')].map(x => x.value),
    lower_basin_caption: document.getElementById('lowerBasinCaption').value.trim(),
    include_metadata: document.getElementById('includeMetadata').checked,
    template_style: document.getElementById('reportTemplate')?.value || 'standard',
    section_order: [...document.querySelectorAll('#reportOrderList .report-order-item')].map(x => x.dataset.sectionKey)
  };
}
function markReportPreviewDirty() {
  const status = document.getElementById('previewStatus');
  if (status && status.textContent !== 'Rendering…') status.textContent = 'Changes not rendered';
}
async function previewReport({quiet=false} = {}) {
  if (!state.result) return;
  const error = document.getElementById('reportError');
  error.hidden = true;
  const settings = collectReportSettings();
  renderWordPreview(settings);
  const status = document.getElementById('previewStatus');
  if (status) status.textContent = 'Rendering…';
  if (!quiet) setLoading('Rendering report preview', 'Generating report-quality Matplotlib images and assembling the preview.');
  try {
    const response = await fetch('/api/report/plots', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({result:state.result, lower_basin_caption:settings.lower_basin_caption}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || 'The report plots could not be rendered.');
    state.reportPlots = payload.plots || {};
    renderWordPreview(settings);
    if (status) status.textContent = 'Preview updated';
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    if (status) status.textContent = 'Preview updated · plots unavailable';
  } finally { if (!quiet) clearLoading(); }
}
function filteredPreviewTable(table, selectedYears) {
  if (!Array.isArray(selectedYears)) return table;
  const allowed = new Set(selectedYears.map(String));
  const indexes = (table.columns || []).map((column, index) => {
    const match = String(column).match(/^\s*(20\d{2}|21\d{2})(?:\b|\s)/);
    return (!match || allowed.has(match[1])) ? index : -1;
  }).filter(index => index >= 0);
  if (!indexes.length) return null;
  return {
    ...table,
    columns: indexes.map(index => table.columns[index]),
    rows: (table.rows || []).map(row => ({...row, values:indexes.map(index => row.values[index])}))
  };
}
function reportTablePreview(table, settings) {
  const visible = filteredPreviewTable(table, settings.table_years?.[table.id]);
  if (!visible) return '<p class="preview-slot-meta">No years selected for this table.</p>';
  const head = visible.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const custom = visible.section === 'custom';
  const digits = Number.isInteger(visible.display_decimals) ? visible.display_decimals : 2;
  const rows = visible.rows.map(row => `<tr><th>${escapeHtml(row.label)}</th>${row.values.map(v => {
    if (v == null || Number.isNaN(Number(v))) return '<td>—</td>';
    if (custom) {
      const num = Number(v);
      const display = row.kind === 'difference' ? `${num > 0 ? '+' : ''}${fmtNumber(num, digits)}` : fmtNumber(num, digits);
      return `<td>${escapeHtml(display)}</td>`;
    }
    return `<td>${escapeHtml(row.kind === 'difference' ? signed(v) : v)}</td>`;
  }).join('')}</tr>`).join('');
  let caption = '';
  if (custom) {
    const detail = Object.prototype.hasOwnProperty.call(settings.table_subtitles || {}, visible.id)
      ? settings.table_subtitles[visible.id]
      : defaultCustomDetailLine(visible);
    caption = detail ? `<p class="preview-slot-meta">${escapeHtml(detail)}</p>` : '';
  } else if (visible.unit === 'count') {
    const detail = settings.table_subtitles?.[visible.id] ?? visible.subtitle ?? 'Annual flag count';
    caption = detail ? `<p class="preview-slot-meta">${escapeHtml(detail)}</p>` : '';
  }
  return `${caption}<table class="word-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
function renderWordPreview(settings) {
  const {meta} = state.result;
  const tables = [...(state.result.tables || []), ...(state.result.custom_slot_tables || [])];
  const summary = state.result.summary || {};
  const chosen = new Set(settings.included_tables);
  const sectionMap=new Map();
  for(const t of tables){
    if(!chosen.has(t.id))continue;
    const notes=(settings.table_notes[t.id]||[]).map(n=>`<li>${escapeHtml(n)}</li>`).join('');
    sectionMap.set(`table:${t.id}`,`<section class="preview-block"><p class="preview-table-title">${escapeHtml(reportTitleFor(t,meta,settings))}</p>${reportTablePreview(t,settings)}${notes?`<ul class="preview-notes">${notes}</ul>`:''}</section>`);
  }
  const plotGroupMap=new Map();
  if(settings.included_plots.includes('powell'))plotGroupMap.set('plot:powell',Object.keys(state.reportPlots).filter(k=>k.startsWith('powell-')).sort().map(k=>`<img class="preview-plot" src="${state.reportPlots[k]}" alt="${escapeHtml(k)}" />`).join(''));
  if(settings.included_plots.includes('mead'))plotGroupMap.set('plot:mead',Object.keys(state.reportPlots).filter(k=>k.startsWith('mead-')).sort().map(k=>`<img class="preview-plot" src="${state.reportPlots[k]}" alt="${escapeHtml(k)}" />`).join(''));
  if(settings.included_plots.includes('lower-basin')&&state.reportPlots['lower-basin'])plotGroupMap.set('plot:lower-basin',`<img class="preview-plot" src="${state.reportPlots['lower-basin']}" alt="lower-basin" />`);
  for(const plot of(state.result.custom_slot_plots||[])){if(settings.included_plots.includes(plot.id)&&state.reportPlots[plot.id])plotGroupMap.set(`plot:${plot.id}`,`<img class="preview-plot" src="${state.reportPlots[plot.id]}" alt="${escapeHtml(plot.id)}" />`);}
  for(const [k,v] of plotGroupMap)sectionMap.set(k,`<section class="preview-block preview-plot-stack">${v}</section>`);
  const defaultOrder=[...tables.map(t=>`table:${t.id}`),...plotGroupMap.keys()];
  const order=Array.isArray(settings.section_order)&&settings.section_order.length?[...settings.section_order]:defaultOrder;
  defaultOrder.forEach(k=>{if(!order.includes(k))order.push(k);});
  const orderedHtml=order.map(k=>sectionMap.get(k)||'').join('');
  const assumptions = settings.assumptions.map(x => `<li>${escapeHtml(x)}</li>`).join('');
  const opening = settings.intro_text || `The ${settings.report_period || meta.current_label} CRMMS ESP results are attached and summarized below:`;
  const elevationLines = [];
  if (summary.powell) elevationLines.push(`<li>Lake Powell EOCY ${meta.eocy_year} range: ${fmtNumber(summary.powell.current.min,2)} feet - ${fmtNumber(summary.powell.current.max,2)} feet</li>`);
  if (summary.mead) elevationLines.push(`<li>Lake Mead EOCY ${meta.eocy_year} range: ${fmtNumber(summary.mead.current.min,2)} feet - ${fmtNumber(summary.mead.current.max,2)} feet</li>`);
  const elevationBlock = elevationLines.length ? `<ul><li>Projected Elevations:<ul>${elevationLines.join('')}</ul></li></ul>` : '';
  document.getElementById('reportPreview').className = `word-preview template-${escapeHtml(settings.template_style||'standard')}`;
  document.getElementById('reportPreview').innerHTML = `<article class="paper-sheet"><h1>${escapeHtml(settings.report_title)}</h1><p>${escapeHtml(opening)}</p>${elevationBlock}${assumptions?`<h3>Notes and Assumptions</h3><ul>${assumptions}</ul>`:''}${orderedHtml}</article>`;
}
function reportTitleFor(table, meta, settings={}) {
  if (settings.table_titles?.[table.id]) return settings.table_titles[table.id];
  if (table.section === 'custom') return table.slot || table.title;
  if (table.unit === 'count') return `${table.title}:`;
  const map = {
    'powell-operating-tier': `% of Traces per Powell Operating Tier in WY ${meta.powell_operating_year}:`,
    'powell-release-volume': '% Traces in Powell Annual Release Volume Scenario:',
    'powell-3500-adjustment': '% Traces with Powell Release Adjustment to Avoid Declining Below 3,500 ft during the CY:',
    'powell-3500-less-748': '% Traces with Powell Release Adjustment to Avoid Declining Below 3,500 ft during the CY and Powell release less than 7.48 maf:',
    'powell-3525': '% Traces with Powell Elevation below the Upper Basin DCP Trigger elevation of 3,525 ft in any month during the CY:',
    'powell-3490': '% Traces with Powell Elevation below Minimum Power Pool in any month during the CY:',
    'mead-1090': '% Traces with Lower Basin DCP (Lake Mead Elevation <= 1,090 ft on January 1):',
    'mead-1075': '% Traces with Lower Basin Shortage - Any Condition (Lake Mead Elevation <= 1,075 ft on January 1):',
    'mead-1050': '% Traces with Lower Basin Shortage (Lake Mead Elevation <= 1,050 ft on January 1):',
    'mead-1045': '% Traces with Lower Basin Shortage (Lake Mead Elevation <= 1,045 ft on January 1):',
    'mead-1035': '% Traces with Lake Mead Elevation < 1,035 ft:',
    'mead-1025': '% Traces with Lower Basin Shortage (Lake Mead Elevation <= 1,025 ft on January 1):',
    'mead-1000': '% Traces with Lake Mead Elevation < 1,000 ft in any month:',
    'mead-950': '% Traces with Lake Mead Elevation <= 950 ft in any month:',
    'mead-895': '% Traces with Lake Mead Elevation <= 895 ft in any month:'
  };
  return map[table.id] || table.title;
}
async function downloadReport() {
  if (!state.result) return;
  const error = document.getElementById('reportError');
  error.hidden = true;
  setLoading('Building Word report', 'Creating the .docx, formatting tables, and embedding publication-quality plots.');
  try {
    const settings = collectReportSettings();
    const response = await fetch('/api/report', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({result:state.result, settings}) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || 'The Word report could not be generated.');
    }
    const blob = await response.blob();
    const cd = response.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^";]+)"?/i);
    downloadBlob(blob, match ? match[1] : 'CRMMS-ESP-Summary.docx');
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally { clearLoading(); }
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function buildConfigurationPayload() {
  const analysis = {};
  analysisFieldIds.forEach(id => { const el = document.getElementById(id); analysis[id] = el?.value ?? ''; });
  analysis.addEspYear = document.getElementById('addEspYear')?.checked ?? true;
  const rdfConfig = normalizeRdfConfiguration(currentRdfConfiguration());
  analysis.slotMapping = rdfConfig.mapping;
  analysis.enabledInputs = rdfConfig.enabledInputs;
  analysis.customSlots = rdfConfig.customSlots;
  analysis.customStatistic = rdfConfig.customStatistic;
  analysis.customPlots = rdfConfig.customPlots;
  analysis.traceLabels = {...state.traceLabels};
  analysis.explorerSettings = explorerSettingsSnapshot();
  analysis.explorerPreload = currentExplorerPreload();
  analysis.dataAnalysis = slotChecksSnapshot();
  const report = document.getElementById('reportTitle') ? collectReportSettings() : (state.pendingReportSettings || null);
  return { version: 14, app_version: state.result?.meta?.app_version || '4.4.4', analysis, report };
}
function saveSettings() {
  const payload = buildConfigurationPayload();
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}), `CRMMS-report-configuration-${state.result?.meta?.eocy_year || 'config'}.json`);
}

function applyConfigurationPayload(payload) {
  if (payload.analysis) {
    analysisFieldIds.forEach(id => { if (payload.analysis[id] != null && document.getElementById(id)) document.getElementById(id).value = payload.analysis[id]; });
    if (payload.analysis.addEspYear != null && document.getElementById('addEspYear')) document.getElementById('addEspYear').checked = Boolean(payload.analysis.addEspYear);
    if (payload.analysis.traceLabels && typeof payload.analysis.traceLabels === 'object') state.traceLabels = {...payload.analysis.traceLabels};
    if (payload.analysis.explorerSettings && typeof payload.analysis.explorerSettings === 'object') { state.explorerSettings = {...state.explorerSettings, ...payload.analysis.explorerSettings}; applyExplorerSettings(state.explorerSettings); }
    if (payload.analysis.explorerPreload && typeof payload.analysis.explorerPreload === 'object') applyExplorerPreload(payload.analysis.explorerPreload);
    const dataAnalysisSettings = payload.analysis.dataAnalysis || payload.analysis.slotChecks;
    if (dataAnalysisSettings && typeof dataAnalysisSettings === 'object') applySlotChecksSettings(dataAnalysisSettings);
    configureSourceMode({clearFiles:false});
    if (payload.analysis.slotMapping || payload.analysis.customSlots || payload.analysis.customPlots) renderRdfMapping({
      mapping: payload.analysis.slotMapping || {}, enabledInputs: payload.analysis.enabledInputs,
      customSlots: payload.analysis.customSlots || [], customStatistic: payload.analysis.customStatistic || 'median', customPlots: payload.analysis.customPlots || []
    });
  }
  if (payload.report) { state.pendingReportSettings = payload.report; applyReportSettings(payload.report); }
}

function readNamedExplorerProfiles() {
  try { const x=JSON.parse(localStorage.getItem(EXPLORER_PROFILES_KEY)||'{}'); return x&&typeof x==='object'?x:{}; } catch { return {}; }
}
function refreshExplorerProfileSelect() {
  const select=document.getElementById('explorerProfileSelect'); if(!select)return; const profiles=readNamedExplorerProfiles(); const names=Object.keys(profiles).sort();
  select.innerHTML=names.length?names.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join(''):'<option value="">No saved profiles</option>';
}
document.getElementById('saveExplorerProfile')?.addEventListener('click',()=>{
  const name=String(document.getElementById('explorerProfileName')?.value||'').trim(); if(!name){showError('Enter a name for the Explorer profile.');return;}
  const profiles=readNamedExplorerProfiles(); profiles[name]=buildConfigurationPayload(); localStorage.setItem(EXPLORER_PROFILES_KEY,JSON.stringify(profiles)); refreshExplorerProfileSelect(); document.getElementById('explorerProfileSelect').value=name;
});
document.getElementById('loadExplorerProfile')?.addEventListener('click',()=>{const name=document.getElementById('explorerProfileSelect')?.value;const p=readNamedExplorerProfiles()[name];if(p)applyConfigurationPayload(p);});
document.getElementById('deleteExplorerProfile')?.addEventListener('click',()=>{const name=document.getElementById('explorerProfileSelect')?.value;if(!name)return;const p=readNamedExplorerProfiles();delete p[name];localStorage.setItem(EXPLORER_PROFILES_KEY,JSON.stringify(p));refreshExplorerProfileSelect();});
refreshExplorerProfileSelect();

/* ============================================================
   PORTABLE PHYSICAL PROFILE FILES
   The file contains reusable configuration only; RDF bytes are never stored.
   ============================================================ */
const CRMMS_PORTABLE_PROFILE_FORMAT='crmms-web-app-profile';
const CRMMS_PORTABLE_PROFILE_VERSION=1;

function portableProfileJsonCopy(value){return JSON.parse(JSON.stringify(value));}
function portableProfileSafeFilename(name){const safe=String(name || 'CRMMS_Profile').trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g,'_').replace(/\s+/g,'_').replace(/\.+$/g,'');return safe || 'CRMMS_Profile';}
function buildPortableExplorerProfile(name){return {profile_format:CRMMS_PORTABLE_PROFILE_FORMAT,profile_version:CRMMS_PORTABLE_PROFILE_VERSION,name:String(name || 'CRMMS Profile').trim(),created_with_app:state.result?.meta?.app_version || '4.4.4',exported_at:new Date().toISOString(),configuration:portableProfileJsonCopy(buildConfigurationPayload())};}
function validatePortableExplorerProfile(profile){if(!profile || typeof profile!=='object')throw new Error('The selected file does not contain a valid CRMMS profile.');if(profile.profile_format!==CRMMS_PORTABLE_PROFILE_FORMAT)throw new Error('This JSON file is not a CRMMS portable profile file.');if(!Number.isFinite(Number(profile.profile_version)) || Number(profile.profile_version)<1)throw new Error('The CRMMS profile version is missing or invalid.');if(!profile.configuration || typeof profile.configuration!=='object')throw new Error('The CRMMS profile does not contain application configuration.');return profile;}
function downloadPortableProfile(profile){downloadBlob(new Blob([JSON.stringify(profile,null,2)],{type:'application/json;charset=utf-8'}),`${portableProfileSafeFilename(profile.name)}.crmms-profile.json`);}
async function readPortableExplorerProfileFile(file){if(!file)return null;let profile;try{profile=JSON.parse(await file.text());}catch{throw new Error('The selected profile is not valid JSON.');}return validatePortableExplorerProfile(profile);}
function applyPortableExplorerProfile(profile){validatePortableExplorerProfile(profile);applyConfigurationPayload(portableProfileJsonCopy(profile.configuration));const nameInput=document.getElementById('explorerProfileName');if(nameInput)nameInput.value=profile.name || '';if(state.explorerData && state.rdfSessionId)refreshExplorerStack({silent:true}).catch(error=>console.error('Could not refresh imported profile stack:',error));hideError();}
function reapplyPendingPortableExplorerProfile(){const profile=state.pendingPortableExplorerProfile;if(!profile)return;try{applyPortableExplorerProfile(profile);}catch(error){console.error('Could not reapply imported profile:',error);}}

document.getElementById('exportExplorerProfileFile')?.addEventListener('click',()=>{
  const nameInput=document.getElementById('explorerProfileName');
  let name=String(nameInput?.value || '').trim();
  if(!name){const entered=window.prompt('Profile name','CRMMS Explorer Profile');if(entered===null)return;name=entered.trim() || 'CRMMS Explorer Profile';}
  try{syncLegacyExplorerStackState();downloadPortableProfile(buildPortableExplorerProfile(name));hideError();}
  catch(error){console.error('Profile export failed:',error);showError(error?.message || 'Could not export the CRMMS profile.');}
});
document.getElementById('importExplorerProfileFileButton')?.addEventListener('click',()=>document.getElementById('importExplorerProfileFile')?.click());
document.getElementById('importExplorerProfileFile')?.addEventListener('change',async event=>{
  const input=event.currentTarget,file=input.files?.[0];if(!file)return;
  try{const profile=await readPortableExplorerProfileFile(file);if(!profile)return;state.pendingPortableExplorerProfile=portableProfileJsonCopy(profile);applyPortableExplorerProfile(profile);console.info(`Loaded CRMMS profile: ${profile.name}`);}
  catch(error){console.error('Profile import failed:',error);showError(error?.message || 'Could not import the CRMMS profile.');}
  finally{input.value='';}
});

function applyReportSettings(settings) {
  if (!settings || !document.getElementById('reportTitle')) return;
  if (settings.report_title != null) document.getElementById('reportTitle').value = settings.report_title;
  if (settings.report_period != null) document.getElementById('reportPeriod').value = settings.report_period;
  if (settings.intro_text != null) document.getElementById('introText').value = settings.intro_text;
  if (settings.assumptions) document.getElementById('assumptionsText').value = settings.assumptions.join('\n');
  if (settings.lower_basin_caption != null) document.getElementById('lowerBasinCaption').value = settings.lower_basin_caption;
  document.getElementById('includeMetadata').checked = Boolean(settings.include_metadata);
  if (settings.template_style && document.getElementById('reportTemplate')) document.getElementById('reportTemplate').value = settings.template_style;
  if (Array.isArray(settings.section_order)) {
    const list=document.getElementById('reportOrderList'); const items=new Map([...list?.children||[]].map(el=>[el.dataset.sectionKey,el]));
    settings.section_order.forEach(key=>{const el=items.get(key);if(el)list.appendChild(el);});
  }
  if (Array.isArray(settings.included_tables)) document.querySelectorAll('.include-table').forEach(x => x.checked = settings.included_tables.includes(x.value));
  if (Array.isArray(settings.included_plots)) document.querySelectorAll('.include-plot').forEach(x => x.checked = settings.included_plots.includes(x.value));
  const notes = settings.table_notes || {};
  const titles = settings.table_titles || {};
  const subtitles = settings.table_subtitles || {};
  const tableYears = settings.table_years || {};
  document.querySelectorAll('.report-note-card').forEach(card => {
    const id = card.dataset.tableId;
    const ta = card.querySelector('.table-note');
    ta.value = (notes[id] || []).join('\n');
    const title = card.querySelector('.table-title-override');
    const subtitle = card.querySelector('.table-subtitle-override');
    if (title && Object.prototype.hasOwnProperty.call(titles, id)) title.value = titles[id];
    if (subtitle && Object.prototype.hasOwnProperty.call(subtitles, id)) subtitle.value = subtitles[id];
    if (Array.isArray(tableYears[id])) {
      const allowed = new Set(tableYears[id].map(String));
      card.querySelectorAll('.table-year-check').forEach(check => { check.checked = allowed.has(check.value); });
      const checks = [...card.querySelectorAll('.table-year-check')];
      if (checks.length && !checks.some(check => check.checked)) checks[0].checked = true;
    }
  });
  markReportPreviewDirty();
}
document.getElementById('settingsFileInput').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const payload = JSON.parse(await file.text()); applyConfigurationPayload(payload);
    const previewStatus = document.getElementById('previewStatus');
    if (previewStatus) previewStatus.textContent = 'Configuration loaded — select the new RDF files and re-run the comparison';
    else if (rdfDiscoveryStatus) rdfDiscoveryStatus.textContent = 'Configuration JSON loaded. Select the new RDF files, discover slots to validate the mappings, then compare.';
  } catch (err) {
    const error = document.getElementById('reportError');
    if (error) { error.textContent = `Could not load configuration: ${err.message}`; error.hidden = false; }
    else showError(`Could not load configuration: ${err.message}`);
  } finally { event.target.value = ''; }
});

// Configuration JSON can be imported before a comparison so the next monthly run can reuse the approved setup.
document.getElementById('importConfigurationButton')?.addEventListener('click', () => document.getElementById('settingsFileInput').click());

// ------------------------------
// RiverWare Data Explorer (v3.8)
// ------------------------------
function explorerAllTraceDefaults() {
  return state.explorerData?.trace_defaults || [];
}
function explorerTraceLabel(number, fallback='') {
  const key = String(number);
  if (state.traceLabels && state.traceLabels[key] != null && String(state.traceLabels[key]).trim()) return String(state.traceLabels[key]).trim();
  const rec = explorerAllTraceDefaults().find(x => Number(x.trace_number) === Number(number));
  return rec?.default_label || fallback || `Trace ${number}`;
}
function explorerSelectedTraceSet() {
  return new Set((state.explorerVisibleTraces || []).map(Number));
}
function renderTraceLabelEditor() {
  if (!traceLabelEditor) return;
  const traces = explorerAllTraceDefaults();
  if (!traces.length) {
    traceLabelEditor.innerHTML = '<div class="rdf-slot-empty">Discover RDF slots and load a slot to populate actual RDF trace numbers and editable labels.</div>';
    if (traceLabelSummary) traceLabelSummary.textContent = 'Discover a slot to configure labels';
    return;
  }
  const deterministic = traces.filter(x => x.role === 'deterministic');
  const ensemble = traces.filter(x => x.role !== 'deterministic');
  const rows = (items, heading) => items.length ? `<div class="trace-label-group"><div class="trace-label-group-title">${heading}<span>${items.length}</span></div>${items.map(rec => {
    const n = Number(rec.trace_number);
    return `<label class="trace-label-row"><span class="trace-number">Trace ${n}</span><input class="trace-label-input" data-trace="${n}" value="${escapeHtml(explorerTraceLabel(n, rec.default_label))}" /><small>${rec.role === 'deterministic' ? 'plot only by default' : 'ensemble'}</small></label>`;
  }).join('')}</div>` : '';
  traceLabelEditor.innerHTML = rows(deterministic, 'Deterministic traces') + rows(ensemble, 'Hydrologic ensemble traces');
  if (traceLabelSummary) traceLabelSummary.textContent = `${traces.length} RDF traces · ${ensemble.length} ensemble · ${deterministic.length} deterministic`;
  traceLabelEditor.querySelectorAll('.trace-label-input').forEach(input => input.addEventListener('input', () => {
    state.traceLabels[String(input.dataset.trace)] = input.value.trim();
    renderExplorerTraceControls(false);
    renderExplorerPlot();
    renderExplorerTable();
  }));
}

function renderExplorerTraceControls(resetSelection=true) {
  if (!explorerTraceList) return;
  const traces = explorerAllTraceDefaults();
  if (!traces.length) {
    explorerTraceList.innerHTML = '<div class="rdf-slot-empty">No trace data loaded.</div>';
    document.getElementById('explorerTraceSummary').textContent = 'No data loaded';
    return;
  }
  if (resetSelection) state.explorerVisibleTraces = traces.filter(x => x.plot_default !== false).map(x => Number(x.trace_number));
  const selected = explorerSelectedTraceSet();
  const group = (role, label) => {
    const items = traces.filter(x => (role === 'ensemble' ? x.role !== 'deterministic' : x.role === 'deterministic'));
    if (!items.length) return '';
    return `<div class="explorer-trace-group"><strong>${label}</strong>${items.map(rec => {
      const n = Number(rec.trace_number);
      const hi = state.explorerSelectedTraceColumns.has(n) || String(explorerHighlight?.value || '') === String(n);
      return `<label class="explorer-trace-row ${selected.has(n) ? 'is-visible' : ''} ${hi ? 'is-highlighted' : ''}"><input type="checkbox" class="explorer-trace-check" value="${n}" ${selected.has(n) ? 'checked' : ''}/><span class="explorer-trace-label">${escapeHtml(explorerTraceLabel(n, rec.default_label))} <span class="trace-number-inline">(${n})</span></span></label>`;
    }).join('')}</div>`;
  };
  explorerTraceList.innerHTML = group('deterministic','Deterministic') + group('ensemble','Hydrologic ensemble');
  const highlightValue = String(explorerHighlight?.value || '');
  explorerHighlight.innerHTML = '<option value="">None</option>' + traces.map(rec => `<option value="${rec.trace_number}" ${String(rec.trace_number) === highlightValue ? 'selected' : ''}>${escapeHtml(explorerTraceLabel(rec.trace_number, rec.default_label))} · Trace ${rec.trace_number}</option>`).join('');
  document.getElementById('explorerTraceSummary').textContent = `${selected.size} of ${traces.length} visible`;
  explorerTraceList.querySelectorAll('.explorer-trace-check').forEach(check => check.addEventListener('change', () => {
    const set = explorerSelectedTraceSet();
    const n = Number(check.value);
    if (check.checked) set.add(n); else set.delete(n);
    state.explorerVisibleTraces = [...set].sort((a,b)=>a-b);
    check.closest('.explorer-trace-row')?.classList.toggle('is-visible', check.checked);
    document.getElementById('explorerTraceSummary').textContent = `${set.size} of ${traces.length} visible`;
    renderExplorerPlot();
    renderExplorerTable();
  }));
}

function explorerPeriodLabel(value, timestepTypes=[]) {
  if (!value) return '';
  if (timestepTypes.includes('annual')) return String(value.year ?? value.period_date ?? value.timestep);
  const date = value.period_date || '';
  if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    const [y,m] = date.split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[Number(m)-1] || m}-${String(y).slice(-2)}`;
  }
  return value.timestep || date;
}

function transformExplorerTrace(trace, run, transform, wyStart=10) {
  const values = (trace?.values || []).filter(v => v.value != null && Number.isFinite(Number(v.value)));
  const ttypes = run?.timestep_types || [];
  if (transform === 'raw') return values.map(v => ({key: explorerPeriodLabel(v, ttypes), x: v.period_date || v.timestep, label: explorerPeriodLabel(v, ttypes), value:Number(v.value), source:v}));
  if (transform === 'annual_raw') {
    return values.map(v => ({key:String(v.year ?? v.period_date), x:String(v.year ?? v.period_date), label:String(v.year ?? v.period_date), value:Number(v.value), source:v}));
  }
  const groups = new Map();
  for (const v of values) {
    const year = Number(v.year);
    const month = Number(v.month || 1);
    if (!Number.isFinite(year)) continue;
    const keyYear = transform === 'water_year_sum' ? year + (month >= Number(wyStart) ? 1 : 0) : year;
    const key = transform === 'water_year_sum' ? `WY ${keyYear}` : String(keyYear);
    const bucket = groups.get(key) || {key, x:key, label:key, value:0, count:0, year:keyYear};
    bucket.value += Number(v.value);
    bucket.count += 1;
    groups.set(key,bucket);
  }
  return [...groups.values()].sort((a,b)=>Number(a.year)-Number(b.year));
}

function explorerRunTraceFor(data, runKey, traceNumber) {
  const run = data?.[runKey];
  return run?.traces?.find(x => Number(x.trace_number) === Number(traceNumber)) || null;
}
function explorerRunTrace(runKey, traceNumber) { return explorerRunTraceFor(state.explorerData, runKey, traceNumber); }

function explorerDisplayFactor() {
  const factor=Number(explorerUnitFactor?.value ?? 1); return Number.isFinite(factor) ? factor : 1;
}
function explorerDisplayOffset() {
  const offset=Number(explorerUnitOffset?.value ?? 0); return Number.isFinite(offset) ? offset : 0;
}
function explorerVisibleTransformedFor(data, runKey, transformOverride = null, itemSettings = null) {
  const run = data?.[runKey];
  if (!run) return [];
  const transform = transformOverride || explorerTransform?.value || 'raw';
  // CRMMS Water Year is fixed to October through September.
  const wyStart = 10;
  const factor = itemSettings ? Number(itemSettings.unit_factor ?? 1) : explorerDisplayFactor();
  const offset = itemSettings ? Number(itemSettings.unit_offset ?? 0) : explorerDisplayOffset();
  return state.explorerVisibleTraces.map(n => {
    const trace = explorerRunTraceFor(data, runKey, n);
    if (!trace) return null;
    const points = transformExplorerTrace(trace, run, transform, wyStart)
      .map(p => ({...p, value:Number(p.value) * factor + offset}));
    return {trace_number:n, label:explorerTraceLabel(n, trace.default_label), role:trace.role, points};
  }).filter(Boolean);
}

function explorerVisibleTransformed(runKey) {
  const primary = (state.explorerStackItems || [])[0];
  const transform = primary?.transform || explorerTransform?.value || 'raw';
  return explorerVisibleTransformedFor(state.explorerData, runKey, transform);
}


function explorerUnitFor(data, runKey='current') {
  const custom=String(explorerDisplayUnit?.value || '').trim();
  if (custom) return custom;
  const run = data?.[runKey] || data?.[runKey === 'current' ? 'previous' : 'current'];
  return (run?.units || []).join(', ') || 'Value';
}
function explorerUnit(runKey='current') { return explorerUnitFor(state.explorerData, runKey); }

function quantile(values, q) {
  const a=values.map(Number).filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null;
  const pos=(a.length-1)*q, lo=Math.floor(pos), hi=Math.ceil(pos); if(lo===hi)return a[lo];
  return a[lo]+(a[hi]-a[lo])*(pos-lo);
}
function percentileBandFor(series, low, high) {
  const by=new Map();
  series.forEach(item=>item.points.forEach(p=>{const key=String(p.x ?? p.label); if(!by.has(key))by.set(key,{x:p.x,label:p.label,values:[]}); by.get(key).values.push(Number(p.value));}));
  const rows=[...by.values()].sort((a,b)=>String(a.x).localeCompare(String(b.x)));
  return {x:rows.map(r=>r.x), low:rows.map(r=>quantile(r.values,low/100)), high:rows.map(r=>quantile(r.values,high/100))};
}
function parseExplorerReferenceLines(slot) {
  const lines=String(explorerReferenceLines?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean); const out=[];
  for(const line of lines){const p=line.split('|').map(x=>x.trim()); let target='*', value,label,color;
    if(p.length>=4 && !Number.isFinite(Number(p[0]))){[target,value,label,color]=p;} else {[value,label,color]=p;}
    const n=Number(value); if(!Number.isFinite(n))continue; if(target!=='*' && target!==slot)continue;
    out.push({value:n,label:label||String(n),color:color||'#c0392b'});
  } return out;
}
function parseExplorerConditionalRules() {
  return String(explorerConditionalRules?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const [op,value,color,label]=line.split('|').map(x=>x.trim());const n=Number(value);return Number.isFinite(n)&&['<','<=','>','>=','=='].includes(op)?{op,value:n,color:color||'#fff4cc',label:label||''}:null;}).filter(Boolean);
}
function conditionalRuleFor(value) {
  const v=Number(value); if(!Number.isFinite(v))return null;
  return parseExplorerConditionalRules().find(r=>r.op==='<'?v<r.value:r.op==='<='?v<=r.value:r.op==='>'?v>r.value:r.op==='>='?v>=r.value:v===r.value) || null;
}

function activeExplorerHighlights() {
  const selected = new Set([...state.explorerSelectedTraceColumns].map(Number));
  const single = Number(explorerHighlight?.value || NaN);
  if (Number.isFinite(single)) selected.add(single);
  return selected;
}


const EXPLORER_PLOT_FONT = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';


function _segmentIntersectsViewport(p1, p2, xmin, xmax, ymin, ymax) {
  const x1=Date.parse(p1.x), x2=Date.parse(p2.x), y1=Number(p1.value), y2=Number(p2.value);
  if (![x1,x2,y1,y2].every(Number.isFinite)) return false;
  const bx0=Math.min(x1,x2), bx1=Math.max(x1,x2), by0=Math.min(y1,y2), by1=Math.max(y1,y2);
  if (bx1 < xmin || bx0 > xmax || by1 < ymin || by0 > ymax) return false;
  const inside=(x,y)=>x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax;
  if (inside(x1,y1)||inside(x2,y2)) return true;
  const dx=x2-x1, dy=y2-y1;
  for (const x of [xmin,xmax]) {
    if (dx !== 0) { const t=(x-x1)/dx; if(t>=0&&t<=1){const y=y1+t*dy;if(y>=ymin&&y<=ymax)return true;} }
  }
  for (const y of [ymin,ymax]) {
    if (dy !== 0) { const t=(y-y1)/dy; if(t>=0&&t<=1){const x=x1+t*dx;if(x>=xmin&&x<=xmax)return true;} }
  }
  return false;
}

function explorerTracesInViewport() {
  const viewportSlot=state.explorerViewport?.slot || state.explorerData?.slot || '';
  const viewportItem=explorerStackItemById(state.explorerViewport?.entry_id) || (state.explorerStackItems || []).find(item=>item.slot===viewportSlot);
  if (viewportItem?.plot_type !== 'line' || viewportItem?.transform !== 'raw') return [];
  const xr=state.explorerViewport.x, yr=state.explorerViewport.y;
  if (!xr && !yr) return [];
  const xmin=xr ? Math.min(Date.parse(xr[0]),Date.parse(xr[1])) : -Infinity;
  const xmax=xr ? Math.max(Date.parse(xr[0]),Date.parse(xr[1])) : Infinity;
  const ymin=yr ? Math.min(Number(yr[0]),Number(yr[1])) : -Infinity;
  const ymax=yr ? Math.max(Number(yr[0]),Number(yr[1])) : Infinity;
  const found=new Set();
  const viewportData=viewportSlot===state.explorerData?.slot ? state.explorerData : (state.explorerStackData.get(viewportSlot) || state.explorerData);
  const runKeys=[];
  if (document.getElementById('explorerRunA').checked && viewportData?.current) runKeys.push('current');
  if (document.getElementById('explorerRunB').checked && viewportData?.previous) runKeys.push('previous');
  for (const runKey of runKeys) {
    for (const item of explorerVisibleTransformedFor(viewportData,runKey,'raw')) {
      const pts=item.points || [];
      let visible=false;
      for (const p of pts) {
        const x=Date.parse(p.x), y=Number(p.value);
        if (Number.isFinite(x)&&Number.isFinite(y)&&x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax) { visible=true; break; }
      }
      if (!visible) for (let i=1;i<pts.length;i++) if (_segmentIntersectsViewport(pts[i-1],pts[i],xmin,xmax,ymin,ymax)) { visible=true; break; }
      if (visible) found.add(Number(item.trace_number));
    }
  }
  return [...found].sort((a,b)=>a-b);
}

function explorerTableModelLegacy() {
  let runKey = document.getElementById('explorerTableRun').value;
  if (!state.explorerData?.[runKey]) runKey = state.explorerData?.current ? 'current' : 'previous';
  const run = state.explorerData?.[runKey];
  if (!run) return null;
  let series = explorerVisibleTransformed(runKey);
  if (state.explorerTableTraceFilter instanceof Set) series = series.filter(item=>state.explorerTableTraceFilter.has(Number(item.trace_number)));
  const periods=[]; const seen=new Set();
  series.forEach(item=>item.points.forEach(p=>{
    const k=p.label; if(!seen.has(k)){seen.add(k);periods.push({label:k,x:p.x});}
  }));
  const lookup=new Map();
  series.forEach(item=>item.points.forEach(p=>lookup.set(`${item.trace_number}::${p.label}`,p.value)));
  return {runKey,run,series,periods,lookup};
}





async function loadExplorerSlot({force=false, silent=false, preserveStack=false}={}) {
  const slot = explorerSlot.value;
  if (!slot) { showError('Discover RDF slots and choose a slot to explore.'); return; }
  if (!state.rdfSessionId) { showError('Discover RDF slots first to create an Explorer session.'); return; }
  const cacheKey = `${state.rdfSessionId}::${slot}`;
  const useCached = !force && state.explorerSlotCache.has(cacheKey);
  const isPreloaded = state.rdfPreloaded.current.has(slot) || state.rdfPreloaded.previous.has(slot);
  const showOverlay = !silent && !useCached && !isPreloaded;
  if (showOverlay) setLoading('Loading RDF slot once', `Reading ${slot} from the saved Explorer session. It will be cached for fast reuse.`);
  try {
    const payload = await getExplorerSlotPayload(slot, {force});
    state.explorerData = payload;
    state.explorerSettings.slot = slot;

    // A direct user slot choice changes the primary plot. During initial profile
    // restoration, preserveStack keeps unavailable saved items intact and lets
    // the first available saved plot become the active data source instead.
    if (!Array.isArray(state.explorerStackItems)) state.explorerStackItems = [];
    if (!preserveStack) {
      if (!state.explorerStackItems.length) {
        state.explorerStackItems = [createExplorerStackItem(slot, {plot_type:'line', transform:'raw'})];
      } else {
        state.explorerStackItems[0] = normalizeExplorerStackItem({...state.explorerStackItems[0], slot});
      }
    } else {
      ensureExplorerStackItems();
    }
    syncLegacyExplorerStackState();

    (payload.trace_defaults || []).forEach(rec => {
      const k = String(rec.trace_number);
      if (state.traceLabels[k] == null) state.traceLabels[k] = rec.default_label;
    });
    renderTraceLabelEditor();
    applyExplorerSettings(state.explorerSettings);
    const configuredVisible = Array.isArray(state.explorerSettings?.visible_traces)
      ? state.explorerSettings.visible_traces.map(Number).filter(n => (payload.trace_defaults || []).some(x => Number(x.trace_number) === n))
      : [];
    state.explorerVisibleTraces = configuredVisible.length ? configuredVisible : (payload.trace_defaults || []).map(x => Number(x.trace_number));
    state.explorerSelectedTraceColumns = new Set();
    state.explorerSelectedRows = new Set();
    state.explorerViewport = {x:null, y:null, slot, entry_id:state.explorerStackItems[0]?.id || ''};
    state.explorerTableTraceFilter = null;
    const viewportButton = document.getElementById('tableUseVisibleRange');
    if (viewportButton) viewportButton.textContent = 'Use traces in plot viewport';
    renderExplorerTraceControls(false);
    populateExplorerStackOptions();
    if (state.explorerSettings?.highlight_trace && [...explorerHighlight.options].some(o => o.value === String(state.explorerSettings.highlight_trace))) {
      explorerHighlight.value = String(state.explorerSettings.highlight_trace);
    }
    await refreshExplorerStack({silent:true});
    renderExplorerTable();
    if (explorerCacheStatus) explorerCacheStatus.textContent = `${slot} · ${isPreloaded || useCached ? 'cached' : 'loaded and cached'} · ${payload.trace_defaults?.length || 0} traces`;
    updateExplorerSlotLoadState();
    dataExplorerSection.hidden = false;
    if (state.workspaceMode === 'explore') document.body.classList.add('explorer-focused');
  } catch (err) {
    showError(err.message || 'Could not load Data Explorer slot.');
  } finally {
    if (showOverlay) clearLoading();
  }
}

function explorerSettingsSnapshot() {
  ensureExplorerStackItems(state.explorerData?.slot || explorerSlot?.value || '');
  return {
    slot: explorerSlot?.value || '',
    // Legacy defaults are retained for backward-compatible imports; visible controls are per chart.
    plot_type: state.explorerStackItems?.[0]?.plot_type || explorerPlotType?.value || 'line',
    transform: state.explorerStackItems?.[0]?.transform || explorerTransform?.value || 'raw',
    wy_start_month: 10,
    run_a_color: explorerRunAColor?.value || '#167c80',
    run_b_color: explorerRunBColor?.value || '#d07a28',
    dim_color: document.getElementById('explorerDimColor')?.value || '#9aa5aa',
    annual_year: state.explorerStackItems?.[0]?.annual_year || '',
    bar_sort: state.explorerStackItems?.[0]?.bar_sort || 'none',
    alpha: Number(explorerAlpha?.value || 0.32),
    title: document.getElementById('explorerTitle')?.value || '',
    subtitle: document.getElementById('explorerSubtitle')?.value || '',
    visible_traces: [...state.explorerVisibleTraces],
    highlight_trace: explorerHighlight?.value || '',
    box_line_overlay: explorerBoxLineOverlay?.checked !== false,
    x_axis_title: explorerXAxisTitle?.value || '',
    y_axis_title: explorerYAxisTitle?.value || '',
    line_width: Number(explorerLineWidth?.value || 1.0),
    plot_height: Math.max(250, Math.min(700, Number(explorerPlotHeight?.value || 400))),
    table_decimals: Math.max(0, Math.min(6, Number(explorerTableDecimals?.value || 2))),
    show_grid: explorerShowGrid?.checked !== false,
    overlay_alpha: Number(explorerOverlayAlpha?.value || 0.28),
    y_axis_mode: explorerYAxisMode?.value || 'auto',
    y_min: explorerYMin?.value || '',
    y_max: explorerYMax?.value || '',
    percentile_band: explorerPercentileBand?.checked === true,
    percentile_low: Number(explorerPercentileLow?.value || 10),
    percentile_high: Number(explorerPercentileHigh?.value || 90),
    unit_factor: Number(explorerUnitFactor?.value || 1),
    unit_offset: Number(explorerUnitOffset?.value || 0),
    display_unit: explorerDisplayUnit?.value || '',
    reference_lines: explorerReferenceLines?.value || '',
    conditional_rules: explorerConditionalRules?.value || '',
    stack_slots: [...state.explorerStackSlots],
    stack_order: [...state.explorerStackOrder],
    stack_plot_types: {...state.explorerStackPlotTypes},
    stack_items: (state.explorerStackItems || []).map(item => ({
      id:item.id,
      slot:item.slot,
      plot_type:item.plot_type,
      transform:item.transform,
      annual_year:item.annual_year || '',
      bar_sort:item.bar_sort || 'none',
      reference_lines:(item.reference_lines || []).map(line => ({...line}))
    }))
  };
}


function applyExplorerSettings(settings={}) {
  if (!settings || typeof settings !== 'object') return;
  if (settings.slot && explorerSlot && [...explorerSlot.options].some(o => o.value === settings.slot)) explorerSlot.value = settings.slot;
  if (settings.plot_type && explorerPlotType) explorerPlotType.value = settings.plot_type;
  if (settings.transform && explorerTransform) explorerTransform.value = settings.transform;
  if (explorerWyStartMonth) explorerWyStartMonth.value = '10';
  if (settings.run_a_color && explorerRunAColor) explorerRunAColor.value = settings.run_a_color;
  if (settings.run_b_color && explorerRunBColor) explorerRunBColor.value = settings.run_b_color;
  if (settings.dim_color && document.getElementById('explorerDimColor')) document.getElementById('explorerDimColor').value = settings.dim_color;
  if (settings.annual_year != null && document.getElementById('explorerAnnualYear')) document.getElementById('explorerAnnualYear').value = String(settings.annual_year);
  if (settings.bar_sort && document.getElementById('explorerBarSort')) document.getElementById('explorerBarSort').value = settings.bar_sort;
  if (settings.alpha != null && explorerAlpha) { explorerAlpha.value=String(settings.alpha); if (explorerAlphaValue) explorerAlphaValue.value=Number(settings.alpha).toFixed(2); }
  if (settings.title != null && document.getElementById('explorerTitle')) document.getElementById('explorerTitle').value = settings.title;
  if (settings.subtitle != null && document.getElementById('explorerSubtitle')) document.getElementById('explorerSubtitle').value = settings.subtitle;
  if (Array.isArray(settings.visible_traces)) state.explorerVisibleTraces = settings.visible_traces.map(Number);
  if (settings.highlight_trace != null) state.explorerSettings.highlight_trace = String(settings.highlight_trace);
  if (settings.box_line_overlay != null && explorerBoxLineOverlay) explorerBoxLineOverlay.checked = Boolean(settings.box_line_overlay);
  if (settings.x_axis_title != null && explorerXAxisTitle) explorerXAxisTitle.value = String(settings.x_axis_title);
  if (settings.y_axis_title != null && explorerYAxisTitle) explorerYAxisTitle.value = String(settings.y_axis_title);
  if (settings.line_width != null && explorerLineWidth) { explorerLineWidth.value=String(settings.line_width); if (explorerLineWidthValue) explorerLineWidthValue.value=Number(settings.line_width).toFixed(1); }
  if (settings.plot_height != null && explorerPlotHeight) {
    const height = Math.max(250, Math.min(700, Number(settings.plot_height) || 400));
    explorerPlotHeight.value = String(height);
    if (explorerPlotHeightValue) explorerPlotHeightValue.value = `${height} px`;
  }
  if (settings.table_decimals != null && explorerTableDecimals) explorerTableDecimals.value = String(settings.table_decimals);
  if (settings.show_grid != null && explorerShowGrid) explorerShowGrid.checked = Boolean(settings.show_grid);
  if (settings.overlay_alpha != null && explorerOverlayAlpha) { explorerOverlayAlpha.value=String(settings.overlay_alpha); if (explorerOverlayAlphaValue) explorerOverlayAlphaValue.value=Number(settings.overlay_alpha).toFixed(2); }
  if (settings.y_axis_mode && explorerYAxisMode) explorerYAxisMode.value = String(settings.y_axis_mode);
  if (settings.y_min != null && explorerYMin) explorerYMin.value = String(settings.y_min);
  if (settings.y_max != null && explorerYMax) explorerYMax.value = String(settings.y_max);
  if (settings.percentile_band != null && explorerPercentileBand) explorerPercentileBand.checked = Boolean(settings.percentile_band);
  if (settings.percentile_low != null && explorerPercentileLow) explorerPercentileLow.value = String(settings.percentile_low);
  if (settings.percentile_high != null && explorerPercentileHigh) explorerPercentileHigh.value = String(settings.percentile_high);
  if (settings.unit_factor != null && explorerUnitFactor) explorerUnitFactor.value = String(settings.unit_factor);
  if (settings.unit_offset != null && explorerUnitOffset) explorerUnitOffset.value = String(settings.unit_offset);
  if (settings.display_unit != null && explorerDisplayUnit) explorerDisplayUnit.value = String(settings.display_unit);
  if (settings.reference_lines != null && explorerReferenceLines) explorerReferenceLines.value = String(settings.reference_lines);
  if (settings.conditional_rules != null && explorerConditionalRules) explorerConditionalRules.value = String(settings.conditional_rules);

  if (Array.isArray(settings.stack_slots)) state.explorerStackSlots = settings.stack_slots.map(String);
  if (Array.isArray(settings.stack_order)) state.explorerStackOrder = settings.stack_order.map(String);
  if (settings.stack_plot_types && typeof settings.stack_plot_types === 'object') state.explorerStackPlotTypes = {...settings.stack_plot_types};

  if (Array.isArray(settings.stack_items) && settings.stack_items.length) {
    state.explorerStackItems = settings.stack_items.map(normalizeExplorerStackItem).filter(Boolean);
    const maxSequence = state.explorerStackItems.reduce((maximum, item) => Math.max(maximum, Number(String(item.id || '').replace(/\D/g,'')) || 0), 0);
    state.explorerStackItemSeq = Math.max(state.explorerStackItemSeq || 0, maxSequence);
  } else if (!state.explorerStackItems?.length) {
    state.explorerStackItems = legacyExplorerStackItems(settings);
  }
  syncLegacyExplorerStackState();
  populateExplorerStackOptions();
}

document.getElementById('closeDataExplorerButton')?.addEventListener('click',()=>{dataExplorerSection.hidden=true;document.body.classList.remove('explorer-focused');uploadSection.hidden=false;uploadSection.scrollIntoView({behavior:'smooth',block:'start'});});
// Compatibility for older HTML versions that still contain the Load slot
// button. The button is hidden by updateExplorerSlotLoadState() because
// selecting a slot now loads it automatically.
loadExplorerSlotButton?.addEventListener('click',()=>loadExplorerSlot({force:false, silent:false}));
explorerSlot?.addEventListener('change', async ()=>{
  populateExplorerStackOptions();

  if (!state.rdfSessionId || !explorerSlot.value) {
    updateExplorerSlotLoadState();
    return;
  }

  const slot = explorerSlot.value;
  const cache = explorerSlotCacheState(slot);

  // v4.5 automatic lazy loading:
  // Cached/preloaded slots switch quietly and immediately.
  // Uncached slots load as soon as they are selected, display the normal
  // loading overlay, and are then retained in explorerSlotCache.
  try {
    await loadExplorerSlot({
      force: false,
      silent: cache.fast
    });
  } catch (error) {
    console.error(`Could not automatically load RDF slot ${slot}:`, error);
  }
});
document.getElementById('explorerSelectAllTraces')?.addEventListener('click',()=>{state.explorerVisibleTraces=explorerAllTraceDefaults().map(x=>Number(x.trace_number));renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();});
document.getElementById('explorerSelectEnsembleTraces')?.addEventListener('click',()=>{state.explorerVisibleTraces=explorerAllTraceDefaults().filter(x=>x.role!=='deterministic').map(x=>Number(x.trace_number));renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();});
document.getElementById('explorerClearTraces')?.addEventListener('click',()=>{state.explorerVisibleTraces=[];renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();});
[explorerPlotType,explorerTransform,explorerWyStartMonth,explorerRunAColor,explorerRunBColor,document.getElementById('explorerDimColor'),document.getElementById('explorerAnnualYear'),document.getElementById('explorerBarSort'),explorerBoxLineOverlay,explorerXAxisTitle,explorerYAxisTitle,explorerTableDecimals,explorerShowGrid,explorerYAxisMode,explorerPercentileBand,explorerPercentileLow,explorerPercentileHigh,explorerUnitFactor,explorerUnitOffset,explorerDisplayUnit,document.getElementById('explorerRunA'),document.getElementById('explorerRunB')].forEach(el=>el?.addEventListener('change',()=>{state.explorerTableTraceFilter=null;renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();}));
explorerPlotType?.addEventListener('change',()=>{
  const primary=state.explorerData?.slot || explorerSlot?.value || '';
  if(primary){state.explorerStackPlotTypes[primary]=explorerPlotType.value;state.explorerSettings.stack_plot_types={...state.explorerStackPlotTypes};renderExplorerStackList();updateExplorerAnnualBarOptions();}
});
explorerHighlight?.addEventListener('change',()=>{const n=Number(explorerHighlight.value);state.explorerSelectedTraceColumns=Number.isFinite(n)?new Set([n]):new Set();renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();});
explorerAlpha?.addEventListener('input',()=>{explorerAlphaValue.value=Number(explorerAlpha.value).toFixed(2);renderExplorerPlot();});
explorerLineWidth?.addEventListener('input',()=>{explorerLineWidthValue.value=Number(explorerLineWidth.value).toFixed(1);renderExplorerPlot();});

explorerPlotHeight?.addEventListener('input', () => {
  applyExplorerPlotHeight();
});

explorerOverlayAlpha?.addEventListener('input',()=>{explorerOverlayAlphaValue.value=Number(explorerOverlayAlpha.value).toFixed(2);renderExplorerPlot();});
explorerTableDecimals?.addEventListener('input',renderExplorerTable);
['explorerTitle','explorerSubtitle','explorerXAxisTitle','explorerYAxisTitle','explorerYMin','explorerYMax','explorerReferenceLines'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderExplorerPlot));
explorerConditionalRules?.addEventListener('input',renderExplorerTable);
[explorerUnitFactor,explorerUnitOffset,explorerDisplayUnit].forEach(el=>el?.addEventListener('input',()=>{renderExplorerPlot();renderExplorerTable();}));
document.getElementById('explorerTableRun')?.addEventListener('change',renderExplorerTable);

document.getElementById('highlightAllDeterministic')?.addEventListener('click',()=>{
  const nums=explorerAllTraceDefaults().filter(x=>x.role==='deterministic').map(x=>Number(x.trace_number));
  state.explorerSelectedTraceColumns=new Set(nums); explorerHighlight.value=''; renderExplorerTraceControls(false); renderExplorerPlot(); renderExplorerTable();
});
document.querySelectorAll('[data-highlight-role]').forEach(btn=>btn.addEventListener('click',()=>{
  const wanted=String(btn.dataset.highlightRole||'').toLowerCase();
  const rec=explorerAllTraceDefaults().find(x=>x.role==='deterministic' && String(x.default_label||'').toLowerCase()===wanted);
  if(!rec)return; state.explorerSelectedTraceColumns=new Set([Number(rec.trace_number)]); explorerHighlight.value=String(rec.trace_number); renderExplorerTraceControls(false); renderExplorerPlot(); renderExplorerTable();
}));
document.getElementById('clearTableSelection')?.addEventListener('click',()=>{state.explorerSelectedTraceColumns=new Set();state.explorerSelectedRows=new Set();explorerHighlight.value='';renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();});
document.getElementById('tableUseVisibleRange')?.addEventListener('click',event=>{
  if (state.explorerTableTraceFilter instanceof Set) {
    state.explorerTableTraceFilter=null;
    event.currentTarget.textContent='Use traces in plot viewport';
    renderExplorerTable();
    return;
  }
  const viewportSlot = state.explorerViewport?.slot || state.explorerData?.slot || '';
  const viewportItem = explorerStackItemById(state.explorerViewport?.entry_id) || (state.explorerStackItems || []).find(item => item.slot === viewportSlot);
  if (viewportItem?.plot_type !== 'line' || viewportItem?.transform !== 'raw') {
    showError('Viewport trace filtering is available for raw-timestep line plots.');
    return;
  }
  if (!state.explorerViewport.x && !state.explorerViewport.y) {
    showError('Zoom the line plot to the region containing the traces you want, then click this button.');
    return;
  }
  const nums=explorerTracesInViewport();
  if (!nums.length) {
    showError('No visible trace lines intersect the current plot viewport. Try a slightly larger zoom region.');
    return;
  }
  hideError();
  state.explorerTableTraceFilter=new Set(nums);
  event.currentTarget.textContent='Show all table traces';
  renderExplorerTable();
});
document.getElementById('exportExplorerCsv')?.addEventListener('click',exportExplorerTableCsv);

document.getElementById('saveExplorerAsReportPlotButton')?.addEventListener('click',()=>{
  if (!state.explorerData?.slot) { showError('Load an RDF slot in Data Explorer first.'); return; }
  const cfg=explorerSettingsSnapshot();
  const primaryItem=(state.explorerStackItems || [])[0] || {plot_type:cfg.plot_type,transform:cfg.transform,annual_year:cfg.annual_year,bar_sort:cfg.bar_sort,reference_lines:[]};
  const referenceText=referenceLinesToText(primaryItem.reference_lines || []);
  state.customRdfPlots.push({slot:state.explorerData.slot,plot_type:primaryItem.plot_type,title:cfg.title,subtitle:cfg.subtitle,transform:primaryItem.transform,wy_start_month:10,run_a_color:cfg.run_a_color,run_b_color:cfg.run_b_color,dim_color:cfg.dim_color,annual_year:primaryItem.annual_year,bar_sort:primaryItem.bar_sort,alpha:cfg.alpha,trace_numbers:[...state.explorerVisibleTraces],trace_labels:{...state.traceLabels},x_axis_title:cfg.x_axis_title,y_axis_title:cfg.y_axis_title,line_width:cfg.line_width,show_grid:cfg.show_grid,overlay_alpha:cfg.overlay_alpha,y_axis_mode:cfg.y_axis_mode,y_min:cfg.y_min,y_max:cfg.y_max,percentile_band:cfg.percentile_band,percentile_low:cfg.percentile_low,percentile_high:cfg.percentile_high,unit_factor:cfg.unit_factor,unit_offset:cfg.unit_offset,display_unit:cfg.display_unit,reference_lines:referenceText});
  renderRdfPlotConfig(); updateRdfSelectionSummary();
  const panel=document.getElementById('rdfPlotConfigurationPanel'); if(panel) panel.open=true;
  rdfSettingsPanel.open=true;
});

/* v4.2 advanced stack/table/checks behavior */















/* ============================================================
   EXPLORER + DATA ANALYSIS PRESETS
   Persisted in explorer_presets.json through the local FastAPI app.
   ============================================================ */
state.explorerPresets = {version:1, plot_presets:[], analysis_presets:[]};

function slugPresetName(name='preset') { return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `preset-${Date.now()}`; }
async function fetchExplorerPresets() {
  const response=await fetch('/api/explorer/presets'); const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.detail || 'Could not load Explorer presets.');
  state.explorerPresets={version:Number(data.version||1),plot_presets:Array.isArray(data.plot_presets)?data.plot_presets:[],analysis_presets:Array.isArray(data.analysis_presets)?data.analysis_presets:[]};
  renderPresetSelectors(); return state.explorerPresets;
}
async function persistExplorerPresets() {
  const response=await fetch('/api/explorer/presets',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state.explorerPresets)});
  const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.detail || 'Could not save Explorer presets.');
  state.explorerPresets=data; renderPresetSelectors();
}
function renderPresetSelectors() {
  const plot=document.getElementById('explorerPlotPreset'), analysis=document.getElementById('slotCheckPreset');
  if(plot){const current=plot.value;plot.innerHTML='<option value="">Choose a plot preset…</option>'+state.explorerPresets.plot_presets.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');if([...plot.options].some(o=>o.value===current))plot.value=current;}
  if(analysis){const current=analysis.value;analysis.innerHTML='<option value="">Choose an analysis preset…</option>'+state.explorerPresets.analysis_presets.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');if([...analysis.options].some(o=>o.value===current))analysis.value=current;}
}
function plotPresetSnapshot(name='') { return {id:slugPresetName(name),name,description:'',layout:{columns:document.getElementById('explorerGridColumns')?.value || '2',plot_height:Number(explorerPlotHeight?.value || 400)},plots:(state.explorerStackItems||[]).map(item=>({...item,id:undefined,reference_lines:(item.reference_lines||[]).map(x=>({...x}))}))}; }
async function loadPlotPresetById(id) {
  const preset=state.explorerPresets.plot_presets.find(p=>p.id===id); if(!preset) return;
  const plots=(preset.plots||[]).map(p=>createExplorerStackItem(p.slot,p)).filter(Boolean); if(!plots.length){showError('This plot preset has no configured plots.');return;}
  state.explorerStackItems=plots; syncLegacyExplorerStackState(); if(preset.layout?.columns){const gc=document.getElementById('explorerGridColumns');if(gc)gc.value=String(preset.layout.columns);applyExplorerGridColumns();} if(preset.layout?.plot_height&&explorerPlotHeight){explorerPlotHeight.value=String(preset.layout.plot_height);applyExplorerPlotHeight();}
  const first=plots.find(p=>explorerSlotIsAvailable(p.slot)); if(first){if(explorerSlot&&[...explorerSlot.options].some(o=>o.value===first.slot))explorerSlot.value=first.slot; state.explorerData=await getExplorerSlotPayload(first.slot);}
  await refreshExplorerStack({silent:false}); renderExplorerStackList();
  const missing=plots.filter(p=>!explorerSlotIsAvailable(p.slot)).map(p=>p.slot); const help=document.getElementById('explorerPlotPresetHelp'); if(help)help.textContent=missing.length?`Loaded ${preset.name}. Missing in current RDFs: ${missing.join(', ')}`:(preset.description||`Loaded ${preset.name}.`);
}
async function saveCurrentPlotPreset() {
  ensureExplorerStackItems(); const name=prompt('Name for this plot preset:'); if(!name?.trim())return; const preset=plotPresetSnapshot(name.trim());
  const existing=state.explorerPresets.plot_presets.findIndex(p=>p.id===preset.id); if(existing>=0){if(!confirm(`Replace existing preset "${state.explorerPresets.plot_presets[existing].name}"?`))return;state.explorerPresets.plot_presets[existing]=preset;}else state.explorerPresets.plot_presets.push(preset);
  await persistExplorerPresets(); document.getElementById('explorerPlotPreset').value=preset.id;
}
async function deleteSelectedPreset(kind) {
  const select=document.getElementById(kind==='plot'?'explorerPlotPreset':'slotCheckPreset'); const id=select?.value;if(!id)return; const key=kind==='plot'?'plot_presets':'analysis_presets'; const p=state.explorerPresets[key].find(x=>x.id===id);if(!p||!confirm(`Delete preset "${p.name}"?`))return; state.explorerPresets[key]=state.explorerPresets[key].filter(x=>x.id!==id);await persistExplorerPresets();
}
async function saveCurrentAnalysisPreset() {
  const name=prompt('Name for this analysis preset:'); if(!name?.trim())return; const preset={id:slugPresetName(name),name:name.trim(),description:'',settings:slotChecksSnapshot()};
  const arr=state.explorerPresets.analysis_presets, existing=arr.findIndex(p=>p.id===preset.id);if(existing>=0){if(!confirm(`Replace existing preset "${arr[existing].name}"?`))return;arr[existing]=preset;}else arr.push(preset); await persistExplorerPresets();document.getElementById('slotCheckPreset').value=preset.id;
}
function loadAnalysisPresetById(id) { const p=state.explorerPresets.analysis_presets.find(x=>x.id===id);if(!p)return;applySlotChecksSettings(p.settings||{});const help=document.getElementById('slotCheckPresetHelp');if(help)help.textContent=p.description||`Loaded ${p.name}. Review the year/value fields, then run analysis.`; }

document.getElementById('loadExplorerPlotPreset')?.addEventListener('click',()=>loadPlotPresetById(document.getElementById('explorerPlotPreset')?.value));
document.getElementById('saveExplorerPlotPreset')?.addEventListener('click',()=>saveCurrentPlotPreset().catch(err=>showError(err.message)));
document.getElementById('deleteExplorerPlotPreset')?.addEventListener('click',()=>deleteSelectedPreset('plot').catch(err=>showError(err.message)));
document.getElementById('loadSlotCheckPreset')?.addEventListener('click',()=>loadAnalysisPresetById(document.getElementById('slotCheckPreset')?.value));
document.getElementById('saveSlotCheckPreset')?.addEventListener('click',()=>saveCurrentAnalysisPreset().catch(err=>showError(err.message)));
document.getElementById('deleteSlotCheckPreset')?.addEventListener('click',()=>deleteSelectedPreset('analysis').catch(err=>showError(err.message)));
fetchExplorerPresets().catch(err=>console.warn('Explorer presets unavailable:',err));


/* Stack management controls */
document.getElementById('applyExplorerStack')?.addEventListener('click',async()=>{
  const additions=[...(explorerStackSlots?.selectedOptions||[])].map(o=>o.value).filter(Boolean); ensureExplorerStackItems(state.explorerData?.slot||explorerSlot?.value||''); additions.forEach(slot=>state.explorerStackItems.push(createExplorerStackItem(slot,{plot_type:'line',transform:'raw'}))); syncLegacyExplorerStackState(); if(explorerStackSlots)[...explorerStackSlots.options].forEach(o=>o.selected=false); await refreshExplorerStack(); renderExplorerStackList(); renderExplorerTable();
});
document.getElementById('clearExplorerStack')?.addEventListener('click',async()=>{
  ensureExplorerStackItems(state.explorerData?.slot||explorerSlot?.value||''); const primary=(state.explorerStackItems||[])[0]; if(primary)state.explorerStackItems=[primary]; syncLegacyExplorerStackState(); await refreshExplorerStack({silent:true}); renderExplorerStackList(); renderExplorerTable();
});

/* ============================================================
   v4.4.4 PER-CHART SYNCHRONIZED STACKS
   Each plot instance owns its slot, chart type, transform, year,
   sort order, and reference lines. Duplicate slots are supported.
   ============================================================ */

function nextExplorerStackItemId() {
  state.explorerStackItemSeq = Number(state.explorerStackItemSeq || 0) + 1;
  return `plot-${state.explorerStackItemSeq}`;
}

function normalizeExplorerReferenceLine(line={}) {
  const rawValue = line?.value;
  const value = rawValue !== '' && rawValue != null && Number.isFinite(Number(rawValue)) ? Number(rawValue) : '';
  const allowed = new Set(['solid','dot','dash','longdash','dashdot','longdashdot']);
  const colorText = String(line?.color || '#c0392b').trim();
  const color = /^#[0-9a-f]{6}$/i.test(colorText) ? colorText : '#c0392b';
  const widthNumber = Number(line?.width);
  return {
    value,
    label:String(line?.label || '').trim(),
    color,
    dash:allowed.has(String(line?.dash || '')) ? String(line.dash) : 'dash',
    width:Number.isFinite(widthNumber) ? Math.max(0.5, widthNumber) : 1.25
  };
}

function referenceLinesToText(lines=[]) {
  return (lines || []).map(line => {
    const r = normalizeExplorerReferenceLine(line);
    return [r.value, r.label, r.color, r.dash, r.width].join(' | ');
  }).join('\n');
}

function referenceLinesFromText(text='') {
  const result=[];
  String(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).forEach((line,index)=>{
    const parts=line.split('|').map(part=>part.trim());
    const value=Number(parts[0]);
    if(!Number.isFinite(value)) throw new Error(`Reference line ${index+1}: "${parts[0] || ''}" is not a valid numeric value.`);
    result.push(normalizeExplorerReferenceLine({value,label:parts[1] || String(value),color:parts[2] || '#c0392b',dash:parts[3] || 'dash',width:parts[4] || 1.25}));
  });
  return result;
}

function normalizeExplorerStackItem(item={}) {
  const slot=String(item?.slot || '').trim();
  if(!slot) return null;
  return {
    id:String(item.id || nextExplorerStackItemId()),
    slot,
    plot_type:['line','box','bar','stacked_bar','scatter'].includes(item.plot_type) ? item.plot_type : 'line',
    plot_slots:Array.isArray(item.plot_slots) ? [...new Set(item.plot_slots.map(String).map(x=>x.trim()).filter(Boolean))] : [],
    stacked_sort_slot:String(item.stacked_sort_slot || ''),
    stacked_legend_position:item.stacked_legend_position==='top'?'top':'bottom',
    y_slot:String(item.y_slot || '').trim(),
    scatter_transform:['raw','water_year_sum','calendar_year_sum','annual_raw'].includes(item.scatter_transform) ? item.scatter_transform : 'raw',
    scatter_x_transform:['raw','water_year_sum','calendar_year_sum','annual_raw'].includes(item.scatter_x_transform) ? item.scatter_x_transform : (['raw','water_year_sum','calendar_year_sum','annual_raw'].includes(item.scatter_transform) ? item.scatter_transform : 'raw'),
    scatter_y_transform:['raw','water_year_sum','calendar_year_sum','annual_raw'].includes(item.scatter_y_transform) ? item.scatter_y_transform : 'raw',
    scatter_year:item.scatter_year == null ? '' : String(item.scatter_year),
    scatter_basis:item.scatter_basis === 'water' ? 'water' : 'calendar',
    scatter_x_basis:item.scatter_x_basis === 'water' ? 'water' : 'calendar',
    scatter_y_basis:item.scatter_y_basis === 'water' ? 'water' : 'calendar',
    transform:['raw','water_year_sum','calendar_year_sum','annual_raw'].includes(item.transform) ? item.transform : 'raw',
    annual_year:item.annual_year == null ? '' : String(item.annual_year),
    bar_sort:['none','asc','desc'].includes(item.bar_sort) ? item.bar_sort : 'none',
    reference_lines:Array.isArray(item.reference_lines) ? item.reference_lines.map(normalizeExplorerReferenceLine) : [],
    title:String(item.title || ''), subtitle:String(item.subtitle || ''),
    x_axis_title:String(item.x_axis_title || ''), y_axis_title:String(item.y_axis_title || ''),
    line_width:Number.isFinite(Number(item.line_width)) ? Number(item.line_width) : 1,
    show_grid:item.show_grid !== false,
    y_axis_mode:item.y_axis_mode === 'fixed' ? 'fixed' : 'auto',
    y_min:item.y_min === '' || item.y_min == null ? '' : Number(item.y_min),
    y_max:item.y_max === '' || item.y_max == null ? '' : Number(item.y_max),
    percentile_band:Boolean(item.percentile_band),
    percentile_low:Number.isFinite(Number(item.percentile_low)) ? Number(item.percentile_low) : 10,
    percentile_high:Number.isFinite(Number(item.percentile_high)) ? Number(item.percentile_high) : 90,
    unit_factor:Number.isFinite(Number(item.unit_factor)) ? Number(item.unit_factor) : 1,
    unit_offset:Number.isFinite(Number(item.unit_offset)) ? Number(item.unit_offset) : 0,
    display_unit:String(item.display_unit || '')
  };
}

function legacyExplorerStackItems(settings={}) {
  const primary=String(settings.slot || state.explorerData?.slot || explorerSlot?.value || '').trim();
  const order=(Array.isArray(settings.stack_order) && settings.stack_order.length) ? settings.stack_order : [primary, ...(settings.stack_slots || [])];
  const unique=[];
  for(const slot of order.filter(Boolean)) if(!unique.includes(slot)) unique.push(slot);
  return unique.map((slot,index)=>normalizeExplorerStackItem({
    slot,
    plot_type:settings.stack_plot_types?.[slot] || (index===0 ? settings.plot_type : 'line'),
    transform:settings.transform || 'raw',
    annual_year:settings.annual_year || '',
    bar_sort:settings.bar_sort || 'none',
    reference_lines:[]
  })).filter(Boolean);
}

function createExplorerStackItem(slot, overrides={}) {
  return normalizeExplorerStackItem({id:nextExplorerStackItemId(),slot,...overrides,plot_type:overrides.plot_type || 'line',transform:overrides.transform || 'raw',annual_year:overrides.annual_year || '',bar_sort:overrides.bar_sort || 'none',reference_lines:overrides.reference_lines || []});
}

function ensureExplorerStackItems(primarySlot='') {
  const primary=String(primarySlot || state.explorerData?.slot || explorerSlot?.value || '').trim();
  if(!Array.isArray(state.explorerStackItems)) state.explorerStackItems=[];
  if(!state.explorerStackItems.length) {
    const legacy=legacyExplorerStackItems({...state.explorerSettings,slot:primary});
    state.explorerStackItems=legacy.length ? legacy : (primary ? [createExplorerStackItem(primary,{plot_type:'line',transform:'raw'})] : []);
  }
  state.explorerStackItems=state.explorerStackItems.map(normalizeExplorerStackItem).filter(Boolean);
  syncLegacyExplorerStackState();
  return state.explorerStackItems;
}

function syncLegacyExplorerStackState() {
  const items=state.explorerStackItems || [];
  state.explorerStackSlots=items.slice(1).map(item=>item.slot);
  state.explorerStackOrder=items.map(item=>item.slot);
  state.explorerStackPlotTypes={};
  for(const item of items) state.explorerStackPlotTypes[item.slot]=item.plot_type;
  state.explorerSettings.stack_slots=[...state.explorerStackSlots];
  state.explorerSettings.stack_order=[...state.explorerStackOrder];
  state.explorerSettings.stack_plot_types={...state.explorerStackPlotTypes};
  state.explorerSettings.stack_items=items.map(item=>({...item,reference_lines:(item.reference_lines||[]).map(line=>({...line}))}));
  if(items[0]?.slot) state.explorerSettings.slot=items[0].slot;
}

function explorerStackItemById(id) {
  return (state.explorerStackItems || []).find(item=>item.id===id) || null;
}

function explorerSlotAvailabilityKnown() {
  return Boolean(state.rdfSessionId) && Array.isArray(state.discoveredSlots);
}

function explorerSlotIsAvailable(slot) {
  const name=String(slot || '').trim();
  if(!name) return false;
  if(!explorerSlotAvailabilityKnown()) return true;
  return (state.discoveredSlots || []).includes(name);
}

function explorerAvailableStackItems() {
  return (state.explorerStackItems || []).filter(item=>explorerSlotIsAvailable(item.slot));
}

function explorerUnavailableStackItems() {
  if(!explorerSlotAvailabilityKnown()) return [];
  return (state.explorerStackItems || []).filter(item=>!explorerSlotIsAvailable(item.slot));
}

function explorerPlotEntries() {
  ensureExplorerStackItems();
  return (state.explorerStackItems || []).map((item,index)=>{
    if(!explorerSlotIsAvailable(item.slot) || (item.plot_type==='scatter' && item.y_slot && !explorerSlotIsAvailable(item.y_slot)) || (item.plot_type==='stacked_bar' && (item.plot_slots||[]).some(slot=>!explorerSlotIsAvailable(slot)))) return {...item,data:null,index,unavailable:true};
    let data=null;
    if(state.explorerData?.slot===item.slot) data=state.explorerData;
    if(!data) data=state.explorerStackData?.get(item.slot) || null;
    const yData=item.plot_type==='scatter' && item.y_slot ? (item.y_slot===item.slot ? data : state.explorerStackData?.get(item.y_slot) || null) : null;
    return {...item,data,index,yData,unavailable:!data || (item.plot_type==='scatter' && item.y_slot && !yData)};
  }).filter(entry=>entry.data);
}

function explorerDatasetEntries() {
  return explorerPlotEntries().map(entry=>[entry.slot,entry.data,entry]);
}

function explorerPlotTypeForSlot(slotOrId) {
  const item=explorerStackItemById(slotOrId) || (state.explorerStackItems || []).find(entry=>entry.slot===slotOrId);
  return item?.plot_type || 'line';
}

function explorerTransformLabel(value) {
  return ({raw:'Raw timestep values',water_year_sum:'Water-year sum by trace',calendar_year_sum:'Calendar-year sum by trace',annual_raw:'Annual values by trace'})[value] || value;
}

function explorerPlotEntryLabel(item) {
  let suffix=explorerTransformLabel(item.transform);
  if(item.plot_type==='bar' && item.annual_year) suffix += ` · ${item.annual_year}`;
  return `${item.slot} · ${suffix}`;
}

function setExplorerStackItem(id, patch={}) {
  const item=explorerStackItemById(id);
  if(!item) return;
  Object.assign(item,patch);
  syncLegacyExplorerStackState();
  renderExplorerPlot();
  renderExplorerTable();
  renderExplorerStackList();
}

async function moveExplorerStackItem(id,direction) {
  const items=state.explorerStackItems || [];
  const index=items.findIndex(item=>item.id===id);
  if(index<0) return;
  const newIndex=direction==='up' ? index-1 : index+1;
  if(newIndex<0 || newIndex>=items.length) return;
  [items[index],items[newIndex]]=[items[newIndex],items[index]];
  if(index===0 || newIndex===0) {
    const preferred=items.find(item=>explorerSlotIsAvailable(item.slot));
    if(preferred) {
      if(explorerSlot && [...explorerSlot.options].some(option=>option.value===preferred.slot)) explorerSlot.value=preferred.slot;
      const payload=state.explorerStackData.get(preferred.slot) || (state.explorerData?.slot===preferred.slot ? state.explorerData : null);
      if(payload) state.explorerData=payload;
      else state.explorerData=await getExplorerSlotPayload(preferred.slot);
    }
  }
  syncLegacyExplorerStackState();
  await refreshExplorerStack({silent:true});
}

async function removeExplorerPlotItem(id) {
  ensureExplorerStackItems();
  const items=state.explorerStackItems;
  if(items.length<=1) { showError('At least one Explorer plot must remain. Add another plot before removing this one.'); return; }
  const index=items.findIndex(item=>item.id===id);
  if(index<0) return;
  const removed=items[index];
  items.splice(index,1);

  const activeStillInStack=items.some(item=>item.slot===state.explorerData?.slot && explorerSlotIsAvailable(item.slot));
  if(!activeStillInStack || index===0) {
    const preferred=items.find(item=>explorerSlotIsAvailable(item.slot));
    if(preferred) {
      if(explorerSlot && [...explorerSlot.options].some(option=>option.value===preferred.slot)) explorerSlot.value=preferred.slot;
      state.explorerData=state.explorerStackData.get(preferred.slot) || (state.explorerData?.slot===preferred.slot ? state.explorerData : null) || await getExplorerSlotPayload(preferred.slot);
    } else if(removed?.slot===state.explorerData?.slot) {
      state.explorerData=null;
    }
  }
  syncLegacyExplorerStackState();
  await refreshExplorerStack({silent:true});
}

function populateExplorerStackOptions() {
  if(!explorerStackSlots) return;
  explorerStackSlots.innerHTML=(state.discoveredSlots || []).map(slot=>`<option value="${escapeHtml(slot)}" title="${escapeHtml(slot)}">${escapeHtml(slot)}</option>`).join('') || '<option value="">Discover RDF slots first</option>';
  [...explorerStackSlots.options].forEach(option=>{option.selected=false;});
  updateExplorerStackSummary();
  renderExplorerStackList();
}

function updateExplorerStackSummary() {
  if(!explorerStackSummary) return;
  const count=Math.max(0,(state.explorerStackItems || []).length);
  if(!count) { explorerStackSummary.textContent='Primary slot only'; return; }
  const unavailable=explorerUnavailableStackItems().length;
  const available=count-unavailable;
  explorerStackSummary.textContent=unavailable
    ? `${available} available · ${unavailable} unavailable (saved)`
    : `${count} synchronized plot${count===1?'':'s'}`;
}

async function refreshExplorerStack({silent=false}={}) {
  ensureExplorerStackItems(state.explorerData?.slot || explorerSlot?.value || '');

  const availableItems=explorerAvailableStackItems();
  const unavailableItems=explorerUnavailableStackItems();

  // Preserve unavailable profile items in the stack definition, but never request
  // them from the current RDF session. This lets a portable profile survive a
  // run where one or more previously configured slots are absent.
  if(!availableItems.length) {
    state.explorerStackData=new Map();
    renderExplorerPlot();
    renderExplorerTable();
    updateExplorerStackSummary();
    renderExplorerStackList();
    return;
  }

  let activeSlot=state.explorerData?.slot || '';
  const activeStillAvailable=availableItems.some(item=>item.slot===activeSlot);

  try {
    if(!activeStillAvailable) {
      activeSlot=availableItems[0].slot;
      state.explorerData=await getExplorerSlotPayload(activeSlot);
      if(explorerSlot && [...explorerSlot.options].some(option=>option.value===activeSlot)) explorerSlot.value=activeSlot;
      state.explorerSettings.slot=activeSlot;
    }

    const wanted=[...new Set(availableItems.flatMap(item=>[item.slot,item.plot_type==='scatter'?item.y_slot:'',...(item.plot_type==='stacked_bar'?(item.plot_slots||[]):[])]).filter(slot=>slot && slot!==activeSlot))];

    if(!silent && wanted.some(slot=>!explorerSlotCacheState(slot).fast)) {
      setLoading('Loading stacked plots','Loading available RDF slots once. Profile slots that are absent from this RDF set will be skipped.');
    }

    const settled=await Promise.allSettled(wanted.map(async slot=>[slot,await getExplorerSlotPayload(slot)]));
    const loaded=[];
    const failed=[];
    for(const result of settled) {
      if(result.status==='fulfilled') loaded.push(result.value);
      else failed.push(result.reason);
    }
    state.explorerStackData=new Map(loaded);

    renderExplorerPlot();
    renderExplorerTable();
    updateExplorerStackSummary();
    renderExplorerStackList();

    if(failed.length) {
      console.warn('Some available stacked slots could not be loaded:',failed);
    }
    if(unavailableItems.length) {
      console.info('Skipped profile slots not present in the current RDF set:',unavailableItems.map(item=>item.slot));
    }
  } catch(err) {
    showError(err.message || 'Could not load the available stacked RDF slots.');
  } finally {
    if(!silent) clearLoading();
  }
}

function renderExplorerStackList() {
  const host=document.getElementById('explorerStackList');
  if(!host) return;
  const items=ensureExplorerStackItems();
  if(!items.length) { host.innerHTML='<span class="field-help">Load a slot to start a synchronized stack.</span>'; return; }
  host.innerHTML=items.map((item,index)=>{
    const unavailable=explorerSlotAvailabilityKnown() && !explorerSlotIsAvailable(item.slot);
    const status=unavailable ? '<small class="stack-slot-status">Unavailable in current RDFs · saved in profile</small>' : '';
    return `<div class="explorer-stack-chip explorer-stack-row${unavailable?' is-unavailable':''}" data-stack-id="${escapeHtml(item.id)}" data-slot-available="${unavailable?'false':'true'}">
      <span class="stack-slot-name" title="${escapeHtml(item.slot)}">${escapeHtml(item.plot_type==='scatter' ? `${item.slot} vs ${item.y_slot || 'Y slot'}` : item.slot)}<small>${escapeHtml(item.plot_type==='scatter' ? explorerTransformLabel(item.scatter_transform) : explorerTransformLabel(item.transform))}${item.plot_type==='bar'&&item.annual_year?` · ${escapeHtml(item.annual_year)}`:''}</small>${status}</span>
      <span class="stack-type-badge">${unavailable?'missing':escapeHtml(item.plot_type)}</span>
      <button type="button" class="stack-order-button" data-stack-move="up" ${index===0?'disabled':''}>↑</button>
      <button type="button" class="stack-order-button" data-stack-move="down" ${index===items.length-1?'disabled':''}>↓</button>
      <button type="button" data-stack-remove>Remove</button>
    </div>`;
  }).join('');
  host.querySelectorAll('[data-stack-id]').forEach(row=>{
    const id=row.dataset.stackId;
    row.querySelector('[data-stack-remove]')?.addEventListener('click',()=>removeExplorerPlotItem(id));
    row.querySelectorAll('[data-stack-move]').forEach(button=>button.addEventListener('click',()=>moveExplorerStackItem(id,button.dataset.stackMove)));
  });
}

function explorerPointYear(point) {
  const direct=Number(point?.source?.year ?? point?.year);
  if(Number.isFinite(direct)) return String(direct);
  const match=String(point?.label ?? point?.x ?? '').match(/(20\d{2})/);
  return match ? match[1] : '';
}

function stackItemYears(item,data) {
  const years=new Set();
  const datasets=item.plot_type==='stacked_bar'?[...new Set([item.slot,...(item.plot_slots||[])])].map(slot=>slot===item.slot?data:state.explorerStackData?.get(slot)).filter(Boolean):[data];
  for(const dataset of datasets) for(const runKey of ['current','previous']) {
    for(const trace of explorerVisibleTransformedFor(dataset,runKey,item.transform || 'raw')) {
      for(const point of trace.points) { const year=explorerPointYear(point); if(year) years.add(year); }
    }
  }
  return [...years].sort((a,b)=>Number(a)-Number(b));
}

function scatterYearOptions(item,data) {
  const years=new Set();
  const datasets=[data, item?.yData].filter(Boolean);
  for(const dataset of datasets) for(const runKey of ['current','previous']) {
    const run=dataset[runKey]; if(!run) continue;
    for(const trace of (run.traces||[])) for(const value of (trace.values||[])) {
      const date=String(value.period_date||'');
      const year=Number(value.year);
      if(/^\d{4}-\d{2}-\d{2}/.test(date)) years.add(date.slice(0,4));
      else if(Number.isFinite(year)) years.add(String(year));
    }
  }
  return [...years].sort((a,b)=>Number(a)-Number(b));
}

function stackCardControls(item,data,index,count) {
  const years=stackItemYears(item,data), showYear=['bar','stacked_bar'].includes(item.plot_type);
  const controlsOpen=state.explorerOpenChartControls == null || state.explorerOpenChartControls.has(item.id);
  return `<div class="explorer-plot-card-header">
    <div class="plot-card-slot" title="${escapeHtml(item.slot)}"><strong>${escapeHtml(item.title || item.slot)}</strong><small>${escapeHtml(item.slot)} · ${escapeHtml(explorerTransformLabel(item.transform))}</small></div>
    <details class="plot-card-controls-collapsible" ${controlsOpen?'open':''}><summary>Chart controls</summary><div class="plot-card-controls">
      <label>Chart<select data-card-plot-type="${escapeHtml(item.id)}"><option value="line" ${item.plot_type==='line'?'selected':''}>Line</option><option value="box" ${item.plot_type==='box'?'selected':''}>Box</option><option value="bar" ${item.plot_type==='bar'?'selected':''}>Bar</option><option value="stacked_bar" ${item.plot_type==='stacked_bar'?'selected':''}>Stacked bar</option><option value="scatter" ${item.plot_type==='scatter'?'selected':''}>Scatter</option></select></label>
      ${item.plot_type==='stacked_bar'?`<label>Stack slots<select multiple size="4" data-card-stacked-slots="${escapeHtml(item.id)}">${(state.discoveredSlots||[]).map(slot=>`<option value="${escapeHtml(slot)}" ${(item.plot_slots||[item.slot]).includes(slot)?'selected':''}>${escapeHtml(slot)}</option>`).join('')}</select></label><label>Sort by<select data-card-stacked-sort="${escapeHtml(item.id)}"><option value="" ${!item.stacked_sort_slot?'selected':''}>Choose slot</option>${(item.plot_slots||[item.slot]).map(slot=>`<option value="${escapeHtml(slot)}" ${item.stacked_sort_slot===slot?'selected':''}>${escapeHtml(slot)}</option>`).join('')}</select></label><label>Sort order<select data-card-stacked-direction="${escapeHtml(item.id)}"><option value="none" ${item.bar_sort==='none'?'selected':''}>Trace (default)</option><option value="asc" ${item.bar_sort==='asc'?'selected':''}>Ascending</option><option value="desc" ${item.bar_sort==='desc'?'selected':''}>Descending</option></select></label><label>Legend position<select data-card-stacked-legend="${escapeHtml(item.id)}"><option value="bottom" ${item.stacked_legend_position!=='top'?'selected':''}>Bottom</option><option value="top" ${item.stacked_legend_position==='top'?'selected':''}>Top</option></select></label><div class="stacked-slot-order">${(item.plot_slots||[item.slot]).map((slot,slotIndex)=>`<div><span>${slotIndex+1}. ${escapeHtml(slot)}</span><button type="button" class="mini-button" data-stacked-slot-move="up" data-item-id="${escapeHtml(item.id)}" data-slot-index="${slotIndex}" ${slotIndex===0?'disabled':''}>↑</button><button type="button" class="mini-button" data-stacked-slot-move="down" data-item-id="${escapeHtml(item.id)}" data-slot-index="${slotIndex}" ${slotIndex===((item.plot_slots||[item.slot]).length-1)?'disabled':''}>↓</button></div>`).join('')}</div>`:''}
      ${item.plot_type==='scatter'?`<label>Y slot<select data-card-y-slot="${escapeHtml(item.id)}">${(state.discoveredSlots||[]).map(slot=>`<option value="${escapeHtml(slot)}" ${item.y_slot===slot?'selected':''}>${escapeHtml(slot)}</option>`).join('')}</select></label><button class="mini-button" data-card-swap="${escapeHtml(item.id)}" type="button">Swap X/Y</button>`:''}
      <label>Data<select data-card-transform="${escapeHtml(item.id)}"><option value="raw" ${item.transform==='raw'?'selected':''}>Raw values</option><option value="water_year_sum" ${item.transform==='water_year_sum'?'selected':''}>Water-year sum</option><option value="calendar_year_sum" ${item.transform==='calendar_year_sum'?'selected':''}>Calendar-year sum</option><option value="annual_raw" ${item.transform==='annual_raw'?'selected':''}>Annual values</option></select></label>
      ${item.plot_type==='scatter'?`<label>X treatment<select data-card-scatter-x-transform="${escapeHtml(item.id)}"><option value="raw" ${item.scatter_x_transform==='raw'?'selected':''}>End-of-year value</option><option value="water_year_sum" ${item.scatter_x_transform==='water_year_sum'?'selected':''}>Water-year sum</option><option value="calendar_year_sum" ${item.scatter_x_transform==='calendar_year_sum'?'selected':''}>Calendar-year sum</option><option value="annual_raw" ${item.scatter_x_transform==='annual_raw'?'selected':''}>Annual value</option></select></label><label>Y treatment<select data-card-scatter-y-transform="${escapeHtml(item.id)}"><option value="raw" ${item.scatter_y_transform==='raw'?'selected':''}>End-of-year value</option><option value="water_year_sum" ${item.scatter_y_transform==='water_year_sum'?'selected':''}>Water-year sum</option><option value="calendar_year_sum" ${item.scatter_y_transform==='calendar_year_sum'?'selected':''}>Calendar-year sum</option><option value="annual_raw" ${item.scatter_y_transform==='annual_raw'?'selected':''}>Annual value</option></select></label><label>Year<select data-card-scatter-year="${escapeHtml(item.id)}"><option value="">Latest available</option>${scatterYearOptions(item,data).map(year=>`<option value="${year}" ${String(item.scatter_year)===String(year)?'selected':''}>${year}</option>`).join('')}</select></label><label>X end basis<select data-card-scatter-x-basis="${escapeHtml(item.id)}" ${item.scatter_x_transform==='raw'?'':'disabled'}><option value="calendar" ${item.scatter_x_basis==='calendar'?'selected':''}>Calendar year (Dec)</option><option value="water" ${item.scatter_x_basis==='water'?'selected':''}>Water year (Sep)</option></select></label><label>Y end basis<select data-card-scatter-y-basis="${escapeHtml(item.id)}" ${item.scatter_y_transform==='raw'?'':'disabled'}><option value="calendar" ${item.scatter_y_basis==='calendar'?'selected':''}>Calendar year (Dec)</option><option value="water" ${item.scatter_y_basis==='water'?'selected':''}>Water year (Sep)</option></select></label>`:''}
      ${showYear?`<label>Year<select data-card-year="${escapeHtml(item.id)}"><option value="">Latest</option>${years.map(year=>`<option value="${year}" ${String(item.annual_year)===String(year)?'selected':''}>${year}</option>`).join('')}</select></label>${item.plot_type==='bar'?`<label>Order<select data-card-bar-sort="${escapeHtml(item.id)}"><option value="none" ${item.bar_sort==='none'?'selected':''}>Trace</option><option value="asc" ${item.bar_sort==='asc'?'selected':''}>Ascending</option><option value="desc" ${item.bar_sort==='desc'?'selected':''}>Descending</option></select></label>`:''}`:''}
      <button class="mini-button" data-card-move="up" data-card-id="${escapeHtml(item.id)}" ${index===0?'disabled':''}>↑</button><button class="mini-button" data-card-move="down" data-card-id="${escapeHtml(item.id)}" ${index===count-1?'disabled':''}>↓</button><button class="mini-button danger-lite" data-card-remove="${escapeHtml(item.id)}" ${count<=1?'disabled':''}>Remove</button>
    </div></details>
  </div>
  <details class="plot-display-settings"><summary>Plot settings</summary><div class="plot-settings-grid">
    <label class="wide">Plot title<input data-item-setting="title" data-item-id="${item.id}" value="${escapeHtml(item.title)}" placeholder="Defaults to Object.Slot"></label>
    <label class="wide">Plot subtitle<input data-item-setting="subtitle" data-item-id="${item.id}" value="${escapeHtml(item.subtitle)}" placeholder="Automatic"></label>
    <label>X-axis label<input data-item-setting="x_axis_title" data-item-id="${item.id}" value="${escapeHtml(item.x_axis_title)}" placeholder="Automatic"></label>
    <label>Y-axis label<input data-item-setting="y_axis_title" data-item-id="${item.id}" value="${escapeHtml(item.y_axis_title)}" placeholder="Automatic from RDF"></label>
    <label>Line width<input type="number" min="0.5" max="4" step="0.1" data-item-setting="line_width" data-item-id="${item.id}" value="${item.line_width}"></label>
    <label class="checkbox-setting compact"><span class="checkbox-line"><input type="checkbox" data-item-setting="show_grid" data-item-id="${item.id}" ${item.show_grid?'checked':''}> Show gridlines</span></label>
    <label>Y-axis mode<select data-item-setting="y_axis_mode" data-item-id="${item.id}"><option value="auto" ${item.y_axis_mode==='auto'?'selected':''}>Automatic</option><option value="fixed" ${item.y_axis_mode==='fixed'?'selected':''}>Fixed limits</option></select></label>
    <label>Y minimum<input type="number" step="any" data-item-setting="y_min" data-item-id="${item.id}" value="${item.y_min}"></label>
    <label>Y maximum<input type="number" step="any" data-item-setting="y_max" data-item-id="${item.id}" value="${item.y_max}"></label>
    <label class="checkbox-setting compact"><span class="checkbox-line"><input type="checkbox" data-item-setting="percentile_band" data-item-id="${item.id}" ${item.percentile_band?'checked':''}> Percentile band</span></label>
    <label>Lower percentile<input type="number" min="0" max="100" data-item-setting="percentile_low" data-item-id="${item.id}" value="${item.percentile_low}"></label>
    <label>Upper percentile<input type="number" min="0" max="100" data-item-setting="percentile_high" data-item-id="${item.id}" value="${item.percentile_high}"></label>
    <label>Display scale factor<input type="number" step="any" data-item-setting="unit_factor" data-item-id="${item.id}" value="${item.unit_factor}"></label>
    <label>Display offset<input type="number" step="any" data-item-setting="unit_offset" data-item-id="${item.id}" value="${item.unit_offset}"></label>
    <label>Display units<input data-item-setting="display_unit" data-item-id="${item.id}" value="${escapeHtml(item.display_unit)}" placeholder="Use RDF units"></label>
  </div></details>`;
}
function renderExplorerReferenceLinesEditor(item) {
  const lines=item.reference_lines || [];
  const text=referenceLinesToText(lines);
  return `<details class="plot-reference-editor" data-reference-editor="${escapeHtml(item.id)}">
    <summary>Reference lines <span class="reference-count">${lines.length}</span></summary>
    <div class="plot-reference-editor-body">
      <p class="field-help">One line per reference: <code>value | label | color | style | width</code></p>
      <textarea rows="4" data-reference-text="${escapeHtml(item.id)}" spellcheck="false" placeholder="3525 | Upper Basin DCP Trigger | #c0392b | dash | 1.25&#10;3490 | Minimum Power Pool | #d35400 | dot | 1.25">${escapeHtml(text)}</textarea>
      <div class="explorer-button-row"><button type="button" class="mini-button" data-reference-apply="${escapeHtml(item.id)}">Apply reference lines</button><button type="button" class="mini-button" data-reference-clear="${escapeHtml(item.id)}">Clear</button></div>
      <small class="field-help">Styles: solid, dot, dash, longdash, dashdot, longdashdot.</small>
    </div>
  </details>`;
}

function applyExplorerPlotHeight() {
  const height = Math.max(
    250,
    Math.min(700, Number(explorerPlotHeight?.value || 400))
  );

  if (explorerPlotHeightValue) {
    explorerPlotHeightValue.value = `${height} px`;
  }

  document.querySelectorAll('#explorerPlotStack .explorer-plot').forEach(plot => {
    plot.style.height = `${height}px`;
    plot.style.minHeight = `${height}px`;

    if (
      typeof Plotly !== 'undefined' &&
      plot.classList.contains('js-plotly-plot')
    ) {
      try {
        Plotly.Plots.resize(plot);
      } catch (error) {
        console.warn('Could not resize Explorer plot:', error);
      }
    }
  });

  state.explorerSettings.plot_height = height;
}


function applyExplorerGridColumns(){const host=document.getElementById('explorerPlotStack'),sel=document.getElementById('explorerGridColumns');if(!host)return;const v=sel?.value||'2';host.dataset.columns=v;}
document.getElementById('explorerGridColumns')?.addEventListener('change',()=>{applyExplorerGridColumns();setTimeout(()=>document.querySelectorAll('#explorerPlotStack .explorer-plot').forEach(p=>{try{Plotly.Plots.resize(p)}catch{}}),0);});

function renderExplorerPlot() {
  const host=document.getElementById('explorerPlotStack');
  if(!host) return;
  if(!state.explorerData || typeof Plotly==='undefined') {
    host.innerHTML='<div class="explorer-plot-card"><div id="explorerPlot" class="explorer-plot"><div class="empty-preview"><strong>Choose a slot</strong><p>Cached slots load immediately. Other slots show a Load slot button beside the selector.</p></div></div></div>';
    renderExplorerStackList();
    return;
  }
  const entries=explorerPlotEntries();
  if(!entries.length) {
    const unavailable=explorerUnavailableStackItems();
    host.innerHTML=`<div class="explorer-plot-card"><div class="explorer-plot"><div class="empty-preview"><strong>No saved profile plots are available in this RDF set</strong><p>${unavailable.length ? `${unavailable.length} saved plot${unavailable.length===1?' is':'s are'} being kept in the profile but skipped for this run.` : 'Choose an available slot to begin.'}</p></div></div></div>`;
    renderExplorerStackList();
    updateExplorerStackSummary();
    return;
  }
  const existingControlDetails=[...host.querySelectorAll('.plot-card-controls-collapsible')];
  state.explorerOpenChartControls=existingControlDetails.length
    ? new Set(existingControlDetails.filter(details=>details.open).map(details=>details.closest('.explorer-plot-card')?.dataset.stackId).filter(Boolean))
    : new Set(entries.map(entry=>entry.id));
  applyExplorerGridColumns();
  host.innerHTML=entries.map((entry,index)=>`<div class="explorer-plot-card" data-stack-id="${escapeHtml(entry.id)}" data-slot="${escapeHtml(entry.slot)}">
    ${stackCardControls(entry,entry.data,index,entries.length)}
    ${renderExplorerReferenceLinesEditor(entry)}
    <div id="explorerPlotInstance${index}" class="explorer-plot"></div>
    ${entry.plot_type==='scatter'?`<div class="scatter-data-table" data-scatter-table="${escapeHtml(entry.id)}"></div>`:''}
  </div>`).join('');
  entries.forEach((entry,index)=>{
    const plotElement = document.getElementById(`explorerPlotInstance${index}`);

    if (plotElement) {
      const height = Math.max(
        250,
        Math.min(700, Number(explorerPlotHeight?.value || 400))
      );

      plotElement.style.height = `${height}px`;
      plotElement.style.minHeight = `${height}px`;
    }

    renderOneExplorerPlot(
      plotElement,
      entry.data,
      entry.slot,
      index,
      entries.length,
      entry
    );
  });
  setTimeout(()=>{
    const scatterPlots=[...host.querySelectorAll('.explorer-plot-card')].filter(card=>explorerStackItemById(card.dataset.stackId)?.plot_type==='scatter').map(card=>card.querySelector('.explorer-plot')).filter(plot=>plot?.layout?.xaxis?.range?.length===2);
    const sharedRange=scatterPlots[0]?.layout?.xaxis?.range;
    if(sharedRange) scatterPlots.slice(1).forEach(plot=>Plotly.relayout(plot,{'xaxis.range':[...sharedRange],'xaxis.autorange':false,'yaxis.autorange':true}));
    renderScatterDataTables();
  },50);

  applyExplorerPlotHeight();

  host.querySelectorAll('[data-card-plot-type]').forEach(el=>el.addEventListener('change',async()=>{const current=explorerStackItemById(el.dataset.cardPlotType);const firstScatter=(state.explorerStackItems||[]).find(item=>item.plot_type==='scatter');setExplorerStackItem(el.dataset.cardPlotType,{plot_type:el.value,annual_year:['bar','stacked_bar'].includes(el.value)?(current?.annual_year || ''):'',plot_slots:el.value==='stacked_bar'&&!(current?.plot_slots||[]).length?[current?.slot].filter(Boolean):(current?.plot_slots||[]),scatter_year:el.value==='scatter'?(firstScatter?.scatter_year || current?.scatter_year || ''):(current?.scatter_year || '')});if(el.value==='stacked_bar')await refreshExplorerStack({silent:true});}));
  host.querySelectorAll('[data-card-stacked-slots]').forEach(el=>el.addEventListener('change',async()=>{const item=explorerStackItemById(el.dataset.cardStackedSlots);if(!item)return;const chosen=[...el.selectedOptions].map(option=>option.value);item.plot_slots=[...(item.plot_slots||[]).filter(slot=>chosen.includes(slot)),...chosen.filter(slot=>!(item.plot_slots||[]).includes(slot))];if(!item.plot_slots.includes(item.slot))item.plot_slots.unshift(item.slot);if(!item.stacked_sort_slot)item.stacked_sort_slot=item.plot_slots[0]||'';syncLegacyExplorerStackState();await refreshExplorerStack({silent:true});}));
  host.querySelectorAll('[data-card-stacked-sort]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardStackedSort,{stacked_sort_slot:el.value})));
  host.querySelectorAll('[data-card-stacked-direction]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardStackedDirection,{bar_sort:el.value})));
  host.querySelectorAll('[data-card-stacked-legend]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardStackedLegend,{stacked_legend_position:el.value})));
  host.querySelectorAll('[data-stacked-slot-move]').forEach(button=>button.addEventListener('click',()=>{const item=explorerStackItemById(button.dataset.itemId);if(!item)return;const from=Number(button.dataset.slotIndex),to=from+(button.dataset.stackedSlotMove==='up'?-1:1);if(to<0||to>=item.plot_slots.length)return;[item.plot_slots[from],item.plot_slots[to]]=[item.plot_slots[to],item.plot_slots[from]];syncLegacyExplorerStackState();renderExplorerPlot();}));
  host.querySelectorAll('[data-card-y-slot]').forEach(el=>el.addEventListener('change',()=>{setExplorerStackItem(el.dataset.cardYSlot,{y_slot:el.value}); refreshExplorerStack({silent:true});}));
  host.querySelectorAll('[data-card-swap]').forEach(el=>el.addEventListener('click',()=>{const item=explorerStackItemById(el.dataset.cardSwap);if(!item)return;const oldX=item.slot;item.slot=item.y_slot;item.y_slot=oldX;syncLegacyExplorerStackState();refreshExplorerStack({silent:true});}));
  host.querySelectorAll('[data-card-scatter-x-transform]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardScatterXTransform,{scatter_x_transform:el.value})));
  host.querySelectorAll('[data-card-scatter-y-transform]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardScatterYTransform,{scatter_y_transform:el.value})));
  host.querySelectorAll('[data-card-scatter-year]').forEach(el=>el.addEventListener('change',()=>{const year=el.value;for(const item of (state.explorerStackItems||[])){if(item.plot_type==='scatter')item.scatter_year=year;}syncLegacyExplorerStackState();renderExplorerPlot();renderExplorerTable();renderExplorerStackList();}));
  host.querySelectorAll('[data-card-scatter-basis]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardScatterBasis,{scatter_basis:el.value})));
  host.querySelectorAll('[data-card-scatter-x-basis]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardScatterXBasis,{scatter_x_basis:el.value})));
  host.querySelectorAll('[data-card-scatter-y-basis]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardScatterYBasis,{scatter_y_basis:el.value})));
  host.querySelectorAll('[data-card-transform]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardTransform,{transform:el.value,annual_year:''})));
  host.querySelectorAll('[data-card-year]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardYear,{annual_year:el.value})));
  host.querySelectorAll('[data-card-bar-sort]').forEach(el=>el.addEventListener('change',()=>setExplorerStackItem(el.dataset.cardBarSort,{bar_sort:el.value})));
  host.querySelectorAll('[data-card-move]').forEach(el=>el.addEventListener('click',()=>moveExplorerStackItem(el.dataset.cardId,el.dataset.cardMove)));
  host.querySelectorAll('[data-card-remove]').forEach(el=>el.addEventListener('click',()=>removeExplorerPlotItem(el.dataset.cardRemove)));
  host.querySelectorAll('[data-reference-apply]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.referenceApply; const item=explorerStackItemById(id); if(!item)return;
    const textarea=host.querySelector(`[data-reference-text="${CSS.escape(id)}"]`);
    try { item.reference_lines=referenceLinesFromText(textarea?.value || ''); syncLegacyExplorerStackState(); hideError(); renderExplorerPlot(); }
    catch(error){ showError(error?.message || 'Could not parse reference lines.'); }
  }));
  host.querySelectorAll('[data-reference-clear]').forEach(button=>button.addEventListener('click',()=>{
    const item=explorerStackItemById(button.dataset.referenceClear); if(!item)return; item.reference_lines=[]; syncLegacyExplorerStackState(); renderExplorerPlot();
  }));
  host.querySelectorAll('[data-item-setting]').forEach(el=>{const eventName=(el.type==='checkbox'||el.tagName==='SELECT')?'change':'change';el.addEventListener(eventName,()=>{const item=explorerStackItemById(el.dataset.itemId);if(!item)return;const key=el.dataset.itemSetting;let value=el.type==='checkbox'?el.checked:el.value;if(['line_width','y_min','y_max','percentile_low','percentile_high','unit_factor','unit_offset'].includes(key)) value=value===''?'':Number(value);item[key]=value;syncLegacyExplorerStackState();renderExplorerPlot();});});
  renderExplorerStackList();
  updateExplorerStackSummary();
}

function renderScatterDataTables() {
  document.querySelectorAll('[data-scatter-table]').forEach(host=>{
    const card=host.closest('.explorer-plot-card');
    const plot=card?.querySelector('.explorer-plot');
    const item=explorerStackItemById(host.dataset.scatterTable);
    if(!plot || !item || !Array.isArray(plot.data)) return;
    let rows=[];
    plot.data.filter(trace=>trace.mode==='markers' && Array.isArray(trace.x) && trace.x.length && Array.isArray(trace.y) && trace.y.length).forEach(trace=>{
      const meta=Array.isArray(trace.customdata?.[0]) ? trace.customdata[0] : [];
      rows.push({run:meta[0] || trace.name || '',trace:meta[2] ?? '',x:trace.x[0],y:trace.y[0]});
    });
    const fmt=value=>value==null||value===''?'—':(Number.isFinite(Number(value))?fmtNumber(Number(value),Number(explorerTableDecimals?.value||2)):String(value));
    const serialize=delimiter=>[['Run','Trace',item.slot,item.y_slot||'Y slot'],...rows.map(row=>[row.run,row.trace,row.x,row.y])].map(row=>row.map(value=>{const text=String(value??'');return delimiter===','?`"${text.replaceAll('"','""')}"`:text.replaceAll('\t',' ');}).join(delimiter)).join('\r\n');
    host.innerHTML=rows.length ? `<details class="scatter-data-details"><summary>Data used in this plot (${rows.length} points)</summary><div class="scatter-data-actions"><button type="button" class="mini-button" data-scatter-copy="${escapeHtml(item.id)}">Copy for Excel</button><button type="button" class="mini-button" data-scatter-csv="${escapeHtml(item.id)}">Download CSV</button><span class="scatter-copy-status" aria-live="polite"></span></div><div class="table-scroll"><table class="explorer-data-table scatter-points-table"><thead><tr><th><button type="button" data-scatter-sort="run">Run</button></th><th><button type="button" data-scatter-sort="trace">Trace</button></th><th><button type="button" data-scatter-sort="x">${escapeHtml(item.slot)}</button></th><th><button type="button" data-scatter-sort="y">${escapeHtml(item.y_slot || 'Y slot')}</button></th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escapeHtml(row.run)}</td><td>${escapeHtml(row.trace)}</td><td>${fmt(row.x)}</td><td>${fmt(row.y)}</td></tr>`).join('')}</tbody></table></div></details>` : '<div class="rdf-slot-empty">No paired data points are available for the selected treatments/year.</div>';
    host._scatterRows=rows;
    host.querySelectorAll('[data-scatter-sort]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.scatterSort, prior=host.dataset.sortKey===key?host.dataset.sortDirection:'', direction=prior==='asc'?'desc':'asc';
      host.dataset.sortKey=key;host.dataset.sortDirection=direction;
      rows=[...rows].sort((a,b)=>{const av=a[key],bv=b[key],an=Number(av),bn=Number(bv);const cmp=Number.isFinite(an)&&Number.isFinite(bn)?an-bn:String(av??'').localeCompare(String(bv??''),undefined,{numeric:true,sensitivity:'base'});return direction==='asc'?cmp:-cmp;});host._scatterRows=rows;
      const tbody=host.querySelector('tbody');if(tbody)tbody.innerHTML=rows.map(row=>`<tr><td>${escapeHtml(row.run)}</td><td>${escapeHtml(row.trace)}</td><td>${fmt(row.x)}</td><td>${fmt(row.y)}</td></tr>`).join('');
      host.querySelectorAll('[data-scatter-sort]').forEach(other=>{other.setAttribute('aria-sort',other===button?(direction==='asc'?'ascending':'descending'):'none');});
    }));
    host.querySelector('[data-scatter-copy]')?.addEventListener('click',async()=>{const status=host.querySelector('.scatter-copy-status');try{await navigator.clipboard.writeText(serialize('\t'));if(status)status.textContent='Copied; paste into Excel.';}catch{const textarea=document.createElement('textarea');textarea.value=serialize('\t');document.body.appendChild(textarea);textarea.select();const copied=document.execCommand('copy');textarea.remove();if(status)status.textContent=copied?'Copied; paste into Excel.':'Copy failed.';}});
    host.querySelector('[data-scatter-csv]')?.addEventListener('click',()=>downloadBlob(new Blob([serialize(',')],{type:'text/csv;charset=utf-8'}),`${String(item.slot+'-vs-'+(item.y_slot||'scatter')).replace(/[^A-Za-z0-9_.-]+/g,'_')}.csv`));
  });
}

function renderOneExplorerPlot(plot,data,slot,index,stackCount,item={}) {
  if(!plot || !data) return;
  item=normalizeExplorerStackItem({...item,slot}) || createExplorerStackItem(slot);
  const plotType=item.plot_type;
  const transform=item.transform;
  const selectedRuns=[];
  if(document.getElementById('explorerRunA')?.checked && data.current) selectedRuns.push(['current',activeRunDisplayName('current'),explorerRunAColor.value]);
  if(document.getElementById('explorerRunB')?.checked && data.previous) selectedRuns.push(['previous',activeRunDisplayName('previous'),explorerRunBColor.value]);
  const alpha=Number(explorerAlpha.value || 0.28), baseLineWidth=Number(item.line_width || 1), overlayAlpha=Number(explorerOverlayAlpha?.value || 0.28), dimColor=document.getElementById('explorerDimColor')?.value || '#9aa5aa';
  const highlights=activeExplorerHighlights(), unit=item.display_unit || explorerUnitFor(data), traces=[]; let barTickLabels=[];
  const rgba=(hex,opacity)=>{const value=String(hex).replace('#','');const red=parseInt(value.slice(0,2),16),green=parseInt(value.slice(2,4),16),blue=parseInt(value.slice(4,6),16);return `rgba(${red},${green},${blue},${opacity})`;};
  const highlightState=traceNumber=>!highlights.size?'normal':(highlights.has(Number(traceNumber))?'highlight':'dim');
  const showBand=item.percentile_band && plotType==='line';
  const low=Math.max(0,Math.min(100,Number(item.percentile_low || 10))), high=Math.max(low,Math.min(100,Number(item.percentile_high || 90)));

  if(plotType==='scatter') {
    const yData=item.yData || (item.y_slot===slot ? data : state.explorerStackData?.get(item.y_slot));
    const scatterXTransform=item.scatter_x_transform || item.scatter_transform || 'raw', scatterYTransform=item.scatter_y_transform || 'raw', scatterYear=String(item.scatter_year || '').trim(), xBasis=item.scatter_x_basis==='water'?'water':'calendar', yBasis=item.scatter_y_basis==='water'?'water':'calendar';
    const snapshot=(series,transform,basis)=>series.map(s=>{const points=s.points.filter(p=>{
      if(!scatterYear)return true;
      if(transform!=='raw')return explorerPointYear(p)===scatterYear;
      const date=String(p.source?.period_date || ''), month=Number(p.source?.month || date.split('-')[1]);
      const calendarYear=Number(date.split('-')[0] || p.source?.year), sourceYear=Number(p.source?.year), target=Number(scatterYear);
      if(basis==='calendar') return calendarYear===target || sourceYear===target;
      return (calendarYear===target && month>=1 && month<=9) || (calendarYear===target-1 && month>=10 && month<=12) || (sourceYear===target && month===9);
    });
    if(!points.length)return {...s,points:[]};
    if(transform==='raw' && scatterYear) {
      const target=Number(scatterYear), endpointMonth=basis==='water'?9:12;
      const endpoint=points.filter(p=>Number(p.source?.month || String(p.source?.period_date||'').split('-')[1])===endpointMonth);
      const chosen=endpoint.length?endpoint[endpoint.length-1]:points[points.length-1];
      return {...s,points:[chosen]};
    }
    return {...s,points};});
    for(const [runKey,runLabel,color] of selectedRuns) {
      const xs=snapshot(explorerVisibleTransformedFor(data,runKey,scatterXTransform,item),scatterXTransform,xBasis);
      const ys=yData ? snapshot(explorerVisibleTransformedFor(yData,runKey,scatterYTransform,item),scatterYTransform,yBasis) : [];
      const byTrace=new Map(ys.map(s=>[Number(s.trace_number),s]));
      xs.forEach(xSeries=>{const ySeries=byTrace.get(Number(xSeries.trace_number));if(!ySeries)return;const x=xSeries.points[0],y=ySeries.points[0];if(!x||!y)return;const hs=highlightState(xSeries.trace_number);traces.push({type:'scatter',mode:'markers',x:[x.value],y:[y.value],name:runLabel,showlegend:false,marker:{size:8,color:hs==='dim'?dimColor:color,opacity:hs==='highlight'?1:0.78},customdata:[[runLabel,xSeries.label,xSeries.trace_number,ySeries.label]],meta:{trace_number:xSeries.trace_number},hovertemplate:`Trace %{customdata[2]}<br>${escapeHtml(slot)}: %{x:.2f}<br>${escapeHtml(item.y_slot || 'Y')}: %{y:.2f}<extra></extra>`});});
    }
  } else if(plotType==='line') {
    for(const [runKey,runLabel,color] of selectedRuns) {
      const series=explorerVisibleTransformedFor(data,runKey,transform,item);
      if(showBand) {
        const bandSource=series.some(entry=>entry.role!=='deterministic') ? series.filter(entry=>entry.role!=='deterministic') : series;
        const band=percentileBandFor(bandSource,low,high);
        if(band.x.length) {
          traces.push({type:'scatter',mode:'lines',x:band.x,y:band.low,line:{width:0},hoverinfo:'skip',showlegend:false});
          traces.push({type:'scatter',mode:'lines',x:band.x,y:band.high,line:{width:0},fill:'tonexty',fillcolor:rgba(color,0.10),hoverinfo:'skip',showlegend:false});
        }
      }
      series.forEach(seriesItem=>{
        const hs=highlightState(seriesItem.trace_number); const opacity=hs==='highlight'?0.98:(hs==='dim'?Math.max(0.42,alpha*1.15):alpha);
        traces.push({type:'scatter',mode:'lines',x:seriesItem.points.map(point=>point.x),y:seriesItem.points.map(point=>point.value),showlegend:false,
          line:{color:rgba(hs==='dim'?dimColor:color,opacity),width:hs==='highlight'?Math.max(2.2,baseLineWidth*2.3):baseLineWidth},
          customdata:seriesItem.points.map(point=>[runLabel,seriesItem.label,seriesItem.trace_number,point.label]),meta:{trace_number:seriesItem.trace_number},
          hovertemplate:`%{customdata[1]} (Trace %{customdata[2]})<br>%{customdata[3]}<br>%{y:.2f} ${escapeHtml(unit)}<extra></extra>`});
      });
    }
  } else if(plotType==='box') {
    if(explorerBoxLineOverlay?.checked) {
      for(const [runKey] of selectedRuns) explorerVisibleTransformedFor(data,runKey,transform,item).forEach(seriesItem=>traces.push({type:'scatter',mode:'lines',x:seriesItem.points.map(point=>point.x),y:seriesItem.points.map(point=>point.value),line:{color:rgba(dimColor,overlayAlpha),width:Math.max(0.5,baseLineWidth*0.7)},showlegend:false,hoverinfo:'skip',meta:{trace_number:seriesItem.trace_number}}));
    }
    for(const [runKey,runLabel,color] of selectedRuns) {
      const series=explorerVisibleTransformedFor(data,runKey,transform,item), xValues=[], yValues=[];
      series.forEach(seriesItem=>seriesItem.points.forEach(point=>{xValues.push(point.x);yValues.push(point.value);}));
      traces.push({type:'box',x:xValues,y:yValues,name:runLabel,showlegend:false,marker:{color},line:{color,width:0.9},fillcolor:rgba(color,0.10),boxpoints:false,hovertemplate:`%{x}<br>%{y:.2f} ${escapeHtml(unit)}<extra></extra>`});
    }
  } else if(plotType==='bar') {
    const selectedYear=String(item.annual_year || '').trim(); const sortMode=item.bar_sort || 'none';
    const pickPoint=seriesItem=>{
      if(!selectedYear) return seriesItem.points[seriesItem.points.length-1] || null;
      const matches=seriesItem.points.filter(point=>explorerPointYear(point)===selectedYear);
      return matches[matches.length-1] || null;
    };
    let order=null;
    if(selectedRuns.length) {
      const first=explorerVisibleTransformedFor(data,selectedRuns[0][0],transform,item).map(seriesItem=>({seriesItem,point:pickPoint(seriesItem)})).filter(entry=>entry.point);
      if(sortMode==='asc'||sortMode==='desc') first.sort((a,b)=>(a.point.value-b.point.value)*(sortMode==='asc'?1:-1));
      order=first.map(entry=>Number(entry.seriesItem.trace_number));
    }
    for(const [runKey,runLabel,color] of selectedRuns) {
      let series=explorerVisibleTransformedFor(data,runKey,transform,item);
      if(order) { const rank=new Map(order.map((traceNumber,i)=>[traceNumber,i])); series=[...series].sort((a,b)=>(rank.get(Number(a.trace_number))??9999)-(rank.get(Number(b.trace_number))??9999)); }
      const labels=[], values=[], customData=[], colors=[];
      series.forEach(seriesItem=>{ const point=pickPoint(seriesItem); if(!point)return; const hs=highlightState(seriesItem.trace_number); labels.push(`${seriesItem.label} (${seriesItem.trace_number})`); values.push(point.value); customData.push([seriesItem.trace_number,point.label,runLabel]); colors.push(rgba(hs==='dim'?dimColor:color,hs==='highlight'?0.96:(hs==='dim'?0.58:0.72))); });
      if(!barTickLabels.length) barTickLabels=[...labels];
      traces.push({type:'bar',x:labels,y:values,name:runLabel,showlegend:false,marker:{color:colors},customdata:customData,hovertemplate:`%{x}<br>%{customdata[2]} · %{customdata[1]}<br>%{y:.2f} ${escapeHtml(unit)}<extra></extra>`});
    }
  } else if(plotType==='stacked_bar') {
    const componentSlots=[...new Set([...(item.plot_slots||[]),slot])];
    const palette=['#167c80','#d07a28','#5577a8','#8b6da8','#6b9a55','#c15b68','#6b8793','#b39b44'];
    const dataForSlot=componentSlot=>componentSlot===slot?data:(state.explorerStackData?.get(componentSlot)||null);
    const pickPoint=seriesItem=>{if(!item.annual_year)return seriesItem.points[seriesItem.points.length-1]||null;const matches=seriesItem.points.filter(point=>explorerPointYear(point)===String(item.annual_year));return matches[matches.length-1]||null;};
    for(const [runKey,runLabel] of selectedRuns) {
      const bySlot=new Map();
      for(const componentSlot of componentSlots) {
        const componentData=dataForSlot(componentSlot), series=componentData?explorerVisibleTransformedFor(componentData,runKey,transform,item):[];
        bySlot.set(componentSlot,new Map(series.map(traceItem=>[Number(traceItem.trace_number),pickPoint(traceItem)])));
      }
      const traceNumbers=[...new Set([...bySlot.values()].flatMap(map=>[...map.keys()]))];
      const sortSlot=componentSlots.includes(item.stacked_sort_slot)?item.stacked_sort_slot:'';
      const sortMode=item.bar_sort||'none';
      if(sortSlot && (sortMode==='asc'||sortMode==='desc'))traceNumbers.sort((a,b)=>((bySlot.get(sortSlot)?.get(a)?.value??-Infinity)-(bySlot.get(sortSlot)?.get(b)?.value??-Infinity))*(sortMode==='asc'?1:-1));
      const labels=traceNumbers.map(number=>`${explorerTraceLabel(number)} (${number})`);if(!barTickLabels.length)barTickLabels=labels;
      componentSlots.forEach((componentSlot,componentIndex)=>{
        const values=traceNumbers.map(number=>bySlot.get(componentSlot)?.get(number)?.value??0);
        const customs=traceNumbers.map(number=>[number,runLabel,componentSlot]);
        traces.push({type:'bar',x:labels,y:values,name:componentSlot,legendgroup:`${runKey}-${componentSlot}`,showlegend:runKey===selectedRuns[0]?.[0],offsetgroup:runKey,marker:{color:palette[componentIndex%palette.length]},customdata:customs,hovertemplate:`%{customdata[1]} · Trace %{customdata[0]}<br>${escapeHtml(componentSlot)}: %{y:.2f} ${escapeHtml(unit)}<extra></extra>`});
      });
    }
  }

  const transformLabel=plotType==='scatter' ? `${explorerTransformLabel(item.scatter_x_transform || item.scatter_transform || 'raw')} / ${explorerTransformLabel(item.scatter_y_transform || 'raw')}` : explorerTransformLabel(transform);
  const customTitle=String(item.title || '').trim();
  const customSubtitle=String(item.subtitle || '').trim();
  const title=customTitle || (plotType==='scatter' ? `${slot} vs ${item.y_slot || 'Y slot'}` : plotType==='stacked_bar' ? `${[...new Set([...(item.plot_slots||[]),slot])].join(' + ')} · Stacked bar` : slot);
  const subtitle=customSubtitle || `${transformLabel}${plotType==='scatter'&&item.scatter_year?` · ${item.scatter_year}`:''}${plotType==='scatter'&&((item.scatter_x_transform||item.scatter_transform)==='raw'||(item.scatter_y_transform||'raw')==='raw')?' · raw end-of-year values':''}${plotType!=='scatter'&&plotType==='bar'&&item.annual_year?` · ${item.annual_year}`:''} · ${state.explorerVisibleTraces.length} visible traces`;
  const isRaw=plotType==='scatter' ? false : transform==='raw', automaticXAxisTitle=plotType==='scatter'?slot:(['bar','stacked_bar'].includes(plotType)?'Trace':(isRaw?'Month':'Period'));
  const xTitle=String(item.x_axis_title || '').trim() || automaticXAxisTitle, yTitle=String(item.y_axis_title || '').trim() || (plotType==='scatter' && item.y_slot ? explorerUnitFor(item.yData || {}, selectedRuns[0]?.[0] || 'current') : unit), showGrid=item.show_grid!==false;
  const annotations=subtitle?[{text:escapeHtml(subtitle),xref:'paper',yref:'paper',x:0.012,y:1.025,xanchor:'left',yanchor:'bottom',showarrow:false,font:{size:10,family:EXPLORER_PLOT_FONT,color:'#718087'}}]:[];
  const shapes=[];
  for(const reference of (item.reference_lines || [])) {
    const referenceValue=Number(reference.value); if(!Number.isFinite(referenceValue))continue;
    const referenceColor=reference.color || '#c0392b';
    shapes.push({type:'line',xref:'paper',x0:0,x1:1,yref:'y',y0:referenceValue,y1:referenceValue,line:{color:referenceColor,width:Number(reference.width)||1.25,dash:reference.dash||'dash'}});
    annotations.push({text:escapeHtml(reference.label || String(referenceValue)),xref:'paper',x:0.995,xanchor:'right',yref:'y',y:referenceValue,yanchor:'bottom',showarrow:false,bgcolor:'rgba(255,255,255,0.75)',borderpad:2,font:{size:9,family:EXPLORER_PLOT_FONT,color:referenceColor}});
  }
  const yaxis={title:{text:yTitle,font:{size:11,family:EXPLORER_PLOT_FONT,color:'#44565f'}},showgrid:showGrid,gridcolor:'#e8ecee',zeroline:false,tickfont:{size:10,family:EXPLORER_PLOT_FONT,color:'#44565f'},automargin:true,autorange:true};
  if(item.y_axis_mode==='fixed') { const minimum=Number(item.y_min), maximum=Number(item.y_max); if(Number.isFinite(minimum)&&Number.isFinite(maximum)&&maximum>minimum)yaxis.range=[minimum,maximum]; }
  const categoricalBar=['bar','stacked_bar'].includes(plotType);
  const stackedLegendTop=plotType==='stacked_bar' && item.stacked_legend_position==='top';
  const layout={title:{text:escapeHtml(title),x:0.012,xanchor:'left',y:0.985,yanchor:'top',font:{size:17,family:EXPLORER_PLOT_FONT,color:'#2b3b43'}},annotations,shapes,hovermode:'closest',dragmode:'zoom',boxmode:'group',barmode:plotType==='stacked_bar'?'relative':'group',showlegend:plotType==='stacked_bar',
    legend:plotType==='stacked_bar'?{orientation:'h',x:0.5,xanchor:'center',y:stackedLegendTop?1.17:-0.48,yanchor:stackedLegendTop?'bottom':'top',font:{size:9,family:EXPLORER_PLOT_FONT,color:'#44565f'}}:undefined,
    margin:{l:72,r:22,t:plotType==='stacked_bar'&&stackedLegendTop?116:(subtitle?76:58),b:plotType==='stacked_bar'&&!stackedLegendTop?155:(categoricalBar?118:62)},paper_bgcolor:'#fff',plot_bgcolor:'#fff',
    xaxis:{title:{text:xTitle,font:{size:11,family:EXPLORER_PLOT_FONT,color:'#44565f'}},showgrid:showGrid,gridcolor:'#e8ecee',zeroline:false,tickangle:categoricalBar?-90:0,automargin:true,autorange:true,type:(isRaw&&!categoricalBar)?'date':undefined,tickformat:(isRaw&&!categoricalBar)?'%b-%y':undefined,nticks:(isRaw&&!categoricalBar)?12:undefined,tickmode:categoricalBar?'array':undefined,tickvals:categoricalBar?barTickLabels:undefined,ticktext:categoricalBar?barTickLabels:undefined,tickfont:{size:categoricalBar?9:10,family:EXPLORER_PLOT_FONT,color:'#44565f'}},
    yaxis,hoverlabel:{font:{family:EXPLORER_PLOT_FONT,size:10},namelength:28,bgcolor:'#fff',bordercolor:'#aab5b9'},font:{family:EXPLORER_PLOT_FONT,size:10,color:'#24343d'},uirevision:`${item.id}::${plotType}::${transform}::${item.annual_year||''}::${item.scatter_x_transform||''}::${item.scatter_y_transform||''}::${item.scatter_year||''}::${item.scatter_x_basis||''}::${item.scatter_y_basis||''}::${item.y_slot||''}::${(item.plot_slots||[]).join('|')}::${item.stacked_sort_slot||''}::${item.stacked_legend_position||''}::${item.bar_sort||''}::${JSON.stringify(selectedRuns.map(x=>x[0]))}`};
  if(state.explorerViewport.x && !['bar','stacked_bar'].includes(plotType) && isRaw) layout.xaxis.range=[...state.explorerViewport.x];
  Plotly.react(plot,traces,layout,{responsive:true,displaylogo:false,scrollZoom:true,modeBarButtonsToRemove:['lasso2d','select2d']}).then(()=>{
    // React can retain a stale axis range even when the data/treatment changed.
    // Explicitly autorange after the new traces are committed.
    return Plotly.relayout(plot,{'xaxis.autorange':true,'yaxis.autorange':true});
  }).then(()=>plot.querySelectorAll('text').forEach(element=>{element.style.fontWeight='400';element.style.fontFamily=EXPLORER_PLOT_FONT;element.style.stroke='none';element.style.strokeWidth='0';element.style.paintOrder='normal';}));
  plot.removeAllListeners?.('plotly_click'); plot.removeAllListeners?.('plotly_relayout');
  plot.on?.('plotly_click',event=>{let traceNumber=event?.points?.[0]?.data?.meta?.trace_number;if(traceNumber==null&&Array.isArray(event?.points?.[0]?.customdata))traceNumber=event.points[0].customdata[0];if(traceNumber!=null&&Number.isFinite(Number(traceNumber))){state.explorerSelectedTraceColumns=new Set([Number(traceNumber)]);explorerHighlight.value=String(traceNumber);renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();}});
  plot.on?.('plotly_relayout',event=>{
    if(state.explorerSyncingViewport)return;
    if(event['xaxis.autorange'])state.explorerViewport.x=null;
    if(event['yaxis.autorange'])state.explorerViewport.y=null;
    if(event['xaxis.range[0]']!=null&&event['xaxis.range[1]']!=null)state.explorerViewport.x=[String(event['xaxis.range[0]']),String(event['xaxis.range[1]'])];
    if(event['yaxis.range[0]']!=null&&event['yaxis.range[1]']!=null)state.explorerViewport.y=[Number(event['yaxis.range[0]']),Number(event['yaxis.range[1]'])];
    state.explorerViewport.slot=slot; state.explorerViewport.entry_id=item.id;
    if(!['bar','stacked_bar'].includes(plotType) && isRaw && ((event['xaxis.range[0]']!=null&&event['xaxis.range[1]']!=null)||event['xaxis.autorange'])) {
      state.explorerSyncingViewport=true;
      document.querySelectorAll('#explorerPlotStack .explorer-plot').forEach(otherPlot=>{
        if(otherPlot===plot)return;
        const otherId=otherPlot.closest('.explorer-plot-card')?.dataset?.stackId || '';
        const otherItem=explorerStackItemById(otherId);
        if(!otherItem || ['bar','stacked_bar'].includes(otherItem.plot_type) || otherItem.transform!=='raw')return;
        Plotly.relayout(otherPlot,event['xaxis.autorange']?{'xaxis.autorange':true}:{'xaxis.range':state.explorerViewport.x});
      });
      setTimeout(()=>{state.explorerSyncingViewport=false;},0);
    }
  });
}

function updateExplorerAnnualBarOptions() {
  // Retained as a compatibility no-op. v4.4+ year controls live on each chart.
}

function pointsForStackEntry(entry,runKey) {
  let series=explorerVisibleTransformedFor(entry.data,runKey,entry.transform);
  if(entry.plot_type==='bar' && entry.annual_year) {
    series=series.map(trace=>({...trace,points:trace.points.filter(point=>explorerPointYear(point)===String(entry.annual_year))}));
  }
  return series;
}

function explorerStackedTableModel() {
  const entries=explorerPlotEntries().filter(entry=>entry.plot_type!=='scatter');
  if(entries.length<2 || !state.explorerSelectedTraceColumns.size)return null;
  let runKey=document.getElementById('explorerTableRun').value;
  if(!entries.some(entry=>entry.data?.[runKey])) runKey=entries.some(entry=>entry.data?.current)?'current':'previous';
  const selected=new Set([...state.explorerSelectedTraceColumns].map(Number));
  const slots=[], periods=[], seenPeriods=new Set();
  for(const entry of entries) {
    const run=entry.data?.[runKey]; if(!run)continue;
    const series=pointsForStackEntry(entry,runKey).filter(trace=>selected.has(Number(trace.trace_number)));
    const lookup=new Map();
    series.forEach(trace=>trace.points.forEach(point=>{lookup.set(`${trace.trace_number}::${point.label}`,point.value);if(!seenPeriods.has(point.label)){seenPeriods.add(point.label);periods.push({label:point.label,x:point.x});}}));
    slots.push({entry,slot:entry.slot,label:explorerPlotEntryLabel(entry),data:entry.data,run,series,lookup,unit:explorerUnitFor(entry.data,runKey)});
  }
  return {runKey,slots,periods,selected};
}

function explorerTableModel() {
  let runKey=document.getElementById('explorerTableRun').value;
  if(!state.explorerData?.[runKey])runKey=state.explorerData?.current?'current':'previous';
  const run=state.explorerData?.[runKey]; if(!run)return null;
  const primary=explorerPlotEntries().find(entry=>entry.plot_type!=='scatter') || {data:state.explorerData,transform:'raw',plot_type:'line',annual_year:''};
  let series=pointsForStackEntry(primary,runKey);
  if(state.explorerTableTraceFilter instanceof Set)series=series.filter(item=>state.explorerTableTraceFilter.has(Number(item.trace_number)));
  const periods=[],seen=new Set();
  series.forEach(item=>item.points.forEach(point=>{if(!seen.has(point.label)){seen.add(point.label);periods.push({label:point.label,x:point.x});}}));
  const lookup=new Map(); series.forEach(item=>item.points.forEach(point=>lookup.set(`${item.trace_number}::${point.label}`,point.value)));
  return {runKey,run,series,periods,lookup,entry:primary};
}

function renderExplorerTable() {
  const host=document.getElementById('explorerTable'); if(!host)return;
  if(!state.explorerData){host.innerHTML='<div class="rdf-slot-empty">No slot data loaded.</div>';return;}
  const stacked=explorerStackedTableModel();
  const decimals=Math.max(0,Math.min(6,Number(explorerTableDecimals?.value || 2))), selectedRows=state.explorerSelectedRows;
  if(stacked && stacked.slots.length) {
    const slotHeads=stacked.slots.map(s=>`<th class="stack-slot-head" colspan="${Math.max(1,s.series.length)}">${escapeHtml(s.label)}<small>${escapeHtml(s.unit)}</small></th>`).join('');
    const traceHeads=stacked.slots.map(s=>s.series.map(item=>`<th class="selectable-trace stack-trace-head is-selected" data-trace="${item.trace_number}">${escapeHtml(item.label)}<small>Trace ${item.trace_number}</small></th>`).join('')).join('');
    const body=stacked.periods.map(period=>{const rowSelected=selectedRows.has(period.label);const cells=stacked.slots.map(s=>s.series.map(item=>{const v=s.lookup.get(`${item.trace_number}::${period.label}`);const rule=v==null?null:conditionalRuleFor(v);const style=rule?` style="background:${escapeHtml(rule.color)}" title="${escapeHtml(rule.label || `${rule.op} ${rule.value}`)}"`:'';return `<td class="is-selected-col ${rowSelected?'is-selected-row-cell':''} ${rule?'threshold-hit':''}"${style}>${v==null?'—':fmtNumber(v,decimals)}</td>`;}).join('')).join('');return `<tr class="${rowSelected?'is-selected-row':''}"><th class="selectable-period" data-period="${escapeHtml(period.label)}">${escapeHtml(period.label)}</th>${cells}</tr>`;}).join('');
    host.innerHTML=`<table class="explorer-data-table"><thead><tr><th rowspan="2">Period</th>${slotHeads}</tr><tr>${traceHeads}</tr></thead><tbody>${body}</tbody></table>`;
    const meta=document.getElementById('explorerTableMeta'); const runLabel=stacked.slots[0]?.run?.label || stacked.runKey;
    if(meta)meta.textContent=`${runLabel} · ${stacked.slots.length} synchronized plot datasets · ${stacked.selected.size} selected trace(s)`;
  } else {
    const model=explorerTableModel(); if(!model){host.innerHTML='<div class="rdf-slot-empty">Selected run has no data for this slot.</div>';return;}
    const {run,series,periods,lookup}=model, selectedCols=state.explorerSelectedTraceColumns;
    const head=series.map(item=>`<th class="selectable-trace ${selectedCols.has(Number(item.trace_number))?'is-selected':''}" data-trace="${item.trace_number}">${escapeHtml(item.label)}<small>Trace ${item.trace_number}</small></th>`).join('');
    const body=periods.map(period=>{const rowSelected=selectedRows.has(period.label);return `<tr class="${rowSelected?'is-selected-row':''}"><th class="selectable-period" data-period="${escapeHtml(period.label)}">${escapeHtml(period.label)}</th>${series.map(item=>{const v=lookup.get(`${item.trace_number}::${period.label}`),rule=v==null?null:conditionalRuleFor(v),style=rule?` style="background:${escapeHtml(rule.color)}" title="${escapeHtml(rule.label || `${rule.op} ${rule.value}`)}"`:'';return `<td class="${selectedCols.has(Number(item.trace_number))?'is-selected-col':''} ${rowSelected?'is-selected-row-cell':''} ${rule?'threshold-hit':''}"${style}>${v==null?'—':fmtNumber(v,decimals)}</td>`;}).join('')}</tr>`;}).join('');
    host.innerHTML=`<table class="explorer-data-table"><thead><tr><th>Period</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
    const meta=document.getElementById('explorerTableMeta'), filterNote=state.explorerTableTraceFilter instanceof Set?` · ${series.length} trace columns from plot viewport`:` · ${series.length} visible traces`;
    if(meta)meta.textContent=`${run.label} · ${explorerTransformLabel(model.entry.transform)}${filterNote} · ${periods.length} rows · ${explorerUnit(model.runKey)}`;
  }
  host.querySelectorAll('th.selectable-trace').forEach(th=>th.addEventListener('click',()=>{const n=Number(th.dataset.trace),set=new Set(state.explorerSelectedTraceColumns);if(set.has(n))set.delete(n);else set.add(n);state.explorerSelectedTraceColumns=set;explorerHighlight.value=set.size===1?String([...set][0]):'';renderExplorerTraceControls(false);renderExplorerPlot();renderExplorerTable();}));
  host.querySelectorAll('th.selectable-period').forEach(th=>th.addEventListener('click',()=>{const key=th.dataset.period,set=new Set(state.explorerSelectedRows);if(set.has(key))set.delete(key);else set.add(key);state.explorerSelectedRows=set;renderExplorerTable();}));
}

function exportExplorerTableCsv() {
    const entries=explorerPlotEntries().filter(entry=>entry.plot_type!=='scatter'), esc=value=>`"${String(value ?? '').replaceAll('"','""')}"`;
  if(entries.length>1) {
    let runKey=document.getElementById('explorerTableRun').value;
    if(!entries.some(entry=>entry.data?.[runKey]))runKey='current';
    const selected=state.explorerSelectedTraceColumns.size?new Set([...state.explorerSelectedTraceColumns].map(Number)):new Set(state.explorerVisibleTraces.map(Number));
    const rows=[['Plot','Slot','Chart','Data treatment','Selected year','Period','Trace label','Trace number','Value','Units']];
    for(const entry of entries) {
      const unit=explorerUnitFor(entry.data,runKey);
      const traces=pointsForStackEntry(entry,runKey).filter(trace=>selected.has(Number(trace.trace_number)));
      for(const trace of traces) trace.points.forEach(point=>rows.push([entry.id,entry.slot,entry.plot_type,explorerTransformLabel(entry.transform),entry.annual_year || '',point.label,trace.label,trace.trace_number,point.value,unit]));
    }
    downloadBlob(new Blob([rows.map(row=>row.map(esc).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'CRMMS-stacked-plots.csv');
    return;
  }
  const model=explorerTableModel(); if(!model)return;
  const rows=[['Period',...model.series.map(trace=>`${trace.label} (Trace ${trace.trace_number})`)]];
  model.periods.forEach(period=>rows.push([period.label,...model.series.map(trace=>model.lookup.get(`${trace.trace_number}::${period.label}`) ?? '')]));
  downloadBlob(new Blob([rows.map(row=>row.map(esc).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),`${(state.explorerData?.slot || 'rdf-slot').replace(/[^A-Za-z0-9_.-]+/g,'_')}-${model.run.label || model.runKey}.csv`);
}

// Compatibility aliases used by older wiring.
function setExplorerPlotTypeForSlot(slot,plotType) {
  const item=(state.explorerStackItems || []).find(entry=>entry.slot===slot);
  if(item)setExplorerStackItem(item.id,{plot_type:plotType});
}
function moveExplorerStackSlot(slot,direction) {
  const item=(state.explorerStackItems || []).find(entry=>entry.slot===slot);
  if(item)moveExplorerStackItem(item.id,direction);
}


/* Generic slot checks — aggregate-aware v4.5 */
state.slotCheckResults = [];
state.slotCheckColumns = [];
state.slotCheckAggregateColumns = [];
let slotCheckConditionSeq = 0;


function slotCheckSlotOptions(selected='') {
  return (state.discoveredSlots || [])
    .map(slot =>
      `<option value="${escapeHtml(slot)}" ${
        slot === selected ? 'selected' : ''
      }>${escapeHtml(slot)}</option>`
    )
    .join('');
}


function populateSlotCheckOptions() {
  const returns = document.getElementById('slotCheckReturnSlots');

  if (returns) {
    const selected = new Set(
      [...returns.selectedOptions].map(o => o.value)
    );

    returns.innerHTML = slotCheckSlotOptions();

    [...returns.options].forEach(o => {
      o.selected = selected.has(o.value);
    });
  }

  document.querySelectorAll('.slot-check-slot').forEach(select => {
    const value = select.value;
    select.innerHTML = slotCheckSlotOptions(value);

    if (
      value &&
      [...select.options].some(o => o.value === value)
    ) {
      select.value = value;
    }
  });

  const run = document.getElementById('slotCheckRun');

  if (run) {
    const previous = run.querySelector('option[value="previous"]');

    if (previous) {
      previous.disabled =
        state.workspaceMode === 'explore' ||
        !state.previousFiles.length;
    }

    if (previous?.disabled && run.value === 'previous') {
      run.value = 'current';
    }
  }
}


function slotCheckCalculationOptions(selected='individual') {
  const options = [
    ['individual', 'Individual value'],
    ['calendar_sum', 'Calendar year sum'],
    ['water_sum', 'Water year sum'],
    ['calendar_avg', 'Calendar year average'],
    ['water_avg', 'Water year average'],
    ['calendar_min', 'Calendar year minimum'],
    ['water_min', 'Water year minimum'],
    ['calendar_max', 'Calendar year maximum'],
    ['water_max', 'Water year maximum']
  ];

  return options.map(([value, label]) =>
    `<option value="${value}" ${
      value === selected ? 'selected' : ''
    }>${label}</option>`
  ).join('');
}


function slotCheckCalculationIsAggregate(calculation) {
  return calculation && calculation !== 'individual';
}


function slotCheckCalculationBasis(calculation) {
  return String(calculation || '').startsWith('water_')
    ? 'water'
    : 'calendar';
}


function slotCheckCalculationStatistic(calculation) {
  const text = String(calculation || '');

  if (text.endsWith('_sum')) return 'sum';
  if (text.endsWith('_avg')) return 'avg';
  if (text.endsWith('_min')) return 'min';
  if (text.endsWith('_max')) return 'max';

  return 'individual';
}


function slotCheckCalculationLabel(calculation) {
  const labels = {
    individual: 'Individual value',
    calendar_sum: 'CY sum',
    water_sum: 'WY sum',
    calendar_avg: 'CY average',
    water_avg: 'WY average',
    calendar_min: 'CY minimum',
    water_min: 'WY minimum',
    calendar_max: 'CY maximum',
    water_max: 'WY maximum'
  };

  return labels[calculation] || calculation;
}


function addSlotCheckCondition(seed={}) {
  const host = document.getElementById('slotCheckConditions');

  if (!host) return;

  const id = ++slotCheckConditionSeq;
  const div = document.createElement('div');

  div.className = 'slot-check-condition';
  div.dataset.conditionId = String(id);

  const months = [
    'Any month',
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];

  /*
   * Backwards compatibility:
   *
   * Old profiles stored year_basis but did not have calculation.
   * They remain individual-value conditions.
   */
  const calculation = seed.calculation || 'individual';
  const yearBasis =
    seed.year_basis ||
    seed.yearBasis ||
    'any';

  div.innerHTML = `
    <label class="condition-wide">
      Object.Slot
      <select class="slot-check-slot">
        ${slotCheckSlotOptions(
          seed.slot ||
          state.explorerData?.slot ||
          explorerSlot?.value ||
          ''
        )}
      </select>
    </label>

    <label class="condition-calculation">
      Calculation
      <select class="slot-check-calculation">
        ${slotCheckCalculationOptions(calculation)}
      </select>
    </label>

    <label>
      Operator
      <select class="slot-check-op">
        <option value="any">Any value</option>
        <option value="<">&lt;</option>
        <option value="<=">&le;</option>
        <option value=">">&gt;</option>
        <option value=">=">&ge;</option>
        <option value="=">=</option>
        <option value="!=">&ne;</option>
        <option value="between">Between</option>
      </select>
    </label>

    <label class="slot-check-value-wrap">
      Value
      <input class="slot-check-value"
             type="number"
             step="any"
             value="${escapeHtml(seed.value ?? '')}"
             placeholder="7000000" />
    </label>

    <label class="slot-check-value2-wrap">
      Second value
      <input class="slot-check-value2"
             type="number"
             step="any"
             value="${escapeHtml(seed.value2 ?? '')}"
             placeholder="Upper bound" />
    </label>

    <label class="slot-check-month-wrap">
      Month
      <select class="slot-check-month">
        ${months.map((m, i) =>
          `<option value="${i}" ${
            String(seed.month ?? '0') === String(i)
              ? 'selected'
              : ''
          }>${m}</option>`
        ).join('')}
      </select>
    </label>

    <label class="slot-check-year-basis-wrap">
      Year basis
      <select class="slot-check-year-basis">
        <option value="any" ${
          yearBasis === 'any' ? 'selected' : ''
        }>Any year</option>
        <option value="calendar" ${
          yearBasis === 'calendar' ? 'selected' : ''
        }>Calendar year</option>
        <option value="water" ${
          yearBasis === 'water' ? 'selected' : ''
        }>Water year (Oct-Sep)</option>
      </select>
    </label>

    <label>
      Year(s)
      <input class="slot-check-years"
             type="text"
             value="${escapeHtml(seed.years ?? '')}"
             placeholder="e.g. 2024 or 2024, 2025" />
    </label>

    <div class="slot-check-condition-actions">
      <button class="mini-button remove-slot-check-condition"
              type="button">
        Remove condition
      </button>
    </div>`;

  host.appendChild(div);

  const op = div.querySelector('.slot-check-op');
  const calc = div.querySelector('.slot-check-calculation');

  if (seed.op) op.value = seed.op;

  const sync = () => {
    const any = op.value === 'any';
    const aggregate = slotCheckCalculationIsAggregate(calc.value);

    div.querySelector('.slot-check-value-wrap').style.display =
      any ? 'none' : '';

    div.querySelector('.slot-check-value2-wrap').style.display =
      op.value === 'between' ? '' : 'none';

    /*
     * Aggregate calculations define their own year basis.
     * WY sum means WY automatically; CY sum means CY automatically.
     *
     * Month filtering only makes sense for individual values.
     */
    const monthWrap = div.querySelector('.slot-check-month-wrap');
    const basisWrap = div.querySelector('.slot-check-year-basis-wrap');

    if (monthWrap) {
      monthWrap.style.display = aggregate ? 'none' : '';
    }

    if (basisWrap) {
      basisWrap.style.display = aggregate ? 'none' : '';
    }
  };

  op.addEventListener('change', sync);
  calc.addEventListener('change', sync);

  sync();

  div.querySelector('.remove-slot-check-condition')
    .addEventListener('click', () => {
      div.remove();

      if (!host.children.length) {
        addSlotCheckCondition();
      }
    });
}


function readSlotCheckConditions() {
  return [...document.querySelectorAll('.slot-check-condition')]
    .map(div => {
      const op =
        div.querySelector('.slot-check-op')?.value || 'any';

      const calculation =
        div.querySelector('.slot-check-calculation')?.value ||
        'individual';

      const rawValue = String(
        div.querySelector('.slot-check-value')?.value ?? ''
      ).trim();

      const rawValue2 = String(
        div.querySelector('.slot-check-value2')?.value ?? ''
      ).trim();

      let yearBasis =
        div.querySelector('.slot-check-year-basis')?.value ||
        'any';

      /*
       * Aggregate calculation controls its own year basis.
       */
      if (slotCheckCalculationIsAggregate(calculation)) {
        yearBasis = slotCheckCalculationBasis(calculation);
      }

      return {
        id: Number(div.dataset.conditionId || 0),

        slot:
          div.querySelector('.slot-check-slot')?.value || '',

        calculation,

        op,

        value:
          rawValue === ''
            ? NaN
            : Number(rawValue),

        value2:
          rawValue2 === ''
            ? NaN
            : Number(rawValue2),

        month:
          slotCheckCalculationIsAggregate(calculation)
            ? 0
            : Number(
                div.querySelector('.slot-check-month')?.value || 0
              ),

        year_basis: yearBasis,

        years: String(
          div.querySelector('.slot-check-years')?.value || ''
        )
          .split(/[ ,;]+/)
          .map(x => x.trim())
          .filter(Boolean)
          .map(Number)
          .filter(Number.isFinite)
      };
    })
    .filter(c =>
      c.slot &&
      (
        c.op === 'any' ||
        (
          Number.isFinite(c.value) &&
          (
            c.op !== 'between' ||
            Number.isFinite(c.value2)
          )
        )
      )
    );
}


function slotCheckPass(value, c) {
  if (c.op === 'any') {
    return Number.isFinite(Number(value));
  }

  const v = Number(value);

  if (!Number.isFinite(v)) return false;

  if (c.op === '<') return v < c.value;
  if (c.op === '<=') return v <= c.value;
  if (c.op === '>') return v > c.value;
  if (c.op === '>=') return v >= c.value;
  if (c.op === '=') return v === c.value;
  if (c.op === '!=') return v !== c.value;

  if (c.op === 'between') {
    return (
      v >= Math.min(c.value, c.value2) &&
      v <= Math.max(c.value, c.value2)
    );
  }

  return false;
}


function slotCheckYearFor(row, basis='any') {
  const year = Number(row?.year);
  const month = Number(row?.month);

  if (!Number.isFinite(year)) return null;

  if (basis === 'water') {
    return (
      Number.isFinite(month) &&
      month >= 1 &&
      month <= 12
    )
      ? (month >= 10 ? year + 1 : year)
      : year;
  }

  return year;
}


function slotCheckPeriodPass(row, c) {
  if (c.month && row.month !== c.month) {
    return false;
  }

  if (
    c.year_basis !== 'any' &&
    c.years.length
  ) {
    const y = slotCheckYearFor(row, c.year_basis);

    if (
      y == null ||
      !c.years.includes(y)
    ) {
      return false;
    }
  }

  return true;
}


function slotCheckPeriodKey(value, run) {
  const year = Number(value?.year);
  const month = Number(value?.month);

  if ((run?.timestep_types || []).includes('annual')) {
    return Number.isFinite(year)
      ? String(year)
      : String(
          value?.period_date ||
          value?.timestep ||
          ''
        );
  }

  if (
    Number.isFinite(year) &&
    Number.isFinite(month)
  ) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  return String(
    value?.period_date ||
    value?.timestep ||
    ''
  );
}


function slotCheckRows(payload, runKey, slot) {
  const run = payload?.[runKey];

  if (!run) return [];

  const deterministic = new Set(
    (payload?.trace_defaults || [])
      .filter(x => x.role === 'deterministic')
      .map(x => Number(x.trace_number))
  );

  const out = [];

  for (const trace of run.traces || []) {
    if (
      deterministic.has(
        Number(trace.trace_number)
      )
    ) {
      continue;
    }

    for (const value of trace.values || []) {
      if (
        value.value == null ||
        !Number.isFinite(Number(value.value))
      ) {
        continue;
      }

      out.push({
        slot,

        trace_number:
          Number(trace.trace_number),

        trace_label:
          explorerTraceLabel(
            trace.trace_number,
            trace.default_label
          ),

        period_key:
          slotCheckPeriodKey(value, run),

        period:
          explorerPeriodLabel(
            value,
            run.timestep_types || []
          ),

        year:
          Number(value.year),

        month:
          Number(value.month),

        value:
          Number(value.value)
      });
    }
  }

  return out;
}


/*
 * Aggregate one slot independently for every:
 *
 *     trace + calendar/water year
 *
 * This is the key difference from the previous implementation.
 *
 * Example:
 *
 *     Powell.Outflow
 *     Water year sum
 *     WY 2024
 *
 * becomes one value per ensemble trace rather than 12 independent
 * monthly comparisons.
 */
function slotCheckAggregateRows(rows, condition) {
  const calculation = condition.calculation;

  if (!slotCheckCalculationIsAggregate(calculation)) {
    return [];
  }

  const basis =
    slotCheckCalculationBasis(calculation);

  const statistic =
    slotCheckCalculationStatistic(calculation);

  const groups = new Map();

  for (const row of rows) {
    const aggregateYear =
      slotCheckYearFor(row, basis);

    if (!Number.isFinite(aggregateYear)) {
      continue;
    }

    if (
      condition.years.length &&
      !condition.years.includes(aggregateYear)
    ) {
      continue;
    }

    const key =
      `${row.trace_number}::${aggregateYear}`;

    if (!groups.has(key)) {
      groups.set(key, {
        trace_number: row.trace_number,
        trace_label: row.trace_label,
        aggregate_year: aggregateYear,
        basis,
        calculation,
        values: [],
        rows: []
      });
    }

    const group = groups.get(key);

    group.values.push(Number(row.value));
    group.rows.push(row);
  }

  const result = [];

  for (const group of groups.values()) {
    const values =
      group.values.filter(Number.isFinite);

    if (!values.length) continue;

    let value = null;

    if (statistic === 'sum') {
      value = values.reduce(
        (total, x) => total + x,
        0
      );
    }
    else if (statistic === 'avg') {
      value =
        values.reduce(
          (total, x) => total + x,
          0
        ) / values.length;
    }
    else if (statistic === 'min') {
      value = Math.min(...values);
    }
    else if (statistic === 'max') {
      value = Math.max(...values);
    }

    result.push({
      ...group,
      value,
      count: values.length
    });
  }

  return result;
}


function slotCheckConditionMatches(rows, condition) {
  if (
    slotCheckCalculationIsAggregate(
      condition.calculation
    )
  ) {
    return slotCheckAggregateRows(
      rows,
      condition
    ).filter(group =>
      slotCheckPass(
        group.value,
        condition
      )
    );
  }

  return rows.filter(row =>
    slotCheckPeriodPass(row, condition) &&
    slotCheckPass(row.value, condition)
  );
}


function slotCheckAggregateKey(condition, row) {
  const basis =
    slotCheckCalculationBasis(
      condition.calculation
    );

  const year =
    slotCheckYearFor(row, basis);

  return `${row.trace_number}::${year}`;
}


function slotCheckAggregateColumnName(condition) {
  return `${condition.slot} — ${
    slotCheckCalculationLabel(
      condition.calculation
    )
  }`;
}


function slotCheckRowBelongsToAggregate(
  row,
  aggregateMatch
) {
  if (
    Number(row.trace_number) !==
    Number(aggregateMatch.trace_number)
  ) {
    return false;
  }

  return (
    slotCheckYearFor(
      row,
      aggregateMatch.basis
    ) ===
    aggregateMatch.aggregate_year
  );
}


function slotCheckChooseAggregatePeriods(
  rows,
  aggregateMatch,
  returnMode
) {
  const matching = rows
    .filter(row =>
      slotCheckRowBelongsToAggregate(
        row,
        aggregateMatch
      )
    )
    .sort((a, b) => {
      if (a.year !== b.year) {
        return a.year - b.year;
      }

      return a.month - b.month;
    });

  if (!matching.length) {
    return [];
  }

  if (returnMode === 'start') {
    return [matching[0]];
  }

  if (returnMode === 'end') {
    return [matching[matching.length - 1]];
  }

  return matching;
}


/*
 * Load all slots required by the analysis.
 *
 * Prefer the batched backend endpoint that is already available in
 * this application. If an older backend does not have that endpoint,
 * fall back to the existing single-slot loader.
 */
async function loadSlotCheckPayloads(slots) {
  const unique = [...new Set(slots.filter(Boolean))];

  if (!unique.length) {
    return new Map();
  }

  try {
    const response = await fetch(
      `/api/rdf/session/${
        encodeURIComponent(state.rdfSessionId)
      }/slots?names=${
        encodeURIComponent(unique.join(','))
      }`
    );

    if (response.ok) {
      const data =
        await response.json();

      const result =
        new Map();

      for (const slot of unique) {
        const payload =
          data?.slots?.[slot];

        if (payload) {
          result.set(slot, payload);

          /*
           * Also retain it in the browser cache used by Explorer.
           */
          if (state.explorerSlotCache) {
            state.explorerSlotCache.set(
              slot,
              payload
            );
          }
        }
      }

      /*
       * A missing slot should still receive the normal error behavior
       * from the existing loader.
       */
      for (const slot of unique) {
        if (!result.has(slot)) {
          result.set(
            slot,
            await getExplorerSlotPayload(slot)
          );
        }
      }

      return result;
    }
  }
  catch (error) {
    console.warn(
      'Batch slot loading unavailable; falling back to individual loading.',
      error
    );
  }

  return new Map(
    await Promise.all(
      unique.map(async slot => [
        slot,
        await getExplorerSlotPayload(slot)
      ])
    )
  );
}


async function runGenericSlotChecks() {
  const conditions =
    readSlotCheckConditions();

  if (!conditions.length) {
    showError(
      'Add at least one valid Data Analysis condition.'
    );
    return;
  }

  if (!state.rdfSessionId) {
    showError(
      'Discover RDF slots first.'
    );
    return;
  }

  hideError();

  const runKey =
    document.getElementById(
      'slotCheckRun'
    )?.value || 'current';

  const mode =
    document.getElementById(
      'slotCheckMatchMode'
    )?.value || 'same_period';

  const logic =
    document.getElementById(
      'slotCheckLogic'
    )?.value || 'all';

  const returnMode =
    document.getElementById(
      'slotCheckReturnPeriod'
    )?.value || 'all';

  const returnSlots = [
    ...(
      document.getElementById(
        'slotCheckReturnSlots'
      )?.selectedOptions || []
    )
  ]
    .map(o => o.value)
    .filter(Boolean);

  const allSlots = [
    ...new Set([
      ...conditions.map(c => c.slot),
      ...returnSlots
    ])
  ];

  setLoading(
    'Running RiverWare data analysis',
    `Loading ${allSlots.length} required slot(s) and applying trace filters.`
  );

  try {
    const payloads =
      await loadSlotCheckPayloads(
        allSlots
      );

    /*
     * Build source rows once per slot.
     */
    const rowsBySlot = new Map();

    for (const slot of allSlots) {
      rowsBySlot.set(
        slot,
        slotCheckRows(
          payloads.get(slot),
          runKey,
          slot
        )
      );
    }

    /*
     * Evaluate each condition.
     */
    const evaluations =
      conditions.map(condition => ({
        condition,

        matches:
          slotCheckConditionMatches(
            rowsBySlot.get(condition.slot) || [],
            condition
          )
      }));

    const aggregateEvaluations =
      evaluations.filter(x =>
        slotCheckCalculationIsAggregate(
          x.condition.calculation
        )
      );

    const individualEvaluations =
      evaluations.filter(x =>
        !slotCheckCalculationIsAggregate(
          x.condition.calculation
        )
      );

    let resultRows = [];

    /*
     * ----------------------------------------------------------
     * AGGREGATE QUERY
     * ----------------------------------------------------------
     *
     * Aggregate conditions qualify trace/year combinations first.
     *
     * Related slots are then returned for all/start/end periods in
     * the qualifying year.
     */
    if (aggregateEvaluations.length) {

      /*
       * Convert every aggregate match into a comparable key.
       *
       * A condition's own calendar/water-year basis is retained.
       */
      const matchSets =
        aggregateEvaluations.map(ev =>
          new Set(
            ev.matches.map(match =>
              `${match.trace_number}::${
                match.aggregate_year
              }`
            )
          )
        );

      let qualifiedKeys =
        new Set(matchSets[0] || []);

      for (
        const next of matchSets.slice(1)
      ) {
        qualifiedKeys =
          logic === 'any'
            ? new Set([
                ...qualifiedKeys,
                ...next
              ])
            : new Set(
                [...qualifiedKeys]
                  .filter(x => next.has(x))
              );
      }

      /*
       * If individual conditions are also present, restrict aggregate
       * trace/year groups according to those individual matches.
       */
      if (
        individualEvaluations.length &&
        logic === 'all'
      ) {
        for (
          const ev of individualEvaluations
        ) {
          qualifiedKeys =
            new Set(
              [...qualifiedKeys].filter(key => {
                const [
                  traceText,
                  yearText
                ] = key.split('::');

                const trace =
                  Number(traceText);

                const year =
                  Number(yearText);

                return ev.matches.some(row =>
                  row.trace_number === trace &&
                  (
                    slotCheckYearFor(
                      row,
                      aggregateEvaluations[0]
                        .matches[0]?.basis ||
                      'calendar'
                    ) === year
                  )
                );
              })
            );
        }
      }

      /*
       * Create lookup tables for aggregate condition values.
       */
      const aggregateValueMaps =
        aggregateEvaluations.map(ev => {
          const map = new Map();

          for (const match of ev.matches) {
            map.set(
              `${match.trace_number}::${
                match.aggregate_year
              }`,
              match
            );
          }

          return {
            condition: ev.condition,
            map
          };
        });

      /*
       * Determine the anchor basis. In the common case all aggregate
       * conditions use the same year basis.
       */
      const primaryAggregate =
        aggregateEvaluations[0];

      const primaryBasis =
        slotCheckCalculationBasis(
          primaryAggregate.condition.calculation
        );

      /*
       * Use the first related slot as the row-period anchor. If no
       * related slot was selected, use the first condition slot.
       */
      const anchorSlot =
        returnSlots[0] ||
        conditions[0].slot;

      const anchorRows =
        rowsBySlot.get(anchorSlot) || [];

      for (const key of qualifiedKeys) {
        const [
          traceText,
          yearText
        ] = key.split('::');

        const traceNumber =
          Number(traceText);

        const aggregateYear =
          Number(yearText);

        const representative =
          primaryAggregate.matches.find(m =>
            m.trace_number === traceNumber &&
            m.aggregate_year === aggregateYear
          );

        if (!representative) {
          continue;
        }

        const matchingAnchorRows =
          slotCheckChooseAggregatePeriods(
            anchorRows,
            {
              trace_number: traceNumber,
              aggregate_year: aggregateYear,
              basis: primaryBasis
            },
            returnMode
          );

        /*
         * If the anchor slot has no rows, still emit one aggregate row.
         */
        const eventRows =
          matchingAnchorRows.length
            ? matchingAnchorRows
            : [{
                trace_number: traceNumber,
                trace_label:
                  representative.trace_label,
                period_key:
                  `${primaryBasis}-${
                    aggregateYear
                  }`,
                period:
                  primaryBasis === 'water'
                    ? `WY ${aggregateYear}`
                    : `CY ${aggregateYear}`,
                year: aggregateYear,
                month: NaN,
                value: null
              }];

        for (const event of eventRows) {
          const values = {};

          /*
           * Return raw related-slot values at this trace/period.
           */
          for (const slot of allSlots) {
            const rows =
              rowsBySlot.get(slot) || [];

            const exact =
              rows.find(row =>
                row.trace_number ===
                  traceNumber &&
                row.period_key ===
                  event.period_key
              );

            values[slot] =
              exact?.value ?? null;
          }

          /*
           * Add aggregate values as separate result columns.
           */
          const aggregateValues = {};

          for (
            const item of aggregateValueMaps
          ) {
            const aggregateMatch =
              item.map.get(key);

            const column =
              slotCheckAggregateColumnName(
                item.condition
              );

            aggregateValues[column] =
              aggregateMatch?.value ?? null;
          }

          resultRows.push({
            ...event,

            aggregate_year:
              aggregateYear,

            aggregate_basis:
              primaryBasis,

            values,

            aggregateValues
          });
        }
      }
    }

    /*
     * ----------------------------------------------------------
     * INDIVIDUAL-VALUE QUERY
     * ----------------------------------------------------------
     *
     * Preserve the previous behavior when no aggregate calculation
     * is being used.
     */
    else {
      const conditionMatches =
        individualEvaluations.map(
          x => x.matches
        );

      let anchorEvents = [];

      if (mode === 'trace_any') {
        let traces =
          new Set(
            conditionMatches[0]
              .map(r => r.trace_number)
          );

        for (
          const rows of
          conditionMatches.slice(1)
        ) {
          const next =
            new Set(
              rows.map(
                r => r.trace_number
              )
            );

          traces =
            logic === 'any'
              ? new Set([
                  ...traces,
                  ...next
                ])
              : new Set(
                  [...traces]
                    .filter(x =>
                      next.has(x)
                    )
                );
        }

        const sourceRows =
          logic === 'any'
            ? conditionMatches.flat()
            : conditionMatches[0];

        const seenEvents =
          new Set();

        anchorEvents =
          sourceRows.filter(r => {
            const k =
              `${r.trace_number}::${
                r.period_key
              }`;

            if (
              !traces.has(
                r.trace_number
              ) ||
              seenEvents.has(k)
            ) {
              return false;
            }

            seenEvents.add(k);
            return true;
          });
      }

      else {
        const key = r =>
          `${r.trace_number}::${
            r.period_key
          }`;

        let keys =
          new Set(
            conditionMatches[0]
              .map(key)
          );

        for (
          const rows of
          conditionMatches.slice(1)
        ) {
          const next =
            new Set(
              rows.map(key)
            );

          keys =
            logic === 'any'
              ? new Set([
                  ...keys,
                  ...next
                ])
              : new Set(
                  [...keys]
                    .filter(x =>
                      next.has(x)
                    )
                );
        }

        const sourceRows =
          logic === 'any'
            ? conditionMatches.flat()
            : conditionMatches[0];

        const seenEvents =
          new Set();

        anchorEvents =
          sourceRows.filter(r => {
            const k = key(r);

            if (
              !keys.has(k) ||
              seenEvents.has(k)
            ) {
              return false;
            }

            seenEvents.add(k);
            return true;
          });
      }

      const relatedMaps =
        new Map();

      for (const slot of allSlots) {
        const map = new Map();

        for (
          const row of
          rowsBySlot.get(slot) || []
        ) {
          map.set(
            `${row.trace_number}::${
              row.period_key
            }`,
            row
          );
        }

        relatedMaps.set(
          slot,
          map
        );
      }

      resultRows =
        anchorEvents.map(event => {
          const key =
            `${event.trace_number}::${
              event.period_key
            }`;

          const values = {};

          allSlots.forEach(slot => {
            values[slot] =
              relatedMaps
                .get(slot)
                ?.get(key)
                ?.value ?? null;
          });

          return {
            ...event,
            values,
            aggregateValues: {}
          };
        });
    }

    /*
     * Sort result rows by trace and chronological period.
     */
    resultRows.sort((a, b) => {
      if (
        a.trace_number !==
        b.trace_number
      ) {
        return (
          a.trace_number -
          b.trace_number
        );
      }

      if (
        Number(a.year) !==
        Number(b.year)
      ) {
        return (
          Number(a.year) -
          Number(b.year)
        );
      }

      return (
        Number(a.month || 0) -
        Number(b.month || 0)
      );
    });

    const aggregateColumns =
      aggregateEvaluations.map(ev =>
        slotCheckAggregateColumnName(
          ev.condition
        )
      );

    state.slotCheckResults =
      resultRows;

    state.slotCheckColumns =
      allSlots;

    state.slotCheckAggregateColumns =
      aggregateColumns;

    renderSlotCheckResults(
      runKey,
      conditions,
      resultRows,
      allSlots,
      aggregateColumns,
      payloads
    );
  }

  catch (err) {
    console.error(
      'Data Analysis failed:',
      err
    );

    showError(
      err.message ||
      'Data Analysis failed.'
    );
  }

  finally {
    clearLoading();
  }
}


function renderSlotCheckResults(
  runKey,
  conditions,
  rows,
  columns,
  aggregateColumns=[],
  payloads
) {
  const host =
    document.getElementById(
      'slotCheckResults'
    );

  const summary =
    document.getElementById(
      'slotCheckSummary'
    );

  const meta =
    document.getElementById(
      'slotCheckMeta'
    );

  const traces =
    new Set(
      rows.map(
        r => r.trace_number
      )
    );

  const aggregateConditions =
    conditions.filter(c =>
      slotCheckCalculationIsAggregate(
        c.calculation
      )
    );

  const conditionDescription =
    aggregateConditions.length
      ? aggregateConditions
          .map(c => {
            const years =
              c.years.length
                ? c.years.join(', ')
                : 'all years';

            const valueText =
              c.op === 'any'
                ? 'any value'
                : c.op === 'between'
                  ? `${c.value}–${c.value2}`
                  : `${c.op} ${c.value}`;

            return `${
              c.slot
            } · ${
              slotCheckCalculationLabel(
                c.calculation
              )
            } · ${
              years
            } · ${
              valueText
            }`;
          })
          .join(' | ')
      : `${conditions.length} individual-value condition${
          conditions.length === 1
            ? ''
            : 's'
        }`;

  summary.innerHTML = `
    <strong>
      ${traces.size} matching ensemble trace${
        traces.size === 1 ? '' : 's'
      } ·
      ${rows.length} returned event${
        rows.length === 1 ? '' : 's'
      }
    </strong>
    <span>
      ${escapeHtml(conditionDescription)}.
      Max/Min/Most deterministic traces are excluded.
    </span>`;

  const hasAggregate =
    aggregateColumns.length > 0;

  const headers = [
    'Trace label',
    'Trace',
    ...(hasAggregate
      ? ['Analysis year']
      : []),
    'Period',
    ...aggregateColumns,
    ...columns
  ];

  const body =
    rows.map(r => `
      <tr>
        <td>${escapeHtml(
          r.trace_label
        )}</td>

        <td>${
          r.trace_number
        }</td>

        ${
          hasAggregate
            ? `<td>${
                r.aggregate_basis === 'water'
                  ? 'WY '
                  : 'CY '
              }${
                r.aggregate_year ?? ''
              }</td>`
            : ''
        }

        <td>${escapeHtml(
          r.period
        )}</td>

        ${aggregateColumns.map(
          column =>
            `<td>${
              r.aggregateValues?.[column] == null
                ? '—'
                : fmtNumber(
                    r.aggregateValues[column],
                    2
                  )
            }</td>`
        ).join('')}

        ${columns.map(
          slot =>
            `<td>${
              r.values?.[slot] == null
                ? '—'
                : fmtNumber(
                    r.values[slot],
                    2
                  )
            }</td>`
        ).join('')}
      </tr>`
    ).join('');

  host.innerHTML =
    rows.length
      ? `
        <table class="explorer-data-table slot-check-results-table">
          <thead>
            <tr>
              ${headers.map(
                h =>
                  `<th>${escapeHtml(h)}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>
            ${body}
          </tbody>
        </table>`
      : `
        <div class="rdf-slot-empty">
          No ensemble traces matched the current conditions.
        </div>`;

  meta.textContent =
    `${
      runKey === 'current'
        ? 'Run A'
        : 'Run B'
    } · ${
      traces.size
    } distinct ensemble trace(s) · ${
      rows.length
    } returned row(s)`;

  document.getElementById(
    'exportSlotChecksCsv'
  ).disabled = !rows.length;
}


function exportSlotChecksCsv() {
  if (
    !state.slotCheckResults?.length
  ) {
    return;
  }

  const esc = v =>
    `"${String(v ?? '')
      .replaceAll('"', '""')}"`;

  const aggregateColumns =
    state.slotCheckAggregateColumns ||
    [];

  const hasAggregate =
    aggregateColumns.length > 0;

  const headers = [
    'Trace label',
    'Trace number',
    ...(hasAggregate
      ? ['Analysis year']
      : []),
    'Period',
    ...aggregateColumns,
    ...state.slotCheckColumns
  ];

  const rows = [
    headers,

    ...state.slotCheckResults.map(r => [
      r.trace_label,
      r.trace_number,

      ...(hasAggregate
        ? [
            `${
              r.aggregate_basis === 'water'
                ? 'WY '
                : 'CY '
            }${
              r.aggregate_year ?? ''
            }`
          ]
        : []),

      r.period,

      ...aggregateColumns.map(
        column =>
          r.aggregateValues?.[column] ??
          ''
      ),

      ...state.slotCheckColumns.map(
        slot =>
          r.values?.[slot] ??
          ''
      )
    ])
  ];

  downloadBlob(
    new Blob(
      [
        rows
          .map(row =>
            row.map(esc).join(',')
          )
          .join('\r\n')
      ],
      {
        type:
          'text/csv;charset=utf-8'
      }
    ),
    'CRMMS-data-analysis-results.csv'
  );
}


function resetSlotChecks() {
  const host =
    document.getElementById(
      'slotCheckConditions'
    );

  if (host) {
    host.innerHTML = '';
  }

  addSlotCheckCondition({
    slot:
      state.explorerData?.slot ||
      explorerSlot?.value ||
      ''
  });

  const returns =
    document.getElementById(
      'slotCheckReturnSlots'
    );

  if (returns) {
    [...returns.options]
      .forEach(o => {
        o.selected = false;
      });
  }

  const returnPeriod =
    document.getElementById(
      'slotCheckReturnPeriod'
    );

  if (returnPeriod) {
    returnPeriod.value = 'all';
  }

  state.slotCheckResults = [];
  state.slotCheckColumns = [];
  state.slotCheckAggregateColumns = [];

  const summary =
    document.getElementById(
      'slotCheckSummary'
    );

  const results =
    document.getElementById(
      'slotCheckResults'
    );

  const meta =
    document.getElementById(
      'slotCheckMeta'
    );

  if (summary) {
    summary.innerHTML =
      '<strong>No analysis run yet.</strong><span>Add one or more conditions and choose Run analysis.</span>';
  }

  if (results) {
    results.innerHTML =
      '<div class="rdf-slot-empty">No results yet.</div>';
  }

  if (meta) {
    meta.textContent =
      'Results are aligned by actual RiverWare trace number and period.';
  }

  const exportButton =
    document.getElementById(
      'exportSlotChecksCsv'
    );

  if (exportButton) {
    exportButton.disabled = true;
  }
}


function slotChecksSnapshot() {
  const conditions = [
    ...document.querySelectorAll(
      '.slot-check-condition'
    )
  ].map(div => ({
    slot:
      div.querySelector(
        '.slot-check-slot'
      )?.value || '',

    calculation:
      div.querySelector(
        '.slot-check-calculation'
      )?.value || 'individual',

    op:
      div.querySelector(
        '.slot-check-op'
      )?.value || 'any',

    value:
      div.querySelector(
        '.slot-check-value'
      )?.value || '',

    value2:
      div.querySelector(
        '.slot-check-value2'
      )?.value || '',

    month:
      div.querySelector(
        '.slot-check-month'
      )?.value || '0',

    year_basis:
      div.querySelector(
        '.slot-check-year-basis'
      )?.value || 'any',

    years:
      div.querySelector(
        '.slot-check-years'
      )?.value || ''
  }));

  return {
    run:
      document.getElementById(
        'slotCheckRun'
      )?.value || 'current',

    match_mode:
      document.getElementById(
        'slotCheckMatchMode'
      )?.value || 'same_period',

    logic:
      document.getElementById(
        'slotCheckLogic'
      )?.value || 'all',

    return_period:
      document.getElementById(
        'slotCheckReturnPeriod'
      )?.value || 'all',

    conditions,

    return_slots: [
      ...(
        document.getElementById(
          'slotCheckReturnSlots'
        )?.selectedOptions || []
      )
    ]
      .map(o => o.value)
      .filter(Boolean)
  };
}


function applySlotChecksSettings(settings={}) {
  if (
    !settings ||
    typeof settings !== 'object'
  ) {
    return;
  }

  const run =
    document.getElementById(
      'slotCheckRun'
    );

  if (run && settings.run) {
    run.value = settings.run;
  }

  const mode =
    document.getElementById(
      'slotCheckMatchMode'
    );

  if (
    mode &&
    settings.match_mode
  ) {
    mode.value =
      settings.match_mode;
  }

  const logic =
    document.getElementById(
      'slotCheckLogic'
    );

  if (
    logic &&
    settings.logic
  ) {
    logic.value =
      settings.logic;
  }

  const returnPeriod =
    document.getElementById(
      'slotCheckReturnPeriod'
    );

  if (returnPeriod) {
    returnPeriod.value =
      settings.return_period ||
      'all';
  }

  const host =
    document.getElementById(
      'slotCheckConditions'
    );

  if (host) {
    host.innerHTML = '';
  }

  const conditions =
    Array.isArray(settings.conditions) &&
    settings.conditions.length
      ? settings.conditions
      : [{}];

  conditions.forEach(c =>
    addSlotCheckCondition(c)
  );

  populateSlotCheckOptions();

  const wanted =
    new Set(
      Array.isArray(
        settings.return_slots
      )
        ? settings.return_slots
        : []
    );

  const returns =
    document.getElementById(
      'slotCheckReturnSlots'
    );

  if (returns) {
    [...returns.options]
      .forEach(o => {
        o.selected =
          wanted.has(o.value);
      });
  }
}


/*
 * Control wiring
 */
const slotChecksSectionV42 =
  document.getElementById(
    'slotChecksSection'
  );

document.getElementById(
  'openSlotChecksButton'
)?.addEventListener(
  'click',
  () => {
    if (!state.rdfSessionId) {
      showError(
        'Discover RDF slots first, then open Data Analysis.'
      );
      return;
    }

    populateSlotCheckOptions();

    if (
      !document.getElementById(
        'slotCheckConditions'
      )?.children.length
    ) {
      addSlotCheckCondition({
        slot:
          state.explorerData?.slot ||
          explorerSlot?.value ||
          ''
      });
    }

    dataExplorerSection.hidden =
      true;

    slotChecksSectionV42.hidden =
      false;

    slotChecksSectionV42.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
);


document.getElementById(
  'backToExplorerButton'
)?.addEventListener(
  'click',
  () => {
    slotChecksSectionV42.hidden =
      true;

    dataExplorerSection.hidden =
      false;

    dataExplorerSection.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
);


document.getElementById(
  'addSlotCheckCondition'
)?.addEventListener(
  'click',
  () => addSlotCheckCondition()
);


document.getElementById(
  'runSlotChecks'
)?.addEventListener(
  'click',
  runGenericSlotChecks
);


document.getElementById(
  'clearSlotChecks'
)?.addEventListener(
  'click',
  resetSlotChecks
);


document.getElementById(
  'exportSlotChecksCsv'
)?.addEventListener(
  'click',
  exportSlotChecksCsv
);


/*
 * Seed one condition so the page is understandable immediately
 * after discovery.
 */
if (
  document.getElementById(
    'slotCheckConditions'
  ) &&
  !document.getElementById(
    'slotCheckConditions'
  ).children.length
) {
  addSlotCheckCondition();
}

/* ============================================================
   POWELL/MEAD DASHBOARD (EXPLORER) — full PBIX visual parity
   Lives inside Data Explorer. Single RDF run, no comparison required.
   Reads raw RDF slots through the existing Explorer session cache.
   No backend changes required.
   ============================================================ */

const PBI_SLOTS = {
  inflow: 'PowellAJUnregInflow',
  tarv: 'PowellData.TargetAnnualReleaseVolume',
  aarv: 'PowellData.ActualAnnualReleaseVolume',
  powellPE: 'Powell.Pool Elevation',
  powellStorage: 'Powell.Storage',
  powellTier: 'PowellData.ReleaseTier',
  meadPE: 'Mead.Pool Elevation',
  meadStorage: 'Mead.Storage',
  cap: 'CAPDiversion.Total Diversion Requested',
  mwd: 'MWDDiversion.Total Diversion Requested',
  snwa: 'PumpingFromLakeMead:SNWP.Diversion Requested',
  caIcs: 'ICS Credits.Bank_CA',
  azIcs: 'ICS Credits.Bank_AZ',
  nvIcs: 'ICS Credits.Bank_NV',
  lbNormal: 'CoordinatedOperationsFlagsForFreqTbl.LBNormalCondition',
  surplus: 'Surplus.AnnualSurplusFlag',
  short1: 'CoordinatedOperationsFlagsForFreqTbl.Step1ShortageFlag',
  short2: 'CoordinatedOperationsFlagsForFreqTbl.Step2ShortageFlag',
  short3: 'CoordinatedOperationsFlagsForFreqTbl.Step3ShortageFlag'
};

const PBI_TIER_LABELS = {0:'ET',1:'UEBT',2:'MERT',3:'LEBT'};

const pbiDashboardState = {
  loaded: false,
  loading: false,
  payloads: {},
  years: [],
  selectedYear: null,
  runKey: 'current',

  // Trace Detail Matrix sorting.
  // Default behavior remains WY Unreg Inflow descending when available.
  matrixSortKey: 'inflow',
  matrixSortDirection: 'desc'
};

function pbiResetDashboardState() {
  pbiDashboardState.loaded = false;
  pbiDashboardState.loading = false;
  pbiDashboardState.payloads = {};
  pbiDashboardState.years = [];
  pbiDashboardState.selectedYear = null;

  pbiDashboardState.matrixSortKey = 'inflow';
  pbiDashboardState.matrixSortDirection = 'desc';
}

function pbiLogicalSlotMap() {
  return {...PBI_SLOTS};
}

async function pbiFetchAllSlots() {
  if (!state.rdfSessionId) throw new Error('Discover RDF slots first, then open the Powell/Mead Dashboard.');
  const map = pbiLogicalSlotMap();
  const entries = Object.entries(map);
  const slotNames = entries.map(([, slot]) => slot);

  const response = await fetch(`/api/rdf/session/${encodeURIComponent(state.rdfSessionId)}/slots?names=${encodeURIComponent(slotNames.join(','))}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || 'Could not batch-load RDF slots for the dashboard.');

  const slotsResult = payload.slots || {};
  const missingSet = new Set(payload.missing || []);
  const payloads = {};
  const missing = [];
  for (const [key, slotName] of entries) {
    const found = slotsResult[slotName];
    if (found && !missingSet.has(slotName)) payloads[key] = found;
    else missing.push(slotName);
  }
  return {payloads, missing};
}

function pbiYearsFromPayload(payload) {
  const years = new Set();
  const run = payload?.current;
  if (!run) return [];
  for (const trace of run.traces || []) {
    for (const v of trace.values || []) {
      if (v.year != null) years.add(Number(v.year));
    }
  }
  return [...years].sort((a,b) => a-b);
}

function pbiTraceValueAt(payload, traceNumber, year, month=null) {
  const run = payload?.current;
  if (!run) return null;
  const trace = run.traces?.find(t => Number(t.trace_number) === Number(traceNumber));
  if (!trace) return null;
  const matches = (trace.values || []).filter(v => Number(v.year) === Number(year) && (month == null || Number(v.month) === month));
  if (!matches.length) return null;
  return matches[matches.length - 1].value;
}

function pbiTraceAnnualValue(payload, traceNumber, year) {
  return pbiTraceValueAt(payload, traceNumber, year, null);
}

function pbiEnsembleTraceNumbers(payload) {
  const defs = payload?.trace_defaults || [];
  return defs.filter(d => d.role !== 'deterministic').map(d => Number(d.trace_number));
}

function pbiCountTraces(payload, year, predicate) {
  if (!payload) return null;
  const traces = pbiEnsembleTraceNumbers(payload);
  let count = 0;
  let any = false;
  for (const t of traces) {
    const v = pbiTraceAnnualValue(payload, t, year);
    if (v == null) continue;
    any = true;
    if (predicate(v)) count++;
  }
  return any ? count : null;
}

function pbiRenderTierCards(container, year) {
  const powellTier = pbiDashboardState.payloads.powellTier;
  const lbNormal = pbiDashboardState.payloads.lbNormal;
  const surplus = pbiDashboardState.payloads.surplus;
  const s1 = pbiDashboardState.payloads.short1;
  const s2 = pbiDashboardState.payloads.short2;
  const s3 = pbiDashboardState.payloads.short3;
  const nextYear = year + 1;

  const tierCounts = {};
  for (const [code, label] of Object.entries(PBI_TIER_LABELS)) {
    tierCounts[label] = pbiCountTraces(powellTier, nextYear, v => Math.round(v) === Number(code));
  }
  const condCounts = {
    'Normal': pbiCountTraces(lbNormal, nextYear, v => v === 1),
    'Surplus': pbiCountTraces(surplus, nextYear, v => v === 1),
    'Lvl. 1 Short.': pbiCountTraces(s1, nextYear, v => v === 1),
    'Lvl. 2 Short.': pbiCountTraces(s2, nextYear, v => v === 1),
    'Lvl. 3 Short.': pbiCountTraces(s3, nextYear, v => v === 1)
  };

  const card = (label, value, foot) => `<div class="pbi-tier-card">
    <div class="pbi-tier-label">${escapeHtml(label)}</div>
    <div class="pbi-tier-value">${value == null ? '—' : value}</div>
    <div class="pbi-tier-foot">${escapeHtml(foot)}</div>
  </div>`;

  container.innerHTML = `
    <div class="pbi-section-title">Powell Operating Tier — WY ${nextYear} (traces)</div>
    <div class="pbi-card-grid">
      ${Object.entries(tierCounts).map(([label, value]) => card(label, value, `WY ${nextYear}`)).join('')}
    </div>
    <div class="pbi-section-title">Lower Basin Condition — CY ${nextYear} (traces)</div>
    <div class="pbi-card-grid">
      ${Object.entries(condCounts).map(([label, value]) => card(label, value, `CY ${nextYear}`)).join('')}
    </div>`;
}

function pbiRenderTraceMatrix(container, year) {
  const inflow = pbiDashboardState.payloads.inflow;
  const tarv = pbiDashboardState.payloads.tarv;
  const powellPE = pbiDashboardState.payloads.powellPE;
  const powellStorage = pbiDashboardState.payloads.powellStorage;
  const powellTier = pbiDashboardState.payloads.powellTier;
  const meadPE = pbiDashboardState.payloads.meadPE;
  const meadStorage = pbiDashboardState.payloads.meadStorage;
  const aarv = pbiDashboardState.payloads.aarv;

  const nextYear = year + 1;

  const basePayload =
    inflow ||
    powellPE ||
    powellStorage ||
    powellTier ||
    meadPE ||
    meadStorage ||
    tarv ||
    aarv;

  if (!basePayload) {
    container.innerHTML =
      '<div class="pbi-empty">No slots available to build the trace matrix.</div>';
    return;
  }

  const traces =
    pbiEnsembleTraceNumbers(basePayload);

  const rows = traces.map(t => {
    const inflowVal =
      inflow
        ? pbiTraceAnnualValue(
            inflow,
            t,
            year
          )
        : null;

    return {
      trace: t,

      label:
        explorerTraceLabel(
          t,
          `Trace ${t}`
        ),

      inflow:
        inflowVal,

      tarv:
        tarv
          ? pbiTraceAnnualValue(
              tarv,
              t,
              year
            )
          : null,

      aarv:
        aarv
          ? pbiTraceAnnualValue(
              aarv,
              t,
              year
            )
          : null,

      eowyPE:
        powellPE
          ? pbiTraceValueAt(
              powellPE,
              t,
              year,
              9
            )
          : null,

      eocyPE:
        powellPE
          ? pbiTraceValueAt(
              powellPE,
              t,
              year,
              12
            )
          : null,

      tierNextWY:
        powellTier
          ? pbiTraceAnnualValue(
              powellTier,
              t,
              nextYear
            )
          : null,

      eowyStorage:
        powellStorage
          ? pbiTraceValueAt(
              powellStorage,
              t,
              year,
              9
            )
          : null,

      meadEowyStorage:
        meadStorage
          ? pbiTraceValueAt(
              meadStorage,
              t,
              year,
              9
            )
          : null,

      meadEowyPE:
        meadPE
          ? pbiTraceValueAt(
              meadPE,
              t,
              year,
              9
            )
          : null,

      meadEocyPE:
        meadPE
          ? pbiTraceValueAt(
              meadPE,
              t,
              year,
              12
            )
          : null
    };
  });


  /*
   * ----------------------------------------------------------
   * MATRIX SORTING
   * ----------------------------------------------------------
   *
   * Sortable columns:
   *
   *   WY Unreg Inflow
   *   TARV
   *   AARV
   *
   * Clicking the active column reverses the direction.
   * Clicking another sortable column starts descending.
   */

  let sortKey =
    pbiDashboardState.matrixSortKey ||
    'inflow';

  let sortDirection =
    pbiDashboardState.matrixSortDirection ||
    'desc';

  /*
   * If the default Inflow slot is unavailable, use trace order
   * until the user selects another available sortable column.
   */
  if (
    sortKey === 'inflow' &&
    !inflow
  ) {
    sortKey = 'trace';
    sortDirection = 'asc';
  }

  const sortedRows =
    [...rows];

  sortedRows.sort((a, b) => {
    if (sortKey === 'trace') {
      return a.trace - b.trace;
    }

    const av =
      a[sortKey];

    const bv =
      b[sortKey];

    /*
     * Null values always appear at the bottom regardless of
     * sort direction.
     */
    const aMissing =
      av == null ||
      !Number.isFinite(Number(av));

    const bMissing =
      bv == null ||
      !Number.isFinite(Number(bv));

    if (
      aMissing &&
      bMissing
    ) {
      return a.trace - b.trace;
    }

    if (aMissing) return 1;
    if (bMissing) return -1;

    const difference =
      Number(av) - Number(bv);

    if (difference === 0) {
      return a.trace - b.trace;
    }

    return sortDirection === 'asc'
      ? difference
      : -difference;
  });


  const cols = [
    {
      key: 'label',
      label: 'Trace',
      sticky: true
    },
    {
      key: 'inflow',
      label: 'WY Unreg Inflow',
      sortable: true,
      available: Boolean(inflow)
    },
    {
      key: 'tarv',
      label: 'TARV',
      sortable: true,
      available: Boolean(tarv)
    },
    {
      key: 'aarv',
      label: 'AARV',
      sortable: true,
      available: Boolean(aarv)
    },
    {
      key: 'eowyPE',
      label: 'Powell EOWY PE'
    },
    {
      key: 'eocyPE',
      label: 'Powell EOCY PE'
    },
    {
      key: 'tierNextWY',
      label: 'Tier Next WY'
    },
    {
      key: 'eowyStorage',
      label: 'Powell EOWY Storage'
    },
    {
      key: 'meadEowyStorage',
      label: 'Mead EOWY Storage'
    },
    {
      key: 'meadEowyPE',
      label: 'Mead EOWY PE'
    },
    {
      key: 'meadEocyPE',
      label: 'Mead EOCY PE'
    }
  ];


  const head =
    cols.map(col => {
      const active =
        col.key === sortKey;

      const arrow =
        active
          ? (
              sortDirection === 'asc'
                ? '▲'
                : '▼'
            )
          : '⇅';

      if (col.sortable) {
        return `
          <th
            class="pbi-matrix-sortable ${
              active
                ? 'is-sorted'
                : ''
            } ${
              col.available
                ? ''
                : 'has-no-data'
            }"
            data-pbi-sort="${col.key}"
            title="${
              col.available
                ? `Sort by ${escapeHtml(col.label)}`
                : `${escapeHtml(col.label)} slot is not currently available`
            }"
          >
            <button
              type="button"
              class="pbi-matrix-sort-button"
              data-pbi-sort="${col.key}"
            >
              <span>${escapeHtml(col.label)}</span>
              <span
                class="pbi-matrix-sort-arrow"
                aria-hidden="true"
              >${arrow}</span>
            </button>
          </th>`;
      }

      return `
        <th>
          ${escapeHtml(col.label)}
        </th>`;
    }).join('');


  const body =
    sortedRows.map(r => `
      <tr>
        ${cols.map(col => {
          const key =
            col.key;

          if (key === 'label') {
            return `
              <td class="pbi-matrix-trace-cell">
                ${escapeHtml(r[key])}
              </td>`;
          }

          if (key === 'tierNextWY') {
            return `
              <td>
                ${
                  r[key] != null
                    ? (
                        PBI_TIER_LABELS[
                          Math.round(r[key])
                        ] ||
                        r[key]
                      )
                    : '—'
                }
              </td>`;
          }

          return `
            <td>
              ${
                r[key] != null
                  ? fmtNumber(
                      r[key],
                      1
                    )
                  : '—'
              }
            </td>`;
        }).join('')}
      </tr>
    `).join('');


  const inflowNote =
    inflow
      ? ''
      : `
        <div
          class="pbi-status"
          style="margin-bottom:8px;color:#8b6427"
        >
          Powell WY Unreg Inflow slot not found —
          column shown blank. Use TARV or AARV headers
          to sort, or rows remain in trace order.
        </div>`;


  container.innerHTML = `
    <div class="pbi-section-title">
      Trace Detail Matrix — WY ${year}
    </div>

    ${inflowNote}

    <div class="pbi-matrix-scroll">
      <table class="pbi-trace-matrix-table">
        <thead>
          <tr>
            ${head}
          </tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
    </div>`;


  /*
   * Wire sortable headers after the table has been inserted.
   */
  container
    .querySelectorAll(
      '.pbi-matrix-sort-button'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          const key =
            button.dataset.pbiSort;

          if (!key) return;

          if (
            pbiDashboardState.matrixSortKey ===
            key
          ) {
            pbiDashboardState.matrixSortDirection =
              pbiDashboardState.matrixSortDirection ===
              'desc'
                ? 'asc'
                : 'desc';
          }
          else {
            pbiDashboardState.matrixSortKey =
              key;

            /*
             * Numeric dashboard measures start descending,
             * which puts the largest values first.
             */
            pbiDashboardState.matrixSortDirection =
              'desc';
          }

          /*
           * Re-render only the matrix. Other dashboard plots
           * are left untouched.
           */
          pbiRenderTraceMatrix(
            container,
            year
          );
        }
      );
    });
}
function pbiRenderDiversionCharts(container, year) {
  const specs = [
    ['cap', 'CAP Diversion'],
    ['mwd', 'MWD Diversion'],
    ['snwa', 'SNWA Diversion']
  ];
  container.innerHTML = specs.map(([key], i) => `<div class="pbi-chart-card"><div id="pbiDiversionChart${i}" class="pbi-chart"></div></div>`).join('');
  specs.forEach(([key, title], i) => {
    const payload = pbiDashboardState.payloads[key];
    const el = document.getElementById(`pbiDiversionChart${i}`);
    if (!payload) { el.innerHTML = `<div class="pbi-empty">${escapeHtml(title)}: slot not available.</div>`; return; }
    const traces = pbiEnsembleTraceNumbers(payload);
    const rows = traces.map(t => ({trace:t, label:explorerTraceLabel(t, `Trace ${t}`), value:pbiTraceAnnualValue(payload, t, year)}))
      .filter(r => r.value != null).sort((a,b) => a.value - b.value);
    Plotly.newPlot(el, [{
      type:'bar', x:rows.map(r=>r.label), y:rows.map(r=>r.value),
      marker:{color:'var(--teal)'}, hovertemplate:'%{x}<br>%{y:.1f}<extra></extra>'
    }], {
      title:{text:`${title} — WY ${year}`, font:{family:EXPLORER_PLOT_FONT, size:14, color:'#334957'}},
      margin:{l:55,r:20,t:40,b:130},
      xaxis:{tickangle:-90, tickmode:'array', tickvals:rows.map(r=>r.label), ticktext:rows.map(r=>r.label), tickfont:{size:9}, automargin:true},
      yaxis:{title:'KAF'},
      font:{family:'"Segoe UI",Tahoma,sans-serif',size:10}
    }, {responsive:true, displaylogo:false});
  });
}

function pbiRenderIcsChart(container, year) {
  container.innerHTML = `<div class="pbi-chart-card"><div id="pbiIcsChart" class="pbi-chart"></div></div>`;
  const el = document.getElementById('pbiIcsChart');
  const ca = pbiDashboardState.payloads.caIcs, az = pbiDashboardState.payloads.azIcs, nv = pbiDashboardState.payloads.nvIcs;
  if (!ca && !az && !nv) { el.innerHTML = '<div class="pbi-empty">No ICS Bank slots available.</div>'; return; }
  const base = ca || az || nv;
  const traces = pbiEnsembleTraceNumbers(base);
  const labels = traces.map(t => explorerTraceLabel(t, `Trace ${t}`));
  const series = [
    {key:'ca', payload:ca, name:'CA ICS Bank', color:'#167c80'},
    {key:'az', payload:az, name:'AZ ICS Bank', color:'#d07a28'},
    {key:'nv', payload:nv, name:'NV ICS Bank', color:'#a84d4d'}
  ].filter(s => s.payload);
  const plotTraces = series.map(s => ({
    type:'bar', name:s.name, x:labels,
    y:traces.map(t => pbiTraceAnnualValue(s.payload, t, year)),
    marker:{color:s.color}
  }));
  Plotly.newPlot(el, plotTraces, {
    title:{text:`ICS Bank by Trace — WY ${year}`, font:{family:EXPLORER_PLOT_FONT, size:14, color:'#334957'}},
    barmode:'stack', margin:{l:55,r:20,t:40,b:130},
    xaxis:{tickangle:-90, tickmode:'array', tickvals:labels, ticktext:labels, tickfont:{size:9}, automargin:true},
    yaxis:{title:'KAF'},
    legend:{orientation:'h', y:-0.35}, font:{family:'"Segoe UI",Tahoma,sans-serif',size:10}
  }, {responsive:true, displaylogo:false});
}

function pbiRenderMeadConditionChart(container) {
  container.innerHTML = `<div class="pbi-chart-card"><div id="pbiMeadCondChart" class="pbi-chart"></div></div>`;
  const el = document.getElementById('pbiMeadCondChart');
  const lbNormal = pbiDashboardState.payloads.lbNormal;
  const surplus = pbiDashboardState.payloads.surplus;
  const s1 = pbiDashboardState.payloads.short1;
  const s2 = pbiDashboardState.payloads.short2;
  const s3 = pbiDashboardState.payloads.short3;
  if (!lbNormal && !surplus) { el.innerHTML = '<div class="pbi-empty">Lower Basin condition slots not available.</div>'; return; }
  const base = lbNormal || surplus || s1 || s2 || s3;
  const years = pbiYearsFromPayload(base);
  const condPayloads = {'Normal':lbNormal, 'Surplus':surplus, 'Lvl. 1 Short.':s1, 'Lvl. 2 Short.':s2, 'Lvl. 3 Short.':s3};

  const series = Object.entries(condPayloads).filter(([,p]) => p).map(([label, payload]) => {
    const pct = years.map(year => {
      const traces = pbiEnsembleTraceNumbers(payload);
      let hit = 0, total = 0;
      traces.forEach(t => { const v = pbiTraceAnnualValue(payload, t, year); if (v != null) { total++; if (v === 1) hit++; } });
      return total ? (hit/total*100) : null;
    });
    return {label, pct};
  });

  const colors = {'Normal':'#0072B2','Surplus':'#ddd6ac','Lvl. 1 Short.':'#33CC33','Lvl. 2 Short.':'#E69F00','Lvl. 3 Short.':'#CC6666'};
  const plotTraces = series.map(s => ({
    type:'bar', name:s.label, x:years.map(String), y:s.pct, marker:{color:colors[s.label]}
  }));
  Plotly.newPlot(el, plotTraces, {
    title:{text:'% Sum of Traces by Year and Mead Condition', font:{family:EXPLORER_PLOT_FONT, size:14, color:'#334957'}},
    barmode:'stack', margin:{l:55,r:20,t:40,b:50}, yaxis:{title:'% of traces', range:[0,100]},
    legend:{orientation:'h', y:-0.2}, font:{family:'"Segoe UI",Tahoma,sans-serif',size:10}
  }, {responsive:true, displaylogo:false});
}

function pbiRenderYearSelector() {
  const years = pbiDashboardState.years;
  const sel = pbiDashboardState.selectedYear;
  if (!years.length) {
    return `<div class="pbi-dashboard-toolbar">
      <span class="pbi-status" id="pbiStatus">No years available — see messages below.</span>
    </div>`;
  }
  return `<div class="pbi-dashboard-toolbar">
    <label>Year
      <select id="pbiYearSelect">${years.map(y => `<option value="${y}" ${y===sel?'selected':''}>${y}</option>`).join('')}</select>
    </label>
    <span class="pbi-status" id="pbiStatus">Single-run dashboard · current RDF session</span>
  </div>`;
}

function pbiRenderAll() {
  const panel = document.getElementById('pbiDashboardBody');
  if (!panel) return;
  panel.innerHTML = `
    ${pbiRenderYearSelector()}
    <div id="pbiTierCards"></div>
    <div id="pbiTraceMatrix"></div>
    <div class="pbi-section-title">Diversions</div>
    <div id="pbiDiversionCharts"></div>
    <div class="pbi-section-title">ICS Bank</div>
    <div id="pbiIcsCharts"></div>
    <div class="pbi-section-title">Mead Condition Distribution</div>
    <div id="pbiMeadCondCharts"></div>`;
  document.getElementById('pbiYearSelect')?.addEventListener('change', e => {
    pbiDashboardState.selectedYear = Number(e.target.value);
    pbiRenderDynamicParts();
  });
  pbiRenderDynamicParts();
}

function pbiRenderDynamicParts() {
  const year = pbiDashboardState.selectedYear;
  if (year == null) {
    ['pbiTierCards','pbiTraceMatrix','pbiDiversionCharts','pbiIcsCharts','pbiMeadCondCharts'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="pbi-empty">No year data available for this section.</div>';
    });
    return;
  }
  pbiRenderTierCards(document.getElementById('pbiTierCards'), year);
  pbiRenderTraceMatrix(document.getElementById('pbiTraceMatrix'), year);
  pbiRenderDiversionCharts(document.getElementById('pbiDiversionCharts'), year);
  pbiRenderIcsChart(document.getElementById('pbiIcsCharts'), year);
  pbiRenderMeadConditionChart(document.getElementById('pbiMeadCondCharts'));
}

async function pbiOpenDashboardTab() {
  const panel = document.getElementById('pbiDashboardBody');
  if (!panel) return;
  if (pbiDashboardState.loading) return;
  if (pbiDashboardState.loaded) { pbiRenderAll(); return; }
  panel.innerHTML = '<div class="pbi-empty">Loading RiverWare slots for the dashboard…</div>';
  pbiDashboardState.loading = true;
  try {
    const {payloads, missing} = await pbiFetchAllSlots();
    pbiDashboardState.payloads = payloads;
    const base = payloads.inflow || payloads.powellPE || payloads.meadPE || Object.values(payloads)[0];
    const yearSet = new Set();
    Object.values(payloads).forEach(payload => pbiYearsFromPayload(payload).forEach(year => yearSet.add(year)));
    pbiDashboardState.years = [...yearSet].sort((a,b) => a-b);
    pbiDashboardState.selectedYear = pbiDashboardState.years[0] ?? null;
    pbiDashboardState.loaded = true;
    pbiRenderAll();
    const status = document.getElementById('pbiStatus');
    if (status) {
      if (!base) status.textContent = `No expected RiverWare slots were found. Check slot names in PBI_SLOTS match your RDF files (e.g. PowellAJUnregInflow, Powell.Pool Elevation).`;
      else if (missing.length) status.textContent = `${missing.length} of ${Object.keys(PBI_SLOTS).length} slot(s) not found: ${missing.join(', ')}`;
    }
  } catch (err) {
    panel.innerHTML = `<div class="pbi-empty">${escapeHtml(err.message || 'Could not load dashboard data.')}<br><br>This does not affect Data Explorer or any other part of the app.</div>`;
  } finally {
    pbiDashboardState.loading = false;
  }
}

// Opens/closes like the existing Data Analysis section: toggles against
// dataExplorerSection, requires an active RDF session, no comparison needed.
document.getElementById('openPbiDashboardButton')?.addEventListener('click', () => {
  if (!state.rdfSessionId) { showError('Discover RDF slots first, then open the Powell/Mead Dashboard.'); return; }
  const dashboardSection = document.getElementById('pbiDashboardSection');
  dataExplorerSection.hidden = true;
  dashboardSection.hidden = false;
  dashboardSection.scrollIntoView({behavior:'smooth', block:'start'});
  pbiOpenDashboardTab();
});
document.getElementById('backToExplorerFromPbiButton')?.addEventListener('click', () => {
  document.getElementById('pbiDashboardSection').hidden = true;
  dataExplorerSection.hidden = false;
  dataExplorerSection.scrollIntoView({behavior:'smooth', block:'start'});
});


/* ============================================================
   CRMMS EXPLORER v6
   ============================================================ */

const CRMMS_V6 = {
  initialized: false,
  deterministicDefaultsAppliedForSlot: null
};


/* ------------------------------------------------------------
   Utilities
   ------------------------------------------------------------ */

function v6SafeFilename(value, fallback='crmms-chart') {
  const text = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function v6DownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function v6DataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = (parts[0].match(/data:([^;]+)/) || [,'application/octet-stream'])[1];
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type:mime});
}

function v6PlotNodes() {
  return [...document.querySelectorAll('#explorerPlotStack .explorer-plot')]
    .filter(plot => plot && plot.data && plot.layout);
}

function v6PlotTitle(plot, index) {
  const title = plot?.layout?.title?.text || '';
  const stripped = String(title).replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
  return stripped || `chart-${index+1}`;
}


/* ------------------------------------------------------------
   Organize top controls into two collapsible cards
   ------------------------------------------------------------ */

function v6CreatePanel(id, title, subtitle) {
  const details = document.createElement('details');
  details.className = 'v6-control-panel';
  details.id = id;

  const summary = document.createElement('summary');
  summary.innerHTML =
    `<span>${escapeHtml(title)}</span>` +
    `<small>${escapeHtml(subtitle)}</small>`;

  const body = document.createElement('div');
  body.className = 'v6-control-body';

  details.append(summary, body);
  return {details, body};
}



function v6OrganizeExplorerControls() {
  /*
   * Explorer v6.1:
   * Global Plot Settings is now a native <details> element
   * defined directly in index.html.
   *
   * No DOM re-parenting is required.
   */
}


/* ------------------------------------------------------------
   Deterministic traces OFF by default
   ------------------------------------------------------------ */

function v6ApplyEnsembleTraceDefault(force=false) {
  const slot = state?.explorerData?.slot || '';
  const defaults = typeof explorerAllTraceDefaults === 'function'
    ? explorerAllTraceDefaults()
    : [];

  if (!slot || !defaults.length) return;

  if (!force && CRMMS_V6.deterministicDefaultsAppliedForSlot === slot)
    return;

  const ensemble = defaults
    .filter(rec => rec.role !== 'deterministic')
    .map(rec => Number(rec.trace_number))
    .filter(Number.isFinite);

  if (ensemble.length) {
    state.explorerVisibleTraces = ensemble;
    CRMMS_V6.deterministicDefaultsAppliedForSlot = slot;

    if (typeof renderExplorerTraceControls === 'function')
      renderExplorerTraceControls(false);
  }
}


/* ------------------------------------------------------------
   Sticky multi-row Explorer table headers
   ------------------------------------------------------------ */

function v6FixExplorerStickyHeaders() {
  document.querySelectorAll('.explorer-data-table').forEach(table => {
    const rows = [...table.querySelectorAll('thead tr')];
    let top = 0;

    rows.forEach(row => {
      [...row.children].forEach(cell => {
        cell.style.setProperty('--v6-sticky-top', `${top}px`);
      });

      /*
        getBoundingClientRect is used after rendering so wrapped header labels
        are handled correctly rather than assuming a fixed row height.
      */
      top += row.getBoundingClientRect().height;
    });
  });
}

let v6StickyHeaderFrame = null;

function v6ScheduleStickyHeaderFix() {
  if (v6StickyHeaderFrame)
    cancelAnimationFrame(v6StickyHeaderFrame);

  v6StickyHeaderFrame = requestAnimationFrame(() => {
    v6StickyHeaderFrame = null;
    v6FixExplorerStickyHeaders();
  });
}


/* ------------------------------------------------------------
   Table settings
   ------------------------------------------------------------ */

function v6ConnectTableSettings() {
  const decimals = document.getElementById('v6TableDecimals');
  const rules = document.getElementById('v6ConditionalRules');

  if (decimals && explorerTableDecimals) {
    decimals.value = explorerTableDecimals.value || '2';

    decimals.addEventListener('input', () => {
      explorerTableDecimals.value = decimals.value;
      explorerTableDecimals.dispatchEvent(new Event('input', {bubbles:true}));
    });
  }

  if (rules && explorerConditionalRules) {
    rules.value = explorerConditionalRules.value || '';

    rules.addEventListener('input', () => {
      explorerConditionalRules.value = rules.value;
      explorerConditionalRules.dispatchEvent(new Event('input', {bubbles:true}));
    });
  }

  /*
    Hide the old copies. They remain in the DOM so existing v5 JavaScript
    continues to use them as the authoritative values.
  */
  explorerTableDecimals?.closest('label')?.setAttribute('hidden','');
  explorerConditionalRules?.closest('label')?.setAttribute('hidden','');
}


/* ------------------------------------------------------------
   Plot export
   ------------------------------------------------------------ */

async function v6ExportIndividual(format='png') {
  const plots = v6PlotNodes();

  if (!plots.length) {
    showError('There are no rendered Explorer charts to export.');
    return;
  }

  hideError();

  for (let i=0; i<plots.length; i++) {
    const plot = plots[i];
    const filename = v6SafeFilename(v6PlotTitle(plot,i), `chart-${i+1}`);

    const dataUrl = await Plotly.toImage(plot, {
      format,
      width: 1600,
      height: Math.max(700, plot.clientHeight * 2),
      scale: format === 'png' ? 2 : 1
    });

    v6DownloadBlob(
      v6DataUrlToBlob(dataUrl),
      `${String(i+1).padStart(2,'0')}-${filename}.${format}`
    );

    /*
      Give browsers time to start each download before triggering the next.
  */
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}


async function v6ExportCombinedPng() {
  const plots = v6PlotNodes();

  if (!plots.length) {
    showError('There are no rendered Explorer charts to export.');
    return;
  }

  hideError();

  const columnsControl = document.getElementById('explorerGridColumns');
  let columns = Number(columnsControl?.value);

  if (!Number.isFinite(columns) || columns < 1)
    columns = plots.length === 1 ? 1 : 2;

  columns = Math.min(columns, plots.length);

  const imageWidth = 1500;
  const imageHeight = 850;
  const gap = 30;
  const headerHeight = 120;

  const rows = Math.ceil(plots.length / columns);
  const canvas = document.createElement('canvas');

  canvas.width = columns * imageWidth + (columns + 1) * gap;
  canvas.height = headerHeight + rows * imageHeight + (rows + 1) * gap;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#122331';
  ctx.font = 'bold 34px Arial, sans-serif';

  const runName =
    typeof activeRunDisplayName === 'function'
      ? activeRunDisplayName('current')
      : 'CRMMS ESP';

  ctx.fillText(runName, gap, 48);

  ctx.fillStyle = '#6b7f8b';
  ctx.font = '22px Arial, sans-serif';
  ctx.fillText(
    `CRMMS Explorer chart stack · ${new Date().toLocaleString()}`,
    gap,
    84
  );

  for (let i=0; i<plots.length; i++) {
    const dataUrl = await Plotly.toImage(plots[i], {
      format:'png',
      width:imageWidth,
      height:imageHeight,
      scale:1
    });

    const img = new Image();

    await new Promise((resolve,reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    const col = i % columns;
    const row = Math.floor(i / columns);

    const x = gap + col * (imageWidth + gap);
    const y = headerHeight + gap + row * (imageHeight + gap);

    ctx.drawImage(img, x, y, imageWidth, imageHeight);
  }

  canvas.toBlob(blob => {
    if (!blob) {
      showError('Could not create the combined PNG.');
      return;
    }

    v6DownloadBlob(
      blob,
      `${v6SafeFilename(runName,'crmms-esp')}-chart-stack.png`
    );
  }, 'image/png');
}


async function v6ExportInteractiveHtml() {
  const plots = v6PlotNodes();

  if (!plots.length) {
    showError('There are no rendered Explorer charts to export.');
    return;
  }

  hideError();

  let plotlySource = '';

  try {
    const response = await fetch('/static/plotly.min.js');
    if (!response.ok) throw new Error('Plotly library could not be read.');
    plotlySource = await response.text();
  } catch (error) {
    showError(`Could not build standalone HTML: ${error.message}`);
    return;
  }

  const specs = plots.map((plot,index) => ({
    id:`plot-${index}`,
    data:plot.data,
    layout:{
      ...plot.layout,
      width:undefined,
      height:undefined,
      autosize:true
    },
    config:{
      responsive:true,
      displaylogo:false,
      scrollZoom:true
    }
  }));

  const runName =
    typeof activeRunDisplayName === 'function'
      ? activeRunDisplayName('current')
      : 'CRMMS ESP';

  const html =
`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${String(runName).replace(/[<>]/g,'')}</title>
<style>
body{margin:0;padding:24px;font-family:Arial,sans-serif;background:#f5f8f9;color:#122331}
h1{margin:0 0 6px;font-size:26px}
.meta{color:#6b7f8b;margin-bottom:22px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.card{background:#fff;border:1px solid #dbe5e9;border-radius:12px;padding:8px}
.plot{width:100%;height:560px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>${String(runName).replace(/[<>]/g,'')}</h1>
<div class="meta">CRMMS Explorer interactive chart stack</div>
<div class="grid">
${specs.map(spec => `<div class="card"><div class="plot" id="${spec.id}"></div></div>`).join('\n')}
</div>
<script>${plotlySource}<\/script>
<script>
const specs=${JSON.stringify(specs)};
specs.forEach(s=>Plotly.newPlot(s.id,s.data,s.layout,s.config));
<\/script>
</body>
</html>`;

  v6DownloadBlob(
    new Blob([html], {type:'text/html;charset=utf-8'}),
    `${v6SafeFilename(runName,'crmms-esp')}-interactive-charts.html`
  );
}


async function v6PrintCharts() {
  const plots = v6PlotNodes();

  if (!plots.length) {
    showError('There are no rendered Explorer charts to export.');
    return;
  }

  hideError();

  const runName =
    typeof activeRunDisplayName === 'function'
      ? activeRunDisplayName('current')
      : 'CRMMS ESP';

  const images = [];

  for (const plot of plots) {
    images.push(await Plotly.toImage(plot, {
      format:'png',
      width:1500,
      height:850,
      scale:1
    }));
  }

  const win = window.open('', '_blank');

  if (!win) {
    showError('The browser blocked the print window. Allow pop-ups for this local app and try again.');
    return;
  }

  win.document.write(
`<!doctype html>
<html>
<head>
<title>${String(runName).replace(/[<>]/g,'')}</title>
<style>
@page{size:landscape;margin:.35in}
body{font-family:Arial,sans-serif;color:#122331;margin:0}
h1{font-size:22px;margin:0 0 4px}
.meta{font-size:11px;color:#667b86;margin-bottom:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{break-inside:avoid;border:1px solid #dbe5e9;padding:4px}
img{display:block;width:100%;height:auto}
@media print{.no-print{display:none}}
</style>
</head>
<body>
<h1>${String(runName).replace(/[<>]/g,'')}</h1>
<div class="meta">CRMMS Explorer chart stack · ${new Date().toLocaleString()}</div>
<div class="grid">
${images.map(src => `<div class="card"><img src="${src}"></div>`).join('')}
</div>
<script>
window.onload=()=>setTimeout(()=>window.print(),400);
<\/script>
</body>
</html>`);

  win.document.close();
}


/* ------------------------------------------------------------
   Export menu
   ------------------------------------------------------------ */

function v6InstallExportMenu() {
  let button = document.getElementById('exportExplorerChartsButton');
  let menu = document.getElementById('explorerExportMenu');

  /*
    Fallback for builds where the HTML insertion anchor changed.
  */
  if (!button) {
    const actions = document.querySelector(
      '#dataExplorerSection .explorer-header-actions'
    );

    if (!actions) return;

    const wrap = document.createElement('div');
    wrap.className = 'explorer-export-wrap';

    wrap.innerHTML =
      `<button class="secondary-button" id="exportExplorerChartsButton" type="button">Export charts ▾</button>
       <div class="explorer-export-menu" id="explorerExportMenu" hidden>
         <button type="button" data-export-stack="png">Combined PNG</button>
         <button type="button" data-export-stack="pdf">Print / PDF</button>
         <button type="button" data-export-stack="html">Interactive HTML</button>
         <button type="button" data-export-stack="individual-png">Individual PNG files</button>
         <button type="button" data-export-stack="individual-svg">Individual SVG files</button>
       </div>`;

    actions.prepend(wrap);

    button = document.getElementById('exportExplorerChartsButton');
    menu = document.getElementById('explorerExportMenu');
  }

  if (!button || !menu || button.dataset.v6Ready === '1') return;

  button.dataset.v6Ready = '1';

  button.addEventListener('click', event => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.explorer-export-wrap'))
      menu.hidden = true;
  });

  menu.querySelectorAll('[data-export-stack]').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.exportStack;
      menu.hidden = true;

      try {
        if (action === 'png')
          await v6ExportCombinedPng();

        else if (action === 'pdf')
          await v6PrintCharts();

        else if (action === 'html')
          await v6ExportInteractiveHtml();

        else if (action === 'individual-png')
          await v6ExportIndividual('png');

        else if (action === 'individual-svg')
          await v6ExportIndividual('svg');
      }
      catch (error) {
        console.error(error);
        showError(error?.message || 'Chart export failed.');
      }
    });
  });
}


/* ------------------------------------------------------------
   Observe Explorer rendering
   ------------------------------------------------------------ */

function v6InstallExplorerObserver() {
  const section = document.getElementById('dataExplorerSection');
  if (!section) return;

  const observer = new MutationObserver(() => {
    v6ScheduleStickyHeaderFix();

    /*
      When a new slot is loaded, apply the ensemble-only default once.
    */
    const slot = state?.explorerData?.slot || '';

    if (
      slot &&
      CRMMS_V6.deterministicDefaultsAppliedForSlot !== slot &&
      typeof explorerAllTraceDefaults === 'function' &&
      explorerAllTraceDefaults().length
    ) {
      v6ApplyEnsembleTraceDefault(false);

      if (typeof renderExplorerPlot === 'function')
        renderExplorerPlot();

      if (typeof renderExplorerTable === 'function')
        renderExplorerTable();
    }
  });

  observer.observe(section, {
    childList:true,
    subtree:true
  });

  window.addEventListener('resize', v6ScheduleStickyHeaderFix);
}


/* ------------------------------------------------------------
   Initialize v6
   ------------------------------------------------------------ */

function initializeCRMMSExplorerV6() {
  if (CRMMS_V6.initialized) return;
  CRMMS_V6.initialized = true;

  v6OrganizeExplorerControls();
  v6ConnectTableSettings();
  v6InstallExportMenu();
  v6InstallExplorerObserver();
  v6ScheduleStickyHeaderFix();

  console.info('CRMMS Explorer v6 enhancements initialized.');
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initializeCRMMSExplorerV6);
else
  initializeCRMMSExplorerV6();

/* === CRMMS EXPLORER GLOBAL SETTINGS STATE START === */

function initializeExplorerGlobalSettingsState() {
  const panel =
    document.getElementById('explorerGlobalSettings');

  if (!panel) return;

  const key =
    'crmmsExplorerGlobalSettingsOpen';

  /*
   * Default CLOSED.
   */
  panel.open =
    sessionStorage.getItem(key) === 'true';

  panel.addEventListener('toggle', () => {
    sessionStorage.setItem(
      key,
      String(panel.open)
    );

    /*
     * Resize Plotly charts after the page geometry changes.
     */
    requestAnimationFrame(() => {
      document
        .querySelectorAll(
          '#explorerPlotStack .explorer-plot'
        )
        .forEach(plot => {
          try {
            if (
              typeof Plotly !== 'undefined' &&
              plot.classList.contains('js-plotly-plot')
            ) {
              Plotly.Plots.resize(plot);
            }
          }
          catch (_) {}
        });
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    initializeExplorerGlobalSettingsState
  );
}
else {
  initializeExplorerGlobalSettingsState();
}

/* === CRMMS EXPLORER GLOBAL SETTINGS STATE END === */

/* === CRMMS EXPLORER 6.2 CLEANUP START === */


/* ============================================================
   Compact trace chooser
   ============================================================ */

function v62CompactTraceChooser() {
  const details = document.querySelector(
    '#dataExplorerSection details.explorer-traces'
  );

  if (!details) return;

  /*
   * First visit defaults to closed.
   * Afterwards remember the user's preference.
   */
  const key = 'crmmsExplorerTraceChooserOpen';
  const saved = sessionStorage.getItem(key);

  details.open = saved === 'true';

  if (details.dataset.v62Ready !== '1') {
    details.dataset.v62Ready = '1';

    details.addEventListener('toggle', () => {
      sessionStorage.setItem(
        key,
        String(details.open)
      );
    });
  }
}


/* ============================================================
   Presentation-only plot cards for export
   ============================================================ */

function v62SafeFilename(value, fallback='crmms-chart') {
  const safe = String(value || fallback)
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return safe || fallback;
}


function v62RunName() {
  try {
    if (typeof activeRunDisplayName === 'function') {
      return activeRunDisplayName('current') || 'CRMMS ESP';
    }
  }
  catch (_) {}

  return (
    document.getElementById('rdfSourceName')?.textContent?.trim()
    || 'CRMMS ESP'
  );
}


function v62RenderedPlots() {
  return [
    ...document.querySelectorAll(
      '#explorerPlotStack .explorer-plot'
    )
  ].filter(
    plot =>
      plot &&
      plot.data &&
      plot.layout
  );
}


function v62PlainText(value) {
  const temp = document.createElement('div');
  temp.innerHTML = String(value || '');
  return temp.textContent.trim();
}


function v62PlotExportInfo(plot, index) {
  const card = plot.closest('.explorer-plot-card');

  /*
   * Prefer per-card fields if present.
   */
  let title =
    card?.querySelector(
      '[data-item-setting="title"]'
    )?.value?.trim();

  let subtitle =
    card?.querySelector(
      '[data-item-setting="subtitle"]'
    )?.value?.trim();


  if (!title) {
    title = v62PlainText(
      plot.layout?.title?.text
    );
  }


  if (!title) {
    title =
      card?.dataset?.slot
      || `Chart ${index + 1}`;
  }


  return {
    title,
    subtitle: subtitle || '',
    card
  };
}


/* ============================================================
   Draw a Plotly image inside a card-style canvas
   ============================================================ */

async function v62CardCanvas(
  plot,
  index,
  options={}
) {
  const info =
    v62PlotExportInfo(
      plot,
      index
    );

  const cardWidth =
    Number(options.width) || 1500;

  const plotHeight =
    Number(options.plotHeight) || 800;

  const padding = 36;

  const titleHeight =
    info.subtitle
      ? 105
      : 76;

  const cardHeight =
    padding +
    titleHeight +
    plotHeight +
    padding;


  /*
   * Plot image itself intentionally excludes the interactive
   * HTML settings above the plot.
   */

  const plotDataUrl =
    await Plotly.toImage(
      plot,
      {
        format: 'png',
        width:
          cardWidth -
          (padding * 2),

        height:
          plotHeight,

        scale: 1
      }
    );


  const image =
    new Image();


  await new Promise(
    (resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = plotDataUrl;
    }
  );


  const canvas =
    document.createElement('canvas');

  canvas.width =
    cardWidth;

  canvas.height =
    cardHeight;


  const ctx =
    canvas.getContext('2d');


  /*
   * Page around the card is transparent.
   */
  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  /*
   * Card shadow.
   */
  ctx.save();

  ctx.shadowColor =
    'rgba(25, 55, 70, 0.12)';

  ctx.shadowBlur =
    18;

  ctx.shadowOffsetY =
    5;

  ctx.fillStyle =
    '#ffffff';

  v62RoundedRect(
    ctx,
    8,
    8,
    cardWidth - 16,
    cardHeight - 16,
    18
  );

  ctx.fill();

  ctx.restore();


  /*
   * Card border.
   */
  ctx.strokeStyle =
    '#dbe5e9';

  ctx.lineWidth =
    2;

  v62RoundedRect(
    ctx,
    8,
    8,
    cardWidth - 16,
    cardHeight - 16,
    18
  );

  ctx.stroke();


  /*
   * Title.
   */
  ctx.fillStyle =
    '#17303d';

  ctx.font =
    '700 29px "Segoe UI", Arial, sans-serif';

  ctx.fillText(
    info.title,
    padding,
    52
  );


  /*
   * Subtitle.
   */
  if (info.subtitle) {
    ctx.fillStyle =
      '#70838d';

    ctx.font =
      '400 19px "Segoe UI", Arial, sans-serif';

    ctx.fillText(
      info.subtitle,
      padding,
      82
    );
  }


  /*
   * Plot image.
   */
  ctx.drawImage(
    image,
    padding,
    padding + titleHeight,
    cardWidth - (padding * 2),
    plotHeight
  );


  return {
    canvas,
    title:
      info.title
  };
}


function v62RoundedRect(
  ctx,
  x,
  y,
  width,
  height,
  radius
) {
  const r =
    Math.min(
      radius,
      width / 2,
      height / 2
    );

  ctx.beginPath();

  ctx.moveTo(
    x + r,
    y
  );

  ctx.arcTo(
    x + width,
    y,
    x + width,
    y + height,
    r
  );

  ctx.arcTo(
    x + width,
    y + height,
    x,
    y + height,
    r
  );

  ctx.arcTo(
    x,
    y + height,
    x,
    y,
    r
  );

  ctx.arcTo(
    x,
    y,
    x + width,
    y,
    r
  );

  ctx.closePath();
}


function v62DownloadCanvas(
  canvas,
  filename
) {
  canvas.toBlob(
    blob => {
      if (!blob) return;

      const url =
        URL.createObjectURL(blob);

      const a =
        document.createElement('a');

      a.href =
        url;

      a.download =
        filename;

      document.body.appendChild(a);

      a.click();

      a.remove();

      setTimeout(
        () =>
          URL.revokeObjectURL(url),
        2000
      );
    },
    'image/png'
  );
}


/* ============================================================
   Individual card PNG exports
   ============================================================ */

async function v62ExportIndividualCardPng() {
  const plots =
    v62RenderedPlots();

  if (!plots.length) {
    showError(
      'There are no rendered Explorer charts to export.'
    );
    return;
  }

  hideError();

  for (
    let i = 0;
    i < plots.length;
    i++
  ) {
    const result =
      await v62CardCanvas(
        plots[i],
        i
      );

    v62DownloadCanvas(
      result.canvas,
      `${String(i + 1).padStart(2, '0')}-${v62SafeFilename(result.title)}.png`
    );

    await new Promise(
      resolve =>
        setTimeout(resolve, 250)
    );
  }
}


/* ============================================================
   Combined card-style PNG
   ============================================================ */

async function v62ExportCombinedCardPng() {
  const plots =
    v62RenderedPlots();

  if (!plots.length) {
    showError(
      'There are no rendered Explorer charts to export.'
    );
    return;
  }

  hideError();


  let columns =
    Number(
      document.getElementById(
        'explorerGridColumns'
      )?.value
    );


  if (
    !Number.isFinite(columns) ||
    columns < 1
  ) {
    columns =
      plots.length === 1
        ? 1
        : 2;
  }


  columns =
    Math.min(
      columns,
      plots.length
    );


  const cards = [];

  for (
    let i = 0;
    i < plots.length;
    i++
  ) {
    cards.push(
      await v62CardCanvas(
        plots[i],
        i,
        {
          width: 1250,
          plotHeight: 680
        }
      )
    );
  }


  const gap = 28;

  const pagePadding = 42;

  const headingHeight = 105;

  const cardWidth =
    cards[0].canvas.width;

  const cardHeight =
    cards[0].canvas.height;

  const rows =
    Math.ceil(
      cards.length /
      columns
    );


  const canvas =
    document.createElement(
      'canvas'
    );


  canvas.width =
    pagePadding * 2 +
    columns * cardWidth +
    (columns - 1) * gap;


  canvas.height =
    pagePadding * 2 +
    headingHeight +
    rows * cardHeight +
    (rows - 1) * gap;


  const ctx =
    canvas.getContext('2d');


  ctx.fillStyle =
    '#f4f7f8';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  /*
   * Run heading.
   */
  ctx.fillStyle =
    '#17303d';

  ctx.font =
    '700 34px "Segoe UI", Arial, sans-serif';

  ctx.fillText(
    v62RunName(),
    pagePadding,
    54
  );


  ctx.fillStyle =
    '#70838d';

  ctx.font =
    '400 18px "Segoe UI", Arial, sans-serif';

  ctx.fillText(
    'CRMMS Explorer chart stack',
    pagePadding,
    82
  );


  cards.forEach(
    (result, i) => {

      const col =
        i % columns;

      const row =
        Math.floor(
          i / columns
        );


      const x =
        pagePadding +
        col *
        (
          cardWidth +
          gap
        );


      const y =
        pagePadding +
        headingHeight +
        row *
        (
          cardHeight +
          gap
        );


      ctx.drawImage(
        result.canvas,
        x,
        y
      );

    }
  );


  v62DownloadCanvas(
    canvas,
    `${v62SafeFilename(v62RunName())}-chart-stack.png`
  );
}


/* ============================================================
   Card-style Print / PDF
   ============================================================ */

async function v62PrintCardStack() {
  const plots =
    v62RenderedPlots();

  if (!plots.length) {
    showError(
      'There are no rendered Explorer charts to export.'
    );
    return;
  }


  const cards = [];

  for (
    let i = 0;
    i < plots.length;
    i++
  ) {
    const result =
      await v62CardCanvas(
        plots[i],
        i,
        {
          width: 1300,
          plotHeight: 700
        }
      );

    cards.push(
      result.canvas.toDataURL(
        'image/png'
      )
    );
  }


  const win =
    window.open(
      '',
      '_blank'
    );


  if (!win) {
    showError(
      'The browser blocked the print window. Allow pop-ups and try again.'
    );
    return;
  }


  const safeRun =
    String(v62RunName())
      .replace(/[<>]/g, '');


  win.document.write(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${safeRun}</title>

<style>

@page {
  size: landscape;
  margin: .35in;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 18px;

  background: #f4f7f8;

  color: #17303d;

  font-family:
    "Segoe UI",
    Arial,
    sans-serif;
}

.export-header {
  margin-bottom: 16px;
}

.export-header h1 {
  margin: 0 0 3px;

  font-size: 24px;
}

.export-header p {
  margin: 0;

  color: #70838d;

  font-size: 12px;
}

.export-grid {
  display: grid;

  grid-template-columns:
    repeat(2, minmax(0, 1fr));

  gap: 12px;
}

.export-card {
  break-inside: avoid;

  page-break-inside: avoid;
}

.export-card img {
  display: block;

  width: 100%;

  height: auto;
}

@media print {

  body {
    background: #ffffff;

    padding: 0;
  }

}

</style>
</head>

<body>

<div class="export-header">
  <h1>${safeRun}</h1>
  <p>CRMMS Explorer chart stack</p>
</div>

<div class="export-grid">

${cards.map(
  src =>
    `<div class="export-card"><img src="${src}"></div>`
).join('\n')}

</div>

<script>
window.onload = () => {
  setTimeout(
    () => window.print(),
    400
  );
};
<\/script>

</body>
</html>
  `);

  win.document.close();
}


/* ============================================================
   Replace v6 export actions with card-style versions
   ============================================================ */

function v62UpgradeExportMenu() {
  const menu =
    document.getElementById(
      'explorerExportMenu'
    );

  if (!menu) return;


  const combined =
    menu.querySelector(
      '[data-export-stack="png"]'
    );

  const pdf =
    menu.querySelector(
      '[data-export-stack="pdf"]'
    );

  const individual =
    menu.querySelector(
      '[data-export-stack="individual-png"]'
    );


  /*
   * Capture phase allows v6.2 to handle these before the older
   * v6 listeners execute.
   */

  if (
    combined &&
    combined.dataset.v62Ready !== '1'
  ) {
    combined.dataset.v62Ready = '1';

    combined.textContent =
      'Combined PNG · card layout';

    combined.addEventListener(
      'click',
      event => {
        event.stopImmediatePropagation();

        menu.hidden = true;

        v62ExportCombinedCardPng()
          .catch(error => {
            console.error(error);

            showError(
              error?.message ||
              'Chart export failed.'
            );
          });
      },
      true
    );
  }


  if (
    pdf &&
    pdf.dataset.v62Ready !== '1'
  ) {
    pdf.dataset.v62Ready = '1';

    pdf.textContent =
      'Print / PDF · card layout';

    pdf.addEventListener(
      'click',
      event => {
        event.stopImmediatePropagation();

        menu.hidden = true;

        v62PrintCardStack()
          .catch(error => {
            console.error(error);

            showError(
              error?.message ||
              'PDF export failed.'
            );
          });
      },
      true
    );
  }


  if (
    individual &&
    individual.dataset.v62Ready !== '1'
  ) {
    individual.dataset.v62Ready = '1';

    individual.textContent =
      'Individual PNG · card layout';

    individual.addEventListener(
      'click',
      event => {
        event.stopImmediatePropagation();

        menu.hidden = true;

        v62ExportIndividualCardPng()
          .catch(error => {
            console.error(error);

            showError(
              error?.message ||
              'Chart export failed.'
            );
          });
      },
      true
    );
  }
}


/* ============================================================
   Initialize
   ============================================================ */

function initializeCRMMSExplorer62() {
  v62CompactTraceChooser();
  v62UpgradeExportMenu();
}


if (
  document.readyState ===
  'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    initializeCRMMSExplorer62
  );
}
else {
  initializeCRMMSExplorer62();
}


/* === CRMMS EXPLORER 6.2 CLEANUP END === */

/* === CRMMS EXPLORER 6.3 PLOT SETTINGS START === */


/* ============================================================
   Per-plot settings open state
   ============================================================ */

/*
 * Plot cards are rebuilt whenever a setting changes.
 *
 * Therefore the <details open> state cannot live only in the
 * DOM. Store it by stack item ID.
 */

const v63PlotSettingsOpen =
  new Map();


function v63RememberPlotSettingsState() {

  document
    .querySelectorAll(
      '#explorerPlotStack .explorer-plot-card'
    )
    .forEach(card => {

      const id =
        card.dataset.stackId;

      if (!id) return;


      /*
       * Find the details element containing the actual
       * per-chart settings controls.
       */

      const details =
        [...card.querySelectorAll('details')]
          .find(element =>
            element.querySelector(
              '[data-item-setting]'
            )
          );


      if (!details) return;


      v63PlotSettingsOpen.set(
        id,
        details.open
      );

    });

}


function v63RestorePlotSettingsState() {

  document
    .querySelectorAll(
      '#explorerPlotStack .explorer-plot-card'
    )
    .forEach(card => {

      const id =
        card.dataset.stackId;

      if (!id) return;


      const details =
        [...card.querySelectorAll('details')]
          .find(element =>
            element.querySelector(
              '[data-item-setting]'
            )
          );


      if (!details) return;


      if (
        v63PlotSettingsOpen.has(id)
      ) {

        details.open =
          v63PlotSettingsOpen.get(id);

      }


      /*
       * Only a user toggle changes the stored state.
       */

      if (
        details.dataset.v63ToggleReady !==
        '1'
      ) {

        details.dataset.v63ToggleReady =
          '1';


        details.addEventListener(
          'toggle',
          () => {

            v63PlotSettingsOpen.set(
              id,
              details.open
            );

          }
        );

      }

    });

}


/*
 * Capture settings state immediately before Explorer
 * re-renders the plot cards.
 */

if (
  typeof renderExplorerPlot ===
  'function'
) {

  const v63OriginalRenderExplorerPlot =
    renderExplorerPlot;


  renderExplorerPlot =
    function(...args) {

      v63RememberPlotSettingsState();


      const result =
        v63OriginalRenderExplorerPlot
          .apply(
            this,
            args
          );


      /*
       * renderExplorerPlot currently builds the cards
       * synchronously. requestAnimationFrame also protects
       * against future rendering changes.
       */

      v63RestorePlotSettingsState();


      requestAnimationFrame(
        v63RestorePlotSettingsState
      );


      return result;

    };

}


/* ============================================================
   X-axis range configuration
   ============================================================ */

/*
 * Modes:
 *
 * full      = all available data
 * months12  = first 12 months
 * months24  = first 24 months
 * months36  = first 36 months
 * custom    = user-selected start/end months
 *
 * Existing plots default to FULL so old presets do not change.
 *
 * New plots created after v6.3 default to 24 months.
 */


function v63NormalizeXRangeMode(
  value
) {

  const allowed =
    new Set([
      'full',
      'months12',
      'months24',
      'months36',
      'custom'
    ]);


  return allowed.has(
    String(value || '')
  )
    ? String(value)
    : 'full';

}


function v63MonthStart(
  value
) {

  const text =
    String(value || '').trim();


  if (
    !/^\d{4}-\d{2}$/.test(text)
  ) {
    return null;
  }


  return (
    `${text}-01`
  );

}


function v63AddMonths(
  dateText,
  numberOfMonths
) {

  const date =
    new Date(
      `${dateText}T00:00:00`
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }


  date.setUTCMonth(
    date.getUTCMonth() +
    numberOfMonths
  );


  return date
    .toISOString()
    .slice(
      0,
      10
    );

}


function v63AvailableDateExtent(
  data
) {

  const values = [];


  for (
    const runKey of
    ['current', 'previous']
  ) {

    const run =
      data?.[runKey];

    if (!run) continue;


    for (
      const trace of
      (run.traces || [])
    ) {

      for (
        const point of
        (trace.points || [])
      ) {

        const candidate =
          point.date ??
          point.period ??
          point.datetime ??
          point.x ??
          point.label;


        if (
          candidate == null
        ) {
          continue;
        }


        const parsed =
          new Date(candidate);


        if (
          !Number.isNaN(
            parsed.getTime()
          )
        ) {

          values.push(
            parsed
          );

        }

      }

    }

  }


  if (!values.length) {
    return null;
  }


  values.sort(
    (a, b) =>
      a - b
  );


  return {
    start:
      values[0],

    end:
      values[
        values.length - 1
      ]
  };

}


/*
 * The Explorer data model can use formatted point labels.
 * Plotly already has the actual X values after traces have
 * been constructed, so this helper can also inspect traces.
 */

function v63PlotDateExtent(
  plotTraces
) {

  const dates = [];


  for (
    const trace of
    (plotTraces || [])
  ) {

    for (
      const value of
      (trace.x || [])
    ) {

      const date =
        new Date(value);


      if (
        !Number.isNaN(
          date.getTime()
        )
      ) {

        dates.push(
          date
        );

      }

    }

  }


  if (!dates.length) {
    return null;
  }


  dates.sort(
    (a, b) =>
      a - b
  );


  return {
    start:
      dates[0],

    end:
      dates[
        dates.length - 1
      ]
  };

}


function v63ConfiguredXRange(
  item,
  plotTraces
) {

  const mode =
    v63NormalizeXRangeMode(
      item?.x_range_mode
    );


  if (
    mode === 'full'
  ) {
    return null;
  }


  const extent =
    v63PlotDateExtent(
      plotTraces
    );


  if (!extent) {
    return null;
  }


  if (
    mode === 'months12' ||
    mode === 'months24' ||
    mode === 'months36'
  ) {

    const months =
      mode === 'months12'
        ? 12
        : mode === 'months36'
          ? 36
          : 24;


    const start =
      extent.start
        .toISOString()
        .slice(
          0,
          10
        );


    /*
     * Plotly range is inclusive enough for this purpose.
     * Subtract one day from the N-month boundary.
     */

    const boundary =
      new Date(
        `${v63AddMonths(
          start,
          months
        )}T00:00:00`
      );


    boundary.setUTCDate(
      boundary.getUTCDate() -
      1
    );


    const end =
      boundary
        .toISOString()
        .slice(
          0,
          10
        );


    return [
      start,
      end
    ];

  }


  if (
    mode === 'custom'
  ) {

    let start =
      v63MonthStart(
        item?.x_range_start
      );


    let end = null;


    const endMonth =
      String(
        item?.x_range_end ||
        ''
      ).trim();


    if (
      /^\d{4}-\d{2}$/.test(
        endMonth
      )
    ) {

      /*
       * End at the final day of the selected month.
       */

      const nextMonth =
        v63AddMonths(
          `${endMonth}-01`,
          1
        );


      if (nextMonth) {

        const endDate =
          new Date(
            `${nextMonth}T00:00:00`
          );


        endDate.setUTCDate(
          endDate.getUTCDate() -
          1
        );


        end =
          endDate
            .toISOString()
            .slice(
              0,
              10
            );

      }

    }


    if (!start) {

      start =
        extent.start
          .toISOString()
          .slice(
            0,
            10
          );

    }


    if (!end) {

      end =
        extent.end
          .toISOString()
          .slice(
            0,
            10
          );

    }


    if (
      new Date(start) >
      new Date(end)
    ) {

      return [
        end,
        start
      ];

    }


    return [
      start,
      end
    ];

  }


  return null;

}


/* ============================================================
   Add X-range properties to normalized stack items
   ============================================================ */

if (
  typeof normalizeExplorerStackItem ===
  'function'
) {

  const v63OriginalNormalizeExplorerStackItem =
    normalizeExplorerStackItem;


  normalizeExplorerStackItem =
    function(item={}) {

      const result =
        v63OriginalNormalizeExplorerStackItem(
          item
        );


      if (!result) {
        return result;
      }


      result.x_range_mode =
        v63NormalizeXRangeMode(
          item?.x_range_mode
        );


      result.x_range_start =
        String(
          item?.x_range_start ||
          ''
        );


      result.x_range_end =
        String(
          item?.x_range_end ||
          ''
        );


      return result;

    };

}


/* ============================================================
   New plots default to first 24 months
   ============================================================ */

if (
  typeof createExplorerStackItem ===
  'function'
) {

  const v63OriginalCreateExplorerStackItem =
    createExplorerStackItem;


  createExplorerStackItem =
    function(
      slot,
      overrides={}
    ) {

      const effectiveOverrides =
        {
          ...overrides
        };


      /*
       * Only NEW plot definitions get the 24-month default.
       * A preset explicitly containing x_range_mode keeps it.
       */

      if (
        effectiveOverrides.x_range_mode ==
        null
      ) {

        effectiveOverrides.x_range_mode =
          'months24';

      }


      return (
        v63OriginalCreateExplorerStackItem(
          slot,
          effectiveOverrides
        )
      );

    };

}


/* ============================================================
   Add X-axis controls to every plot settings panel
   ============================================================ */

function v63InstallXRangeControls() {

  document
    .querySelectorAll(
      '#explorerPlotStack .explorer-plot-card'
    )
    .forEach(card => {

      const id =
        card.dataset.stackId;


      if (!id) return;


      const item =
        typeof explorerStackItemById ===
        'function'
          ? explorerStackItemById(id)
          : null;


      if (!item) return;


      const details =
        [...card.querySelectorAll('details')]
          .find(element =>
            element.querySelector(
              '[data-item-setting]'
            )
          );


      if (!details) return;


      if (
        details.querySelector(
          '.v63-x-range-settings'
        )
      ) {
        return;
      }


      const container =
        document.createElement(
          'div'
        );


      container.className =
        'v63-x-range-settings';


      const mode =
        v63NormalizeXRangeMode(
          item.x_range_mode
        );


      container.innerHTML = `

        <label>
          X-axis date range

          <select
            data-v63-x-range-mode="${escapeHtml(id)}"
          >
            <option
              value="full"
              ${mode === 'full' ? 'selected' : ''}
            >
              Full available range
            </option>

            <option
              value="months12"
              ${mode === 'months12' ? 'selected' : ''}
            >
              First 12 months
            </option>

            <option
              value="months24"
              ${mode === 'months24' ? 'selected' : ''}
            >
              First 24 months
            </option>

            <option
              value="months36"
              ${mode === 'months36' ? 'selected' : ''}
            >
              First 36 months
            </option>

            <option
              value="custom"
              ${mode === 'custom' ? 'selected' : ''}
            >
              Custom range
            </option>

          </select>
        </label>


        <div
          class="v63-custom-x-range"
          data-v63-custom-x-range="${escapeHtml(id)}"
          ${mode === 'custom' ? '' : 'hidden'}
        >

          <label>
            Start month

            <input
              type="month"
              value="${escapeHtml(item.x_range_start || '')}"
              data-v63-x-range-start="${escapeHtml(id)}"
            />
          </label>


          <label>
            End month

            <input
              type="month"
              value="${escapeHtml(item.x_range_end || '')}"
              data-v63-x-range-end="${escapeHtml(id)}"
            />
          </label>

        </div>


        <small class="field-help">
          Sets the initial visible date range for this chart.
          Custom start or end may be left blank.
        </small>

      `;


      /*
       * Put the date range near the other axis settings.
       */

      const settingGrid =
        details.querySelector(
          '.explorer-card-settings-grid, .explorer-advanced-grid'
        );


      if (settingGrid) {

        settingGrid.appendChild(
          container
        );

      }
      else {

        details.appendChild(
          container
        );

      }


      const modeSelect =
        container.querySelector(
          '[data-v63-x-range-mode]'
        );


      const custom =
        container.querySelector(
          '[data-v63-custom-x-range]'
        );


      const startInput =
        container.querySelector(
          '[data-v63-x-range-start]'
        );


      const endInput =
        container.querySelector(
          '[data-v63-x-range-end]'
        );


      modeSelect?.addEventListener(
        'change',
        () => {

          /*
           * Remember that the user currently has settings open.
           */

          v63PlotSettingsOpen.set(
            id,
            true
          );


          item.x_range_mode =
            v63NormalizeXRangeMode(
              modeSelect.value
            );


          if (custom) {

            custom.hidden =
              item.x_range_mode !==
              'custom';

          }


          /*
           * A configured X range replaces a manual shared zoom.
           */

          if (
            state?.explorerViewport
          ) {

            state.explorerViewport.x =
              null;

          }


          syncLegacyExplorerStackState();

          renderExplorerPlot();

          renderExplorerTable();

        }
      );


      startInput?.addEventListener(
        'change',
        () => {

          v63PlotSettingsOpen.set(
            id,
            true
          );


          item.x_range_start =
            startInput.value;


          item.x_range_mode =
            'custom';


          if (
            state?.explorerViewport
          ) {

            state.explorerViewport.x =
              null;

          }


          syncLegacyExplorerStackState();

          renderExplorerPlot();

          renderExplorerTable();

        }
      );


      endInput?.addEventListener(
        'change',
        () => {

          v63PlotSettingsOpen.set(
            id,
            true
          );


          item.x_range_end =
            endInput.value;


          item.x_range_mode =
            'custom';


          if (
            state?.explorerViewport
          ) {

            state.explorerViewport.x =
              null;

          }


          syncLegacyExplorerStackState();

          renderExplorerPlot();

          renderExplorerTable();

        }
      );

    });

}


/* ============================================================
   Apply configured X ranges after each plot render
   ============================================================ */

if (
  typeof renderOneExplorerPlot ===
  'function'
) {

  const v63OriginalRenderOneExplorerPlot =
    renderOneExplorerPlot;


  renderOneExplorerPlot =
    function(
      plot,
      data,
      slot,
      index,
      stackCount,
      item={}
    ) {

      /*
       * Let existing Explorer rendering construct the traces
       * and Plotly layout first.
       */

      const result =
        v63OriginalRenderOneExplorerPlot
          .apply(
            this,
            arguments
          );


      requestAnimationFrame(
        () => {

          if (
            !plot ||
            typeof Plotly ===
            'undefined'
          ) {
            return;
          }


          const actualItem =
            typeof explorerStackItemById ===
            'function'
              ? (
                  explorerStackItemById(
                    item?.id
                  ) ||
                  item
                )
              : item;


          /*
           * Date ranges apply to time-series plots.
           *
           * Bar charts use categorical X values.
           */

          if (
            actualItem?.plot_type ===
            'bar'
          ) {
            return;
          }


          const range =
            v63ConfiguredXRange(
              actualItem,
              plot.data
            );


          if (range) {

            Plotly.relayout(
              plot,
              {
                'xaxis.autorange':
                  false,

                'xaxis.range':
                  range
              }
            );

          }
          else if (
            v63NormalizeXRangeMode(
              actualItem?.x_range_mode
            ) === 'full'
          ) {

            /*
             * Full range only resets X when there isn't a
             * manually preserved viewport.
             */

            if (
              !state?.explorerViewport?.x
            ) {

              Plotly.relayout(
                plot,
                {
                  'xaxis.autorange':
                    true
                }
              );

            }

          }

        }
      );


      return result;

    };

}


/* ============================================================
   Keep plot settings open when normal controls cause rerender
   ============================================================ */

/*
 * Existing [data-item-setting] listeners execute before this
 * listener in many cases. Capture phase runs first, allowing
 * us to remember the state before renderExplorerPlot rebuilds
 * the card.
 */

document.addEventListener(
  'change',
  event => {

    const control =
      event.target.closest(
        '#explorerPlotStack [data-item-setting]'
      );


    if (!control) return;


    const card =
      control.closest(
        '.explorer-plot-card'
      );


    const id =
      card?.dataset?.stackId;


    if (!id) return;


    const details =
      control.closest(
        'details'
      );


    if (details) {

      v63PlotSettingsOpen.set(
        id,
        details.open
      );

    }

  },
  true
);


/*
 * Same protection for text fields while the user is editing.
 */

document.addEventListener(
  'input',
  event => {

    const control =
      event.target.closest(
        '#explorerPlotStack [data-item-setting]'
      );


    if (!control) return;


    const card =
      control.closest(
        '.explorer-plot-card'
      );


    const id =
      card?.dataset?.stackId;


    if (!id) return;


    const details =
      control.closest(
        'details'
      );


    if (details) {

      v63PlotSettingsOpen.set(
        id,
        details.open
      );

    }

  },
  true
);


/* ============================================================
   Observe plot-stack rebuilding
   ============================================================ */

const v63PlotStack =
  document.getElementById(
    'explorerPlotStack'
  );


if (v63PlotStack) {

  const v63Observer =
    new MutationObserver(
      () => {

        v63RestorePlotSettingsState();

        v63InstallXRangeControls();

      }
    );


  v63Observer.observe(
    v63PlotStack,
    {
      childList: true,
      subtree: true
    }
  );


  v63RestorePlotSettingsState();

  v63InstallXRangeControls();

}


/* === CRMMS EXPLORER 6.3 PLOT SETTINGS END === */

/* === CRMMS EXPLORER 6.4 START === */


/* ============================================================
   PRIMARY PLOT CONFIGURED DATE RANGE
   ============================================================ */


/*
 * IMPORTANT:
 *
 * This version does NOT use a MutationObserver.
 *
 * It also does NOT modify pointsForStackEntry().
 *
 * The configured X-axis range is applied only to:
 *
 *   1. Plotted Data table models
 *   2. Plotted Data CSV export
 *
 * Plot rendering remains unchanged.
 */


function v64PrimaryPlotItem() {

  if (
    !Array.isArray(
      state.explorerStackItems
    )
  ) {
    return null;
  }


  return (
    state.explorerStackItems[0]
    || null
  );

}


/*
 * Get the primary plot's configured range.
 *
 * Interactive mouse zoom is intentionally ignored.
 */

function v64PrimaryConfiguredDateRange() {

  const item =
    v64PrimaryPlotItem();


  if (!item) {
    return null;
  }


  const mode =
    typeof v63NormalizeXRangeMode ===
    'function'
      ? v63NormalizeXRangeMode(
          item.x_range_mode
        )
      : (
          item.x_range_mode
          || 'full'
        );


  if (
    mode === 'full'
  ) {
    return null;
  }


  const card =
    document.querySelector(
      '#explorerPlotStack .explorer-plot-card'
    );


  const plot =
    card?.querySelector(
      '.explorer-plot'
    );


  if (
    !plot ||
    typeof v63ConfiguredXRange !==
    'function'
  ) {
    return null;
  }


  const range =
    v63ConfiguredXRange(
      item,
      plot.data || []
    );


  if (
    !Array.isArray(range) ||
    range.length !== 2
  ) {
    return null;
  }


  return range;

}


/* ============================================================
   DATE HELPERS
   ============================================================ */


function v64PointDate(
  point
) {

  if (!point) {
    return null;
  }


  const candidates = [

    point.x,

    point.date,

    point.datetime,

    point.period,

    point.label

  ];


  for (
    const candidate of
    candidates
  ) {

    if (
      candidate == null ||
      candidate === ''
    ) {
      continue;
    }


    const date =
      new Date(
        candidate
      );


    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date;
    }

  }


  return null;

}


function v64DateInsideRange(
  value,
  range
) {

  if (!range) {
    return true;
  }


  const date =
    value instanceof Date
      ? value
      : new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return true;
  }


  const start =
    new Date(
      range[0]
    );


  const end =
    new Date(
      range[1]
    );


  if (
    Number.isNaN(
      start.getTime()
    ) ||
    Number.isNaN(
      end.getTime()
    )
  ) {
    return true;
  }


  return (
    date >= start &&
    date <= end
  );

}


function v64PointInsideRange(
  point,
  range
) {

  if (!range) {
    return true;
  }


  const date =
    v64PointDate(
      point
    );


  /*
   * If a transformed period cannot be interpreted as a date,
   * leave it alone rather than silently removing data.
   */

  if (!date) {
    return true;
  }


  return v64DateInsideRange(
    date,
    range
  );

}


/* ============================================================
   FILTER SINGLE-PLOT TABLE MODEL
   ============================================================ */


function v64FilterSingleTableModel(
  model
) {

  const range =
    v64PrimaryConfiguredDateRange();


  if (
    !model ||
    !range
  ) {
    return model;
  }


  if (
    !Array.isArray(
      model.periods
    )
  ) {
    return model;
  }


  const periods =
    model.periods.filter(
      period => {

        const candidate =
          period?.x
          ?? period?.date
          ?? period?.label;


        return v64DateInsideRange(
          candidate,
          range
        );

      }
    );


  return {
    ...model,
    periods
  };

}


/*
 * Wrap the existing single-plot table model.
 */

if (
  typeof explorerTableModel ===
  'function'
) {

  const v64OriginalExplorerTableModel =
    explorerTableModel;


  explorerTableModel =
    function(...args) {

      const model =
        v64OriginalExplorerTableModel
          .apply(
            this,
            args
          );


      return v64FilterSingleTableModel(
        model
      );

    };

}


/* ============================================================
   FILTER STACKED TABLE MODEL
   ============================================================ */


function v64FilterStackedTableModel(
  model
) {

  const range =
    v64PrimaryConfiguredDateRange();


  if (
    !model ||
    !range
  ) {
    return model;
  }


  if (
    !Array.isArray(
      model.periods
    )
  ) {
    return model;
  }


  const periods =
    model.periods.filter(
      period => {

        const candidate =
          period?.x
          ?? period?.date
          ?? period?.label;


        return v64DateInsideRange(
          candidate,
          range
        );

      }
    );


  return {
    ...model,
    periods
  };

}


/*
 * Wrap the existing stacked table model.
 */

if (
  typeof explorerStackedTableModel ===
  'function'
) {

  const v64OriginalExplorerStackedTableModel =
    explorerStackedTableModel;


  explorerStackedTableModel =
    function(...args) {

      const model =
        v64OriginalExplorerStackedTableModel
          .apply(
            this,
            args
          );


      return v64FilterStackedTableModel(
        model
      );

    };

}


/* ============================================================
   CSV FILTER
   ============================================================ */


/*
 * The existing CSV function directly traverses points for a
 * multi-plot stack.
 *
 * Rather than modifying pointsForStackEntry globally, temporarily
 * wrap it ONLY while CSV export runs.
 */

if (
  typeof exportExplorerTableCsv ===
  'function'
) {

  const v64OriginalExportExplorerTableCsv =
    exportExplorerTableCsv;


  exportExplorerTableCsv =
    function(...args) {

      const range =
        v64PrimaryConfiguredDateRange();


      if (
        !range ||
        typeof pointsForStackEntry !==
        'function'
      ) {

        return (
          v64OriginalExportExplorerTableCsv
            .apply(
              this,
              args
            )
        );

      }


      const originalPointsFunction =
        pointsForStackEntry;


      pointsForStackEntry =
        function(
          entry,
          runKey
        ) {

          const series =
            originalPointsFunction(
              entry,
              runKey
            );


          return (
            series || []
          ).map(
            trace => ({

              ...trace,

              points:
                (
                  trace.points
                  || []
                ).filter(
                  point =>
                    v64PointInsideRange(
                      point,
                      range
                    )
                )

            })
          );

        };


      try {

        return (
          v64OriginalExportExplorerTableCsv
            .apply(
              this,
              args
            )
        );

      }
      finally {

        pointsForStackEntry =
          originalPointsFunction;

      }

    };

}


/* ============================================================
   TABLE RANGE LABEL
   ============================================================ */


function v64FormatMonth(
  value
) {

  const date =
    new Date(
      value
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return String(
      value || ''
    );

  }


  return date.toLocaleDateString(
    undefined,
    {
      month:
        'short',

      year:
        'numeric'
    }
  );

}


function v64UpdateTableRangeLabel() {

  const tableCard =
    document.querySelector(
      '#dataExplorerSection .explorer-table-card'
    );


  if (!tableCard) {
    return;
  }


  let label =
    document.getElementById(
      'v64TableRangeLabel'
    );


  if (!label) {

    label =
      document.createElement(
        'div'
      );


    label.id =
      'v64TableRangeLabel';


    label.className =
      'v64-table-range-label';


    const head =
      tableCard.querySelector(
        '.explorer-table-head'
      );


    if (!head) {
      return;
    }


    head.appendChild(
      label
    );

  }


  const item =
    v64PrimaryPlotItem();


  const range =
    v64PrimaryConfiguredDateRange();


  if (
    !item ||
    !range
  ) {

    label.textContent =
      'Full available date range';


    return;

  }


  const modeText =
    ({

      months12:
        '12 months',

      months24:
        '24 months',

      months36:
        '36 months',

      custom:
        'Custom range'

    })[
      item.x_range_mode
    ]
    || 'Configured range';


  label.textContent =
    modeText
    + ' · '
    + v64FormatMonth(
        range[0]
      )
    + ' – '
    + v64FormatMonth(
        range[1]
      )
    + ' · primary plot';

}


/*
 * renderExplorerTable() already represents the correct lifecycle
 * for the table. No DOM observer is required.
 */

if (
  typeof renderExplorerTable ===
  'function'
) {

  const v64OriginalRenderExplorerTable =
    renderExplorerTable;


  renderExplorerTable =
    function(...args) {

      const result =
        v64OriginalRenderExplorerTable
          .apply(
            this,
            args
          );


      requestAnimationFrame(
        v64UpdateTableRangeLabel
      );


      return result;

    };

}


/* ============================================================
   PRESET MANAGER HELPERS
   ============================================================ */


function v64Escape(
  value
) {

  if (
    typeof escapeHtml ===
    'function'
  ) {

    return escapeHtml(
      String(
        value ?? ''
      )
    );

  }


  return String(
    value ?? ''
  )
    .replaceAll(
      '&',
      '&amp;'
    )
    .replaceAll(
      '<',
      '&lt;'
    )
    .replaceAll(
      '>',
      '&gt;'
    )
    .replaceAll(
      '"',
      '&quot;'
    )
    .replaceAll(
      "'",
      '&#039;'
    );

}


function v64Clone(
  value
) {

  return JSON.parse(
    JSON.stringify(
      value
    )
  );

}


/* ============================================================
   PRESET MANAGER UI
   ============================================================ */


function v64EnsurePresetManager() {

  if (
    document.getElementById(
      'v64PresetManager'
    )
  ) {
    return;
  }


  const modal =
    document.createElement(
      'div'
    );


  modal.id =
    'v64PresetManager';


  modal.className =
    'v64-preset-modal';


  modal.hidden =
    true;


  modal.dataset.kind =
    'plot';


  modal.dataset.selectedId =
    '';


  modal.innerHTML = `

    <div
      class="v64-preset-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="v64PresetManagerTitle"
    >

      <div class="v64-preset-header">

        <div>

          <strong id="v64PresetManagerTitle">
            Preset Manager
          </strong>

          <small>
            Manage reusable Explorer and Data Analysis configurations
          </small>

        </div>


        <button
          type="button"
          class="v64-preset-close"
          id="v64ClosePresetManager"
          aria-label="Close"
        >
          ×
        </button>

      </div>


      <div class="v64-preset-tabs">

        <button
          type="button"
          class="v64-preset-tab is-active"
          data-v64-preset-tab="plot"
        >
          Plot presets
        </button>


        <button
          type="button"
          class="v64-preset-tab"
          data-v64-preset-tab="analysis"
        >
          Data Analysis presets
        </button>

      </div>


      <div class="v64-preset-body">

        <aside class="v64-preset-list-panel">

          <div class="v64-preset-list-actions">

            <button
              type="button"
              class="mini-button"
              id="v64NewPresetFromCurrent"
            >
              New from current
            </button>


            <button
              type="button"
              class="mini-button"
              id="v64DuplicatePreset"
            >
              Duplicate
            </button>

          </div>


          <div
            class="v64-preset-list"
            id="v64PresetList"
          ></div>


          <div class="v64-preset-file-actions">

            <button
              type="button"
              class="mini-button"
              id="v64ExportPresets"
            >
              Export presets
            </button>


            <button
              type="button"
              class="mini-button"
              id="v64ImportPresetsButton"
            >
              Import presets
            </button>


            <input
              type="file"
              id="v64ImportPresetsFile"
              accept=".json,application/json"
              hidden
            />

          </div>

        </aside>


        <section class="v64-preset-editor">

          <div
            id="v64PresetEmpty"
            class="v64-preset-empty"
          >
            Select a preset to edit it.
          </div>


          <div
            id="v64PresetEditorFields"
            hidden
          >

            <label>

              Name

              <input
                type="text"
                id="v64PresetName"
              />

            </label>


            <label>

              Description

              <textarea
                id="v64PresetDescription"
                rows="3"
              ></textarea>

            </label>


            <div
              id="v64PlotPresetSummary"
              class="v64-preset-summary"
            ></div>


            <div class="v64-preset-editor-actions">

              <button
                type="button"
                class="secondary-button"
                id="v64LoadPreset"
              >
                Load into workspace
              </button>


              <button
                type="button"
                class="secondary-button"
                id="v64SavePresetChanges"
              >
                Save changes
              </button>


              <button
                type="button"
                class="mini-button danger-lite"
                id="v64DeletePreset"
              >
                Delete
              </button>

            </div>

          </div>

        </section>

      </div>

    </div>

  `;


  document.body.appendChild(
    modal
  );


  /*
   * Close button.
   */

  document
    .getElementById(
      'v64ClosePresetManager'
    )
    ?.addEventListener(
      'click',
      v64ClosePresetManager
    );


  /*
   * Click outside dialog closes it.
   */

  modal.addEventListener(
    'click',
    event => {

      if (
        event.target === modal
      ) {

        v64ClosePresetManager();

      }

    }
  );


  /*
   * Tabs.
   */

  modal
    .querySelectorAll(
      '[data-v64-preset-tab]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            modal.dataset.kind =
              button.dataset.v64PresetTab;


            modal.dataset.selectedId =
              '';


            modal
              .querySelectorAll(
                '[data-v64-preset-tab]'
              )
              .forEach(
                tab => {

                  tab.classList.toggle(
                    'is-active',
                    tab === button
                  );

                }
              );


            v64RenderPresetManager();

          }
        );

      }
    );


  document
    .getElementById(
      'v64NewPresetFromCurrent'
    )
    ?.addEventListener(
      'click',
      v64NewPresetFromCurrent
    );


  document
    .getElementById(
      'v64DuplicatePreset'
    )
    ?.addEventListener(
      'click',
      v64DuplicateSelectedPreset
    );


  document
    .getElementById(
      'v64SavePresetChanges'
    )
    ?.addEventListener(
      'click',
      () => {

        v64SaveSelectedPresetChanges()
          .catch(
            error => {

              console.error(
                error
              );


              showError(
                error.message
                || 'Could not save preset.'
              );

            }
          );

      }
    );


  document
    .getElementById(
      'v64DeletePreset'
    )
    ?.addEventListener(
      'click',
      () => {

        v64DeleteSelectedPreset()
          .catch(
            error => {

              console.error(
                error
              );


              showError(
                error.message
                || 'Could not delete preset.'
              );

            }
          );

      }
    );


  document
    .getElementById(
      'v64LoadPreset'
    )
    ?.addEventListener(
      'click',
      v64LoadSelectedPreset
    );


  document
    .getElementById(
      'v64ExportPresets'
    )
    ?.addEventListener(
      'click',
      v64ExportPresetFile
    );


  document
    .getElementById(
      'v64ImportPresetsButton'
    )
    ?.addEventListener(
      'click',
      () => {

        document
          .getElementById(
            'v64ImportPresetsFile'
          )
          ?.click();

      }
    );


  document
    .getElementById(
      'v64ImportPresetsFile'
    )
    ?.addEventListener(
      'change',
      event => {

        const file =
          event.target
            .files?.[0];


        v64ImportPresetFile(
          file
        )
          .catch(
            error => {

              console.error(
                error
              );


              showError(
                error.message
                || 'Could not import presets.'
              );

            }
          )
          .finally(
            () => {

              event.target.value =
                '';

            }
          );

      }
    );

}


/* ============================================================
   PRESET COLLECTION HELPERS
   ============================================================ */


function v64PresetCollection() {

  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  const kind =
    modal?.dataset?.kind
    || 'plot';


  if (
    kind === 'analysis'
  ) {

    return (
      state.explorerPresets
        ?.analysis_presets
      || []
    );

  }


  return (
    state.explorerPresets
      ?.plot_presets
    || []
  );

}


function v64SelectedPreset() {

  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  const id =
    modal?.dataset?.selectedId
    || '';


  return (
    v64PresetCollection()
      .find(
        preset =>
          preset.id === id
      )
    || null
  );

}


/* ============================================================
   RENDER PRESET MANAGER
   ============================================================ */


function v64RenderPresetManager() {

  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  if (!modal) {
    return;
  }


  const list =
    document.getElementById(
      'v64PresetList'
    );


  const presets =
    v64PresetCollection();


  const selectedId =
    modal.dataset.selectedId
    || '';


  list.innerHTML =
    presets.length

      ? presets
          .map(
            preset => `

              <button
                type="button"
                class="v64-preset-list-item ${
                  preset.id === selectedId
                    ? 'is-selected'
                    : ''
                }"
                data-v64-preset-id="${v64Escape(preset.id)}"
              >

                <strong>
                  ${v64Escape(
                    preset.name
                    || preset.id
                  )}
                </strong>

                <small>
                  ${v64Escape(
                    preset.description
                    || ''
                  )}
                </small>

              </button>

            `
          )
          .join('')

      : `

          <div class="v64-preset-empty-list">
            No presets saved.
          </div>

        `;


  list
    .querySelectorAll(
      '[data-v64-preset-id]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            modal.dataset.selectedId =
              button.dataset.v64PresetId;


            v64RenderPresetManager();

          }
        );

      }
    );


  const selected =
    v64SelectedPreset();


  const empty =
    document.getElementById(
      'v64PresetEmpty'
    );


  const fields =
    document.getElementById(
      'v64PresetEditorFields'
    );


  if (!selected) {

    empty.hidden =
      false;


    fields.hidden =
      true;


    return;

  }


  empty.hidden =
    true;


  fields.hidden =
    false;


  document
    .getElementById(
      'v64PresetName'
    )
    .value =
      selected.name
      || '';


  document
    .getElementById(
      'v64PresetDescription'
    )
    .value =
      selected.description
      || '';


  v64RenderPresetSummary(
    selected
  );

}


/* ============================================================
   PRESET SUMMARY
   ============================================================ */


function v64RenderPresetSummary(
  preset
) {

  const host =
    document.getElementById(
      'v64PlotPresetSummary'
    );


  if (!host) {
    return;
  }


  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  if (
    modal?.dataset?.kind ===
    'analysis'
  ) {

    host.innerHTML = `

      <strong>
        Data Analysis configuration
      </strong>

      <p>
        This preset stores a reusable Data Analysis
        filter configuration.
      </p>

    `;


    return;

  }


  const settings =
    preset.settings
    || {};


  const items =
    settings.stack_items
    || [];


  if (!items.length) {

    host.innerHTML = `

      <strong>
        Plot configuration
      </strong>

      <p>
        This preset does not contain stack_items.
      </p>

    `;


    return;

  }


  host.innerHTML = `

    <strong>
      ${items.length}
      plot${items.length === 1 ? '' : 's'}
    </strong>


    <div class="v64-preset-plot-list">

      ${items
        .map(
          (item, index) => `

            <div class="v64-preset-plot-row">

              <span class="v64-preset-number">
                ${index + 1}
              </span>


              <span>

                <strong>
                  ${v64Escape(
                    item.slot
                    || ''
                  )}
                </strong>

                <small>
                  ${v64Escape(
                    item.plot_type
                    || 'line'
                  )}
                  ·
                  ${v64Escape(
                    item.transform
                    || 'raw'
                  )}
                  ·
                  ${v64Escape(
                    item.x_range_mode
                    || 'full'
                  )}
                </small>

              </span>

            </div>

          `
        )
        .join('')}

    </div>

  `;

}


/* ============================================================
   OPEN / CLOSE
   ============================================================ */


function v64OpenPresetManager(
  kind='plot'
) {

  v64EnsurePresetManager();


  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  modal.dataset.kind =
    kind;


  modal.dataset.selectedId =
    '';


  modal
    .querySelectorAll(
      '[data-v64-preset-tab]'
    )
    .forEach(
      button => {

        button.classList.toggle(
          'is-active',
          button.dataset.v64PresetTab ===
          kind
        );

      }
    );


  modal.hidden =
    false;


  document.body.classList.add(
    'v64-modal-open'
  );


  v64RenderPresetManager();

}


function v64ClosePresetManager() {

  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  if (modal) {

    modal.hidden =
      true;

  }


  document.body.classList.remove(
    'v64-modal-open'
  );

}


/* ============================================================
   CREATE PRESET FROM CURRENT
   ============================================================ */


function v64NewPresetFromCurrent() {

  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  const kind =
    modal?.dataset?.kind
    || 'plot';


  const name =
    prompt(

      kind === 'analysis'

        ? 'Name for this Data Analysis preset:'

        : 'Name for this plot preset:'

    );


  if (
    !name?.trim()
  ) {
    return;
  }


  let preset;


  if (
    kind === 'analysis'
  ) {

    if (
      typeof slotChecksSnapshot !==
      'function'
    ) {

      showError(
        'The Data Analysis configuration is not available.'
      );


      return;

    }


    preset = {

      id:
        slugPresetName(
          name
        ),

      name:
        name.trim(),

      description:
        '',

      settings:
        slotChecksSnapshot()

    };

  }
  else {

    if (
      typeof plotPresetSnapshot !==
      'function'
    ) {

      showError(
        'The current plot configuration is not available.'
      );


      return;

    }


    preset =
      plotPresetSnapshot(
        name.trim()
      );

  }


  const collection =
    v64PresetCollection();


  const existing =
    collection.findIndex(
      item =>
        item.id ===
        preset.id
    );


  if (
    existing >= 0
  ) {

    if (
      !confirm(
        `Replace existing preset "${collection[existing].name}"?`
      )
    ) {
      return;
    }


    collection[existing] =
      preset;

  }
  else {

    collection.push(
      preset
    );

  }


  persistExplorerPresets()
    .then(
      () => {

        modal.dataset.selectedId =
          preset.id;


        v64RenderPresetManager();

      }
    )
    .catch(
      error => {

        console.error(
          error
        );


        showError(
          error.message
          || 'Could not save preset.'
        );

      }
    );

}


/* ============================================================
   DUPLICATE PRESET
   ============================================================ */


function v64DuplicateSelectedPreset() {

  const selected =
    v64SelectedPreset();


  if (!selected) {
    return;
  }


  const name =
    prompt(
      'Name for duplicated preset:',
      `${selected.name || selected.id} Copy`
    );


  if (
    !name?.trim()
  ) {
    return;
  }


  const copy =
    v64Clone(
      selected
    );


  copy.id =
    slugPresetName(
      name
    );


  copy.name =
    name.trim();


  const collection =
    v64PresetCollection();


  if (
    collection.some(
      item =>
        item.id === copy.id
    )
  ) {

    showError(
      'A preset with that name already exists.'
    );


    return;

  }


  collection.push(
    copy
  );


  persistExplorerPresets()
    .then(
      () => {

        document
          .getElementById(
            'v64PresetManager'
          )
          .dataset.selectedId =
            copy.id;


        v64RenderPresetManager();

      }
    )
    .catch(
      error => {

        console.error(
          error
        );


        showError(
          error.message
          || 'Could not duplicate preset.'
        );

      }
    );

}


/* ============================================================
   SAVE PRESET NAME / DESCRIPTION
   ============================================================ */


async function v64SaveSelectedPresetChanges() {

  const selected =
    v64SelectedPreset();


  if (!selected) {
    return;
  }


  const name =
    document
      .getElementById(
        'v64PresetName'
      )
      ?.value
      ?.trim();


  const description =
    document
      .getElementById(
        'v64PresetDescription'
      )
      ?.value
      ?.trim()
    || '';


  if (!name) {

    showError(
      'Preset name is required.'
    );


    return;

  }


  /*
   * Keep ID stable when changing display name.
   */

  selected.name =
    name;


  selected.description =
    description;


  await persistExplorerPresets();


  hideError();


  v64RenderPresetManager();

}


/* ============================================================
   DELETE PRESET
   ============================================================ */


async function v64DeleteSelectedPreset() {

  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  const selected =
    v64SelectedPreset();


  if (!selected) {
    return;
  }


  if (
    !confirm(
      `Delete preset "${selected.name || selected.id}"?`
    )
  ) {
    return;
  }


  const key =
    modal.dataset.kind ===
    'analysis'

      ? 'analysis_presets'

      : 'plot_presets';


  state.explorerPresets[key] =
    (
      state.explorerPresets[key]
      || []
    ).filter(
      item =>
        item.id !==
        selected.id
    );


  modal.dataset.selectedId =
    '';


  await persistExplorerPresets();


  v64RenderPresetManager();

}


/* ============================================================
   LOAD PRESET
   ============================================================ */


function v64LoadSelectedPreset() {

  const modal =
    document.getElementById(
      'v64PresetManager'
    );


  const selected =
    v64SelectedPreset();


  if (!selected) {
    return;
  }


  if (
    modal.dataset.kind ===
    'analysis'
  ) {

    if (
      typeof loadAnalysisPresetById ===
      'function'
    ) {

      loadAnalysisPresetById(
        selected.id
      );


      v64ClosePresetManager();

    }

  }
  else {

    if (
      typeof loadPlotPresetById ===
      'function'
    ) {

      loadPlotPresetById(
        selected.id
      );


      v64ClosePresetManager();

    }

  }

}


/* ============================================================
   EXPORT PRESETS
   ============================================================ */


function v64ExportPresetFile() {

  const data =
    JSON.stringify(
      state.explorerPresets
      || {
        version:
          1,

        plot_presets:
          [],

        analysis_presets:
          []
      },
      null,
      2
    );


  const blob =
    new Blob(
      [data],
      {
        type:
          'application/json;charset=utf-8'
      }
    );


  if (
    typeof downloadBlob ===
    'function'
  ) {

    downloadBlob(
      blob,
      'crmms-explorer-presets.json'
    );


    return;

  }


  const url =
    URL.createObjectURL(
      blob
    );


  const a =
    document.createElement(
      'a'
    );


  a.href =
    url;


  a.download =
    'crmms-explorer-presets.json';


  document.body.appendChild(
    a
  );


  a.click();


  a.remove();


  setTimeout(
    () => {

      URL.revokeObjectURL(
        url
      );

    },
    1000
  );

}


/* ============================================================
   IMPORT PRESETS
   ============================================================ */


async function v64ImportPresetFile(
  file
) {

  if (!file) {
    return;
  }


  const text =
    await file.text();


  let incoming;


  try {

    incoming =
      JSON.parse(
        text
      );

  }
  catch (_) {

    throw new Error(
      'The selected file is not valid JSON.'
    );

  }


  if (
    !incoming ||
    !Array.isArray(
      incoming.plot_presets
    ) ||
    !Array.isArray(
      incoming.analysis_presets
    )
  ) {

    throw new Error(
      'This is not a valid CRMMS Explorer preset file.'
    );

  }


  const replace =
    confirm(

      'Replace all current presets with the imported file?\n\n'
      + 'Choose Cancel to MERGE the imported presets instead.'

    );


  if (replace) {

    state.explorerPresets =
      v64Clone(
        incoming
      );

  }
  else {

    const merge =
      (
        current,
        additions
      ) => {

        const map =
          new Map(
            (
              current
              || []
            ).map(
              item => [
                item.id,
                item
              ]
            )
          );


        for (
          const item of
          (
            additions
            || []
          )
        ) {

          map.set(
            item.id,
            item
          );

        }


        return [
          ...map.values()
        ];

      };


    state.explorerPresets = {

      version:
        Math.max(

          Number(
            state.explorerPresets
              ?.version
            || 1
          ),

          Number(
            incoming.version
            || 1
          )

        ),


      plot_presets:
        merge(

          state.explorerPresets
            ?.plot_presets,

          incoming.plot_presets

        ),


      analysis_presets:
        merge(

          state.explorerPresets
            ?.analysis_presets,

          incoming.analysis_presets

        )

    };

  }


  await persistExplorerPresets();


  hideError();


  v64RenderPresetManager();

}


/* ============================================================
   MANAGE PRESETS BUTTONS
   ============================================================ */


function v64InstallPresetManagerButtons() {

  /*
   * Plot presets.
   */

  const plotSelect =
    document.getElementById(
      'explorerPlotPreset'
    );


  if (
    plotSelect &&
    !document.getElementById(
      'v64ManagePlotPresets'
    )
  ) {

    const button =
      document.createElement(
        'button'
      );


    button.id =
      'v64ManagePlotPresets';


    button.type =
      'button';


    button.className =
      'mini-button';


    button.textContent =
      'Manage presets';


    const panel =
      plotSelect.closest(
        '.preset-panel'
      );


    const actions =
      panel?.querySelector(
        '.explorer-button-row'
      );


    if (actions) {

      actions.appendChild(
        button
      );

    }
    else {

      plotSelect
        .closest(
          'label'
        )
        ?.after(
          button
        );

    }


    button.addEventListener(
      'click',
      () => {

        v64OpenPresetManager(
          'plot'
        );

      }
    );

  }


  /*
   * Data Analysis presets.
   */

  const analysisSelect =
    document.getElementById(
      'slotCheckPreset'
    );


  if (
    analysisSelect &&
    !document.getElementById(
      'v64ManageAnalysisPresets'
    )
  ) {

    const button =
      document.createElement(
        'button'
      );


    button.id =
      'v64ManageAnalysisPresets';


    button.type =
      'button';


    button.className =
      'mini-button';


    button.textContent =
      'Manage presets';


    const panel =
      analysisSelect.closest(
        '.preset-panel'
      );


    const actions =
      panel?.querySelector(
        '.explorer-button-row'
      );


    if (actions) {

      actions.appendChild(
        button
      );

    }
    else {

      analysisSelect
        .closest(
          'label'
        )
        ?.after(
          button
        );

    }


    button.addEventListener(
      'click',
      () => {

        v64OpenPresetManager(
          'analysis'
        );

      }
    );

  }

}


/* ============================================================
   INITIALIZATION
   ============================================================ */


/*
 * NO MutationObserver here.
 *
 * Installing the manager once is sufficient because the preset
 * controls themselves are part of the normal page structure.
 */

function initializeCRMMSExplorer64() {

  v64EnsurePresetManager();


  v64InstallPresetManagerButtons();


  requestAnimationFrame(
    v64UpdateTableRangeLabel
  );


  console.info(
    'CRMMS Explorer v6.4 initialized.'
  );

}


if (
  document.readyState ===
  'loading'
) {

  document.addEventListener(
    'DOMContentLoaded',
    initializeCRMMSExplorer64
  );

}
else {

  initializeCRMMSExplorer64();

}


/* === CRMMS EXPLORER 6.4 END === */
