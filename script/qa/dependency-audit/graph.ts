import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { senpiWorkerCompileArgs } from "../../senpi-worker-compile"
import { AuditError, graphArguments, parseModuleCount } from "./contracts"
import { execute, hashFile, normalized, REPO, requireSuccess, type Runtime } from "./runtime"

export async function captureGraph(runtime: Runtime) {
  const sourcePath = join(REPO, "script/build-omo-binary.ts")
  const source = await readFile(sourcePath, "utf8")
  const expression = /compileOutput\s*=\s*runCommandCaptured\(\s*"bun",\s*\[([\s\S]*?)\]/.exec(source)?.[1]
  if (!expression) throw new AuditError("graph", "release compile argument array was not found")
  const args: string[] = []
  for (const line of expression.split("\n")) {
    const value = line.trim().replace(/,$/, "")
    if (!value || value.startsWith("//")) continue
    if (/^"[^"]*"$/.test(value)) { args.push(value.slice(1, -1)); continue }
    switch (value) {
      case "`--target=${target.bunTarget}`": args.push(`--target=bun-${process.platform}-${process.arch}`); break
      case "`--asset=${stageDir}`": args.push("--asset=unused"); break
      case "compileEntry": args.push(join(REPO, "packages/omo-native/compile-entry.ts")); break
      case "...senpiWorkerCompileArgs(repoRoot)": args.push(...senpiWorkerCompileArgs(REPO)); break
      case "binaryPath": args.push("unused"); break
      default: throw new AuditError("graph", `unrecognized release argument expression: ${value}`)
    }
  }
  const out = join(runtime.out, "graph-artifacts")
  await mkdir(out, { recursive: true })
  const result = requireSuccess(await execute({ ...runtime, cwd: REPO }, ["bun", ...graphArguments(args, out)], 180000))
  const moduleCount = parseModuleCount(`${result.stdout}\n${result.stderr}`)
  const metafile = join(out, "meta.json")
  await Bun.write(metafile, JSON.stringify(normalized(runtime, await Bun.file(metafile).json()), null, 2))
  return { pass: true, moduleCount, metafile: "graph-artifacts/meta.json", metafileSha256: await hashFile(join(out, "meta.json")), releaseArgv: args }
}
