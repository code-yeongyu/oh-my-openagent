import { LspClient } from "../../src/lsp/client.js";
import type { ResolvedServer } from "../../src/lsp/types.js";

export interface FakeLspClientOptions {
	startDelayMs?: number;
	initDelayMs?: number;
	failStart?: boolean;
	failInitialize?: boolean;
	stopDelayMs?: number;
	startsAlive?: boolean;
}

export class FakeLspClient extends LspClient {
	private aliveFlag: boolean;
	startCallCount = 0;
	initializeCallCount = 0;
	stopCallCount = 0;

	constructor(
		root: string,
		server: ResolvedServer,
		private readonly opts: FakeLspClientOptions = {},
	) {
		super(root, server);
		this.aliveFlag = opts.startsAlive !== false;
	}

	override async start(): Promise<void> {
		this.startCallCount++;
		if (this.opts.startDelayMs !== undefined) {
			await new Promise((resolve) => setTimeout(resolve, this.opts.startDelayMs));
		}
		if (this.opts.failStart) {
			this.aliveFlag = false;
			throw new Error("fake start failed");
		}
	}

	override async initialize(): Promise<void> {
		this.initializeCallCount++;
		if (this.opts.initDelayMs !== undefined) {
			await new Promise((resolve) => setTimeout(resolve, this.opts.initDelayMs));
		}
		if (this.opts.failInitialize) {
			this.aliveFlag = false;
			throw new Error("fake initialize failed");
		}
	}

	override isAlive(): boolean {
		return this.aliveFlag;
	}

	override command(): string[] {
		return ["fake-server"];
	}

	override async stop(): Promise<void> {
		this.stopCallCount++;
		if (this.opts.stopDelayMs !== undefined) {
			await new Promise((resolve) => setTimeout(resolve, this.opts.stopDelayMs));
		}
		this.aliveFlag = false;
	}
}

export function makeServer(id: string, extensions: string[] = [".ts"]): ResolvedServer {
	return {
		id,
		command: ["fake-server", "--stdio"],
		extensions,
		priority: 0,
	};
}
