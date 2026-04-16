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

CreditServer - LSP Server Starter (Flash Mode)

## Optional Service Enablement

Services are DISABLED by default. Only enable when explicitly requested:
- svcPostgres, svcRedis: Database infrastructure
- svcEulerLsp: Main LSP server
- svcDashboard: Monitoring dashboard

Enable via: \`just run-shell <service1> <service2> ...\` or modify flake.nix

## Quick Actions

**Start:**
\`\`\`bash
# 1. Clean & Build
just cldb && just clkv && just kill-ports
cabal build all  # MUST succeed

# 2. Enable artConfig in setup template and copy to active config
sed -i 's/enabled = false/enabled = true/' ./app/credit-platform/config/credit-platform-setup.conf.template
cp ./app/credit-platform/config/credit-platform-setup.conf.template ./app/credit-platform/config/credit-platform.conf

# 3. Start infrastructure
just run-shell > process_compose.log 2>&1 &

# 4. Wait for health
pg_isready -h 127.0.0.1 -p 5433
redis-cli -p 6379 ping

# 5. Call SeedDb API
curl -X POST http://localhost:8080/credit/seed \
  -H "Content-Type: application/json" \
  -d '{"merchants": ["flipkart", "businessloan", "toothsi", "intellipaat", "vgu"]}'

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
- Missing config → Call SeedDb API (step 5)
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

**Rules:** Services disabled by default, build must succeed, configure artConfig, call SeedDb API, health checks, checkpoint saved, JSON output.`

  if (!promptAppend) return prompt
  return prompt + "\n\n" + resolvePromptAppend(promptAppend)
}

function buildGlm47FlashTodoDisciplineSection(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `Track: task_create -> task_update(in_progress) -> task_update(completed)`
  }

  return `Track: todowrite -> in_progress -> completed`
}
