import { confirm, select, isCancel } from "@clack/prompts"

export async function promptAddAnotherAccount(currentCount: number): Promise<boolean> {
  if (!process.stdout.isTTY) {
    return false
  }

  const result = await confirm({
    message: `Add another Google account?\nCurrently have ${currentCount} accounts (max 10)`,
  })

  if (isCancel(result)) {
    return false
  }

  return result
}

export async function promptAccountTier(): Promise<"free" | "paid"> {
  if (!process.stdout.isTTY) {
    return "free"
  }

  const tier = await select({
    message: "Select account tier",
    options: [
      { value: "free" as const, label: "Free" },
      { value: "paid" as const, label: "Paid" },
    ],
  })

  if (isCancel(tier)) {
    return "free"
  }

  return tier
}
