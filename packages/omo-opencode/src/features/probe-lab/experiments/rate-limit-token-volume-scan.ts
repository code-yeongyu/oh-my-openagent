import type { ProbeLabContext } from "../probe-lab-context"
import { pollMuteState } from "./rate-limit-mute-watcher"
import { runRateProbe } from "./rate-limit-probe-runner"
import {
  finalize,
  makeMuteEventFromMuteState,
  requireConfig,
  type ResolvedRuntime,
} from "./rate-limit-scan-helpers"
import type {
  MuteState,
  RateMuteEvent,
  RateProbeOutcome,
  RateScanInput,
  RateScanResult,
  TokenVolumeScanConfig,
} from "./rate-limit-types"

export async function runTokenVolumeScan(
  ctx: ProbeLabContext,
  input: RateScanInput,
  rt: ResolvedRuntime,
  labelBase: string,
): Promise<RateScanResult> {
  const cfg = requireConfig<TokenVolumeScanConfig>(input.token_volume, "token_volume")
  const paceMs = cfg.pace_ms ?? 10_000
  const t0 = rt.now()
  const outcomes: RateProbeOutcome[] = []
  const samples: MuteState[] = []
  let muteEvent: RateMuteEvent | null = null
  let aborted = false
  let abortReason: string | null = null
  let probeIndex = 0
  outer: for (const size of cfg.prompt_sizes) {
    for (let n = 0; n < cfg.count_per_size; n++) {
      if (probeIndex > 0) await rt.sleep(paceMs)
      const outcome = await runRateProbe({
        ctx,
        provider: rt.provider,
        baseUrl: rt.baseUrl,
        hypothesisId: input.hypothesis_id,
        index: probeIndex,
        promptChars: size,
        promptTemplate: cfg.prompt_template,
        sessionLabel: `${labelBase}-s${size}-n${n}`,
        chatSessionFactory: rt.factory,
      })
      outcomes.push(outcome)
      probeIndex++
      const sample = await pollMuteState(rt.provider, rt.baseUrl, "rate-tv-watch")
      samples.push(sample)
      if (sample.is_muted === 1) {
        if (!muteEvent) muteEvent = makeMuteEventFromMuteState(sample)
        if (input.abort_on_mute !== false) {
          aborted = true
          abortReason = "muted_during_token_volume"
          break outer
        }
      }
    }
  }
  return finalize("token_volume", outcomes, samples, muteEvent, [], aborted, abortReason, rt.now() - t0)
}
