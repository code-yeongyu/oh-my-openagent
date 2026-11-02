import { readFile } from "node:fs/promises"
import { AssetRetentionError, retainStaticAssets } from "../lib/asset-retention.ts"
import { liveAssetInventory } from "../lib/live-asset-inventory.mjs"

const [directory, origin, overlap, bootstrapFile] = process.argv.slice(2)
if (!directory || !origin || !overlap) {
  throw new AssetRetentionError(
    "Pass assets directory, previous origin, deployment overlap seconds and optional legacy inventory",
  )
}

const compiled = JSON.parse(await readFile(".next/required-server-files.json", "utf8"))
const htmlLifetimeSeconds = compiled.config?.expireTime
if (
  typeof htmlLifetimeSeconds !== "number" ||
  !Number.isFinite(htmlLifetimeSeconds) ||
  htmlLifetimeSeconds <= 0
) {
  throw new AssetRetentionError("Compiled Next build must declare a bounded expiry")
}

const prerender = JSON.parse(await readFile(".next/prerender-manifest.json", "utf8"))
for (const [path, route] of Object.entries(prerender.routes)) {
  if (path.startsWith("/_")) continue
  const contentType = route.initialHeaders?.["content-type"]
  if (contentType && contentType.split(";")[0] !== "text/html") continue
  if (
    typeof route.initialRevalidateSeconds !== "number" ||
    route.initialRevalidateSeconds > htmlLifetimeSeconds
  ) {
    throw new AssetRetentionError("A prerendered document outlives the compiled expiry budget")
  }
}

// Set only by web-deploy.yml / cutover-target-deploy.yml for a workflow_dispatch run with a non-empty reason; a push
// can never set it (see those workflows), so a lost history on a normal deploy still fails closed.
const acceptMissingHistory = process.env.ACCEPT_MISSING_ASSET_HISTORY ?? ""
if (acceptMissingHistory !== "" && acceptMissingHistory.trim() === "") {
  throw new AssetRetentionError("ACCEPT_MISSING_ASSET_HISTORY must carry a reason")
}

let bootstrap = { paths: [], htmlLifetimeSeconds }
if (bootstrapFile === "--bootstrap-current") {
  const previous = await fetch(new URL("/__asset-history.json", origin), {
    headers: { "cache-control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  })
  if (previous.status === 404) {
    bootstrap = await liveAssetInventory(origin, { acceptMissingHistory })
    if (bootstrap.missingHistoryWaived)
      process.stdout.write(`${JSON.stringify({ missingHistoryAccepted: acceptMissingHistory })}\n`)
  } else if (!previous.ok) throw new AssetRetentionError("Prior inventory cannot be read")
} else if (bootstrapFile) {
  const input = JSON.parse(await readFile(bootstrapFile, "utf8"))
  if (
    !Array.isArray(input.paths) ||
    !input.paths.every((path) => typeof path === "string") ||
    typeof input.htmlLifetimeSeconds !== "number" ||
    !Number.isFinite(input.htmlLifetimeSeconds) ||
    input.htmlLifetimeSeconds <= 0
  ) {
    throw new AssetRetentionError(
      "Legacy inventory must supply paths and its measured HTML lifetime",
    )
  }
  bootstrap = { paths: [...new Set(input.paths)], htmlLifetimeSeconds: input.htmlLifetimeSeconds }
}

await retainStaticAssets({
  directory,
  origin,
  now: Date.now(),
  htmlLifetimeSeconds,
  deploymentOverlapSeconds: Number(overlap),
  bootstrap,
})
process.stdout.write(`${JSON.stringify({ retained: true, htmlLifetimeSeconds })}\n`)
