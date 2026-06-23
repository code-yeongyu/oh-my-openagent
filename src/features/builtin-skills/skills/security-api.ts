import type { BuiltinSkill } from "../types"

export const SECURITY_API_SKILL_NAME = "security-api"

const SECURITY_API_SKILL_DESCRIPTION =
  "API security patterns: authentication, authorization, input validation, rate limiting, CORS, CSRF, security headers, and error handling. Triggers: 'API security', 'authentication', 'authorization', 'JWT', 'OAuth', 'CORS', 'CSRF', 'rate limiting', 'input validation'."

export const securityApiSkill: BuiltinSkill = {
  name: SECURITY_API_SKILL_NAME,
  description: SECURITY_API_SKILL_DESCRIPTION,
  template: `# Security — API Security Patterns

## AUTHENTICATION PATTERNS

### JWT (JSON Web Tokens)
- **Token Structure**: \`header.payload.signature\`
- **Signing Algorithms**: RS256 (asymmetric, preferred) over HS256 (symmetric).
- **Token Storage**: \`httpOnly\` cookies are preferred over \`localStorage\` to prevent XSS theft.
- **Expiration**: Use short-lived access tokens combined with refresh tokens.
- **Token Rotation**: Issue a new refresh token upon each use to detect and prevent reuse.

### OAuth 2.0
- **Authorization Code Flow with PKCE**: Preferred flow for web and mobile applications.
- **Client Credentials**: Use for machine-to-machine (M2M) communication.
- **Implicit Flow**: NEVER use the implicit flow (deprecated due to security risks).
- **Redirect URI**: Validate \`redirect_uri\` strictly against an exact match whitelist.

### Session Management
- **Secure Session IDs**: Generate cryptographically secure, high-entropy session identifiers.
- **Cookie Flags**: Always use \`httpOnly\`, \`Secure\`, and \`SameSite\` flags for session cookies.
- **Session Invalidation**: Destroy sessions completely on the server side upon logout.
- **Timeouts**: Implement both absolute timeouts (e.g., 24 hours) and idle timeouts (e.g., 30 minutes).

## AUTHORIZATION PATTERNS

### RBAC (Role-Based Access Control)
- Define clear roles and map permissions to those roles.
- Enforce access control at the middleware or gateway level.

### ABAC (Attribute-Based Access Control)
- Policy-based access control considering user attributes, resource ownership, and environmental context.

### Core Principles
- **Server-Side Checks**: ALWAYS check authorization on the server side. NEVER trust client-side role claims or UI state.
- **Principle of Least Privilege**: Default deny all access. Grant only the minimum permissions required for a task.

## INPUT VALIDATION
- **Server-Side Always**: Validate all input on the server side. Client-side validation is for UX only.
- **Whitelist over Blacklist**: Allow known-good input (whitelist) rather than trying to block known-bad input (blacklist).
- **Schema Validation**: Use robust schema validation libraries (e.g., Zod, Joi, ajv) for request bodies and parameters.
- **Parameterized Queries**: ALWAYS use parameterized queries or ORMs for database access. NEVER use string concatenation (prevents SQL Injection).
- **Content-Type Validation**: Strictly validate the \`Content-Type\` header and enforce request size limits to prevent DoS.

## RATE LIMITING
- **Algorithms**: Implement Token Bucket or Sliding Window algorithms.
- **Granularity**: Apply limits per-user (authenticated) and per-IP (unauthenticated).
- **Response**: Return HTTP 429 Too Many Requests with a \`Retry-After\` header.

## CORS CONFIGURATION (Cross-Origin Resource Sharing)
- **Restrict Origins**: Restrict \`Access-Control-Allow-Origin\` to specific trusted domains. NEVER use \`*\` in production.
- **Limit Methods/Headers**: Only allow necessary HTTP methods and headers.
- **Credentials Mode**: Be extremely careful with \`Access-Control-Allow-Credentials: true\`; it cannot be used with \`Origin: *\`.

## CSRF PROTECTION (Cross-Site Request Forgery)
- **SameSite Cookies**: Use \`SameSite=Lax\` or \`SameSite=Strict\` for session cookies.
- **CSRF Tokens**: Require anti-CSRF tokens for state-changing operations (POST, PUT, DELETE).
- **Double-Submit Cookie**: A common pattern where a random value is sent in both a cookie and a request parameter/header.

## SECURITY HEADERS
- \`Content-Security-Policy\` (CSP): Mitigates XSS and data injection attacks.
- \`Strict-Transport-Security\` (HSTS): Enforces HTTPS connections.
- \`X-Content-Type-Options\`: Set to \`nosniff\` to prevent MIME-sniffing.
- \`X-Frame-Options\`: Set to \`DENY\` or \`SAMEORIGIN\` to prevent clickjacking.
- \`Referrer-Policy\`: Controls how much referrer information is included with requests.
- \`Permissions-Policy\`: Restricts access to browser features (e.g., camera, microphone).

## API VERSIONING SECURITY
- **Deprecation Policies**: Clearly communicate deprecation timelines for older, potentially less secure API versions.
- **Breaking Change Management**: Ensure security fixes are backported or force upgrades if critical.
- **Version Sunset**: Actively monitor and shut down legacy endpoints to reduce the attack surface.

## ERROR HANDLING
- **No Stack Traces**: NEVER expose stack traces, database errors, or internal system details to clients.
- **Generic Messages**: Use generic error messages for the client (e.g., "An unexpected error occurred").
- **Request IDs**: Provide a unique Request ID in the error response for debugging against internal logs.
`,
}
