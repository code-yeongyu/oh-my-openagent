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
  BurstScanConfig,
  MuteState,
  RateProbeOutcome,
  RateScanInput,
  RateScanResult,
} from "./rate-limit-types"

export async function runBurstScan(
  ctx: ProbeLabContext,
  input: RateScanInput,
  rt: ResolvedRuntime,
  labelBase: string,
): Promise<RateScanResult> {
  const cfg = requireConfig<BurstScanConfig>(input.burst, "burst")
  const baseline = await pollMuteState(rt.provider, rt.baseUrl, "rate-burst-baseline")
  const samples: MuteState[] = [baseline]
  if (baseline.is_muted === 1 && input.abort_on_mute !== false) {
    return finalize("burst", [], samples, null, [], true, "muted_at_start", 0)
  }
  const t0 = rt.now()
  const outcomes: RateProbeOutcome[] = []
  for (let waveStart = 0; waveStart < cfg.total_requests; waveStart += cfg.concurrency) {
    const waveSize = Math.min(cfg.concurrency, cfg.total_requests - waveStart)
    const waveTasks: Array<Promise<RateProbeOutcome>> = []
    for (let n = 0; n < waveSize; n++) {
      const i = waveStart + n
      waveTasks.push(
        runRateProbe({
          ctx,
          provider: rt.provider,
          baseUrl: rt.baseUrl,
          hypothesisId: input.hypothesis_id,
          index: i,
          promptChars: cfg.prompt_chars ?? 100,
          promptTemplate: cfg.prompt_template,
          sessionLabel: `${labelBase}-c${cfg.concurrency}-i${i}`,
          chatSessionFactory: rt.factory,
        }),
      )
    }
    const settled = await Promise.allSettled(waveTasks)
    for (const s of settled) if (s.status === "fulfilled") outcomes.push(s.value)
  }
  const post = await pollMuteState(rt.provider, rt.baseUrl, "rate-burst-post")
  samples.push(post)
  const muteEvent = post.is_muted === 1 ? makeMuteEventFromMuteState(post) : null
  return finalize("burst", outcomes, samples, muteEvent, [], false, null, rt.now() - t0)
}
