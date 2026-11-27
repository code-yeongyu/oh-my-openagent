import { randomBytes, randomUUID } from "node:crypto"
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { ContractHost, ContractHostOptions } from "./contract-host"

/**
 * A key-root scene every client of an rpc host must answer alike. `options` starts the contract host, `arrange` writes
 * the file the scene turns on and returns its path, `dialed` is the socket path the client is given (the host's own
 * unless set), and `refusal` is the whole refusal text, or "authenticated" when the dial must authenticate and go on.
 */
export type DialScene = {
  readonly options: ContractHostOptions
  readonly arrange: (host: ContractHost) => string
  readonly dialed?: (host: ContractHost) => string
  readonly refusal: "authenticated" | ((host: ContractHost, file: string, dialed: string) => string)
}

function write(host: ContractHost, body: (launch: string) => string): string {
  const launch = randomUUID()
  const path = join(host.root, "rpc", "keys", launch)
  writeFileSync(path, body(launch), { mode: 0o600 })
  return path
}

const recordNaming = (host: ContractHost, endpoint: string) =>
  write(host, (launch) =>
    JSON.stringify({
      version: 1,
      launch_id: launch,
      key: randomBytes(32).toString("hex"),
      pid: process.pid,
      process_start: null,
      endpoint,
    }),
  )
const alias = (host: ContractHost) => {
  const linked = join(host.root, "alias")
  symlinkSync(host.root, linked)
  return join(linked, "rpc.sock")
}
const doubled = (host: ContractHost) => `${dirname(host.socket)}//rpc.sock`
const unauthenticated = (_host: ContractHost, file: string, dialed: string) =>
  `host_identity_unproven:${dialed}: the host did not authenticate, and key record ${file} names this endpoint; if that launch has ended, the next senpi host start sweeps the record, or delete it`
const named = (endpoint: (host: ContractHost) => string): DialScene => ({
  options: {},
  arrange: (host) => recordNaming(host, endpoint(host)),
  refusal: unauthenticated,
})
const dialedAs = (dialed: (host: ContractHost) => string): DialScene => ({
  options: {},
  arrange: (host) => recordNaming(host, host.socket),
  dialed,
  refusal: unauthenticated,
})

export const DIAL_SCENES: Readonly<Record<string, DialScene>> = {
  "no challenge where a record names the endpoint": named((host) => host.socket),
  "no challenge where a record names the endpoint through a symlinked directory": named(alias),
  "no challenge where a record names the endpoint with doubled slashes": named(doubled),
  "no challenge, dialed through a symlinked directory": dialedAs(alias),
  "no challenge, dialed with doubled slashes": dialedAs(doubled),
  "no challenge, dialed by a relative path": dialedAs((host) => relative(process.cwd(), host.socket)),
  "no challenge beside an empty record": {
    options: {},
    arrange: (host) => write(host, () => ""),
    refusal: (_host, file) =>
      `unsafe_key_record:${file}: empty, a launch may still be writing it; retry, and delete this file if it stays empty`,
  },
  "a challenge under a launch with no record": {
    options: { auth: true, prepareRecord: (path) => rmSync(path) },
    arrange: (host) => host.recordPath,
    refusal: (_host, file) => `unsafe_key_record:${file}: missing; set SENPI_RPC_KEY_ROOT to the host's agent dir`,
  },
  "a challenge proven by a launch whose record names another endpoint, while a record names this one": {
    options: {
      auth: true,
      prepareRecord: (path) => {
        const row = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
        writeFileSync(path, JSON.stringify({ ...row, endpoint: `${String(row["endpoint"])}.elsewhere` }))
      },
    },
    arrange: (host) => recordNaming(host, host.socket),
    refusal: "authenticated",
  },
  "a challenge beside an empty record of another launch": {
    options: { auth: true },
    arrange: (host) => write(host, () => ""),
    refusal: "authenticated",
  },
}
