import type { ProbeLabContext } from "../probe-lab-context"
import { runBurstScan } from "./rate-limit-burst-scan"
import { runRecoveryCurve } from "./rate-limit-recovery-curve"
import {
  resolveRuntime,
  type RateScanRuntimeOpts,
  type ResolvedRuntime,
} from "./rate-limit-scan-helpers"
import { runSustainedRateScan } from "./rate-limit-sustained-scan"
import { runTokenVolumeScan } from "./rate-limit-token-volume-scan"
import type { RateScanInput, RateScanResult } from "./rate-limit-types"

export type { RateScanRuntimeOpts, ResolvedRuntime }
export { runBurstScan, runRecoveryCurve, runSustainedRateScan, runTokenVolumeScan }

export async function runRateLimitScan(
  ctx: ProbeLabContext,
  input: RateScanInput,
  opts?: RateScanRuntimeOpts,
): Promise<RateScanResult> {
  const runtime = resolveRuntime(ctx, input, opts)
  const labelBase = input.session_label_base ?? `rate-${input.mode}-${runtime.now()}`
  switch (input.mode) {
    case "sustained":
      return runSustainedRateScan(ctx, input, runtime, labelBase)
    case "burst":
      return runBurstScan(ctx, input, runtime, labelBase)
    case "token_volume":
      return runTokenVolumeScan(ctx, input, runtime, labelBase)
    case "recovery":
      return runRecoveryCurve(ctx, input, runtime)
  }
}
