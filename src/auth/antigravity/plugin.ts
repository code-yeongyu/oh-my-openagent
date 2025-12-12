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
  decodeState,
} from "./oauth"
import { createAntigravityFetch } from "./fetch"
import { fetchProjectContext } from "./project"
import { formatTokenForStorage } from "./token"

/**
 * Provider ID for Google models
 * Antigravity is an auth method for Google, not a separate provider
 */
const GOOGLE_PROVIDER_ID = "google"

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
      // Check if current auth is OAuth type
      const currentAuth = await auth()
      if (!isOAuthAuth(currentAuth)) {
        // Not OAuth auth, return empty (fallback to default fetch)
        return {}
      }

      // Read credentials from provider.options (opencode.json)
      // Fall back to default credentials if not configured
      const clientId =
        (provider.options?.clientId as string) || ANTIGRAVITY_CLIENT_ID
      const clientSecret =
        (provider.options?.clientSecret as string) || ANTIGRAVITY_CLIENT_SECRET

      // Log if using custom credentials (for debugging)
      if (
        process.env.ANTIGRAVITY_DEBUG === "1" &&
        (clientId !== ANTIGRAVITY_CLIENT_ID ||
          clientSecret !== ANTIGRAVITY_CLIENT_SECRET)
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

      // Create the Antigravity fetch interceptor
      // Note: The fetch interceptor uses constants for token refresh internally
      // Custom credentials in provider.options are for future extensibility
      const antigravityFetch = createAntigravityFetch(
        getAuth,
        authClient,
        GOOGLE_PROVIDER_ID
      )

      return {
        fetch: antigravityFetch,
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
         *
         * @returns Authorization result with URL and callback
         */
        authorize: async (): Promise<AuthOuathResult> => {
          // Build OAuth URL with PKCE
          const { url, verifier } = await buildAuthURL()

          // Start local callback server to receive OAuth callback
          const callbackPromise = startCallbackServer()

          return {
            url,
            instructions:
              "Complete the sign-in in your browser. We'll automatically detect when you're done.",
            method: "auto",

            /**
             * Callback function invoked when OAuth redirect is received.
             * Exchanges code for tokens and fetches project context.
             */
            callback: async () => {
              try {
                // Wait for OAuth callback
                const result = await callbackPromise

                // Check for errors
                if (result.error) {
                  console.error(
                    `[antigravity-plugin] OAuth error: ${result.error}`
                  )
                  return { type: "failed" as const }
                }

                if (!result.code) {
                  console.error(
                    "[antigravity-plugin] No authorization code received"
                  )
                  return { type: "failed" as const }
                }

                // Verify state and extract original verifier
                const state = decodeState(result.state)
                if (state.verifier !== verifier) {
                  console.error("[antigravity-plugin] PKCE verifier mismatch")
                  return { type: "failed" as const }
                }

                // Exchange authorization code for tokens
                const tokens = await exchangeCode(result.code, verifier)

                // Fetch user info (optional, for logging)
                try {
                  const userInfo = await fetchUserInfo(tokens.access_token)
                  if (process.env.ANTIGRAVITY_DEBUG === "1") {
                    console.log(
                      `[antigravity-plugin] Authenticated as: ${userInfo.email}`
                    )
                  }
                } catch {
                  // User info is optional, continue without it
                }

                // Fetch project context for Antigravity API
                const projectContext = await fetchProjectContext(
                  tokens.access_token
                )

                // Format refresh token with project info for storage
                // Format: refreshToken|projectId|managedProjectId
                const formattedRefresh = formatTokenForStorage(
                  tokens.refresh_token,
                  projectContext.cloudaicompanionProject || "",
                  projectContext.managedProjectId
                )

                return {
                  type: "success" as const,
                  access: tokens.access_token,
                  refresh: formattedRefresh,
                  expires: Date.now() + tokens.expires_in * 1000,
                }
              } catch (error) {
                console.error(
                  `[antigravity-plugin] OAuth flow failed: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`
                )
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
