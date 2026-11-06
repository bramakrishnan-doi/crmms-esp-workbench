"""Generic RiverWare RDF reader for Python.

This module is intentionally focused on the line-oriented RiverWare ``.rdf``
format used by RWDataPlyr.  It is a native-Python implementation: R and
RWDataPlyr are not required at runtime.

Key design goals
----------------
* Slot names are caller-supplied; nothing is hard-coded to Powell/Mead.
* Monthly and annual timesteps are preserved instead of coerced to one shape.
* RiverWare trace numbers are preserved exactly.
* The CRMMS Trace 4 -> ESP 1991 ... Trace 33 -> ESP 2020 mapping is optional
  enrichment, not part of RDF parsing.
* Scalar slots are expanded across the run timesteps, matching RWDataPlyr's
  tabular behavior.
* The RDF ``scale`` is retained. By default ``value`` is ``raw_value * scale``.

The parser was derived from the public-domain RWDataPlyr 0.6.6 implementation
(CC0; U.S. Bureau of Reclamation) and validated against its sample RDF formats.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any
import argparse
import copy
import json
import math
import os
import re
import threading

import pandas as pd


__all__ = [
    "CRMMS_ESP_MAPPING",
    "RDFFormatError",
    "clear_rdf_cache",
    "describe_rdf",
    "inspect_rdf",
    "list_rdf_slots",
    "read_rdf",
    "trace_to_esp",
]


CRMMS_ESP_MAPPING: dict[int, int] = {trace: 1987 + trace for trace in range(4, 34)}


# Discovery metadata is small (one row per Object.Slot, never the values), so a
# bounded in-memory cache can avoid rescanning the same RDF for Run A, Run B,
# custom plots, and Explorer requests.  Entries are keyed by the resolved path,
# file size, and modification time; replacing a file invalidates its entry.
_INSPECTION_CACHE_LIMIT = 64
_inspection_cache: "OrderedDict[tuple[str, int, int], tuple[dict[str, Any], pd.DataFrame]]" = OrderedDict()
_inspection_cache_lock = threading.Lock()


class RDFFormatError(ValueError):
    """Raised when an RDF file does not match the expected RiverWare layout."""


@dataclass(frozen=True)
class _RunContext:
    run_index: int
    trace_number: int
    timesteps: tuple[str, ...]
    time_step_unit: str | None
    time_step_quantity: int | float | None
    rule_set: str | None
    slot_set: str | None
    start: str | None
    end: str | None


def _split_pair(line: str) -> tuple[str, str | None]:
    """Split a RiverWare ``name:value`` line at the first colon only."""
    if ":" not in line:
        return line.strip(), None
    key, value = line.split(":", 1)
    return key.strip(), value.lstrip()


def _coerce_number(text: str, *, field: str, line_number: int | None = None) -> float:
    try:
        return float(text.strip())
    except Exception as exc:  # pragma: no cover - message path
        where = f" at line {line_number}" if line_number is not None else ""
        raise RDFFormatError(f"Invalid numeric {field}{where}: {text!r}") from exc


def _coerce_int(text: str, *, field: str) -> int:
    try:
        return int(float(text.strip()))
    except Exception as exc:
        raise RDFFormatError(f"Invalid integer {field}: {text!r}") from exc


def _normalize_timestep_type(unit: str | None, quantity: int | float | None) -> str | None:
    if unit is None:
        return None
    u = unit.strip().lower()
    q = 1 if quantity in (None, 1, 1.0) else quantity
    if u in {"month", "months"} and q == 1:
        return "monthly"
    if u in {"year", "years"} and q == 1:
        return "annual"
    if u in {"day", "days"} and q == 1:
        return "daily"
    if u in {"hour", "hours"} and q == 1:
        return "hourly"
    if u in {"minute", "minutes"} and q == 1:
        return "minutely"
    return f"{q:g}-{u}" if isinstance(q, (int, float)) else u


@lru_cache(maxsize=32768)
def _parse_period_parts(timestep: str, timestep_type: str | None) -> tuple[pd.Timestamp | pd.NaT, int | None, int | None, int | None]:
    """Parse the date label without changing RiverWare ``24:00`` semantics.

    RiverWare commonly writes month/year endpoints as e.g. ``2026-7-31 24:00``.
    Converting that literally to a timestamp would move it into the next day,
    and sometimes the next month/year.  We therefore parse only the date token
    for ``period_date`` and keep the original string in ``timestep``.
    """
    token = timestep.strip().split()[0] if timestep.strip() else ""
    match = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", token)
    if not match:
        return pd.NaT, None, None, None
    year, month, day = map(int, match.groups())
    try:
        period_date = pd.Timestamp(year=year, month=month, day=day)
    except ValueError:
        period_date = pd.NaT
    # For annual series, month is intentionally NA. The printed date is still
    # available in period_date/timestep, but callers should not interpret the
    # annual endpoint (usually Dec 31) as a monthly observation.
    output_month = None if timestep_type == "annual" else month
    return period_date, year, output_month, day


def _normalize_slots(slots: str | Iterable[str] | None) -> list[str] | None:
    if slots is None:
        return None
    if isinstance(slots, str):
        slots = [slots]
    out: list[str] = []
    seen: set[str] = set()
    for slot in slots:
        s = str(slot).strip()
        if not s:
            raise ValueError("Slot names cannot be empty.")
        if s not in seen:
            seen.add(s)
            out.append(s)
    if not out:
        raise ValueError("At least one slot must be supplied when slots is not None.")
    return out


def _normalize_traces(traces: int | Iterable[int] | None) -> set[int] | None:
    if traces is None:
        return None
    if isinstance(traces, int):
        return {int(traces)}
    out = {int(x) for x in traces}
    if not out:
        raise ValueError("traces cannot be an empty iterable.")
    return out


def trace_to_esp(
    trace_number: int | float | str,
    mapping: Mapping[int, int] | None = None,
) -> int | None:
    """Return an ESP year for a RiverWare trace number.

    By default the CRMMS mapping is used:
    Trace 4 -> ESP 1991, ..., Trace 33 -> ESP 2020.
    Unmapped traces return ``None``.
    """
    m = CRMMS_ESP_MAPPING if mapping is None else mapping
    try:
        trace = int(trace_number)
    except (TypeError, ValueError):
        return None
    value = m.get(trace)
    return int(value) if value is not None else None


def _read_all_lines(path: str | Path) -> tuple[Path, list[str]]:
    p = Path(path)
    if p.suffix.lower() != ".rdf":
        raise ValueError(f"Expected a .rdf file, got: {p}")
    if not p.is_file():
        raise FileNotFoundError(p)
    # utf-8-sig handles an optional BOM; replace is safer for legacy paths in
    # metadata while leaving the numeric body intact.  Universal-newline mode
    # already normalizes CRLF, so splitlines() avoids a per-line rstrip().
    with p.open("r", encoding="utf-8-sig", errors="replace", newline=None) as fh:
        lines = fh.read().splitlines()
    return p, lines


def _parse_meta(lines: list[str]) -> tuple[dict[str, str | None], int]:
    meta: dict[str, str | None] = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if line == "END_PACKAGE_PREAMBLE":
            return meta, i
        if not line.strip():
            continue
        key, value = _split_pair(line)
        meta[key] = value
    raise RDFFormatError("END_PACKAGE_PREAMBLE was not found.")


def _parse_run_header(lines: list[str], i: int, run_index: int) -> tuple[_RunContext, int]:
    header: dict[str, str | None] = {}
    while i < len(lines):
        line = lines[i]
        i += 1
        if line == "END_RUN_PREAMBLE":
            break
        if not line.strip():
            continue
        key, value = _split_pair(line)
        header[key] = value
    else:
        raise RDFFormatError(f"Run {run_index}: END_RUN_PREAMBLE was not found.")

    n_text = header.get("time_steps") or header.get("timesteps")
    if n_text is None:
        raise RDFFormatError(f"Run {run_index}: time_steps/timesteps is missing.")
    n_steps = _coerce_int(n_text, field="time_steps")
    if n_steps < 0:
        raise RDFFormatError(f"Run {run_index}: time_steps cannot be negative.")
    if i + n_steps > len(lines):
        raise RDFFormatError(f"Run {run_index}: RDF ends before all timesteps are read.")

    timesteps = tuple(lines[i : i + n_steps])
    i += n_steps

    trace_text = header.get("trace_num") or header.get("trace") or header.get("run_number")
    trace_number = run_index if trace_text is None else _coerce_int(trace_text, field="trace number")

    quantity_text = header.get("unit_quantity")
    quantity: int | float | None = None
    if quantity_text not in (None, ""):
        q = _coerce_number(quantity_text, field="unit_quantity")
        quantity = int(q) if q.is_integer() else q

    context = _RunContext(
        run_index=run_index,
        trace_number=trace_number,
        timesteps=timesteps,
        time_step_unit=header.get("time_step_unit"),
        time_step_quantity=quantity,
        rule_set=header.get("rule_set"),
        slot_set=header.get("slot_set"),
        start=header.get("start"),
        end=header.get("end"),
    )
    return context, i


def _parse_slot_header(lines: list[str], i: int, run_index: int) -> tuple[dict[str, str | None], int]:
    header: dict[str, str | None] = {}
    while i < len(lines):
        line = lines[i]
        i += 1
        if line == "END_SLOT_PREAMBLE":
            return header, i
        if line == "END_RUN":
            raise RDFFormatError(
                f"Run {run_index}: encountered END_RUN before END_SLOT_PREAMBLE."
            )
        if not line.strip():
            continue
        key, value = _split_pair(line)
        header[key] = value
    raise RDFFormatError(f"Run {run_index}: END_SLOT_PREAMBLE was not found.")


def _read_units_scale_values(
    lines: list[str],
    i: int,
    *,
    run_index: int,
    object_slot: str,
    store_values: bool,
) -> tuple[str | None, float, list[str], int, int]:
    if i >= len(lines):
        raise RDFFormatError(f"Run {run_index}, {object_slot}: unexpected end of file after slot header.")

    key, unit = _split_pair(lines[i])
    i += 1
    if key != "units":
        raise RDFFormatError(
            f"Run {run_index}, {object_slot}: expected 'units:' after END_SLOT_PREAMBLE, got {key!r}."
        )

    if i >= len(lines):
        raise RDFFormatError(f"Run {run_index}, {object_slot}: scale line is missing.")
    key, scale_text = _split_pair(lines[i])
    i += 1
    if key != "scale" or scale_text is None:
        raise RDFFormatError(
            f"Run {run_index}, {object_slot}: expected 'scale:' after units, got {key!r}."
        )
    scale = _coerce_number(scale_text, field="scale", line_number=i)

    # Discovery only needs the number of values, not their contents.  The same
    # applies to slots/traces that read_rdf() will discard, so avoid building
    # large temporary string lists whenever possible.
    values: list[str] = []
    value_count = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if line == "END_SLOT":
            return unit, scale, values, value_count, i
        if line == "END_COLUMN":
            continue
        # splitlines() leaves blank lines as ''; isspace() is a fast way to
        # reject whitespace-only lines without allocating a stripped copy.
        if not line or line.isspace():
            continue
        value_count += 1
        if store_values:
            values.append(line.strip())
    raise RDFFormatError(f"Run {run_index}, {object_slot}: END_SLOT was not found.")


def _scan(path: str | Path, *, collect_rows: bool, slots: list[str] | None = None, traces: set[int] | None = None, apply_scale: bool = True) -> tuple[dict[str, str | None], list[dict[str, Any]], list[dict[str, Any]], set[int], set[str]]:
    _, lines = _read_all_lines(path)
    meta, i = _parse_meta(lines)
    expected_runs_text = meta.get("number_of_runs")
    expected_runs = _coerce_int(expected_runs_text, field="number_of_runs") if expected_runs_text else None

    wanted_slots = set(slots) if slots is not None else None
    rows: list[dict[str, Any]] = []
    slot_records: list[dict[str, Any]] = []
    seen_traces: set[int] = set()
    seen_slots: set[str] = set()
    run_index = 0

    while i < len(lines) and (expected_runs is None or run_index < expected_runs):
        # Ignore blank separators if a writer added them.
        while i < len(lines) and not lines[i].strip():
            i += 1
        if i >= len(lines):
            break

        run_index += 1
        ctx, i = _parse_run_header(lines, i, run_index)
        seen_traces.add(ctx.trace_number)
        selected_trace = traces is None or ctx.trace_number in traces
        timestep_type = _normalize_timestep_type(ctx.time_step_unit, ctx.time_step_quantity)
        # Discovery (collect_rows=False) never needs period dates, so parse
        # them only when at least one slot on this run is actually collected.
        period_parts = None

        while i < len(lines):
            while i < len(lines) and not lines[i].strip():
                i += 1
            if i >= len(lines):
                break
            if lines[i] == "END_RUN":
                i += 1
                break

            slot_header, i = _parse_slot_header(lines, i, run_index)
            object_name = slot_header.get("object_name")
            slot_name = slot_header.get("slot_name")
            if not object_name or not slot_name:
                raise RDFFormatError(
                    f"Run {run_index}: slot preamble is missing object_name or slot_name."
                )
            object_slot = f"{object_name}.{slot_name}"
            wants_row = (
                collect_rows
                and selected_trace
                and (wanted_slots is None or object_slot in wanted_slots)
            )
            unit, scale, value_strings, value_count, i = _read_units_scale_values(
                lines,
                i,
                run_index=run_index,
                object_slot=object_slot,
                store_values=wants_row,
            )
            seen_slots.add(object_slot)

            is_scalar = value_count == 1 and len(ctx.timesteps) != 1
            if value_count != 1 and value_count != len(ctx.timesteps):
                raise RDFFormatError(
                    f"Run {run_index}, {object_slot}: expected 1 scalar value or "
                    f"{len(ctx.timesteps)} timestep values; found {value_count}."
                )

            if selected_trace:
                slot_records.append(
                    {
                        "object_slot": object_slot,
                        "object_name": object_name,
                        "slot_name": slot_name,
                        "object_type": slot_header.get("object_type"),
                        "slot_type": slot_header.get("slot_type"),
                        "unit": unit,
                        "scale": scale,
                        "time_step_unit": ctx.time_step_unit,
                        "time_step_quantity": ctx.time_step_quantity,
                        "timestep_type": timestep_type,
                        "trace_number": ctx.trace_number,
                        "is_scalar": is_scalar,
                    }
                )

            if not wants_row:
                continue

            if period_parts is None:
                period_parts = [
                    _parse_period_parts(ts, timestep_type) for ts in ctx.timesteps
                ]

            expanded_values = (
                value_strings * len(ctx.timesteps)
                if value_count == 1
                else value_strings
            )
            numeric_values = [
                _coerce_number(v, field=f"value for {object_slot}") for v in expanded_values
            ]
            for step_index, (timestep, raw_value, parts) in enumerate(
                zip(ctx.timesteps, numeric_values, period_parts), start=1
            ):
                period_date, year, month, day = parts
                value = raw_value * scale if apply_scale else raw_value
                rows.append(
                    {
                        "timestep": timestep,
                        "period_date": period_date,
                        "year": year,
                        "month": month,
                        "day": day,
                        "timestep_index": step_index,
                        "timestep_type": timestep_type,
                        "time_step_unit": ctx.time_step_unit,
                        "time_step_quantity": ctx.time_step_quantity,
                        "trace_number": ctx.trace_number,
                        "object_name": object_name,
                        "slot_name": slot_name,
                        "object_type": slot_header.get("object_type"),
                        "slot_type": slot_header.get("slot_type"),
                        "object_slot": object_slot,
                        "raw_value": raw_value,
                        "scale": scale,
                        "value": value,
                        "unit": unit,
                        "is_scalar": is_scalar,
                        "ruleset_file_name": ctx.rule_set,
                        "input_dmi_name": ctx.slot_set,
                        "run_start": ctx.start,
                        "run_end": ctx.end,
                    }
                )

    if expected_runs is not None and run_index != expected_runs:
        raise RDFFormatError(
            f"RDF metadata says number_of_runs={expected_runs}, but {run_index} runs were parsed."
        )
    return meta, rows, slot_records, seen_traces, seen_slots


def read_rdf(
    path: str | Path,
    slots: str | Iterable[str] | None = None,
    traces: int | Iterable[int] | None = None,
    *,
    add_esp_year: bool = True,
    esp_mapping: Mapping[int, int] | None = None,
    strict_slots: bool = True,
    apply_scale: bool = True,
) -> pd.DataFrame:
    """Read selected RiverWare RDF slots into a tidy pandas DataFrame.

    Parameters
    ----------
    path:
        Path to a RiverWare ``.rdf`` file.
    slots:
        One ``Object.Slot`` name or an iterable of names. ``None`` reads every
        slot in the file. Slot matching is exact and case-sensitive.
    traces:
        One trace number or an iterable of trace numbers. ``None`` reads every
        trace. The RDF's actual trace number is preserved.
    add_esp_year:
        Add nullable ``esp_year`` using the mapping supplied in ``esp_mapping``.
        By default this uses the CRMMS Trace 4 -> ESP 1991 ... Trace 33 -> 2020
        mapping. Traces outside the mapping receive ``NA``.
    esp_mapping:
        Optional custom ``{trace_number: esp_year}`` mapping. ``None`` means use
        ``CRMMS_ESP_MAPPING`` when ``add_esp_year=True``.
    strict_slots:
        If ``True``, raise ``KeyError`` when any requested slot is absent.
    apply_scale:
        If ``True`` (default), ``value = raw_value * scale``. The unscaled
        ``raw_value`` and the RDF ``scale`` are always retained.

    Returns
    -------
    pandas.DataFrame
        Tidy rows with timestep, slot, trace, value, unit, and timestep
        metadata. Monthly and annual series remain distinguishable through
        ``timestep_type``/``time_step_unit``. For annual data, ``month`` is NA.

    Notes
    -----
    RiverWare often uses timestamps such as ``2026-7-31 24:00``. The exact
    string is preserved in ``timestep``. ``period_date`` uses the printed date
    portion without rolling ``24:00`` into the next day.
    """
    normalized_slots = _normalize_slots(slots)
    normalized_traces = _normalize_traces(traces)

    _, rows, _, seen_traces, seen_slots = _scan(
        path,
        collect_rows=True,
        slots=normalized_slots,
        traces=normalized_traces,
        apply_scale=apply_scale,
    )

    if normalized_traces is not None:
        missing_traces = sorted(normalized_traces - seen_traces)
        if missing_traces:
            raise KeyError(f"Requested trace number(s) not found in RDF: {missing_traces}")

    if normalized_slots is not None and strict_slots:
        missing_slots = [slot for slot in normalized_slots if slot not in seen_slots]
        if missing_slots:
            available_preview = sorted(seen_slots)[:20]
            suffix = " ..." if len(seen_slots) > 20 else ""
            raise KeyError(
                "Requested slot(s) not found in RDF: "
                + ", ".join(repr(x) for x in missing_slots)
                + ". Available slots include: "
                + ", ".join(available_preview)
                + suffix
            )

    columns = [
        "timestep",
        "period_date",
        "year",
        "month",
        "day",
        "timestep_index",
        "timestep_type",
        "time_step_unit",
        "time_step_quantity",
        "trace_number",
        "object_name",
        "slot_name",
        "object_type",
        "slot_type",
        "object_slot",
        "raw_value",
        "scale",
        "value",
        "unit",
        "is_scalar",
        "ruleset_file_name",
        "input_dmi_name",
        "run_start",
        "run_end",
    ]
    df = pd.DataFrame.from_records(rows, columns=columns)

    if not df.empty:
        df["year"] = pd.array(df["year"], dtype="Int64")
        df["month"] = pd.array(df["month"], dtype="Int64")
        df["day"] = pd.array(df["day"], dtype="Int64")
        df["timestep_index"] = pd.array(df["timestep_index"], dtype="Int64")
        df["trace_number"] = pd.array(df["trace_number"], dtype="Int64")

    if add_esp_year:
        mapping = CRMMS_ESP_MAPPING if esp_mapping is None else esp_mapping
        if df.empty:
            df["esp_year"] = pd.Series(dtype="Int64")
        else:
            df["esp_year"] = pd.array(
                [mapping.get(int(t)) for t in df["trace_number"]], dtype="Int64"
            )
        # Put the enrichment immediately after trace_number.
        cols = list(df.columns)
        cols.insert(cols.index("trace_number") + 1, cols.pop(cols.index("esp_year")))
        df = df[cols]

    return df


def _slot_records_to_dataframe(records: list[dict[str, Any]]) -> pd.DataFrame:
    """Convert raw scan slot records into one row per unique Object.Slot.

    Keeping this transformation separate lets discovery obtain the RDF
    description and slot table from one _scan() instead of scanning the
    same RDF repeatedly.  Aggregation is done directly in Python: pandas
    groupby added noticeable overhead for the small number of metadata fields
    that discovery actually needs.
    """
    columns = [
        "object_slot",
        "object_name",
        "slot_name",
        "object_type",
        "slot_type",
        "units",
        "scales",
        "timestep_types",
        "time_step_units",
        "time_step_quantities",
        "trace_count",
        "has_scalar",
    ]
    if not records:
        return pd.DataFrame(columns=columns)

    def add_unique(values: list[Any], value: Any) -> None:
        marker = None if pd.isna(value) else value
        if marker not in values:
            values.append(marker)

    groups: dict[str, dict[str, Any]] = {}
    for rec in records:
        object_slot = str(rec["object_slot"])
        group = groups.get(object_slot)
        if group is None:
            group = {
                "object_name": rec.get("object_name"),
                "slot_name": rec.get("slot_name"),
                "object_type": rec.get("object_type"),
                "slot_type": rec.get("slot_type"),
                "units": [],
                "scales": [],
                "timestep_types": [],
                "time_step_units": [],
                "time_step_quantities": [],
                "trace_numbers": set(),
                "has_scalar": False,
            }
            groups[object_slot] = group

        add_unique(group["units"], rec.get("unit"))
        add_unique(group["scales"], rec.get("scale"))
        add_unique(group["timestep_types"], rec.get("timestep_type"))
        add_unique(group["time_step_units"], rec.get("time_step_unit"))
        add_unique(group["time_step_quantities"], rec.get("time_step_quantity"))
        trace_number = rec.get("trace_number")
        if trace_number is not None and not pd.isna(trace_number):
            group["trace_numbers"].add(int(trace_number))
        if rec.get("is_scalar"):
            group["has_scalar"] = True

    rows: list[dict[str, Any]] = []
    for object_slot in sorted(groups):
        group = groups[object_slot]
        rows.append(
            {
                "object_slot": object_slot,
                "object_name": group["object_name"],
                "slot_name": group["slot_name"],
                "object_type": group["object_type"],
                "slot_type": group["slot_type"],
                "units": tuple(group["units"]),
                "scales": tuple(group["scales"]),
                "timestep_types": tuple(group["timestep_types"]),
                "time_step_units": tuple(group["time_step_units"]),
                "time_step_quantities": tuple(group["time_step_quantities"]),
                "trace_count": len(group["trace_numbers"]),
                "has_scalar": group["has_scalar"],
            }
        )

    return pd.DataFrame(rows, columns=columns)


def _rdf_cache_key(path: Path) -> tuple[str, int, int]:
    """Return a stable cache key that changes whenever the file changes."""
    resolved = path.resolve()
    stat = resolved.stat()
    return (
        os.path.normcase(str(resolved)),
        int(stat.st_size),
        int(stat.st_mtime_ns),
    )


def clear_rdf_cache() -> None:
    """Discard all cached RDF discovery metadata.

    Normal callers do not need this: the cache key includes file size and
    modification time.  It is useful for tests or after bulk file replacement
    where an explicit reset is clearer.
    """
    with _inspection_cache_lock:
        _inspection_cache.clear()


def _clone_inspection(
    description: dict[str, Any],
    slots: pd.DataFrame,
    path: Path,
) -> tuple[dict[str, Any], pd.DataFrame]:
    cloned_description = copy.deepcopy(description)
    # Preserve the caller's path spelling, which may differ from the resolved
    # path used for the cache key.
    cloned_description["path"] = str(path)
    return cloned_description, slots.copy()


def _build_inspection(path: Path) -> tuple[dict[str, Any], pd.DataFrame]:
    meta, _, records, seen_traces, seen_slots = _scan(
        path,
        collect_rows=False,
    )

    slots = _slot_records_to_dataframe(records)

    timestep_units = sorted(
        {
            str(r["time_step_unit"])
            for r in records
            if r.get("time_step_unit") is not None
        }
    )

    timestep_types = sorted(
        {
            str(r["timestep_type"])
            for r in records
            if r.get("timestep_type") is not None
        }
    )

    description = {
        "path": str(path),
        "name": meta.get("name"),
        "owner": meta.get("owner"),
        "description": meta.get("description"),
        "create_date": meta.get("create_date"),
        "number_of_runs": (
            int(meta["number_of_runs"])
            if meta.get("number_of_runs")
            else len(seen_traces)
        ),
        "trace_numbers": sorted(seen_traces),
        "slot_count": len(seen_slots),
        "slots": sorted(seen_slots),
        "time_step_units": timestep_units,
        "timestep_types": timestep_types,
    }

    return description, slots


def _cached_inspection(path: Path) -> tuple[dict[str, Any], pd.DataFrame]:
    key = _rdf_cache_key(path)

    with _inspection_cache_lock:
        cached = _inspection_cache.get(key)
        if cached is not None:
            _inspection_cache.move_to_end(key)
            description, slots = cached
            return _clone_inspection(description, slots, path)

    # Build outside the lock so one large RDF cannot block cache lookups for
    # unrelated files.  Concurrent misses may duplicate work, but the result
    # stored first wins and remains correct.
    description, slots = _build_inspection(path)

    with _inspection_cache_lock:
        existing = _inspection_cache.get(key)
        if existing is None:
            _inspection_cache[key] = (copy.deepcopy(description), slots.copy())
            if len(_inspection_cache) > _INSPECTION_CACHE_LIMIT:
                _inspection_cache.popitem(last=False)
        else:
            _inspection_cache.move_to_end(key)
            description, slots = existing

    return _clone_inspection(description, slots, path)


def _validate_rdf_path(path: Path) -> None:
    if path.suffix.lower() != ".rdf":
        raise ValueError(f"Expected a .rdf file, got: {path}")
    if not path.is_file():
        raise FileNotFoundError(path)


def list_rdf_slots(path: str | Path) -> pd.DataFrame:
    """Return one row per unique RDF Object.Slot with observed metadata.

    This scans all runs so it can report metadata differences across traces.
    ``units``, ``scales``, and timestep fields are represented as tuples when
    more than one distinct value is observed.

    Results are cached by file path, size, and modification time, so repeated
    callers (for example Run A, Run B, and custom plot readers sharing the same
    file) reuse a single scan.
    """
    p = Path(path)
    _validate_rdf_path(p)
    _, slots = _cached_inspection(p)
    return slots


def inspect_rdf(
    path: str | Path,
) -> tuple[dict[str, Any], pd.DataFrame]:
    """Inspect an RDF once and return both description and slot metadata.

    This is the preferred function for application discovery because the
    historical combination of::

        describe_rdf(path)
        list_rdf_slots(path)

    scanned the same potentially large RDF multiple times.  Results are cached
    by file path, size, and modification time, so the comparison and Explorer
    paths also share one scan when they request the same file.

    Returns
    -------
    tuple
        ``(description, slots_dataframe)``
    """
    p = Path(path)
    _validate_rdf_path(p)
    return _cached_inspection(p)


def describe_rdf(path: str | Path) -> dict[str, Any]:
    """Return JSON-friendly file metadata and structural information.

    For callers that also need slot metadata, use inspect_rdf() so the
    RDF only needs to be scanned once.
    """
    description, _ = inspect_rdf(path)
    return description


def _parse_trace_cli(text: str) -> list[int]:
    """Parse CLI trace expressions such as '4-33,40,42'."""
    out: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
            step = 1 if end >= start else -1
            out.extend(range(start, end + step, step))
        else:
            out.append(int(part))
    return out


def _main() -> None:
    parser = argparse.ArgumentParser(description="Read RiverWare RDF files without R.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_desc = sub.add_parser("describe", help="Print RDF metadata as JSON.")
    p_desc.add_argument("rdf")

    p_slots = sub.add_parser("slots", help="List available Object.Slot names.")
    p_slots.add_argument("rdf")

    p_extract = sub.add_parser("extract", help="Extract slots to CSV or Parquet.")
    p_extract.add_argument("rdf")
    p_extract.add_argument("--slot", action="append", dest="slots", help="Exact Object.Slot name; repeatable.")
    p_extract.add_argument("--traces", help="Trace list/range, e.g. 4-33 or 4-10,20.")
    p_extract.add_argument("--no-esp", action="store_true", help="Do not add the CRMMS esp_year column.")
    p_extract.add_argument("--raw-scale", action="store_true", help="Use unscaled RDF values for the value column.")
    p_extract.add_argument("-o", "--output", required=True, help=".csv or .parquet output path.")

    args = parser.parse_args()
    if args.command == "describe":
        print(json.dumps(describe_rdf(args.rdf), indent=2))
        return
    if args.command == "slots":
        with pd.option_context("display.max_rows", None, "display.max_colwidth", 100):
            print(list_rdf_slots(args.rdf).to_string(index=False))
        return

    traces = _parse_trace_cli(args.traces) if args.traces else None
    df = read_rdf(
        args.rdf,
        slots=args.slots,
        traces=traces,
        add_esp_year=not args.no_esp,
        apply_scale=not args.raw_scale,
    )
    out = Path(args.output)
    if out.suffix.lower() == ".csv":
        df.to_csv(out, index=False)
    elif out.suffix.lower() in {".parquet", ".pq"}:
        df.to_parquet(out, index=False)
    else:
        raise SystemExit("Output must end in .csv, .parquet, or .pq")
    print(f"Wrote {len(df):,} rows to {out}")


if __name__ == "__main__":
    _main()
