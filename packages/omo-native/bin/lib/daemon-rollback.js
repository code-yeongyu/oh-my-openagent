import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import { parseEngineLine, readAllEndpoints } from "./daemon-operations.js"

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function sidecarRoots(agentDir) {
  const alt = createHash("sha256").update(agentDir, "utf8").digest("hex").slice(0, 8)
  return [join(agentDir, "rpc", "shards"), `/tmp/omo-rpc-${alt}`]
}

function sidecars(agentDir) {
  const rows = []
  for (const root of sidecarRoots(agentDir)) {
    let names
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names.filter((entry) => entry.endsWith(".meta.json")).toSorted()) {
      const path = join(root, name)
      const document = readJson(path)
      if (document !== undefined) rows.push({ path, document })
    }
  }
  return rows
}

function indexStores(agentDir) {
  const path = join(agentDir, "rpc", "task-stores.json")
  if (!existsSync(path)) return { present: false, stores: [] }
  const document = readJson(path)
  if (document?.version !== 1 || document.stores === null || typeof document.stores !== "object") {
    return { present: false, stores: [] }
  }
  return { present: true, stores: Object.keys(document.stores).map((store) => resolve(store)) }
}

function collectStores(agentDir, explicitStores) {
  const index = indexStores(agentDir)
  const metadata = sidecars(agentDir)
  const fromSidecars = metadata.flatMap(({ document }) => Array.isArray(document.stores) ? document.stores : [])
  const stores = [
    ...new Set([...index.stores, ...fromSidecars, ...explicitStores].map((store) => resolve(store))),
  ].toSorted()
  return {
    index,
    metadata,
    fromSidecars: [...new Set(fromSidecars.map((store) => resolve(store)))],
    stores,
  }
}

function statusForSocket(engine, socket, agentDir, env) {
  const result = engine.run(
    ["host", "status", "--json", "--socket", socket, "--include-workers"],
    { env: { ...env, OMO_AGENT_DIR: agentDir } },
  )
  const parsed = parseEngineLine(result.stdout ?? "")
  if (
    parsed === undefined ||
    !Array.isArray(parsed.generations) ||
    typeof parsed.claims_live !== "number"
  ) {
    return { readable: false }
  }
  return { readable: true, report: parsed }
}

export function runRollbackPrepare({
  engine,
  migration,
  agentDir,
  env,
  explicitStores,
  allowMissingIndex,
  dryRun,
  json,
  stdout,
  stderr,
}) {
  const discovered = collectStores(agentDir, explicitStores)
  const endpointSweep = readAllEndpoints(engine, agentDir, env)
  const endpointEvidence = endpointSweep.kind === "all" && endpointSweep.endpoints.some((endpoint) => {
    if (typeof endpoint.socket !== "string") return true
    return basename(endpoint.socket) !== "rpc.sock"
  })
  if (
    !discovered.index.present &&
    (discovered.metadata.length > 0 || endpointEvidence) &&
    !allowMissingIndex &&
    explicitStores.length === 0
  ) {
    stderr.write("store index missing: pass --store <dir> for every project that ran task children, or --allow-missing-index\n")
    return 3
  }

  const missing = discovered.stores.filter((store) => !existsSync(store))
  const present = discovered.stores.filter((store) => existsSync(store))
  const plans = present.map((storeDir) => migration.run({ storeDir, to: join(agentDir, "rpc", "rpc.sock"), planOnly: true }))
  const sockets = [...new Set(plans.flatMap((plan) => plan.sockets))].toSorted()
  const deadEndpoints = []
  for (const socket of sockets) {
    const statusResult = statusForSocket(engine, socket, agentDir, env)
    if (!statusResult.readable) {
      stderr.write(`rollback refused: endpoint status unreadable ${socket}\n`)
      return 3
    }
    const status = statusResult.report
    const alive = (status?.generations ?? []).some((generation) => generation.alive)
    if (alive || (status?.claims_live ?? 0) > 0) {
      stderr.write(`rollback refused: endpoint still live ${socket}\n`)
      return 3
    }
    deadEndpoints.push(socket)
  }

  const results = present.map((storeDir) => migration.run({
    storeDir,
    to: join(agentDir, "rpc", "rpc.sock"),
    deadEndpoints,
    dryRun,
  }))
  for (const result of results) {
    for (const warning of result.warnings ?? []) {
      stderr.write(`WARNING ${warning.code} [${warning.task_ids.join(", ")}]: ${warning.message}\n`)
    }
  }
  const storesWithoutMap = discovered.metadata
    .filter(({ document }) => !Array.isArray(document.stores))
    .map(({ document, path }) => document.socket ?? basename(path))
  const payload = {
    dry_run: dryRun,
    stores: results,
    coverage: {
      discovered: discovered.stores.length,
      from_index: discovered.index.stores.length,
      from_sidecars: discovered.fromSidecars.length,
      from_store: explicitStores.length,
      missing,
      endpoints_without_store_map: storesWithoutMap,
    },
  }
  if (json) stdout.write(`${JSON.stringify(payload)}\n`)
  else {
    for (const result of results) {
      stdout.write(`${result.store_dir}: migrated: ${dryRun ? result.migrate : result.migrated}, skipped: ${result.skipped}\n`)
    }
    stdout.write(
      `stores: ${payload.coverage.discovered} discovered (${payload.coverage.from_sidecars} from sidecars, ${payload.coverage.from_store} from --store), ${missing.length} missing, endpoints without a store map: ${storesWithoutMap.join(", ") || "none"}\n`,
    )
  }
  return 0
}
