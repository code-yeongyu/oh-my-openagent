# Visualization

A chart exists to answer a question at a glance. A chart shown inline beside a reply
(`show_html_page`, `html_preview`, `html_render`) is drawn in HTML, never as a matplotlib PNG:
an image ignores the reader's theme and width. When the `visualize` skill is available, it builds
that page. There this file's chart-type table, Figures and Quality bar apply, and the matplotlib
calls do not. Everywhere else (a kernel, a file, a document) render it with matplotlib (resident
in most Python kernels; `uv run --with matplotlib` otherwise). Either way, look at it before delivering —
a chart nobody inspected is not evidence.

## When to chart

Chart when the user asked for one, and default to charting when the answer is a shape prose
cannot carry: a trend over time, a distribution, a comparison across many categories, a
relationship between variables. Skip the chart when a number or a five-row table answers the
question — decoration dilutes the answer.

## Chart type follows the question

| Question shape | Chart |
| --- | --- |
| How did X change over time? | line, datetime x-axis |
| Which categories are biggest? | horizontal bar, sorted by value |
| How is X distributed? | histogram (tune bin count) or box plot per group |
| Is X related to Y? | scatter; add a trend line only when it aids the eye |
| Composition of a whole? | stacked or 100% bar — pie only for four or fewer slices |
| Many series over time? | small multiples over one spaghetti chart |

## Figures — every chart

- **Days start at the reader's midnight.** Cut daily, weekly and monthly buckets in the
  reader's time zone, not UTC, and name the zone in the axis label or caption. A bucket still
  filling (today, this week) is marked partial on its own bar, or it reads as a drop.
- **Cross-check one figure.** Recompute a headline number from a second source (another
  table, the system's own dashboard, a raw count) and say beside the chart whether it
  matched, and by how much it differed if not.

## Quality bar — every chart

- Title states the finding ("Seoul overtook Busan in March"), not the dataset name.
- Axis labels carry units. Tick density stays readable: `fig.autofmt_xdate()` for dates,
  rotate or abbreviate long category names.
- Size for the medium: inline chat reads well around `figsize=(10, 6)` at default dpi;
  documents want `dpi=150` or more at export.
- `tight_layout()` (or `constrained_layout=True`) before saving — clipped labels are the
  most common chart defect.
- Few series: label lines directly, or keep the legend inside empty plot space. Many
  series: gray the context, color only the series that answers the question.
- The default color cycle is fine; avoid rainbow palettes and 3D. Sort categorical bars by
  value, never alphabetically.

## CJK and other non-Latin text

Matplotlib's default font renders CJK as empty boxes (tofu). Set a fallback before plotting
whenever any label or title contains CJK:

```python
import platform
import matplotlib
cjk = {"Darwin": "AppleGothic", "Windows": "Malgun Gothic"}.get(platform.system(), "Noto Sans CJK KR")
matplotlib.rcParams["font.family"] = [cjk, "DejaVu Sans"]
matplotlib.rcParams["axes.unicode_minus"] = False   # keeps the minus sign rendering
```

## Output contract

1. Inline page beside a reply: no PNG. Draw the computed figures in HTML and preview them in
   both themes, following the `visualize` skill when it is available.
2. Otherwise save a PNG next to the work: `plt.savefig(path, dpi=150, bbox_inches="tight")`,
   and also render it inline when the surface displays rich output (kernels usually do).
3. Report the file path together with the answer.

## Visual QA — mandatory

Open the produced image — kernel display, or the harness's image-reading surface — and
check four things: labels readable and unclipped, no tofu or mojibake, nothing overlapping,
and the chart actually shows the finding the title claims. A failed check means fix and
re-render, not ship with a caveat. This one pass catches nearly every chart defect;
skipping it is how tofu titles reach users.
