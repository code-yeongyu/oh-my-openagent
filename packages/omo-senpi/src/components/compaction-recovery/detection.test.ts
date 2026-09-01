import { describe, expect, test } from "bun:test"
import {
  asRejectedRequiredCompaction,
  extractRecoveryEventContext,
} from "./detection"

describe("asRejectedRequiredCompaction", () => {
  const baseRejected = {
    type: "session_compact",
    reason: "threshold",
    requestId: "req-6871",
    accepted: false,
    rejectionCause: "cancelled-by-extension",
    compactionEntry: undefined,
    fromExtension: false,
    willRetry: false,
  }

  test("#given a rejected required compaction event #when narrowing #then the reason and rejection cause are exposed", () => {
    // given / when
    const parsed = asRejectedRequiredCompaction(baseRejected)

    // then
    expect(parsed).toEqual({ reason: "threshold", rejectionCause: "cancelled-by-extension" })
  })

  test("#given an overflow rejection #when narrowing #then it is recognized as required", () => {
    // given / when
    const parsed = asRejectedRequiredCompaction({ ...baseRejected, reason: "overflow" })

    // then
    expect(parsed?.reason).toBe("overflow")
  })

  test("#given an accepted compaction event #when narrowing #then it is ignored", () => {
    // given
    const accepted = { ...baseRejected, accepted: true, rejectionCause: undefined }

    // when / then
    expect(asRejectedRequiredCompaction(accepted)).toBeUndefined()
  })

  test("#given a rejection caused by the circuit breaker #when narrowing #then it is not treated as a summarization giveup", () => {
    // given
    const breaker = { ...baseRejected, rejectionCause: "circuit-breaker" }

    // when / then
    expect(asRejectedRequiredCompaction(breaker)).toBeUndefined()
  })

  test("#given a non-required compaction reason #when narrowing #then it is ignored", () => {
    // given
    const manual = { ...baseRejected, reason: "manual" }

    // when / then
    expect(asRejectedRequiredCompaction(manual)).toBeUndefined()
  })

  test("#given a non-record payload #when narrowing #then it is ignored without throwing", () => {
    // given / when / then
    expect(asRejectedRequiredCompaction(undefined)).toBeUndefined()
    expect(asRejectedRequiredCompaction("session_compact")).toBeUndefined()
    expect(asRejectedRequiredCompaction(null)).toBeUndefined()
  })
})

describe("extractRecoveryEventContext", () => {
  test("#given a host event context with recovery APIs #when extracting #then the ports are preserved", () => {
    // given
    const hostCtx = {
      cwd: "/tmp/project",
      getContextUsage: () => ({ tokens: 236744, contextWindow: 272000 }),
      getCompactionSettings: () => ({ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }),
      isCompacting: () => false,
      applyCompaction: async () => ({ applied: true, reason: "ok" }),
      sessionManager: { getBranch: () => [] },
    }

    // when
    const ports = extractRecoveryEventContext(hostCtx)

    // then
    expect(ports?.getContextUsage?.()).toEqual({ tokens: 236744, contextWindow: 272000 })
    expect(ports?.getCompactionSettings?.()?.reserveTokens).toBe(16384)
    expect(ports?.isCompacting?.()).toBe(false)
    expect(ports?.sessionManager?.getBranch?.()).toEqual([])
  })

  test("#given a context missing the optional APIs #when extracting #then those ports stay undefined", () => {
    // given
    const hostCtx = { cwd: "/tmp/project" }

    // when
    const ports = extractRecoveryEventContext(hostCtx)

    // then
    expect(ports).toBeDefined()
    expect(ports?.getContextUsage).toBeUndefined()
    expect(ports?.applyCompaction).toBeUndefined()
  })

  test("#given a non-record event context #when extracting #then undefined is returned without throwing", () => {
    // given / when / then
    expect(extractRecoveryEventContext(undefined)).toBeUndefined()
    expect(extractRecoveryEventContext("ctx")).toBeUndefined()
  })
})
