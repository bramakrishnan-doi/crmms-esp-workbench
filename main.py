from __future__ import annotations

import atexit
import base64
import fnmatch
import json
import math
import re
import shutil
import tempfile
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .comparison import (
    INPUT_GROUPS,
    REQUIRED_INPUTS,
    ComparisonError,
    ComparisonSettings,
    compare_rdf_files,
    compare_workbooks,
)
from .rdf_reader import describe_rdf, inspect_rdf as inspect_rdf_file, list_rdf_slots, read_rdf, trace_to_esp
from .reporting.plots import render_all_plots
from .reporting.report import ReportSettings, build_report
from .runtime_paths import BUNDLE_DIR, FROZEN, user_data_dir

STATIC_DIR = BUNDLE_DIR / "static"
BUNDLED_PRESETS_FILE = BUNDLE_DIR / "explorer_presets.json"
if FROZEN:
    EXPLORER_PRESETS_FILE = user_data_dir() / "explorer_presets.json"
    EXPLORER_PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not EXPLORER_PRESETS_FILE.exists() and BUNDLED_PRESETS_FILE.exists():
        shutil.copy2(BUNDLED_PRESETS_FILE, EXPLORER_PRESETS_FILE)
else:
    EXPLORER_PRESETS_FILE = BUNDLED_PRESETS_FILE
MAX_XLSX_BYTES = 50 * 1024 * 1024
MAX_RDF_BYTES = 150 * 1024 * 1024
MAX_RDF_FILES_PER_RUN = 24
APP_VERSION = "6.0.0"
DEFAULT_RDF_SELECTED_INPUTS = ("Powell.Pool Elevation", "Mead.Pool Elevation")

DEFAULT_EXPLORER_PRELOAD = {
    # Keep Explorer discovery lightweight. Other slots are loaded lazily
    # when selected and then retained in the session cache.
    "patterns": [
        "Powell.Pool Elevation",
        "Mead.Pool Elevation",
    ],
    "all_slots_files": [],
}
EXPLORER_SESSION_TTL_SECONDS = 8 * 60 * 60
EXPLORER_SESSION_MAX = 4
_EXPLORER_SESSIONS: dict[str, dict[str, Any]] = {}


def _cleanup_explorer_sessions(*, force: bool = False) -> None:
    now = time.time()
    stale = []
    for session_id, session in list(_EXPLORER_SESSIONS.items()):
        if force or now - float(session.get("last_access", now)) > EXPLORER_SESSION_TTL_SECONDS:
            stale.append(session_id)
    if not force and len(_EXPLORER_SESSIONS) - len(stale) > EXPLORER_SESSION_MAX:
        live = sorted(
            ((sid, float(rec.get("last_access", 0))) for sid, rec in _EXPLORER_SESSIONS.items() if sid not in stale),
            key=lambda x: x[1],
        )
        stale.extend(sid for sid, _ in live[: max(0, len(live) - EXPLORER_SESSION_MAX)])
    for sid in dict.fromkeys(stale):
        rec = _EXPLORER_SESSIONS.pop(sid, None)
        if rec:
            shutil.rmtree(rec.get("root", ""), ignore_errors=True)


atexit.register(lambda: _cleanup_explorer_sessions(force=True))

app = FastAPI(
    title="CRMMS ESP Compare & Report Builder",
    description="Compare CRMMS outputs from RiverWare RDF files or legacy EnsembleOutput workbooks and generate a publication-ready Word summary report.",
    version=APP_VERSION,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": APP_VERSION}




def _default_explorer_presets() -> dict[str, Any]:
    return {"version": 1, "plot_presets": [], "analysis_presets": []}

def _load_explorer_presets() -> dict[str, Any]:
    if not EXPLORER_PRESETS_FILE.exists():
        return _default_explorer_presets()
    try:
        data = json.loads(EXPLORER_PRESETS_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read explorer_presets.json: {exc}") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="explorer_presets.json must contain a JSON object.")
    data.setdefault("version", 1)
    data.setdefault("plot_presets", [])
    data.setdefault("analysis_presets", [])
    return data

def _validate_explorer_presets(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Preset configuration must be a JSON object.")
    out = {"version": int(data.get("version") or 1), "plot_presets": [], "analysis_presets": []}
    for kind in ("plot_presets", "analysis_presets"):
        raw = data.get(kind, [])
        if not isinstance(raw, list):
            raise HTTPException(status_code=422, detail=f"{kind} must be a list.")
        seen=set()
        for item in raw:
            if not isinstance(item, dict):
                continue
            pid=str(item.get("id") or "").strip()
            name=str(item.get("name") or "").strip()
            if not pid or not name or pid in seen:
                continue
            seen.add(pid); out[kind].append(item)
    return out

@app.get("/api/explorer/presets")
def get_explorer_presets() -> dict[str, Any]:
    return _load_explorer_presets()

@app.put("/api/explorer/presets")
def put_explorer_presets(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    data = _validate_explorer_presets(payload)
    tmp = EXPLORER_PRESETS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(EXPLORER_PRESETS_FILE)
    return data


@app.get("/api/rdf/schema")
def rdf_schema() -> dict[str, Any]:
    return {
        "logical_inputs": [
            {
                "logical_name": name,
                "default_slot": name,
                "group": INPUT_GROUPS.get(name, "Other"),
                "default_enabled": name in DEFAULT_RDF_SELECTED_INPUTS,
            }
            for name in REQUIRED_INPUTS
        ],
        "default_trace_expression": "4-33",
        "default_selected_inputs": list(DEFAULT_RDF_SELECTED_INPUTS),
        "esp_mapping": "Trace 4 -> ESP 1991 through Trace 33 -> ESP 2020",
    }


async def _read_xlsx_upload(upload: UploadFile, label: str) -> bytes:
    filename = upload.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail=f"{label} must be an .xlsx file.")
    payload = await upload.read(MAX_XLSX_BYTES + 1)
    if len(payload) > MAX_XLSX_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} exceeds the 50 MB upload limit.")
    if not payload.startswith(b"PK"):
        raise HTTPException(status_code=400, detail=f"{label} does not appear to be a valid .xlsx file.")
    return payload


async def _save_rdf_uploads(uploads: list[UploadFile], directory: Path, label: str) -> tuple[list[Path], list[str]]:
    if not uploads:
        raise HTTPException(status_code=400, detail=f"{label} requires at least one .rdf file.")
    if len(uploads) > MAX_RDF_FILES_PER_RUN:
        raise HTTPException(
            status_code=400,
            detail=f"{label} supports at most {MAX_RDF_FILES_PER_RUN} RDF files per run.",
        )

    paths: list[Path] = []
    names: list[str] = []
    directory.mkdir(parents=True, exist_ok=True)
    for index, upload in enumerate(uploads, start=1):
        filename = Path(upload.filename or f"run-{index}.rdf").name
        if not filename.lower().endswith(".rdf"):
            raise HTTPException(status_code=400, detail=f"{label} file '{filename}' must end in .rdf.")
        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", filename) or f"run-{index}.rdf"
        path = directory / f"{index:02d}_{safe_name}"
        size = 0
        with path.open("wb") as fh:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_RDF_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"{label} file '{filename}' exceeds the 150 MB per-file upload limit.",
                    )
                fh.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail=f"{label} file '{filename}' is empty.")
        paths.append(path)
        names.append(filename)
    return paths, names


def _parse_years(raw: str, label: str, *, min_count: int = 1, max_count: int = 10) -> tuple[int, ...]:
    tokens = [t.strip() for t in re.split(r"[,;\s]+", raw or "") if t.strip()]
    if not tokens:
        raise HTTPException(status_code=400, detail=f"{label} must contain at least one year.")
    try:
        years = [int(t) for t in tokens]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{label} must be a comma-separated list of 4-digit years.") from exc
    if len(years) < min_count or len(years) > max_count:
        raise HTTPException(status_code=400, detail=f"{label} must contain between {min_count} and {max_count} years.")
    if any(y < 2000 or y > 2200 for y in years):
        raise HTTPException(status_code=400, detail=f"{label} years must be between 2000 and 2200.")
    if len(set(years)) != len(years):
        raise HTTPException(status_code=400, detail=f"{label} cannot contain duplicate years.")
    return tuple(years)


def _parse_traces(raw: str) -> tuple[int, ...]:
    values: list[int] = []
    seen: set[int] = set()
    for part in re.split(r"[,;\s]+", raw or ""):
        part = part.strip()
        if not part:
            continue
        if "-" in part[1:]:
            pieces = part.split("-", 1)
            try:
                start, end = int(pieces[0]), int(pieces[1])
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Trace numbers must look like 4-33 or 4,5,8.") from exc
            step = 1 if end >= start else -1
            candidates = range(start, end + step, step)
        else:
            try:
                candidates = [int(part)]
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Trace numbers must look like 4-33 or 4,5,8.") from exc
        for trace in candidates:
            if trace < 1 or trace > 100000:
                raise HTTPException(status_code=400, detail="Trace numbers must be positive integers.")
            if trace not in seen:
                seen.add(trace)
                values.append(trace)
    if not values:
        raise HTTPException(status_code=400, detail="Select at least one trace number.")
    if len(values) > 250:
        raise HTTPException(status_code=400, detail="At most 250 trace numbers can be selected for one comparison.")
    return tuple(values)


def _parse_slot_mapping(raw: str) -> dict[str, str]:
    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"RDF slot mapping is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="RDF slot mapping must be a JSON object.")
    mapping: dict[str, str] = {}
    for logical in REQUIRED_INPUTS:
        # A blank mapping is allowed and means "this report input is intentionally
        # unavailable".  The comparison layer will omit only sections that depend
        # on it instead of aborting the entire report.
        value = payload.get(logical, logical)
        mapping[logical] = str(value).strip() if value is not None else ""
    return mapping


def _parse_selected_inputs(raw: str) -> list[str]:
    """Return caller-selected logical report inputs in canonical order.

    This is application/report configuration only. It deliberately does not
    affect the generic RiverWare RDF reader contract.
    """
    if not (raw or "").strip():
        return list(DEFAULT_RDF_SELECTED_INPUTS)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"RDF selected inputs are not valid JSON: {exc}") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="RDF selected inputs must be a JSON array.")
    requested = {str(x) for x in payload}
    unknown = sorted(requested.difference(REQUIRED_INPUTS))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown RDF logical report input(s): {', '.join(unknown)}")
    return [name for name in REQUIRED_INPUTS if name in requested]



def _parse_custom_slots(raw: str) -> list[str]:
    """Parse caller-selected exact Object.Slot names for generic report tables."""
    if not (raw or "").strip():
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"RDF custom slots are not valid JSON: {exc}") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="RDF custom slots must be a JSON array.")
    slots: list[str] = []
    seen: set[str] = set()
    for item in payload:
        slot = str(item).strip()
        if not slot:
            continue
        if len(slot) > 500:
            raise HTTPException(status_code=400, detail="An RDF Object.Slot name exceeds the 500-character limit.")
        if slot not in seen:
            seen.add(slot)
            slots.append(slot)
    if len(slots) > 120:
        raise HTTPException(status_code=400, detail="At most 120 additional RDF slots can be compared in one report.")
    return slots


def _parse_custom_statistic(raw: str) -> str:
    value = (raw or "median").strip().lower()
    if value not in {"median", "mean", "min", "max"}:
        raise HTTPException(status_code=400, detail="custom_slot_statistic must be median, mean, min, or max.")
    return value


def _parse_custom_plots(raw: str) -> list[dict[str, Any]]:
    if not (raw or "").strip():
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"RDF custom plots are not valid JSON: {exc}") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="RDF custom plots must be a JSON array.")
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for item in payload:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Each RDF custom plot must be an object.")
        slot = str(item.get("slot") or "").strip()
        if not slot:
            continue
        if len(slot) > 500:
            raise HTTPException(status_code=400, detail="An RDF plot Object.Slot name exceeds the 500-character limit.")
        plot_type = str(item.get("plot_type") or "line").strip().lower()
        if plot_type not in {"line", "bar", "box"}:
            raise HTTPException(status_code=400, detail="RDF plot type must be line, bar, or box.")
        transform = str(item.get("transform") or "raw").strip().lower()
        if transform not in {"raw", "water_year_sum", "calendar_year_sum", "annual_raw"}:
            raise HTTPException(status_code=400, detail="RDF plot data treatment must be raw, water_year_sum, calendar_year_sum, or annual_raw.")
        try:
            wy_start_month = int(item.get("wy_start_month") or 10)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="RDF plot water-year start month must be an integer from 1 through 12.") from exc
        if not 1 <= wy_start_month <= 12:
            raise HTTPException(status_code=400, detail="RDF plot water-year start month must be between 1 and 12.")
        def valid_color(value: Any, default: str) -> str:
            text = str(value or default).strip()
            return text if re.fullmatch(r"#[0-9A-Fa-f]{6}", text) else default
        try:
            alpha = float(item.get("alpha", 0.28))
        except (TypeError, ValueError):
            alpha = 0.28
        alpha = max(0.05, min(1.0, alpha))
        raw_plot_traces = item.get("trace_numbers")
        if isinstance(raw_plot_traces, str):
            plot_traces = list(_parse_traces(raw_plot_traces))
        elif isinstance(raw_plot_traces, list):
            try:
                plot_traces = [int(x) for x in raw_plot_traces]
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail="RDF plot trace_numbers must contain positive integers.") from exc
            if any(x < 1 or x > 100000 for x in plot_traces) or len(plot_traces) > 250:
                raise HTTPException(status_code=400, detail="RDF plot trace_numbers must contain 1-250 positive trace numbers.")
        else:
            plot_traces = []
        trace_labels_raw = item.get("trace_labels") if isinstance(item.get("trace_labels"), dict) else {}
        trace_labels = {str(k): str(v).strip()[:120] for k, v in trace_labels_raw.items() if str(v).strip()}
        title = str(item.get("title") or "").strip()[:180]
        subtitle = str(item.get("subtitle") or "").strip()[:500]
        key = (slot, plot_type, transform)
        if key in seen:
            continue
        seen.add(key)
        def finite_number(value: Any, default: float) -> float:
            try:
                number = float(value)
            except (TypeError, ValueError):
                return default
            return number if math.isfinite(number) else default
        y_axis_mode = str(item.get("y_axis_mode") or "auto").strip().lower()
        if y_axis_mode not in {"auto", "fixed"}:
            y_axis_mode = "auto"
        y_min_raw = item.get("y_min")
        y_max_raw = item.get("y_max")
        try:
            y_min = float(y_min_raw) if str(y_min_raw).strip() else None
        except (TypeError, ValueError):
            y_min = None
        try:
            y_max = float(y_max_raw) if str(y_max_raw).strip() else None
        except (TypeError, ValueError):
            y_max = None
        out.append({
            "slot": slot,
            "plot_type": plot_type,
            "title": title,
            "subtitle": subtitle,
            "transform": transform,
            "wy_start_month": wy_start_month,
            "run_a_color": valid_color(item.get("run_a_color"), "#167c80"),
            "run_b_color": valid_color(item.get("run_b_color"), "#d07a28"),
            "alpha": alpha,
            "trace_numbers": plot_traces,
            "trace_labels": trace_labels,
            "x_axis_title": str(item.get("x_axis_title") or "")[:120],
            "y_axis_title": str(item.get("y_axis_title") or "")[:120],
            "line_width": max(0.25, min(6.0, finite_number(item.get("line_width"), 1.0))),
            "show_grid": bool(item.get("show_grid", True)),
            "overlay_alpha": max(0.0, min(1.0, finite_number(item.get("overlay_alpha"), 0.16))),
            "y_axis_mode": y_axis_mode,
            "y_min": y_min,
            "y_max": y_max,
            "percentile_band": bool(item.get("percentile_band", False)),
            "percentile_low": max(0.0, min(100.0, finite_number(item.get("percentile_low"), 10.0))),
            "percentile_high": max(0.0, min(100.0, finite_number(item.get("percentile_high"), 90.0))),
            "unit_factor": finite_number(item.get("unit_factor"), 1.0),
            "unit_offset": finite_number(item.get("unit_offset"), 0.0),
            "display_unit": str(item.get("display_unit") or "")[:120],
            "reference_lines": str(item.get("reference_lines") or "")[:5000],
        })
    if len(out) > 24:
        raise HTTPException(status_code=400, detail="At most 24 RDF slot plots can be configured in one report.")
    return out


def _comparison_settings(
    *,
    eocy_year: int,
    eocy_month: int,
    powell_operating_year: int,
    comparison_years: str,
    release_years: str,
    mead_jan1_years: str,
    powell_plot_years: str,
    mead_plot_years: str,
    lower_basin_years: str,
    current_label: str,
    previous_label: str,
    trace_numbers: str,
    add_esp_year: bool,
) -> ComparisonSettings:
    if not 2000 <= eocy_year <= 2200:
        raise HTTPException(status_code=400, detail="EOCY year must be between 2000 and 2200.")
    if not 1 <= eocy_month <= 12:
        raise HTTPException(status_code=400, detail="EOCY month must be between 1 and 12.")
    if not 2000 <= powell_operating_year <= 2200:
        raise HTTPException(status_code=400, detail="Powell operating year must be between 2000 and 2200.")

    comp_years = _parse_years(comparison_years, "Comparison years", max_count=8)
    release = _parse_years(release_years, "Release scenario years", max_count=5)
    mead_years = _parse_years(mead_jan1_years, "Mead January 1 years", max_count=8)
    powell_plots = _parse_years(powell_plot_years, "Powell plot years", max_count=4)
    mead_plots = _parse_years(mead_plot_years, "Mead plot years", max_count=4)
    basin_years = _parse_years(lower_basin_years, "Lower Basin plot years", max_count=8)
    traces = _parse_traces(trace_numbers)

    return ComparisonSettings(
        year1=comp_years[0],
        eocy_year=eocy_year,
        eocy_month=eocy_month,
        powell_operating_year=powell_operating_year,
        current_label=current_label.strip()[:60] or "Run A",
        previous_label=previous_label.strip()[:60] or "Run B",
        comparison_years=comp_years,
        release_years=release,
        mead_jan1_years=mead_years,
        powell_plot_years=powell_plots,
        mead_plot_years=mead_plots,
        lower_basin_years=basin_years,
        trace_numbers=traces,
        add_esp_year=bool(add_esp_year),
    )


def _clean_json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, tuple):
        return [_clean_json_value(x) for x in value]
    if isinstance(value, list):
        return [_clean_json_value(x) for x in value]
    if isinstance(value, dict):
        return {str(k): _clean_json_value(v) for k, v in value.items()}
    if hasattr(value, "item"):
        try:
            return _clean_json_value(value.item())
        except Exception:
            pass
    if isinstance(value, float) and (value != value):
        return None
    return value


@app.post("/api/rdf/inspect")
async def inspect_rdf(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="crmms-rdf-inspect-") as tmp:
        paths, original_names = await _save_rdf_uploads(files, Path(tmp), "RDF inspection")
        file_results: list[dict[str, Any]] = []
        combined: dict[str, dict[str, Any]] = {}
        for path, original_name in zip(paths, original_names):
            try:
                # One RDF scan produces both the description and slot table.
                desc, slots = inspect_rdf_file(path)
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"Could not parse RDF file '{original_name}': {exc}") from exc
            slot_rows = []
            for rec in slots.to_dict(orient="records"):
                clean = _clean_json_value(rec)
                clean["file"] = original_name
                slot_rows.append(clean)
                slot = str(rec["object_slot"])
                bucket = combined.setdefault(
                    slot,
                    {
                        "object_slot": slot,
                        "files": [],
                        "units": [],
                        "scales": [],
                        "timestep_types": [],
                        "trace_count_max": 0,
                    },
                )
                bucket["files"].append(original_name)
                for field, out_field in (("units", "units"), ("scales", "scales"), ("timestep_types", "timestep_types")):
                    values = rec.get(field) or ()
                    for value in values:
                        value = _clean_json_value(value)
                        if value not in bucket[out_field]:
                            bucket[out_field].append(value)
                bucket["trace_count_max"] = max(bucket["trace_count_max"], int(rec.get("trace_count") or 0))
            file_results.append(
                {
                    "filename": original_name,
                    "description": _clean_json_value(desc),
                    "slots": slot_rows,
                }
            )

        return {
            "files": file_results,
            "slots": [combined[key] for key in sorted(combined)],
            "logical_inputs": [
                {"logical_name": name, "default_slot": name, "group": INPUT_GROUPS.get(name, "Other")}
                for name in REQUIRED_INPUTS
            ],
        }


def _explorer_trace_defaults(trace_numbers: list[int]) -> list[dict[str, Any]]:
    """Classify all traces for plotting without changing calculation membership.

    RiverWare runs used by CRMMS place the 30 hydrologic ensemble members last.
    Any preceding 2-3 traces are deterministic Min/Most or Max/Min/Most runs.
    This classification is application/UI metadata only; rdf_reader.py continues
    to preserve the actual RiverWare trace numbers unchanged.
    """
    ordered: list[int] = []
    seen_numbers: set[int] = set()
    for value in trace_numbers:
        number = int(value)
        if number not in seen_numbers:
            seen_numbers.add(number)
            ordered.append(number)
    ensemble = ordered[-30:] if len(ordered) >= 30 else ordered
    deterministic = ordered[:-30] if len(ordered) > 30 else []
    det_names: dict[int, str] = {}
    if len(deterministic) == 3:
        labels = ["Max", "Min", "Most"]
    elif len(deterministic) == 2:
        labels = ["Min", "Most"]
    elif len(deterministic) == 1:
        labels = ["Most"]
    else:
        labels = [f"Aux {number}" for number in deterministic]
    for number, label in zip(deterministic, labels):
        det_names[number] = label

    out: list[dict[str, Any]] = []
    for number in ordered:
        if number in det_names:
            role = "deterministic"
            label = det_names[number]
            calculation_default = False
        else:
            role = "ensemble"
            esp = trace_to_esp(number)
            label = str(esp) if esp is not None else f"Trace {number}"
            calculation_default = number in ensemble
        out.append({
            "trace_number": number,
            "default_label": label,
            "role": role,
            "calculation_default": calculation_default,
            "plot_default": role != "deterministic",
        })
    return out


def _build_explorer_payload(frames: list[pd.DataFrame], slot: str, run_label: str) -> dict[str, Any] | None:
    """Build the browser payload for one slot without repeated Python row scans.

    The previous implementation converted the entire frame to a list of Python
    dictionaries and then performed de-duplication in Python. During Explorer
    preload this ran once per slot, which made small RDF sessions noticeably slow.

    We now use pandas for duplicate detection and de-duplication, then convert
    only the already-reduced rows to dictionaries once. This preserves the prior
    semantics: duplicate trace/timestep rows are allowed when their values agree,
    conflicting values raise a clear error, and the first source-file occurrence
    wins when duplicate rows are identical.
    """
    if not frames:
        return None

    data = pd.concat(frames, ignore_index=True).copy()
    data["__trace_key"] = pd.to_numeric(data["trace_number"], errors="raise").astype(int)
    data["__timestep_key"] = data["timestep"].fillna("").astype(str)
    data["__value_key"] = pd.to_numeric(data["value"], errors="coerce")

    grouped = data.groupby(["__trace_key", "__timestep_key"], sort=False, dropna=False)["__value_key"]
    distinct_non_null = grouped.transform("nunique", dropna=True)
    value_count = grouped.transform("count")
    row_count = grouped.transform("size")
    conflict_mask = (distinct_non_null > 1) | ((value_count > 0) & (value_count < row_count))

    if conflict_mask.any():
        conflict_rows = data.loc[conflict_mask].copy()
        first_key = conflict_rows[["__trace_key", "__timestep_key"]].iloc[0]
        matching = conflict_rows[
            (conflict_rows["__trace_key"] == first_key["__trace_key"])
            & (conflict_rows["__timestep_key"] == first_key["__timestep_key"])
        ].head(2)
        first = matching.iloc[0]
        second = matching.iloc[1] if len(matching) > 1 else first

        def comparable_value(value: Any) -> float | None:
            if value is None or pd.isna(value):
                return None
            return float(value)

        trace_number = int(first["__trace_key"])
        timestep = str(first["__timestep_key"])
        first_value = comparable_value(first["value"])
        second_value = comparable_value(second["value"])
        first_file = str(first.get("_source_file") or "")
        second_file = str(second.get("_source_file") or "")
        raise HTTPException(
            status_code=422,
            detail=f"Conflicting RDF values for '{slot}', Trace {trace_number}, timestep '{timestep}': {first_value} in {first_file} vs {second_value} in {second_file}.",
        )

    keep = ~data.duplicated(subset=["__trace_key", "__timestep_key"], keep="first")
    data = data.loc[keep].copy()
    keep_rows = data.drop(columns=["__trace_key", "__timestep_key", "__value_key"]).to_dict(orient="records")

    def clean_num(value: Any) -> float | int | None:
        if value is None or pd.isna(value):
            return None
        if isinstance(value, bool):
            return int(value)
        try:
            number = float(value)
            return int(number) if number.is_integer() else number
        except Exception:
            return None

    traces: dict[int, list[dict[str, Any]]] = {}
    unit_values: list[str] = []
    timestep_types: list[str] = []
    scales: list[float] = []
    for rec in keep_rows:
        number = int(rec["trace_number"])
        unit = str(rec.get("unit") or "").strip()
        ttype = str(rec.get("timestep_type") or "").strip().lower()
        scale = clean_num(rec.get("scale"))
        if unit and unit not in unit_values:
            unit_values.append(unit)
        if ttype and ttype not in timestep_types:
            timestep_types.append(ttype)
        if scale is not None and float(scale) not in scales:
            scales.append(float(scale))
        period_date = rec.get("period_date")
        traces.setdefault(number, []).append({
            "timestep": str(rec.get("timestep") or ""),
            "period_date": None if period_date is None or pd.isna(period_date) else str(period_date),
            "year": None if pd.isna(rec.get("year")) else int(rec.get("year")),
            "month": None if pd.isna(rec.get("month")) else int(rec.get("month")),
            "day": None if pd.isna(rec.get("day")) else int(rec.get("day")),
            "timestep_index": None if pd.isna(rec.get("timestep_index")) else int(rec.get("timestep_index")),
            "value": clean_num(rec.get("value")),
            "raw_value": clean_num(rec.get("raw_value")),
            "scale": scale,
            "source_file": str(rec.get("_source_file") or ""),
        })

    for values in traces.values():
        values.sort(key=lambda row: (
            row["year"] if row["year"] is not None else 9999,
            row["month"] if row["month"] is not None else 13,
            row["day"] if row["day"] is not None else 32,
            row["timestep_index"] if row["timestep_index"] is not None else 999999,
        ))

    trace_numbers = list(traces.keys())
    defaults = {x["trace_number"]: x for x in _explorer_trace_defaults(trace_numbers)}
    return {
        "label": run_label,
        "slot": slot,
        "units": unit_values,
        "scales": scales,
        "timestep_types": timestep_types,
        "source_files": sorted({str(rec.get("_source_file") or "") for rec in keep_rows}),
        "trace_numbers": trace_numbers,
        "traces": [{**defaults[number], "values": traces[number]} for number in trace_numbers],
    }


def _explorer_run_payload(paths: list[Path], original_names: list[str], slot: str, run_label: str, inspection: dict[str, Any] | None = None) -> dict[str, Any] | None:
    frames: list[pd.DataFrame] = []
    source_by_path = {Path(path): name for path, name in zip(paths, original_names)}
    known_files: set[str] | None = None
    if inspection is not None:
        known_files = {str(x) for rec in inspection.get("slots", []) if str(rec.get("object_slot")) == slot for x in rec.get("files", [])}
    for path in paths:
        if known_files is not None:
            if source_by_path[path] not in known_files:
                continue
        else:
            try:
                slots = list_rdf_slots(path)
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"Could not inspect RDF file '{source_by_path[path]}': {exc}") from exc
            available = {str(x) for x in slots["object_slot"].tolist()}
            if slot not in available:
                continue
        try:
            frame = read_rdf(path, slots=[slot], traces=None, add_esp_year=False, strict_slots=True, apply_scale=True)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not read '{slot}' from RDF file '{source_by_path[path]}': {exc}") from exc
        if not frame.empty:
            frame = frame.copy()
            frame["_source_file"] = source_by_path[path]
            frames.append(frame)
    return _build_explorer_payload(frames, slot, run_label)


def _parse_preload_config(raw: str | None) -> dict[str, list[str]]:
    if not raw:
        return {k: list(v) for k, v in DEFAULT_EXPLORER_PRELOAD.items()}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Explorer preload configuration is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Explorer preload configuration must be a JSON object.")
    patterns = payload.get("patterns", DEFAULT_EXPLORER_PRELOAD["patterns"])
    all_files = payload.get("all_slots_files", DEFAULT_EXPLORER_PRELOAD["all_slots_files"])
    if not isinstance(patterns, list) or not isinstance(all_files, list):
        raise HTTPException(status_code=400, detail="Explorer preload patterns and all_slots_files must be arrays.")
    return {
        "patterns": [str(x).strip() for x in patterns if str(x).strip()][:100],
        "all_slots_files": [Path(str(x).strip()).name.lower() for x in all_files if str(x).strip()][:40],
    }


def _inspect_saved_run(paths: list[Path], original_names: list[str]) -> dict[str, Any] | None:
    if not paths:
        return None
    file_results: list[dict[str, Any]] = []
    combined: dict[str, dict[str, Any]] = {}
    for path, original_name in zip(paths, original_names):
        try:
            # Single-pass RDF discovery. Previously describe_rdf() and
            # list_rdf_slots() each triggered their own complete scan.
            desc, slots = inspect_rdf_file(path)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not parse RDF file '{original_name}': {exc}") from exc
        slot_rows = []
        for rec in slots.to_dict(orient="records"):
            clean = _clean_json_value(rec)
            clean["file"] = original_name
            slot_rows.append(clean)
            slot = str(rec["object_slot"])
            bucket = combined.setdefault(slot, {"object_slot": slot, "files": [], "units": [], "scales": [], "timestep_types": [], "trace_count_max": 0})
            if original_name not in bucket["files"]:
                bucket["files"].append(original_name)
            for field, out_field in (("units", "units"), ("scales", "scales"), ("timestep_types", "timestep_types")):
                for value in rec.get(field) or ():
                    value = _clean_json_value(value)
                    if value not in bucket[out_field]:
                        bucket[out_field].append(value)
            bucket["trace_count_max"] = max(bucket["trace_count_max"], int(rec.get("trace_count") or 0))
        file_results.append({"filename": original_name, "description": _clean_json_value(desc), "slots": slot_rows})
    return {"files": file_results, "slots": [combined[key] for key in sorted(combined)]}


def _preload_slots_for_run(inspection: dict[str, Any] | None, config: dict[str, list[str]]) -> set[str]:
    if not inspection:
        return set()
    patterns = [x.lower() for x in config.get("patterns", [])]
    all_files = set(config.get("all_slots_files", []))
    out: set[str] = set()
    for rec in inspection.get("slots", []):
        slot = str(rec.get("object_slot") or "")
        slot_l = slot.lower()
        files = {Path(str(x)).name.lower() for x in rec.get("files", [])}
        if any(fnmatch.fnmatchcase(slot_l, pattern) for pattern in patterns) or files.intersection(all_files):
            out.add(slot)
    return out


def _preload_run_cache(paths: list[Path], names: list[str], inspection: dict[str, Any] | None, slots: set[str], run_label: str) -> dict[str, Any]:
    cache: dict[str, Any] = {}
    if not paths or not slots:
        return cache
    frames_by_slot: dict[str, list[pd.DataFrame]] = {slot: [] for slot in slots}
    for path, original_name in zip(paths, names):
        file_slots = set()
        for file_rec in (inspection or {}).get("files", []):
            if file_rec.get("filename") == original_name:
                file_slots = {str(x.get("object_slot")) for x in file_rec.get("slots", [])}
                break
        wanted = sorted(slots.intersection(file_slots))
        if not wanted:
            continue
        try:
            frame = read_rdf(path, slots=wanted, traces=None, add_esp_year=False, strict_slots=False, apply_scale=True)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not preload RDF file '{original_name}': {exc}") from exc
        if frame.empty:
            continue
        frame = frame.copy()
        frame["_source_file"] = original_name
        for slot, group in frame.groupby("object_slot", sort=False):
            if str(slot) in frames_by_slot:
                frames_by_slot[str(slot)].append(group.copy())
    for slot, frames in frames_by_slot.items():
        payload = _build_explorer_payload(frames, slot, run_label)
        if payload is not None:
            cache[slot] = payload
    return cache


@app.post("/api/rdf/session")
async def create_rdf_session(
    current_label: str = Form("Run A"),
    previous_label: str = Form("Run B"),
    preload_json: str = Form(""),
    current_files: list[UploadFile] | None = File(None),
    previous_files: list[UploadFile] | None = File(None),
) -> dict[str, Any]:
    current_uploads = list(current_files or [])
    previous_uploads = list(previous_files or [])
    if not current_uploads and not previous_uploads:
        raise HTTPException(status_code=400, detail="Select at least one RDF run before discovering slots.")
    _cleanup_explorer_sessions()
    root = Path(tempfile.mkdtemp(prefix="crmms-rdf-session-"))
    session_started = time.perf_counter()

    try:
        current_paths: list[Path] = []
        current_names: list[str] = []
        previous_paths: list[Path] = []
        previous_names: list[str] = []

        if current_uploads:
            current_paths, current_names = await _save_rdf_uploads(current_uploads, root / "run-a", "Run A")

        if previous_uploads:
            previous_paths, previous_names = await _save_rdf_uploads(previous_uploads, root / "run-b", "Run B")

        inspection_started = time.perf_counter()

        current_inspection = _inspect_saved_run(
            current_paths,
            current_names,
        )
        previous_inspection = _inspect_saved_run(
            previous_paths,
            previous_names,
        )

        inspection_seconds = time.perf_counter() - inspection_started

        preload = _parse_preload_config(preload_json)
        current_preload = _preload_slots_for_run(
            current_inspection,
            preload,
        )
        previous_preload = _preload_slots_for_run(
            previous_inspection,
            preload,
        )

        preload_started = time.perf_counter()

        current_cache = _preload_run_cache(
            current_paths,
            current_names,
            current_inspection,
            current_preload,
            current_label,
        )
        previous_cache = _preload_run_cache(
            previous_paths,
            previous_names,
            previous_inspection,
            previous_preload,
            previous_label,
        )

        preload_seconds = time.perf_counter() - preload_started

        cache = {
            "current": current_cache,
            "previous": previous_cache,
        }
        session_id = uuid.uuid4().hex
        _EXPLORER_SESSIONS[session_id] = {
            "root": str(root), "created": time.time(), "last_access": time.time(),
            "current_paths": current_paths, "current_names": current_names,
            "previous_paths": previous_paths, "previous_names": previous_names,
            "current_label": current_label, "previous_label": previous_label,
            "inspection": {"current": current_inspection, "previous": previous_inspection},
            "cache": cache, "preload": preload,
        }

        return {
            "session_id": session_id,
            "current": current_inspection,
            "previous": previous_inspection,
            "preload": preload,
            "preloaded": {
                "current": sorted(cache["current"]),
                "previous": sorted(cache["previous"]),
            },
            "performance": {
                "inspection_seconds": round(inspection_seconds, 3),
                "preload_seconds": round(preload_seconds, 3),
                "total_seconds": round(
                    time.perf_counter() - session_started,
                    3,
                ),
            },
        }

    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise


@app.get("/api/rdf/session/{session_id}/slot")
def get_rdf_session_slot(session_id: str, slot: str) -> dict[str, Any]:
    _cleanup_explorer_sessions()
    session = _EXPLORER_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Explorer session expired. Discover the RDF files again.")
    slot = str(slot or "").strip()
    if not slot:
        raise HTTPException(status_code=400, detail="Choose an RDF Object.Slot to explore.")
    session["last_access"] = time.time()
    for run_key in ("current", "previous"):
        if slot not in session["cache"][run_key]:
            paths = session[f"{run_key}_paths"]
            names = session[f"{run_key}_names"]
            label = session[f"{run_key}_label"]
            payload = _explorer_run_payload(paths, names, slot, label, session["inspection"].get(run_key)) if paths else None
            if payload is not None:
                session["cache"][run_key][slot] = payload
    current = session["cache"]["current"].get(slot)
    previous = session["cache"]["previous"].get(slot)
    if current is None and previous is None:
        raise HTTPException(status_code=404, detail=f"Object.Slot '{slot}' was not found in this Explorer session.")
    union_traces: list[int] = []
    for run in (current, previous):
        for number in (run or {}).get("trace_numbers", []):
            if int(number) not in union_traces:
                union_traces.append(int(number))
    return {
        "slot": slot, "current": current, "previous": previous,
        "trace_defaults": _explorer_trace_defaults(union_traces),
        "calculation_trace_defaults": [x["trace_number"] for x in _explorer_trace_defaults(union_traces) if x["calculation_default"]],
        "cached": {
            "current": slot in session["cache"]["current"],
            "previous": slot in session["cache"]["previous"],
        },
        "note": "Explorer session reuses saved RDF files and caches loaded slots. The last 30 traces are classified as ensemble members; preceding 2-3 traces are deterministic plot-only runs by default.",
    }

# Batched Explorer slot loading.


def _batched_explorer_run_payloads(
    paths: list["Path"],
    original_names: list[str],
    slots: list[str],
    run_label: str,
    inspection: dict | None = None,
) -> dict[str, dict]:
    """Build Explorer payloads for MANY slots from ONE read_rdf() call per file.

    Mirrors _explorer_run_payload()'s per-slot output shape exactly, so the
    existing frontend code (getExplorerSlotPayload / _build_explorer_payload
    consumers) needs no changes -- each returned dict is identical to what
    the single-slot endpoint would have produced for that slot.
    """
    if not paths or not slots:
        return {}

    # Collect per-slot dataframes across all files, then run the existing
    # _build_explorer_payload() per slot exactly as the single-slot path does.
    # The only change is that each FILE is parsed once for ALL slots, instead
    # of once per (file, slot) pair.
    frames_by_slot: dict[str, list] = {slot: [] for slot in slots}
    source_by_path = {Path(path): name for path, name in zip(paths, original_names)}

    for path in paths:
        # Determine which of the requested slots actually live in this file,
        # using the already-computed inspection metadata when available (this
        # avoids a throwaway list_rdf_slots() scan on top of the real read).
        if inspection is not None:
            file_slot_sets = {
                str(rec.get("object_slot")): {str(x) for x in rec.get("files", [])}
                for rec in inspection.get("slots", [])
            }
            wanted_here = [
                slot for slot in slots
                if source_by_path[path] in file_slot_sets.get(slot, set())
            ]
        else:
            try:
                available = {str(x) for x in list_rdf_slots(path)["object_slot"].tolist()}
            except Exception as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Could not inspect RDF file '{source_by_path[path]}': {exc}",
                ) from exc
            wanted_here = [slot for slot in slots if slot in available]

        if not wanted_here:
            continue

        try:
            # THE key change: one read_rdf() call for every wanted slot in
            # this file, instead of one call per slot.
            frame = read_rdf(
                path,
                slots=wanted_here,
                traces=None,
                add_esp_year=False,
                strict_slots=False,
                apply_scale=True,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Could not read slots from RDF file '{source_by_path[path]}': {exc}",
            ) from exc

        if frame.empty:
            continue

        frame = frame.copy()
        frame["_source_file"] = source_by_path[path]
        for slot_name, group in frame.groupby("object_slot", sort=False):
            if str(slot_name) in frames_by_slot:
                frames_by_slot[str(slot_name)].append(group.copy())

    payloads: dict[str, dict] = {}
    for slot in slots:
        frames = frames_by_slot.get(slot) or []
        payload = _build_explorer_payload(frames, slot, run_label)
        if payload is not None:
            payloads[slot] = payload
    return payloads


@app.get("/api/rdf/session/{session_id}/slots")
def get_rdf_session_slots_batch(session_id: str, names: str) -> dict[str, Any]:
    """Batched counterpart to /api/rdf/session/{id}/slot.

    `names` is a comma-separated list of exact Object.Slot names. Returns the
    same per-slot payload shape as the single-slot endpoint, keyed by slot
    name, for both current and previous runs. Slots already cached in this
    session are reused; only uncached slots trigger a (single, combined)
    file read per run.
    """
    _cleanup_explorer_sessions()
    session = _EXPLORER_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Explorer session expired. Discover the RDF files again.")

    requested = [s.strip() for s in (names or "").split(",") if s.strip()]
    if not requested:
        raise HTTPException(status_code=400, detail="Provide at least one Object.Slot name in 'names'.")

    session["last_access"] = time.time()

    for run_key in ("current", "previous"):
        missing = [slot for slot in requested if slot not in session["cache"][run_key]]
        if not missing:
            continue
        paths = session[f"{run_key}_paths"]
        names_list = session[f"{run_key}_names"]
        label = session[f"{run_key}_label"]
        if not paths:
            continue
        fresh = _batched_explorer_run_payloads(
            paths, names_list, missing, label, session["inspection"].get(run_key)
        )
        session["cache"][run_key].update(fresh)

    result: dict[str, Any] = {}
    missing_everywhere: list[str] = []
    for slot in requested:
        current = session["cache"]["current"].get(slot)
        previous = session["cache"]["previous"].get(slot)
        if current is None and previous is None:
            missing_everywhere.append(slot)
            continue
        union_traces: list[int] = []
        for run in (current, previous):
            for number in (run or {}).get("trace_numbers", []):
                if int(number) not in union_traces:
                    union_traces.append(int(number))
        result[slot] = {
            "slot": slot,
            "current": current,
            "previous": previous,
            "trace_defaults": _explorer_trace_defaults(union_traces),
        }

    return {
        "slots": result,
        "missing": missing_everywhere,
        "note": "Batched read: each RDF file was parsed once for all requested slots that were not already cached.",
    }

@app.post("/api/rdf/explore")
async def explore_rdf(
    slot: str = Form(...),
    current_label: str = Form("Run A"),
    previous_label: str = Form("Run B"),
    current_files: list[UploadFile] | None = File(None),
    previous_files: list[UploadFile] | None = File(None),
) -> dict[str, Any]:
    """Return raw slot values for interactive exploration.

    This endpoint deliberately reads all trace numbers present in the selected
    slot. Calculation trace selection remains a separate CRMMS report setting,
    so deterministic Max/Min/Most traces can be explored without entering
    report calculations.
    """
    slot = str(slot or "").strip()
    if not slot:
        raise HTTPException(status_code=400, detail="Choose an RDF Object.Slot to explore.")
    current_uploads = list(current_files or [])
    previous_uploads = list(previous_files or [])
    if not current_uploads and not previous_uploads:
        raise HTTPException(status_code=400, detail="Select at least one RDF run to explore.")

    with tempfile.TemporaryDirectory(prefix="crmms-rdf-explore-") as tmp:
        root = Path(tmp)
        current_paths: list[Path] = []
        current_names: list[str] = []
        previous_paths: list[Path] = []
        previous_names: list[str] = []
        if current_uploads:
            current_paths, current_names = await _save_rdf_uploads(current_uploads, root / "run-a", "Run A")
        if previous_uploads:
            previous_paths, previous_names = await _save_rdf_uploads(previous_uploads, root / "run-b", "Run B")
        current = _explorer_run_payload(current_paths, current_names, slot, current_label) if current_paths else None
        previous = _explorer_run_payload(previous_paths, previous_names, slot, previous_label) if previous_paths else None
        if current is None and previous is None:
            raise HTTPException(status_code=422, detail=f"The selected RDF files do not contain Object.Slot '{slot}'.")

    union_traces: list[int] = []
    for number in [*([] if current is None else current["trace_numbers"]), *([] if previous is None else previous["trace_numbers"])]:
        if number not in union_traces:
            union_traces.append(number)
    return {
        "slot": slot,
        "current": current,
        "previous": previous,
        "trace_defaults": _explorer_trace_defaults(union_traces),
        "calculation_trace_defaults": [x["trace_number"] for x in _explorer_trace_defaults(union_traces) if x["calculation_default"]],
        "note": "The last 30 traces are classified as hydrologic ensemble members for plotting metadata; any preceding 2-3 traces are classified as deterministic Max/Min/Most runs. Actual RDF trace numbers are preserved.",
    }


@app.post("/api/compare")
async def compare(
    source_format: str = Form("xlsx"),
    current_file: UploadFile | None = File(None),
    previous_file: UploadFile | None = File(None),
    current_files: list[UploadFile] | None = File(None),
    previous_files: list[UploadFile] | None = File(None),
    slot_mapping_json: str = Form("{}"),
    selected_inputs_json: str = Form(""),
    custom_slots_json: str = Form("[]"),
    custom_slot_statistic: str = Form("median"),
    custom_plots_json: str = Form("[]"),
    trace_numbers: str = Form("4-33"),
    add_esp_year: bool = Form(True),
    eocy_year: int = Form(2026),
    eocy_month: int = Form(12),
    powell_operating_year: int = Form(2027),
    comparison_years: str = Form("2026,2027,2028,2029,2030"),
    release_years: str = Form("2027,2028,2029"),
    mead_jan1_years: str = Form("2027,2028,2029,2030"),
    powell_plot_years: str = Form("2026,2027"),
    mead_plot_years: str = Form("2027,2028"),
    lower_basin_years: str = Form("2026,2027,2028,2029"),
    current_label: str = Form("Run A"),
    previous_label: str = Form("Run B"),
) -> dict[str, Any]:
    settings = _comparison_settings(
        eocy_year=eocy_year,
        eocy_month=eocy_month,
        powell_operating_year=powell_operating_year,
        comparison_years=comparison_years,
        release_years=release_years,
        mead_jan1_years=mead_jan1_years,
        powell_plot_years=powell_plot_years,
        mead_plot_years=mead_plot_years,
        lower_basin_years=lower_basin_years,
        current_label=current_label,
        previous_label=previous_label,
        trace_numbers=trace_numbers,
        add_esp_year=add_esp_year,
    )

    fmt = source_format.strip().lower()
    try:
        if fmt == "xlsx":
            if current_file is None or previous_file is None:
                raise HTTPException(status_code=400, detail="One .xlsx file is required for each run.")
            current_payload = await _read_xlsx_upload(current_file, "Run A file")
            previous_payload = await _read_xlsx_upload(previous_file, "Run B file")
            result = compare_workbooks(current_payload, previous_payload, settings)
            current_names = [current_file.filename or "RunA.xlsx"]
            previous_names = [previous_file.filename or "RunB.xlsx"]
        elif fmt == "rdf":
            current_uploads = list(current_files or [])
            previous_uploads = list(previous_files or [])
            slot_mapping = _parse_slot_mapping(slot_mapping_json)
            selected_inputs = _parse_selected_inputs(selected_inputs_json)
            selected_set = set(selected_inputs)
            custom_slots = _parse_custom_slots(custom_slots_json)
            custom_statistic = _parse_custom_statistic(custom_slot_statistic)
            custom_plots = _parse_custom_plots(custom_plots_json)
            # An unchecked logical input is intentionally unavailable to the
            # report layer. Blank mappings already have graceful section-level
            # omission semantics in the comparison engine.
            for logical in REQUIRED_INPUTS:
                if logical not in selected_set:
                    slot_mapping[logical] = ""
            with tempfile.TemporaryDirectory(prefix="crmms-rdf-compare-") as tmp:
                root = Path(tmp)
                current_paths, current_names = await _save_rdf_uploads(current_uploads, root / "run-a", "Run A")
                previous_paths, previous_names = await _save_rdf_uploads(previous_uploads, root / "run-b", "Run B")
                result = compare_rdf_files(
                    current_paths,
                    previous_paths,
                    settings,
                    slot_mapping,
                    custom_slots=custom_slots,
                    custom_slot_statistic=custom_statistic,
                    custom_plots=custom_plots,
                )
        else:
            raise HTTPException(status_code=400, detail="source_format must be either 'rdf' or 'xlsx'.")
    except ComparisonError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if fmt == "rdf":
        selected_inputs = _parse_selected_inputs(selected_inputs_json)
        selected_set = set(selected_inputs)
        excluded_inputs = [name for name in REQUIRED_INPUTS if name not in selected_set]
        missing_selected = [name for name in result["meta"].get("missing_inputs", []) if name in selected_set]
        result["meta"]["selected_inputs"] = selected_inputs
        result["meta"]["selected_input_count"] = len(selected_inputs)
        result["meta"]["excluded_inputs"] = excluded_inputs
        result["meta"]["excluded_input_count"] = len(excluded_inputs)
        result["meta"]["custom_input_selection"] = bool(excluded_inputs)
        result["meta"]["missing_selected_inputs"] = missing_selected
        result["meta"]["missing_selected_input_count"] = len(missing_selected)
        result["meta"]["available_selected_input_count"] = len(selected_inputs) - len(missing_selected)
        for skipped in result["meta"].get("skipped_sections", []):
            inputs = set(skipped.get("inputs") or [])
            skipped["omission_type"] = "excluded" if inputs.intersection(excluded_inputs) else "unavailable"
    else:
        result["meta"]["selected_inputs"] = list(REQUIRED_INPUTS)
        result["meta"]["selected_input_count"] = len(REQUIRED_INPUTS)
        result["meta"]["excluded_inputs"] = []
        result["meta"]["excluded_input_count"] = 0
        result["meta"]["custom_input_selection"] = False
        result["meta"]["missing_selected_inputs"] = result["meta"].get("missing_inputs", [])
        result["meta"]["missing_selected_input_count"] = len(result["meta"]["missing_selected_inputs"])
        result["meta"]["available_selected_input_count"] = result["meta"].get("available_input_count", len(REQUIRED_INPUTS))

    if fmt != "rdf":
        result["custom_slot_tables"] = []
        result["meta"]["custom_slots"] = []
        result["meta"]["custom_slot_statistic"] = "median"
        result["meta"]["custom_slot_count"] = 0
        result["meta"]["custom_slot_available_count"] = 0
        result["meta"]["custom_slot_skipped"] = []
        result["meta"]["custom_slot_skipped_count"] = 0
        result["custom_slot_plots"] = []
        result["meta"]["custom_plot_count"] = 0
        result["meta"]["custom_plot_skipped"] = []
        result["meta"]["custom_plot_skipped_count"] = 0

    result["meta"]["source_format"] = fmt
    result["meta"]["current_filenames"] = current_names
    result["meta"]["previous_filenames"] = previous_names
    result["meta"]["current_filename"] = "; ".join(current_names)
    result["meta"]["previous_filename"] = "; ".join(previous_names)
    result["meta"]["app_version"] = APP_VERSION
    return result


def _report_settings(payload: dict[str, Any]) -> ReportSettings:
    table_titles = {
        str(k): str(v)[:500]
        for k, v in (payload.get("table_titles") or {}).items()
        if str(k).strip() and str(v).strip()
    }
    table_subtitles = {
        str(k): str(v)[:2000]
        for k, v in (payload.get("table_subtitles") or {}).items()
        if str(k).strip()
    }
    table_years: dict[str, list[str]] = {}
    for key, values in (payload.get("table_years") or {}).items():
        if not isinstance(values, list):
            continue
        cleaned = []
        for value in values:
            text_value = str(value).strip()
            if re.fullmatch(r"20\d{2}|21\d{2}", text_value) and text_value not in cleaned:
                cleaned.append(text_value)
        table_years[str(key)] = cleaned
    return ReportSettings(
        report_title=str(payload.get("report_title") or "CRMMS ESP Summary")[:160],
        report_period=str(payload.get("report_period") or "")[:120],
        intro_text=str(payload.get("intro_text") or "")[:4000],
        assumptions=[str(x)[:1200] for x in payload.get("assumptions", []) if str(x).strip()][:40],
        table_notes={
            str(k): [str(x)[:1200] for x in v if str(x).strip()][:20]
            for k, v in (payload.get("table_notes") or {}).items()
            if isinstance(v, list)
        },
        included_tables=[str(x) for x in payload.get("included_tables", [])],
        included_plots=[str(x) for x in payload.get("included_plots", ["powell", "mead", "lower-basin"])],
        table_titles=table_titles,
        table_subtitles=table_subtitles,
        table_years=table_years,
        lower_basin_caption=str(payload.get("lower_basin_caption") or "")[:3000],
        include_metadata=bool(payload.get("include_metadata", False)),
        template_style=str(payload.get("template_style") or "standard")[:40],
        section_order=[str(x)[:300] for x in payload.get("section_order", []) if str(x).strip()][:200],
    )


@app.post("/api/report/plots")
def report_plots(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    result = payload.get("result")
    if not isinstance(result, dict) or "flow_analysis" not in result or "meta" not in result:
        raise HTTPException(status_code=400, detail="A valid comparison result is required.")
    caption = str(payload.get("lower_basin_caption") or "")[:3000] or None
    try:
        plots = render_all_plots(result, caption)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not render report plots: {exc}") from exc
    return {
        "plots": {
            key: "data:image/png;base64," + base64.b64encode(value).decode("ascii")
            for key, value in plots.items()
        }
    }


@app.post("/api/report")
def generate_report(payload: dict[str, Any] = Body(...)) -> StreamingResponse:
    result = payload.get("result")
    if not isinstance(result, dict) or not {"meta", "summary", "tables", "flow_analysis"}.issubset(result):
        raise HTTPException(status_code=400, detail="A valid comparison result is required.")
    settings = _report_settings(payload.get("settings") or {})
    try:
        document = build_report(result, settings)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not build Word report: {exc}") from exc
    safe_period = re.sub(r"[^A-Za-z0-9_-]+", "-", settings.report_period.strip()).strip("-")
    filename = f"CRMMS-ESP-Summary_{safe_period or result['meta'].get('eocy_year', 'Report')}.docx"
    return StreamingResponse(
        BytesIO(document),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
