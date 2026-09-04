import { execFileSync, fork } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { snapshot } from "./senpi-hooks-state-child.mjs";

const MESSAGE_TIMEOUT_MS = 10_000;
const childEntry = new URL("./senpi-hooks-state-child.mjs", import.meta.url);
const children = new Set();

function waitForMessage(child, predicate, description) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			child.off("message", onMessage);
			child.off("exit", onExit);
		};
		const onMessage = (message) => {
			if (!predicate(message)) return;
			cleanup();
			resolve(message);
		};
		const onExit = (code, signal) => {
			cleanup();
			reject(
				new Error(
					`Child exited before ${description}: ${code ?? signal ?? "unknown"}`,
				),
			);
		};
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for ${description}`));
		}, MESSAGE_TIMEOUT_MS);
		child.on("message", onMessage);
		child.on("exit", onExit);
	});
}

async function forkMode(mode, args) {
	const child = fork(childEntry, [mode, ...args], {
		stdio: ["ignore", "inherit", "inherit", "ipc"],
	});
	children.add(child);
	child.once("exit", () => children.delete(child));
	await waitForMessage(
		child,
		(message) => message === "ready",
		`${mode} ready`,
	);
	return child;
}

async function stopHolder(child, publication) {
	const published = waitForMessage(
		child,
		(message) => message === "released",
		"lock release",
	);
	child.send({ kind: "release", publication });
	await published;
}

async function main() {
	const consumerRoot = process.cwd();
	const senpiRoot = join(consumerRoot, "node_modules/@code-yeongyu/senpi");
	const { FileHookStateStorage } = await import(
		pathToFileURL(
			join(senpiRoot, "dist/core/extensions/builtin/hooks/trust-storage.js"),
		).href
	);
	const root = await mkdtemp(join(tmpdir(), "omo-packed-hooks-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "repo");
	const statePath = join(agentDir, "hooks-state.json");
	const lockPath = `${statePath}.lock`;
	const readBarrierPath = join(root, "read-boundary.fifo");
	const publicationBarrierPath = join(root, "publication-boundary.fifo");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	execFileSync("mkfifo", [readBarrierPath, publicationBarrierPath]);
	const storage = new FileHookStateStorage({ agentDir, cwd });

	try {
		const complete = snapshot("complete");
		writeFileSync(statePath, `${JSON.stringify(complete)}\n`, "utf8");
		const completeHolder = await forkMode("hold-lock", [
			lockPath,
			statePath,
			"complete",
		]);
		const lockFreeRead = storage.read("global");
		await stopHolder(completeHolder);
		if (JSON.stringify(lockFreeRead) !== JSON.stringify(complete))
			throw new Error("Complete read contended on the writer lock");

		const recovered = snapshot("recovered");
		const legacyHolder = await forkMode("hold-lock", [
			lockPath,
			statePath,
			"malformed",
		]);
		const lockedStart = performance.now();
		const failClosed = storage.read("global");
		const lockedElapsedMs = performance.now() - lockedStart;
		if (Object.keys(failClosed.hooks).length !== 0)
			throw new Error("ELOCKED exhaustion trusted malformed state");
		if (lockedElapsedMs > 2_000)
			throw new Error(
				`ELOCKED exhaustion was not bounded: ${lockedElapsedMs}ms`,
			);
		if (readFileSync(statePath, "utf8") !== "{ legacy writer")
			throw new Error("Contended read clobbered the legacy writer state");

		const recoveringReader = await forkMode("read-after-publication", [
			senpiRoot,
			agentDir,
			cwd,
			statePath,
			readBarrierPath,
		]);
		const readBoundary = waitForMessage(
			recoveringReader,
			(message) => message === "read-boundary",
			"contended read boundary",
		);
		recoveringReader.send("start");
		await readBoundary;
		await stopHolder(legacyHolder, recovered);
		const recoveredRead = waitForMessage(
			recoveringReader,
			(message) => message?.kind === "read-complete",
			"same-read recovery",
		);
		writeFileSync(readBarrierPath, "continue", "utf8");
		const recoveredMessage = await recoveredRead;
		if (JSON.stringify(recoveredMessage.state) !== JSON.stringify(recovered))
			throw new Error("Contended read missed the valid writer publication");

		const predecessor = snapshot("predecessor");
		const successor = snapshot("successor");
		storage.update("global", () => predecessor);
		const observer = await forkMode("observe-once", [statePath]);
		const publisher = await forkMode("publish-at-rename", [
			senpiRoot,
			agentDir,
			cwd,
			statePath,
			publicationBarrierPath,
		]);
		const publicationBoundary = waitForMessage(
			publisher,
			(message) => message === "publication-boundary",
			"publication boundary",
		);
		publisher.send({ kind: "publish", state: successor });
		await publicationBoundary;
		const observation = waitForMessage(
			observer,
			(message) => message?.kind === "observation-complete",
			"paused-publication observation",
		);
		observer.send("inspect");
		const observedMessage = await observation;
		if (JSON.stringify(observedMessage.state) !== JSON.stringify(predecessor))
			throw new Error("Observer saw a partial or early publication");
		const publication = waitForMessage(
			publisher,
			(message) => message?.kind === "publication-complete",
			"successor publication",
		);
		writeFileSync(publicationBarrierPath, "continue", "utf8");
		const publicationMessage = await publication;
		if (
			JSON.stringify(publicationMessage.state) !== JSON.stringify(successor) ||
			JSON.stringify(storage.read("global")) !== JSON.stringify(successor)
		)
			throw new Error("Atomic successor publication did not complete");

		if (process.platform !== "win32") {
			chmodSync(statePath, 0o640);
			storage.update("global", () => snapshot("mode-retained"));
			if ((statSync(statePath).mode & 0o777) !== 0o640)
				throw new Error("Existing POSIX mode was not retained");
			rmSync(statePath);
			storage.update("global", () => snapshot("mode-new"));
			if ((statSync(statePath).mode & 0o777) !== 0o600)
				throw new Error("New hooks-state file mode was not 0600");
		}

		let publicationError;
		try {
			storage.update("global", (current) => {
				rmSync(statePath);
				mkdirSync(statePath);
				return current;
			});
		} catch (error) {
			publicationError = error;
		}
		if (!(publicationError instanceof Error))
			throw new Error("Publication failure was swallowed");
		if (readdirSync(agentDir).some((name) => name.endsWith(".tmp")))
			throw new Error("Failed publication left a temporary file");
		rmSync(statePath, { recursive: true });
		writeFileSync(statePath, `${JSON.stringify(snapshot("causal"))}\n`, "utf8");

		const operationError = new Error("injected operation failure");
		let causalError;
		try {
			storage.update("global", () => {
				rmSync(lockPath, { recursive: true, force: true });
				writeFileSync(lockPath, "prevent lock-directory release", "utf8");
				throw operationError;
			});
		} catch (error) {
			causalError = error;
		}
		if (
			!(causalError instanceof AggregateError) ||
			causalError.errors.length !== 2 ||
			causalError.errors[0]?.message !== operationError.message ||
			!(causalError.errors[1] instanceof Error)
		) {
			throw new Error("Operation/release failures lost causal order");
		}

		process.stdout.write(
			`${JSON.stringify({
				ok: true,
				senpiRoot,
				lockFreeCompleteRead: true,
				mixedWriterRecovery: true,
				contendedReadNoClobber: true,
				atomicPublication: true,
				publicationBarrier: true,
				posixModes:
					process.platform === "win32" ? "platform-skipped" : "passed",
				lockedReadFailClosed: true,
				lockedElapsedMs: Math.round(lockedElapsedMs),
				publicationCleanup: true,
				causalErrors: true,
			})}\n`,
		);
	} finally {
		for (const child of children) child.kill("SIGKILL");
		await rm(root, { recursive: true, force: true });
	}
}

await main();
