import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOmoConfig, OmoConfigWriteError, updateOmoConfig } from "./packages/omo-config-core/src/index.ts";

const evidenceRoot = ".omo/evidence/senpi-task/task-2-config-loader-writer";
const fixtureRoot = join(evidenceRoot, "manual-fixtures", `run-${Date.now()}`);
const report = { scenarios: [], cleanup: {} };
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function write(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
try {
  const userJsonRoot = join(fixtureRoot, "user-json");
  const userJsonPath = join(userJsonRoot, "xdg", "omo", "omo.json");
  const userCwd = join(userJsonRoot, "home", "project");
  mkdirSync(userCwd, { recursive: true });
  write(userJsonPath, `{"task":{"default_concurrency":11}}`);
  const userJson = loadOmoConfig({ cwd: userCwd, env: { HOME: join(userJsonRoot, "home"), XDG_CONFIG_HOME: join(userJsonRoot, "xdg") }, platform: "linux" });
  assert(userJson.config.task?.default_concurrency === 11, "user omo.json was not loaded");
  assert(userJson.sources[0]?.path === userJsonPath && userJson.sources[0]?.loaded === true, "user source did not point to omo.json");
  report.scenarios.push({ name: "user omo.json loads", loadedPath: userJson.sources[0]?.path, defaultConcurrency: userJson.config.task?.default_concurrency });

  const malformedRoot = join(fixtureRoot, "malformed-writer");
  const malformedProject = join(malformedRoot, "home", "project");
  const malformedPath = join(malformedProject, ".omo", "omo.jsonc");
  const original = `{"task":`;
  mkdirSync(malformedProject, { recursive: true });
  write(malformedPath, original);
  let caught = null;
  try {
    updateOmoConfig({ scope: "project", projectDir: malformedProject, edits: [{ path: ["task", "default_concurrency"], value: 4 }], env: { HOME: join(malformedRoot, "home"), XDG_CONFIG_HOME: join(malformedRoot, "xdg") }, platform: "linux" });
  } catch (error) {
    caught = error;
  }
  const malformedEntries = readdirSync(join(malformedPath, ".."));
  assert(caught instanceof OmoConfigWriteError, "malformed writer did not throw OmoConfigWriteError");
  assert(caught.operation === "parse", "malformed writer error operation was not parse");
  assert(readFileSync(malformedPath, "utf-8") === original, "malformed writer changed original bytes");
  assert(!existsSync(`${malformedPath}.tmp`), "malformed writer left tmp file");
  assert(!malformedEntries.some((entry) => entry.includes(".bak.")), "malformed writer created backup before parse failure");
  report.scenarios.push({ name: "malformed writer keeps bytes", errorName: caught.name, operation: caught.operation, unchanged: true, tmpExists: existsSync(`${malformedPath}.tmp`) });

  const unsafeRoot = join(fixtureRoot, "unsafe-merge");
  const unsafeProject = join(unsafeRoot, "home", "project");
  const unsafePath = join(unsafeProject, ".omo", "omo.jsonc");
  mkdirSync(unsafeProject, { recursive: true });
  write(unsafePath, `{"categories":{"quick":{"tools":{"bash":true,"__proto__":true,"constructor":true,"prototype":true}}}}`);
  const unsafe = loadOmoConfig({ cwd: unsafeProject, env: { HOME: join(unsafeRoot, "home"), XDG_CONFIG_HOME: join(unsafeRoot, "xdg") }, platform: "linux" });
  const tools = unsafe.config.categories?.quick?.tools ?? {};
  assert(tools.bash === true, "safe tool key was lost");
  assert(!Object.hasOwn(tools, "__proto__"), "own __proto__ survived");
  assert(!Object.hasOwn(tools, "constructor"), "own constructor survived");
  assert(!Object.hasOwn(tools, "prototype"), "own prototype survived");
  assert(Object.prototype.polluted === undefined, "Object.prototype was polluted");
  report.scenarios.push({ name: "nested unsafe keys stripped", bash: tools.bash, ownUnsafeKeys: ["__proto__", "constructor", "prototype"].filter((key) => Object.hasOwn(tools, key)), objectPrototypePolluted: Object.prototype.polluted !== undefined });
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  report.cleanup = { fixtureRoot, fixtureRootExistsAfterCleanup: existsSync(fixtureRoot) };
}
console.log(JSON.stringify(report, null, 2));
