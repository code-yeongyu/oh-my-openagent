import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { crc32, PNG_SIGNATURE } from "./png-check"

const scriptsDir = import.meta.dir
const cli = join(scriptsDir, "validate-evidence.ts")
const work = mkdtempSync(join(tmpdir(), "validate-evidence-"))
const repo = join(work, "repo")
const evidence = join(work, "evidence")

function git(args: readonly string[]): string {
	const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" })
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
	return result.stdout.toString().trim()
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length, 0)
	const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(typeAndData), 0)
	return Buffer.concat([length, typeAndData, crc])
}

function validPng(): Buffer {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(2, 0)
	ihdr.writeUInt32BE(2, 4)
	ihdr[8] = 8
	ihdr[9] = 2
	return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", Buffer.from([0x78, 0x9c, 0x03, 0x00])), chunk("IEND", Buffer.alloc(0))])
}

function badCrcPng(): Buffer {
	const png = validPng()
	const idatDataIndex = png.length - 18
	png.writeUInt8(png.readUInt8(idatDataIndex) ^ 0xff, idatDataIndex)
	return png
}

function run(args: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
	const result = Bun.spawnSync(["bun", cli, ...args], { cwd: work, stdout: "pipe", stderr: "pipe" })
	return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

type Row = Record<string, unknown>
function row(overrides: Row): Row {
	return { id: "1", scenario: "s", surface: "cli", command: "c", expected: "e", observed: "o", verdict: "PASS", artifacts: ["out.txt"], ...overrides }
}

function writeMatrix(rows: Row[], source: Record<string, unknown>, dir = evidence): void {
	writeFileSync(join(dir, "qa-matrix.json"), JSON.stringify({ schemaVersion: 1, capturedAt: "2026-11-07T05:00:00Z", source, rows }))
}

let headSha = ""

beforeAll(() => {
	mkdirSync(repo)
	mkdirSync(evidence)
	git(["init", "-q", "-b", "main"])
	git(["config", "user.email", "qa@example.com"])
	git(["config", "user.name", "QA"])
	writeFileSync(join(repo, "a.txt"), "one\n")
	git(["add", "a.txt"])
	git(["commit", "-q", "-m", "init"])
	headSha = git(["rev-parse", "HEAD"])
	writeFileSync(join(evidence, "out.txt"), "hello\n")
	writeFileSync(join(evidence, "empty.txt"), "")
	writeFileSync(join(evidence, "shot.png"), validPng())
	writeFileSync(join(evidence, "truncated.png"), validPng().subarray(0, 20))
	writeFileSync(join(evidence, "badcrc.png"), badCrcPng())
	writeFileSync(join(work, "outside.txt"), "x\n")
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe("validate-evidence", () => {
	test("#given a clean tree and a complete matrix #when validated #then it passes with the verdict counts", () => {
		writeMatrix(
			[
				row({ id: "1", surface: "cli", artifacts: ["out.txt"] }),
				row({ id: "2", surface: "web", artifacts: ["shot.png", "out.txt"] }),
				row({ id: "3", verdict: "FAIL", artifacts: [] }),
				row({ id: "4", verdict: "NA", artifacts: [], naReason: "headless API has no viewport" }),
			],
			{ commitSha: headSha, dirty: false },
		)
		const result = run([evidence, "--repo", repo])
		expect(result.stderr).toBe("")
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("PASS=2")
		expect(result.stdout).toContain("FAIL=1")
		expect(result.stdout).toContain("NA=1")
	})

	test("#given a stale commit sha #when validated #then both shas are named and it fails", () => {
		const stale = "a".repeat(40)
		writeMatrix([row({})], { commitSha: stale, dirty: false })
		const result = run([evidence, "--repo", repo])
		expect(result.exitCode).toBe(1)
		expect(result.stdout).toContain(stale)
		expect(result.stdout).toContain(headSha)
	})

	test("#given a dirty tree #when the matrix claims clean or carries the wrong hash #then it fails, and the right hash passes", () => {
		writeFileSync(join(repo, "a.txt"), "two\n")
		writeMatrix([row({})], { commitSha: headSha, dirty: false })
		expect(run([evidence, "--repo", repo]).exitCode).toBe(1)
		writeMatrix([row({})], { commitSha: headSha, dirty: true, treeHash: "0".repeat(64) })
		expect(run([evidence, "--repo", repo]).exitCode).toBe(1)
		const stamp = JSON.parse(run(["stamp", "--repo", repo]).stdout) as { source: Record<string, unknown>; capturedAt: string }
		expect(stamp.source.dirty).toBe(true)
		expect(typeof stamp.source.treeHash).toBe("string")
		writeMatrix([row({})], stamp.source)
		expect(run([evidence, "--repo", repo]).exitCode).toBe(0)
		writeFileSync(join(repo, "a.txt"), "one\n")
		writeMatrix([row({})], { commitSha: headSha, dirty: true, treeHash: "0".repeat(64) })
		expect(run([evidence, "--repo", repo]).exitCode).toBe(1)
	})

	test("#given broken png artifacts #when validated #then each is named", () => {
		writeMatrix([row({ id: "1", surface: "web", artifacts: ["truncated.png"] }), row({ id: "2", surface: "gui", artifacts: ["badcrc.png"] })], { commitSha: headSha, dirty: false })
		const result = run([evidence, "--repo", repo])
		expect(result.exitCode).toBe(1)
		expect(result.stdout).toContain("truncated.png")
		expect(result.stdout).toContain("badcrc.png")
	})

	test("#given NA without a reason, PASS without artifacts, an empty artifact, an escaping path, a web PASS without a png #when validated #then each row is rejected", () => {
		writeMatrix(
			[
				row({ id: "na", verdict: "NA", artifacts: [] }),
				row({ id: "none", artifacts: [] }),
				row({ id: "empty", artifacts: ["empty.txt"] }),
				row({ id: "escape", artifacts: ["../outside.txt"] }),
				row({ id: "web", surface: "web", artifacts: ["out.txt"] }),
			],
			{ commitSha: headSha, dirty: false },
		)
		const result = run([evidence, "--repo", repo, "--json"])
		expect(result.exitCode).toBe(1)
		const parsed = JSON.parse(result.stdout) as { errors: { rowId: string | null; message: string }[] }
		const rowIds = parsed.errors.map((error) => error.rowId)
		for (const id of ["na", "none", "empty", "escape", "web"]) expect(rowIds).toContain(id)
	})

	test("#given a bad verdict, duplicate ids, an unknown surface and a bare-year capturedAt #when validated #then the shape errors are reported", () => {
		writeFileSync(
			join(evidence, "qa-matrix.json"),
			JSON.stringify({ schemaVersion: 1, capturedAt: "2026", source: { commitSha: headSha, dirty: false }, rows: [row({ id: "1", verdict: "partial" }), row({ id: "1", surface: "mobile" })] }),
		)
		const result = run([evidence, "--repo", repo, "--json"])
		expect(result.exitCode).toBe(1)
		const messages = (JSON.parse(result.stdout) as { errors: { message: string }[] }).errors.map((error) => error.message).join("\n")
		expect(messages).toContain("verdict")
		expect(messages).toContain("duplicate")
		expect(messages).toContain("surface")
		expect(messages).toContain("capturedAt")
	})

	test("#given no evidence dir or a missing matrix #when invoked #then usage and missing-file exits are distinct", () => {
		expect(run([]).exitCode).toBe(2)
		const emptyDir = join(work, "empty-evidence")
		mkdirSync(emptyDir)
		expect(run([emptyDir]).exitCode).toBe(1)
	})
})
