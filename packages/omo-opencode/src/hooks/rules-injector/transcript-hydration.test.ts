import { describe, expect, it, mock } from "bun:test";
import { createTranscriptHydrationStore } from "./transcript-hydration";

function makeClient(
	messages: (sessionID: string) => Promise<{ data: unknown }>,
): Parameters<typeof createTranscriptHydrationStore>[0]["client"] {
	const session = {
		messages: mock(async (args: { path: { id: string } }) =>
			messages(args.path.id),
		),
	};
	return { session };
}

function ruleMarker(relativePath: string, body = "Rule body."): string {
	return `\n\n[Rule: ${relativePath}]\n[Match: glob]\n${body}`;
}

describe("createTranscriptHydrationStore", () => {
	it("#given transcript with rule markers #when hydrateSession runs #then returns matched relativePaths", async () => {
		// given
		const transcript = {
			data: [
				{
					parts: [
						{
							type: "tool",
							output:
								ruleMarker("AGENTS.md") +
								ruleMarker(".omo/rules/typescript.md"),
						},
					],
				},
			],
		};
		const store = createTranscriptHydrationStore({
			client: makeClient(async () => transcript),
		});

		// when
		const relativePaths = await store.hydrateSession("session-1");

		// then
		expect([...relativePaths].sort()).toEqual([
			".omo/rules/typescript.md",
			"AGENTS.md",
		]);
	});

	it("#given empty transcript #when hydrateSession runs #then returns empty set", async () => {
		// given
		const store = createTranscriptHydrationStore({
			client: makeClient(async () => ({ data: [] })),
		});

		// when
		const result = await store.hydrateSession("session-1");

		// then
		expect(result.size).toBe(0);
	});

	it("#given hydrateSession called twice #when second call runs #then session.messages fetched only once", async () => {
		// given
		let callCount = 0;
		const store = createTranscriptHydrationStore({
			client: makeClient(async () => {
				callCount += 1;
				return {
					data: [
						{ parts: [{ type: "tool", output: ruleMarker("AGENTS.md") }] },
					],
				};
			}),
		});

		// when
		await store.hydrateSession("session-1");
		await store.hydrateSession("session-1");

		// then
		expect(callCount).toBe(1);
	});

	it("#given concurrent hydrateSession calls #when both await #then only one fetch is in-flight", async () => {
		// given
		let resolveFetch: (() => void) | undefined;
		let callCount = 0;
		const store = createTranscriptHydrationStore({
			client: makeClient(
				() =>
					new Promise((resolve) => {
						callCount += 1;
						resolveFetch = () =>
							resolve({
								data: [
									{
										parts: [{ type: "tool", output: ruleMarker("AGENTS.md") }],
									},
								],
							});
					}),
			),
		});

		// when
		const a = store.hydrateSession("session-1");
		const b = store.hydrateSession("session-1");
		resolveFetch?.();
		const [resultA, resultB] = await Promise.all([a, b]);

		// then
		expect(callCount).toBe(1);
		expect([...resultA]).toEqual(["AGENTS.md"]);
		expect([...resultB]).toEqual(["AGENTS.md"]);
	});

	it("#given fetch error #when hydrateSession runs #then returns empty set without throwing", async () => {
		// given
		const store = createTranscriptHydrationStore({
			client: makeClient(async () => {
				throw new Error("network down");
			}),
		});

		// when
		const result = await store.hydrateSession("session-1");

		// then
		expect(result.size).toBe(0);
	});

	it("#given fetch throws a non-error value #when hydrateSession runs #then rethrows it", async () => {
		// given
		const thrown = "network down";
		const store = createTranscriptHydrationStore({
			client: makeClient(async () => {
				throw thrown;
			}),
		});

		// when
		const hydrate = store.hydrateSession("session-1");

		// then
		await expect(hydrate).rejects.toBe(thrown);
	});

	it("#given hydrated session #when clearSession then re-hydrate #then transcript is rescanned", async () => {
		// given
		let callCount = 0;
		const store = createTranscriptHydrationStore({
			client: makeClient(async () => {
				callCount += 1;
				return {
					data: [
						{ parts: [{ type: "tool", output: ruleMarker("AGENTS.md") }] },
					],
				};
			}),
		});
		await store.hydrateSession("session-1");

		// when
		store.clearSession("session-1");
		await store.hydrateSession("session-1");

		// then
		expect(callCount).toBe(2);
	});

	it("#given marker line embedded inside larger text #when hydrate scans #then it still picks up the relativePath", async () => {
		// given
		const text = `some output\n\n[Rule: docs/AGENTS.md]\n[Match: alwaysApply]\nbody continues here\nmore lines`;
		const store = createTranscriptHydrationStore({
			client: makeClient(async () => ({ data: [{ output: text }] })),
		});

		// when
		const result = await store.hydrateSession("session-1");

		// then
		expect([...result]).toEqual(["docs/AGENTS.md"]);
	});
});
