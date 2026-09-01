function orderedIndexes(source: string, markers: readonly string[]): readonly number[] {
  return markers.map((marker) => source.indexOf(marker))
}
const markers = [
  "# Browser Automation with agent-browser",
  "## Quick start",
  "## Core workflow",
  "### Navigation",
] as const
const template = playwrightFacade.agentBrowserSkill.template
expect(template).toStartWith("# Browser Automation with agent-browser")
expect(template).toEndWith("Follow the browser automation workflow carefully.")
const markerIndexes = orderedIndexes(template, markers)
expect(markerIndexes.every((index) => index >= 0)).toBe(true)
expect(markerIndexes).toEqual([...markerIndexes].sort((left, right) => left - right))
