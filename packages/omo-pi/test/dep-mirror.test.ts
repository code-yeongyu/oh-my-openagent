import { expect, test } from "bun:test"

type DependencyBlocks = {
  dependencies: Record<string, string>
  optionalDependencies: Record<string, string>
  devDependencies: Record<string, string>
}

async function readPackageJson(): Promise<DependencyBlocks> {
  const packageFile = Bun.file(new URL("../package.json", import.meta.url))
  const parsed = (await packageFile.json()) as Partial<DependencyBlocks>
  return {
    dependencies: parsed.dependencies ?? {},
    optionalDependencies: parsed.optionalDependencies ?? {},
    devDependencies: parsed.devDependencies ?? {},
  }
}

async function generateMirror(): Promise<DependencyBlocks> {
  const proc = Bun.spawnSync(["node", "scripts/mirror-deps.mjs", "--json"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (proc.exitCode !== 0) {
    throw new Error(`mirror-deps failed: ${proc.stderr.toString()}`)
  }
  return JSON.parse(proc.stdout.toString()) as DependencyBlocks
}

test("package dependency blocks mirror vendored senpi manifests", async () => {
  const [actual, expected] = await Promise.all([readPackageJson(), generateMirror()])

  expect(actual.dependencies).toEqual(expected.dependencies)
  expect(actual.optionalDependencies).toEqual(expected.optionalDependencies)
  expect(actual.devDependencies).toEqual(expected.devDependencies)
})
