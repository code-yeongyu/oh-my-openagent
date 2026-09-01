import { readFileSync } from "node:fs";

export const ULW_EXECUTE_CONTINUATION_DIRECTIVE: string = readFileSync(
	new URL("../directive.md", import.meta.url),
	"utf8",
);
