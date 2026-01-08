import { loadAccounts, saveAccounts } from "../../auth/antigravity/storage"
import type { AccountStorage } from "../../auth/antigravity/types"

export async function listAccounts(): Promise<number> {
  const accounts = await loadAccounts()

  if (!accounts || accounts.accounts.length === 0) {
    console.log("No accounts found.")
    console.log("Run 'opencode auth login' and select Google (Antigravity) to add accounts.")
    return 0
  }

  console.log(`\nGoogle Antigravity Accounts (${accounts.accounts.length}/10):\n`)

  for (let i = 0; i < accounts.accounts.length; i++) {
    const acc = accounts.accounts[i]
    const isActive = i === accounts.activeIndex
    const activeMarker = isActive ? "* " : "  "

    console.log(`${activeMarker}[${i}] ${acc.email || "Unknown"}`)
    console.log(`      Tier: ${acc.tier || "free"}`)

    const rateLimits = acc.rateLimits || {}
    const now = Date.now()
    const limited: string[] = []

    if (rateLimits.claude && rateLimits.claude > now) {
      const mins = Math.ceil((rateLimits.claude - now) / 60000)
      limited.push(`claude (${mins}m)`)
    }
    if (rateLimits["gemini-flash"] && rateLimits["gemini-flash"] > now) {
      const mins = Math.ceil((rateLimits["gemini-flash"] - now) / 60000)
      limited.push(`gemini-flash (${mins}m)`)
    }
    if (rateLimits["gemini-pro"] && rateLimits["gemini-pro"] > now) {
      const mins = Math.ceil((rateLimits["gemini-pro"] - now) / 60000)
      limited.push(`gemini-pro (${mins}m)`)
    }

    if (limited.length > 0) {
      console.log(`      Rate limited: ${limited.join(", ")}`)
    }

    console.log()
  }

  return 0
}

export async function removeAccount(indexOrEmail: string): Promise<number> {
  const accounts = await loadAccounts()

  if (!accounts || accounts.accounts.length === 0) {
    console.error("No accounts found.")
    return 1
  }

  let index: number

  const parsedIndex = Number(indexOrEmail)
  if (Number.isInteger(parsedIndex) && String(parsedIndex) === indexOrEmail) {
    index = parsedIndex
  } else {
    index = accounts.accounts.findIndex((acc) => acc.email === indexOrEmail)
    if (index === -1) {
      console.error(`Account not found: ${indexOrEmail}`)
      return 1
    }
  }

  if (index < 0 || index >= accounts.accounts.length) {
    console.error(`Invalid index: ${index}. Valid range: 0-${accounts.accounts.length - 1}`)
    return 1
  }

  const removed = accounts.accounts[index]
  accounts.accounts.splice(index, 1)

  if (accounts.accounts.length === 0) {
    accounts.activeIndex = -1
  } else if (accounts.activeIndex >= accounts.accounts.length) {
    accounts.activeIndex = accounts.accounts.length - 1
  } else if (accounts.activeIndex > index) {
    accounts.activeIndex--
  }

  await saveAccounts(accounts)

  console.log(`Removed account: ${removed.email || "Unknown"} (index ${index})`)
  console.log(`Remaining accounts: ${accounts.accounts.length}`)

  return 0
}
