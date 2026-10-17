// Contract tests for script/omob-desktop-engine.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { desktopEngineCargoArgs, ensureDesktopEngine } from "./omob-desktop-engine"

const RUST_TARGET = "x86_64-unknown-linux-gnu"
const ENGINE = join("target", RUST_TARGET, "release", "senpi-desktop-engine")

let root = ""
let repo = ""
let cargoLog = ""
let env: NodeJS.ProcessEnv = {}
const quiet = (): void => {}

function git(...args: string[]): void {
	const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" })
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stdout}${result.stderr}`)
}

function commitFile(path: string, content: string): void {
	mkdirSync(join(repo, path, ".."), { recursive: true })
	writeFileSync(join(repo, path), content)
	git("add", "-A")
	git("-c", "user.email=t@example.com", "-c", "user.name=Test", "commit", "-qm", `edit ${path}`)
}

function cargoCalls(): string[] {
	return existsSync(cargoLog) ? readFileSync(cargoLog, "utf8").split("\n").filter((line) => line !== "") : []
}

function installFakeCargo(script: string): string {
	const bin = join(root, "bin")
	mkdirSync(bin, { recursive: true })
	writeFileSync(join(bin, "cargo"), script)
	chmodSync(join(bin, "cargo"), 0o755)
	return bin
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omob-desktop-engine-"))
	repo = join(root, "omo")
	mkdirSync(join(repo, "script"), { recursive: true })
	spawnSync("git", ["init", "-q", "-b", "dev"], { cwd: repo })
	copyFileSync(join(import.meta.dir, "release-desktop-engine-fixture.json"), join(repo, "script", "release-desktop-engine-fixture.json"))
	writeFileSync(join(repo, "Cargo.toml"), "[workspace]\n")
	writeFileSync(join(repo, "Cargo.lock"), "version = 4\n")
	writeFileSync(join(repo, "rust-toolchain.toml"), "[toolchain]\nchannel = \"stable\"\n")
	commitFile(join("crates", "senpi-desktop-engine", "src", "main.rs"), "fn main() {}\n")
	cargoLog = join(root, "cargo.log")
	// Records each call, then writes the engine where cargo would: <CARGO_TARGET_DIR>/<triple>/release.
	const bin = installFakeCargo(
		`#!/bin/sh\necho "$* | $CARGO_TARGET_DIR" >> "${cargoLog}"\nwhile [ "$1" != "--target" ]; do shift; done\nmkdir -p "$CARGO_TARGET_DIR/$2/release"\necho engine > "$CARGO_TARGET_DIR/$2/release/senpi-desktop-engine"\n`,
	)
	env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, CARGO_TARGET_DIR: join(root, "elsewhere") }
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === "win32")("ensureDesktopEngine", () => {
	test("#given no engine binary #when the build runs #then cargo builds it with the release flags into the clone's target dir", () => {
		expect(ensureDesktopEngine(repo, "linux-x64", env, quiet)).toBe("built")
		expect(cargoCalls()).toEqual([`${desktopEngineCargoArgs(RUST_TARGET).join(" ")} | ${join(repo, "target")}`])
		expect(cargoCalls()[0]).toStartWith(`build --release -p senpi-desktop-engine --locked --target ${RUST_TARGET}`)
		expect(existsSync(join(repo, ENGINE))).toBe(true)
		expect(existsSync(join(root, "elsewhere"))).toBe(false)
	})

	test("#given a built engine and unchanged sources #when the build runs again #then cargo is not invoked", () => {
		ensureDesktopEngine(repo, "linux-x64", env, quiet)
		commitFile("README.md", "not an engine input\n")
		expect(ensureDesktopEngine(repo, "linux-x64", env, quiet)).toBe("reused")
		expect(cargoCalls()).toHaveLength(1)
	})

	test("#given a built engine #when an engine crate changes #then the engine is rebuilt", () => {
		ensureDesktopEngine(repo, "linux-x64", env, quiet)
		commitFile(join("crates", "senpi-desktop-engine", "src", "main.rs"), "fn main() { println!(); }\n")
		expect(ensureDesktopEngine(repo, "linux-x64", env, quiet)).toBe("built")
		commitFile("Cargo.lock", "version = 4\n# bumped\n")
		expect(ensureDesktopEngine(repo, "linux-x64", env, quiet)).toBe("built")
		expect(cargoCalls()).toHaveLength(3)
	})

	test("#given a built engine #when the binary is deleted or replaced #then the engine is rebuilt", () => {
		ensureDesktopEngine(repo, "linux-x64", env, quiet)
		rmSync(join(repo, ENGINE))
		expect(ensureDesktopEngine(repo, "linux-x64", env, quiet)).toBe("built")
		writeFileSync(join(repo, ENGINE), "a hand-copied binary of another build")
		expect(ensureDesktopEngine(repo, "linux-x64", env, quiet)).toBe("built")
		expect(cargoCalls()).toHaveLength(3)
	})

	test("#given a target that ships no engine #when the build runs #then cargo is skipped", () => {
		expect(ensureDesktopEngine(repo, "linux-arm64", env, quiet)).toBe("skipped")
		expect(cargoCalls()).toEqual([])
	})

	test("#given a checkout that predates the desktop engine #when the build runs #then cargo is skipped", () => {
		rmSync(join(repo, "script", "release-desktop-engine-fixture.json"))
		expect(ensureDesktopEngine(repo, "linux-x64", env, quiet)).toBe("skipped")
		expect(cargoCalls()).toEqual([])
	})

	test("#given no cargo on PATH #when the engine must be built #then one line names the missing Rust toolchain", () => {
		const empty = join(root, "empty-bin")
		mkdirSync(empty)
		let message = ""
		try {
			ensureDesktopEngine(repo, "linux-x64", { ...env, PATH: empty }, quiet)
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		}
		expect(message).toContain("Rust toolchain")
		expect(message).toContain("cargo is not on PATH")
		expect(message).not.toContain("\n")
	})

	test("#given a failing cargo #when the build runs #then it fails with a rustup hint and the next run retries", () => {
		const failing = installFakeCargo(`#!/bin/sh\necho "$*" >> "${cargoLog}"\nexit 101\n`)
		expect(() => ensureDesktopEngine(repo, "linux-x64", { ...env, PATH: `${failing}:${process.env.PATH ?? ""}` }, quiet)).toThrow(
			`rustup target add ${RUST_TARGET}`,
		)
		expect(() => ensureDesktopEngine(repo, "linux-x64", { ...env, PATH: `${failing}:${process.env.PATH ?? ""}` }, quiet)).toThrow(/exit code 101/)
		expect(cargoCalls()).toHaveLength(2)
	})
})
