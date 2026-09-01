function values(items) {
  return items.length > 0 ? items.join(", ") : "none"
}

export function formatSetupReport(inventory) {
  const lines = ["HARNESS | INSTALLED | PROVIDERS | CREDENTIAL TYPES | MODELS"]
  for (const harness of inventory.harnesses) {
    lines.push([
      harness.id,
      harness.installed ? "yes" : "no",
      values(harness.providers),
      values(harness.credentialTypes),
      harness.modelHint,
    ].join(" | "))
    for (const notice of harness.notices) {
      const level = notice.startsWith("could not") ? "WARN" : "NOTICE"
      lines.push(`${level} ${harness.id}: ${notice}`)
    }
  }
  if (inventory.harnesses.some((item) => item.id !== "senpi" && item.importableCount > 0)) {
    lines.push("Run `omo setup --yes` to import available API credentials.")
  }
  return `${lines.join("\n")}\n`
}

export function printSetupReport(inventory) {
  process.stdout.write(formatSetupReport(inventory))
}
