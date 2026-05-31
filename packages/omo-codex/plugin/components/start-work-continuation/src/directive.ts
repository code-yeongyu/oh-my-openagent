import { readFileSync } from "node:fs";

export const START_WORK_CONTINUATION_DIRECTIVE: string = readFileSync(
	new URL("../directive.md", import.meta.url),
	"utf8",
);
