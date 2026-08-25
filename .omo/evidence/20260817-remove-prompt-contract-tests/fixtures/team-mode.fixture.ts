const body = teamModeSkill.template
const headings = ["## Lead-only tools", "## Universal team-run tools", "## Global query tool"]
for (const heading of headings) {
  expect(body).toContain(heading)
}
const forbidden = "team_shutdown_request - ask the lead to wind down"
expect(body).not.toContain(forbidden)
