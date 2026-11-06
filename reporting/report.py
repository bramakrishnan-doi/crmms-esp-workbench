from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO
import re
from typing import Any

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

from ..runtime_paths import BUNDLE_DIR
from .plots import render_all_plots

TEMPLATE_PATH = BUNDLE_DIR / "reporting" / "report_template.docx"

REPORT_TITLES = {
    "powell-operating-tier": "% of Traces per Powell Operating Tier in WY {powell_operating_year}:",
    "powell-release-volume": "% Traces in Powell Annual Release Volume Scenario:",
    "powell-3500-adjustment": "% Traces with Powell Release Adjustment to Avoid Declining Below 3,500 ft during the CY:",
    "powell-3500-less-748": "% Traces with Powell Release Adjustment to Avoid Declining Below 3,500 ft during the CY and Powell release less than 7.48 maf:",
    "powell-3525": "% Traces with Powell Elevation below the Upper Basin DCP Trigger elevation of 3,525 ft in any month during the CY:",
    "powell-3490": "% Traces with Powell Elevation below Minimum Power Pool in any month during the CY:",
    "mead-1090": "% Traces with Lower Basin DCP (Lake Mead Elevation <= 1,090 ft on January 1):",
    "mead-1075": "% Traces with Lower Basin Shortage - Any Condition (Lake Mead Elevation <= 1,075 ft on January 1):",
    "mead-1050": "% Traces with Lower Basin Shortage (Lake Mead Elevation <= 1,050 ft on January 1):",
    "mead-1045": "% Traces with Lower Basin Shortage (Lake Mead Elevation <= 1,045 ft on January 1):",
    "mead-1035": "% Traces with Lake Mead Elevation < 1,035 ft:",
    "mead-1025": "% Traces with Lower Basin Shortage (Lake Mead Elevation <= 1,025 ft on January 1):",
    "mead-1000": "% Traces with Lake Mead Elevation < 1,000 ft in any month:",
    "mead-950": "% Traces with Lake Mead Elevation <= 950 ft in any month:",
    "mead-895": "% Traces with Lake Mead Elevation <= 895 ft in any month:",
}


@dataclass
class ReportSettings:
    report_title: str = "CRMMS ESP Summary"
    report_period: str = ""
    intro_text: str = ""
    assumptions: list[str] = field(default_factory=list)
    table_notes: dict[str, list[str]] = field(default_factory=dict)
    included_tables: list[str] = field(default_factory=list)
    included_plots: list[str] = field(default_factory=lambda: ["powell", "mead", "lower-basin"])
    table_titles: dict[str, str] = field(default_factory=dict)
    table_subtitles: dict[str, str] = field(default_factory=dict)
    table_years: dict[str, list[str]] = field(default_factory=dict)
    lower_basin_caption: str = ""
    include_metadata: bool = False
    template_style: str = "standard"
    section_order: list[str] = field(default_factory=list)


def _font(run, size: float | None = None, bold: bool | None = None) -> None:
    run.font.name = "Times New Roman"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold


def _set_cell_text(cell, text: str, *, bold: bool = False, align=WD_ALIGN_PARAGRAPH.CENTER, size: float = 10.5) -> None:
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = align
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)
    r = p.add_run(text)
    _font(r, size, bold)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def _set_cell_border(cell, **kwargs: dict[str, str]) -> None:
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in("w:tcBorders")
    if tcBorders is None:
        tcBorders = OxmlElement("w:tcBorders")
        tcPr.append(tcBorders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        if edge in kwargs:
            edge_data = kwargs[edge]
            tag = "w:" + edge
            element = tcBorders.find(qn(tag))
            if element is None:
                element = OxmlElement(tag)
                tcBorders.append(element)
            for key, value in edge_data.items():
                element.set(qn("w:" + key), str(value))


def _clear_table_borders(table) -> None:
    for row in table.rows:
        for cell in row.cells:
            _set_cell_border(
                cell,
                top={"val": "nil"}, left={"val": "nil"}, bottom={"val": "nil"}, right={"val": "nil"}
            )


def _rule_row(row, *, top: bool = False, bottom: bool = False) -> None:
    for cell in row.cells:
        edges = {}
        if top:
            edges["top"] = {"val": "single", "sz": "8", "color": "666666"}
        if bottom:
            edges["bottom"] = {"val": "single", "sz": "8", "color": "666666"}
        if edges:
            _set_cell_border(cell, **edges)


def _signed(value: Any) -> str:
    if isinstance(value, (int, float)) and value > 0:
        return f"+{value:g}"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def _add_paragraph(doc: Document, text: str = "", *, bold: bool = False, size: float = 12, align=None, before: float = 0, after: float = 6):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.0
    r = p.add_run(text)
    _font(r, size, bold)
    return p


def _add_bullet(doc: Document, text: str, *, level: int = 0, size: float = 11.5) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.left_indent = Inches(0.28 + 0.28 * level)
    p.paragraph_format.first_line_indent = Inches(-0.16)
    marker = "•" if level == 0 else "o"
    r = p.add_run(f"{marker}  {text}")
    _font(r, size)


def _set_table_widths(table, column_widths: list[float]) -> None:
    table.autofit = False
    grid_cols = list(table._tbl.tblGrid.gridCol_lst)
    for idx, width in enumerate(column_widths):
        length = Inches(width)
        if idx < len(table.columns):
            table.columns[idx].width = length
        if idx < len(grid_cols):
            grid_cols[idx].set(qn("w:w"), str(int(length.twips)))
        for row in table.rows:
            if idx < len(row.cells):
                row.cells[idx].width = length


def _keep_table_together(table) -> None:
    for row_index, row in enumerate(table.rows):
        trPr = row._tr.get_or_add_trPr()
        cant_split = OxmlElement("w:cantSplit")
        trPr.append(cant_split)
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.keep_together = True
                if row_index < len(table.rows) - 1:
                    paragraph.paragraph_format.keep_with_next = True


def _add_metric_table(doc: Document, table_data: dict[str, Any]) -> None:
    table_id = table_data["id"]
    if table_id == "powell-release-volume":
        _add_release_table(doc, table_data)
        return
    cols = table_data["columns"]
    table = doc.add_table(rows=1 + len(table_data["rows"]), cols=1 + len(cols))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    _clear_table_borders(table)
    header = table.rows[0]
    _set_cell_text(header.cells[0], "", bold=True)
    for i, col in enumerate(cols, start=1):
        _set_cell_text(header.cells[i], str(col), bold=True)
    _rule_row(header, top=True, bottom=True)
    for r_idx, row_data in enumerate(table_data["rows"], start=1):
        row = table.rows[r_idx]
        _set_cell_text(row.cells[0], str(row_data["label"]), bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)
        for c_idx, val in enumerate(row_data["values"], start=1):
            if val is None:
                text = "—"
            elif table_data.get("section") == "custom" and isinstance(val, (int, float)):
                digits = int(table_data.get("display_decimals", 2))
                text = f"{val:+,.{digits}f}" if row_data["kind"] == "difference" and val != 0 else f"{val:,.{digits}f}"
            else:
                text = _signed(val) if row_data["kind"] == "difference" else f"{val:g}" if isinstance(val, (int, float)) else str(val)
            _set_cell_text(row.cells[c_idx], text, bold=False)
    _rule_row(table.rows[-1], bottom=True)
    numeric_width = max(0.62, (6.80 - 1.20) / max(len(cols), 1))
    _set_table_widths(table, [1.20] + [numeric_width] * len(cols))
    _keep_table_together(table)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def _column_year(value: Any) -> str | None:
    match = re.match(r"^\s*(20\d{2}|21\d{2})(?:\b|\s)", str(value))
    return match.group(1) if match else None


def _filter_table_years(table_data: dict[str, Any], selected_years: list[str] | None) -> dict[str, Any] | None:
    """Return a shallow table copy containing only caller-selected year columns.

    Non-year columns are retained. A missing setting means all columns. An
    explicitly empty list means the table has no visible year columns and is
    therefore omitted instead of generating an invalid Word table.
    """
    if selected_years is None:
        return table_data
    allowed = {str(x) for x in selected_years}
    columns = list(table_data.get("columns") or [])
    year_indexes = [i for i, column in enumerate(columns) if _column_year(column)]
    if not year_indexes:
        return table_data
    indexes = [
        i for i, column in enumerate(columns)
        if (_column_year(column) is None) or (_column_year(column) in allowed)
    ]
    if not indexes:
        return None
    filtered = dict(table_data)
    filtered["columns"] = [columns[i] for i in indexes]
    filtered["rows"] = [
        {**row, "values": [row.get("values", [])[i] for i in indexes]}
        for row in table_data.get("rows", [])
    ]
    return filtered


def _custom_detail_line(table_data: dict[str, Any]) -> str:
    details: list[str] = []
    if table_data.get("subtitle"):
        details.append(str(table_data["subtitle"]))
    if table_data.get("unit"):
        details.append(f"Units: {table_data['unit']}")
    if table_data.get("scale_label"):
        details.append(f"Scale: {table_data['scale_label']}")
    if table_data.get("timestep_label"):
        details.append(f"Timestep: {table_data['timestep_label']}")
    if table_data.get("trace_count"):
        details.append(f"{table_data['trace_count']} traces")
    return " · ".join(details)


def _add_release_table(doc: Document, table_data: dict[str, Any]) -> None:
    # Columns arrive as "2027 <8.23", "2027 =8.23", etc.
    parsed = []
    for col in table_data["columns"]:
        year, condition = col.split(" ", 1)
        parsed.append((year, condition.replace("=", "")))
    years = []
    for year, _ in parsed:
        if year not in years:
            years.append(year)
    table = doc.add_table(rows=2 + len(table_data["rows"]), cols=1 + len(parsed))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    _clear_table_borders(table)
    _set_cell_text(table.rows[0].cells[0], "")
    cursor = 1
    for year in years:
        count = sum(1 for y, _ in parsed if y == year)
        merged = table.rows[0].cells[cursor]
        if count > 1:
            merged = merged.merge(table.rows[0].cells[cursor + count - 1])
        _set_cell_text(merged, year, bold=True)
        cursor += count
    _rule_row(table.rows[0], bottom=True)
    _set_cell_text(table.rows[1].cells[0], "")
    for i, (_, condition) in enumerate(parsed, start=1):
        _set_cell_text(table.rows[1].cells[i], condition, bold=True)
    _rule_row(table.rows[1], bottom=True)
    for r_idx, row_data in enumerate(table_data["rows"], start=2):
        row = table.rows[r_idx]
        _set_cell_text(row.cells[0], str(row_data["label"]), bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)
        for c_idx, val in enumerate(row_data["values"], start=1):
            text = _signed(val) if row_data["kind"] == "difference" else f"{val:g}"
            _set_cell_text(row.cells[c_idx], text)
        # Add separators after each three-column group.
        for c_idx in range(3, len(parsed), 3):
            _set_cell_border(row.cells[c_idx], right={"val": "single", "sz": "6", "color": "777777"})
    _rule_row(table.rows[-1], bottom=True)
    numeric_width = max(0.58, (6.80 - 1.20) / max(len(parsed), 1))
    _set_table_widths(table, [1.20] + [numeric_width] * len(parsed))
    _keep_table_together(table)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def _changes_heading(previous_label: str, report_period: str) -> str:
    label = previous_label.strip() or "Previous"
    if not any(ch.isdigit() for ch in label):
        import re
        match = re.search(r"\b(20\d{2}|21\d{2})\b", report_period or "")
        if match:
            label = f"{label} {match.group(1)}"
    return f"Changes from {label} Run"


def build_report(result: dict[str, Any], settings: ReportSettings) -> bytes:
    doc = Document(str(TEMPLATE_PATH)) if TEMPLATE_PATH.exists() else Document()
    section = doc.sections[0]
    template_style = settings.template_style if settings.template_style in {"standard", "compact", "large_charts"} else "standard"
    if template_style == "compact":
        margins = (0.48, 0.48, 0.55, 0.55); normal_size = 10.5; title_size = 22; chart_width = 6.95
    elif template_style == "large_charts":
        margins = (0.52, 0.52, 0.50, 0.50); normal_size = 11.0; title_size = 24; chart_width = 7.20
    else:
        margins = (0.65, 0.65, 0.72, 0.72); normal_size = 11.5; title_size = 26; chart_width = 6.65
    section.top_margin = Inches(margins[0])
    section.bottom_margin = Inches(margins[1])
    section.left_margin = Inches(margins[2])
    section.right_margin = Inches(margins[3])

    styles = doc.styles
    styles["Normal"].font.name = "Times New Roman"
    styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")
    styles["Normal"].font.size = Pt(normal_size)

    title = _add_paragraph(doc, settings.report_title or "CRMMS ESP Summary", bold=False, size=title_size, align=WD_ALIGN_PARAGRAPH.CENTER, after=10)
    if settings.report_period:
        intro = settings.intro_text.strip() or f"The {settings.report_period} CRMMS ESP results are attached and summarized below:"
    else:
        intro = settings.intro_text.strip() or "CRMMS ESP results are attached and summarized below:"
    _add_paragraph(doc, intro, size=11.5, after=5)

    meta = result["meta"]
    summary = result.get("summary") or {}
    eocy_year = meta.get("eocy_year") or str(meta.get("eocy_date", ""))[:4]
    if summary.get("powell") or summary.get("mead"):
        _add_bullet(doc, "Projected Elevations:", level=0)
        if summary.get("powell"):
            _add_bullet(doc, f"Lake Powell EOCY {eocy_year} range: {summary['powell']['current']['min']:,.2f} feet - {summary['powell']['current']['max']:,.2f} feet", level=1)
        if summary.get("mead"):
            _add_bullet(doc, f"Lake Mead EOCY {eocy_year} range: {summary['mead']['current']['min']:,.2f} feet - {summary['mead']['current']['max']:,.2f} feet", level=1)

    if settings.assumptions:
        _add_paragraph(doc, "Notes and Assumptions", bold=True, size=12, before=4, after=3)
        for note in settings.assumptions:
            if note.strip():
                _add_bullet(doc, note.strip(), level=0, size=11)

    standard_tables = list(result.get("tables") or [])
    custom_tables = list(result.get("custom_slot_tables") or [])
    all_tables = standard_tables + custom_tables
    table_by_id = {str(t.get("id")): t for t in all_tables}
    included_tables = set(settings.included_tables or [t["id"] for t in all_tables])
    plots = render_all_plots(result, settings.lower_basin_caption or None)
    included_plots = set(settings.included_plots)

    def add_table_section(table_data: dict[str, Any]) -> None:
        table_data = _filter_table_years(table_data, settings.table_years.get(table_data["id"]))
        if table_data is None:
            return
        is_custom = table_data.get("section") == "custom"
        if is_custom:
            default_title = str(table_data.get("slot") or table_data.get("title") or "RDF Slot")
            title_text = settings.table_titles.get(table_data["id"], default_title)
            title_paragraph = _add_paragraph(doc, title_text, size=11.5 if template_style != "compact" else 10.6, before=2, after=2)
            title_paragraph.paragraph_format.keep_with_next = True
            detail_text = settings.table_subtitles.get(table_data["id"], _custom_detail_line(table_data))
            if detail_text:
                detail_p = _add_paragraph(doc, detail_text, size=9.5 if template_style != "compact" else 8.9, after=4)
                detail_p.paragraph_format.keep_with_next = True
        else:
            if table_data.get("unit") == "count":
                report_title = f"{settings.table_titles.get(table_data['id'], table_data['title'])}:"
            else:
                title_template = REPORT_TITLES.get(table_data["id"], table_data["title"])
                report_title = settings.table_titles.get(table_data["id"], title_template.format(**meta))
            title_paragraph = _add_paragraph(doc, report_title, size=11.5 if template_style != "compact" else 10.6, before=2, after=3 if table_data.get("unit") == "count" else 5)
            title_paragraph.paragraph_format.keep_with_next = True
            if table_data.get("unit") == "count" and table_data.get("subtitle"):
                detail_text = settings.table_subtitles.get(table_data["id"], str(table_data["subtitle"]))
                detail_p = _add_paragraph(doc, detail_text, size=9.5 if template_style != "compact" else 8.9, after=4)
                detail_p.paragraph_format.keep_with_next = True
        _add_metric_table(doc, table_data)
        for note in settings.table_notes.get(table_data["id"], []):
            if note.strip():
                _add_bullet(doc, note.strip(), size=10.8 if template_style != "compact" else 10.0)
        spacer = doc.add_paragraph(); spacer.paragraph_format.space_after = Pt(3)

    def add_plot_image(key: str, *, page_break: bool = False) -> bool:
        if key not in plots:
            return False
        if page_break:
            doc.add_page_break()
        p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after = Pt(5)
        p.add_run().add_picture(BytesIO(plots[key]), width=Inches(chart_width))
        return True

    default_order = [f"table:{t['id']}" for t in all_tables]
    if "powell" in included_plots: default_order.append("plot:powell")
    if "mead" in included_plots: default_order.append("plot:mead")
    if "lower-basin" in included_plots: default_order.append("plot:lower-basin")
    for item in result.get("custom_slot_plots", []):
        pid = str(item.get("id"))
        if pid in included_plots: default_order.append(f"plot:{pid}")
    order = [x for x in settings.section_order if isinstance(x, str)] if settings.section_order else default_order
    # Keep newly available sections even when an older saved configuration lacks them.
    for key in default_order:
        if key not in order:
            order.append(key)

    wrote_standard_heading = False
    wrote_custom_heading = False
    wrote_any_plot = False
    for section_key in order:
        if section_key.startswith("table:"):
            tid = section_key.split(":", 1)[1]
            table_data = table_by_id.get(tid)
            if not table_data or tid not in included_tables:
                continue
            is_custom = table_data.get("section") == "custom"
            if is_custom and not wrote_custom_heading:
                _add_paragraph(doc, "Additional RDF Slot Comparisons", bold=True, size=12, before=7, after=6)
                wrote_custom_heading = True
            elif not is_custom and not wrote_standard_heading:
                _add_paragraph(doc, _changes_heading(str(meta['previous_label']), settings.report_period), bold=True, size=12, before=5, after=7)
                wrote_standard_heading = True
            add_table_section(table_data)
            continue
        if not section_key.startswith("plot:"):
            continue
        pid = section_key.split(":", 1)[1]
        if pid not in included_plots:
            continue
        keys: list[str] = []
        if pid == "powell": keys = sorted(k for k in plots if k.startswith("powell-"))
        elif pid == "mead": keys = sorted(k for k in plots if k.startswith("mead-"))
        elif pid == "lower-basin": keys = ["lower-basin"] if "lower-basin" in plots else []
        else: keys = [pid] if pid in plots else []
        for key in keys:
            # Start each plot group on a new page; additional images in the same group may flow naturally.
            wrote = add_plot_image(key, page_break=True if not wrote_any_plot or key == keys[0] else False)
            wrote_any_plot = wrote_any_plot or wrote

    if settings.include_metadata:
        doc.add_page_break()
        _add_paragraph(doc, "Report Metadata", bold=True, size=12, after=5)
        entries = [
            ("Run A", meta.get("current_label", "")),
            ("Run B", meta.get("previous_label", "")),
            ("Run A source", meta.get("current_filename", "")),
            ("Run B source", meta.get("previous_filename", "")),
            ("EOCY date", meta.get("eocy_date", "")),
            ("Comparison years", ", ".join(map(str, meta.get("comparison_years", [])))),
            ("Release years", ", ".join(map(str, meta.get("release_years", [])))),
            ("Additional RDF slots", ", ".join(meta.get("custom_slots", [])) or "None"),
            ("Default additional slot statistic", meta.get("custom_slot_statistic", "median")),
            ("Annual flags.rdf aggregation", "yearly sum across selected traces"),
            ("Available report inputs", f"{meta.get('available_input_count', meta.get('required_input_count', ''))}/{meta.get('required_input_count', '')}"),
            ("Omitted report sections", ", ".join(x.get("title", x.get("id", "")) for x in meta.get("skipped_sections", [])) or "None"),
            ("Generated", datetime.now().astimezone().isoformat(timespec="seconds")),
        ]
        for label, value in entries:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(f"{label}: ")
            _font(r, 10, True)
            r2 = p.add_run(str(value))
            _font(r2, 10, False)

    doc.core_properties.title = settings.report_title or "CRMMS ESP Summary"
    doc.core_properties.subject = f"CRMMS comparison: {meta.get('current_label')} vs {meta.get('previous_label')}"
    doc.core_properties.comments = (
        f"Generated by CRMMS ESP Compare. Sources: {meta.get('current_filename', '')}; "
        f"{meta.get('previous_filename', '')}. Years: {meta.get('comparison_years', [])}."
    )
    out = BytesIO()
    doc.save(out)
    return out.getvalue()
