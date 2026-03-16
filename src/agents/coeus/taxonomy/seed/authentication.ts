import type { TaxonomyEntry } from "../schema";

export const authenticationEntry: TaxonomyEntry = {
  category: "authentication",
  solutions: [
    {
      name: "JWT",
      description:
        "JSON Web Token - stateless authentication using signed tokens. Server verifies signature without session storage. Tokens contain claims about user identity.",
      spec_compliant: true,
      sources: [
        {
          ref: "RFC 7519 - JSON Web Token (JWT)",
          claim: "JWT is a compact, URL-safe means of representing claims to be transferred between two parties",
          tier: "tier-2-validated-reference",
          confidence: 1.0,
          type: "spec",
          url: "https://datatracker.ietf.org/doc/html/rfc7519",
        },
      ],
      constraints: {
        stateless: true,
        revocation: "requires additional mechanism",
      },
    },
    {
      name: "SessionBased",
      description:
        "Traditional session-based authentication. Server stores session data, client receives session ID in cookie. Stateful approach requiring session store.",
      sources: [
        {
          ref: "RFC 6265 - HTTP State Management Mechanism (Cookies)",
          claim: "HTTP cookies for session management",
          tier: "tier-2-validated-reference",
          confidence: 0.95,
          type: "spec",
          url: "https://datatracker.ietf.org/doc/html/rfc6265",
        },
      ],
      constraints: {
        stateful: true,
        session_store: "required (Redis, database, memory)",
      },
    },
  ],
  related: ["authorization", "oauth2", "openid-connect", "mfa"],
  implementation_notes: [
    "JWT: no server-side session storage, harder to revoke",
    "Session-based: easier revocation, requires session store",
    "Consider refresh token rotation for JWT",
    "Use secure, httpOnly cookies for session IDs",
  ],
};
