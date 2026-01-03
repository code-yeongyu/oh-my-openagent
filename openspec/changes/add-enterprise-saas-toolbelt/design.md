## Context

Enterprise engineering teams (50-500 engineers) need a unified AI-powered interface for their daily workflows. Current pain points:

1. **Tool Fragmentation**: Engineers switch between 10+ tools daily
2. **Lost Knowledge**: Decisions in chat history, lost when sessions end
3. **No Organizational Context**: AI assistants repeat mistakes, unaware of policies
4. **Integration Overhead**: Each tool requires separate authentication, learning curve

### Stakeholders
- **Primary**: Senior engineers, tech leads, SREs
- **Secondary**: Engineering managers, DevOps teams
- **Tertiary**: New hires (onboarding), compliance teams

### Constraints
- Must work with existing oh-my-opencode architecture
- Enterprise tools require paid licenses (Datadog, Jira, AWS)
- Knowledge must be auditable for compliance
- Context window limits (200K tokens max)

## Goals / Non-Goals

### Goals
- Unified AI interface for 80% of engineering daily tasks
- Knowledge governance with Git-like auditability
- MCP-first integration (prefer existing servers)
- Progressive disclosure architecture for context efficiency
- Enterprise-grade security (SSO, RBAC, audit logs)

### Non-Goals
- Replace underlying tools (just integrate them)
- Support non-engineering workflows (sales, marketing)
- Build custom UIs (CLI/agent-only initially)
- Real-time collaboration features (Phase 2+)

## Architecture Decisions

### Decision 1: Knowledge as Immutable Commits
**What**: Store organizational knowledge as append-only commits with constraint validation
**Why**: 
- Auditability for compliance
- Conflict detection via constraint DSL
- Rollback capability
- Familiar Git-like mental model

**Alternatives Considered**:
- Mutable database: Simpler but no audit trail
- Event sourcing: Overkill for knowledge size
- Wiki-style: No constraint validation

### Decision 2: MCP-First Integration
**What**: Use existing MCP servers where available, build only for critical gaps
**Why**:
- 400+ servers already available
- Community maintenance burden shared
- Standardized protocol reduces complexity

**Alternatives Considered**:
- Direct API integration: More control but 10x maintenance
- Custom protocol: No ecosystem benefit

### Decision 3: Progressive Disclosure Architecture
**What**: 3-level loading: metadata (always) → instructions (triggered) → resources (on-demand)
**Why**:
- Context window is limited (200K tokens)
- Knowledge manifest ~2K tokens always loaded
- Full policies only when triggered by keywords

**Alternatives Considered**:
- Load everything: Context overflow
- On-demand only: Misses relevant policies
- Summarization: Loses precision

### Decision 4: Layer Hierarchy (Company → Org → Project)
**What**: Knowledge organized in hierarchical layers with promotion rules
**Why**:
- Matches org structure
- Local autonomy with global guardrails
- Clear ownership and escalation

**Alternatives Considered**:
- Flat structure: No inheritance
- Tag-based: Too flexible, hard to govern

### Decision 5: Constraint-Based Conflict Detection
**What**: DSL for machine-checkable rules (technology bans, required patterns)
**Why**:
- Automated enforcement
- Clear violation messages
- Composable rules

**DSL Example**:
```yaml
constraint:
  type: technology_ban
  target: moment.js
  severity: block
  message: "Use date-fns instead per ADR-042"
```

## Risks / Trade-offs

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| MCP servers abandoned | HIGH | MEDIUM | Fork critical servers, contribute upstream |
| Context window overflow | HIGH | LOW | Strict token budgets, progressive disclosure |
| Enterprise auth complexity | MEDIUM | HIGH | Standardized OAuth flow, clear setup docs |
| Knowledge adoption | MEDIUM | MEDIUM | Start with high-value ADRs, gradual rollout |
| API breaking changes | LOW | MEDIUM | Version pinning, automated testing |

### Trade-offs Accepted
- **Complexity vs Completeness**: 16 skills is ambitious; may ship fewer initially
- **Official vs Community MCPs**: Some community servers are better maintained
- **Build vs Buy**: Building Honeycomb/Snyk MCPs adds 4 weeks

## Migration Plan

### Phase 0 (Foundation)
1. Create feature directories
2. Implement knowledge types and client
3. Add Mem0 adapter
4. Create /knowledge skill
5. Add knowledge-monitor hook
6. Test with synthetic knowledge

### Rollback Plan
- All changes are additive
- Feature flags for each capability
- Knowledge is immutable (can't corrupt existing)
- MCP configs are declarative (easy revert)

## Open Questions

1. **Knowledge Sync Frequency**: Real-time events vs polling? (Recommend: events for online, poll for batch)
2. **Multi-Repo Support**: How to handle knowledge across repos? (Recommend: federation in Phase 2)
3. **Offline Mode**: Cache knowledge locally? (Recommend: yes, with staleness indicator)
4. **Approval Workflow**: Who approves BLOCK-level knowledge? (Recommend: org-level owners)
5. **MCP Rate Limits**: How to handle enterprise API limits? (Recommend: token bucket with backoff)
