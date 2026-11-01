/// <reference path="../../../../../../bun-test.d.ts" />

// dev-browser's start-server.ts runs `kill -9 $(lsof -ti:9223)` when nothing answers on 9222. A SIGKILLed Chrome skips
// its clean exit and leaks per-launch state (the macOS code-sign clone of the app bundle). The skill's standalone
// setup first releases that port with SIGTERM and a grace window, so start-server finds nothing left to SIGKILL.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { devBrowserSkill, releaseStaleCdpPortScript } from "./dev-browser"

function which(name: string): string | null {
	const found = Bun.spawnSync(["sh", "-c", `command -v ${name}`])
	return found.exitCode === 0 ? found.stdout.toString().trim() : null
}
const hasLsof = which("lsof") !== null
const zshPath = which("zsh")
const cleanups: Array<() => void> = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
})

// Only for the HTTP port, which must have nothing answering; every port a test listens on is bound on 0 instead.
async function freePort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	if (address === null || typeof address === "string") throw new Error("no port")
	return address.port
}

// A process with a socket on the CDP port, so `lsof -ti:<port>` lists it. "listen" binds a fresh port and prints it;
// "connect" opens a client connection to an existing port, which lsof also reports for that port.
async function startPortProcess(socket: { listen: true } | { connect: number }, onTerm: "exit" | "ignore") {
	const dir = mkdtempSync(join(tmpdir(), "dev-browser-port-"))
	const events = join(dir, "events")
	const open =
		"listen" in socket
			? "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => process.stdout.write(s.address().port + '\\n'))"
			: `require('node:net').connect(${socket.connect}, '127.0.0.1', () => process.stdout.write('${socket.connect}\\n'))`
	const script = [
		"const fs = require('node:fs')",
		`process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(events)}, 'TERM\\n')${onTerm === "exit" ? "; process.exit(0)" : ""} })`,
		open,
	].join("\n")
	const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "ignore" })
	cleanups.push(() => {
		child.kill("SIGKILL")
		rmSync(dir, { recursive: true, force: true })
	})
	const ready = child.stdout.getReader().read()
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error("port process did not open its socket within 5s")), 5_000),
	)
	const { value } = await Promise.race([ready, timeout])
	const port = Number(new TextDecoder().decode(value).trim())
	return { child, port, receivedTerm: () => existsSync(events) && readFileSync(events, "utf8").includes("TERM") }
}

// Resolves when the process exits, or after `ms` so a missing signal fails the assertion instead of the test timeout.
function exitedWithin(child: { exited: Promise<number> }, ms: number): Promise<void> {
	return Promise.race([child.exited.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))])
}

// A stand-in for a running dev-browser server: answers 200 on its HTTP port.
function startAnsweringServer(): number {
	const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") })
	cleanups.push(() => server.stop(true))
	if (server.port === undefined) throw new Error("server has no port")
	return server.port
}

function startPortHolder(onTerm: "exit" | "ignore") {
	return startPortProcess({ listen: true }, onTerm)
}

async function runRelease(shell: string, httpPort: number, cdpPort: number, env?: Record<string, string>, prefix = "", graceSeconds = 1) {
	const script = `${prefix}${releaseStaleCdpPortScript({ httpPort, cdpPort, graceSeconds })}`
	return Bun.spawn([shell, "-c", script], { stdout: "ignore", stderr: "ignore", ...(env ? { env } : {}) }).exited
}

// The release step the skill runs, then start-server.ts's own crash-recovery cleanup in shell form. Pinned copy of
// SawyerHood/dev-browser skills/dev-browser/scripts/start-server.ts lines 90-95 at e77f8ab8bd545971bd584bbbc97946e92956cfeb
// (`lsof -ti:9223`, then `kill -9 ${pid}`), the file's last revision before upstream 9ddbc132
// replaced it with the dev-browser CLI. Re-check this line against that file if the skill's server.sh moves to a new upstream.
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
		const httpPort = await freePort()
		const holder = await startPortHolder("exit")
		const cdpPort = holder.port

		await runReleaseThenStartServerCleanup(httpPort, cdpPort, 5)
		await holder.child.exited

		expect(holder.receivedTerm()).toBe(true)
		expect(holder.child.signalCode).toBeNull()
		expect(holder.child.exitCode).toBe(0)
	}, { timeout: 20_000 })

	test("a holder that ignores SIGTERM is killed only after the grace window", async () => {
		const httpPort = await freePort()
		const holder = await startPortHolder("ignore")
		const cdpPort = holder.port

		const elapsed = await runReleaseThenStartServerCleanup(httpPort, cdpPort, 1)
		await holder.child.exited

		expect(holder.receivedTerm()).toBe(true)
		expect(holder.child.signalCode).toBe("SIGKILL")
		expect(elapsed).toBeGreaterThanOrEqual(900)
	}, { timeout: 20_000 })

	test("a running dev-browser server keeps its browser", async () => {
		const httpPort = startAnsweringServer()
		const holder = await startPortHolder("exit")

		await runRelease("bash", httpPort, holder.port)

		expect(holder.receivedTerm()).toBe(false)
		expect(holder.child.exitCode).toBeNull()
	}, { timeout: 20_000 })

	test("without curl a running server's browser is left alone, because nothing can tell whether it answers", async () => {
		const httpPort = startAnsweringServer()
		const holder = await startPortHolder("exit")
		const bin = mkdtempSync(join(tmpdir(), "dev-browser-nocurl-"))
		cleanups.push(() => rmSync(bin, { recursive: true, force: true }))
		for (const tool of ["lsof", "seq", "sleep"]) {
			const path = which(tool)
			if (path === null) throw new Error(`${tool} is not on PATH`)
			symlinkSync(path, join(bin, tool))
		}

		await runRelease(which("bash") ?? "/bin/bash", httpPort, holder.port, { PATH: bin })

		expect(holder.receivedTerm()).toBe(false)
		expect(holder.child.exitCode).toBeNull()
	}, { timeout: 20_000 })

	if (zshPath !== null) test("under zsh every pid on the port gets SIGTERM", async () => {
		const httpPort = await freePort()
		const holder = await startPortHolder("exit")
		const client = await startPortProcess({ connect: holder.port }, "exit")

		await runRelease(zshPath, httpPort, holder.port)
		await Promise.all([exitedWithin(holder.child, 5_000), exitedWithin(client.child, 5_000)])

		expect([holder.receivedTerm(), client.receivedTerm()]).toEqual([true, true])
		expect([holder.child.exitCode, client.child.exitCode]).toEqual([0, 0])
	}, { timeout: 20_000 })

	test("with no grace window it still runs cleanly under set -u", async () => {
		const httpPort = await freePort()
		const holder = await startPortHolder("exit")

		const exitCode = await runRelease("bash", httpPort, holder.port, undefined, "set -u\n", 0)

		expect(exitCode).toBe(0)
		expect(holder.receivedTerm()).toBe(true)
	}, { timeout: 20_000 })

	test("the macOS/Linux standalone command runs the release step before server.sh", () => {
		const release = devBrowserSkill.template.indexOf(releaseStaleCdpPortScript())
		expect(release).toBeGreaterThan(-1)
		expect(release).toBeLessThan(devBrowserSkill.template.indexOf("./skills/dev-browser/server.sh &"))
	})
})
