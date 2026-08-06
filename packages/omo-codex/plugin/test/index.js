import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const entries = await readdir(testDirectory);
const testFiles = entries
	.filter((entry) => entry.endsWith(".test.mjs"))
	.sort((left, right) => left.localeCompare(right));

for (const testFile of testFiles) {
	await import(pathToFileURL(join(testDirectory, testFile)).href);
}
