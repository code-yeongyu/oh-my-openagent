import { describe, expect, it } from "vitest";
import { helloDesktopEngine } from "../src/handshake";
import { legacySelf, refusalChild, refusalRecord } from "./refusal-child";

describe("hello helper launch refusal", () => {
	for (const reason of ["self-responsible", "unresolved"]) {
		it(`reports ${reason} from its actual child`, async () => {
			await expect(helloDesktopEngine("/fixture", {
				spawnEngine: () => refusalChild({ stderr: refusalRecord(reason) }),
			})).rejects.toMatchObject({ code: "launch-context-unavailable", reason });
		}, 10_000);
	}
	it("keeps EPIPE subordinate to drained startup refusal", async () => {
		await expect(helloDesktopEngine("/fixture", {
			spawnEngine: () => {
				const child = refusalChild();
				queueMicrotask(() => child.stdin.emit("error", new Error("EPIPE")));
				return child;
			},
		})).rejects.toHaveProperty("code", "launch-context-unavailable");
	}, 10_000);
	it("does not rescue malformed structured output using legacy output", async () => {
		await expect(helloDesktopEngine("/fixture", {
			spawnEngine: () => refusalChild({ stderr: "SENPI_DESKTOP_LAUNCH_REFUSED {}\n" + legacySelf }),
		})).rejects.toHaveProperty("code", "handshake-failed");
	}, 10_000);
	it("does not relabel a valid hello followed by marker text", async () => {
		expect(await helloDesktopEngine("/fixture", {
			spawnEngine: () => refusalChild({ hello: true }),
		})).toHaveProperty("engineVersion", "fixture");
	}, 10_000);
});
