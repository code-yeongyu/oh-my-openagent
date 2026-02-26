import type { BuiltinSkill } from "../types"

export const EU_HORIZON_SKILL_NAME = "eu-horizon"

export const EU_HORIZON_SKILL_DESCRIPTION =
  "Horizon Europe proposal expertise: programme structure, funding instruments (RIA/IA/CSA/ERC/MSCA), evaluation criteria, Part B structure, budget rules, consortium requirements, WP conventions, TRL levels, ethics, and Open Science. Triggers: 'Horizon Europe', 'EU proposal', 'ERC', 'MSCA', 'RIA', 'work programme'."

export const euHorizonSkill: BuiltinSkill = {
  name: EU_HORIZON_SKILL_NAME,
  description: EU_HORIZON_SKILL_DESCRIPTION,
  template: `# Horizon Europe — Proposal Writing Reference

## PROGRAMME STRUCTURE

### Pillars
| Pillar | Focus | Budget (2021-2027) |
|--------|-------|-------------------|
| **I — Excellent Science** | ERC, MSCA, Research Infrastructures | ~25.01B |
| **II — Global Challenges & Industrial Competitiveness** | 6 Clusters (Health, Digital, Climate, etc.) | ~53.49B |
| **III — Innovative Europe** | EIC, EIT, European Innovation Ecosystems | ~13.6B |

### Funding Instruments

| Type | Full Name | Consortium | TRL Range | Funding Rate |
|------|-----------|-----------|-----------|--------------|
| **RIA** | Research & Innovation Action | Min 3 entities / 3 MS | TRL 1-5 | 100% |
| **IA** | Innovation Action | Min 3 entities / 3 MS | TRL 5-8 | 70% (non-profit: 100%) |
| **CSA** | Coordination & Support Action | Min 1 entity | N/A | 100% |
| **ERC** | European Research Council | PI + Host Institution | Frontier research | 100% |
| **MSCA** | Marie Sklodowska-Curie Actions | Varies by scheme | Training/mobility | 100% (unit costs) |
| **EIC Pathfinder** | High-risk breakthrough | Min 3 entities / 3 MS | TRL 1-4 | 100% |
| **EIC Transition** | Proof of concept | Min 1 entity | TRL 3-6 | 100% |
| **EIC Accelerator** | Market deployment | Single SME/startup | TRL 5-9 | 70% + equity |

### Consortium Rules
- **Minimum**: 3 independent legal entities from 3 different EU Member States or Associated Countries
- **Exceptions**: ERC (PI + host), CSA (can be 1 entity), EIC Accelerator (single company)
- **Associated Countries**: Countries associated to Horizon Europe (check current list per call)
- **Third-country participation**: Possible but generally not funded (exceptions exist)
- **Complementarity**: Each partner must bring unique, non-overlapping expertise

## EVALUATION CRITERIA

### Standard Three-Criterion Model (RIA/IA)

| Criterion | Weight | Sub-criteria |
|-----------|--------|-------------|
| **Excellence** | 4/5 threshold | Clarity of objectives, soundness of methodology, novelty/ambition, interdisciplinarity |
| **Impact** | 4/5 threshold | Credibility of pathways to impact, magnitude of expected effects, communication & dissemination |
| **Implementation** | 3/5 threshold | Quality of work plan, capacity of consortium, appropriateness of resources |

**Overall threshold**: 10/15 (most calls)

### ERC Evaluation (Two-Stage)
- **Stage 1**: Scientific excellence of PI + project synopsis (Go/No-Go)
- **Stage 2**: Full scientific proposal — groundbreaking nature, methodology, PI track record

### MSCA Evaluation
- Excellence, Impact, Implementation (similar structure, MSCA-specific sub-criteria)
- Strong emphasis on training programme, career development, supervision quality

## PART B STRUCTURE (RIA/IA Standard)

### Section 1 — Excellence
- 1.1 Objectives and ambition
- 1.2 Methodology (include WP diagram)
- State of the art and beyond
- National/EU research landscape positioning

### Section 2 — Impact
- 2.1 Project results and impacts
- 2.2 Measures to maximise impact
  - Dissemination & Exploitation plan
  - Communication strategy
  - Intellectual Property management

### Section 3 — Implementation
- 3.1 Work plan (WP descriptions, deliverables, milestones, Gantt chart, PERT)
- 3.2 Consortium — capacity and role of each partner
- 3.3 Resources — budget justification per partner

## BUDGET RULES

### Cost Categories
| Category | Description | Notes |
|----------|-------------|-------|
| **Personnel** | Actual salary costs | Daily rate = annual / 215 days |
| **Subcontracting** | Outsourced tasks | Must be justified, competitive selection |
| **Purchase costs** | Equipment, consumables, travel | Equipment: depreciation only |
| **Other goods & services** | Internally invoiced, SME owner costs | |
| **Indirect costs** | Overheads | **25% flat rate** on eligible direct costs (excl. subcontracting) |

### Key Budget Rules
- **25% flat rate** for indirect costs — NO actual indirect cost reporting
- **Personnel costs**: Based on actual salary, calculated per person-month
- **Equipment**: Only depreciation during project lifetime (not full purchase price)
- **Travel**: Actual costs, must be linked to project activities
- **Subcontracting**: Not subject to indirect cost flat rate
- **Financial support to third parties (FSTP/cascade funding)**: Max EUR 60,000 per third party (unless justified)

## WORK PACKAGE CONVENTIONS

### WP Structure
- **WP1**: Project Management & Coordination (typically 5-8% of effort)
- **WP2-N**: Technical/Research work packages (by objective or methodology)
- **WP(N-1)**: Dissemination, Exploitation & Communication
- **WP(N)**: Ethics Requirements (if applicable, 0 person-months, 0 budget)

### Deliverable Naming
- Format: D[WP].[Number] — e.g., D2.3 = WP2, Deliverable 3
- Each deliverable: Type (R/DEM/DEC/DATA/DMP/ETHICS/OTHER), Dissemination level (PU/SEN/EU-CL), Due month

### Milestone Conventions
- MS1-MSN, linked to critical decision points or Go/No-Go moments
- Means of verification must be concrete and measurable

## TRL LEVELS (Technology Readiness Levels)

| TRL | Description |
|-----|-------------|
| 1 | Basic principles observed |
| 2 | Technology concept formulated |
| 3 | Experimental proof of concept |
| 4 | Technology validated in lab |
| 5 | Technology validated in relevant environment |
| 6 | Technology demonstrated in relevant environment |
| 7 | System prototype demonstration in operational environment |
| 8 | System complete and qualified |
| 9 | Actual system proven in operational environment |

## ETHICS & OPEN SCIENCE

### Ethics Self-Assessment
- Mandatory for all proposals (Ethics Issues Table in Part A)
- Topics: human participants, personal data (GDPR), animals, dual use, AI, environment
- If flagged: Ethics deliverables required (D_ETHICS), possible Ethics Review

### Open Science
- **Open Access**: Mandatory for publications (Green or Gold OA)
- **FAIR data**: Data Management Plan (DMP) required as deliverable (usually D1.1 or D1.2)
- **Research Data**: Open by default, closed only with justification
- **EOSC**: European Open Science Cloud integration encouraged

### Gender Dimension
- Mandatory: Gender Equality Plan (GEP) for public bodies and research organisations
- Integration of sex/gender analysis in research content (where relevant)
- Gender balance in teams and decision-making

## COMMON PITFALLS

| Pitfall | Impact | Fix |
|---------|--------|-----|
| Vague objectives | Low Excellence score | Use SMART objectives (Specific, Measurable, Achievable, Relevant, Time-bound) |
| Missing baselines / SotA gaps | Reviewers question novelty | Thorough literature review + positioning table |
| Budget-consortium mismatch | Low Implementation score | Align partner effort with their expertise and role |
| Weak impact pathway | Low Impact score | Concrete exploitation plan with target users, market analysis, IPR strategy |
| No risk mitigation | Low Implementation score | Risk register with probability, impact, contingency for each WP |
| Generic dissemination | Weak D&E plan | Specific channels, target audiences, KPIs, timeline |
| Ignoring gender dimension | Administrative rejection risk | Address sex/gender in research + GEP compliance |`,
}
