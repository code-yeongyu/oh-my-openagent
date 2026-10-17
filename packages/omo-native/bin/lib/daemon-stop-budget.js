/**
 * Senpi 2026.10.10-12 does not publicly export STOP_WAIT_BUDGET_MS.
 * Mirror host-ensure-stop, host-stop-intent and host-stalled-evidence here;
 * daemon-stop-budget.test.mjs checks this against the installed engine.
 */
export function postDrainStopReserveMs() {
  return 5_000 + 2_000 // supervisor completion + final SIGKILL grace
}

export function hostStopBudgetMs(env = process.env) {
  const raw = env.SENPI_RPC_CHILD_STALLED_STOP_MAX_MS?.trim()
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN
  const stalledStopMaxMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000
  return Math.max(5_000, stalledStopMaxMs) + 30_000 + postDrainStopReserveMs()
}
