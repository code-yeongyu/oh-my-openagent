// The device: its one Loro peer and its private state dir. The state dir holds the peer file
// and the capture receipts; it must sit outside the synced memory root (review r4 LOW), so a
// copied or cloned memory dir never carries a peer and every device that opens it mints its
// own. Item docs for capture are created here, so every capture op carries the device peer.

import { isAbsolute, join, relative, resolve, sep } from "node:path"

import type { LoroDoc, PeerID } from "../../crdt/loro-runtime"
import { realpath } from "../../fs/resilient"

import { DevicePeerError, loadOrCreateDevicePeer, retireAside } from "./device-peer"
import { createItemDoc } from "./document"
import { deviceFingerprint, readMachineId } from "./machine-id"

export interface ItemDevice {
  readonly peer: PeerID
  readonly stateDir: string
}

export interface OpenItemDeviceOptions {
  readonly stateDir: string
  readonly memoryRoot: string
  /** The OS machine id; read from the platform when omitted. Hosts without one pass their own install id. */
  readonly machineId?: string
}

export async function openItemDevice(options: OpenItemDeviceOptions): Promise<ItemDevice> {
  const stateDir = await canonical(options.stateDir)
  const memoryRoot = await canonical(options.memoryRoot)
  if (isInside(stateDir, memoryRoot)) {
    throw new DevicePeerError(`device state dir ${stateDir} is inside the synced memory root ${memoryRoot}`)
  }
  const machine = deviceFingerprint(options.machineId ?? (await readMachineId()), stateDir)
  const { peer, retired } = await loadOrCreateDevicePeer(join(stateDir, "peer"), machine)
  // Receipts of a retired peer describe another machine's captures; they must not steer this one.
  if (retired) await retireAside(join(stateDir, "captures"))
  return { peer, stateDir }
}

export function createDeviceItemDoc(device: ItemDevice): Promise<LoroDoc> {
  return createItemDoc(device.peer)
}

export function assertDeviceDoc(device: ItemDevice, doc: LoroDoc): void {
  if (doc.peerIdStr !== device.peer) {
    throw new DevicePeerError(`item doc peer ${doc.peerIdStr} is not the device peer ${device.peer}`)
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

async function canonical(path: string): Promise<string> {
  const absolute = resolve(path)
  const missing: string[] = []
  let probe = absolute
  for (;;) {
    try {
      return join(await realpath(probe), ...missing.reverse())
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      const parent = resolve(probe, "..")
      if (parent === probe) return absolute
      missing.push(relative(parent, probe))
      probe = parent
    }
  }
}
