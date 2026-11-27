// Vendored from sisyphuslabs/omo-relay-daemon@88e58154bb592d781446a62a3d8d912769675079 packages/local-api/src/policy.ts
// Status.policy: the relay-only policy as the device service reports it (docs/local-api.md).
export const POLICY_STATES = ["off", "pending", "active"] as const;
export type PolicyState = (typeof POLICY_STATES)[number];
export const THIS_DEVICE_STATES = [
  "unclassified",
  "desktop_unregistered",
  "indeterminate",
  "desktop",
  "cli_only",
  "acked",
] as const;
export type ThisDeviceState = (typeof THIS_DEVICE_STATES)[number];
// #1456: whether the service reported which devices a pending policy waits on (omo-service#1306's relay_only.waiting);
// "not_reported" is an older service, never "nothing waited on".
export const POLICY_WAITING_STATES = ["reported", "not_reported"] as const;
export type PolicyWaitingState = (typeof POLICY_WAITING_STATES)[number];
// Why a pending policy waits on a device; "other" is a reason this version does not know.
export const POLICY_WAIT_REASONS = [
  "not_acked",
  "discovery_missing",
  "discovery_incomplete",
  "inventory_mismatch",
  "other",
] as const;
export type PolicyWaitReason = (typeof POLICY_WAIT_REASONS)[number];

// #1456: the one device a pending policy is blocked on, why, and the one step that clears it (null: nothing to do).
export type PolicyBlocker = {
  readonly device: string;
  readonly label: string;
  readonly reason: PolicyWaitReason;
  readonly action: string | null;
};
export type Policy = {
  readonly state: PolicyState;
  readonly generation: number;
  readonly this_device: ThisDeviceState;
  readonly homes_pending: number;
  readonly unacked: readonly { readonly device: string; readonly label: string }[];
  // Present while pending (#1456); absent from a service before it.
  readonly waiting?: PolicyWaitingState;
  readonly blocker?: PolicyBlocker;
};
