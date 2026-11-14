// Security/architecture contract (omo#13440, design v7 section 7): the modules an `omo remote` local-only verb runs
// through - its entry (`remote-local.ts`: the account read, the session verbs, the thread adapter over the local API),
// the gateway store worker, and the runtime pruning run after the verb - reach the network only through the local API
// transport, and start processes only at the pinned sites. A new network import or call, a new spawn import, call site
// or argv literal, or a second worker anywhere in that graph fails here, so the engine-trust stage can be skipped for
// these verbs without a call slipping onto unfiltered trust. Each root's graph comes from Bun's own bundler metafile;
// a missing or empty graph, one that lacks its sentinels, or a detector that misses a known positive control fails
// rather than passes. The pinned sets below are the detector's own output; update them only with a security review.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSync } from "oxc-parser";
import { spawnCallSites } from "./spawn-call-sites";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const at = (path: string) => join(repoRoot, path);

const TRANSPORT = "packages/device-service-core/src/local-api/transport.ts";
const STORE = "packages/omo-senpi/src/components/thread/gateway/store.ts";
const STORE_WORKER = "packages/omo-senpi/src/components/thread/gateway/store-worker.ts";
const ROOTS: Record<string, readonly string[]> = {
  "packages/omo-native/remote-local.ts": [
    "packages/omo-native/remote-local.ts",
    TRANSPORT,
    "packages/omo-native/remote-session-verbs.ts",
  ],
  [STORE_WORKER]: [STORE_WORKER],
  "packages/omo-native/runtime-prune.ts": ["packages/omo-native/runtime-prune.ts"],
};
// Outside the roots, read as a fixture: the account service request module, whose fetch the matcher must see.
const FETCH_FIXTURE = "packages/omo-opencode/src/cli/service-auth/protocol-request.ts";
const NETWORK_MODULES = new Set(["tls", "https", "http", "http2", "dgram", "dns"]);
const SPAWN_SHIM = "packages/omo-opencode/src/shared/bun-spawn-shim.ts";
const RUNTIME_WRAPPERS = "packages/utils/src/runtime/";

// Rule 1: every reachable file importing node:child_process or a spawn wrapper (the utils runtime, the Bun spawn shim).
const SPAWN_IMPORTERS = [
  "packages/device-service-core/src/local-api/dacl.ts",
  "packages/memory-core/src/locks/process-identity.ts",
  "packages/omo-native/bin/lib/process-list.js",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/client.ts",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/creator-handoff.ts",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/owner-marker.ts",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/signature.ts",
  "packages/omo-opencode/src/cli/service-auth/secret-service-lock.ts",
  "packages/omo-opencode/src/shared/bun-file-shim.ts",
  "packages/omo-opencode/src/shared/bun-spawn-shim.ts",
  "packages/omo-senpi/src/components/thread/addressing.ts",
  "packages/omo-senpi/src/components/thread/gateway/process-identity.ts",
  "packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts",
  "packages/utils/src/runtime/spawn.ts",
];
// Rule 2: `Bun.spawn`, `Bun.spawnSync` and `Bun.$` need no import; no reachable source names them.
const BUN_PRIMITIVE_USES: Record<string, number> = {};
// Rule 3: every call that can start a process, with its command and argv as written (spawn-call-sites.ts).
const SPAWN_CALL_SITES = [
  "packages/device-service-core/src/local-api/dacl.ts: applyExactDacl(path; userSid)",
  "packages/device-service-core/src/local-api/dacl.ts: describeDacl(path; run)",
  "packages/device-service-core/src/local-api/dacl.ts: node:child_process#spawn(\"powershell.exe\"; [\"-NoProfile\", \"-NonInteractive\", \"-ExecutionPolicy\", \"Bypass\", \"-EncodedCommand\", encoded])",
  "packages/device-service-core/src/local-api/dacl.ts: run(APPLY; {LA_PATH,LA_SID,LA_KIND})",
  "packages/device-service-core/src/local-api/dacl.ts: run(CURRENT_USER_SID_SCRIPT; {})",
  "packages/device-service-core/src/local-api/dacl.ts: run(DESCRIBE_DACL_SCRIPT; {LA_PATH})",
  "packages/device-service-core/src/local-api/dacl.ts: run(SID_TOKEN_SCRIPT; {LA_SID})",
  "packages/device-service-core/src/local-api/dacl.ts: userSidToken(userSid; run)",
  "packages/device-service-core/src/local-api/dacl.ts: verifyExactDacl(path; userSid)",
  "packages/memory-core/src/locks/process-identity.ts: execFileText(\"/bin/ps\"; [\"-o\", \"lstart=\", \"-p\", String(pid)])",
  "packages/memory-core/src/locks/process-identity.ts: execFileText(\"powershell.exe\"; [ \"-NoProfile\", \"-Command\", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToString('o')`, ])",
  "packages/memory-core/src/locks/process-identity.ts: node:child_process#execFile(command; args)",
  "packages/memory-core/src/locks/process-identity.ts: readWin32StartIdentity(pid; -)",
  "packages/omo-native/account-show.ts: packages/omo-opencode/src/cli/service-auth/keystore.ts#createCredentialStore(api; {wait})",
  "packages/omo-native/bin/lib/process-list.js: node:child_process#spawnSync(\"ps\"; [\"-ww\", \"-axo\", \"pid=,ppid=,etime=,tty=,args=\"])",
  "packages/omo-native/remote-local.ts: packages/omo-native/remote-session-verbs.ts#runSession(service; parsed.session)",
  "packages/omo-native/remote-local.ts: runOn(service; parsed)",
  "packages/omo-native/remote-session-verbs.ts: packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts#resolveProvenance({cwd,env}; -)",
  "packages/omo-native/remote-session-verbs.ts: personSenderProvenance(remote; -)",
  "packages/omo-native/remote-session-verbs.ts: sendTo(remote; row)",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts: facts.run(\"/usr/bin/id\"; [\"-P\"])",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts: facts.run(reg; [\"query\", key, \"/v\", \"ProfileImagePath\"])",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts: facts.run(whoami; [\"/user\", \"/fo\", \"csv\", \"/nh\"])",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts: node:child_process#execFileSync(command; args)",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts: userRecordHome(systemPlatformFacts; -)",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts: windowsProfile(facts; -)",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/access.ts: packages/omo-opencode/src/cli/service-auth/keychain-helper/client.ts#callHelper(pinned; call)",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/client.ts: options.spawn(path; -)",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/client.ts: packages/omo-opencode/src/shared/bun-spawn-shim.ts#spawn([path]; {stdin,stdout,stderr,detached,env})",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/creator-handoff.ts: packages/omo-opencode/src/shared/bun-spawn-shim.ts#spawn([\"/usr/bin/codesign\", \"--verify\", \"--deep\", \"--strict\", `-R=${requirement}`, app]; {stdin,stdout,stderr})",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/creator-handoff.ts: packages/omo-opencode/src/shared/bun-spawn-shim.ts#spawn([path, ...args]; {cwd,stdin,stdout,stderr,env})",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/creator-handoff.ts: runBounded(runtime; [\"account\", \"token\"])",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/darwin-backend.ts: probe(service; account)",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/owner-marker.ts: packages/omo-opencode/src/shared/bun-spawn-shim.ts#spawn([\"/usr/bin/security\", ...args]; {stdout,stderr,env})",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/signature.ts: check(path; requirement)",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/signature.ts: createSignatureChecker(-; -)",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/signature.ts: packages/omo-opencode/src/shared/bun-spawn-shim.ts#spawn([\"/usr/bin/codesign\", \"--verify\", \"--strict\", `-R=${requirement}`, path]; {stdout,stderr,env})",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/signature.ts: verifyWithCodesign(path; requirement)",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/store-binding.ts: packages/omo-opencode/src/cli/service-auth/keychain-helper/darwin-backend.ts#guardHelperlessRead(key.service; key.name)",
  "packages/omo-opencode/src/cli/service-auth/keystore.ts: createSealedStore(api; \"omo-cli\")",
  "packages/omo-opencode/src/cli/service-auth/keystore.ts: packages/omo-opencode/src/cli/service-auth/keychain-helper/store-binding.ts#bindKeychainHelper({platform,namespace,secrets,key,background,origin,notice,pending,...}; -)",
  "packages/omo-opencode/src/cli/service-auth/secret-service-lock.ts: node:child_process#spawn(\"gdbus\"; [ \"call\", \"--session\", \"--dest\", \"org.freedesktop.secrets\", \"--object-path\", DEFAULT_COLLECTION, \"--method\", \"org.freedesktop.DBus.Properties.Get\", \"org.free...)",
  "packages/omo-senpi/src/components/thread/addressing.ts: gitWorktreeRoot(dir; -)",
  "packages/omo-senpi/src/components/thread/addressing.ts: gitWorktreeRoot(root; -)",
  "packages/omo-senpi/src/components/thread/addressing.ts: node:child_process#execFileSync(\"git\"; [\"-C\", dir, \"rev-parse\", \"--show-toplevel\"])",
  "packages/omo-senpi/src/components/thread/gateway/engine.ts: packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts#resolveProvenance({cwd}; -)",
  "packages/omo-senpi/src/components/thread/gateway/process-identity.ts: node:child_process#execFile(\"ps\"; [\"-o\", \"lstart=\", \"-p\", String(pid)])",
  "packages/omo-senpi/src/components/thread/gateway/process-identity.ts: processStartTime(identity.pid; -)",
  "packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts: execGitFile([\"remote\", \"get-url\", \"origin\"]; {cwd,env,timeoutMs})",
  "packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts: node:child_process#execFile(\"git\"; [...args])",
  "packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts: originRemote(cwd; env)",
  "packages/omo-senpi/src/components/thread/gateway/store-ops.ts: packages/omo-senpi/src/components/thread/gateway/process-identity.ts#isClaimantDead(row.admitted_by; -)",
  "packages/omo-senpi/src/components/thread/gateway/store-worker.ts: packages/omo-senpi/src/components/thread/gateway/process-identity.ts#processStartTime(process.pid; -)",
  "packages/omo-senpi/src/components/thread/gateway/store.ts: packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts#resolveProvenance({cwd}; -)",
  "packages/omo-senpi/src/components/thread/tools/internals.ts: packages/omo-senpi/src/components/thread/addressing.ts#workspaceDirectories(root; -)",
  "packages/omo-senpi/src/components/thread/tools/internals.ts: sendAddressBook(options; current)",
  "packages/utils/src/runtime/spawn.ts: bun.spawn(cmd; createBunSpawnOptions(options))",
  "packages/utils/src/runtime/spawn.ts: bun.spawnSync(cmd; createBunSpawnOptions(options))",
  "packages/utils/src/runtime/spawn.ts: node:child_process#spawn(bin; args)",
  "packages/utils/src/runtime/spawn.ts: node:child_process#spawnSync(bin; args)",
];
const CONNECT_CALLS = [
  "createConnection({ host: \"127.0.0.1\", port })",
  "createConnection({ path: join(stateDir, SOCKET_FILE) })",
];

const NETWORK_CALL =
  /(?<![.\w$])fetch\s*\(|\?\?\s*(?:globalThis\.)?fetch\b|globalThis\.fetch\b|\boptions\.fetch\b|\bnew\s+WebSocket\b|\bBun\.(?:connect|listen|fetch)\b/g;
const WORKER = /\bnew\s+Worker\b/g;
const BUN_PRIMITIVE = /\bBun\s*\.\s*(?:spawnSync|spawn|\$)/g;

type Input = {
  readonly imports: readonly { readonly path: string; readonly external?: boolean }[];
};

async function graph(root: string): Promise<Record<string, Input>> {
  const built = (await Bun.build({
    entrypoints: [at(root)],
    target: "bun",
    metafile: true,
    throw: false,
    root: repoRoot,
  } as Parameters<typeof Bun.build>[0])) as Awaited<ReturnType<typeof Bun.build>> & {
    readonly metafile?: { readonly inputs: Record<string, Input> };
  };
  expect(built.success).toBe(true);
  const inputs = built.metafile?.inputs;
  if (inputs === undefined || Object.keys(inputs).length === 0)
    throw new Error(`the bundler returned no module graph for ${root}`);
  return Object.fromEntries(
    Object.entries(inputs).map(([file, input]) => [relative(repoRoot, at(file)).replaceAll("\\", "/"), input]),
  );
}

const importersOf = (inputs: Record<string, Input>, matches: (path: string) => boolean): string[] =>
  Object.entries(inputs)
    .filter(([, input]) => input.imports.some((entry) => matches(entry.path.replaceAll("\\", "/"))))
    .map(([file]) => file)
    .sort();
const builtin = (name: string) => (path: string) => path.replace(/^node:/, "") === name;

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

function connectCalls(file: string): string[] {
  const source = readFileSync(at(file), "utf8");
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const callee: unknown = Reflect.get(node, "callee");
    if (
      Reflect.get(node, "type") === "CallExpression" &&
      typeof callee === "object" &&
      callee !== null &&
      Reflect.get(callee, "name") === "createConnection"
    )
      found.push(source.slice(Number(Reflect.get(node, "start")), Number(Reflect.get(node, "end"))));
    for (const value of Object.values(node)) visit(value);
  };
  visit(parseSync(file, source).program);
  return found.sort();
}

describe("remote local-path reachability", () => {
  test("#given the local-only roots' module graphs #when they are scanned #then the network is reached only through the local API transport and processes start only at the pinned sites", async () => {
    // given
    const inputs: Record<string, Input> = {};
    for (const [root, sentinels] of Object.entries(ROOTS)) {
      const own = await graph(root);
      for (const sentinel of sentinels) expect(Object.keys(own)).toContain(sentinel);
      Object.assign(inputs, own);
    }
    const sources = Object.keys(inputs).filter((file) => /\.(?:ts|js|mjs)$/.test(file) && !file.includes("node_modules/"));

    // when
    const calls: string[] = [];
    const workers: string[] = [];
    const bunPrimitives: Record<string, number> = {};
    for (const file of sources) {
      const source = withoutComments(readFileSync(at(file), "utf8"));
      for (const match of source.matchAll(NETWORK_CALL)) calls.push(`${file}: ${match[0]}`);
      if ((source.match(WORKER) ?? []).length > 0) workers.push(file);
      const primitives = (source.match(BUN_PRIMITIVE) ?? []).length;
      if (primitives > 0) bunPrimitives[file] = primitives;
    }
    const fixtureCalls = [...withoutComments(readFileSync(at(FETCH_FIXTURE), "utf8")).matchAll(NETWORK_CALL)];

    // then: the positive controls are seen, so an empty result below is not a blind detector
    expect(fixtureCalls.length).toBeGreaterThan(0);
    expect(importersOf(inputs, builtin("net"))).toEqual([TRANSPORT]);
    expect(workers).toEqual([STORE]);
    // then: the network rules
    expect(importersOf(inputs, (path) => NETWORK_MODULES.has(path.replace(/^node:/, "")))).toEqual([]);
    expect(calls).toEqual([]);
    expect(connectCalls(TRANSPORT)).toEqual(CONNECT_CALLS);
    // then: the spawn rules
    expect(
      importersOf(
        inputs,
        (path) => builtin("child_process")(path) || path.startsWith(RUNTIME_WRAPPERS) || path === SPAWN_SHIM,
      ),
    ).toEqual([...SPAWN_IMPORTERS].sort());
    expect(bunPrimitives).toEqual(BUN_PRIMITIVE_USES);
    expect(spawnCallSites(repoRoot, sources)).toEqual([...SPAWN_CALL_SITES].sort());
    // then: worker_threads only for the store pair and the team lock registry (BroadcastChannel, no Worker built)
    expect(importersOf(inputs, builtin("worker_threads"))).toEqual(
      [STORE, STORE_WORKER, "packages/team-core/src/team-state-store/lock-worker-lifetime.ts"].sort(),
    );
  });
});
