/**
 * Credit System Integration Patterns
 *
 * Tier 3 knowledge: How to integrate with external credit/lending systems.
 * Focus on patterns and approaches, not specific endpoints or credentials.
 */

export interface LenderApiVersion {
  version: string;
  description: string;
  features: string[];
  authMethod: string;
}

export interface KycProvider {
  name: string;
  specialties: string[];
  capabilities: string[];
}

export interface CreditBureau {
  name: string;
  priority: "primary" | "secondary" | "tertiary";
  dataExpiryDays: number;
  cachingStrategy: string;
}

export interface AsyncPattern {
  name: string;
  description: string;
  useCases: string[];
  implementationNotes: string;
}

export interface PaymentGatewayPattern {
  name: string;
  description: string;
  securityConsiderations: string[];
}

export interface IntegrationSignatures {
  algorithm: string;
  keyFormat: string;
  verificationSteps: string[];
}

export interface CreditIntegrations {
  lenderApiVersions: LenderApiVersion[];
  kycProviders: KycProvider[];
  creditBureaus: CreditBureau[];
  asyncPatterns: AsyncPattern[];
  paymentGatewayPatterns: PaymentGatewayPattern[];
  security: {
    lenderGateway: IntegrationSignatures;
  };
}

export const CREDIT_INTEGRATIONS: CreditIntegrations = {
  lenderApiVersions: [
    {
      version: "V3.5",
      description: "Legacy stable API for basic loan operations",
      features: [
        "Loan application submission",
        "Basic status tracking",
        "Document upload",
        "Synchronous responses"
      ],
      authMethod: "RS512 JWT with 24h expiry"
    },
    {
      version: "V4",
      description: "Modern API with enhanced async capabilities",
      features: [
        "Async loan processing",
        "Webhook callbacks",
        "Batch operations",
        "Enhanced error codes",
        "Process tracker integration"
      ],
      authMethod: "RS512 JWT with 1h expiry + refresh tokens"
    },
    {
      version: "V4.1",
      description: "Latest stable with multi-product support",
      features: [
        "Personal loans",
        "Business loans",
        "Credit cards",
        "BNPL integration",
        "Unified dashboard API"
      ],
      authMethod: "RS512 JWT with OAuth 2.0 flow"
    },
    {
      version: "Mod",
      description: "Modular API for custom integration patterns",
      features: [
        "Composable endpoints",
        "GraphQL support",
        "Custom field mapping",
        "Sandbox environment parity"
      ],
      authMethod: "RS512 JWT with API key rotation"
    }
  ],

  kycProviders: [
    {
      name: "HyperVerge",
      specialties: [
        "Document verification",
        "OCR extraction",
        "Forgery detection"
      ],
      capabilities: [
        "PAN card verification",
        "Aadhaar XML validation",
        "Passport verification",
        "Driving license validation",
        "Real-time document quality check"
      ]
    },
    {
      name: "Karza",
      specialties: [
        "PAN/Aadhaar verification",
        "Face match",
        "Liveness detection"
      ],
      capabilities: [
        "PAN verification with NSDL",
        "Aadhaar eKYC",
        "Aadhaar OTP verification",
        "Face match confidence scoring",
        "Video liveness detection",
        "Bank account verification"
      ]
    }
  ],

  creditBureaus: [
    {
      name: "CIBIL",
      priority: "primary",
      dataExpiryDays: 30,
      cachingStrategy: "Redis with TTL matching bureau refresh cycle"
    },
    {
      name: "Experian",
      priority: "secondary",
      dataExpiryDays: 30,
      cachingStrategy: "Application-level cache with staleness checks"
    },
    {
      name: "CRIF",
      priority: "tertiary",
      dataExpiryDays: 30,
      cachingStrategy: "On-demand fetch with 24h short-term cache"
    }
  ],

  asyncPatterns: [
    {
      name: "Async Callbacks",
      description: "Long-running operations return immediately with process ID, results delivered via callback",
      useCases: [
        "Credit bureau pulls",
        "Document verification",
        "Income verification",
        "Loan decision processing"
      ],
      implementationNotes: "Implement exponential backoff retry for callback delivery. Store callback signatures for verification."
    },
    {
      name: "Webhooks",
      description: "Event-driven notifications for state changes",
      useCases: [
        "Loan status updates",
        "Payment confirmations",
        "Document approval/rejection",
        "KYC completion events"
      ],
      implementationNotes: "Webhook payloads must be signed. Implement idempotency keys to prevent duplicate processing."
    },
    {
      name: "Process Trackers",
      description: "Background polling mechanism for operations without callback support",
      useCases: [
        "Legacy API integration",
        "Third-party service status",
        "Batch job monitoring",
        "Manual review workflows"
      ],
      implementationNotes: "Use jittered backoff for polling intervals. Implement circuit breaker for failed tracker attempts."
    }
  ],

  paymentGatewayPatterns: [
    {
      name: "Standard Integration",
      description: "Direct payment flow with server-to-server confirmation",
      securityConsiderations: [
        "Never store raw card data",
        "Use tokenization for repeat payments",
        "Implement webhook signature verification",
        "Enforce idempotency on payment creation"
      ]
    },
    {
      name: "Emandate/NACH Integration",
      description: "Recurring payment authorization for loan EMIs",
      securityConsiderations: [
        "Validate mandate before activation",
        "Store mandate references securely",
        "Implement pre-debit notifications",
        "Support mandate revocation flows"
      ]
    },
    {
      name: "UPI Collect Flow",
      description: "UPI-based payment collection with intent/QR support",
      securityConsiderations: [
        "Validate VPA before initiation",
        "Implement timeout handling",
        "Check for duplicate transaction references",
        "Handle NPCI error codes appropriately"
      ]
    }
  ],

  security: {
    lenderGateway: {
      algorithm: "RS512",
      keyFormat: "PEM-encoded RSA 2048-bit keys",
      verificationSteps: [
        "Verify JWT signature using lender public key",
        "Check token expiry (exp claim)",
        "Validate issuer (iss claim)",
        "Verify audience (aud claim)",
        "Check not-before time (nbf claim)",
        "Validate custom claims (partner_id, environment)"
      ]
    }
  }
};

// Individual exports for convenient access
export const LENDER_API_VERSIONS = CREDIT_INTEGRATIONS.lenderApiVersions;
export const KYC_PROVIDERS = CREDIT_INTEGRATIONS.kycProviders;
export const CREDIT_BUREAUS = CREDIT_INTEGRATIONS.creditBureaus;
export const ASYNC_PATTERNS = CREDIT_INTEGRATIONS.asyncPatterns;
export const PAYMENT_GATEWAY_PATTERNS = CREDIT_INTEGRATIONS.paymentGatewayPatterns;
export const INTEGRATION_SECURITY = CREDIT_INTEGRATIONS.security;
