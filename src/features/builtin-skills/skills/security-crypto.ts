import type { BuiltinSkill } from "../types"

export const SECURITY_CRYPTO_SKILL_NAME = "security-crypto"

const SECURITY_CRYPTO_SKILL_DESCRIPTION =
  "Cryptography and key management security guidelines: algorithm selection, key management, TLS configuration, common crypto mistakes, and secure random generation. Triggers: 'cryptography', 'encryption', 'hashing', 'TLS', 'key management', 'crypto', 'password hashing', 'certificate'."

export const securityCryptoSkill: BuiltinSkill = {
  name: SECURITY_CRYPTO_SKILL_NAME,
  description: SECURITY_CRYPTO_SKILL_DESCRIPTION,
  template: `# Security — Cryptography & Key Management

## ALGORITHM SELECTION GUIDE

### Symmetric Encryption
- **Preferred**: AES-256-GCM
- **Acceptable**: AES-256-CBC with HMAC, ChaCha20-Poly1305 for mobile
- **NEVER USE**: DES, 3DES, RC4, Blowfish, ECB mode

### Asymmetric Encryption
- **Preferred for new systems**: Ed25519/X25519
- **Acceptable**: ECDSA with P-256/P-384
- **Legacy**: RSA-2048+

### Hashing
- **General purpose**: SHA-256/SHA-384/SHA-512
- **Forward-looking**: SHA-3
- **NEVER USE**: MD5 or SHA-1 for security

### Password Hashing
- **Preferred**: Argon2id (memory-hard)
- **Acceptable**: bcrypt (cost ≥ 12), scrypt
- **NEVER USE**: MD5, SHA-*, or plain hashing for passwords
- **ALWAYS**: Use salt

### HMAC
- **Message authentication**: HMAC-SHA256

## KEY MANAGEMENT

### Key Generation
- Use cryptographically secure random (crypto.randomBytes, crypto.getRandomValues)
- NEVER use Math.random() for key material

### Key Storage
- Use HSMs, key management services (AWS KMS, GCP KMS, Azure Key Vault), OS keychain
- NEVER hardcode keys in source code

### Key Rotation
- Regular rotation schedule
- Support multiple active keys during transition
- Version keys

### Key Derivation
- HKDF for deriving subkeys
- PBKDF2 as fallback (iterations ≥ 600000)

## TLS CONFIGURATION

- Minimum TLS 1.2, prefer TLS 1.3
- Strong cipher suites only, disable NULL, EXPORT, DES, RC4 ciphers
- Certificate pinning considerations, HSTS preloading
- Perfect Forward Secrecy (PFS) with ECDHE key exchange

## COMMON CRYPTO MISTAKES TO DETECT

- Using ECB mode (patterns visible in ciphertext)
- Reusing nonces/IVs with the same key
- Using predictable IVs (counter without randomness)
- Comparing MACs with == instead of constant-time comparison
- Rolling your own crypto instead of using established libraries
- Not validating certificate chains
- Using same key for encryption and authentication

## SECURE RANDOM GENERATION

- crypto.randomBytes() / crypto.getRandomValues()
- UUID v4 for identifiers
- timing-safe comparison for secrets
`,
}
