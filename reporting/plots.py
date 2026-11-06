from __future__ import annotations

from io import BytesIO
from math import ceil
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch, Rectangle

TIER_COLORS = {
    "LEBT": "#CC6666",
    "MERT": "#E69F00",
    "UEBT": "#33CC33",
    "Eq": "#0072B2",
    "Unavailable": "#999999",
}
CONDITION_COLORS = {
    "Surplus": "#ddd6ac",
    "Normal": "#0072B2",
    "Shortage - Level 1": "#33CC33",
    "Shortage - Level 2": "#E69F00",
    "Shortage - Level 3": "#CC6666",
    "Unavailable": "#999999",
}


def _png(fig: plt.Figure, *, dpi: int = 220) -> bytes:
    out = BytesIO()
    fig.savefig(out, format="png", dpi=dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return out.getvalue()


def _gg_axes(ax: plt.Axes) -> None:
    ax.set_facecolor("#EBEBEB")
    ax.grid(True, axis="both", color="white", linewidth=0.8)
    ax.set_axisbelow(True)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(length=0, labelsize=8)


def render_powell_inflow(series: dict[str, Any]) -> bytes:
    points = sorted(series["points"], key=lambda p: p["inflow"])
    labels = [str(p.get("trace_label") or p.get("trace_year") or p.get("trace_number")) for p in points]
    values = [p["inflow"] for p in points]
    colors = [TIER_COLORS.get(p["tier"], TIER_COLORS["Unavailable"]) for p in points]

    fig, ax = plt.subplots(figsize=(9.8, 5.2))
    _gg_axes(ax)
    x = list(range(len(points)))
    ax.bar(x, values, color=colors, width=0.88, edgecolor="white", linewidth=0.35)
    ax.set_xticks(x, labels, rotation=90, fontsize=7)
    ax.set_xlabel("Hydrologic Trace", fontsize=10)
    ax.set_ylabel("Powell Unregulated Inflow (1,000 AF)", fontsize=10)
    ax.set_title(
        f"Annual Powell Inflow Analysis based on WY {series['inflow_year']} Inflow Volumes",
        loc="left",
        fontsize=11,
        pad=8,
    )

    p10 = float(series["historic_p10"])
    avg = float(series["historic_average"])
    p90 = float(series["historic_p90"])
    ax.axhline(p10, color="black", linestyle=(0, (3, 3)), linewidth=0.8)
    ax.axhline(p90, color="black", linestyle=(0, (3, 3)), linewidth=0.8)
    ax.axhline(avg, color="darkred", linewidth=0.8)
    xmax = len(points) - 0.5
    ax.text(-0.45, p10 + 100, "Historic 10th Percentile", fontsize=7, va="bottom")
    ax.text(-0.45, avg + 100, "Historic Average", fontsize=7, va="bottom")
    ax.text(-0.45, p90 + 100, "Historic 90th Percentile", fontsize=7, va="bottom")
    ymax = max(max(values, default=0), p90) * 1.06
    ax.set_ylim(0, max(16000, ceil(ymax / 1000) * 1000))
    ax.set_xlim(-0.55, xmax)

    present = [k for k in ["LEBT", "MERT", "UEBT", "Eq"] if any(p["tier"] == k for p in points)]
    handles = [Patch(facecolor=TIER_COLORS[k], edgecolor="none", label=k) for k in present]
    if handles:
        ax.legend(
            handles=handles,
            title=f"WY {series['operating_year']} Operating Tier",
            loc="center left",
            bbox_to_anchor=(1.01, 0.5),
            frameon=False,
            fontsize=8,
            title_fontsize=8,
        )
    fig.subplots_adjust(right=0.80, bottom=0.23)
    return _png(fig)


def render_mead_flow(series: dict[str, Any], index: int = 0) -> bytes:
    points = sorted(series["points"], key=lambda p: p["inflow"])
    labels = [str(p.get("trace_label") or p.get("trace_year") or p.get("trace_number")) for p in points]
    inflow = [p["inflow"] for p in points]
    outflow = [p["outflow"] for p in points]
    colors = [CONDITION_COLORS.get(p["condition"], CONDITION_COLORS["Unavailable"]) for p in points]

    fig, ax = plt.subplots(figsize=(10.4, 5.2))
    _gg_axes(ax)
    # Reserve a dedicated legend column inside the image so long labels never clip.
    ax.set_position([0.08, 0.20, 0.63, 0.70])
    x = list(range(len(points)))
    ax.bar(x, inflow, color=colors, edgecolor="black", linewidth=0.55, width=0.88, zorder=2)
    ax.bar(
        x, outflow, color=colors, edgecolor="black", linewidth=0.55, width=0.88,
        hatch="///", alpha=0.34, zorder=3,
    )
    ax.set_xticks(x, labels, rotation=90, fontsize=7)
    ax.set_xlabel("Hydrologic Trace", fontsize=10)
    ax.set_ylabel("Mead Inflow (1,000 AF)", fontsize=10)
    ax.set_title(
        f"Annual Mead Analysis based on CY {series['flow_year']} Inflow and Outflow Volumes",
        loc="left", fontsize=11, pad=8,
    )
    lower = 5000
    data_max = max(inflow + outflow + [lower])
    default_top = 11000 if index == 0 else 14000
    top = max(default_top, int(ceil(data_max / 1000.0) * 1000))
    ax.set_ylim(lower, top)
    ax.set_yticks(list(range(lower, top + 1, 2000)))
    ax.set_xlim(-0.55, len(points) - 0.45)

    condition_order = ["Surplus", "Normal", "Shortage - Level 1", "Shortage - Level 2", "Shortage - Level 3"]
    present = [k for k in condition_order if any(p["condition"] == k for p in points)]
    condition_handles = [Patch(facecolor=CONDITION_COLORS[k], edgecolor="black", linewidth=0.4, label=k) for k in present]
    fig.legend(
        handles=condition_handles,
        title=f"CY {series['condition_year']} Operating Condition",
        loc="upper left", bbox_to_anchor=(0.73, 0.70),
        frameon=False, fontsize=7.3, title_fontsize=7.8, borderaxespad=0,
    )
    flow_handles = [
        Patch(facecolor="white", edgecolor="black", label="Inflow"),
        Patch(facecolor="white", edgecolor="black", hatch="///", alpha=0.45, label="Outflow"),
    ]
    fig.legend(
        handles=flow_handles, title="Flow",
        loc="upper left", bbox_to_anchor=(0.73, 0.40),
        frameon=False, fontsize=7.3, title_fontsize=7.8, borderaxespad=0,
    )
    return _png(fig)


def render_lower_basin(flow: dict[str, Any], meta: dict[str, Any], caption: str | None = None) -> bytes:
    years = flow["lower_basin_conditions"]
    order = flow["condition_order"]
    n = max(len(years), 1)
    trace_count = int(meta.get("trace_count") or 30)
    fig, ax = plt.subplots(figsize=(10.4, 5.3))
    ax.set_facecolor("white")
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.grid(True, axis="y", color="#dddddd", linewidth=0.7)
    ax.set_axisbelow(True)

    width = 0.72
    xticks: list[float] = []
    xlabels: list[str] = []
    for yi, item in enumerate(years):
        base = yi * 2.5
        # Shade years after 2026 like the source report.
        if item["year"] > 2026:
            ax.add_patch(Rectangle((base - 0.55, 0), 2.1, trace_count + 5, facecolor="black", alpha=0.03, edgecolor="none", zorder=0))
        ax.add_patch(Rectangle((base - 0.55, trace_count), 2.1, 2.1, facecolor="#D9D9D9", edgecolor="#777777", linewidth=0.5, zorder=1))
        ax.text(base + 0.5, trace_count + 1.0, str(item["year"]), ha="center", va="center", fontsize=8)
        for j, key in enumerate(("current", "previous")):
            x = base + j
            bottom = 0
            counts = item[key]
            for cond in order:
                value = counts.get(cond, 0)
                ax.bar(x, value, bottom=bottom, width=width, color=CONDITION_COLORS[cond], edgecolor="none", zorder=2)
                bottom += value
            xticks.append(x)
            xlabels.append(meta["current_label"] if key == "current" else meta["previous_label"])

    ax.set_xticks(xticks, xlabels, rotation=90, fontsize=7)
    ax.set_ylim(0, trace_count + 2.1)
    tick_step = 5 if trace_count <= 40 else 10
    ax.set_yticks(range(0, trace_count + 1, tick_step))
    ax.tick_params(length=0, labelsize=8)
    ax.set_ylabel("Number of Traces", fontsize=9)
    ax.set_title("Lower Basin Operating Condition", loc="left", fontsize=11, pad=8)
    handles = [Patch(facecolor=CONDITION_COLORS[k], label=k) for k in order]
    ax.legend(handles=handles, title="Condition", loc="center left", bbox_to_anchor=(1.01, 0.5), frameon=False, fontsize=7.5, title_fontsize=8)
    note = caption or (
        "Note: For modeling purposes, these projections assume a continuation of the Interim Guidelines, "
        "DCP and Minute 323 beyond 2026. These agreements expire at the end of 2026, and Reclamation is "
        "beginning a process to develop operating strategies for post-2026."
    )
    fig.text(0.09, 0.015, note, fontsize=6.8, ha="left", va="bottom", wrap=True)
    fig.subplots_adjust(right=0.80, bottom=0.25)
    return _png(fig)


def render_custom_rdf_plot(spec: dict[str, Any]) -> bytes:
    """Render caller-selected RDF slots from underlying trace values.

    No Mean/Median/Min/Max plot aggregation is applied.  Line plots show each
    selected trace through time; box plots summarize the *distribution* of the
    raw trace values by period; bar plots show each trace value at the latest
    available period in each selected year.  Annual flags.rdf line/bar plots
    intentionally use the yearly 0/1 sum to match the report-table convention.
    """
    current_label = str(spec.get("current_label") or "Run A")
    previous_label = str(spec.get("previous_label") or "Run B")
    plot_type = str(spec.get("plot_type") or "line").lower()
    title = str(spec.get("title") or spec.get("slot") or "RDF slot")
    custom_subtitle = str(spec.get("subtitle") or "").strip()
    unit = str(spec.get("unit") or spec.get("source_unit") or "Value")
    trace_count = int(spec.get("trace_count") or 0)
    aggregation = str(spec.get("aggregation") or "raw_trace_values")
    colors = plt.rcParams['axes.prop_cycle'].by_key().get('color', ['C0', 'C1'])
    color_a = str(spec.get('run_a_color') or colors[0])
    color_b = str(spec.get('run_b_color') or (colors[1] if len(colors) > 1 else colors[0]))
    try:
        trace_alpha = max(0.05, min(1.0, float(spec.get('alpha') or 0.28)))
    except (TypeError, ValueError):
        trace_alpha = 0.28
    transform = str(spec.get('transform') or 'raw')
    line_width = max(0.25, min(6.0, float(spec.get('line_width') or 1.0)))
    show_grid = bool(spec.get('show_grid', True))
    x_axis_title = str(spec.get('x_axis_title') or '').strip()
    y_axis_title = str(spec.get('y_axis_title') or '').strip()
    y_axis_mode = str(spec.get('y_axis_mode') or 'auto')
    try:
        fixed_y_min = float(spec.get('y_min')) if spec.get('y_min') is not None else None
    except (TypeError, ValueError):
        fixed_y_min = None
    try:
        fixed_y_max = float(spec.get('y_max')) if spec.get('y_max') is not None else None
    except (TypeError, ValueError):
        fixed_y_max = None
    slot_name = str(spec.get('slot') or '')

    def parse_reference_lines() -> list[tuple[float, str, str]]:
        out: list[tuple[float, str, str]] = []
        for raw in str(spec.get('reference_lines') or '').splitlines():
            parts = [x.strip() for x in raw.split('|') if x.strip()]
            if not parts:
                continue
            target = '*'
            if len(parts) >= 4:
                target, value, label, color = parts[:4]
            elif len(parts) >= 2:
                value = parts[0]; label = parts[1] if len(parts) > 1 else parts[0]; color = parts[2] if len(parts) > 2 else '#c0392b'
            else:
                continue
            if target not in {'*', slot_name}:
                continue
            try:
                out.append((float(value), label, color or '#c0392b'))
            except ValueError:
                continue
        return out

    def apply_custom_axes(ax: plt.Axes, default_x: str, default_y: str) -> None:
        if not show_grid:
            ax.grid(False)
        ax.set_xlabel(x_axis_title or default_x, fontsize=9)
        ax.set_ylabel(y_axis_title or default_y, fontsize=9)
        if y_axis_mode == 'fixed' and fixed_y_min is not None and fixed_y_max is not None and fixed_y_max > fixed_y_min:
            ax.set_ylim(fixed_y_min, fixed_y_max)
        for value, label, color in parse_reference_lines():
            ax.axhline(value, color=color, linewidth=1.0, linestyle='--', alpha=0.9)
            ax.annotate(label, xy=(1.0, value), xycoords=('axes fraction', 'data'), xytext=(-3, 2), textcoords='offset points', ha='right', va='bottom', fontsize=7, color=color)

    def qtile(values: list[float], q: float) -> float | None:
        vals = sorted(float(v) for v in values if v is not None)
        if not vals:
            return None
        pos = (len(vals) - 1) * q
        lo = int(pos); hi = min(len(vals) - 1, lo + 1); frac = pos - lo
        return vals[lo] + (vals[hi] - vals[lo]) * frac

    if aggregation == "annual_flag_sum" and plot_type in {"line", "bar"}:
        years = [str(x) for x in spec.get("flag_years", spec.get("years", []))]
        current = spec.get("current_flag_sums") or []
        previous = spec.get("previous_flag_sums") or []
        fig, ax = plt.subplots(figsize=(9.8, 5.2))
        _gg_axes(ax)
        x = list(range(len(years)))
        if plot_type == "bar":
            width = 0.36
            ax.bar([v - width / 2 for v in x], [float(v) if v is not None else 0 for v in current], width=width, label=current_label)
            ax.bar([v + width / 2 for v in x], [float(v) if v is not None else 0 for v in previous], width=width, label=previous_label)
        else:
            ax.plot(x, current, marker="o", linewidth=1.8, label=current_label)
            ax.plot(x, previous, marker="o", linewidth=1.8, label=previous_label)
        ax.set_xticks(x, years)
        apply_custom_axes(ax, "Calendar Year", "Count")
        subtitle = custom_subtitle or f"Yearly sum of annual 0/1 flags across {trace_count} selected traces"
        ax.set_title(title, loc="left", fontsize=11, pad=18)
        ax.text(0, 1.01, subtitle, transform=ax.transAxes, fontsize=8, color="#555555", va="bottom")
        ax.legend(frameon=False, fontsize=8)
        fig.subplots_adjust(bottom=0.16, top=0.82)
        return _png(fig)

    period_labels = [str(x) for x in spec.get("period_labels", [])]
    current_matrix = spec.get("current_trace_values") or []
    previous_matrix = spec.get("previous_trace_values") or []
    trace_labels = [str(x) for x in spec.get("trace_labels", [])]
    timestep = str(spec.get("timestep_label") or "unspecified")

    if plot_type == "bar":
        bar_periods = [str(x) for x in spec.get("bar_period_labels", [])]
        current_bar = spec.get("current_bar_values") or []
        previous_bar = spec.get("previous_bar_values") or []
        n = max(1, len(bar_periods))
        cols = 1 if n <= 2 else 2
        rows = (n + cols - 1) // cols
        fig, axes = plt.subplots(rows, cols, figsize=(10.2, max(4.8, 2.65 * rows)), squeeze=False)
        flat = list(axes.flat)
        width = 0.38
        x = list(range(len(trace_labels)))
        for idx, ax in enumerate(flat):
            if idx >= len(bar_periods):
                ax.axis("off")
                continue
            _gg_axes(ax)
            a = current_bar[idx] if idx < len(current_bar) else []
            b = previous_bar[idx] if idx < len(previous_bar) else []
            av = [0.0 if v is None else float(v) for v in a]
            bv = [0.0 if v is None else float(v) for v in b]
            ax.bar([v - width / 2 for v in x], av, width=width, label=current_label)
            ax.bar([v + width / 2 for v in x], bv, width=width, label=previous_label)
            ax.set_title(bar_periods[idx], loc="left", fontsize=9, pad=4)
            ax.set_xticks(x, trace_labels, rotation=90, fontsize=6.5)
            apply_custom_axes(ax, "Trace", unit)
            ax.tick_params(length=0, labelsize=7)
        if flat:
            handles, labels = flat[0].get_legend_handles_labels()
            if handles:
                fig.legend(handles, labels, frameon=False, fontsize=8, loc="upper right", bbox_to_anchor=(0.96, 0.94))
        subtitle = custom_subtitle or f"Raw selected-trace values at the latest available {timestep} period in each selected year"
        fig.suptitle(title, x=0.06, y=0.985, ha="left", fontsize=11)
        fig.text(0.06, 0.955, subtitle, fontsize=8, color="#555555", ha="left", va="top")
        fig.subplots_adjust(left=0.07, right=0.97, bottom=0.16, top=0.88, hspace=0.55, wspace=0.24)
        return _png(fig)

    fig, ax = plt.subplots(figsize=(10.2, 5.4))
    _gg_axes(ax)
    x = list(range(len(period_labels)))

    if plot_type == "box":
        current_dist = spec.get("current_distributions") or []
        previous_dist = spec.get("previous_distributions") or []
        data: list[list[float]] = []
        positions: list[float] = []
        box_colors: list[Any] = []
        for idx in x:
            a = [float(v) for v in (current_dist[idx] if idx < len(current_dist) else [])]
            b = [float(v) for v in (previous_dist[idx] if idx < len(previous_dist) else [])]
            if a:
                data.append(a); positions.append(idx - 0.18); box_colors.append(color_a)
            if b:
                data.append(b); positions.append(idx + 0.18); box_colors.append(color_b)
        if data:
            boxes = ax.boxplot(data, positions=positions, widths=0.30, patch_artist=True, manage_ticks=False, showfliers=False)
            for patch, color in zip(boxes.get('boxes', []), box_colors):
                patch.set_facecolor(color)
                patch.set_alpha(0.45)
        ax.plot([], [], linewidth=8, alpha=0.45, color=color_a, label=current_label)
        ax.plot([], [], linewidth=8, alpha=0.45, color=color_b, label=previous_label)
        subtitle = custom_subtitle or (f"Distribution of per-trace water-year totals · {trace_count} traces" if transform == 'water_year_sum' else f"Distribution of selected-trace values · {trace_count} traces")
    else:
        # One line per actual selected RiverWare trace.  Run A and Run B use
        # separate line styles; no trace-level statistical summary is applied.
        if bool(spec.get('percentile_band', False)) and x:
            low = max(0.0, min(100.0, float(spec.get('percentile_low') or 10.0))) / 100.0
            high = max(low, min(1.0, float(spec.get('percentile_high') or 90.0) / 100.0))
            for matrix, color in ((current_matrix, color_a), (previous_matrix, color_b)):
                lows=[]; highs=[]
                for col in range(len(x)):
                    vals=[float(row[col]) for row in matrix if col < len(row) and row[col] is not None]
                    lows.append(qtile(vals, low)); highs.append(qtile(vals, high))
                if any(v is not None for v in lows):
                    ax.fill_between(x, lows, highs, color=color, alpha=0.10, linewidth=0)
        for idx, values in enumerate(current_matrix):
            y = [None if v is None else float(v) for v in values]
            ax.plot(x, y, linewidth=line_width, alpha=trace_alpha, color=color_a, label=current_label if idx == 0 else None)
        for idx, values in enumerate(previous_matrix):
            y = [None if v is None else float(v) for v in values]
            ax.plot(x, y, linewidth=line_width, alpha=trace_alpha, linestyle="--", color=color_b, label=previous_label if idx == 0 else None)
        subtitle = custom_subtitle or (f"Per-trace water-year totals · {trace_count} traces" if transform == 'water_year_sum' else f"Underlying selected-trace values through time · {timestep} timestep · {trace_count} traces")

    if period_labels:
        step = max(1, (len(period_labels) + 11) // 12)
        ticks = list(range(0, len(period_labels), step))
        if ticks[-1] != len(period_labels) - 1:
            ticks.append(len(period_labels) - 1)
        ax.set_xticks(ticks, [period_labels[i] for i in ticks], rotation=45, ha="right", fontsize=7)
    apply_custom_axes(ax, "RiverWare period", unit)
    ax.set_title(title, loc="left", fontsize=11, pad=18)
    ax.text(0, 1.01, subtitle, transform=ax.transAxes, fontsize=8, color="#555555", va="bottom")
    ax.legend(frameon=False, fontsize=8)
    fig.subplots_adjust(bottom=0.22, top=0.82)
    return _png(fig)

def render_all_plots(result: dict[str, Any], lower_basin_caption: str | None = None) -> dict[str, bytes]:
    output: dict[str, bytes] = {}
    flow = result["flow_analysis"]
    for idx, series in enumerate(flow.get("powell_inflow", []), start=1):
        output[f"powell-{idx}"] = render_powell_inflow(series)
    for idx, series in enumerate(flow.get("mead_flow", []), start=1):
        output[f"mead-{idx}"] = render_mead_flow(series, idx - 1)
    if flow.get("lower_basin_conditions"):
        output["lower-basin"] = render_lower_basin(flow, result["meta"], lower_basin_caption)
    for spec in result.get("custom_slot_plots", []) or []:
        key = str(spec.get("id") or "")
        if key:
            output[key] = render_custom_rdf_plot(spec)
    return output
