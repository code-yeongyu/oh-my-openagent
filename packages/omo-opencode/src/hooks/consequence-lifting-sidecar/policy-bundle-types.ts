export interface BundleSlot {
  name: string
  candidates: string[]
  maxSelectable: number
}

export interface BundleConstraint {
  left: string
  right: string
  kind: "mutually_exclusive" | "requires" | "composable_with"
}

export interface PolicyBundle {
  slots: BundleSlot[]
  constraints: BundleConstraint[]
}

export interface BundleSelection {
  selectedBySlot: Record<string, string[]>
  excluded: Array<{ decision: string; reason: string }>
  voi?: import("./voi-types").VOIResult
}
