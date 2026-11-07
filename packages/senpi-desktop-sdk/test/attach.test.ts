import fs from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerError, connect } from "../src/index";
import { type AttachEnvironment, attachUds, BRIDGE_REFUSED_METHODS, processEnvironment } from "../src/transport/attach-uds";

const SCHEMA = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../crates/senpi-desktop-core/schema/engine.schema.json",
);

interface FakeDaemon {
	readonly endpoint: string;
	readonly dir: string;
	readonly connections: string[][];
	closed(index: number): Promise<void>;
	received(method: string): Promise<void>;
	push(line: unknown): void;
	dropAll(): void;
}

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const step of cleanup.splice(0).reverse()) await step();
});

function privateDir(mode = 0o700): string {
	const dir = fs.mkdtempSync(path.join(tmpdir(), "senpi-attach-"));
	fs.chmodSync(dir, mode);
	cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

// A Linux UDS fake of the `--serve` daemon; `unanswered` is never replied to.
async function fakeDaemon(dir = privateDir(), unanswered = ""): Promise<FakeDaemon> {
	const endpoint = path.join(dir, "e.sock");
	const connections: string[][] = [];
	const closes: Array<Promise<void>> = [];
	const sockets: net.Socket[] = [];
	const waiters = new Map<string, () => void>();
	const server = net.createServer((socket) => {
		const lines: string[] = [];
		connections.push(lines);
		sockets.push(socket);
		closes.push(new Promise((resolve) => socket.once("close", () => resolve())));
		let buffer = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				lines.push(line);
				const request = JSON.parse(line);
				waiters.get(request.method)?.();
				if (request.id === undefined || request.method === unanswered) continue;
				const result = request.method === "engine.hello" ? { protocolVersion: "1" } : { echo: request.params };
				socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(endpoint, resolve));
	cleanup.push(
		() =>
			new Promise<void>((resolve) => {
				for (const socket of sockets) socket.destroy();
				server.close(() => resolve());
			}),
	);
	return {
		endpoint,
		dir,
		connections,
		closed: async (index) => {
			await closes[index];
		},
		received: (method) =>
			new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`waited 5 s for ${method}, it never arrived`)), 5_000);
				waiters.set(method, () => {
					clearTimeout(timer);
					resolve();
				});
			}),
		dropAll: () => {
			for (const socket of sockets) socket.destroy();
		},
		push: (line) => {
			for (const socket of sockets) socket.write(`${JSON.stringify(line)}\n`);
		},
	};
}

function environment(overrides: Partial<AttachEnvironment>): AttachEnvironment {
	return { ...processEnvironment, env: {}, ...overrides };
}

async function refusalOf(attempt: Promise<unknown>): Promise<ComputerError> {
	const failure = await attempt.then(
		() => undefined,
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(ComputerError);
	return failure as ComputerError;
}

describe.skipIf(process.platform === "win32")("sdk attach over a unix socket", () => {
	it("#given two attach ports on one daemon #when both call #then each gets its own replies and notifications reach both", async () => {
		const daemon = await fakeDaemon();
		const first = await attachUds(daemon.endpoint, environment({}));
		const second = await attachUds(daemon.endpoint, environment({}));
		cleanup.push(() => first.close(), () => second.close());
		const seen: unknown[] = [];
		second.notifications.subscribe((notification) => seen.push(notification));

		const [hello, echoed] = await Promise.all([first.call("engine.hello", {}), second.call("windows", { n: 2 })]);
		const notified = new Promise<void>((resolve) => second.notifications.subscribe(() => resolve()));
		daemon.push({ jsonrpc: "2.0", method: "stopPath.changed", params: { suspended: true } });
		await notified;

		expect(hello).toEqual({ protocolVersion: "1" });
		expect(echoed).toEqual({ echo: { n: 2 } });
		expect(seen).toEqual([{ jsonrpc: "2.0", method: "stopPath.changed", params: { suspended: true } }]);
	});

	it("#given connect with an attach transport #when the computer closes #then the daemon sees the connection end", async () => {
		const daemon = await fakeDaemon();
		const computer = await connect({ kind: "attach", endpoint: daemon.endpoint });

		await computer.close();
		await daemon.closed(0);

		expect(daemon.connections).toEqual([[]]);
	});

	it("#given T25-12 #when a host-only or test-only method is called #then it is refused and nothing is sent", async () => {
		const daemon = await fakeDaemon();
		const port = await attachUds(daemon.endpoint, environment({}));
		cleanup.push(() => port.close());

		const refused = await Promise.allSettled(
			Object.keys(BRIDGE_REFUSED_METHODS).map((method) => port.call(method as never, {})),
		);
		await port.call("capabilities", {});

		expect(refused.map((outcome) => outcome.status)).toEqual(refused.map(() => "rejected"));
		const first = refused[0] as PromiseRejectedResult;
		expect(first.reason).toMatchObject({ rpcCode: -32601, data: { reason: "hostOnly" }, nothingSent: true });
		expect(daemon.connections[0]?.map((line) => JSON.parse(line).method)).toEqual(["capabilities"]);
	});

	it("#given the engine schema #when its host-only and test-only methods are listed #then the attach refusal set matches", () => {
		const schema = JSON.parse(fs.readFileSync(SCHEMA, "utf8")) as {
			readonly methods: Record<string, { readonly hostOnly: boolean; readonly testOnly: boolean }>;
		};
		const expected = Object.fromEntries(
			Object.entries(schema.methods)
				.filter(([, spec]) => spec.hostOnly || spec.testOnly)
				.map(([name, spec]) => [name, spec.testOnly ? "testOnly" : "hostOnly"]),
		);

		expect(BRIDGE_REFUSED_METHODS).toEqual(expected);
	});

	it("#given T25-21 SENPI_DESKTOP_HOST=1 #when attach is asked #then ControlRequired attach_inside_session and no connection", async () => {
		const daemon = await fakeDaemon();

		const refused = await refusalOf(attachUds(daemon.endpoint, environment({ env: { SENPI_DESKTOP_HOST: "1" } })));

		expect(refused.code).toBe("ControlRequired");
		expect(refused.data.reason).toBe("attach_inside_session");
		expect(refused.nothingSent).toBe(true);
		expect(daemon.connections).toEqual([]);
	});

	it("#given T25-13 a parent group or other can enter #when attach is asked #then it is refused before connecting", async () => {
		const daemon = await fakeDaemon();
		fs.chmodSync(daemon.dir, 0o750);

		const refused = await refusalOf(attachUds(daemon.endpoint, environment({})));

		expect(refused.data.reason).toBe("endpoint_refused");
		expect(daemon.connections).toEqual([]);
	});

	it("#given T25-13 a parent owned by another uid #when attach is asked #then it is refused before connecting", async () => {
		const daemon = await fakeDaemon();
		const me = processEnvironment.euid();

		const refused = await refusalOf(attachUds(daemon.endpoint, environment({ euid: () => me + 1 })));

		expect(refused.data.reason).toBe("endpoint_refused");
		expect(daemon.connections).toEqual([]);
	});

	it("#given T25-13 a symlinked parent #when attach is asked #then O_NOFOLLOW refuses it", async () => {
		const daemon = await fakeDaemon();
		const link = path.join(privateDir(), "link");
		fs.symlinkSync(daemon.dir, link);

		const refused = await refusalOf(attachUds(path.join(link, "e.sock"), environment({})));

		expect(refused.data.reason).toBe("endpoint_refused");
		expect(daemon.connections).toEqual([]);
	});

	it.runIf(process.platform === "linux")(
		"#given T25-13 on linux #when attach connects #then it goes through the checked directory fd",
		async () => {
			const daemon = await fakeDaemon();
			const spy = vi.spyOn(net, "createConnection");

			const port = await attachUds(daemon.endpoint, environment({}));
			cleanup.push(() => port.close());

			const target = (spy.mock.calls[0]?.[0] as { readonly path?: string } | undefined)?.path ?? "";
			expect(target).toMatch(/^\/proc\/self\/fd\/\d+\/e\.sock$/);
		},
	);

	it("#given T25-25 a socket served by another uid #when attach connects #then it closes before writing a byte", async () => {
		const daemon = await fakeDaemon();
		const me = processEnvironment.euid();

		const refused = await refusalOf(attachUds(daemon.endpoint, environment({ serverUid: () => me + 1 })));
		await daemon.closed(0);

		expect(refused.data.reason).toBe("server_refused");
		expect(daemon.connections).toEqual([[]]);
	});

	it("#given T25-25 an unavailable server uid #when attach connects #then it fails closed before writing a byte", async () => {
		const daemon = await fakeDaemon();
		const unavailable = () => {
			throw new Error("no credentials");
		};

		const refused = await refusalOf(attachUds(daemon.endpoint, environment({ serverUid: unavailable })));
		await daemon.closed(0);

		expect(refused.data.reason).toBe("server_refused");
		expect(daemon.connections).toEqual([[]]);
	});

	it("#given a request in flight #when the daemon drops the connection #then the call rejects as Closed", async () => {
		const daemon = await fakeDaemon(privateDir(), "windows");
		const port = await attachUds(daemon.endpoint, environment({}));
		const arrived = daemon.received("windows");

		const outcome = port.call("windows", {}).catch((error: unknown) => error);
		await arrived;
		daemon.dropAll();

		expect(await outcome).toMatchObject({ code: "Closed" });
		await expect(port.call("windows", {})).rejects.toMatchObject({ code: "Closed", nothingSent: true });
	});
});
