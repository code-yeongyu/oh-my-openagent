import type { ProbeLabContext } from "../probe-lab-context"
import { pollMuteState } from "./rate-limit-mute-watcher"
import { finalize, requireConfig, type ResolvedRuntime } from "./rate-limit-scan-helpers"
import type {
  MuteState,
  RateScanInput,
  RateScanResult,
  RecoveryCurveConfig,
  RecoverySample,
} from "./rate-limit-types"

export async function runRecoveryCurve(
  _ctx: ProbeLabContext,
  input: RateScanInput,
  rt: ResolvedRuntime,
): Promise<RateScanResult> {
  const cfg = requireConfig<RecoveryCurveConfig>(input.recovery, "recovery")
  const t0 = rt.now()
  const baseline =
    cfg.baseline_mute_state ?? (await pollMuteState(rt.provider, rt.baseUrl, "rate-recovery-baseline"))
  const samples: MuteState[] = [baseline]
  const recoverySamples: RecoverySample[] = [{ elapsed_seconds: 0, mute_state: baseline }]
  const checkpoints = [...cfg.checkpoints_seconds].sort((a, b) => a - b)
  let prevSeconds = 0
  for (const target of checkpoints) {
    const waitMs = Math.max(0, (target - prevSeconds) * 1000)
    if (waitMs > 0) await rt.sleep(waitMs)
    const sample = await pollMuteState(rt.provider, rt.baseUrl, `rate-recovery-${target}s`)
    samples.push(sample)
    recoverySamples.push({ elapsed_seconds: target, mute_state: sample })
    prevSeconds = target
    if (sample.is_muted === 0 && baseline.is_muted === 1) break
  }
  return finalize("recovery", [], samples, null, recoverySamples, false, null, rt.now() - t0)
}
