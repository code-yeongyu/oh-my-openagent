import { expect, test } from "bun:test"
import { formatConformanceReport, runAdapterConformance, type ConformanceFixtures, type MakeAdapter } from "./conformance"

export function testAdapterConformance(name: string, makeAdapter: MakeAdapter, makeFixtures: () => ConformanceFixtures): void {
  test(`${name} passes the adapter conformance suite`, async () => {
    const report = await runAdapterConformance(makeAdapter, makeFixtures())
    expect(report.checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.detail}`)).toEqual([])
    expect(report.ok).toBe(true)
    if (!report.ok) console.error(formatConformanceReport(report))
  })
}
