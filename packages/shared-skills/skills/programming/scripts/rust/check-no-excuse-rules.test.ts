import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The skill runs this checker with `bash`; Windows runners resolve `bash` to WSL or nothing.
const describeUnix = process.platform === "win32" ? describe.skip : describe

const script = join(import.meta.dir, "check-no-excuse-rules.sh")
let workDir = ""

function check(name: string, source: string) {
	const file = join(workDir, "src", name)
	writeFileSync(file, source)
	const result = spawnSync("bash", [script, file], { encoding: "utf8", timeout: 30_000 })
	return { status: result.status, stderr: result.stderr }
}

describeUnix("#given the Rust no-excuse checker", () => {
	beforeAll(() => {
		workDir = mkdtempSync(join(tmpdir(), "rust-no-excuse-"))
		mkdirSync(join(workDir, "src"))
	})

	afterAll(() => {
		rmSync(workDir, { recursive: true, force: true })
	})

	test("#when a file follows every rule #then it exits 0", () => {
		const result = check("clean.rs", 'pub fn port(raw: &str) -> Option<u16> {\n    raw.parse().ok()\n}\n')
		expect(result.status).toBe(0)
	})

	test("#when unwrap is used outside tests #then it reports the unwrap rule", () => {
		const result = check("unwrap.rs", "pub fn first(v: &[u8]) -> u8 {\n    *v.first().unwrap()\n}\n")
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("[unwrap]")
	})

	test("#when an invariant expect carries #[expect(clippy::expect_used, reason)] #then it passes", () => {
		const result = check(
			"invariant.rs",
			'pub fn re() -> regex::Regex {\n    #[expect(clippy::expect_used, reason = "literal pattern")]\n    regex::Regex::new("a+").expect("valid literal")\n}\n',
		)
		expect(result.status).toBe(0)
	})

	test("#when a lint is silenced with #[allow] #then it reports the allow-attribute rule", () => {
		const result = check("allow.rs", "#[allow(clippy::too_many_lines)]\npub fn big() {}\n")
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("[allow-attribute]")
	})

	test("#when #[expect] has no reason #then it reports the expect-without-reason rule", () => {
		const result = check("noreason.rs", "#[expect(clippy::too_many_lines)]\npub fn big() {}\n")
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("[expect-without-reason]")
	})

	test("#when a fallible call is discarded with let _ #then it reports the discarded-result rule", () => {
		const result = check("discard.rs", 'pub fn cleanup() {\n    let _ = std::fs::remove_file("x");\n}\n')
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("[discarded-result]")
	})

	test("#when a blocking std call runs inside an async fn #then it reports blocking-in-async", () => {
		const result = check(
			"blocking.rs",
			"pub async fn wait(\n    ms: u64,\n) {\n    std::thread::sleep(std::time::Duration::from_millis(ms));\n}\n",
		)
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("[blocking-in-async]")
	})

	test("#when the same blocking call runs in a sync fn after an async fn #then it passes", () => {
		const result = check(
			"sync-after-async.rs",
			"pub async fn ready() {}\n\npub fn wait(ms: u64) {\n    std::thread::sleep(std::time::Duration::from_millis(ms));\n}\n",
		)
		expect(result.status).toBe(0)
	})
})
