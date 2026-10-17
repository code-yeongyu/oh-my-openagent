export const DOC_SECTIONS_DATA = /** @type {const} */ ([
  { id: "overview", file: "guide/overview.md", title: "Overview" },
  { id: "installation", file: "guide/installation.md", title: "Installation" },
  { id: "orchestration", file: "guide/orchestration.md", title: "Orchestration" },
  {
    id: "agent-model-matching",
    file: "guide/agent-model-matching.md",
    title: "Agent / Model Matching",
  },
  { id: "team-mode", file: "guide/team-mode.md", title: "Team Mode" },
  { id: "computer-use", file: "guide/computer-use.md", title: "Computer Use" },
  { id: "computer-tool", file: "reference/computer.md", title: "Computer Tool" },
  { id: "cli", file: "reference/cli.md", title: "CLI Reference" },
  { id: "configuration", file: "reference/configuration.md", title: "Configuration" },
  { id: "features", file: "reference/features.md", title: "Features" },
  { id: "manifesto", file: "manifesto.md", title: "Manifesto" },
])

/** Standalone guide pages served at /docs/<slug>; OmO Desktop's help links point at these routes. */
export const DOC_GUIDE_PAGES_DATA = /** @type {const} */ ([
  {
    slug: "workflows",
    file: "guide/workflows.md",
    title: "Workflows",
    description: "Run a large job as parallel tasks with mass ulw, and follow it in OmO Desktop.",
  },
  {
    slug: "agents",
    file: "guide/agents.md",
    title: "Agents",
    description: "How OmO hands work to background agents, and what the Agents panel shows.",
  },
  {
    slug: "keywords",
    file: "guide/keywords.md",
    title: "Keywords",
    description: "The words that switch OmO into ultrawork, loops, plans, research and workflows.",
  },
  {
    slug: "telemetry",
    file: "guide/telemetry.md",
    title: "Telemetry",
    description:
      "What anonymous usage data OmO sends, what it never sends, and how to turn it off.",
  },
  {
    slug: "desktop-updates",
    file: "guide/desktop-updates.md",
    title: "Desktop updates",
    description:
      "How OmO Desktop updates, where to read release notes, and the Stable and Nightly tracks.",
  },
])

export const DOC_PAGES_DATA = /** @type {const} */ ([
  { file: "guide/install.md", route: "/docs/install" },
  ...DOC_GUIDE_PAGES_DATA.map((page) => ({ file: page.file, route: `/docs/${page.slug}` })),
])
