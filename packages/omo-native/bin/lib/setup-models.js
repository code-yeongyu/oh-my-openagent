function values(items) {
  return items.length > 0 ? items.join(", ") : "none"
}

export function formatModelReport(inventory) {
  const lines = ["", "MODEL AVAILABILITY"]
  for (const harness of inventory.harnesses) {
    lines.push(`${harness.id}: providers ${values(harness.providers)}; models ${harness.modelHint}`)
  }
  lines.push(
    "Model-to-agent guidance: docs/guide/agent-model-matching.md",
    "Ready-to-paste omo.json models catalog template:",
    JSON.stringify({
      models: {
        primary: { model: "<provider>/<model-id>", reasoning: "<off|low|medium|high|max>" },
        "custom-endpoint": { model: "<custom-baseUrl-provider>/<model-id>" },
      },
    }, null, 2),
    "For custom endpoints, define the provider baseUrl in senpi models.json, then use that provider id above.",
  )
  return `${lines.join("\n")}\n`
}

export function printModelReport(inventory) {
  process.stdout.write(formatModelReport(inventory))
}
