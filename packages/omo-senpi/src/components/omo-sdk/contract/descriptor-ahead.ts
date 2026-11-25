// Inputs the contract types ahead of the parity descriptor (design lane ruling on the P0 gate, 2026-11-25): a call no
// slice serves yet keeps today's descriptor, and the slice that serves it adds the field there and deletes its entry here.
export type DescriptorAhead = { readonly row: string; readonly field: string; readonly retires_with: string }

export const DESCRIPTOR_AHEAD: readonly DescriptorAhead[] = [
  { row: "account.adopt", field: "credential", retires_with: "A1d" },
  { row: "account.credentials.handOver", field: "destination", retires_with: "A1d" },
  { row: "engine.auth.apiKey", field: "destination", retires_with: "E1c" },
  { row: "engine.auth.bearerToken", field: "destination", retires_with: "E1c" },
  { row: "engine.auth.credentials", field: "destination", retires_with: "E1c" },
]
