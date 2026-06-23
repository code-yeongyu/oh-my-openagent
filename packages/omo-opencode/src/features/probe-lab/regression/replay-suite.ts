import type { ProbeProvider, ProbeRequest, ProbeResponse } from "../providers/provider-types"

export type RegressionCase = {
  name: string
  request: Omit<ProbeRequest, "metadata"> & { metadata?: ProbeRequest["metadata"] }
  expected: {
    status?: number
    error_kind?: string | null
    body_contains?: string
  }
}

export type RegressionResult = {
  name: string
  ok: boolean
  status: number
  error_kind: string | null
  reason?: string
}

export async function runRegressionSuite(
  provider: ProbeProvider,
  cases: ReadonlyArray<RegressionCase>,
): Promise<RegressionResult[]> {
  const out: RegressionResult[] = []
  for (const tc of cases) {
    const request: ProbeRequest = {
      ...tc.request,
      metadata: tc.request.metadata ?? { session_id: "regression", exchange_sequence: 1 },
    }
    const response = await provider.dispatchProbe(request)
    out.push(evaluateCase(tc, response))
  }
  return out
}

function evaluateCase(tc: RegressionCase, response: ProbeResponse): RegressionResult {
  const errorKind = response.error?.kind ?? null
  if (tc.expected.status != null && response.status !== tc.expected.status) {
    return { name: tc.name, ok: false, status: response.status, error_kind: errorKind, reason: `status mismatch: expected=${tc.expected.status} actual=${response.status}` }
  }
  if (tc.expected.error_kind !== undefined && errorKind !== tc.expected.error_kind) {
    return { name: tc.name, ok: false, status: response.status, error_kind: errorKind, reason: `error_kind mismatch: expected=${tc.expected.error_kind} actual=${errorKind}` }
  }
  if (tc.expected.body_contains != null && !response.body.includes(tc.expected.body_contains)) {
    return { name: tc.name, ok: false, status: response.status, error_kind: errorKind, reason: `body missing substring: ${tc.expected.body_contains}` }
  }
  return { name: tc.name, ok: true, status: response.status, error_kind: errorKind }
}
