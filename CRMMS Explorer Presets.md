CRMMS EXPLORER PRESETS
======================

Purpose
-------

CRMMS Explorer uses the file:

    explorer_presets.json

to store reusable configurations for:

    1. Inspect RiverWare Results plot stacks
    2. Data Analysis filters

The preset file is normally located in the main application folder:

    app_v6\
        explorer_presets.json
        main.py
        requirements.txt
        Start_CRMMS_Web_App.bat
        static\
            index.html
            app.js
            styles.css


================================================================
1. RECOMMENDED WAY TO CREATE A PLOT PRESET
================================================================

The preferred way to create a plot preset is through the CRMMS
Explorer interface rather than manually writing JSON.

To create a preset:

1. Open "Inspect RiverWare Results".

2. Load the RDF files.

3. Add the desired RiverWare slots to the synchronized plot stack.

4. Arrange the plots in the desired order.

5. Configure each plot.

   Settings can include:

       Slot
       Plot type
       Data treatment / aggregation
       Title
       Subtitle
       X-axis title
       Y-axis title
       Line width
       Gridlines
       Y-axis limits
       Percentile band
       Display unit conversion
       Reference lines
       X-axis date range

6. Select the desired number of plot columns.

7. Click:

       Save current stack

   or use:

       Manage presets
           -> New from current

8. Enter a meaningful preset name.

The application will save the complete configuration to:

    explorer_presets.json


================================================================
2. PRESET FILE STRUCTURE
================================================================

The top-level structure of explorer_presets.json is:

    {
      "version": 1,
      "plot_presets": [],
      "analysis_presets": []
    }

plot_presets
------------

Contains configurations used by the Inspect RiverWare Results
plotting interface.


analysis_presets
----------------

Contains reusable filter configurations used by the Data Analysis
interface.


================================================================
3. PLOT PRESET STRUCTURE
================================================================

A plot preset has a structure similar to:

    {
      "id": "powell-mead-elevations",

      "name": "Powell + Mead Elevations",

      "description":
        "Lake Powell and Lake Mead pool elevation comparison.",

      "settings": {
        ...
      }
    }


id
--

The unique machine-readable identifier for the preset.

Examples:

    powell-mead-elevations

    reservoir-storage-summary

    powell-operations

    esp-release-summary

IDs should be unique.

The application normally generates the ID from the preset name.


name
----

The human-readable name displayed in the Plot Preset dropdown.

Example:

    Powell + Mead Elevations


description
-----------

Optional description of what the preset displays.

Example:

    Lake Powell and Lake Mead pool elevations for the
    current CRMMS ESP ensemble.


settings
--------

Contains the saved Explorer configuration, including the plot
stack and layout.


================================================================
4. PLOT STACK
================================================================

The individual plots are stored in:

    settings.stack_items

The order of the items in stack_items determines the order in
which the plots appear.

For example:

    "stack_items": [

        {
            "slot": "Powell.Pool Elevation"
        },

        {
            "slot": "Mead.Pool Elevation"
        },

        {
            "slot": "Powell.Outflow"
        }

    ]

This produces:

    Plot 1 = Powell Pool Elevation

    Plot 2 = Mead Pool Elevation

    Plot 3 = Powell Outflow


================================================================
5. INDIVIDUAL PLOT SETTINGS
================================================================

A complete plot item may look similar to:

    {
      "id": "plot-1",

      "slot": "Powell.Pool Elevation",

      "plot_type": "line",

      "transform": "raw",

      "annual_year": "",

      "bar_sort": "none",

      "title": "Lake Powell",

      "subtitle": "Pool Elevation",

      "x_axis_title": "",

      "y_axis_title": "Elevation",

      "line_width": 1,

      "show_grid": true,

      "y_axis_mode": "auto",

      "y_min": "",

      "y_max": "",

      "percentile_band": false,

      "percentile_low": 10,

      "percentile_high": 90,

      "unit_factor": 1,

      "unit_offset": 0,

      "display_unit": "",

      "x_range_mode": "months24",

      "x_range_start": "",

      "x_range_end": "",

      "reference_lines": []
    }


================================================================
6. SLOT
================================================================

The slot field identifies the RiverWare Object.Slot to plot.

Examples:

    Powell.Pool Elevation

    Mead.Pool Elevation

    Powell.Outflow

    Powell.Inflow

    Powell.Storage

The slot must exist in the RDF files currently loaded into the
application.

If a preset references a slot that does not exist in the current
RDF files, the application may skip that plot or report that the
slot is unavailable.


================================================================
7. PLOT TYPE
================================================================

plot_type controls how the data is displayed.

Supported values include:

    line

    bar

    box


Example:

    "plot_type": "line"


================================================================
8. DATA TREATMENT / AGGREGATION
================================================================

The transform field controls how the source values are processed.

Common values are:

    raw

        Raw timestep values.


    water_year_sum

        Sum values by water year for each trace.


    calendar_year_sum

        Sum values by calendar year for each trace.


    annual_raw

        Annual values by trace.


Example:

    "transform": "water_year_sum"


================================================================
9. ANNUAL YEAR
================================================================

annual_year is used when a plot configuration requires a selected
year.

Example:

    "annual_year": "2026"

For plots that do not require a selected year:

    "annual_year": ""


================================================================
10. BAR SORT
================================================================

bar_sort controls the ordering of bar plots.

Possible values include:

    none

    asc

    desc


Example:

    "bar_sort": "desc"


================================================================
11. TITLE AND SUBTITLE
================================================================

Each plot can have its own title and subtitle.

Example:

    "title": "Lake Powell"

    "subtitle": "Pool Elevation"

If a title is not provided, the application can use the slot name.


================================================================
12. AXIS TITLES
================================================================

Each plot can have custom axis labels.

Example:

    "x_axis_title": "Date"

    "y_axis_title": "Elevation (ft)"


================================================================
13. LINE WIDTH
================================================================

line_width controls line thickness.

Example:

    "line_width": 1.5


================================================================
14. GRIDLINES
================================================================

show_grid determines whether plot gridlines are displayed.

Gridlines enabled:

    "show_grid": true

Gridlines disabled:

    "show_grid": false


================================================================
15. Y-AXIS RANGE
================================================================

y_axis_mode controls whether Plotly determines the Y-axis
automatically or fixed limits are used.

Automatic:

    "y_axis_mode": "auto"


Fixed:

    "y_axis_mode": "fixed"

    "y_min": 3500

    "y_max": 3700


================================================================
16. PERCENTILE BAND
================================================================

A percentile envelope can be displayed for applicable line plots.

Example:

    "percentile_band": true

    "percentile_low": 10

    "percentile_high": 90


This would display the range between the 10th and 90th
percentiles.


================================================================
17. DISPLAY UNIT CONVERSION
================================================================

The application supports display-only scaling and offsets.

The general calculation is:

    displayed value =
        source value * unit_factor + unit_offset


Example:

    "unit_factor": 0.001

    "unit_offset": 0

    "display_unit": "kaf"


If no conversion is required:

    "unit_factor": 1

    "unit_offset": 0

    "display_unit": ""


================================================================
18. X-AXIS DATE RANGE
================================================================

Each plot can have its own configured X-axis date range.

The field is:

    x_range_mode


Supported values are:

    full

        Show the full available date range.


    months12

        Show the first 12 months.


    months24

        Show the first 24 months.


    months36

        Show the first 36 months.


    custom

        Use a custom start and/or end month.


Example:

    "x_range_mode": "months24"


Custom example:

    "x_range_mode": "custom"

    "x_range_start": "2026-04"

    "x_range_end": "2028-03"


The format for custom months is:

    YYYY-MM


For example:

    2026-04

means April 2026.


A custom start or end can be left blank.

For example:

    "x_range_start": "2026-04"

    "x_range_end": ""

means:

    Start at April 2026 and continue through the end of the
    available data.


================================================================
19. TABLE DATE RANGE
================================================================

Beginning with CRMMS Explorer v6.4, the Plotted Data table follows
the configured X-axis date range of the FIRST plot in the stack.

For example:

    Plot 1:
        Powell.Pool Elevation

        x_range_mode = months24


The plots may contain additional data, but the Plotted Data table
will show only the first 24 months.


The CSV export from the Plotted Data table will use the same
configured period.


IMPORTANT:

Interactive Plotly zoom does NOT control the table.

For example, zooming a plot with the mouse does not remove rows
from the table.

Only the configured plot setting:

    Full range
    First 12 months
    First 24 months
    First 36 months
    Custom range

controls the table date range.


================================================================
20. WHY THE FIRST PLOT CONTROLS THE TABLE
================================================================

A stack may contain several plots.

For example:

    Plot 1
        Powell.Pool Elevation
        24 months

    Plot 2
        Mead.Pool Elevation
        36 months

    Plot 3
        Powell.Outflow
        Full range


The Plotted Data table combines data from multiple plots into one
common table.

Therefore, CRMMS Explorer uses the configured date range from the
FIRST or PRIMARY plot as the common table date range.

This prevents ambiguous behavior when individual plots use
different date ranges.


================================================================
21. REFERENCE LINES
================================================================

Plots may contain reference lines.

These are stored in:

    "reference_lines": []

The application UI is the preferred method for creating and
editing reference lines.


================================================================
22. PLOT LAYOUT
================================================================

A preset can also store the number of plot columns.

Typical configurations are:

    1 column

    2 columns

    3 columns

The selected layout is restored when the preset is loaded.


================================================================
23. POWELL + MEAD ELEVATIONS PRESET
================================================================

The existing:

    Powell + Mead Elevations

preset is stored in:

    explorer_presets.json


Its machine-readable ID is typically:

    powell-mead-elevations


You can inspect this preset directly in explorer_presets.json.


However, the recommended method for changing it is:

1. Load the preset in CRMMS Explorer.

2. Modify the plots.

3. Save the configuration.

4. Replace the existing preset when prompted.


This ensures new plot settings are serialized correctly.


================================================================
24. PRESET MANAGER
================================================================

CRMMS Explorer v6.4 includes a Preset Manager.

Use:

    Manage presets

from the Plot Preset area.


The Preset Manager has two sections:

    Plot presets

    Data Analysis presets


================================================================
25. PLOT PRESET MANAGER
================================================================

The Plot Preset Manager can:

    Create a preset from the current plot stack

    View existing presets

    Rename presets

    Edit descriptions

    Duplicate presets

    Delete presets

    Load a preset into the Explorer workspace

    Export all presets

    Import presets


Individual plot settings should normally be edited in the regular
plot cards.

The Preset Manager is intended to manage the preset collection,
not duplicate the entire plot editor.


================================================================
26. CREATE FROM CURRENT
================================================================

To create a preset from the current Explorer configuration:

1. Configure the plots.

2. Open:

       Manage presets

3. Select:

       Plot presets

4. Click:

       New from current

5. Enter the preset name.

The current plot stack and settings will be saved.


================================================================
27. DUPLICATING A PRESET
================================================================

Duplicating a preset is useful when two configurations are similar.

For example:

    Powell + Mead Elevations

could be duplicated as:

    Powell + Mead Elevations + Releases


You can then load the duplicate, add the additional plots, and save
the new configuration.


================================================================
28. RENAMING A PRESET
================================================================

The Preset Manager allows the displayed preset name to be changed.

The internal preset ID remains stable when the display name is
changed.

This avoids unexpectedly breaking references to an existing
preset.


================================================================
29. DATA ANALYSIS PRESETS
================================================================

Data Analysis presets are stored in the same file:

    explorer_presets.json


They are stored under:

    analysis_presets


These presets contain reusable filter configurations from the
Data Analysis page.


For example, a preset might represent:

    Condition slot:
        Powell.Outflow

    Aggregation:
        Water-year sum

    Water year:
        2024

    Operator:
        Less than

    Value:
        7000000

    Return slot:
        Powell.Pool Elevation


This allows commonly used CRMMS analyses to be recreated quickly.


================================================================
30. PRESET IMPORT / EXPORT
================================================================

The Preset Manager can export the complete preset collection.

The exported file is named:

    crmms-explorer-presets.json


This contains both:

    plot_presets

and:

    analysis_presets


The exported file can be copied to another computer or CRMMS
installation.


================================================================
31. IMPORT - REPLACE OR MERGE
================================================================

When importing a preset file, the application provides two
behaviors.


REPLACE
-------

Replace the current preset collection with the imported file.


MERGE
-----

Keep the current presets and add the imported presets.


When merging, if an imported preset has the same ID as an existing
preset, the imported version replaces the existing preset with that
ID.


================================================================
32. MOVING PRESETS TO ANOTHER COMPUTER
================================================================

There are two recommended methods.


METHOD 1 - COPY THE APPLICATION
-------------------------------

If the complete portable CRMMS application folder is copied,
include:

    explorer_presets.json


The presets will travel with the application.


METHOD 2 - EXPORT / IMPORT
--------------------------

On the original computer:

    Manage presets
        -> Export presets


Copy:

    crmms-explorer-presets.json


to the other computer.


Then:

    Manage presets
        -> Import presets


Choose whether to replace or merge the preset collection.


================================================================
33. MANUALLY EDITING explorer_presets.json
================================================================

The file can be edited directly with a text editor.

However, using the application UI is recommended.


If manual editing is necessary:

1. Stop the CRMMS server.

2. Locate:

       explorer_presets.json

3. Make a backup copy.

4. Open the file in a text editor.

5. Edit the JSON.

6. Make sure:

       Quotes are balanced.

       Commas are correct.

       Brackets are balanced.

       Preset IDs are unique.

7. Save the file.

8. Restart CRMMS.


Invalid JSON may prevent presets from loading.


================================================================
34. ADDING A PRESET MANUALLY
================================================================

The easiest manual method is to duplicate an existing preset in the
JSON file.

For example, copy:

    Powell + Mead Elevations


Then change:

    id

    name

    description

    stack_items


Make sure the new ID is unique.


For example:

    "id": "powell-mead-storage",

    "name": "Powell + Mead Storage"


However, creating the configuration in the application and using:

    Save current stack

or:

    Manage presets
        -> New from current

is safer.


================================================================
35. BACKUPS
================================================================

Before manually editing explorer_presets.json, keep a backup.

Example:

    explorer_presets_backup.json


Preset files are small, so maintaining several dated backups is
reasonable.


================================================================
36. STANDARD CRMMS PRESET LIBRARY
================================================================

A useful long-term approach is to maintain a standard set of CRMMS
ESP presets.

For example:

    Powell + Mead Elevations

    Powell + Mead Storage

    Powell Inflow / Outflow

    Mead Inflow / Outflow

    Annual Release Summary

    Water-Year Flow Summary

    Powell Operations

    Mead Operations


These standard configurations can be distributed with the portable
CRMMS application.


================================================================
37. SUGGESTED PRESET NAMING
================================================================

Use descriptive names based on what the plots show.

Good examples:

    Powell + Mead Elevations

    Powell + Mead Storage

    Powell Monthly Operations

    Powell WY Flow Summary

    Basin Reservoir Elevations

    CRMMS ESP Release Summary


Avoid names such as:

    Test

    New Preset

    Plot 1


Meaningful names make the preset dropdown easier to use.


================================================================
38. GENERAL RECOMMENDATION
================================================================

Use the CRMMS interface for normal preset creation and editing.

Use direct JSON editing primarily for:

    Advanced maintenance

    Bulk configuration changes

    Reviewing preset structure

    Copying configurations between preset files

    Version-controlled standard CRMMS configurations


For routine use:

    Configure plots
        ->
    Save current stack
        ->
    Manage presets
        ->
    Export presets when needed


This keeps explorer_presets.json valid and ensures new Explorer
features are included automatically when presets are saved.