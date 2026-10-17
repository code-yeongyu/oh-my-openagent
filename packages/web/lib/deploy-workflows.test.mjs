import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const workflow = (name) =>
  readFile(fileURLToPath(new URL(`../../../.github/workflows/${name}`, import.meta.url)), "utf8")

test("web-deploy passes the missing-history reason only for workflow_dispatch: a push always sends an empty value", async () => {
  const text = await workflow("web-deploy.yml")
  expect(text).toContain(
    "ACCEPT_MISSING_ASSET_HISTORY: ${{ github.event_name == 'workflow_dispatch' && inputs.missing_history_reason || '' }}",
  )
  expect(text.match(/ACCEPT_MISSING_ASSET_HISTORY:/g)).toHaveLength(1)
  expect(text).toContain("--bootstrap-current")
})

test("cutover-target-deploy runs the same retain step before its web deploy", async () => {
  const text = await workflow("cutover-target-deploy.yml")
  const retain = text.indexOf(
    "scripts/retain-static-assets.mjs .open-next/assets https://omo.dev 1800 --bootstrap-current",
  )
  expect(retain).toBeGreaterThan(0)
  expect(retain).toBeLessThan(text.indexOf("opennextjs-cloudflare deploy"))
  expect(text).not.toMatch(/on:\s*\n\s*push/)
})
