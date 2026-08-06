import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { findProjectRoot } from "./project-root";

describe("engine findProjectRoot", () => {
	it("#given a directory without project markers #when finding project root #then root traversal terminates with null", () => {
		const root = mkdtempSync(join(tmpdir(), "rules-engine-project-root-"));
		const nested = join(root, "a", "b", "c");
		mkdirSync(nested, { recursive: true });

		try {
			expect(findProjectRoot(nested, ["definitely-not-a-project-marker"])).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
