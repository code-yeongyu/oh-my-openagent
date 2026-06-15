import { describe, expect, test } from "bun:test";
import { isPidAlive, stampOwner } from "./owner-fencing";

class ErrnoError extends Error {
	code?: string;
	constructor(message: string, code?: string) {
		super(message);
		this.code = code;
	}
}

describe("owner-fencing", () => {
	describe("#stampOwner", () => {
		test("should return stamp with current pid and startedAt ISO string", () => {
			// given
			// when
			const stamp = stampOwner();

			// then
			expect(stamp.pid).toBe(process.pid);
			expect(typeof stamp.startedAt).toBe("string");
			expect(() => new Date(stamp.startedAt).toISOString()).not.toThrow();
		});
	});

	describe("#isPidAlive", () => {
		test("should return true for current process pid with real default", () => {
			// given
			const pid = process.pid;

			// when
			const alive = isPidAlive(pid);

			// then
			expect(alive).toBe(true);
		});

		test("should return false for non-positive or non-integer pids", () => {
			// given
			const invalidPids = [0, -1, -100, 1.5, NaN, Infinity, -Infinity];

			for (const pid of invalidPids) {
				// when
				const alive = isPidAlive(pid);

				// then
				expect(alive).toBe(false);
			}
		});

		test("should return false when injected kill throws ESRCH", () => {
			// given
			const pid = 99999;
			const mockKill = () => {
				throw new ErrnoError("No such process", "ESRCH");
			};

			// when
			const alive = isPidAlive(pid, { kill: mockKill });

			// then
			expect(alive).toBe(false);
		});

		test("should return true when injected kill throws EPERM", () => {
			// given
			const pid = 99999;
			const mockKill = () => {
				throw new ErrnoError("Operation not permitted", "EPERM");
			};

			// when
			const alive = isPidAlive(pid, { kill: mockKill });

			// then
			expect(alive).toBe(true);
		});

		test("should return false when injected kill throws any other error", () => {
			// given
			const pid = 99999;
			const mockKill = () => {
				throw new Error("Some other error");
			};

			// when
			const alive = isPidAlive(pid, { kill: mockKill });

			// then
			expect(alive).toBe(false);
		});

		test("should return true when injected kill does not throw", () => {
			// given
			const pid = 99999;
			const mockKill = () => {
				// no-op
			};

			// when
			const alive = isPidAlive(pid, { kill: mockKill });

			// then
			expect(alive).toBe(true);
		});
	});
});
