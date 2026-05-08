export type DocSection = {
  id: string
  title: string
  file: string
}

export const DOC_SECTIONS: readonly DocSection[] = [
  { id: "overview", file: "guide/overview.md", title: "Overview" },
  { id: "installation", file: "guide/installation.md", title: "Installation" },
  { id: "orchestration", file: "guide/orchestration.md", title: "Orchestration" },
  {
    id: "agent-model-matching",
    file: "guide/agent-model-matching.md",
    title: "Agent / Model Matching",
  },
  { id: "team-mode", file: "guide/team-mode.md", title: "Team Mode" },
  { id: "cli", file: "reference/cli.md", title: "CLI Reference" },
  { id: "configuration", file: "reference/configuration.md", title: "Configuration" },
  { id: "features", file: "reference/features.md", title: "Features" },
  { id: "manifesto", file: "manifesto.md", title: "Manifesto" },
] as const

export const DOC_SECTION_IDS = DOC_SECTIONS.map((s) => s.id)

export type DocSectionId = (typeof DOC_SECTIONS)[number]["id"]
