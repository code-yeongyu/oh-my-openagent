import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { marketingBuzzword } from "./marketing-buzzword"

test("#given repeated stock phrases and concrete copy #then only stock phrases count", () => {
	const check = (text: string) => marketingBuzzword.check({ snapshot: buildSnapshot([{ tag: "p", text }]), config: {} })
	expect(check("STREAMLINE YOUR workflow and streamline your day. World-class enterprise-grade tools.")).toHaveLength(1)
	expect(check("Export an invoice as PDF in two clicks.")).toHaveLength(0)
	expect(check("revolutionize revolutionary")).toHaveLength(1)
})

test("#given hidden buzzwords beside visible concrete copy #then only painted copy contributes", () => {
	const check = (display: string) => marketingBuzzword.check({
		snapshot: buildSnapshot([{ style: { display }, children: [{ tag: "p", text: "Empower your team" }] }, { tag: "p", text: "Send invoices." }]), config: {},
	})
	expect(check("block")).toHaveLength(1)
	expect(check("none")).toHaveLength(0)
})
