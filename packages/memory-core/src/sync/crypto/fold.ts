import type { ParsedBody, Principal, RecoveryKey } from "./parse.ts"

export type Authority = {
  readonly members: ReadonlyMap<string, Principal>
  readonly registry: ReadonlyMap<string, RecoveryKey>
  readonly epoch: number
  readonly custodyRoot: string
  readonly epochOrigins: ReadonlyMap<number, string>
  readonly admittedBy: ReadonlyMap<string, string>
  readonly enrolledEver: ReadonlySet<string>
  readonly cancelled: ReadonlySet<string>
}

export type FoldedRecord = {
  readonly seq: number
  readonly digest: string
  readonly body: ParsedBody
  readonly before: Authority | null
}

const withEntry = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map([...map, [key, value]])

const without = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  const next = new Map(map)
  next.delete(key)
  return next
}

const genesisAuthority = (record: FoldedRecord): Authority | null => {
  const body = record.body
  if (body.kind !== "genesis") return null
  return {
    members: new Map([[body.firstDevice.id, body.firstDevice]]),
    registry: new Map([[body.recoveryKey.credential_id, body.recoveryKey]]),
    epoch: 1,
    custodyRoot: body.custodyRoot,
    epochOrigins: new Map([[1, record.digest]]),
    admittedBy: new Map([[body.firstDevice.id, record.digest]]),
    enrolledEver: new Set([body.recoveryKey.credential_id]),
    cancelled: new Set(),
  }
}

/**
 * The membership and recovery-registry fold of sync-design section 7, one record at a time:
 * genesis seeds both sets; approvals add a device; recovery-key enrollments and removals
 * edit the registry; a rotation replaces the membership and starts its epoch; a
 * recovery-join resets both sets to the joined device and the key it used; a veto restores
 * the join's predecessor minus that key and cancels every keyring record after the join. A
 * fork-resolution, once the receiver has proven its evidence, takes the authority it states.
 */
export const applyRecord = (
  history: ReadonlyArray<FoldedRecord>,
  record: FoldedRecord,
): Authority | null => {
  const before = record.before
  if (before === null) return genesisAuthority(record)
  const body = record.body
  switch (body.kind) {
    case "genesis":
      return null
    case "fork-resolution":
      return {
        ...before,
        members: new Map(body.members.map((member) => [member.id, member])),
        registry: new Map(body.recoveryKeys.map((key) => [key.credential_id, key])),
        enrolledEver: new Set([...before.enrolledEver, ...body.recoveryKeys.map((key) => key.credential_id)]),
        epoch: body.epoch,
        epochOrigins:
          body.epoch === before.epoch ? before.epochOrigins : withEntry(before.epochOrigins, body.epoch, record.digest),
      }
    case "approval":
      return {
        ...before,
        members: withEntry(before.members, body.principal.id, body.principal),
        admittedBy: withEntry(before.admittedBy, body.principal.id, record.digest),
      }
    case "recovery-key":
      return {
        ...before,
        registry: withEntry(before.registry, body.key.credential_id, body.key),
        enrolledEver: new Set([...before.enrolledEver, body.key.credential_id]),
      }
    case "recovery-key-removed":
      return { ...before, registry: without(before.registry, body.credentialId) }
    case "rotation":
      return {
        ...before,
        members: new Map(body.members.map((member) => [member.id, member])),
        epoch: before.epoch + 1,
        epochOrigins: withEntry(before.epochOrigins, before.epoch + 1, record.digest),
      }
    case "recovery-join": {
      const used = before.registry.get(body.credentialId)
      if (used === undefined) return null
      return {
        ...before,
        members: new Map([[body.principal.id, body.principal]]),
        registry: new Map([[used.credential_id, used]]),
        admittedBy: withEntry(before.admittedBy, body.principal.id, record.digest),
      }
    }
    case "recovery-join-vetoed": {
      const join = history.find((candidate) => candidate.digest === body.joinDigest)
      if (join === undefined || join.body.kind !== "recovery-join" || join.before === null) {
        return null
      }
      const later = history.filter((candidate) => candidate.seq > join.seq)
      return {
        ...before,
        members: join.before.members,
        registry: without(join.before.registry, join.body.credentialId),
        cancelled: new Set([...before.cancelled, ...later.map((candidate) => candidate.digest)]),
      }
    }
  }
}

export const isVetoedEpoch = (authority: Authority, epoch: number): boolean => {
  const origin = authority.epochOrigins.get(epoch)
  return origin !== undefined && authority.cancelled.has(origin)
}

export const isCancelledAdmission = (authority: Authority, principalId: string): boolean => {
  const origin = authority.admittedBy.get(principalId)
  return origin !== undefined && authority.cancelled.has(origin)
}
