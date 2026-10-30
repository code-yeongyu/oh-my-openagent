import { basename, dirname } from "node:path"
import { describe, expect, test } from "bun:test"

import type { RpcSpawnSpec } from "../rpc/spawn"
import { buildChildContext } from "./session-context"
import {
  MAX_SHARD_BIND_PATH,
  NOTICE_TOKENS,
  SHARD_KEY_CONTEXT,
  SHARD_ROOT_ENV,
  TREE_KEY_CONTEXT,
  parseShardBasename,
  resolveShardSocket,
  shardKey,
  shardMetaPath,
  shardRoot,
  shardSocketPath,
  shardSocketPathForKey,
  validateBindPath,
} from "./shard-socket"
import { LEGACY_OVERRIDES, OWNER, OWNER_KEY, inheritedIdentity, nativePath, rootIdentity } from "./shard-socket.test-support"

// Shared naming vectors: senpi's `shardSocketPath` and the Desktop mirror pin the same literals.
const VECTORS = [
  { kind: "p", owner: OWNER, key: OWNER_KEY, socket: "/r/p-6d410ba846ba1550.sock" },
  { kind: "i", owner: "thread-0001", key: "da99f196e11b1cf9", socket: "/r/i-da99f196e11b1cf9.sock" },
  { kind: "p", owner: "", key: "3ba7290d74188485", socket: "/r/p-3ba7290d74188485.sock" },
] as const

describe("shard naming", () => {
  test("#given the shared vectors #when naming #then the key, socket and key-only socket equal the pinned literals", () => {
    for (const vector of VECTORS) {
      // when
      const key = shardKey(vector.kind, vector.owner)

      // then
      expect(key).toBe(vector.key)
      expect(key).toMatch(/^[0-9a-f]{16}$/)
      expect(shardSocketPath("/r", vector.kind, vector.owner)).toBe(nativePath(vector.socket))
      expect(shardSocketPathForKey("/r", vector.kind, key)).toBe(nativePath(vector.socket))
    }
  })

  test("#given one owner id #when naming under both kinds #then the sockets differ", () => {
    expect(shardSocketPath("/r", "p", OWNER)).not.toBe(shardSocketPath("/r", "i", OWNER))
  })

  test("#given a key #when naming by key #then it is used verbatim and never hashed again", () => {
    expect(shardSocketPathForKey("/r", "p", OWNER_KEY)).toBe(nativePath(`/r/p-${OWNER_KEY}.sock`))
    expect(shardMetaPath("/r", "p", OWNER_KEY)).toBe(nativePath(`/r/p-${OWNER_KEY}.meta.json`))
  })

  test("#given shard and foreign basenames #when parsing #then only kind-key sockets parse", () => {
    expect(parseShardBasename(`/r/p-${OWNER_KEY}.sock`)).toEqual({ kind: "p", key: OWNER_KEY })
    expect(parseShardBasename("i-da99f196e11b1cf9.sock")).toEqual({ kind: "i", key: "da99f196e11b1cf9" })
    for (const foreign of ["/r/rpc.sock", "/r/p-6d410ba8.sock", `/r/x-${OWNER_KEY}.sock`, `/r/p-${OWNER_KEY}.meta.json`, `/r/p-${OWNER_KEY.toUpperCase()}.sock`]) {
      expect(parseShardBasename(foreign)).toBeNull()
    }
  })

  test("#given the context key names and the notice token #when read #then they are the wire literals", () => {
    expect(SHARD_KEY_CONTEXT).toBe("shard_key")
    expect(TREE_KEY_CONTEXT).toBe("tree_key")
    expect(NOTICE_TOKENS.shard_alt_root).toBe("host_notice:shard_alt_root")
  })
})

describe("shardRoot", () => {
  test("#given no override #when resolving #then the root is <agentDir>/rpc/shards", () => {
    expect(shardRoot({}, "/h/.omo/agent")).toBe(nativePath("/h/.omo/agent/rpc/shards"))
    expect(shardRoot({ [SHARD_ROOT_ENV]: "   " }, "/h/.omo/agent")).toBe(nativePath("/h/.omo/agent/rpc/shards"))
  })

  test("#given OMO_RPC_SHARD_ROOT #when resolving the socket #then the override moves it", () => {
    // when
    const resolution = resolveShardSocket({ agentDir: "/h/.omo/agent", env: { [SHARD_ROOT_ENV]: " /tmp/x " }, identity: rootIdentity() })

    // then
    expect(resolution).toEqual({ socket: nativePath(`/tmp/x/p-${OWNER_KEY}.sock`), shard: rootIdentity(), root: "primary" })
  })
})

describe("validateBindPath", () => {
  test("#given a darwin os.tmpdir()-shaped root #when validating #then the handoff and shield siblings overflow and it is rejected", () => {
    // given
    const socket = `/var/folders/xx/${"a".repeat(30)}/T/omo-rpc-shards/abcdef01/p-${OWNER_KEY}.sock`

    // then
    expect(Buffer.byteLength(`${socket}.next-1`)).toBe(103)
    expect(Buffer.byteLength(`${socket}.next-99`)).toBe(104)
    expect(Buffer.byteLength(`${socket}.shield-9999999`)).toBe(111)
    expect(validateBindPath(socket)).toBe(false)
  })

  test("#given a socket whose longest sibling is exactly 103 bytes #when validating #then it holds, one byte more does not", () => {
    // given
    const fits = `/${"s".repeat(MAX_SHARD_BIND_PATH - "/.shield-9999999".length)}`
    const over = `${fits}s`

    // then
    expect(Buffer.byteLength(`${fits}.shield-9999999`)).toBe(MAX_SHARD_BIND_PATH)
    expect(validateBindPath(fits)).toBe(true)
    expect(validateBindPath(over)).toBe(false)
  })
})

describe("resolveShardSocket under the primary root", () => {
  test("#given a root and an inherited identity for one owner #when resolving #then socket, meta, parse and child context agree on one key", () => {
    // given
    const agentDir = "/h/.omo/agent"
    const baseSpec: RpcSpawnSpec = { task_id: "st_1a2b3c4d", cwd: "/tmp/project", state_dir: "/tmp/project/.omo/senpi-task", prompt: "go" }

    // when
    const root = resolveShardSocket({ agentDir, env: {}, identity: rootIdentity() })
    const inherited = resolveShardSocket({ agentDir, env: {}, identity: inheritedIdentity() })
    const context = buildChildContext({ ...baseSpec, treeKey: root.shard.key, shardKey: inherited.shard.key }).context

    // then
    expect(root.socket).toBe(nativePath(`/h/.omo/agent/rpc/shards/p-${OWNER_KEY}.sock`))
    expect(inherited.socket).toBe(root.socket)
    expect(root.root).toBe("primary")
    expect(root.notice).toBeUndefined()
    expect(parseShardBasename(root.socket)?.key).toBe(OWNER_KEY)
    expect(basename(shardMetaPath(dirname(root.socket), "p", root.shard.key))).toBe(`p-${OWNER_KEY}.meta.json`)
    expect(context[SHARD_KEY_CONTEXT]).toBe(OWNER_KEY)
    expect(context[TREE_KEY_CONTEXT]).toBe(OWNER_KEY)
  })

  test("#given the legacy socket overrides in env #when resolving under the primary root #then the result is unchanged", () => {
    // given
    const agentDir = "/h/.omo/agent"

    // when / then
    const primary = resolveShardSocket({ agentDir, env: {}, identity: rootIdentity() })
    expect(primary.root).toBe("primary")
    expect(resolveShardSocket({ agentDir, env: LEGACY_OVERRIDES, identity: rootIdentity() })).toEqual(primary)
  })
})
