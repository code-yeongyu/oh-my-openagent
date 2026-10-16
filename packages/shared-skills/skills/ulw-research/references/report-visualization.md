# ulw-research - report visualization playbook

Read this before the asset lanes start in the final-materials phase. A report the reader has to dig through as plain text has failed even when every claim is right: people understand structure from a diagram and a trend from a chart faster than from prose. Every final report therefore carries visuals, and this file says which visual fits which finding, how to make each one, and how the gates check them.

## 1. The binding minimum

- At least one data visualization of the report's own findings (a chart drawn from the run's data table), placed next to the claim it supports. The executive summary carries the headline visual.
- A diagram wherever structure matters: a process, an architecture, a timeline, a dependency or influence graph, a comparison of options, the evidence flow behind a contested claim.
- When the topic has visual or video source material (product screenshots, demo videos, talks, viral posts with media), the report embeds or links it with attribution. In a paginated format, use a captioned still frame plus the link and timestamp.
- Every visual sits in a `<figure>` with a caption that says what it shows and where the data came from (`[S<n>]` or a lineage tag), and every `<img>` has alt text.
- A light-tier answer (a chat or thread post) still carries one visual when it reports numbers or structure: a Mermaid block the destination renders, or a single chart image.

A report that ships with none of these is incomplete. The static gate raises `report_without_visual` for it and `image_missing_alt` for an image without alt text (section 6).

## 2. Which tool for which finding

| Finding | Tool | Output |
| --- | --- | --- |
| Numbers: trends, comparisons, distributions, shares, rankings | A chart computed from a real data table | SVG with live text (PNG only for DOCX or slides) |
| Process, pipeline, decision flow, sequence of calls | Mermaid `flowchart` or `sequenceDiagram` | SVG |
| Timeline or history | Mermaid `timeline` or `gantt` | SVG |
| Relationships: who builds on whom, ownership, influence, dependency | Mermaid `flowchart` or `graph`; `mindmap` for a topic tree | SVG |
| System or product architecture | Mermaid `flowchart` with subgraphs, or `architecture-beta` where the renderer supports it | SVG |
| Neural-network architecture in a paper-format (LaTeX) report | PlotNeuralNet | PDF for LaTeX, SVG or PNG for HTML |
| A product, interface, or page the report discusses | A screenshot captured while reading the source, through the browser skill | PNG |
| A concept that has no data and no structure, a cover | The image-generation skill, only when it helps the reader understand | PNG |
| A source video or talk | An embed (web) or a still frame plus link and timestamp (paginated) | iframe or PNG |

Image generation never draws data, numbers, diagrams with labels, or anything the reader could mistake for evidence. Its caption says it is an illustration.

## 3. How to make each one

Save every asset under `$SESSION_DIR/assets/` and confirm the file exists and is non-empty before the document references it.

### Charts from data

Put the numbers in a table first (`$SESSION_DIR/data/<name>.csv`), then plot from the table, never from prose. Follow the data-scientist doctrine in SKILL.md (numpy, Polars, DuckDB, no pandas).

```bash
uv run --with numpy --with polars --with matplotlib python plot_<name>.py
```

- Keep chart text as real text: set `matplotlib.rcParams["svg.fonttype"] = "none"` before saving an SVG. The default converts text to paths, and the static gate then sees a chart with no title, ticks, or labels.
- Use the design spec's font family and palette tokens (`rcParams["font.family"]`, explicit colors from the spec). One accent color for the series that carries the finding; neutral tones for the rest.
- Title, axis labels with units, value labels on bars or end points, ticks at round values computed from the data range.
- One message per chart. A chart that needs a paragraph to explain is two charts.
- For a web deliverable, HTML/CSS bars or an inline SVG built from the same table are preferred over an image.

### Mermaid diagrams

Write the source to `assets/<name>.mmd` and render it to SVG with the design spec's font and palette:

```bash
cat > "$SESSION_DIR/assets/mermaid-config.json" <<'EOF'
{ "theme": "base", "htmlLabels": false, "flowchart": { "htmlLabels": false }, "themeVariables": { "fontFamily": "<spec body font>", "primaryColor": "<spec surface>", "primaryTextColor": "<spec text>", "primaryBorderColor": "<spec accent>", "lineColor": "<spec rule>", "arrowheadColor": "<spec rule>" } }
EOF
npx -y @mermaid-js/mermaid-cli -i "$SESSION_DIR/assets/<name>.mmd" -o "$SESSION_DIR/assets/<name>.svg" -c "$SESSION_DIR/assets/mermaid-config.json" -b transparent
```

- Keep `htmlLabels` off. With HTML labels the node text lands in `foreignObject` HTML instead of SVG `<text>`, so the static gate sees a diagram with no labels, and PDF and DOCX converters often drop it.
- The CLI drives its own headless renderer. When it cannot start in this session, keep the `.mmd` source, deliver the diagram as a Mermaid code block only where the destination renders Mermaid (GitHub, Notion, many Markdown viewers), and record the render as not run in the closing section. The static gate counts only rendered figures, so an HTML report still needs another rendered visual.
- Keep a diagram to about 15 nodes. Split a bigger one by subgraph or by step.
- Lay a chain of more than about five nodes out top to bottom (`flowchart TB`). A wide left-to-right diagram scaled down to the page width shrinks its labels below legible size, worst on a phone.
- Label every edge whose meaning is not obvious. Node text is short nouns; the caption carries the explanation.
- Inline the rendered SVG in HTML reports (the gates read its text) or reference the file inside a `<figure>`.

### PlotNeuralNet (paper-format reports)

Use it when the deliverable is LaTeX or a paper-style PDF and the report describes a convolutional or encoder-decoder model whose layer shapes matter. It draws 3D layer blocks with TikZ from a short Python description. It needs a LaTeX toolchain (`pdflatex` with TikZ; on Debian or Ubuntu `texlive-latex-base`, `texlive-latex-extra`, `texlive-fonts-recommended`, `texlive-fonts-extra`; on macOS a TeX distribution) and Python 3. Source: https://github.com/HarisIqbal88/PlotNeuralNet

```bash
git clone --depth 1 https://github.com/HarisIqbal88/PlotNeuralNet "$SESSION_DIR/tools/PlotNeuralNet"
mkdir -p "$SESSION_DIR/tools/PlotNeuralNet/report" && cd "$SESSION_DIR/tools/PlotNeuralNet/report"
# write arch.py from the README's Python example: to_head(".."), to_cor(), to_begin(), layers, to_connection(...), to_end()
python3 arch.py                  # writes arch.tex
pdflatex -interaction=nonstopmode arch.tex
pdftocairo -svg arch.pdf "$SESSION_DIR/assets/arch.svg"   # for an HTML report; LaTeX reports \input the .tex or include the PDF
```

- Run `pdflatex` directly instead of the repository's `tikzmake.sh`: that script deletes the generated `.tex` (which a LaTeX report needs to `\input`) and opens a PDF viewer. The repository has had no commits since 2020; pin the cloned commit in the closing section.
- Layer captions carry the real shapes and channel counts from the cited paper or code, with the citation in the figure caption.
- It does not fit transformers, graph models, or training pipelines well. Draw those with Mermaid or a hand-built TikZ figure instead.

### Screenshots and video

- Capture product and page screenshots through the browser skill while the source is open, at a readable width, and crop to the part the claim is about. Caption with the source and the access date.
- Embed a video in a web report with the platform's embed and a timestamp; in a paginated report, use a still frame from the moment the claim refers to, with the link and timestamp in the caption.

### Generated illustrations

Use the image-generation skill only for a cover or a concept illustration that helps the reader, prompted from the design spec's palette and register. Never let generated images carry text, numbers, or logos the reader could read as fact.

## 4. Choosing the output format

A post by Andrej Karpathy on 2026-10-02 ranks the formats that make model output easier to understand, each better than the last: controlled clean writing, diagrams and images, interactive web pages, and custom explainer videos (https://x.com/karpathy/status/2105819303471976479). Apply it as follows:

- Prose: write in the direction of ASD-STE100 (simplified technical English): short sentences, one idea per sentence, active voice, the same word for the same thing. The post suggests asking for about "80% of the way" when the full spec is too strict.
- Before writing a long explanation of structure, draw it. A diagram usually replaces several paragraphs.
- When the destination allows it, prefer a self-contained HTML report with interactive elements (hover values, toggles between series, expandable evidence) over a static document.
- When the requester asks for it, or the topic is a process best seen in motion, an explainer video (for example a 3Blue1Brown-style animation, narrated with a speech API or a local text-to-speech model) is a valid extra deliverable. Record it in `outcome.json` like any other promised format.

## 5. Quality bar

- Every figure follows the figure standard in SKILL.md: fixed container, contain-fit, aspect ratio preserved, spec fonts and palette.
- The caption alone tells the reader what the visual shows and what to conclude: "Median build time fell from 9.4 to 3.1 minutes after the cache change [S4]" beats "Build times".
- Alt text states the content, not the file: the key values or the shape of the trend for a chart, the main nodes and flow for a diagram. A purely decorative image takes `alt=""` plus `role="presentation"` and does not count as a visual; an empty alt without that marker is reported as missing.
- Every number in a visual comes from the data table and carries its source or lineage tag in the caption.
- Colors are never the only signal: label series directly or use distinct markers, so the figure reads in grayscale.

## 6. QA checklist

The static gate (`report-tools check`) enforces the machine-checkable rows; visual QA checks the rest on the rendered pages.

| Check | Enforced by |
| --- | --- |
| The report has at least one chart, diagram, or figure image | `report_without_visual` |
| Every visual sits in a figure with a non-empty caption | `chart_without_figure` |
| Every chart SVG has a title, ticks, and a text label | `chart_svg_no_text`, `chart_svg_missing_labels` |
| Every `<img>` has alt text | `image_missing_alt` |
| Every referenced asset exists and is non-empty | `broken_asset_reference` |
| Chart and diagram colors are spec tokens | `palette_off_token` |
| No image is stretched, cropped, or spilling its container | `layout_image_distorted`, `layout_overflow` |
| Each major quantitative finding has a chart and each structural finding has a diagram | visual QA |
| Diagram and chart text renders in the spec font and is legible at phone width | visual QA |
| Source videos and screenshots are embedded or linked with attribution where the topic has them | visual QA |
| Generated illustrations carry no fake data or text and are captioned as illustrations | visual QA |
