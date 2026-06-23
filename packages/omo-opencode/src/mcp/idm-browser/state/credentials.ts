export type CredentialProvider = "1password" | "bitwarden" | "keychain" | "env"

export type CredentialResult = {
  username: string
  password: string
  source: CredentialProvider
}

export async function resolveCredential(
  provider: CredentialProvider,
  itemRef: string,
): Promise<CredentialResult> {
  switch (provider) {
    case "env": {
      const value = process.env[itemRef]
      if (!value) throw new Error(`Environment variable ${itemRef} not set`)
      const [username, password] = value.split(":")
      if (!username || !password) throw new Error(`${itemRef} must be in "user:pass" format`)
      return { username, password, source: "env" }
    }

    case "1password":
      return resolve1Password(itemRef)

    case "bitwarden":
    case "keychain":
      throw new Error(`Credential provider "${provider}" not yet implemented`)
  }
}

async function resolve1Password(itemRef: string): Promise<CredentialResult> {
  const proc = Bun.spawn(["op", "item", "get", itemRef, "--format", "json"], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`1Password CLI failed: ${stderr.trim()}`)
  }

  const item = JSON.parse(output) as { fields?: Array<{ id: string; value: string }> }
  const fields = item.fields ?? []

  const username = fields.find(f => f.id === "username")?.value
  const password = fields.find(f => f.id === "password")?.value

  if (!username || !password) {
    throw new Error(`1Password item ${itemRef} missing username or password fields`)
  }

  return { username, password, source: "1password" }
}
