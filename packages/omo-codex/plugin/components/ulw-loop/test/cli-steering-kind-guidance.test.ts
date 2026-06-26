import { describe, expect, it } from "vitest";

import { parseSteeringKind } from "../src/cli-steering.js";

describe("#given a steering command without --kind", () => {
	describe("#when parsing the steering kind", () => {
		it("#then explains allowed kinds and shows a usable example", () => {
			const action = (): void => {
				parseSteeringKind([]);
			};

			expect(action).toThrow(/Allowed --kind values:/);
			expect(action).toThrow(/annotate_ledger/);
			expect(action).toThrow(/omo ulw-loop steer --kind annotate_ledger/);
		});
	});
});

describe("#given a steering command with an invalid --kind", () => {
	describe("#when parsing the steering kind", () => {
		it("#then reports the invalid value and lists valid kinds", () => {
			const action = (): void => {
				parseSteeringKind(["--kind", "bogus"]);
			};

			expect(action).toThrow(/Invalid --kind: bogus\./);
			expect(action).toThrow(/revise_criterion/);
			expect(action).toThrow(/mark_blocked_superseded/);
		});
	});
});
