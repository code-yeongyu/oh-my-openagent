#!/usr/bin/env bun
// Spike SP-R probe: relay and same-network pipe limits. Writes or re-verifies relay-limits.tsv.
//
//   bun probe-sp-r.ts --write  <ledger.tsv> [--only id,id]   measure and write the ledger
//   bun probe-sp-r.ts --verify <ledger.tsv> [--only id,id]   measure again; exit 0 only when every verdict matches
//
// Relay rows run against a LOCAL relay this probe starts itself from a relay checkout (SP_R_RELAY_CHECKOUT): the
// checkout's own local test harness serves it (workerd through wrangler dev --local) and every credential is minted
// here, signed by a key generated for the run and served by a loopback key server. No account, no hosted relay.
// The relay's wire details stay in that private checkout: this file uses only its harness API, and reads the socket
// route and the token claim shape from the checkout at run time.
// Same-network (lan) rows stay UNMEASURED until a same-network pair of machines is measured.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const HEADER = ["id", "pipe", "question", "measured", "verdict", "rerun", "host_build", "note"]
const LAN_REASON =
  "the same-network direct path is off in shipped builds by the relay daemon owner ruling of 2026-11-11 (see L-STATE-A/B): every envelope rides the relay; measuring it would mean switching on a dormant path on the pair, outside a read-only run"
type Verdict = "CONFIRMS" | "CONTRADICTS" | "NEW-EDGE" | "UNMEASURED"
type Row = Readonly<{
  id: string
  pipe: string
  question: string
  measured: string
  verdict: Verdict
  note: string
}>

function die(line: string, code = 2): never {
  console.error(`probe-sp-r: ${line}`)
  process.exit(code)
}

const args = process.argv.slice(2)
const mode = args[0]
const ledger = args[1]
if ((mode !== "--write" && mode !== "--verify") || ledger === undefined)
  die("usage: probe-sp-r.ts --write|--verify <ledger.tsv> [--only id,id]")
const onlyAt = args.indexOf("--only")
const only = onlyAt === -1 ? null : new Set((args[onlyAt + 1] ?? "").split(","))
const ledgerPath = resolve(ledger)

// Preconditions, checked before anything is measured or written.
const checkout = process.env["SP_R_RELAY_CHECKOUT"]
if (checkout === undefined || checkout === "")
  die(
    "precondition missing: no relay endpoint configured (SP_R_RELAY_CHECKOUT must name a relay checkout whose local relay this probe starts)",
  )
const harnessDir = join(checkout, "packages/adapter-a/test")
const fixturePath = join(checkout, "vendor/omo-service-relay-fixture/fixture.json")
for (const f of ["flow-server.ts", "relay-peer.ts", "hello.ts", "qa-reprove-hibernation.ts"])
  if (!existsSync(join(harnessDir, f))) die(`precondition missing: ${checkout} has no local relay harness (${f})`)
if (!existsSync(fixturePath)) die(`precondition missing: ${checkout} has no service token fixture`)
if (process.platform !== "linux")
  die(`precondition missing: the local relay runs on Linux only (this is ${process.platform})`)
if (process.env["CI"] !== "true" && !existsSync("/.dockerenv") && !existsSync("/run/.containerenv"))
  die("precondition missing: the relay harness needs CI=true or a container on a Linux host")

// ---- the relay harness, loaded from the checkout -------------------------------------------------------------------
type DevServer = Readonly<{ base: string; stop: () => Promise<void> }>
type Reply = Readonly<{ kind: string }> | undefined
type Envelope = Readonly<{ envelope_id: string; sealed: Uint8Array }>
type PeerT = {
  ws: WebSocket | undefined
  received: Map<string, unknown>
  onDeliver: (e: Envelope) => void
  connect(): Promise<void>
  envelope(to: string, cls: "stream" | "data", body: string): Envelope
  send(e: Envelope): Promise<Reply>
  sync(): Promise<void>
}
type Harness = Readonly<{
  flowServer: (deadAfterMs?: number, hooks?: boolean, access?: Record<string, string>) => Promise<DevServer>
  Peer: new (base: string, account: string, device: string) => PeerT
  rewakeDoor: (base: string, account: string) => Promise<void>
  openSocket: (url: string) => WebSocket
  admit: (ws: WebSocket, token?: string) => Promise<void>
  deviceJkt: (device: string) => Promise<string>
  ping: string
}>
// The relay protocol module, named the way the harness imports it (its name is the relay checkout's business).
const protoSpecifier = /from "([^"]+\/proto)"/.exec(readFileSync(join(harnessDir, "hello.ts"), "utf8"))?.[1]
if (protoSpecifier === undefined) die(`precondition missing: ${checkout} harness has no protocol import`)
const h = {
  ...((await import(join(harnessDir, "flow-server.ts"))) as Pick<Harness, "flowServer">),
  ...((await import(join(harnessDir, "relay-peer.ts"))) as Pick<Harness, "Peer" | "rewakeDoor">),
  ...((await import(join(harnessDir, "hello.ts"))) as Pick<Harness, "openSocket" | "admit" | "deviceJkt">),
  ping: ((await import(Bun.resolveSync(protoSpecifier, harnessDir))) as { RELAY_PING: string }).RELAY_PING,
} satisfies Harness

// The device socket route and the per-account hook prefix, as the harness itself builds them.
const peerSrc = readFileSync(join(harnessDir, "relay-peer.ts"), "utf8")
const socketTpl = /`ws:\/\/\$\{this\.base\}(\/[^`]*\/socket)`/.exec(peerSrc)?.[1]
const hookTpl = /`http:\/\/\$\{base\}(\/[^`]*)\$\{path\}`/.exec(peerSrc)?.[1]
if (socketTpl === undefined || hookTpl === undefined)
  die(`precondition missing: ${checkout} harness no longer exposes its socket route`)
const socketUrl = (base: string, account: string, device: string): string =>
  `ws://${base}${socketTpl.replace("${this.account}", account).replace("${this.device}", device)}`
const hookUrl = (base: string, account: string, path: string): string =>
  `http://${base}${hookTpl.replace("${account}", account)}${path}`
const instanceOf = async (base: string, account: string): Promise<string> =>
  ((await (await fetch(hookUrl(base, account, "__stats"))).json()) as { instance: string }).instance

// ---- test credentials: the service fixture's claim shape, re-signed by a key minted for this run ---------------------
type Claims = Record<string, unknown>
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  issuer: string
  account: string
  relay: Record<string, string>
}
const payloadOf = (jwt: string): Claims =>
  JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as Claims
const [tplA, tplB] = Object.values(fixture.relay).map(payloadOf)
if (tplA === undefined || tplB === undefined) die(`precondition missing: ${fixturePath} has no relay tokens`)
// The device claim is the one whose value differs between the fixture's two device tokens.
const deviceClaim = Object.keys(tplA).find((k) => typeof tplA[k] === "string" && tplA[k] !== tplB[k])
const accountClaim = Object.keys(tplA).find((k) => tplA[k] === fixture.account)
if (deviceClaim === undefined || accountClaim === undefined)
  die(`precondition missing: ${fixturePath} token shape not recognised`)
const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair
const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
const KID = "sp-r-probe"
const b64 = (x: unknown): string => Buffer.from(JSON.stringify(x)).toString("base64url")
const mint = async (account: string, device: string, lifeS: number): Promise<string> => {
  const now = Math.floor(Date.now() / 1000)
  const body: Claims = {
    ...tplA,
    [accountClaim]: account,
    [deviceClaim]: device,
    iat: now,
    exp: now + lifeS,
    jti: crypto.randomUUID(),
    cnf: { jkt: await h.deviceJkt(device) },
  }
  const signing = `${b64({ alg: "ES256", typ: "JWT", kid: KID })}.${b64(body)}`
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signing),
  )
  return `${signing}.${Buffer.from(sig).toString("base64url")}`
}

// ---- small timing helpers ------------------------------------------------------------------------------------------
const sleep = (ms: number): Promise<void> => Bun.sleep(ms)
const uid = (p: string): string => `${p}-${crypto.randomUUID().slice(0, 8)}`
const keepalive = (sockets: readonly (WebSocket | undefined)[]): (() => void) => {
  const t = setInterval(() => {
    for (const ws of sockets) if (ws?.readyState === WebSocket.OPEN) ws.send(h.ping)
  }, 5_000)
  return () => clearInterval(t)
}
const closedAt = (ws: WebSocket): Promise<{ at: number; code: number }> =>
  new Promise((done) => ws.addEventListener("close", (e) => done({ at: Date.now(), code: e.code }), { once: true }))
const within = <T>(ms: number, p: Promise<T>): Promise<T | "timeout"> =>
  Promise.race([p, sleep(ms).then(() => "timeout" as const)])
const pairOn = async (base: string): Promise<{ account: string; brain: PeerT; hand: PeerT }> => {
  const account = uid("sp-r")
  const brain = new h.Peer(base, account, "brain")
  const hand = new h.Peer(base, account, "hand")
  await brain.connect()
  await hand.connect()
  // The hand answers every brain ping with its own stream envelope, as a hand link's heartbeat reply would.
  hand.onDeliver = (e) => {
    const body = new TextDecoder().decode(e.sealed)
    if (body.startsWith("ping-")) void hand.send(hand.envelope("brain", "stream", `pong-${body.slice(5)}`))
  }
  return { account, brain, hand }
}
const roundTrip = (p: { brain: PeerT }, n: number, timeoutMs = 15_000): Promise<number | "timeout"> => {
  const sent = performance.now()
  const back = new Promise<number>((done) => {
    const prev = p.brain.onDeliver
    p.brain.onDeliver = (e) => {
      if (new TextDecoder().decode(e.sealed) === `pong-${n}`) {
        p.brain.onDeliver = prev
        done(performance.now() - sent)
      }
    }
  })
  void p.brain.send(p.brain.envelope("hand", "stream", `ping-${n}`))
  return within(timeoutMs, back)
}
const closeAll = (...peers: PeerT[]): void => {
  for (const p of peers) p.ws?.close()
}

// ---- measurements (memoised: a row that shares a measurement with another runs it once) -----------------------------
let privateRelay: Promise<DevServer> | undefined
let hostedRelay: Promise<DevServer> | undefined
let keyServer: ReturnType<typeof Bun.serve> | undefined
// DEAD_AFTER_MS left at the relay's shipped 60,000 ms so the silent-link numbers are the relay's own.
const relayPrivate = (): Promise<DevServer> => (privateRelay ??= h.flowServer(60_000, true))
const relayHosted = (): Promise<DevServer> => {
  keyServer ??= Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }] }),
  })
  return (hostedRelay ??= h.flowServer(60_000, true, {
    RELAY_MODE: "production",
    ENTITLEMENT_ISSUER: fixture.issuer,
    ENTITLEMENT_JWKS_URL: `http://127.0.0.1:${keyServer.port}/jwks.json`,
  }))
}
const memo = new Map<string, Promise<unknown>>()
const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  if (!memo.has(key)) memo.set(key, run())
  return memo.get(key) as Promise<T>
}

/** Smallest idle time (from a 5 s transport keepalive sweep) after which the account object was evicted. */
const mEvict = () =>
  once("evict", async () => {
    const base = (await relayPrivate()).base
    const idle = [5, 10, 15, 20, 30]
    const res = await Promise.all(
      idle.map(async (s) => {
        const p = await pairOn(base)
        await roundTrip(p, 0)
        const before = await instanceOf(base, p.account)
        const stop = keepalive([p.brain.ws, p.hand.ws])
        await sleep(s * 1000)
        stop()
        const open = p.brain.ws?.readyState === WebSocket.OPEN && p.hand.ws?.readyState === WebSocket.OPEN
        const evicted = (await instanceOf(base, p.account)) !== before
        closeAll(p.brain, p.hand)
        return { s, evicted, open }
      }),
    )
    const firstEvicted = res.find((r) => r.evicted)?.s ?? null
    const lastKept =
      [...res].reverse().find((r) => !r.evicted && (firstEvicted === null || r.s < firstEvicted))?.s ?? null
    return { res, firstEvicted, lastKept, allOpen: res.every((r) => r.open) }
  })

/** One hibernation between two heartbeat round trips: idle 20 s on the transport keepalive only. */
const mWake = () =>
  once("wake", async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    const warm = await roundTrip(p, 1)
    const before = await instanceOf(base, p.account)
    const stop = keepalive([p.brain.ws, p.hand.ws])
    await sleep(20_000)
    stop()
    const open = p.brain.ws?.readyState === WebSocket.OPEN && p.hand.ws?.readyState === WebSocket.OPEN
    const wake = await roundTrip(p, 2)
    const cmd = p.brain.envelope("hand", "data", "command-after-wake")
    await p.brain.send(cmd)
    await p.hand.sync()
    const dataDelivered = p.hand.received.has(cmd.envelope_id)
    const evicted = (await instanceOf(base, p.account)) !== before
    closeAll(p.brain, p.hand)
    return { warm, wake, open, dataDelivered, evicted }
  })

/** A 5 s heartbeat for 60 s; with rewake, the account object is given a hibernation wake's memory at +30 s. */
const mCadence = (rewake: boolean) =>
  once(`cadence-${rewake}`, async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    const before = await instanceOf(base, p.account)
    const rtts: number[] = []
    const arrivals: number[] = [Date.now()]
    let lost = 0
    for (let i = 0; i < 12; i++) {
      const tick = sleep(5_000)
      if (rewake && i === 6) await h.rewakeDoor(base, p.account)
      const r = await roundTrip(p, 100 + i)
      if (r === "timeout") lost += 1
      else {
        rtts.push(r)
        arrivals.push(Date.now())
      }
      await tick
    }
    const gaps = arrivals.slice(1).map((t, i) => t - (arrivals[i] ?? t))
    const evicted = (await instanceOf(base, p.account)) !== before
    closeAll(p.brain, p.hand)
    const sorted = [...rtts].sort((a, b) => a - b)
    return {
      lost,
      p95: sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? Number.NaN,
      maxGap: Math.max(...gaps),
      evicted,
    }
  })

/** How long an idle channel lives across hibernation: with the 5 s transport keepalive (150 s) or silent. */
const mSurvive = (silent: boolean) =>
  once(`survive-${silent}`, async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    await roundTrip(p, 1)
    const before = await instanceOf(base, p.account)
    const start = Date.now()
    if (p.hand.ws === undefined) throw new Error("hand socket missing")
    const closed = closedAt(p.hand.ws)
    const stop = silent ? () => undefined : keepalive([p.brain.ws, p.hand.ws])
    const end = await within(150_000, closed)
    stop()
    const delivered = end === "timeout" ? (await roundTrip(p, 2)) !== "timeout" : false
    const evicted = (await instanceOf(base, p.account)) !== before
    closeAll(p.brain, p.hand)
    return {
      openAt150: end === "timeout",
      closedAfterS: end === "timeout" ? null : Math.round((end.at - start) / 1000),
      closeCode: end === "timeout" ? null : end.code,
      delivered,
      evicted,
    }
  })

/** Largest sealed payload the relay admits for a class, and how it refuses one byte more. */
const mSize = (cls: "stream" | "data") =>
  once(`size-${cls}`, async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    // Paced under the relay's per-pair rate so a refusal can only be the size.
    // "codec": the relay's shared codec (used by both ends) refused to encode the frame, so it never left the hand.
    const tryN = async (n: number): Promise<"ok" | "refused" | "closed" | "codec"> => {
      await sleep(cls === "data" ? 250 : 150)
      if (p.brain.ws?.readyState !== WebSocket.OPEN) await p.brain.connect()
      let r: Reply
      try {
        r = await p.brain.send(p.brain.envelope("hand", cls, "x".repeat(n)))
      } catch {
        return "codec"
      }
      return r === undefined ? "closed" : r.kind === "ack" ? "ok" : "refused"
    }
    let lo = 1
    let hi = 1 << 20
    if ((await tryN(lo)) !== "ok") return { max: 0, over: "refused", stable: false }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if ((await tryN(mid)) === "ok") lo = mid
      else hi = mid
    }
    const over = await tryN(lo + 1)
    const stable = (await tryN(lo)) === "ok"
    closeAll(p.brain, p.hand)
    return { max: lo, over, stable }
  })

/** Largest single WebSocket message the relay's runtime takes before the relay parses it (close 1009 = too big). */
const mTransport = () =>
  once("transport", async () => {
    const base = (await relayPrivate()).base
    const closeFor = async (n: number): Promise<number | "open"> => {
      const ws = h.openSocket(socketUrl(base, uid("sp-r-raw"), "hand"))
      await new Promise<void>((ok) => {
        ws.onopen = () => ok()
      })
      const closed = new Promise<{ at: number; code: number }>((done) => {
        ws.addEventListener("close", (e) => done({ at: Date.now(), code: e.code }), { once: true })
      })
      ws.send(new Uint8Array(n))
      const end = await within(20_000, closed)
      if (end === "timeout") ws.close()
      return end === "timeout" ? "open" : end.code
    }
    let lo = 64 * 1024
    let hi = 64 * 1024 * 1024
    // Only 1009 (message too big) is a size refusal; the relay closes an unadmitted socket for a bad frame or a
    // missed hello deadline with codes of its own, and those mean the runtime took the message.
    const atHi = await closeFor(hi)
    if (atHi !== 1009) return { cap: null, overCode: atHi }
    if ((await closeFor(lo)) === 1009) return { cap: 0, overCode: atHi }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if ((await closeFor(mid)) === 1009) hi = mid
      else lo = mid
    }
    return { cap: lo, overCode: await closeFor(lo + 1) }
  })

/** An admitted device socket whose token expires in 25 s and is never refreshed. */
const mExpiry = (hibernate: boolean) =>
  once(`expiry-${hibernate}`, async () => {
    const base = (await relayHosted()).base
    const account = uid("sp-r-auth")
    const device = "hand"
    const ws = h.openSocket(socketUrl(base, account, device))
    await new Promise<void>((ok, no) => {
      ws.onopen = () => ok()
      ws.onerror = () => no(new Error("socket failed"))
    })
    const expS = Math.floor(Date.now() / 1000) + 25
    await h.admit(ws, await mint(account, device, expS - Math.floor(Date.now() / 1000)))
    const before = await instanceOf(base, account)
    const closed = closedAt(ws)
    const stop = keepalive([ws])
    // Awake: an HTTP request every 3 s keeps the account object resident; hibernate: nothing but the keepalive.
    const poke = hibernate ? undefined : setInterval(() => void instanceOf(base, account), 3_000)
    const end = await within(60_000, closed)
    stop()
    clearInterval(poke)
    const evicted = (await instanceOf(base, account)) !== before
    if (end === "timeout") ws.close()
    return {
      afterExpS: end === "timeout" ? null : Math.round((end.at - expS * 1000) / 100) / 10,
      code: end === "timeout" ? null : end.code,
      evicted,
    }
  })

/** A hello whose token expired 10 s ago. */
const mExpiredHello = () =>
  once("expired-hello", async () => {
    const base = (await relayHosted()).base
    const account = uid("sp-r-auth")
    const ws = h.openSocket(socketUrl(base, account, "hand"))
    await new Promise<void>((ok) => {
      ws.onopen = () => ok()
    })
    const outcome = await h
      .admit(ws, await mint(account, "hand", -10))
      .then(() => "admitted")
      .catch((e: Error) => e.message)
    ws.close()
    return { admitted: outcome === "admitted", outcome }
  })

/** The relay's own hibernation re-proof QA (one run): a token refresh after a real hibernation, both client kinds. */
const mRefresh = () =>
  once("refresh", async () => {
    const proc = Bun.spawn(["bun", "test/qa-reprove-hibernation.ts", "1"], {
      cwd: join(checkout, "packages/adapter-a"),
      stdout: "pipe",
      stderr: "ignore",
      env: process.env,
    })
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    const line = out
      .trim()
      .split("\n")
      .reverse()
      .find((l) => l.startsWith("{"))
    if (code !== 0 || line === undefined) return null
    return JSON.parse(line) as {
      before: { hibernated: number; reconnectsPerRefresh: number }
      after: { hibernated: number; reconnectsPerRefresh: number; reproveMs: number[] }
    }
  })

// ---- a same-network pair (two hosts on one network), reached through SP_R_PAIR_A / SP_R_PAIR_B ----------------------
// Each is a command prefix that runs one shell command string on that host. probe-sp-r-pair.sh is sent along with it.
const pairExec = (side: "A" | "B"): string => process.env[`SP_R_PAIR_${side}`] ?? ""
const pairHelper = Buffer.from(readFileSync(join(import.meta.dir, "probe-sp-r-pair.sh"))).toString("base64")
type PairOut = Readonly<{ ok: true; fields: Record<string, string> }> | Readonly<{ ok: false; why: string }>
const onPair = async (side: "A" | "B", args: string, timeoutS: number): Promise<PairOut> => {
  const proc = Bun.spawn(["sh", "-c", `${pairExec(side)} sh -c "echo ${pairHelper} | base64 -d | sh -s -- ${args}"`], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const timer = setTimeout(() => proc.kill(), timeoutS * 1000)
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  clearTimeout(timer)
  if (code === 75 || out.startsWith("busy"))
    return { ok: false, why: `host ${side} load at or above its core count, stopped` }
  if (code === 2)
    return { ok: false, why: `precondition missing on host ${side}: ${out.trim().split("\n").pop() ?? ""}` }
  if (code !== 0) return { ok: false, why: `host ${side} unreachable or dropped mid-run (exit ${code})` }
  const fields: Record<string, string> = {}
  for (const m of out.matchAll(/([a-z_]+)=([^\s]*)/g)) if (m[1] !== undefined) fields[m[1]] = m[2] ?? ""
  return { ok: true, fields }
}
const hostedSocket = (): string => {
  const base = process.env["SP_R_HOSTED_RELAY"] ?? ""
  return `${base}${socketTpl.replace("${this.account}", "sp-r-probe").replace("${this.device}", "silent")}`
}
const mPairState = (side: "A" | "B") => once(`state-${side}`, () => onPair(side, "state", 60))
const mPairSilent = (side: "A" | "B") => once(`silent-${side}`, () => onPair(side, `silent ${hostedSocket()}`, 120))
/** The same silent unadmitted socket against the local relay, for the hosted comparison. */
const mLocalSilent = () =>
  once("silent-local", async () => {
    const base = (await relayPrivate()).base
    const t0 = Date.now()
    const ws = new WebSocket(socketUrl(base, uid("sp-r-silent"), "silent"))
    const opened = await new Promise<number>((ok) => {
      ws.onopen = () => ok(Date.now() - t0)
    })
    const end = await within(90_000, closedAt(ws))
    if (end === "timeout") ws.close()
    return end === "timeout"
      ? { afterOpenMs: -1, code: "open_at_90s" }
      : { afterOpenMs: end.at - t0 - opened, code: String(end.code) }
  })
// The relay's own hello deadline, read from the checkout (the silent unadmitted socket is closed by it).
const helloDeadlineMs = Number(
  (
    /HELLO_DEADLINE_MS = ([\d_]+)/.exec(readFileSync(join(checkout, "packages/core/src/hello.ts"), "utf8"))?.[1] ??
    "NaN"
  ).replaceAll("_", ""),
)
const silentOk = (ms: number, code: string, ref: { code: string }): boolean =>
  ms >= helloDeadlineMs - 500 && ms <= helloDeadlineMs + 2_000 && code === ref.code

// ---- the rows ------------------------------------------------------------------------------------------------------
type Spec = Readonly<{
  id: string
  pipe: string
  question: string
  run: () => Promise<Omit<Row, "id" | "pipe" | "question">>
}>
const ms = (x: number | "timeout"): string => (x === "timeout" ? "timeout" : `${Math.round(x)} ms`)
const overText = (o: string): string =>
  o === "codec"
    ? "refused by the shared relay codec before send"
    : o === "refused"
      ? "refused by the relay, channel stays open"
      : o
const relayNote = "local relay (workerd via wrangler dev --local), test credentials minted by the probe"

const relay: Spec[] = [
  {
    id: "R-AUTH-1",
    pipe: "relay",
    question:
      "auth lifetime, awake hub: an admitted channel whose token is never refreshed closes at token expiry (no channel outlives its auth)",
    run: async () => {
      const m = await mExpiry(false)
      const ok = m.afterExpS !== null && m.afterExpS >= 0 && m.afterExpS <= 5 && !m.evicted
      return {
        measured: `closed ${m.afterExpS ?? "never (60 s)"} s after exp, code ${m.code ?? "-"}, hub evicted ${m.evicted}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-AUTH-2",
    pipe: "relay",
    question:
      "auth lifetime across one hub hibernation: the expiry still closes the channel when the hub was evicted before it",
    run: async () => {
      const m = await mExpiry(true)
      const ok = m.afterExpS !== null && m.afterExpS >= 0 && m.afterExpS <= 5
      return {
        measured: `closed ${m.afterExpS ?? "never (60 s)"} s after exp, code ${m.code ?? "-"}, hub evicted ${m.evicted}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; condition holds only when hub evicted is true`,
      }
    },
  },
  {
    id: "R-AUTH-3",
    pipe: "relay",
    question: "auth lifetime at dial: a token already expired is refused before the channel is admitted",
    run: async () => {
      const m = await mExpiredHello()
      return {
        measured: m.admitted ? "admitted" : `refused before admission (${m.outcome.replace(/\s+/g, " ")})`,
        verdict: m.admitted ? "CONTRADICTS" : "CONFIRMS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-AUTH-4",
    pipe: "relay",
    question:
      "unattended refresh after one hub hibernation, client advertising in-band re-proof: the channel stays up (0 reconnects)",
    run: async () => {
      const m = await mRefresh()
      if (m === null) return { measured: "relay re-proof QA did not report", verdict: "CONTRADICTS", note: relayNote }
      const ok = m.after.hibernated === 1 && m.after.reconnectsPerRefresh === 0
      return {
        measured: `hub evicted ${m.after.hibernated}/1, reconnects per refresh ${m.after.reconnectsPerRefresh}, re-proof ${m.after.reproveMs.join("/")} ms`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; measured by the relay checkout's own hibernation re-proof QA, 1 run`,
      }
    },
  },
  {
    id: "R-AUTH-5",
    pipe: "relay",
    question: "refresh after one hub hibernation, client without in-band re-proof: what the relay does",
    run: async () => {
      const m = await mRefresh()
      if (m === null) return { measured: "relay re-proof QA did not report", verdict: "CONTRADICTS", note: relayNote }
      return {
        measured: `hub evicted ${m.before.hibernated}/1, reconnects per refresh ${m.before.reconnectsPerRefresh} (drained)`,
        verdict: m.before.hibernated === 1 && m.before.reconnectsPerRefresh === 1 ? "NEW-EDGE" : "CONTRADICTS",
        note: `${relayNote}; the hand's relay client must advertise re-proof or reconnect once per refresh after a hibernation`,
      }
    },
  },
  {
    id: "R-AUTH-6",
    pipe: "relay",
    question: "token lifetime the account service issues, and the relay's cap on one token's window",
    run: () =>
      Promise.resolve({
        measured: "-",
        verdict: "UNMEASURED",
        note: "needs a test account on the account service",
      }),
  },
  {
    id: "R-HIB-1",
    pipe: "relay",
    question:
      "hub hibernation onset: idle time after which the hub is evicted while both channels stay open (5 s transport keepalive)",
    run: async () => {
      const m = await mEvict()
      const list = m.res.map((r) => `${r.s}s:${r.evicted ? "evicted" : "resident"}`).join(" ")
      return {
        measured: `${list}; channels open ${m.allOpen}`,
        verdict: m.firstEvicted !== null && m.allOpen ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; hub keeps no process state across hibernation and the channels survive it; onset is the local runtime's, not the hosted one's`,
      }
    },
  },
  {
    id: "R-HIB-2",
    pipe: "relay",
    question: "does the durable channel survive one hub hibernation: same sockets, heartbeat round trip after the wake",
    run: async () => {
      const m = await mWake()
      const ok = m.evicted && m.open && m.wake !== "timeout"
      return {
        measured: `hub evicted ${m.evicted}, sockets open ${m.open}, round trip warm ${ms(m.warm)} / first after wake ${ms(m.wake)}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-HIB-3",
    pipe: "relay",
    question: "a command sent right after one hub hibernation is delivered (nothing lost across the wake)",
    run: async () => {
      const m = await mWake()
      return {
        measured: `hub evicted ${m.evicted}, command delivered ${m.dataDelivered}`,
        verdict: m.evicted && m.dataDelivered ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-HIB-4",
    pipe: "relay",
    question: "for how long a hibernated channel lives with the 5 s transport keepalive (observed to 150 s)",
    run: async () => {
      const m = await mSurvive(false)
      return {
        measured: `open at 150 s ${m.openAt150}, heartbeat after ${m.delivered}, hub evicted ${m.evicted}`,
        verdict: m.openAt150 && m.delivered ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-HIB-5",
    pipe: "relay",
    question: "for how long a hibernated channel lives with no traffic at all (silent peer)",
    run: async () => {
      const m = await mSurvive(true)
      const closed = m.closedAfterS !== null && m.closedAfterS < 120
      return {
        measured: m.openAt150
          ? "open at 150 s"
          : `closed after ${m.closedAfterS} s, code ${m.closeCode}, hub evicted ${m.evicted}`,
        verdict: closed ? "NEW-EDGE" : "CONTRADICTS",
        note: `${relayNote}; relay dead window left at its shipped 60,000 ms`,
      }
    },
  },
  {
    id: "R-SIZE-1",
    pipe: "relay",
    question: "message-size limit, stream class: largest sealed payload admitted, and the refusal one byte over",
    run: async () => {
      const m = await mSize("stream")
      return {
        measured: `max ${m.max} B sealed; ${m.max + 1} B ${overText(m.over)}; max re-admitted ${m.stable}`,
        verdict: m.max > 0 && m.stable ? "NEW-EDGE" : "CONTRADICTS",
        note: `${relayNote}; frames above the cap need an off-channel artifact path`,
      }
    },
  },
  {
    id: "R-SIZE-3",
    pipe: "relay",
    question:
      "message-size limit at the transport: largest single WebSocket message the relay runtime accepts before parsing it",
    run: async () => {
      const m = await mTransport()
      return {
        measured:
          m.cap === null
            ? `no transport refusal up to 64 MiB (largest tried); a 64 MiB message got ${m.overCode === "open" ? "no close in 20 s" : `close ${m.overCode}`}`
            : `max ${m.cap} B per WebSocket message; one byte more ends the socket (close ${m.overCode}, message too large)`,
        verdict: "NEW-EDGE",
        note: `${relayNote}; unadmitted socket, raw bytes; local runtime only, the hosted runtime message cap is not measured here; every relayed message is held to the codec cap of R-SIZE-1/2`,
      }
    },
  },
  {
    id: "R-SIZE-2",
    pipe: "relay",
    question:
      "message-size limit, data (stored command) class: largest sealed payload admitted, and the refusal one byte over",
    run: async () => {
      const m = await mSize("data")
      return {
        measured: `max ${m.max} B sealed; ${m.max + 1} B ${overText(m.over)}; max re-admitted ${m.stable}`,
        verdict: m.max > 0 && m.stable ? "NEW-EDGE" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-5-1",
    pipe: "relay",
    question: "5 s heartbeat, no hibernation in reach: 12 beats at 5 s all answered within 5 s, hub never evicted",
    run: async () => {
      const m = await mCadence(false)
      const ok = m.lost === 0 && m.p95 < 5_000 && !m.evicted
      return {
        measured: `lost ${m.lost}/12, p95 round trip ${Math.round(m.p95)} ms, hub evicted ${m.evicted}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; a 5 s heartbeat keeps the hub resident (see R-HIB-1 onset)`,
      }
    },
  },
  {
    id: "R-LIVE-5-2",
    pipe: "relay",
    question: "5 s window across one hibernation: the first heartbeat after a wake is answered within 5 s",
    run: async () => {
      const m = await mWake()
      const ok = m.evicted && m.wake !== "timeout" && m.wake < 5_000
      return {
        measured: `hub evicted ${m.evicted}, first round trip after wake ${ms(m.wake)}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-15-1",
    pipe: "relay",
    question: "15 s window across one hibernation: 5 s cadence plus the wake round trip stays under 15 s",
    run: async () => {
      const m = await mWake()
      const ok = m.evicted && m.wake !== "timeout" && 5_000 + m.wake < 15_000
      return {
        measured: `hub evicted ${m.evicted}, worst beat gap 5000 + ${ms(m.wake)}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-15-2",
    pipe: "relay",
    question:
      "15 s window with a hibernation wake (state loss) injected mid-run under the 5 s cadence: largest gap between answered beats",
    run: async () => {
      const m = await mCadence(true)
      const ok = m.lost === 0 && m.maxGap < 15_000
      return {
        measured: `lost ${m.lost}/12, largest gap ${m.maxGap} ms`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; the wake is the relay's own test hook (hibernation-wake memory, sockets kept)`,
      }
    },
  },
  {
    id: "R-LIVE-120-1",
    pipe: "relay",
    question: "120 s window across hibernation with the 5 s transport keepalive: the channel outlives 120 s",
    run: async () => {
      const m = await mSurvive(false)
      return {
        measured: `open at 150 s ${m.openAt150}, hub evicted ${m.evicted}`,
        verdict: m.openAt150 && m.delivered ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-120-2",
    pipe: "relay",
    question: "120 s window across hibernation with a silent peer: the channel outlives 120 s",
    run: async () => {
      const m = await mSurvive(true)
      const short = m.closedAfterS !== null && m.closedAfterS < 120
      return {
        measured: m.openAt150 ? "open at 150 s" : `closed after ${m.closedAfterS} s`,
        verdict: short ? "CONTRADICTS" : "CONFIRMS",
        note: `${relayNote}; design question for the lead, see the row's finding R-LIVE-120-2 in the task evidence; R4's 120 s deadline is unchanged until the lead rules`,
      }
    },
  },
]

const lanQuestions: readonly (readonly [string, string])[] = [
  ["L-AUTH-1", "auth lifetime of the same-network pipe"],
  ["L-HIB-1", "behaviour across one hibernation: does the pairing channel survive, for how long"],
  ["L-SIZE-1", "message-size limit"],
  ["L-LIVE-5", "5 s heartbeat window survives one hibernation"],
  ["L-LIVE-15", "15 s window survives one hibernation"],
  ["L-LIVE-120", "120 s window survives one hibernation"],
  ["L-KEY-1", "what binds the per-device pairing key"],
  ["L-ENROLL-1", "re-enrollment yields a new hand id"],
  ["L-MITM-1", "pairing handshake posture against a machine in the middle"],
]
const pairNote = "a same-network pair of machines, read-only"
const stateSpec = (side: "A" | "B"): Spec => ({
  id: `L-STATE-${side}`,
  pipe: "lan",
  question: `same-network direct path on a shipped build, pair host ${side}: does the device service listen off loopback or open discovery sockets`,
  run: async () => {
    const m = await mPairState(side)
    if (!m.ok) return { measured: "-", verdict: "UNMEASURED", note: m.why }
    const f = m.fields
    const off = f["listeners_off_loopback"] === "0" && f["udp_discovery_sockets"] === "0"
    return {
      measured: `device service ${f["device_service"] ?? "?"} ${f["version"] ?? ""}; listeners ${f["listeners_total"] ?? "?"} (off loopback ${f["listeners_off_loopback"] ?? "?"}); discovery sockets ${f["udp_discovery_sockets"] ?? "?"}; load ${f["load"] ?? "?"}/${f["cores"] ?? "?"}`,
      verdict: f["device_service"] === "running" && off ? "CONTRADICTS" : "NEW-EDGE",
      note: `${pairNote}; CONTRADICTS = the free same-network pipe the design assumes is absent on the shipped build (owner ruling 2026-11-11)`,
    }
  },
})
const silentSpec = (side: "A" | "B"): Spec => ({
  id: `R-HOSTED-1-${side}`,
  pipe: "relay",
  question: `hosted relay, from pair host ${side}: a silent unadmitted socket closes at the relay's hello deadline (within +2 s), with the local relay's close code`,
  run: async () => {
    const [m, ref] = await Promise.all([mPairSilent(side), mLocalSilent()])
    if (!m.ok) return { measured: "-", verdict: "UNMEASURED", note: m.why }
    const ms = Number(m.fields["closed_after_open_ms"] ?? "-1")
    const code = m.fields["code"] ?? "?"
    return {
      measured: `hosted closed ${ms} ms after open, code ${code}; hello deadline ${helloDeadlineMs} ms; local relay (this run, loaded build host) closed ${ref.afterOpenMs} ms after open, code ${ref.code}`,
      verdict: silentOk(ms, code, ref) ? "CONFIRMS" : "CONTRADICTS",
      note: `${pairNote}; one unauthenticated socket, no account, no frame sent; the deadline is the hello deadline, not the admitted channel's dead window`,
    }
  },
})
const pairSpecs: Spec[] = [
  stateSpec("A"),
  stateSpec("B"),
  silentSpec("A"),
  silentSpec("B"),
  {
    id: "R-HOSTED-2",
    pipe: "relay",
    question: "hosted relay: when a silent ADMITTED channel closes (the hosted counterpart of R-LIVE-120-2)",
    run: () =>
      Promise.resolve({ measured: "-", verdict: "UNMEASURED", note: "needs a test account on the account service" }),
  },
]
const lan: Spec[] = lanQuestions.map(([id, question]) => ({
  id,
  pipe: "lan",
  question,
  run: () => Promise.resolve({ measured: "-", verdict: "UNMEASURED", note: LAN_REASON }),
}))

// ---- run ----------------------------------------------------------------------------------------------------------
const tsv = (s: string): string => s.replace(/[\t\n]/g, " ")
const read = (path: string): Row[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t"))
    .map(([id = "", pipe = "", question = "", measured = "", verdict = "", , , note = ""]) => ({
      id,
      pipe,
      question,
      measured,
      verdict: verdict as Verdict,
      note,
    }))

const relayBuild = (): string => {
  const sha = Bun.spawnSync(["git", "-C", checkout, "rev-parse", "--short=12", "HEAD"]).stdout.toString().trim()
  const wrangler = (
    JSON.parse(readFileSync(Bun.resolveSync("wrangler/package.json", harnessDir), "utf8")) as { version: string }
  ).version
  const kernel = Bun.spawnSync(["uname", "-r"]).stdout.toString().trim()
  return `linux-${process.arch} ${kernel}; bun ${Bun.version}; wrangler ${wrangler}; relay ${sha}`
}
const pairBuild = (build: string): string =>
  `${build}; pair: two macOS hosts on one network, read through SP_R_PAIR_A/B`
const rerunFor = (id: string): string =>
  `CI=true SP_R_RELAY_CHECKOUT=<relay checkout> SP_R_PAIR_A=<exec on pair host A> SP_R_PAIR_B=<exec on pair host B> SP_R_HOSTED_RELAY=<wss://hosted relay> bun crates/omo-computer-engine/probes/probe-sp-r.ts --verify crates/omo-computer-engine/probes/relay-limits.tsv --only ${id}`

const specs = [...relay, ...pairSpecs, ...lan].filter((s) => only === null || only.has(s.id))
const needsPair = specs.some((s) => s.id.startsWith("L-STATE") || s.id.startsWith("R-HOSTED-1"))
if (needsPair && (pairExec("A") === "" || pairExec("B") === ""))
  die(
    "precondition missing: no same-network pair configured (SP_R_PAIR_A and SP_R_PAIR_B must each run a command on one host of the pair)",
  )
if (specs.some((s) => s.id.startsWith("R-HOSTED-1")) && !/^wss:\/\/[^/]+$/.test(process.env["SP_R_HOSTED_RELAY"] ?? ""))
  die("precondition missing: no hosted relay configured (SP_R_HOSTED_RELAY must be wss://<host>)")
let status = 0
try {
  const results = await Promise.all(
    specs.map(async (s) => {
      try {
        return { ...s, ...(await s.run()) } as Row
      } catch (e) {
        return {
          id: s.id,
          pipe: s.pipe,
          question: s.question,
          measured: `probe error: ${(e as Error).message}`,
          verdict: "CONTRADICTS",
          note: "",
        } as Row
      }
    }),
  )
  const build = relayBuild()
  for (const r of results) console.log(`${r.id}\t${r.verdict}\t${r.measured}`)
  if (mode === "--write") {
    const line = (r: Row): string =>
      [
        r.id,
        r.pipe,
        r.question,
        r.measured,
        r.verdict,
        rerunFor(r.id),
        r.id.startsWith("L-") || r.id.startsWith("R-HOSTED") ? pairBuild(build) : build,
        r.note,
      ]
        .map(tsv)
        .join("\t")
    // With --only, the other rows of an existing ledger are kept as they are; rows follow the probe's own order.
    const kept = new Map<string, string>()
    if (only !== null && existsSync(ledgerPath))
      for (const l of readFileSync(ledgerPath, "utf8").trim().split("\n").slice(1)) kept.set(l.split("\t")[0] ?? "", l)
    for (const r of results) kept.set(r.id, line(r))
    const order = [...relay, ...pairSpecs, ...lan].map((s) => s.id)
    const lines = [HEADER.join("\t"), ...order.flatMap((id) => kept.get(id) ?? [])]
    writeFileSync(ledgerPath, `${lines.join("\n")}\n`)
    console.log(`wrote ${results.length} rows`)
  } else {
    const known = new Map(read(ledgerPath).map((r) => [r.id, r]))
    for (const r of results) {
      const was = known.get(r.id)
      if (was === undefined) {
        console.log(`DIFF ${r.id}: not in the ledger`)
        status = 1
      } else if (was.verdict !== r.verdict) {
        console.log(`DIFF ${r.id}: ledger ${was.verdict}, measured ${r.verdict}`)
        status = 1
      }
    }
    if (only === null)
      for (const id of known.keys())
        if (!results.some((r) => r.id === id)) {
          console.log(`DIFF ${id}: in the ledger, no probe for it`)
          status = 1
        }
    console.log(status === 0 ? `verify: ${results.length} rows, every verdict identical` : "verify: verdicts differ")
  }
} finally {
  const servers = await Promise.allSettled([privateRelay, hostedRelay].filter((p) => p !== undefined))
  for (const s of servers) if (s.status === "fulfilled" && s.value !== undefined) await s.value.stop()
  await keyServer?.stop(true)
}
process.exit(status)
