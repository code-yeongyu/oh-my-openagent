import type { ProbeLabContext } from "../probe-lab-context"
import { createMuteWatcher } from "./rate-limit-mute-watcher"
import { runRateProbe } from "./rate-limit-probe-runner"
import {
  DEFAULT_MUTE_INTERVAL_MS,
  finalize,
  isLikelyMuteOutcome,
  makeMuteEventFromOutcome,
  requireConfig,
  type ResolvedRuntime,
} from "./rate-limit-scan-helpers"
import type {
  RateMuteEvent,
  RateProbeOutcome,
  RateScanInput,
  RateScanResult,
  SustainedScanConfig,
} from "./rate-limit-types"

export async function runSustainedRateScan(
  ctx: ProbeLabContext,
  input: RateScanInput,
  rt: ResolvedRuntime,
  labelBase: string,
): Promise<RateScanResult> {
  const cfg = requireConfig<SustainedScanConfig>(input.sustained, "sustained")
  const paceMs = Math.max(1000, Math.floor(60_000 / Math.max(1, cfg.req_per_min)))
  const watcher = createMuteWatcher({
    provider: rt.provider,
    baseUrl: rt.baseUrl,
    intervalMs: input.mute_check_interval_ms ?? DEFAULT_MUTE_INTERVAL_MS,
    sleep: rt.sleep,
  })
  watcher.start()
  const t0 = rt.now()
  const outcomes: RateProbeOutcome[] = []
  let muteEvent: RateMuteEvent | null = null
  let aborted = false
  let abortReason: string | null = null
  for (let i = 0; i < cfg.total_requests; i++) {
    if (i > 0) await rt.sleep(paceMs)
    if (input.abort_on_mute !== false && watcher.hasMutedSinceStart()) {
      aborted = true
      abortReason = "mute_watcher_flip"
      break
    }
    const outcome = await runRateProbe({
      ctx,
      provider: rt.provider,
      baseUrl: rt.baseUrl,
      hypothesisId: input.hypothesis_id,
      index: i,
      promptChars: cfg.prompt_chars ?? 100,
      promptTemplate: cfg.prompt_template,
      sessionLabel: `${labelBase}-i${i}`,
      chatSessionFactory: rt.factory,
    })
    outcomes.push(outcome)
    if (!muteEvent && isLikelyMuteOutcome(outcome)) {
      muteEvent = makeMuteEventFromOutcome(outcome, rt.now())
    }
  }
  await watcher.stop()
  return finalize(
    "sustained",
    outcomes,
    watcher.getSamples(),
    muteEvent,
    [],
    aborted,
    abortReason,
    rt.now() - t0,
  )
}
