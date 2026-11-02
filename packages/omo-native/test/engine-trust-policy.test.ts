import { expect, test } from "bun:test"
import { selectEngineTrust } from "../engine-trust-policy"
import type { EngineTrustFacts, EngineTrustSelection, MacTrustSetting, TrustCertificate, WindowsCertificate } from "../engine-trust-policy"

const R = "1111111111111111111111111111111111111111111111111111111111111111"
const X = "2222222222222222222222222222222222222222222222222222222222222222"
const Q = "3333333333333333333333333333333333333333333333333333333333333333"
const H = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const HX = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const HQ = "cccccccccccccccccccccccccccccccccccccccc"
const idR = { sha256: R, sha1: H } as const
const idX = { sha256: X, sha1: HX } as const
const idQ = { sha256: Q, sha1: HQ } as const
const SSL = "1.2.840.113635.100.1.3"
const server = { kind: "oids", oids: ["1.3.6.1.5.5.7.3.1"] } as const
const unrestricted = { kind: "unrestricted" } as const
const cert: TrustCertificate = { sha256: R, sha1: H, selfSigned: true, ca: true, eku: unrestricted }
const root: WindowsCertificate = { ...cert, store: "ROOT", location: "LOCAL_MACHINE", physicalStore: "Default" }
const grant: MacTrustSetting = { policy: null, application: false, policyString: null, keyUsage: null, allowedErrors: [], result: "TrustRoot" }
const macCert = { ...cert, source: "trust-settings", settings: { user: [grant], admin: null, system: null } } as const
const chain = { anchor: idR, path: [idX, idR], explicitDistrust: false } as const
const mac = { os: "macos", complete: true, certificates: [macCert] } as const
const win = { os: "windows", complete: true, certificates: [root], disallowed: [], ctlSha1: [], bundledRoots: [] } as const

type Case = { readonly name: string; readonly facts: EngineTrustFacts; readonly S: readonly string[]; readonly I?: readonly string[]; readonly D?: readonly string[]; readonly sha1?: readonly string[]; readonly diagnostics?: EngineTrustSelection["diagnostics"]; readonly status?: "selected" | "failed" }
const cases: Case[] = [
  { name: "unconditional root", facts: mac, S: [R] },
  { name: "empty settings root", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [], admin: null, system: null } }] }, S: [R] },
  { name: "no settings", facts: { ...mac, certificates: [{ ...macCert, settings: { user: null, admin: null, system: null } }] }, S: [] },
  { name: "missing result defaults to TrustRoot", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, result: null }], admin: null, system: null } }] }, S: [R] },
  { name: "issued TrustRoot", facts: { ...mac, certificates: [{ ...macCert, selfSigned: false }] }, S: [] },
  { name: "self-signed non-CA TrustRoot", facts: { ...mac, certificates: [{ ...macCert, ca: false }] }, S: [R] },
  // Design 4.5 puts no CA flag on TrustAsRoot; in Bun's store a non-self-signed certificate only builds chains (M3).
  { name: "issued non-CA TrustAsRoot", facts: { ...mac, certificates: [{ ...macCert, selfSigned: false, ca: false, settings: { user: [{ ...grant, result: "TrustAsRoot" }], admin: null, system: null } }] }, S: [R] },
  { name: "issued empty settings", facts: { ...mac, certificates: [{ ...macCert, selfSigned: false, settings: { user: [], admin: null, system: null } }] }, S: [] },
  { name: "issued TrustAsRoot", facts: { ...mac, certificates: [{ ...macCert, selfSigned: false, settings: { user: [{ ...grant, result: "TrustAsRoot" }], admin: null, system: null } }] }, S: [R] },
  { name: "self-signed TrustAsRoot", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, result: "TrustAsRoot" }], admin: null, system: null } }] }, S: [R] },
  { name: "admin grant after unspecified user", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, result: "Unspecified" }], admin: [grant], system: null } }] }, S: [R] },
  { name: "system grant without earlier settings", facts: { ...mac, certificates: [{ ...macCert, settings: { user: null, admin: null, system: [grant] } }] }, S: [R] },
  { name: "first decisive user scoped grant", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, application: true }], admin: [grant], system: [grant] } }] }, S: [] },
  { name: "first decisive admin scoped grant", facts: { ...mac, certificates: [{ ...macCert, settings: { user: null, admin: [{ ...grant, application: true }], system: [grant] } }] }, S: [] },
  { name: "Linux selected CA bundle", facts: { os: "linux", complete: true, certificates: [cert, { ...cert, sha256: X, selfSigned: false, eku: server }, { ...cert, sha256: Q, ca: false }] }, S: [R, X] },
  { name: "Linux excludes client EKU", facts: { os: "linux", complete: true, certificates: [{ ...cert, eku: { kind: "oids", oids: ["1.3.6.1.5.5.7.3.2"] } }] }, S: [] },
]
for (const condition of [
  { application: true }, { policyString: "host.invalid" }, { keyUsage: 0 }, { allowedErrors: [0] },
  { policy: { oid: SSL, role: "server", nameConstrained: true } },
  { policy: { oid: SSL, role: "client", nameConstrained: false } },
  { policy: { oid: "1.2.3", role: null, nameConstrained: false } },
] as const) {
  cases.push({ name: `scoped or non-server grant ${JSON.stringify(condition)}`, facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, ...condition }], admin: null, system: null } }] }, S: [] })
}
for (const policy of [
  { oid: SSL, role: "server", nameConstrained: false },
  { oid: SSL, role: "unknown", nameConstrained: false },
  { oid: null, role: null, nameConstrained: false },
] as const) {
  cases.push({ name: `projected grant ${JSON.stringify(policy)}`, facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, policy }], admin: null, system: null } }] }, S: policy.role === "server" ? [R] : [], diagnostics: policy.role === "server" ? [] : ["macos-policy-unreadable"] })
}
for (const domain of ["user", "admin", "system"] as const) {
  for (const condition of [
    {}, { application: true }, { policyString: "host.invalid" }, { keyUsage: 1 }, { allowedErrors: [-1] },
    { policy: { oid: SSL, role: "server", nameConstrained: true } },
    { policy: { oid: SSL, role: "client", nameConstrained: false } },
    { policy: { oid: SSL, role: "unknown", nameConstrained: false } },
    { policy: { oid: null, role: null, nameConstrained: false } },
  ] as const) {
    cases.push({ name: `Deny ${domain} ${JSON.stringify(condition)}`, facts: { ...mac, certificates: [{ ...macCert, settings: { user: [grant], admin: [grant], system: [grant], [domain]: [{ ...grant, ...condition, result: "Deny" }] } }] }, S: [], D: [R] })
  }
}
for (const [name, eku, S] of [
  ["unrestricted", unrestricted, [R]], ["server", server, [R]], ["any-purpose", { kind: "oids", oids: ["2.5.29.37.0"] }, [R]],
  ["none", { kind: "none" }, []], ["error", { kind: "error" }, []], ["client", { kind: "oids", oids: ["1.3.6.1.5.5.7.3.2"] }, []],
] as const) cases.push({ name: `Windows EKU ${name}`, facts: { ...win, certificates: [{ ...root, eku }] }, S })
for (const location of ["CURRENT_USER", "LOCAL_MACHINE", "CURRENT_USER_GROUP_POLICY", "LOCAL_MACHINE_GROUP_POLICY", "LOCAL_MACHINE_ENTERPRISE", "CURRENT_SERVICE", "SERVICE_SID", "USER_SID"] as const) {
  cases.push({ name: `Disallowed ${location}`, facts: { ...win, disallowed: [{ sha256: R, sha1: H, location, physicalStore: "Default" }] }, S: [], D: [R] })
}
cases.push(
  { name: "sorted selected identities", facts: { ...win, certificates: [{ ...root, sha256: X }, root, root] }, S: [R, X] },
  { name: "empty OID usage is excluded", facts: { ...win, certificates: [{ ...root, eku: { kind: "oids", oids: [] } }] }, S: [] },
  { name: "global Deny diagnostic", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, result: "Deny" }], admin: null, system: null } }] }, S: [], D: [R], diagnostics: [] },
  { name: "client Deny diagnostic", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, result: "Deny", policy: { oid: SSL, role: "client", nameConstrained: false } }], admin: null, system: null } }] }, S: [], D: [R], diagnostics: ["scoped-deny-applied-globally"] },
  { name: "lower priority Deny diagnostic", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [], admin: [{ ...grant, result: "Deny" }], system: null } }] }, S: [], D: [R], diagnostics: ["lower-priority-deny-applied"] },
  { name: "scoped higher grant does not trigger precedence diagnostic", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, application: true }], admin: [{ ...grant, result: "Deny" }], system: null } }] }, S: [], D: [R], diagnostics: [] },
  { name: "CTL denied root", facts: { ...win, ctlSha1: [H] }, S: [], sha1: [H] },
  { name: "duplicate sorted identities", facts: { ...win, certificates: [{ ...root, sha256: X }, root, root], ctlSha1: [H, H] }, S: [], sha1: [H] },
  { name: "issued ROOT is not anchor", facts: { ...win, certificates: [{ ...root, selfSigned: false }] }, S: [] },
  { name: "CA store is not anchor", facts: { ...win, certificates: [{ ...root, store: "CA" }] }, S: [] },
  { name: "self-signed machine TrustedPeople leaf", facts: { ...win, certificates: [{ ...root, store: "TrustedPeople", ca: false }] }, S: [R] },
  { name: "user TrustedPeople not imported", facts: { ...win, certificates: [{ ...root, store: "TrustedPeople", location: "CURRENT_USER" }] }, S: [] },
  { name: "issued TrustedPeople leaf not imported", facts: { ...win, certificates: [{ ...root, store: "TrustedPeople", selfSigned: false, ca: false, chain }] }, S: [] },
)
for (const store of ["CA", "ROOT", "TrustedPeople"] as const) {
  cases.push({ name: `Windows issued ${store} inside S`, facts: { ...win, certificates: [root, { ...root, sha256: X, selfSigned: false, store, chain }] }, S: [R], I: [X] })
}
for (const [name, changes] of [
  ["own EKU excludes server", { eku: { kind: "none" } }], ["not a CA", { ca: false }],
  ["no verdict", { chain: undefined }], ["outside selected anchors", { chain: { ...chain, anchor: idQ } }],
  ["explicit distrust", { chain: { ...chain, explicitDistrust: true } }],
] as const) {
  cases.push(
    { name: `Windows intermediate ${name}`, facts: { ...win, certificates: [root, { ...root, sha256: X, selfSigned: false, store: "CA", chain, ...changes }] }, S: [R] },
    { name: `macOS intermediate ${name}`, facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, chain, ...changes }] }, S: [R] },
  )
}
for (const [name, verdict] of [
  ["inside S", chain], ["outside S", { ...chain, anchor: idQ }], ["no anchor", { ...chain, anchor: null }],
  ["explicit distrust", { ...chain, explicitDistrust: true }],
] as const) {
  const I = name === "inside S" ? [X] : []
  cases.push({ name: `macOS intermediate ${name}`, facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, chain: verdict }] }, S: [R], I })
}
for (const source of ["openssl-default-file", "openssl-default-dir"] as const) {
  cases.push(
    { name: `${source} root`, facts: { ...mac, certificates: [{ ...macCert, source, settings: { user: null, admin: null, system: null } }] }, S: [R] },
    { name: `${source} own EKU`, facts: { ...mac, certificates: [{ ...macCert, source, eku: { kind: "none" } }] }, S: [] },
    { name: `${source} non-CA`, facts: { ...mac, certificates: [{ ...macCert, source, ca: false }] }, S: [] },
    { name: `${source} issued intermediate`, facts: { ...mac, certificates: [macCert, { ...macCert, source, sha256: X, selfSigned: false, chain }] }, S: [R], I: [X] },
    { name: `${source} issued non-CA is not an intermediate`, facts: { ...mac, certificates: [macCert, { ...macCert, source, sha256: X, selfSigned: false, ca: false, chain }] }, S: [R] },
    { name: `${source} denied copy`, facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, result: "Deny" }], admin: null, system: null } }, { ...macCert, source }] }, S: [], D: [R] },
  )
}
cases.push(
  { name: "Windows intermediate bundled anchor", facts: { ...win, certificates: [{ ...root, ...idX, selfSigned: false, store: "CA", chain }], bundledRoots: [idR] }, S: [], I: [X] },
  { name: "Windows denied bundled anchor", facts: { ...win, certificates: [{ ...root, ...idX, selfSigned: false, store: "CA", chain }], bundledRoots: [idR], disallowed: [{ ...idR, location: "CURRENT_USER", physicalStore: "Default" }] }, S: [], D: [R] },
  { name: "Windows denied bundled anchor outside the reported path", facts: { ...win, certificates: [{ ...root, ...idX, selfSigned: false, store: "CA", chain: { ...chain, path: [idX] } }], bundledRoots: [idR], disallowed: [{ ...idR, location: "CURRENT_USER", physicalStore: "Default" }] }, S: [], D: [R] },
  { name: "Windows CTL denied bundled-only anchor", facts: { ...win, certificates: [{ ...root, ...idX, selfSigned: false, store: "CA", chain }], bundledRoots: [idR], ctlSha1: [H] }, S: [], sha1: [H] },
  { name: "Windows CTL denied bundled-only anchor outside the reported path", facts: { ...win, certificates: [{ ...root, ...idX, selfSigned: false, store: "CA", chain: { ...chain, path: [idX] } }], bundledRoots: [idR], ctlSha1: [H] }, S: [], sha1: [H] },
  { name: "Windows CTL denied non-candidate path member", facts: { ...win, certificates: [root, { ...root, ...idX, selfSigned: false, store: "CA", chain: { ...chain, path: [idX, idQ, idR] } }], ctlSha1: [HQ] }, S: [R], sha1: [HQ] },
  { name: "Windows denied path", facts: { ...win, certificates: [root, { ...root, ...idX, selfSigned: false, store: "CA", chain: { ...chain, path: [idX, idQ, idR] } }], disallowed: [{ ...idQ, location: "LOCAL_MACHINE", physicalStore: "Default" }] }, S: [R], D: [Q] },
  { name: "Windows denied intermediate", facts: { ...win, certificates: [root, { ...root, ...idX, selfSigned: false, store: "CA", chain }], disallowed: [{ ...idX, location: "LOCAL_MACHINE", physicalStore: "Default" }] }, S: [R], D: [X] },
  { name: "Windows CTL denied path member", facts: { ...win, certificates: [{ ...root, sha1: HX }, { ...root, ...idX, sha1: HQ, selfSigned: false, store: "CA", chain: { ...chain, path: [{ sha256: X, sha1: HQ }, { sha256: Q, sha1: H }, { sha256: R, sha1: HX }] } }, { ...root, sha256: Q, store: "CA" }], ctlSha1: [H] }, S: [R], sha1: [H] },
  { name: "macOS denied path", facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, chain: { ...chain, path: [idX, idQ, idR] } }, { ...macCert, sha256: Q, settings: { user: [{ ...grant, result: "Deny" }], admin: null, system: null } }] }, S: [R], D: [Q] },
  // Revision 12 (option C): the macOS chain step is BasicX509, so the EKU rule is the policy's. The intermediate
  // and every certificate on its reported path must allow server use; a path member the facts do not
  // describe cannot be checked and excludes it. Windows keeps its CryptoAPI SSL verdict unchanged.
  { name: "macOS intermediate clientAuth-only EKU", facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, eku: { kind: "oids", oids: ["1.3.6.1.5.5.7.3.2"] }, chain }] }, S: [R] },
  { name: "macOS intermediate anyExtendedKeyUsage EKU", facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, eku: { kind: "oids", oids: ["2.5.29.37.0"] }, chain }] }, S: [R], I: [X] },
  { name: "macOS path member clientAuth-only EKU", facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, chain: { ...chain, path: [idX, idQ, idR] } }, { ...macCert, sha256: Q, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, eku: { kind: "oids", oids: ["1.3.6.1.5.5.7.3.2"] }, chain: { ...chain, path: [idQ, idR] } }] }, S: [R] },
  { name: "macOS path members allowing server use", facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, chain: { ...chain, path: [idX, idQ, idR] } }, { ...macCert, sha256: Q, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, eku: server, chain: { ...chain, path: [idQ, idR] } }] }, S: [R], I: [X, Q] },
  { name: "macOS anchor clientAuth-only EKU", facts: { ...mac, certificates: [{ ...macCert, eku: { kind: "oids", oids: ["1.3.6.1.5.5.7.3.2"] } }, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, chain }] }, S: [R] },
  { name: "macOS path member outside the facts", facts: { ...mac, certificates: [macCert, { ...macCert, sha256: X, selfSigned: false, source: "keychain", settings: { user: null, admin: null, system: null }, chain: { ...chain, path: [idX, idQ, idR] } }] }, S: [R] },
  { name: "Windows path member outside the facts", facts: { ...win, certificates: [root, { ...root, ...idX, selfSigned: false, store: "CA", chain: { ...chain, path: [idX, idQ, idR] } }] }, S: [R], I: [X] },
  { name: "unrelated policy Deny", facts: { ...mac, certificates: [{ ...macCert, settings: { user: [{ ...grant, result: "Deny", policy: { oid: "1.2.3", role: null, nameConstrained: false } }, grant], admin: null, system: null } }] }, S: [R] },
)
for (const facts of [mac, win, { os: "linux", complete: true, certificates: [cert] }] as const) {
  cases.push({ name: `${facts.os} incomplete negatives`, facts: { ...facts, complete: false }, S: [], status: "failed", diagnostics: ["negative-sources-incomplete"] })
}
for (const fixture of cases) {
  test(`#given ${fixture.name} #when selecting engine trust #then exact authorized identities remain`, () => {
    // #given
    const facts = fixture.facts
    // #when
    const selected = selectEngineTrust(facts)
    // #then
    expect({ status: selected.status, S: selected.S, I: selected.I, D: selected.D }).toEqual({
      status: fixture.status ?? "selected", S: fixture.S, I: fixture.I ?? [], D: { sha256: fixture.D ?? [], sha1: fixture.sha1 ?? [] },
    })
    if (fixture.diagnostics) expect(selected.diagnostics).toEqual(fixture.diagnostics)
  })
}
