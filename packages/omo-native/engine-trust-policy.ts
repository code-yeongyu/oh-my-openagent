/** Parsed helper facts only. The importer owns JSON/DER parsing and source completeness. */
export type EnhancedKeyUsage =
  | { readonly kind: "unrestricted" | "none" | "error" }
  | { readonly kind: "oids"; readonly oids: readonly string[] }
/** A certificate named by both identities, so a Disallowed-CTL SHA-1 also reaches non-candidate chain members. */
export type CertificateId = { readonly sha256: string; readonly sha1: string }
export type TrustChain = {
  readonly anchor: CertificateId | null
  readonly path: readonly CertificateId[]
  readonly explicitDistrust: boolean
}
export type TrustCertificate = {
  readonly sha256: string
  readonly sha1: string
  readonly selfSigned: boolean
  readonly ca: boolean
  /** Unrestricted represents an absent own EKU on macOS/Linux. */
  readonly eku: EnhancedKeyUsage
  readonly chain?: TrustChain
}
export type WindowsLocation =
  | "CURRENT_USER" | "LOCAL_MACHINE" | "CURRENT_USER_GROUP_POLICY" | "LOCAL_MACHINE_GROUP_POLICY"
  | "LOCAL_MACHINE_ENTERPRISE" | "CURRENT_SERVICE" | "SERVICE_SID" | "USER_SID"
export type WindowsCertificate = TrustCertificate & {
  readonly store: "ROOT" | "CA" | "TrustedPeople"
  readonly location: WindowsLocation
  readonly physicalStore: string
}
export type MacTrustSetting = {
  readonly policy: { readonly oid: string | null; readonly role: "server" | "client" | "unknown" | null; readonly nameConstrained: boolean } | null
  readonly application: boolean
  readonly policyString: string | null
  readonly keyUsage: number | null
  readonly allowedErrors: readonly number[]
  readonly result: "TrustRoot" | "TrustAsRoot" | "Deny" | "Unspecified" | null
}
export type MacCertificate = TrustCertificate & {
  readonly source: "trust-settings" | "keychain" | "openssl-default-file" | "openssl-default-dir"
  /** null means absent; [] is Apple's unrestricted self-signed-root grant. */
  readonly settings: Readonly<Record<"user" | "admin" | "system", readonly MacTrustSetting[] | null>>
}
export type EngineTrustFacts = { readonly complete: boolean } & (
  | {
    readonly os: "windows"
    readonly certificates: readonly WindowsCertificate[]
    readonly disallowed: readonly (CertificateId & { readonly location: WindowsLocation; readonly physicalStore: string })[]
    readonly ctlSha1: readonly string[]
    readonly bundledRoots: readonly CertificateId[]
  }
  | { readonly os: "macos"; readonly certificates: readonly MacCertificate[] }
  | { readonly os: "linux"; readonly certificates: readonly TrustCertificate[] }
)
export type Diagnostic = "negative-sources-incomplete" | "macos-policy-unreadable" | "scoped-deny-applied-globally" | "lower-priority-deny-applied"
export type EngineTrustSelection = {
  readonly status: "selected" | "failed"
  readonly S: readonly string[]
  readonly I: readonly string[]
  readonly D: { readonly sha256: readonly string[]; readonly sha1: readonly string[] }
  readonly diagnostics: readonly Diagnostic[]
}
const SSL = "1.2.840.113635.100.1.3"
const domains = ["user", "admin", "system"] as const

function unreachable(value: never): never {
  throw new TypeError(`Unexpected trust fact variant: ${String(value)}`)
}
function serverAuth(eku: EnhancedKeyUsage): boolean {
  switch (eku.kind) {
    case "unrestricted": return true
    case "none": case "error": return false
    case "oids": return eku.oids.includes("1.3.6.1.5.5.7.3.1") || eku.oids.includes("2.5.29.37.0")
    default: return unreachable(eku)
  }
}
function sslPolicy(setting: MacTrustSetting): boolean {
  return setting.policy === null || setting.policy.oid === SSL || setting.policy.oid === null
}
function scoped(setting: MacTrustSetting): boolean {
  return setting.application || setting.policyString !== null || setting.keyUsage !== null
    || setting.allowedErrors.length > 0 || (setting.policy !== null && (setting.policy.nameConstrained || setting.policy.role !== "server"))
}

/** Select identities, never certificate bytes. All accumulators are local to this call. */
export function selectEngineTrust(facts: EngineTrustFacts): EngineTrustSelection {
  const S = new Set<string>()
  const I = new Set<string>()
  const denied = new Set<string>()
  const blocked = new Set<string>()
  const thumbprints = new Set<string>()
  const diagnostics = new Set<Diagnostic>()
  const intermediates: TrustCertificate[] = []
  const anchors = new Set<string>()
  switch (facts.os) {
    case "windows":
      for (const entry of facts.disallowed) denied.add(entry.sha256)
      for (const thumbprint of facts.ctlSha1) thumbprints.add(thumbprint)
      for (const cert of facts.certificates) {
        if (thumbprints.has(cert.sha1)) blocked.add(cert.sha256)
      }
      for (const root of facts.bundledRoots) anchors.add(root.sha256)
      break
    case "macos":
      for (const cert of facts.certificates) {
        let higherGrant = false
        for (const domain of domains) {
          let domainGrant = cert.settings[domain]?.length === 0 && cert.selfSigned
          for (const setting of cert.settings[domain] ?? []) {
            if (!sslPolicy(setting)) continue
            switch (setting.result) {
              case "Deny":
                denied.add(cert.sha256)
                if (scoped(setting)) diagnostics.add("scoped-deny-applied-globally")
                if (higherGrant) diagnostics.add("lower-priority-deny-applied")
                break
              case null: case "TrustRoot": case "TrustAsRoot":
                domainGrant ||= !scoped(setting) && setting.policy?.oid !== null && (setting.result === "TrustAsRoot" || cert.selfSigned)
                break
              case "Unspecified": break
              default: unreachable(setting.result)
            }
          }
          higherGrant ||= domainGrant
        }
      }
      break
    case "linux": break
    default: unreachable(facts)
  }
  if (!facts.complete) {
    return {
      status: "failed", S: [], I: [], D: { sha256: [...denied].sort(), sha1: [...thumbprints].sort() },
      diagnostics: ["negative-sources-incomplete"],
    }
  }
  for (const identity of denied) blocked.add(identity)
  const isDenied = (id: CertificateId): boolean => blocked.has(id.sha256) || thumbprints.has(id.sha1)
  const eligible = (cert: TrustCertificate): boolean => !isDenied(cert) && serverAuth(cert.eku)
  switch (facts.os) {
    case "windows":
      for (const cert of facts.certificates) {
        if (!eligible(cert)) continue
        switch (cert.store) {
          case "ROOT":
            if (cert.selfSigned) S.add(cert.sha256)
            else if (cert.ca) intermediates.push(cert)
            break
          case "CA": if (cert.ca) intermediates.push(cert); break
          case "TrustedPeople":
            switch (cert.location) {
              case "LOCAL_MACHINE": case "LOCAL_MACHINE_GROUP_POLICY": case "LOCAL_MACHINE_ENTERPRISE": break
              case "CURRENT_USER": case "CURRENT_USER_GROUP_POLICY": case "CURRENT_SERVICE": case "SERVICE_SID": case "USER_SID": continue
              default: unreachable(cert.location)
            }
            if (cert.selfSigned) S.add(cert.sha256)
            else if (cert.ca) intermediates.push(cert)
            break
          default: unreachable(cert.store)
        }
      }
      break
    case "macos":
      for (const cert of facts.certificates) {
        if (blocked.has(cert.sha256)) continue
        switch (cert.source) {
          case "trust-settings":
            for (const domain of domains) {
              const settings = cert.settings[domain]
              if (settings === null) continue
              if (settings.length === 0) {
                if (cert.selfSigned) S.add(cert.sha256)
                break
              }
              let decisive = false
              for (const setting of settings) {
                if (!sslPolicy(setting)) continue
                switch (setting.result) {
                  case "Unspecified": continue
                  case "Deny": decisive = true; break
                  case null: case "TrustRoot": case "TrustAsRoot":
                    decisive = true
                    if (setting.policy !== null && (setting.policy.oid === null || setting.policy.role === "unknown" || setting.policy.role === null)) {
                      diagnostics.add("macos-policy-unreadable")
                      continue
                    }
                    if (!scoped(setting) && (setting.result === "TrustAsRoot" || cert.selfSigned)) S.add(cert.sha256)
                    break
                  default: unreachable(setting.result)
                }
              }
              if (decisive) break
            }
            break
          case "openssl-default-file": case "openssl-default-dir":
            if (cert.ca && cert.selfSigned && eligible(cert)) S.add(cert.sha256)
            else if (cert.ca && !cert.selfSigned && eligible(cert)) intermediates.push(cert)
            break
          case "keychain": if (cert.ca && eligible(cert)) intermediates.push(cert); break
          default: unreachable(cert.source)
        }
      }
      break
    case "linux":
      for (const cert of facts.certificates) if (cert.ca && eligible(cert)) S.add(cert.sha256)
      break
    default: unreachable(facts)
  }
  for (const root of S) anchors.add(root)
  // macOS reports a BasicX509 chain (design revision 12, option C), so the EKU rule covers every certificate
  // on the path; a member the facts do not describe cannot be checked and excludes the intermediate.
  // Windows' CryptoAPI SSL verdict already applies usage, and its path may name bundled roots.
  const described = new Map<string, TrustCertificate>(facts.certificates.map((cert): [string, TrustCertificate] => [cert.sha256, cert]))
  const pathUsable = (path: readonly CertificateId[]): boolean => facts.os !== "macos" || path.every((id) => {
    const member = described.get(id.sha256)
    return member !== undefined && serverAuth(member.eku)
  })
  for (const cert of intermediates) {
    const chain = cert.chain
    if (chain && chain.anchor !== null && anchors.has(chain.anchor.sha256) && !isDenied(chain.anchor)
      && !chain.explicitDistrust && !isDenied(cert) && !chain.path.some(isDenied) && pathUsable(chain.path)
      && serverAuth(cert.eku) && !S.has(cert.sha256)) I.add(cert.sha256)
  }
  return {
    status: "selected", S: [...S].sort(), I: [...I].sort(),
    D: { sha256: [...denied].sort(), sha1: [...thumbprints].sort() }, diagnostics: [...diagnostics].sort(),
  }
}
