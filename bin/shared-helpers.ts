import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Detect libc family on Linux
 * @returns 'glibc', 'musl', null if detection fails, or undefined on non-Linux
 */
export function getLibcFamily(): string | null | undefined {
  if (process.platform !== "linux") {
    return undefined;
  }

  try {
    const require = createRequire(import.meta.url);
    const detectLibc = require("detect-libc");
    return detectLibc.familySync();
  } catch {
    return null;
  }
}

/**
 * Get the package base name from package.json
 * @param packageJsonUrl URL to package.json
 * @returns Package name or default "oh-my-opencode"
 */
export function getPackageBaseName(packageJsonUrl: URL): string {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as { name?: string };
    return packageJson.name ?? "oh-my-opencode";
  } catch {
    return "oh-my-opencode";
  }
}
