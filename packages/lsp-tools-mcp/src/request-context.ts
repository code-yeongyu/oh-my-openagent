import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
	cwd?: string;
	env?: Record<string, string>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn);
}

export function contextCwd(): string {
	return storage.getStore()?.cwd ?? process.cwd();
}

export function contextEnv(key: string): string | undefined {
	const store = storage.getStore();
	if (store?.env) return store.env[key];
	return process.env[key];
}
