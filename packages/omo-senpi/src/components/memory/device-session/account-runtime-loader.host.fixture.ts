// A senpi SDK host (not senpi's CLI) loading one extension through the engine's own extension loader, with the
// launcher's private-descriptor table in its environment (#12057). Usage: bun <this> <extension> <cwd> <agentDir>
import { discoverAndLoadExtensions } from "@code-yeongyu/senpi"
import { ACCOUNT_RUNTIME_LOADER_REPORT } from "./account-runtime-loader.fixture"

const [extension, cwd, agentDir] = process.argv.slice(2)
if (extension === undefined || cwd === undefined || agentDir === undefined)
  throw new Error("usage: account-runtime-loader.host.fixture.ts <extension> <cwd> <agentDir>")
const loaded = await discoverAndLoadExtensions([extension], cwd, agentDir)
if (loaded.errors.length > 0) throw new Error(`extension load failed: ${JSON.stringify(loaded.errors)}`)
const report: unknown = await Reflect.get(globalThis, ACCOUNT_RUNTIME_LOADER_REPORT)
process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(0))
