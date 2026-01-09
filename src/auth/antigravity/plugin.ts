/**
 * Google Antigravity Auth Plugin for OpenCode
 *
 * Provides OAuth authentication for Google models via Antigravity API.
 * This plugin integrates with OpenCode's auth system to enable:
 * - OAuth 2.0 with PKCE flow for Google authentication
 * - Automatic token refresh
 * - Request/response transformation for Antigravity API
 *
 * @example
 * ```json
 * // opencode.json
 * {
 *   "plugin": ["oh-my-opencode"],
 *   "provider": {
 *     "google": {
 *       "options": {
 *         "clientId": "custom-client-id",
 *         "clientSecret": "custom-client-secret"
 *       }
 *     }
 *   }
 * }
 * ```
 */

import type { Auth, Provider } from "@opencode-ai/sdk"
import type { AuthHook, AuthOuathResult, PluginInput } from "@opencode-ai/plugin"

import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET } from "./constants"
import {
  buildAuthURL,
  exchangeCode,
  startCallbackServer,
  fetchUserInfo,
} from "./oauth"
import { createAntigravityFetch } from "./fetch"
import { fetchProjectContext } from "./project"
import { formatTokenForStorage, parseStoredToken } from "./token"
import { AccountManager } from "./accounts"
import { loadAccounts } from "./storage"
import { promptAddAnotherAccount, promptAccountTier } from "./cli"
import { openBrowserURL } from "./browser"
import type { AccountTier, AntigravityRefreshParts } from "./types"

/**
 * Provider ID for Google models
 * Antigravity is an auth method for Google, not a separate provider
 */
const GOOGLE_PROVIDER_ID = "google"

/**
 * Maximum number of Google accounts that can be added
 */
const MAX_ACCOUNTS = 10

/**
 * Type guard to check if auth is OAuth type
 */
function isOAuthAuth(
  auth: Auth
): auth is { type: "oauth"; access: string; refresh: string; expires: number } {
  return auth.type === "oauth"
}

/**
 * Creates the Google Antigravity OAuth plugin for OpenCode.
 *
 * This factory function creates an auth plugin that:
 * 1. Provides OAuth flow for Google authentication
 * 2. Creates a custom fetch interceptor for Antigravity API
 * 3. Handles token management and refresh
 *
 * @param input - Plugin input containing the OpenCode client
 * @returns Hooks object with auth configuration
 *
 * @example
 * ```typescript
 * // Used by OpenCode automatically when plugin is loaded
 * const hooks = await createGoogleAntigravityAuthPlugin({ client, ... })
 * ```
 */
export async function createGoogleAntigravityAuthPlugin({
  client,
}: PluginInput): Promise<{ auth: AuthHook }> {
  // Cache for custom credentials from provider.options
  // These are populated by loader() and used by authorize()
  // Falls back to defaults if loader hasn't been called yet
  let cachedClientId: string = ANTIGRAVITY_CLIENT_ID
  let cachedClientSecret: string = ANTIGRAVITY_CLIENT_SECRET

  const authHook: AuthHook = {
    /**
     * Provider identifier - must be "google" as Antigravity is
     * an auth method for Google models, not a separate provider
     */
    provider: GOOGLE_PROVIDER_ID,

    /**
     * Loader function called when auth is needed.
     * Reads credentials from provider.options and creates custom fetch.
     *
     * @param auth - Function to retrieve current auth state
     * @param provider - Provider configuration including options
     * @returns Object with custom fetch function
     */
    loader: async (
      auth: () => Promise<Auth>,
      provider: Provider
    ): Promise<Record<string, unknown>> => {
      const currentAuth = await auth()
      
      if (process.env.ANTIGRAVITY_DEBUG === "1") {
        console.log("[antigravity-plugin] loader called")
        console.log("[antigravity-plugin] auth type:", currentAuth?.type)
        console.log("[antigravity-plugin] auth keys:", Object.keys(currentAuth || {}))
      }
      
      if (!isOAuthAuth(currentAuth)) {
        if (process.env.ANTIGRAVITY_DEBUG === "1") {
          console.log("[antigravity-plugin] NOT OAuth auth, returning empty")
        }
        return {}
      }
      
      if (process.env.ANTIGRAVITY_DEBUG === "1") {
        console.log("[antigravity-plugin] OAuth auth detected, creating custom fetch")
      }

      let accountManager: AccountManager | null = null
      try {
        const storedAccounts = await loadAccounts()
        if (storedAccounts) {
          accountManager = new AccountManager(currentAuth, storedAccounts)
          if (process.env.ANTIGRAVITY_DEBUG === "1") {
            console.log(`[antigravity-plugin] Loaded ${accountManager.getAccountCount()} accounts from storage`)
          }
        } else if (currentAuth.refresh.includes("|||")) {
          const tokens = currentAuth.refresh.split("|||")
          const firstToken = tokens[0]!
          accountManager = new AccountManager(
            { refresh: firstToken, access: currentAuth.access || "", expires: currentAuth.expires || 0 },
            null
          )
          for (let i = 1; i < tokens.length; i++) {
            const parts = parseStoredToken(tokens[i]!)
            accountManager.addAccount(parts)
          }
          await accountManager.save()
          if (process.env.ANTIGRAVITY_DEBUG === "1") {
            console.log("[antigravity-plugin] Migrated multi-account auth to storage")
          }
        }
      } catch (error) {
        if (process.env.ANTIGRAVITY_DEBUG === "1") {
          console.error(
            `[antigravity-plugin] Failed to load accounts: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          )
        }
      }

      cachedClientId =
        (provider.options?.clientId as string) || ANTIGRAVITY_CLIENT_ID
      cachedClientSecret =
        (provider.options?.clientSecret as string) || ANTIGRAVITY_CLIENT_SECRET

      // Log if using custom credentials (for debugging)
      if (
        process.env.ANTIGRAVITY_DEBUG === "1" &&
        (cachedClientId !== ANTIGRAVITY_CLIENT_ID ||
          cachedClientSecret !== ANTIGRAVITY_CLIENT_SECRET)
      ) {
        console.log(
          "[antigravity-plugin] Using custom credentials from provider.options"
        )
      }

      // Create adapter for client.auth.set that matches fetch.ts AuthClient interface
      const authClient = {
        set: async (
          providerId: string,
          authData: { access?: string; refresh?: string; expires?: number }
        ) => {
          await client.auth.set({
            body: {
              type: "oauth",
              access: authData.access || "",
              refresh: authData.refresh || "",
              expires: authData.expires || 0,
            },
            path: { id: providerId },
          })
        },
      }

      // Create auth getter that returns compatible format for fetch.ts
      const getAuth = async (): Promise<{
        access?: string
        refresh?: string
        expires?: number
      }> => {
        const authState = await auth()
        if (isOAuthAuth(authState)) {
          return {
            access: authState.access,
            refresh: authState.refresh,
            expires: authState.expires,
          }
        }
        return {}
      }

      const antigravityFetch = createAntigravityFetch(
        getAuth,
        authClient,
        GOOGLE_PROVIDER_ID,
        cachedClientId,
        cachedClientSecret
      )

      return {
        fetch: antigravityFetch,
        apiKey: "antigravity-oauth",
        accountManager,
      }
    },

    /**
     * Authentication methods available for this provider.
     * Only OAuth is supported - no prompts for credentials.
     */
    methods: [
      {
        type: "oauth",
        label: "OAuth with Google (Antigravity)",
        // NO prompts - credentials come from provider.options or defaults
        // OAuth flow starts immediately when user selects this method

        /**
         * Starts the OAuth authorization flow.
         * Opens browser for Google OAuth and waits for callback.
         * Supports multi-account flow with prompts for additional accounts.
         *
         * @returns Authorization result with URL and callback
         */
        authorize: async (): Promise<AuthOuathResult> => {
          const serverHandle = startCallbackServer()
          const { url, state: expectedState } = await buildAuthURL(undefined, cachedClientId, serverHandle.port)

          const browserOpened = await openBrowserURL(url)

          return {
            url,
            instructions: browserOpened
              ? "Opening browser for sign-in. We'll automatically detect when you're done."
              : "Please open the URL above in your browser to sign in.",
            method: "auto",

            callback: async () => {
              try {
                const result = await serverHandle.waitForCallback()

                if (result.error) {
                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.error(`[antigravity-plugin] OAuth error: ${result.error}`)
                  }
                  return { type: "failed" as const }
                }

                if (!result.code) {
                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.error("[antigravity-plugin] No authorization code received")
                  }
                  return { type: "failed" as const }
                }

                if (result.state !== expectedState) {
                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.error("[antigravity-plugin] State mismatch - possible CSRF attack")
                  }
                  return { type: "failed" as const }
                }

                const redirectUri = `http://localhost:${serverHandle.port}/oauth-callback`
                const tokens = await exchangeCode(result.code, redirectUri, cachedClientId, cachedClientSecret)

                if (!tokens.refresh_token) {
                  serverHandle.close()
                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.error("[antigravity-plugin] OAuth response missing refresh_token")
                  }
                  return { type: "failed" as const }
                }

                let email: string | undefined
                try {
                  const userInfo = await fetchUserInfo(tokens.access_token)
                  email = userInfo.email
                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.log(`[antigravity-plugin] Authenticated as: ${email}`)
                  }
                } catch {
                  // User info is optional
                }

                const projectContext = await fetchProjectContext(tokens.access_token)
                const projectId = projectContext.cloudaicompanionProject || ""
                const tier = await promptAccountTier()

                const expires = Date.now() + tokens.expires_in * 1000
                const accounts: Array<{
                  parts: AntigravityRefreshParts
                  access: string
                  expires: number
                  email?: string
                  tier: AccountTier
                  projectId: string
                }> = [{
                  parts: {
                    refreshToken: tokens.refresh_token,
                    projectId,
                    managedProjectId: projectContext.managedProjectId,
                  },
                  access: tokens.access_token,
                  expires,
                  email,
                  tier,
                  projectId,
                }]

                await client.tui.showToast({
                  body: {
                    message: `Account 1 authenticated${email ? ` (${email})` : ""}`,
                    variant: "success",
                  },
                })

                while (accounts.length < MAX_ACCOUNTS) {
                  const addAnother = await promptAddAnotherAccount(accounts.length)
                  if (!addAnother) break

                  const additionalServerHandle = startCallbackServer()
                  const { url: additionalUrl, state: expectedAdditionalState } = await buildAuthURL(
                    undefined,
                    cachedClientId,
                    additionalServerHandle.port
                  )

                  const additionalBrowserOpened = await openBrowserURL(additionalUrl)
                  if (!additionalBrowserOpened) {
                    await client.tui.showToast({
                      body: {
                        message: `Please open in browser: ${additionalUrl}`,
                        variant: "warning",
                      },
                    })
                  }

                  try {
                    const additionalResult = await additionalServerHandle.waitForCallback()

                    if (additionalResult.error || !additionalResult.code) {
                      additionalServerHandle.close()
                      await client.tui.showToast({
                        body: {
                          message: "Skipping this account...",
                          variant: "warning",
                        },
                      })
                      continue
                    }

                    if (additionalResult.state !== expectedAdditionalState) {
                      additionalServerHandle.close()
                      await client.tui.showToast({
                        body: {
                          message: "State mismatch, skipping...",
                          variant: "warning",
                        },
                      })
                      continue
                    }

                    const additionalRedirectUri = `http://localhost:${additionalServerHandle.port}/oauth-callback`
                    const additionalTokens = await exchangeCode(
                      additionalResult.code,
                      additionalRedirectUri,
                      cachedClientId,
                      cachedClientSecret
                    )

                    if (!additionalTokens.refresh_token) {
                      additionalServerHandle.close()
                      if (process.env.ANTIGRAVITY_DEBUG === "1") {
                        console.error("[antigravity-plugin] Additional account OAuth response missing refresh_token")
                      }
                      await client.tui.showToast({
                        body: {
                          message: "Account missing refresh token, skipping...",
                          variant: "warning",
                        },
                      })
                      continue
                    }

                    let additionalEmail: string | undefined
                    try {
                      const additionalUserInfo = await fetchUserInfo(additionalTokens.access_token)
                      additionalEmail = additionalUserInfo.email
                    } catch {
                      // User info is optional
                    }

                    const additionalProjectContext = await fetchProjectContext(additionalTokens.access_token)
                    const additionalProjectId = additionalProjectContext.cloudaicompanionProject || ""
                    const additionalTier = await promptAccountTier()

                    const additionalExpires = Date.now() + additionalTokens.expires_in * 1000

                    accounts.push({
                      parts: {
                        refreshToken: additionalTokens.refresh_token,
                        projectId: additionalProjectId,
                        managedProjectId: additionalProjectContext.managedProjectId,
                      },
                      access: additionalTokens.access_token,
                      expires: additionalExpires,
                      email: additionalEmail,
                      tier: additionalTier,
                      projectId: additionalProjectId,
                    })

                    additionalServerHandle.close()

                    await client.tui.showToast({
                      body: {
                        message: `Account ${accounts.length} authenticated${additionalEmail ? ` (${additionalEmail})` : ""}`,
                        variant: "success",
                      },
                    })
                  } catch (error) {
                    additionalServerHandle.close()
                    if (process.env.ANTIGRAVITY_DEBUG === "1") {
                      console.error(
                        `[antigravity-plugin] Additional account OAuth failed: ${
                          error instanceof Error ? error.message : "Unknown error"
                        }`
                      )
                    }
                    await client.tui.showToast({
                      body: {
                        message: "Failed to authenticate additional account, skipping...",
                        variant: "warning",
                      },
                    })
                    continue
                  }
                }

                const firstAccount = accounts[0]!
                try {
                  const accountManager = new AccountManager(
                    {
                      refresh: formatTokenForStorage(
                        firstAccount.parts.refreshToken,
                        firstAccount.projectId,
                        firstAccount.parts.managedProjectId
                      ),
                      access: firstAccount.access,
                      expires: firstAccount.expires,
                    },
                    null
                  )

                  for (let i = 1; i < accounts.length; i++) {
                    const acc = accounts[i]!
                    accountManager.addAccount(
                      acc.parts,
                      acc.access,
                      acc.expires,
                      acc.email,
                      acc.tier
                    )
                  }

                  const currentAccount = accountManager.getCurrentAccount()
                  if (currentAccount) {
                    currentAccount.email = firstAccount.email
                    currentAccount.tier = firstAccount.tier
                  }

                  await accountManager.save()

                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.log(`[antigravity-plugin] Saved ${accounts.length} accounts to storage`)
                  }
                } catch (error) {
                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.error(
                      `[antigravity-plugin] Failed to save accounts: ${
                        error instanceof Error ? error.message : "Unknown error"
                      }`
                    )
                  }
                }

                const allRefreshTokens = accounts
                  .map((acc) => formatTokenForStorage(
                    acc.parts.refreshToken,
                    acc.projectId,
                    acc.parts.managedProjectId
                  ))
                  .join("|||")

                return {
                  type: "success" as const,
                  access: firstAccount.access,
                  refresh: allRefreshTokens,
                  expires: firstAccount.expires,
                }
              } catch (error) {
                serverHandle.close()
                if (process.env.ANTIGRAVITY_DEBUG === "1") {
                  console.error(
                    `[antigravity-plugin] OAuth flow failed: ${
                      error instanceof Error ? error.message : "Unknown error"
                    }`
                  )
                }
                return { type: "failed" as const }
              }
            },
          }
        },
      },
    ],
  }

  return {
    auth: authHook,
  }
}

/**
 * Default export for OpenCode plugin system
 */
export default createGoogleAntigravityAuthPlugin

/**
 * Named export for explicit imports
 */
export const GoogleAntigravityAuthPlugin = createGoogleAntigravityAuthPlugin
