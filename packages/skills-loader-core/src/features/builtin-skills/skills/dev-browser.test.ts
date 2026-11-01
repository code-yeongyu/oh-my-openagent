/// <reference path="../../../../../../bun-test.d.ts" />

// dev-browser's start-server.ts runs `kill -9 $(lsof -ti:9223)` when nothing answers on 9222. A SIGKILLed Chrome skips
// its clean exit and leaks per-launch state (the macOS code-sign clone of the app bundle). The skill's standalone
// setup first releases that port with SIGTERM and a grace window, so start-server finds nothing left to SIGKILL.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { devBrowserSkill, releaseStaleCdpPortScript } from "./dev-browser"

const hasLsof = Bun.spawnSync(["sh", "-c", "command -v lsof"]).exitCode === 0
const cleanups: Array<() => void> = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
})

async function freePort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	if (address === null || typeof address === "string") throw new Error("no port")
	return address.port
}

async function startPortHolder(port: number, onTerm: "exit" | "ignore") {
	const dir = mkdtempSync(join(tmpdir(), "dev-browser-port-"))
	const events = join(dir, "events")
	const script = [
		"const fs = require('node:fs')",
		`process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(events)}, 'TERM\\n')${onTerm === "exit" ? "; process.exit(0)" : ""} })`,
		`require('node:net').createServer().listen(${port}, '127.0.0.1', () => process.stdout.write('READY\\n'))`,
	].join("\n")
	const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "ignore" })
	cleanups.push(() => {
		child.kill("SIGKILL")
		rmSync(dir, { recursive: true, force: true })
	})
	const listening = child.stdout.getReader().read()
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error(`port holder did not listen on ${port} within 5s`)), 5_000),
	)
	await Promise.race([listening, timeout])
	return { child, receivedTerm: () => existsSync(events) && readFileSync(events, "utf8").includes("TERM") }
}

// The release step the skill runs, then start-server.ts's own crash-recovery cleanup, verbatim in shell form.
async function runReleaseThenStartServerCleanup(httpPort: number, cdpPort: number, graceSeconds: number): Promise<number> {
	const startServerCleanup = `pid=$(lsof -ti:${cdpPort}); if [ -n "$pid" ]; then kill -9 $pid; fi`
	const script = `${releaseStaleCdpPortScript({ httpPort, cdpPort, graceSeconds })}\n${startServerCleanup}`
	const started = Date.now()
	const shell = Bun.spawn(["bash", "-c", script], { stdout: "ignore", stderr: "ignore" })
	await shell.exited
	return Date.now() - started
}

// start-server.ts reaches its kill path only through lsof, and Windows uses the PowerShell setup instead.
if (process.platform !== "win32" && hasLsof) describe("dev-browser standalone setup releases the CDP port", () => {
	test("a holder that quits on SIGTERM exits cleanly and never receives SIGKILL", async () => {
		const [httpPort, cdpPort] = [await freePort(), await freePort()]
		const holder = await startPortHolder(cdpPort, "exit")

		await runReleaseThenStartServerCleanup(httpPort, cdpPort, 5)
		await holder.child.exited

		expect(holder.receivedTerm()).toBe(true)
		expect(holder.child.signalCode).toBeNull()
		expect(holder.child.exitCode).toBe(0)
	}, { timeout: 20_000 })

	test("a holder that ignores SIGTERM is killed only after the grace window", async () => {
		const [httpPort, cdpPort] = [await freePort(), await freePort()]
		const holder = await startPortHolder(cdpPort, "ignore")

		const elapsed = await runReleaseThenStartServerCleanup(httpPort, cdpPort, 1)
		await holder.child.exited

		expect(holder.receivedTerm()).toBe(true)
		expect(holder.child.signalCode).toBe("SIGKILL")
		expect(elapsed).toBeGreaterThanOrEqual(900)
	}, { timeout: 20_000 })

	test("a running dev-browser server keeps its browser", async () => {
		const [httpPort, cdpPort] = [await freePort(), await freePort()]
		const server = Bun.serve({ port: httpPort, hostname: "127.0.0.1", fetch: () => new Response("ok") })
		cleanups.push(() => server.stop(true))
		const holder = await startPortHolder(cdpPort, "exit")

		await Bun.spawn(["bash", "-c", releaseStaleCdpPortScript({ httpPort, cdpPort, graceSeconds: 1 })]).exited

		expect(holder.receivedTerm()).toBe(false)
		expect(holder.child.exitCode).toBeNull()
	}, { timeout: 20_000 })

	test("the macOS/Linux standalone command runs the release step before server.sh", () => {
		const release = devBrowserSkill.template.indexOf(releaseStaleCdpPortScript())
		expect(release).toBeGreaterThan(-1)
		expect(release).toBeLessThan(devBrowserSkill.template.indexOf("./skills/dev-browser/server.sh &"))
	})
})
