import { createHash } from "node:crypto";

import type { ParsedWorkspaceOperation } from "./workspace-edit-plan-types.js";

export function canonicalFingerprint(operations: readonly ParsedWorkspaceOperation[]): string {
	const canonical = operations.map((operation) => {
		switch (operation.kind) {
			case "text":
				return {
					kind: operation.kind,
					changeIndex: operation.changeIndex,
					path: operation.path,
					edits: operation.edits,
					version: operation.version,
				};
			case "rename":
				return {
					kind: operation.kind,
					changeIndex: operation.changeIndex,
					oldPath: operation.oldPath,
					newPath: operation.newPath,
					overwrite: operation.overwrite,
					ignoreIfExists: operation.ignoreIfExists,
				};
			case "create":
				return {
					kind: operation.kind,
					changeIndex: operation.changeIndex,
					path: operation.path,
					overwrite: operation.overwrite,
					ignoreIfExists: operation.ignoreIfExists,
				};
			case "delete":
				return {
					kind: operation.kind,
					changeIndex: operation.changeIndex,
					path: operation.path,
					recursive: operation.recursive,
					ignoreIfNotExists: operation.ignoreIfNotExists,
				};
		}
	});
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
