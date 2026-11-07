import { describe, expect, test } from "bun:test"
import { claimsMemorySyncAtBoot } from "../bin/lib/memory-sync-boot.js"

// The boot claim captures the private-descriptor table. Only the engine may do that: `host ensure` and its supervisor
// must forward the descriptor to the next hop untouched, so a wrong yes here would strand the desktop's channel.
const RPC_HOST = ["--extension", "/plugin", "--mode", "rpc", "--multi-session", "--listen", "unix:///tmp/h.sock"]
const DECLARED = { SENPI_PRIVATE_FDS: '{"memory-sync":5}' }

describe("claimsMemorySyncAtBoot", () => {
  test.each([
    ["an rpc engine whose table names memory-sync", RPC_HOST, DECLARED, true],
    ["an rpc engine whose table names memory-sync without a usable descriptor", RPC_HOST, { SENPI_PRIVATE_FDS: '{"memory-sync":null}' }, true],
    ["a launch without a table", RPC_HOST, {}, false],
    ["a table without a memory-sync entry", RPC_HOST, { SENPI_PRIVATE_FDS: '{"other":5}' }, false],
    ["a table that does not parse", RPC_HOST, { SENPI_PRIVATE_FDS: '{"memory-sync":5' }, false],
    ["a table that is not an object", RPC_HOST, { SENPI_PRIVATE_FDS: '["memory-sync"]' }, false],
    ["`host ensure`, which hands the descriptor to its supervisor", ["host", "ensure", "--socket", "/tmp/s", "--mode", "rpc"], DECLARED, false],
    ["the lifecycle supervisor, which hands it to the engine", ["--internal-rpc-host-supervisor", "--socket", "/tmp/s", "--mode", "rpc"], DECLARED, false],
    ["an interactive launch", ["--extension", "/plugin"], DECLARED, false],
    ["a json-mode launch", ["--mode", "json", "-p", "hi"], DECLARED, false],
    ["`--mode rpc` only as message text after --", ["--extension", "/plugin", "--", "--mode", "rpc"], DECLARED, false],
  ] as const)("%s", (_name, args, env, expected) => {
    expect(claimsMemorySyncAtBoot([...args], env)).toBe(expected)
  })
})
