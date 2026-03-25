import { resolvePromptAppend } from "../../builtin-agents/resolve-file-uri"

export function buildGlm47FlashCreditServerPrompt(
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const todoDiscipline = buildGlm47FlashTodoDisciplineSection(useTaskSystem)

  const prompt = `<Memory_Bank_Instruction>
CRITICAL: Before starting ANY task, you MUST read the memory-bank to understand project patterns.

**Search for memory-bank in this order:**
1. First, check \`.opencode/memory-bank/\` (most common location)
2. If not found, check \`.agentic-loop/memory-bank/\` (alternate location)
3. If not found, search for any \`memory-bank/\` directory in the project
4. If still not found, use \`glob\` to find all \`.md\` files that might be memory-bank

**Once found:**
- Read index.md or INDEX.md if it exists (to understand structure)
- Read ALL .md files in the memory-bank directory
- Use the patterns and guidelines for server setup

Do NOT skip this step. The memory-bank contains essential configuration patterns and best practices.
</Memory_Bank_Instruction>

CreditServer - LSP Server Starter (GLM 4.7 Flash Mode)

## Quick Actions

**Start:**
\`\`\`bash
# 1. Check flake.nix has 4 services disabled
grep -c "enable = false" flake.nix  # Should be 4

# 2. Clean & Build
just cldb && just clkv && just kill-ports
cabal build all  # MUST succeed

# 3. Start infrastructure
just run-shell > process_compose.log 2>&1 &

# 4. Wait for health
pg_isready -h 127.0.0.1 -p 5433
redis-cli -p 6379 ping

# 5. Insert 11 configs
psql -U testUser -h 127.0.0.1 -d testLsp -p 5433 << 'EOF'
INSERT INTO config (id, key, value_enc, created_at, updated_at) VALUES 
('LSP8cf7261b78404620b5eefb0c5aeaef3c', 'piiHashSalt', 'ConfigRealm :: whb5iLKzNBdHC/f7ZgfzLg5qQ+CjcGLLjnU1AJS5j/k=', NOW(), NOW()),
('LSP4752ae5a469e43d88b6d74ea741068aa', 'wallet_user_code_counter', 'ConfigRealm :: 0', NOW(), NOW()),
('LSPa15bef5f939e4113b49a23c878f67861', 'euler_config_external', 'ConfigRealm :: eyJkb21haW5FQ0Rhc2hib2FyZCI6ImRhc2hib2FyZC5zYW5kYm94Lmp1c3BheS5pbiIsInBhdGgiOiIiLCJkb21haW5UeG4iOiJzYW5kYm94Lmp1c3BheS5pbiIsImRvbWFpbiI6InNhbmRib3guanVzcGF5LmluIiwiZG9tYWluUHMiOiJzYW5kYm94Lmp1c3BheS5pbiIsInNlY3VyZWRSZXF1ZXN0Ijp0cnVlLCJkb21haW5QcmVUeG4iOiJzYW5kYm94Lmp1c3BheS5pbiIsInRlbmFudEhvc3QiOiJzYW5kYm94Lmp1c3BheS5pbiIsInZlcnNpb24iOiIyMDIyLTA0LTIwIiwib3B0aW9uR2F0ZXdheVJlc3BvbnNlIjoidHJ1ZSIsImRvbWFpbkF1eGlsaWFyeSI6InNhbmRib3guanVzcGF5LmluIiwiZG9tYWluT3JkZXI6InNhbmRib3guanVzcGF5LmluIiwibHNwRXRiR2F0ZXdheUlkIjoiTFNQX0VUQiIsInBvcnQiOjQ0MywicmVmdW5kUG9ydCI6ODAsImxzcEdhdGV3YXlJZCI6IkxTUCIsInJlZnVuZFNlY3VyZWRSZXF1ZXN0IjpmYWxzZX0=', NOW(), NOW()),
('LSPb2a5e6bb181e4f60adb34ff578a10bec', 'REDIS_EXPIRY_TIME', 'ConfigRealm :: 10', NOW(), NOW()),
('LSPdb7ceb6c4bbb4030a367898d944a0c0c', 'lsp_acc_details', 'ConfigRealm :: eyJiYXNlVXJsUG9ydCI6ODA4MCwidGVzdE1vZGUiOnRydWUsImJhc2VVcmwiOiIxMjcuMC4wLjEiLCJiYXNlVXJsUGF0aCI6IiIsInNjaGVtZSI6Ikh0dHAifQ==', NOW(), NOW()),
('LSP369cfae732bf4152ae4ffe82fcb700ec', 'euler_config', 'ConfigRealm :: eyJkb21haW5FQ0Rhc2hib2FyZCI6ImRhc2hib2FyZC5zYW5kYm94Lmp1c3BheS5pbiIsInBhdGgiOiIiLCJkb21haW5UeG4iOiJzYW5kYm94Lmp1c3BheS5pbiIsImRvbWFpbiI6InNhbmRib3guanVzcGF5LmluIiwiZG9tYWluUHMiOiJzYW5kYm94Lmp1c3BheS5pbiIsInNlY3VyZWRSZXF1ZXN0Ijp0cnVlLCJkb21haW5QcmVUeG4iOiJzYW5kYm94Lmp1c3BheS5pbiIsInRlbmFudEhvc3QiOiJzYW5kYm94Lmp1c3BheS5pbiIsInZlcnNpb24iOiIyMDIyLTA0LTIwIiwib3B0aW9uR2F0ZXdheVJlc3BvbnNlIjoidHJ1ZSIsImRvbWFpbkF1eGlsaWFyeSI6InNhbmRib3guanVzcGF5LmluIiwiZG9tYWluT3JkZXI6InNhbmRib3guanVzcGF5LmluIiwibHNwRXRiR2F0ZXdheUlkIjoiTFNQX0VUQiIsInBvcnQiOjQ0MywicmVmdW5kUG9ydCI6ODAsImxzcEdhdGV3YXlJZCI6IkxTUCIsInJlZnVuZFNlY3VyZWRSZXF1ZXN0IjpmYWxzZX0=', NOW(), NOW()),
('LSPa5fab68440fd4a8ebc6ceec19686a6ac', 'gateway_base_url', 'ConfigRealm :: 127.0.0.1:8011/gateway/', NOW(), NOW()),
('LSP035caebcafe443f9a2d182aa86ad6cc0', 'maxLoanRequestInfoRetryCount', 'ConfigRealm :: 5', NOW(), NOW()),
('LSP3b414f43ce80477882f8cfa62330981e', 'LenderDecisionData', 'ConfigRealm :: ewogICAiZGF5UmFuZ2UiOjE4MCwKICAgImV4Y2x1ZGVkU3RhdHVzIjpbCiAgICAgICJDUkVBVEVEIiwKICAgICAgIlRIRU1JU19SRUpFQ1RFRCIKICAgXQp9', NOW(), NOW()),
('LSP0edabf0971b14647a1d1e92a9f05028a', 'EULER_ENABLED_MERCHANT', 'ConfigRealm :: W10=', NOW(), NOW()),
('LSP6845330a723d4714bbb239ded56d4198', 'default_order_expiry_time', 'ConfigRealm :: NTE4NDAwMA==', NOW(), NOW())
ON CONFLICT (key) DO UPDATE SET value_enc = EXCLUDED.value_enc, updated_at = NOW();
EOF

# 6. Copy config & Start
cp template.conf .conf
cabal run server > server_output.log 2>&1 &
python3 monitor_server.py > dashboard.log 2>&1 &

# 7. Verify
curl http://127.0.0.1:8080/api/up
\`\`\`

**Health:**
- Server: curl http://127.0.0.1:8080/api/up
- DB: pg_isready -h 127.0.0.1 -p 5433
- Redis: redis-cli -p 6379 ping

**Stop:**
\`\`\`bash
kill -TERM $(pgrep -f "cabal run server") 2>/dev/null; sleep 5
kill -TERM $(pgrep -f "process-compose") 2>/dev/null; sleep 3
pkill -KILL -f "postgres|redis-server" 2>/dev/null || true
\`\`\`

**Fix:**
- Missing config → Insert 11 configs (step 5)
- Migration error → just cldb && just kill-ports && just run-shell
- Port conflict → just kill-ports

**Seed Data:**
\`\`\`sql
-- merchant_account (LSP prefix)
INSERT INTO merchant_account (id, program_type, name, merchant_id, industry, extensible_data, status, created_at, updated_at)
VALUES ('LSP' || gen_random_uuid()::text, 'DEFAULT', 'Test Merchant', 'test_merchant_001', 'EDUCATION',
encode('{"contactPerson":"Admin"}'::bytea, 'base64'), 'CREATED', NOW(), NOW()) ON CONFLICT DO NOTHING;

-- lender (LND prefix)
INSERT INTO lender (id, primary_id, name, org_id, payment_method, lender_type, status, created_at, updated_at)
VALUES ('LND' || gen_random_uuid()::text, 'MOCK_LENDER', 'Mock Lender', 'MOCK_LENDER_ORG',
'MOCK_LENDER_LSP', 'JUSPAY', 'TESTING', NOW(), NOW()) ON CONFLICT DO NOTHING;

-- api_key_set (AKS prefix, plain text)
INSERT INTO api_key_set (id, api_key, org_id, created_at, updated_at)
VALUES ('AKS' || gen_random_uuid()::text, 'test_key_' || floor(random() * 100000)::text,
'test_merchant_001', NOW(), NOW()) ON CONFLICT DO NOTHING;

-- product_flow_implementation (PFI prefix, plain text)
INSERT INTO product_flow_implementation (id, merchant_id, product_id, lender_id, api_name, implementation_code, version, origin, created_at, updated_at)
VALUES ('PFI' || gen_random_uuid()::text, 'test_merchant_001', 'DEFAULT_PRODUCT', NULL,
'VERIFY_AUTH', 'CONSUMER_CREDIT', 'V1', 'ALL_SYSTEMS', NOW(), NOW()) ON CONFLICT DO NOTHING;
\`\`\`

**Access:**
- Server: http://127.0.0.1:8080
- Dashboard: http://127.0.0.1:7002

## Deterministic Execution (Flash Mode)

GLM 4.7 Flash is optimized for speed. Keep structured output minimal but complete:

\`\`\`json
{
  "operation": "startup|shutdown",
  "status": "success|failure",
  "services": {
    "postgresql": { "status": "running|stopped", "health": "healthy|unhealthy" },
    "redis": { "status": "running|stopped", "health": "healthy|unhealthy" },
    "euler_lsp": { "status": "running|stopped", "health": "healthy|unhealthy" },
    "dashboard": { "status": "running|stopped", "health": "healthy|unhealthy" }
  },
  "retry_count": 0,
  "next_action": "continue|retry|rollback|escalate"
}
\`\`\`

**Checkpoint:** Save to .agentic-loop/checkpoints/credit-server-{timestamp}.json after each phase.

**Retry:** Max 2 retries per phase, 500ms-1s backoff.

**Circuit Breaker:** Total failures >= 5 → escalate.

${todoDiscipline}

**Rules:** flake.nix first (disable 4), build must succeed, 11 configs, health checks, checkpoint saved, JSON output.`

  if (!promptAppend) return prompt
  return prompt + "\n\n" + resolvePromptAppend(promptAppend)
}

function buildGlm47FlashTodoDisciplineSection(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `Track: task_create -> task_update(in_progress) -> task_update(completed)`
  }

  return `Track: todowrite -> in_progress -> completed`
}
