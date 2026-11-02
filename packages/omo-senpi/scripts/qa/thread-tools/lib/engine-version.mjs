import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const omoSenpiManifest = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "package.json")

/**
 * The released senpi the gateway scenarios install and test: `THREAD_QA_SENPI_VERSION`, required.
 * There is no default, because a default silently tests an engine other than the build under test.
 * Unset or empty, the process exits 2 with one line naming the engine omo pins, before anything is
 * installed or created.
 */
export function requireEngineVersion() {
  const version = process.env.THREAD_QA_SENPI_VERSION
  if (version !== undefined && version !== "") return version
  const pinned = JSON.parse(readFileSync(omoSenpiManifest, "utf8")).devDependencies["@code-yeongyu/senpi"]
  process.stderr.write(`THREAD_QA_SENPI_VERSION is not set; set it to the engine under test (omo pins ${pinned})\n`)
  process.exit(2)
}
