import { randomUUID } from "node:crypto"

import type { TuiScanResult } from "./component"
import type { OnboardingScanEvent } from "./scan-contract"
import { migrationFactsFromScan, onboardingScanContext, runOnboardingScan, type OnboardingScanEnvironment } from "./scan-runtime"

// The TUI reads this computer through the one shared scan (`omo setup`'s detection, plus the engine
// session history when `sessions` is true), so it never grows a second reader. Its digests stay in
// memory with the calling process's cached scan, like the RPC scan's: nothing is on disk.
export async function runTuiOnboardingScan(
  environment: OnboardingScanEnvironment,
  options: { readonly sessions: boolean },
): Promise<TuiScanResult> {
  const scanId = randomUUID()
  const events: OnboardingScanEvent[] = []
  const { results, digests, projectRoots } = await runOnboardingScan(
    environment,
    { scanId, includeCustomProviders: true, sessions: options.sessions },
    (event) => { events.push(event) },
  )
  const inventory = migrationFactsFromScan(results)
  return {
    scanId,
    digests,
    projectRoots,
    ...(environment.env === undefined ? {} : { env: environment.env }),
    context: onboardingScanContext(scanId, events),
    ...(inventory === undefined ? {} : { inventory }),
  }
}
