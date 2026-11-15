/**
 * Skills that ship in OmO's plugin (packages/shared-skills/skills, packages/omo-senpi/skills). The old landing also
 * listed imagegen and prompt-engineering, which OmO does not ship; they are left out here.
 */
export const SHIPPED_SKILLS: ReadonlyArray<{ readonly name: string; readonly blurb: string }> = [
  { name: "frontend", blurb: "design system, layout, motion, visual QA" },
  { name: "debugging", blurb: "hypothesis loop, failing test first" },
  { name: "ulw-research", blurb: "thousands of sources, claim graph, cited report" },
  { name: "data-scientist", blurb: "DuckDB, Polars, charts from raw files" },
  { name: "git-master", blurb: "atomic commits, rebase, bisect" },
  { name: "ultimate-browsing", blurb: "JS pages, logins, screenshots" },
  { name: "browser", blurb: "a real browser, driven from code" },
  { name: "visual-qa", blurb: "HIG checklist, light and dark, phone and desktop" },
  { name: "ast-grep", blurb: "structural search and codemods" },
  { name: "review-work", blurb: "one reviewer, real QA evidence" },
  { name: "refactor", blurb: "the right decomposition for a cleanup" },
  { name: "hyperplan", blurb: "adversarial planning before the work" },
  { name: "visualize", blurb: "an answer as a self-contained HTML page" },
  { name: "lsp-setup", blurb: "language servers wired for the agent" },
]
