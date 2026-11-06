from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
from math import isnan
import hashlib
import re
import statistics
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils.datetime import from_excel

from .rdf_reader import list_rdf_slots, read_rdf, trace_to_esp


DEFAULT_TRACE_NUMBERS = tuple(range(4, 34))

# These are logical inputs used by the CRMMS report. For Excel they are worksheet
# names. For RDF they are caller-configurable mappings to exact Object.Slot names.
REQUIRED_INPUTS = (
    "Powell.Pool Elevation",
    "Mead.Pool Elevation",
    "PowellData.ReleaseTier",
    "UpperBalancingAt823",
    "PowellTargetAnnualReleaseVolume",
    "PowellConstrained3500Bypass",
    "PowellConstrained3500Less748",
    "Powell3525Annual",
    "Powell3490Annual",
    "DCPBWSP_Type",
    "AnnualShortageAnyTypeFlag",
    "MeadData.MeadBelow1035_Annual",
    "MeadData.MeadBelow1000_Annual",
    "MeadData.MeadBelow950_Annual",
    "MeadData.MeadBelow895_Annual",
    "PowellAJUnregInflow",
    "Mead.Inflow",
    "Mead.Outflow",
    "Shortage.Shortage Flag",
    "Surplus.AnnualSurplusFlag",
)

# Binary annual report inputs exported in RiverWare flag RDFs.  In RDF mode
# these are compared as the sum of their 0/1 values across the selected traces
# for each calendar year.  Excel mode keeps the legacy percentage behavior.
ANNUAL_BINARY_FLAG_INPUTS = frozenset({
    "PowellConstrained3500Bypass",
    "PowellConstrained3500Less748",
    "Powell3525Annual",
    "Powell3490Annual",
    "AnnualShortageAnyTypeFlag",
    "MeadData.MeadBelow1035_Annual",
    "MeadData.MeadBelow1000_Annual",
    "MeadData.MeadBelow950_Annual",
    "MeadData.MeadBelow895_Annual",
})

INPUT_GROUPS: dict[str, str] = {
    "Powell.Pool Elevation": "Powell",
    "PowellData.ReleaseTier": "Powell",
    "UpperBalancingAt823": "Powell",
    "PowellTargetAnnualReleaseVolume": "Powell",
    "PowellConstrained3500Bypass": "Powell",
    "PowellConstrained3500Less748": "Powell",
    "Powell3525Annual": "Powell",
    "Powell3490Annual": "Powell",
    "PowellAJUnregInflow": "Powell",
    "Mead.Pool Elevation": "Mead",
    "DCPBWSP_Type": "Mead",
    "AnnualShortageAnyTypeFlag": "Mead",
    "MeadData.MeadBelow1035_Annual": "Mead",
    "MeadData.MeadBelow1000_Annual": "Mead",
    "MeadData.MeadBelow950_Annual": "Mead",
    "MeadData.MeadBelow895_Annual": "Mead",
    "Mead.Inflow": "Mead",
    "Mead.Outflow": "Mead",
    "Shortage.Shortage Flag": "Mead",
    "Surplus.AnnualSurplusFlag": "Mead",
}


class ComparisonError(ValueError):
    """Raised when uploaded CRMMS outputs cannot be compared."""


class SectionUnavailableError(ComparisonError):
    """Raised when one report section cannot be calculated from available data."""


@dataclass(frozen=True)
class ComparisonSettings:
    year1: int = 2026
    eocy_year: int = 2026
    eocy_month: int = 12
    powell_operating_year: int = 2027
    current_label: str = "Run A"
    previous_label: str = "Run B"
    comparison_years: tuple[int, ...] = ()
    release_years: tuple[int, ...] = ()
    mead_jan1_years: tuple[int, ...] = ()
    powell_plot_years: tuple[int, ...] = ()
    mead_plot_years: tuple[int, ...] = ()
    lower_basin_years: tuple[int, ...] = ()
    trace_numbers: tuple[int, ...] = DEFAULT_TRACE_NUMBERS
    add_esp_year: bool = True

    @property
    def years(self) -> list[int]:
        return list(self.comparison_years) if self.comparison_years else [self.year1 + i for i in range(5)]

    @property
    def later_years(self) -> list[int]:
        if self.mead_jan1_years:
            return list(self.mead_jan1_years)
        return self.years[1:]

    @property
    def release_table_years(self) -> list[int]:
        if self.release_years:
            return list(self.release_years)
        return [self.powell_operating_year + i for i in range(3)]

    @property
    def powell_chart_years(self) -> list[int]:
        if self.powell_plot_years:
            return list(self.powell_plot_years)
        return self.years[:2]

    @property
    def mead_chart_years(self) -> list[int]:
        if self.mead_plot_years:
            return list(self.mead_plot_years)
        return self.years[1:3]

    @property
    def basin_chart_years(self) -> list[int]:
        return list(self.lower_basin_years) if self.lower_basin_years else self.years

    @property
    def eocy_date(self) -> date:
        # CRMMS monthly data are addressed by year/month. Readers normalize
        # monthly RDF endpoints to the first of the printed month without
        # modifying the generic RDF parser or its original timestep string.
        return date(self.eocy_year, self.eocy_month, 1)

    @property
    def trace_keys(self) -> tuple[str, ...]:
        return tuple(f"Trace{n}" for n in self.trace_numbers)


@dataclass
class SheetData:
    name: str
    rows: dict[date, dict[str, float | None]]
    unit: str | None = None
    units: tuple[str | None, ...] = ()
    scales: tuple[float, ...] = ()
    timestep_types: tuple[str | None, ...] = ()
    source_slot: str | None = None

    def row(self, target: date) -> dict[str, float | None]:
        if target in self.rows:
            return self.rows[target]
        # CRMMS report logic is period-based. Annual RDF inputs are keyed by
        # printed year only; monthly sources may use month-end while callers
        # address the period by month-start. Neither case shifts RiverWare's
        # original timestep text inside the generic reader.
        if {x for x in self.timestep_types if x} == {"annual"}:
            same_year = [d for d in self.rows if d.year == target.year]
            if len(same_year) == 1:
                return self.rows[same_year[0]]
        same_month = [d for d in self.rows if d.year == target.year and d.month == target.month]
        if len(same_month) == 1:
            return self.rows[same_month[0]]
        available = ", ".join(sorted(d.isoformat() for d in self.rows)[-8:])
        raise SectionUnavailableError(
            f"Input '{self.name}' does not contain {target.isoformat()}. "
            f"Recent available periods: {available or 'none'}."
        )


class WorkbookReader:
    source_type = "xlsx"

    def __init__(self, payload: bytes, label: str, trace_numbers: Iterable[int] = DEFAULT_TRACE_NUMBERS):
        self.label = label
        self.trace_numbers = tuple(int(x) for x in trace_numbers)
        self.trace_keys = tuple(f"Trace{x}" for x in self.trace_numbers)
        try:
            self.wb = load_workbook(BytesIO(payload), read_only=True, data_only=True)
        except Exception as exc:
            raise ComparisonError(f"{label} is not a readable .xlsx workbook: {exc}") from exc
        self._cache: dict[str, SheetData] = {}

    @property
    def sheetnames(self) -> list[str]:
        return list(self.wb.sheetnames)

    def require_sheets(self, names: Iterable[str]) -> None:
        missing = [name for name in names if name not in self.wb.sheetnames]
        if missing:
            raise SectionUnavailableError(
                f"{self.label} is missing required CRMMS sheet(s): {', '.join(missing)}"
            )

    def sheet(self, name: str) -> SheetData:
        if name in self._cache:
            return self._cache[name]
        if name not in self.wb.sheetnames:
            raise SectionUnavailableError(f"{self.label} is missing required CRMMS sheet '{name}'.")

        ws = self.wb[name]
        header_row_idx: int | None = None
        headers: list[Any] = []
        first_trace = self.trace_keys[0] if self.trace_keys else None
        for idx, row in enumerate(ws.iter_rows(min_row=1, max_row=min(ws.max_row, 12), values_only=True), start=1):
            if first_trace and first_trace in row:
                header_row_idx = idx
                headers = list(row)
                break
        if header_row_idx is None:
            raise SectionUnavailableError(f"Sheet '{name}' in {self.label} has no selected CRMMS trace header row.")

        trace_indexes: dict[str, int] = {}
        for trace in self.trace_keys:
            try:
                trace_indexes[trace] = headers.index(trace)
            except ValueError as exc:
                raise SectionUnavailableError(
                    f"Sheet '{name}' in {self.label} is missing trace column '{trace}'."
                ) from exc

        rows: dict[date, dict[str, float | None]] = {}
        for raw in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
            if not raw or raw[0] is None:
                continue
            key = _as_date(raw[0])
            if key is None:
                continue
            values: dict[str, float | None] = {}
            for trace, col_idx in trace_indexes.items():
                value = raw[col_idx] if col_idx < len(raw) else None
                values[trace] = _as_number(value)
            rows[key] = values

        data = SheetData(name=name, rows=rows, source_slot=name)
        self._cache[name] = data
        return data

    def annual_sum(self, name: str, year: int) -> dict[str, float]:
        data = self.sheet(name)
        matches = [row for d, row in data.rows.items() if d.year == year]
        if not matches:
            raise SectionUnavailableError(f"Sheet '{name}' in {self.label} has no rows for calendar year {year}.")
        totals = {trace: 0.0 for trace in self.trace_keys}
        for row in matches:
            for trace in self.trace_keys:
                value = row.get(trace)
                if value is not None:
                    totals[trace] += value
        return totals

    def source_metadata(self) -> dict[str, Any]:
        return {"source_type": "xlsx", "inputs": {name: {"source_slot": name} for name in REQUIRED_INPUTS}}


class RDFRunReader:
    """CRMMS application adapter around the unchanged generic rdf_reader.py.

    The generic reader stays responsible for parsing RDF structure, timestep
    metadata, trace numbers, units/scales and optional ESP enrichment. This
    adapter only maps logical report inputs to caller-selected Object.Slot names,
    combines multiple RDF files for one run, and normalizes period keys for the
    comparison calculations.
    """

    source_type = "rdf"

    def __init__(
        self,
        paths: Iterable[str | Path],
        label: str,
        *,
        trace_numbers: Iterable[int] = DEFAULT_TRACE_NUMBERS,
        slot_mapping: dict[str, str] | None = None,
        add_esp_year: bool = True,
        allow_missing_traces: bool = False,
    ):
        self.paths = tuple(Path(p) for p in paths)
        self.label = label
        self.trace_numbers = tuple(int(x) for x in trace_numbers)
        self.trace_keys = tuple(f"Trace{x}" for x in self.trace_numbers)
        self.slot_mapping = {str(k): str(v).strip() for k, v in (slot_mapping or {}).items()}
        self.add_esp_year = bool(add_esp_year)
        self.allow_missing_traces = bool(allow_missing_traces)
        self._cache: dict[str, SheetData] = {}
        self._slot_locations: dict[str, list[Path]] = {}
        self._slot_info: dict[str, list[dict[str, Any]]] = {}
        # Combined per-file frames. Reading every requested slot from a file in
        # one read_rdf() call avoids reparsing the whole RDF once per slot.
        self._frame_cache: dict[Path, pd.DataFrame] = {}
        self._loaded_slots: dict[Path, set[str]] = {}
        self._slot_read_errors: dict[str, tuple[Path, Exception]] = {}

        if not self.paths:
            raise ComparisonError(f"{label} requires at least one RDF file.")

        for path in self.paths:
            try:
                info = list_rdf_slots(path)
            except Exception as exc:
                raise ComparisonError(f"Could not inspect RDF file '{path.name}' for {label}: {exc}") from exc
            for rec in info.to_dict(orient="records"):
                slot = str(rec["object_slot"])
                self._slot_locations.setdefault(slot, []).append(path)
                cleaned = {
                    "file": path.name,
                    "units": _json_tuple(rec.get("units")),
                    "scales": _json_tuple(rec.get("scales")),
                    "timestep_types": _json_tuple(rec.get("timestep_types")),
                    "time_step_units": _json_tuple(rec.get("time_step_units")),
                    "trace_count": int(rec.get("trace_count") or 0),
                    "has_scalar": bool(rec.get("has_scalar")),
                }
                self._slot_info.setdefault(slot, []).append(cleaned)

    @property
    def available_slots(self) -> list[str]:
        return sorted(self._slot_locations)

    def require_sheets(self, names: Iterable[str]) -> None:
        missing_mapping: list[str] = []
        missing_slots: list[str] = []
        for logical in names:
            actual = self.slot_mapping.get(logical, logical).strip()
            if not actual:
                missing_mapping.append(logical)
            elif actual not in self._slot_locations:
                missing_slots.append(f"{logical} -> {actual}")
        if missing_mapping:
            raise SectionUnavailableError(
                f"{self.label} has no RDF slot mapping for: {', '.join(missing_mapping)}"
            )
        if missing_slots:
            raise SectionUnavailableError(
                f"{self.label} RDF files do not contain the mapped Object.Slot(s): {', '.join(missing_slots)}"
            )

    def preload(self, slots: Iterable[str]) -> None:
        """Read all requested Object.Slots with one read per RDF file.

        The comparison engine knows every mapped slot before it starts
        calculating sections. Preloading them together avoids the previous
        behavior of scanning the same file once for each slot.
        """
        requested: list[str] = []
        seen: set[str] = set()
        for value in slots:
            slot = str(value or "").strip()
            if slot and slot not in seen:
                seen.add(slot)
                requested.append(slot)
        if requested:
            self._ensure_frames(requested)

    def _ensure_frames(self, slots: Iterable[str]) -> None:
        """Ensure cached frames contain the requested slots for every file."""
        wanted_by_path: dict[Path, set[str]] = {}
        for value in slots:
            slot = str(value or "").strip()
            if not slot:
                continue
            for path in self._slot_locations.get(slot, []):
                wanted_by_path.setdefault(path, set()).add(slot)

        for path, wanted in wanted_by_path.items():
            already = self._loaded_slots.setdefault(path, set())
            missing = wanted - already
            # A failed slot stays failed for this reader; sheet() reports the
            # original file-specific error when that slot is actually used.
            missing = {slot for slot in missing if slot not in self._slot_read_errors}
            if not missing:
                continue

            try:
                # Read every trace present in this file first. Filtering after
                # concatenation allows a logical slot to be split across RDFs.
                frame = read_rdf(
                    path,
                    slots=sorted(missing),
                    traces=None,
                    add_esp_year=self.add_esp_year,
                    strict_slots=True,
                    apply_scale=True,
                )
            except Exception:
                # A malformed slot should not make an otherwise usable report
                # fail during a bulk preload. Fall back to individual reads so
                # only sections that actually use the bad slot are affected.
                for slot in sorted(missing):
                    if slot in self._slot_read_errors:
                        continue
                    try:
                        frame = read_rdf(
                            path,
                            slots=[slot],
                            traces=None,
                            add_esp_year=self.add_esp_year,
                            strict_slots=True,
                            apply_scale=True,
                        )
                    except Exception as exc:
                        self._slot_read_errors[slot] = (path, exc)
                        already.add(slot)
                        continue
                    self._merge_frame(path, frame)
                    already.add(slot)
                continue

            self._merge_frame(path, frame)
            already.update(missing)

    def _merge_frame(self, path: Path, frame: pd.DataFrame) -> None:
        if frame.empty:
            return
        frame = frame.copy()
        frame["_source_file"] = path.name
        existing = self._frame_cache.get(path)
        if existing is not None and not existing.empty:
            frame = pd.concat([existing, frame], ignore_index=True)
        self._frame_cache[path] = frame

    def sheet(self, logical_name: str) -> SheetData:
        if logical_name in self._cache:
            return self._cache[logical_name]
        actual_slot = self.slot_mapping.get(logical_name, logical_name).strip()
        locations = self._slot_locations.get(actual_slot, [])
        if not locations:
            raise SectionUnavailableError(
                f"{self.label} RDF files do not contain mapped slot '{actual_slot}' for '{logical_name}'."
            )

        self._ensure_frames([actual_slot])
        if actual_slot in self._slot_read_errors:
            path, exc = self._slot_read_errors[actual_slot]
            raise ComparisonError(
                f"Could not read '{actual_slot}' from RDF file '{path.name}' for {self.label}: {exc}"
            ) from exc

        frames = [
            self._frame_cache[path]
            for path in locations
            if path in self._frame_cache
        ]
        if not frames:
            raise SectionUnavailableError(f"Mapped RDF slot '{actual_slot}' in {self.label} contains no data.")

        rdf = pd.concat(frames, ignore_index=True)
        rdf = rdf[rdf["object_slot"] == actual_slot]
        if rdf.empty:
            raise SectionUnavailableError(f"Mapped RDF slot '{actual_slot}' in {self.label} contains no data.")
        rdf = rdf[rdf["trace_number"].isin(self.trace_numbers)].copy()
        present = {int(x) for x in rdf["trace_number"].dropna().tolist()}
        missing_traces = [n for n in self.trace_numbers if n not in present]
        if missing_traces and not self.allow_missing_traces:
            preview = ", ".join(str(x) for x in missing_traces[:12])
            suffix = " ..." if len(missing_traces) > 12 else ""
            raise SectionUnavailableError(
                f"RDF slot '{actual_slot}' in {self.label} is missing selected trace number(s): {preview}{suffix}"
            )

        rows: dict[date, dict[str, float | None]] = {}
        duplicate_guard: dict[tuple[date, str], tuple[float | None, str, str]] = {}
        for rec in rdf.to_dict(orient="records"):
            period = _rdf_application_period(rec)
            if period is None:
                raise ComparisonError(
                    f"RDF slot '{actual_slot}' in {self.label} has an unparseable timestep '{rec.get('timestep')}'."
                )
            trace_number = int(rec["trace_number"])
            trace_key = f"Trace{trace_number}"
            value = _as_number(rec.get("value"))
            guard_key = (period, trace_key)
            source_file = str(rec.get("_source_file") or "")
            timestep = str(rec.get("timestep") or "")
            if guard_key in duplicate_guard:
                old_value, old_file, old_timestep = duplicate_guard[guard_key]
                if not _same_number(old_value, value):
                    raise ComparisonError(
                        f"Conflicting RDF values for '{actual_slot}', {trace_key}, period {period.isoformat()}: "
                        f"{old_value} in {old_file} ({old_timestep}) vs {value} in {source_file} ({timestep})."
                    )
                continue
            duplicate_guard[guard_key] = (value, source_file, timestep)
            rows.setdefault(period, {})[trace_key] = value

        # Ensure every normalized period row exposes every selected trace key.
        for row in rows.values():
            for trace_key in self.trace_keys:
                row.setdefault(trace_key, None)

        units = tuple(_ordered_unique(_clean_optional_string(x) for x in rdf["unit"].tolist()))
        scales = tuple(float(x) for x in _ordered_unique(rdf["scale"].tolist()) if x is not None and not pd.isna(x))
        timestep_types = tuple(_ordered_unique(_clean_optional_string(x) for x in rdf["timestep_type"].tolist()))
        concrete_units = [x for x in units if x]
        unit = concrete_units[0] if len(set(concrete_units)) == 1 else None
        data = SheetData(
            name=logical_name,
            rows=rows,
            unit=unit,
            units=units,
            scales=scales,
            timestep_types=timestep_types,
            source_slot=actual_slot,
        )
        self._cache[logical_name] = data
        return data

    def raw_slot(self, object_slot: str) -> SheetData:
        """Read an exact caller-selected Object.Slot through the same adapter.

        This helper belongs to the CRMMS application layer, not rdf_reader.py.
        It lets the UI add arbitrary discovered RiverWare slots to a generic
        report appendix without teaching the generic RDF parser about CRMMS.
        """
        slot = str(object_slot).strip()
        if not slot:
            raise SectionUnavailableError(f"{self.label} has no Object.Slot name for the custom comparison.")
        logical_key = f"__custom_slot__::{slot}"
        self.slot_mapping[logical_key] = slot
        return self.sheet(logical_key)

    def slot_source_files(self, object_slot: str) -> tuple[str, ...]:
        """Return the RDF filenames that contain an exact Object.Slot.

        This metadata is used only by the application/report layer (for
        example, to apply yearly flag sums to slots supplied in flags.rdf).
        The generic rdf_reader.py remains unchanged and slot-agnostic.
        """
        slot = str(object_slot).strip()
        return tuple(_ordered_unique(rec.get("file") for rec in self._slot_info.get(slot, []) if rec.get("file")))

    def annual_sum(self, name: str, year: int) -> dict[str, float]:
        data = self.sheet(name)
        types = {x for x in data.timestep_types if x}
        if types == {"annual"}:
            row = data.row(date(year, 1, 1))
            return {trace: float(row.get(trace) or 0.0) for trace in self.trace_keys}

        matches = [row for d, row in data.rows.items() if d.year == year]
        if not matches:
            raise SectionUnavailableError(
                f"RDF input '{name}' ({data.source_slot}) in {self.label} has no rows for calendar year {year}."
            )
        totals = {trace: 0.0 for trace in self.trace_keys}
        for row in matches:
            for trace in self.trace_keys:
                value = row.get(trace)
                if value is not None:
                    totals[trace] += value
        return totals

    def source_metadata(self) -> dict[str, Any]:
        inputs: dict[str, Any] = {}
        for logical in REQUIRED_INPUTS:
            actual = self.slot_mapping.get(logical, logical)
            records = self._slot_info.get(actual, [])
            inputs[logical] = {
                "source_slot": actual,
                "files": sorted({r["file"] for r in records}),
                "units": _ordered_unique(v for r in records for v in r.get("units", [])),
                "scales": _ordered_unique(v for r in records for v in r.get("scales", [])),
                "timestep_types": _ordered_unique(v for r in records for v in r.get("timestep_types", [])),
            }
        return {"source_type": "rdf", "inputs": inputs}


def _json_tuple(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, tuple):
        return [None if pd.isna(x) else x for x in value]
    if isinstance(value, list):
        return [None if pd.isna(x) else x for x in value]
    return [None if pd.isna(value) else value]


def _ordered_unique(values: Iterable[Any]) -> list[Any]:
    out: list[Any] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def _clean_optional_string(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def _same_number(a: float | None, b: float | None, tol: float = 1e-9) -> bool:
    if a is None or b is None:
        return a is b
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def _rdf_application_period(rec: dict[str, Any]) -> date | None:
    """Normalize an RDF record to the period key used by CRMMS calculations.

    This does not change the generic reader's timestep. Monthly records are keyed
    by printed year/month; annual records by printed year. RiverWare 24:00 text
    remains untouched inside rdf_reader.py and never rolls into a new period.
    """
    year_raw = rec.get("year")
    if year_raw is None or pd.isna(year_raw):
        return None
    year = int(year_raw)
    timestep_type = str(rec.get("timestep_type") or "").lower()
    if timestep_type == "annual":
        return date(year, 1, 1)
    month_raw = rec.get("month")
    if month_raw is not None and not pd.isna(month_raw):
        return date(year, int(month_raw), 1)
    period = rec.get("period_date")
    if period is not None and not pd.isna(period):
        ts = pd.Timestamp(period)
        return ts.date()
    return date(year, 1, 1)


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and 1 <= float(value) <= 100000:
        try:
            converted = from_excel(value)
            return converted.date() if isinstance(converted, datetime) else converted
        except Exception:
            return None
    if isinstance(value, str):
        text = value.strip()
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                pass
        if len(text) == 4 and text.isdigit():
            return date(int(text), 1, 1)
    return None


def _as_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        num = float(value)
        return None if isnan(num) else num
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() in {"nan", "na", "n/a"}:
            return None
        try:
            num = float(text.replace(",", ""))
            return None if isnan(num) else num
        except ValueError:
            return None
    return None


def _pct(row: dict[str, float | None], trace_keys: Iterable[str], op: str, threshold: float) -> int:
    keys = tuple(trace_keys)
    values = [row.get(trace) for trace in keys]
    if op == "eq":
        count = sum(v is not None and v == threshold for v in values)
    elif op == "le":
        count = sum(v is not None and v <= threshold for v in values)
    elif op == "lt":
        count = sum(v is not None and v < threshold for v in values)
    elif op == "gt":
        count = sum(v is not None and v > threshold for v in values)
    else:
        raise ValueError(f"Unsupported comparison operator: {op}")
    return round(count / len(keys) * 100)


def _pct_rounded(row: dict[str, float | None], trace_keys: Iterable[str], op: str, threshold: int) -> int:
    keys = tuple(trace_keys)
    values = [round(v) for trace in keys if (v := row.get(trace)) is not None]
    if op == "eq":
        count = sum(v == threshold for v in values)
    elif op == "lt":
        count = sum(v < threshold for v in values)
    elif op == "gt":
        count = sum(v > threshold for v in values)
    else:
        raise ValueError(op)
    return round(count / len(keys) * 100)


def _difference(current: int | float, previous: int | float) -> int | float:
    diff = current - previous
    if isinstance(current, int) and isinstance(previous, int):
        return int(diff)
    return round(diff, 2)


def _table(
    table_id: str,
    section: str,
    title: str,
    columns: list[str],
    current: list[int],
    previous: list[int],
    settings: ComparisonSettings,
    *,
    subtitle: str | None = None,
    unit: str = "%",
) -> dict[str, Any]:
    if subtitle is None:
        subtitle = f"Percent of {len(settings.trace_numbers)} selected hydrologic traces" if unit == "%" else ""
    return {
        "id": table_id,
        "section": section,
        "title": title,
        "subtitle": subtitle,
        "unit": unit,
        "columns": columns,
        "rows": [
            {"label": settings.current_label, "kind": "current", "values": current},
            {"label": settings.previous_label, "kind": "previous", "values": previous},
            {
                "label": "Difference",
                "kind": "difference",
                "values": [_difference(c, p) for c, p in zip(current, previous)],
            },
        ],
    }


def _annual_flag_sum(reader: Any, sheet: str, year: int, trace_keys: Iterable[str]) -> int:
    """Sum all numeric 0/1 flag values for a calendar year across selected traces.

    RiverWare flag RDFs contain one binary value per selected trace and annual
    period.  Summing them gives the number of flagged traces for that year.  We
    intentionally perform this in the CRMMS application layer rather than in
    the generic RDF reader.
    """
    data = reader.sheet(sheet)
    keys = tuple(trace_keys)
    values: list[float] = []
    for period, row in data.rows.items():
        if period.year != year:
            continue
        for trace in keys:
            value = row.get(trace)
            if value is not None:
                values.append(float(value))
    if not values:
        raise SectionUnavailableError(
            f"Input '{sheet}' has no numeric selected-trace flag data for calendar year {year}."
        )
    return int(round(sum(values)))


def _generic_flag_table(
    current_wb: Any,
    previous_wb: Any,
    settings: ComparisonSettings,
    *,
    table_id: str,
    section: str,
    title: str,
    sheet: str,
    years: list[int],
    op: str,
    threshold: float,
) -> dict[str, Any]:
    # Annual binary flags from RiverWare flags RDFs are counts, not percentages:
    # sum every 0/1 value in each calendar year across the selected traces.
    rdf_flag_sum = (
        getattr(current_wb, "source_type", None) == "rdf"
        and getattr(previous_wb, "source_type", None) == "rdf"
        and sheet in ANNUAL_BINARY_FLAG_INPUTS
    )
    if rdf_flag_sum:
        current_values = [_annual_flag_sum(current_wb, sheet, year, settings.trace_keys) for year in years]
        previous_values = [_annual_flag_sum(previous_wb, sheet, year, settings.trace_keys) for year in years]
        return _table(
            table_id, section, title, [str(y) for y in years],
            current_values, previous_values, settings,
            subtitle=f"Sum of annual 0/1 flag values across {len(settings.trace_numbers)} selected RiverWare traces",
            unit="count",
        )

    current_values: list[int] = []
    previous_values: list[int] = []
    for year in years:
        target = date(year, 1, 1)
        current_values.append(_pct(current_wb.sheet(sheet).row(target), settings.trace_keys, op, threshold))
        previous_values.append(_pct(previous_wb.sheet(sheet).row(target), settings.trace_keys, op, threshold))
    return _table(
        table_id,
        section,
        title,
        [str(y) for y in years],
        current_values,
        previous_values,
        settings,
    )


def _operating_condition(
    shortage: dict[str, float | None],
    surplus: dict[str, float | None],
    trace_keys: Iterable[str],
) -> dict[str, int]:
    keys = tuple(trace_keys)
    surplus_count = sum(surplus.get(trace) == 1 for trace in keys)
    normal_count = sum(shortage.get(trace) == 0 for trace in keys) - surplus_count
    return {
        "Surplus": max(surplus_count, 0),
        "Normal": max(normal_count, 0),
        "Shortage - Level 1": sum(shortage.get(trace) == 1 for trace in keys),
        "Shortage - Level 2": sum(shortage.get(trace) == 2 for trace in keys),
        "Shortage - Level 3": sum(shortage.get(trace) == 3 for trace in keys),
    }


def _operation_label(shortage: float | None, surplus: float | None) -> str:
    if shortage == 0 and surplus == 1:
        return "Surplus"
    if shortage == 0 and surplus == 0:
        return "Normal"
    if shortage == 1:
        return "Shortage - Level 1"
    if shortage == 2:
        return "Shortage - Level 2"
    if shortage == 3:
        return "Shortage - Level 3"
    return "Unavailable"


def _tier_label(value: float | None) -> str:
    mapping = {0: "Eq", 1: "UEBT", 2: "MERT", 3: "LEBT"}
    return mapping.get(int(value) if value is not None else -999, "Unavailable")


def _min_max(reader: Any, sheet: str, target: date, trace_keys: Iterable[str]) -> tuple[float, float]:
    row = reader.sheet(sheet).row(target)
    values = [row[t] for t in trace_keys if row.get(t) is not None]
    if not values:
        raise SectionUnavailableError(f"Input '{sheet}' has no numeric selected-trace data on {target.isoformat()}.")
    return round(min(values), 2), round(max(values), 2)


def _kaf_factor(unit: str | None) -> float:
    """Return a native-value -> KAF factor for recognized RiverWare flow units."""
    if not unit:
        return 1.0  # legacy Excel inputs are already represented in KAF
    text = unit.strip().lower().replace(" ", "")
    if text in {"kaf", "1,000af", "1000af", "thousandacre-ft", "thousandacre-feet"}:
        return 1.0
    if text in {"maf", "millionacre-ft", "millionacre-feet"}:
        return 1000.0
    if "acre-ft" in text or "acre-feet" in text or text in {"af", "acreft"}:
        return 0.001
    return 1.0


def _row_to_kaf(reader: Any, logical: str, row: dict[str, float | None]) -> dict[str, float | None]:
    factor = _kaf_factor(reader.sheet(logical).unit)
    return {k: (None if v is None else v * factor) for k, v in row.items()}


def _trace_point_identity(trace_number: int, settings: ComparisonSettings) -> tuple[int | None, str]:
    esp = trace_to_esp(trace_number) if settings.add_esp_year else None
    if esp is not None:
        return esp, str(esp)
    return None, f"Trace {trace_number}"


def _flow_condition_order() -> list[str]:
    return [
        "Surplus",
        "Normal",
        "Shortage - Level 1",
        "Shortage - Level 2",
        "Shortage - Level 3",
    ]


def _build_powell_inflow(current: Any, settings: ComparisonSettings) -> list[dict[str, Any]]:
    trace_keys = settings.trace_keys
    powell_series: list[dict[str, Any]] = []
    for inflow_year in settings.powell_chart_years:
        tier_year = inflow_year + 1
        inflow_row = _row_to_kaf(
            current,
            "PowellAJUnregInflow",
            current.sheet("PowellAJUnregInflow").row(date(inflow_year, 12, 1)),
        )
        tier_row = current.sheet("PowellData.ReleaseTier").row(date(tier_year, 1, 1))
        points = []
        for trace_number, trace in zip(settings.trace_numbers, trace_keys):
            esp_year, trace_label = _trace_point_identity(trace_number, settings)
            points.append(
                {
                    "trace": trace,
                    "trace_number": trace_number,
                    "esp_year": esp_year,
                    "trace_year": esp_year if esp_year is not None else trace_number,
                    "trace_label": trace_label,
                    "inflow": round(inflow_row.get(trace) or 0.0, 2),
                    "tier": _tier_label(tier_row.get(trace)),
                }
            )
        powell_series.append(
            {
                "inflow_year": inflow_year,
                "operating_year": tier_year,
                "historic_average": 9603.36,
                "historic_p90": 14466.59,
                "historic_p10": 4900.16,
                "points": points,
            }
        )
    return powell_series


def _build_mead_flow(current: Any, settings: ComparisonSettings) -> list[dict[str, Any]]:
    trace_keys = settings.trace_keys
    mead_series: list[dict[str, Any]] = []
    for flow_year in settings.mead_chart_years:
        inflow_native = current.annual_sum("Mead.Inflow", flow_year)
        outflow_native = current.annual_sum("Mead.Outflow", flow_year)
        inflow = _row_to_kaf(current, "Mead.Inflow", inflow_native)
        outflow = _row_to_kaf(current, "Mead.Outflow", outflow_native)
        condition_year = flow_year + 1
        shortage = current.sheet("Shortage.Shortage Flag").row(date(condition_year, 1, 1))
        surplus = current.sheet("Surplus.AnnualSurplusFlag").row(date(condition_year, 1, 1))
        points = []
        for trace_number, trace in zip(settings.trace_numbers, trace_keys):
            esp_year, trace_label = _trace_point_identity(trace_number, settings)
            points.append(
                {
                    "trace": trace,
                    "trace_number": trace_number,
                    "esp_year": esp_year,
                    "trace_year": esp_year if esp_year is not None else trace_number,
                    "trace_label": trace_label,
                    "inflow": round(inflow.get(trace) or 0.0, 2),
                    "outflow": round(outflow.get(trace) or 0.0, 2),
                    "condition": _operation_label(shortage.get(trace), surplus.get(trace)),
                }
            )
        mead_series.append({"flow_year": flow_year, "condition_year": condition_year, "points": points})
    return mead_series


def _build_lower_basin_conditions(current: Any, previous: Any, settings: ComparisonSettings) -> list[dict[str, Any]]:
    trace_keys = settings.trace_keys
    conditions: list[dict[str, Any]] = []
    for year in settings.basin_chart_years:
        target = date(year, 1, 1)
        current_counts = _operating_condition(
            current.sheet("Shortage.Shortage Flag").row(target),
            current.sheet("Surplus.AnnualSurplusFlag").row(target),
            trace_keys,
        )
        previous_counts = _operating_condition(
            previous.sheet("Shortage.Shortage Flag").row(target),
            previous.sheet("Surplus.AnnualSurplusFlag").row(target),
            trace_keys,
        )
        conditions.append({"year": year, "current": current_counts, "previous": previous_counts})
    return conditions


def _reader_input_status(reader: Any, logical: str) -> tuple[bool, str | None]:
    try:
        reader.require_sheets([logical])
        return True, None
    except SectionUnavailableError as exc:
        return False, str(exc)


def compare_readers(current: Any, previous: Any, settings: ComparisonSettings) -> dict[str, Any]:
    """Compare two CRMMS readers and return every section that can be calculated.

    A missing report input is intentionally *section-local*. It no longer aborts
    the whole comparison. Tables, summaries, or plots whose dependencies are
    unavailable are omitted and described in ``meta.skipped_sections``. This is
    especially useful for RiverWare runs assembled from several RDF files where
    a monthly export may not contain every report slot.
    """
    if not settings.trace_numbers:
        raise ComparisonError("At least one trace number is required.")
    if len(set(settings.trace_numbers)) != len(settings.trace_numbers):
        raise ComparisonError("Trace numbers cannot contain duplicates.")

    years = settings.years
    if not years:
        raise ComparisonError("At least one comparison year is required.")
    later_years = settings.later_years
    eocy = settings.eocy_date
    trace_keys = settings.trace_keys

    skipped_sections: list[dict[str, Any]] = []

    def skip(section_id: str, *, kind: str, section: str, title: str, inputs: Iterable[str], reason: str) -> None:
        skipped_sections.append(
            {
                "id": section_id,
                "kind": kind,
                "section": section,
                "title": title,
                "inputs": list(inputs),
                "reason": reason,
            }
        )

    def require_both(inputs: Iterable[str]) -> None:
        deps = tuple(inputs)
        current.require_sheets(deps)
        previous.require_sheets(deps)

    summary: dict[str, Any] = {}
    for key, label, logical in (
        ("powell", "Lake Powell EOCY elevation range", "Powell.Pool Elevation"),
        ("mead", "Lake Mead EOCY elevation range", "Mead.Pool Elevation"),
    ):
        try:
            require_both([logical])
            cur_min, cur_max = _min_max(current, logical, eocy, trace_keys)
            prev_min, prev_max = _min_max(previous, logical, eocy, trace_keys)
            summary[key] = {
                "current": {"min": cur_min, "max": cur_max},
                "previous": {"min": prev_min, "max": prev_max},
            }
        except SectionUnavailableError as exc:
            skip(f"summary-{key}", kind="summary", section=key, title=label, inputs=[logical], reason=str(exc))

    tables: list[dict[str, Any]] = []

    def add_table(table_id: str, section: str, title: str, inputs: Iterable[str], builder) -> None:
        deps = tuple(inputs)
        try:
            require_both(deps)
            tables.append(builder())
        except SectionUnavailableError as exc:
            skip(table_id, kind="table", section=section, title=title, inputs=deps, reason=str(exc))

    def operating_tier_table() -> dict[str, Any]:
        # Literal parity with the legacy R Markdown report: UEBT>8.23 uses
        # ReleaseTier==1, while the =8.23 and <8.23 columns both use
        # UpperBalancingAt823==1.
        ot_target = date(settings.powell_operating_year, 1, 1)
        cur_ot = current.sheet("PowellData.ReleaseTier").row(ot_target)
        prev_ot = previous.sheet("PowellData.ReleaseTier").row(ot_target)
        cur_823 = current.sheet("UpperBalancingAt823").row(ot_target)
        prev_823 = previous.sheet("UpperBalancingAt823").row(ot_target)
        cur_values = [
            _pct(cur_ot, trace_keys, "eq", 0),
            _pct(cur_ot, trace_keys, "eq", 1),
            _pct(cur_823, trace_keys, "eq", 1),
            _pct(cur_823, trace_keys, "eq", 1),
            _pct(cur_ot, trace_keys, "eq", 2),
            _pct(cur_ot, trace_keys, "eq", 3),
        ]
        prev_values = [
            _pct(prev_ot, trace_keys, "eq", 0),
            _pct(prev_ot, trace_keys, "eq", 1),
            _pct(prev_823, trace_keys, "eq", 1),
            _pct(prev_823, trace_keys, "eq", 1),
            _pct(prev_ot, trace_keys, "eq", 2),
            _pct(prev_ot, trace_keys, "eq", 3),
        ]
        return _table(
            "powell-operating-tier",
            "powell",
            f"Powell Operating Tier — WY {settings.powell_operating_year}",
            ["Eq.", "UEBT>8.23", "UEBT=8.23", "UEBT<8.23", "MERT", "LEBT"],
            cur_values,
            prev_values,
            settings,
        )

    add_table(
        "powell-operating-tier", "powell", f"Powell Operating Tier — WY {settings.powell_operating_year}",
        ["PowellData.ReleaseTier", "UpperBalancingAt823"], operating_tier_table,
    )

    release_years = settings.release_table_years

    def release_volume_table() -> dict[str, Any]:
        release_cols: list[str] = []
        cur_release: list[int] = []
        prev_release: list[int] = []
        for y in release_years:
            release_cols.extend([f"{y} <8.23", f"{y} =8.23", f"{y} >8.23"])
            cur_row = _row_to_kaf(
                current,
                "PowellTargetAnnualReleaseVolume",
                current.sheet("PowellTargetAnnualReleaseVolume").row(date(y, 1, 1)),
            )
            prev_row = _row_to_kaf(
                previous,
                "PowellTargetAnnualReleaseVolume",
                previous.sheet("PowellTargetAnnualReleaseVolume").row(date(y, 1, 1)),
            )
            cur_release.extend([
                _pct_rounded(cur_row, trace_keys, "lt", 8230),
                _pct_rounded(cur_row, trace_keys, "eq", 8230),
                _pct_rounded(cur_row, trace_keys, "gt", 8230),
            ])
            prev_release.extend([
                _pct_rounded(prev_row, trace_keys, "lt", 8230),
                _pct_rounded(prev_row, trace_keys, "eq", 8230),
                _pct_rounded(prev_row, trace_keys, "gt", 8230),
            ])
        return _table(
            "powell-release-volume",
            "powell",
            "Powell Annual Release Volume Scenario",
            release_cols,
            cur_release,
            prev_release,
            settings,
            subtitle="Percent of selected traces by annual release volume relative to 8.23 maf",
        )

    add_table(
        "powell-release-volume", "powell", "Powell Annual Release Volume Scenario",
        ["PowellTargetAnnualReleaseVolume"], release_volume_table,
    )

    table_specs = [
        ("powell-3500-adjustment", "powell", "Powell Release Adjustment to Avoid Declining Below 3,500 ft", "PowellConstrained3500Bypass", years, "eq", 1),
        ("powell-3500-less-748", "powell", "Powell 3,500 ft Adjustment with Release Below 7.48 maf", "PowellConstrained3500Less748", later_years, "eq", 1),
        ("powell-3525", "powell", "Powell Elevation Below 3,525 ft in Any Month", "Powell3525Annual", years, "eq", 1),
        ("powell-3490", "powell", "Powell Elevation Below Minimum Power Pool in Any Month", "Powell3490Annual", years, "eq", 1),
        ("mead-1090", "mead", "Lower Basin DCP — Mead ≤ 1,090 ft on January 1", "DCPBWSP_Type", later_years, "le", 7),
        ("mead-1075", "mead", "Lower Basin Shortage, Any Condition — Mead ≤ 1,075 ft", "AnnualShortageAnyTypeFlag", later_years, "eq", 1),
        ("mead-1050", "mead", "Lower Basin Shortage — Mead ≤ 1,050 ft on January 1", "DCPBWSP_Type", later_years, "le", 5),
        ("mead-1045", "mead", "Lower Basin Shortage — Mead ≤ 1,045 ft on January 1", "DCPBWSP_Type", later_years, "le", 4),
        ("mead-1035", "mead", "Lake Mead Elevation Below 1,035 ft", "MeadData.MeadBelow1035_Annual", years, "eq", 1),
        ("mead-1025", "mead", "Lower Basin Shortage — Mead ≤ 1,025 ft on January 1", "DCPBWSP_Type", later_years, "le", 0),
        ("mead-1000", "mead", "Lake Mead Elevation Below 1,000 ft in Any Month", "MeadData.MeadBelow1000_Annual", years, "eq", 1),
        ("mead-950", "mead", "Lake Mead Elevation ≤ 950 ft in Any Month", "MeadData.MeadBelow950_Annual", later_years, "eq", 1),
        ("mead-895", "mead", "Lake Mead Elevation ≤ 895 ft in Any Month", "MeadData.MeadBelow895_Annual", later_years, "eq", 1),
    ]
    for table_id, section, title, sheet, table_years, op, threshold in table_specs:
        add_table(
            table_id,
            section,
            title,
            [sheet],
            lambda table_id=table_id, section=section, title=title, sheet=sheet, table_years=table_years, op=op, threshold=threshold: _generic_flag_table(
                current, previous, settings,
                table_id=table_id, section=section, title=title,
                sheet=sheet, years=table_years, op=op, threshold=threshold,
            ),
        )

    flow_analysis = {
        "powell_inflow": [],
        "mead_flow": [],
        "lower_basin_conditions": [],
        "condition_order": _flow_condition_order(),
    }

    try:
        current.require_sheets(["PowellAJUnregInflow", "PowellData.ReleaseTier"])
        flow_analysis["powell_inflow"] = _build_powell_inflow(current, settings)
    except SectionUnavailableError as exc:
        skip(
            "plot-powell", kind="plot", section="powell", title="Powell inflow plots",
            inputs=["PowellAJUnregInflow", "PowellData.ReleaseTier"], reason=str(exc),
        )

    try:
        current.require_sheets(["Mead.Inflow", "Mead.Outflow", "Shortage.Shortage Flag", "Surplus.AnnualSurplusFlag"])
        flow_analysis["mead_flow"] = _build_mead_flow(current, settings)
    except SectionUnavailableError as exc:
        skip(
            "plot-mead", kind="plot", section="mead", title="Mead inflow/outflow plots",
            inputs=["Mead.Inflow", "Mead.Outflow", "Shortage.Shortage Flag", "Surplus.AnnualSurplusFlag"], reason=str(exc),
        )

    try:
        require_both(["Shortage.Shortage Flag", "Surplus.AnnualSurplusFlag"])
        flow_analysis["lower_basin_conditions"] = _build_lower_basin_conditions(current, previous, settings)
    except SectionUnavailableError as exc:
        skip(
            "plot-lower-basin", kind="plot", section="mead", title="Lower Basin operating condition plot",
            inputs=["Shortage.Shortage Flag", "Surplus.AnnualSurplusFlag"], reason=str(exc),
        )

    changed_cells = 0
    max_change: int | float = 0
    max_change_label = "No changes"
    for table in tables:
        diffs = table["rows"][2]["values"]
        for col, diff in zip(table["columns"], diffs):
            if diff != 0:
                changed_cells += 1
            if abs(diff) > abs(max_change):
                max_change = diff
                max_change_label = f"{table['title']} · {col}"

    input_status: dict[str, Any] = {}
    missing_inputs: list[str] = []
    for logical in REQUIRED_INPUTS:
        current_ok, current_reason = _reader_input_status(current, logical)
        previous_ok, previous_reason = _reader_input_status(previous, logical)
        input_status[logical] = {
            "current": current_ok,
            "previous": previous_ok,
            "current_reason": current_reason,
            "previous_reason": previous_reason,
        }
        if not (current_ok and previous_ok):
            missing_inputs.append(logical)

    source_metadata = {
        "current": current.source_metadata() if hasattr(current, "source_metadata") else {},
        "previous": previous.source_metadata() if hasattr(previous, "source_metadata") else {},
    }

    return {
        "meta": {
            "trace_count": len(settings.trace_numbers),
            "trace_numbers": list(settings.trace_numbers),
            "esp_mapping_enabled": settings.add_esp_year,
            "year1": settings.year1,
            "eocy_year": settings.eocy_year,
            "eocy_date": eocy.isoformat(),
            "powell_operating_year": settings.powell_operating_year,
            "comparison_years": years,
            "release_years": release_years,
            "mead_jan1_years": later_years,
            "powell_plot_years": settings.powell_chart_years,
            "mead_plot_years": settings.mead_chart_years,
            "lower_basin_years": settings.basin_chart_years,
            "current_label": settings.current_label,
            "previous_label": settings.previous_label,
            "required_sheet_count": len(REQUIRED_INPUTS),
            "required_input_count": len(REQUIRED_INPUTS),
            "available_input_count": len(REQUIRED_INPUTS) - len(missing_inputs),
            "missing_input_count": len(missing_inputs),
            "missing_inputs": missing_inputs,
            "input_status": input_status,
            "partial_report": bool(skipped_sections),
            "skipped_sections": skipped_sections,
            "available_table_count": len(tables),
            "changed_cells": changed_cells,
            "max_change": max_change,
            "max_change_label": max_change_label,
            "source_metadata": source_metadata,
        },
        "summary": summary,
        "tables": tables,
        "flow_analysis": flow_analysis,
    }

def compare_workbooks(
    current_payload: bytes,
    previous_payload: bytes,
    settings: ComparisonSettings,
) -> dict[str, Any]:
    if not current_payload or not previous_payload:
        raise ComparisonError("Both current and previous CRMMS Output files are required.")
    current = WorkbookReader(current_payload, settings.current_label, settings.trace_numbers)
    previous = WorkbookReader(previous_payload, settings.previous_label, settings.trace_numbers)
    return compare_readers(current, previous, settings)



def _custom_slot_statistic(values: list[float], statistic_name: str) -> float | None:
    if not values:
        return None
    if statistic_name == "mean":
        return float(statistics.fmean(values))
    if statistic_name == "min":
        return float(min(values))
    if statistic_name == "max":
        return float(max(values))
    return float(statistics.median(values))


def _custom_slot_year_value(
    data: SheetData,
    year: int,
    trace_keys: Iterable[str],
    statistic_name: str,
) -> float | None:
    values: list[float] = []
    keys = tuple(trace_keys)
    for period, row in data.rows.items():
        if period.year != year:
            continue
        for trace in keys:
            value = row.get(trace)
            if value is not None:
                values.append(float(value))
    return _custom_slot_statistic(values, statistic_name)


def _custom_slot_year_sum(
    data: SheetData,
    year: int,
    trace_keys: Iterable[str],
) -> float | None:
    """Sum every selected-trace value in a calendar year.

    This is used for annual flag slots supplied by flags.rdf. It deliberately
    lives in the CRMMS application layer rather than the generic RDF reader.
    """
    values: list[float] = []
    keys = tuple(trace_keys)
    for period, row in data.rows.items():
        if period.year != year:
            continue
        for trace in keys:
            value = row.get(trace)
            if value is not None:
                values.append(float(value))
    if not values:
        return None
    return float(sum(values))


def _original_upload_name(filename: str) -> str:
    """Strip the temporary upload index prefix used by FastAPI storage."""
    name = Path(str(filename)).name
    first, sep, rest = name.partition("_")
    return rest if sep and first.isdigit() else name


def _slot_comes_from_flags_rdf(reader: RDFRunReader, slot: str) -> bool:
    return any(_original_upload_name(name).lower() == "flags.rdf" for name in reader.slot_source_files(slot))


def _custom_slot_table(
    current: RDFRunReader,
    previous: RDFRunReader,
    settings: ComparisonSettings,
    slot: str,
    statistic_name: str,
) -> dict[str, Any]:
    current_data = current.raw_slot(slot)
    previous_data = previous.raw_slot(slot)

    current_units = {x for x in current_data.units if x}
    previous_units = {x for x in previous_data.units if x}
    if current_units and previous_units and current_units != previous_units:
        raise SectionUnavailableError(
            f"RDF slot '{slot}' uses different units between runs: "
            f"{sorted(current_units)} vs {sorted(previous_units)}."
        )

    current_types = {x for x in current_data.timestep_types if x}
    previous_types = {x for x in previous_data.timestep_types if x}
    if current_types and previous_types and current_types != previous_types:
        raise SectionUnavailableError(
            f"RDF slot '{slot}' uses different timestep types between runs: "
            f"{sorted(current_types)} vs {sorted(previous_types)}."
        )

    years = list(settings.years)
    current_sources = current.slot_source_files(slot)
    previous_sources = previous.slot_source_files(slot)
    is_annual = bool(current_types or previous_types) and (current_types | previous_types) == {"annual"}
    annual_flag_sum = is_annual and (
        _slot_comes_from_flags_rdf(current, slot) or _slot_comes_from_flags_rdf(previous, slot)
    )
    if annual_flag_sum:
        current_values = [
            _custom_slot_year_sum(current_data, year, settings.trace_keys)
            for year in years
        ]
        previous_values = [
            _custom_slot_year_sum(previous_data, year, settings.trace_keys)
            for year in years
        ]
    else:
        current_values = [
            _custom_slot_year_value(current_data, year, settings.trace_keys, statistic_name)
            for year in years
        ]
        previous_values = [
            _custom_slot_year_value(previous_data, year, settings.trace_keys, statistic_name)
            for year in years
        ]
    if all(value is None for value in current_values) and all(value is None for value in previous_values):
        raise SectionUnavailableError(
            f"RDF slot '{slot}' has no values for the selected comparison years {', '.join(map(str, years))}."
        )

    differences = [
        (a - b) if a is not None and b is not None else None
        for a, b in zip(current_values, previous_values)
    ]
    unit_values = sorted(current_units or previous_units)
    unit = "count" if annual_flag_sum else (", ".join(unit_values) if unit_values else None)
    timestep_values = sorted(current_types or previous_types)
    timestep_label = ", ".join(timestep_values) if timestep_values else "unspecified"
    scale_values = []
    for scale in (*current_data.scales, *previous_data.scales):
        if scale not in scale_values:
            scale_values.append(scale)
    scale_label = ", ".join(f"{value:g}" for value in scale_values) if scale_values else None
    statistic_label = {
        "median": "Median",
        "mean": "Mean",
        "min": "Minimum",
        "max": "Maximum",
    }.get(statistic_name, "Median")
    effective_statistic = "sum" if annual_flag_sum else statistic_name
    if annual_flag_sum:
        subtitle = "Yearly sum of annual 0/1 flag values across selected RiverWare traces (flags.rdf)"
    else:
        subtitle = f"{statistic_label} of scaled RDF values by calendar year across selected traces and available timesteps"
    digest = hashlib.sha1(slot.encode("utf-8")).hexdigest()[:12]
    return {
        "id": f"rdf-slot-{digest}",
        "section": "custom",
        "slot": slot,
        "title": slot,
        "subtitle": subtitle,
        "unit": unit,
        "scale_label": scale_label,
        "source_scales": {"current": list(current_data.scales), "previous": list(previous_data.scales)},
        "source_files": {"current": list(current_sources), "previous": list(previous_sources)},
        "timestep_label": timestep_label,
        "trace_numbers": list(settings.trace_numbers),
        "trace_count": len(settings.trace_numbers),
        "statistic": effective_statistic,
        "aggregation": "annual_flag_sum" if annual_flag_sum else effective_statistic,
        "display_decimals": 0 if annual_flag_sum else 2,
        "columns": [str(year) for year in years],
        "rows": [
            {"label": settings.current_label, "values": current_values, "kind": "current"},
            {"label": settings.previous_label, "values": previous_values, "kind": "previous"},
            {"label": "Difference", "values": differences, "kind": "difference"},
        ],
    }


def _attach_custom_slot_comparisons(
    result: dict[str, Any],
    current: RDFRunReader,
    previous: RDFRunReader,
    settings: ComparisonSettings,
    custom_slots: Iterable[str],
    statistic_name: str,
) -> None:
    statistic_name = statistic_name if statistic_name in {"median", "mean", "min", "max"} else "median"
    slots: list[str] = []
    seen: set[str] = set()
    for value in custom_slots:
        slot = str(value).strip()
        if slot and slot not in seen:
            seen.add(slot)
            slots.append(slot)

    tables: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for slot in slots:
        try:
            tables.append(_custom_slot_table(current, previous, settings, slot, statistic_name))
        except SectionUnavailableError as exc:
            skipped.append({"slot": slot, "reason": str(exc)})

    result["custom_slot_tables"] = tables
    meta = result.setdefault("meta", {})
    meta["custom_slots"] = slots
    meta["custom_slot_statistic"] = statistic_name
    meta["custom_slot_count"] = len(slots)
    meta["custom_slot_available_count"] = len(tables)
    meta["custom_slot_skipped"] = skipped
    meta["custom_slot_skipped_count"] = len(skipped)
    if skipped:
        meta["partial_report"] = True
        for item in skipped:
            meta.setdefault("skipped_sections", []).append(
                {
                    "id": f"custom-slot-{hashlib.sha1(item['slot'].encode('utf-8')).hexdigest()[:12]}",
                    "kind": "custom-slot",
                    "section": "custom",
                    "title": item["slot"],
                    "inputs": [item["slot"]],
                    "reason": item["reason"],
                }
            )


def _custom_slot_year_values(
    data: SheetData,
    year: int,
    trace_keys: Iterable[str],
) -> list[float]:
    """Return every scaled value for selected traces in one calendar year."""
    keys = tuple(trace_keys)
    values: list[float] = []
    for period, row in data.rows.items():
        if period.year != year:
            continue
        for trace in keys:
            value = row.get(trace)
            if value is not None:
                values.append(float(value))
    return values


def _custom_plot_payload(
    current: RDFRunReader,
    previous: RDFRunReader,
    settings: ComparisonSettings,
    spec: dict[str, Any],
) -> dict[str, Any]:
    """Build a report-plot payload from selected RiverWare trace values.

    Plot type and data treatment are deliberately separate. ``raw`` preserves
    native timesteps; calendar/water-year sums are calculated *within each
    trace first*; box plots then use those per-trace totals as their
    distributions. This keeps monthly line plots monthly while allowing an
    annual unregulated-inflow box plot to use water-year totals.
    """
    slot = str(spec.get("slot") or "").strip()
    if not slot:
        raise SectionUnavailableError("A custom RDF plot has no Object.Slot selected.")
    plot_type = str(spec.get("plot_type") or "line").strip().lower()
    if plot_type not in {"line", "bar", "box"}:
        plot_type = "line"
    transform = str(spec.get("transform") or "raw").strip().lower()
    if transform not in {"raw", "water_year_sum", "calendar_year_sum", "annual_raw"}:
        transform = "raw"
    try:
        wy_start_month = int(spec.get("wy_start_month") or 10)
    except (TypeError, ValueError):
        wy_start_month = 10
    wy_start_month = min(12, max(1, wy_start_month))

    current_data = current.raw_slot(slot)
    previous_data = previous.raw_slot(slot)
    current_units = {x for x in current_data.units if x}
    previous_units = {x for x in previous_data.units if x}
    if current_units and previous_units and current_units != previous_units:
        raise SectionUnavailableError(
            f"RDF slot '{slot}' uses different units between runs: {sorted(current_units)} vs {sorted(previous_units)}."
        )
    current_types = {x for x in current_data.timestep_types if x}
    previous_types = {x for x in previous_data.timestep_types if x}
    if current_types and previous_types and current_types != previous_types:
        raise SectionUnavailableError(
            f"RDF slot '{slot}' uses different timestep types between runs: {sorted(current_types)} vs {sorted(previous_types)}."
        )

    years = list(settings.years)
    year_set = set(years)
    timestep_types = current_types or previous_types
    is_annual = bool(timestep_types) and timestep_types == {"annual"}
    annual_flag_slot = is_annual and (
        _slot_comes_from_flags_rdf(current, slot) or _slot_comes_from_flags_rdf(previous, slot)
    )

    requested_plot_traces = spec.get("trace_numbers") or settings.trace_numbers
    trace_numbers = [int(x) for x in requested_plot_traces]
    trace_keys = [f"Trace{x}" for x in trace_numbers]
    custom_trace_labels = {str(k): str(v) for k, v in (spec.get("trace_labels") or {}).items() if str(v).strip()}
    trace_labels: list[str] = []
    for number in trace_numbers:
        if str(number) in custom_trace_labels:
            label = custom_trace_labels[str(number)]
        else:
            _, label = _trace_point_identity(number, settings)
        trace_labels.append(label)

    def raw_label(period: date) -> str:
        return str(period.year) if is_annual else f"{period.year:04d}-{period.month:02d}"

    def transformed_rows(data: SheetData) -> dict[str, dict[str, float | None]]:
        if transform == "raw":
            return {
                raw_label(period): {trace: row.get(trace) for trace in trace_keys}
                for period, row in sorted(data.rows.items())
                if period.year in year_set
            }
        if transform == "annual_raw":
            latest: dict[int, tuple[date, dict[str, float | None]]] = {}
            for period, row in data.rows.items():
                if period.year not in year_set:
                    continue
                if period.year not in latest or period > latest[period.year][0]:
                    latest[period.year] = (period, row)
            return {
                str(year): {trace: row.get(trace) for trace in trace_keys}
                for year, (_, row) in sorted(latest.items())
            }

        grouped: dict[int, dict[str, float | None]] = {}
        counts: dict[int, dict[str, int]] = {}
        for period, row in data.rows.items():
            if transform == "water_year_sum":
                bucket_year = period.year + (1 if period.month >= wy_start_month else 0)
            else:
                bucket_year = period.year
            if bucket_year not in year_set:
                continue
            total = grouped.setdefault(bucket_year, {trace: 0.0 for trace in trace_keys})
            cnt = counts.setdefault(bucket_year, {trace: 0 for trace in trace_keys})
            for trace in trace_keys:
                value = row.get(trace)
                if value is not None:
                    total[trace] = float(total[trace] or 0.0) + float(value)
                    cnt[trace] += 1
        result: dict[str, dict[str, float | None]] = {}
        for year in sorted(grouped):
            label = f"WY {year}" if transform == "water_year_sum" else str(year)
            result[label] = {
                trace: (grouped[year][trace] if counts[year][trace] else None)
                for trace in trace_keys
            }
        return result

    current_rows = transformed_rows(current_data)
    previous_rows = transformed_rows(previous_data)
    labels = list(dict.fromkeys([*current_rows.keys(), *previous_rows.keys()]))
    def label_sort_key(label: str) -> tuple[int, str]:
        match = re.search(r"(20\d{2}|21\d{2})", label)
        return (int(match.group(1)) if match else 9999, label)
    labels = sorted(labels, key=label_sort_key)
    if not labels:
        raise SectionUnavailableError(
            f"RDF slot '{slot}' has no values for the selected comparison years {', '.join(map(str, years))}."
        )

    def matrix(rows: dict[str, dict[str, float | None]]) -> list[list[float | None]]:
        return [
            [None if rows.get(label, {}).get(trace) is None else float(rows[label][trace]) for label in labels]
            for trace in trace_keys
        ]

    def distributions(rows: dict[str, dict[str, float | None]]) -> list[list[float]]:
        return [
            [float(rows[label][trace]) for trace in trace_keys if rows.get(label, {}).get(trace) is not None]
            for label in labels
        ]

    current_matrix = matrix(current_rows)
    previous_matrix = matrix(previous_rows)
    current_distributions = distributions(current_rows)
    previous_distributions = distributions(previous_rows)
    try:
        unit_factor = float(spec.get("unit_factor", 1.0))
    except (TypeError, ValueError):
        unit_factor = 1.0
    try:
        unit_offset = float(spec.get("unit_offset", 0.0))
    except (TypeError, ValueError):
        unit_offset = 0.0
    if annual_flag_slot:
        unit_factor, unit_offset = 1.0, 0.0
    def convert_value(value: float | None) -> float | None:
        return None if value is None else float(value) * unit_factor + unit_offset
    current_matrix = [[convert_value(v) for v in row] for row in current_matrix]
    previous_matrix = [[convert_value(v) for v in row] for row in previous_matrix]
    current_distributions = [[float(v) * unit_factor + unit_offset for v in row] for row in current_distributions]
    previous_distributions = [[float(v) * unit_factor + unit_offset for v in row] for row in previous_distributions]
    if all(not x for x in current_distributions) and all(not x for x in previous_distributions):
        raise SectionUnavailableError(
            f"RDF slot '{slot}' has no numeric values for the selected traces in the selected comparison years."
        )

    # Bar plots display actual per-trace values. For raw monthly data, use the
    # latest available monthly period in each selected calendar year; transformed
    # data already has one value per CY/WY and therefore uses every transformed period.
    if transform == "raw" and not is_annual:
        raw_periods = sorted({d for d in [*current_data.rows.keys(), *previous_data.rows.keys()] if d.year in year_set})
        bar_periods: list[date] = []
        for year in years:
            available = [p for p in raw_periods if p.year == year]
            if available:
                bar_periods.append(max(available))
        bar_labels = [raw_label(p) for p in bar_periods]
    else:
        bar_labels = list(labels)

    def bar_matrix(rows: dict[str, dict[str, float | None]]) -> list[list[float | None]]:
        return [
            [None if rows.get(label, {}).get(trace) is None else float(rows[label][trace]) for trace in trace_keys]
            for label in bar_labels
        ]

    current_bar_values = [[convert_value(v) for v in row] for row in bar_matrix(current_rows)]
    previous_bar_values = [[convert_value(v) for v in row] for row in bar_matrix(previous_rows)]

    flag_years = years
    current_flag_sums: list[float | None] = []
    previous_flag_sums: list[float | None] = []
    if annual_flag_slot:
        for year in flag_years:
            cur_vals = _custom_slot_year_values(current_data, year, trace_keys)
            prev_vals = _custom_slot_year_values(previous_data, year, trace_keys)
            current_flag_sums.append(float(sum(cur_vals)) if cur_vals else None)
            previous_flag_sums.append(float(sum(prev_vals)) if prev_vals else None)

    digest = hashlib.sha1(f"{slot}|{plot_type}|{transform}|{wy_start_month}".encode("utf-8")).hexdigest()[:12]
    title = str(spec.get("title") or "").strip()[:180] or slot
    subtitle = str(spec.get("subtitle") or "").strip()[:500]
    timestep_values = sorted(timestep_types)
    timestep_label = ", ".join(timestep_values) if timestep_values else "unspecified"
    unit_values = sorted(current_units or previous_units)
    source_unit = ", ".join(unit_values) if unit_values else None
    display_unit = str(spec.get("display_unit") or "").strip()
    unit = (display_unit or source_unit) if not annual_flag_slot else "count"
    aggregation = "annual_flag_sum" if annual_flag_slot and plot_type in {"line", "bar"} else ("raw_trace_values" if transform == "raw" else transform)

    return {
        "id": f"rdfplot-{digest}",
        "slot": slot,
        "title": title,
        "subtitle": subtitle,
        "plot_type": plot_type,
        "aggregation": aggregation,
        "transform": transform,
        "wy_start_month": wy_start_month,
        "annual_flag_slot": annual_flag_slot,
        "unit": "count" if aggregation == "annual_flag_sum" else unit,
        "source_unit": source_unit,
        "timestep_label": timestep_label,
        "years": years,
        "trace_count": len(trace_numbers),
        "trace_numbers": trace_numbers,
        "trace_labels": trace_labels,
        "current_label": settings.current_label,
        "previous_label": settings.previous_label,
        "period_labels": labels,
        "current_trace_values": current_matrix,
        "previous_trace_values": previous_matrix,
        "current_distributions": current_distributions,
        "previous_distributions": previous_distributions,
        "bar_period_labels": bar_labels,
        "current_bar_values": current_bar_values,
        "previous_bar_values": previous_bar_values,
        "flag_years": flag_years,
        "current_flag_sums": current_flag_sums,
        "previous_flag_sums": previous_flag_sums,
        "run_a_color": str(spec.get("run_a_color") or "#167c80"),
        "run_b_color": str(spec.get("run_b_color") or "#d07a28"),
        "alpha": float(spec.get("alpha") or 0.28),
        "x_axis_title": str(spec.get("x_axis_title") or ""),
        "y_axis_title": str(spec.get("y_axis_title") or ""),
        "line_width": float(spec.get("line_width") or 1.0),
        "show_grid": bool(spec.get("show_grid", True)),
        "overlay_alpha": float(spec.get("overlay_alpha") or 0.16),
        "y_axis_mode": str(spec.get("y_axis_mode") or "auto"),
        "y_min": spec.get("y_min"),
        "y_max": spec.get("y_max"),
        "percentile_band": bool(spec.get("percentile_band", False)),
        "percentile_low": float(spec.get("percentile_low") or 10.0),
        "percentile_high": float(spec.get("percentile_high") or 90.0),
        "unit_factor": unit_factor,
        "unit_offset": unit_offset,
        "display_unit": display_unit,
        "reference_lines": str(spec.get("reference_lines") or ""),
        "source_files": {
            "current": list(current.slot_source_files(slot)),
            "previous": list(previous.slot_source_files(slot)),
        },
    }


def _attach_custom_slot_plots(
    result: dict[str, Any],
    current: RDFRunReader,
    previous: RDFRunReader,
    settings: ComparisonSettings,
    custom_plots: Iterable[dict[str, Any]],
) -> None:
    plots: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for raw in custom_plots:
        if not isinstance(raw, dict):
            continue
        slot = str(raw.get("slot") or "").strip()
        plot_type = str(raw.get("plot_type") or "line").strip().lower()
        transform = str(raw.get("transform") or "raw").strip().lower()
        if not slot:
            continue
        key = (slot, plot_type, transform)
        if key in seen:
            continue
        seen.add(key)
        try:
            plots.append(_custom_plot_payload(current, previous, settings, raw))
        except SectionUnavailableError as exc:
            skipped.append({"slot": slot, "plot_type": plot_type, "reason": str(exc)})
    result["custom_slot_plots"] = plots
    meta = result.setdefault("meta", {})
    meta["custom_plot_count"] = len(plots)
    meta["custom_plot_skipped"] = skipped
    meta["custom_plot_skipped_count"] = len(skipped)
    if skipped:
        meta["partial_report"] = True


def compare_rdf_files(
    current_paths: Iterable[str | Path],
    previous_paths: Iterable[str | Path],
    settings: ComparisonSettings,
    slot_mapping: dict[str, str],
    *,
    custom_slots: Iterable[str] = (),
    custom_slot_statistic: str = "median",
    custom_plots: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    current_paths = tuple(Path(x) for x in current_paths)
    previous_paths = tuple(Path(x) for x in previous_paths)
    custom_slots = list(custom_slots)
    custom_plots = list(custom_plots)

    # Every slot needed by the standard comparison and the custom tables/plots
    # is known up front. Read them per file in one pass instead of reparsing
    # each RDF once for every individual slot.
    preload_slots: list[str] = [
        str(value).strip()
        for value in slot_mapping.values()
        if str(value or "").strip()
    ]
    preload_slots.extend(str(value).strip() for value in custom_slots if str(value).strip())
    preload_slots.extend(
        str(spec.get("slot") or "").strip()
        for spec in custom_plots
        if isinstance(spec, dict) and str(spec.get("slot") or "").strip()
    )

    current = RDFRunReader(
        current_paths,
        settings.current_label,
        trace_numbers=settings.trace_numbers,
        slot_mapping=slot_mapping,
        add_esp_year=settings.add_esp_year,
    )
    previous = RDFRunReader(
        previous_paths,
        settings.previous_label,
        trace_numbers=settings.trace_numbers,
        slot_mapping=slot_mapping,
        add_esp_year=settings.add_esp_year,
    )
    current.preload(preload_slots)
    previous.preload(preload_slots)
    result = compare_readers(current, previous, settings)
    _attach_custom_slot_comparisons(
        result, current, previous, settings, custom_slots, custom_slot_statistic
    )

    # Report plots may intentionally include deterministic RiverWare traces that
    # are excluded from CRMMS calculations. Build a separate, tolerant adapter
    # for the union of plot traces; missing deterministic traces in one run stay
    # as gaps instead of invalidating report calculations.
    if custom_plots:
        plot_trace_numbers: list[int] = []
        seen_plot_traces: set[int] = set()
        for spec in custom_plots:
            requested = spec.get("trace_numbers") or settings.trace_numbers
            for value in requested:
                number = int(value)
                if number not in seen_plot_traces:
                    seen_plot_traces.add(number)
                    plot_trace_numbers.append(number)
        plot_current = RDFRunReader(
            current_paths,
            settings.current_label,
            trace_numbers=plot_trace_numbers,
            slot_mapping=slot_mapping,
            add_esp_year=settings.add_esp_year,
            allow_missing_traces=True,
        )
        plot_previous = RDFRunReader(
            previous_paths,
            settings.previous_label,
            trace_numbers=plot_trace_numbers,
            slot_mapping=slot_mapping,
            add_esp_year=settings.add_esp_year,
            allow_missing_traces=True,
        )
        plot_slots = [
            str(spec.get("slot") or "").strip()
            for spec in custom_plots
            if isinstance(spec, dict) and str(spec.get("slot") or "").strip()
        ]
        plot_current.preload(plot_slots)
        plot_previous.preload(plot_slots)
        _attach_custom_slot_plots(result, plot_current, plot_previous, settings, custom_plots)
    else:
        result["custom_slot_plots"] = []
        result["meta"]["custom_plot_count"] = 0
        result["meta"]["custom_plot_skipped"] = []
        result["meta"]["custom_plot_skipped_count"] = 0
    return result
