import type { BuiltinSkill } from "../types"

export const DELIVERABLE_WRITING_SKILL_NAME = "deliverable-writing"

export const DELIVERABLE_WRITING_SKILL_DESCRIPTION =
  "EU project deliverable writing expertise: deliverable types (R/DEM/DEC/DATA/DMP/ETHICS), dissemination levels, document structure, reporting periods, KPI tracking, risk registers, D&E plans, periodic vs final reports, and amendment procedures. Triggers: 'deliverable', 'EU report', 'periodic report', 'DMP', 'dissemination plan', 'work package report'."

export const deliverableWritingSkill: BuiltinSkill = {
  name: DELIVERABLE_WRITING_SKILL_NAME,
  description: DELIVERABLE_WRITING_SKILL_DESCRIPTION,
  template: `# EU Deliverable Writing — Expert Reference

## DELIVERABLE TYPES

| Code | Type | Description | Examples |
|------|------|-------------|----------|
| **R** | Report | Document, publication | Technical report, survey, white paper |
| **DEM** | Demonstrator | Pilot, prototype, plan, design | Software demo, hardware prototype |
| **DEC** | Websites, Patent Filing, Press, Videos | Dissemination materials | Project website, press release, video |
| **DATA** | Data sets, Microdata | Research data outputs | Datasets, databases, ontologies |
| **DMP** | Data Management Plan | Data governance | FAIR data plan, ORDP compliance |
| **ETHICS** | Ethics Requirements | Ethics deliverables | Informed consent forms, ethics board approval, POPD |
| **OTHER** | Other | Anything not above | Software, training materials, standards |

## DISSEMINATION LEVELS

| Code | Level | Description |
|------|-------|-------------|
| **PU** | Public | Fully open, publishable on project website and EC portal |
| **SEN** | Sensitive | Restricted to consortium + EC (specify reason: commercial, security, privacy) |
| **EU-CL** | EU Classified | Subject to EU security classification (RESTREINT UE/EU RESTRICTED or above) |

**Default**: PU (Public) unless justified. Evaluators prefer open deliverables.

## DELIVERABLE DOCUMENT STRUCTURE

### Standard Template

\`\`\`
Cover Page
  - Project acronym, grant number, call identifier
  - Deliverable number (D[WP].[N]), title
  - Due date (contractual) vs submission date (actual)
  - Work package, task(s)
  - Lead beneficiary, contributing partners
  - Type (R/DEM/DEC/DATA/DMP/ETHICS/OTHER)
  - Dissemination level (PU/SEN/EU-CL)
  - Version, status (Draft/Final)

Document History
  - Version table: version, date, author, changes

Table of Contents

Executive Summary (1-2 pages)
  - Purpose, scope, main findings/outcomes
  - Relationship to project objectives

1. Introduction
  - Deliverable context within the project
  - Link to WP/task objectives
  - Relation to other deliverables (dependencies)

2-N. Main Content Sections
  - Technical content organized by topic
  - Methodology, results, analysis
  - Figures, tables with captions and references

N+1. Conclusions & Next Steps
  - Summary of achievements
  - Deviations from Description of Action (DoA)
  - Impact on subsequent work packages/deliverables

References

Annexes (if applicable)
  - Supporting data, detailed tables, questionnaires
\`\`\`

### Cover Page Essentials
- **Grant Agreement Number**: Always include (e.g., 101000123)
- **Funding acknowledgment**: "This project has received funding from the European Union's Horizon Europe research and innovation programme under grant agreement No [NUMBER]"
- **Disclaimer**: "The information and views set out in this document are those of the author(s) and do not necessarily reflect the official opinion of the European Union."

## REPORTING PERIODS

### Periodic Reports
| Component | Content | Frequency |
|-----------|---------|-----------|
| **Technical Report** | Progress per WP, deviation explanations, updated Gantt | Every 18 months (typical) |
| **Financial Statement** | Costs per beneficiary, person-months used | Same as technical |
| **Publishable Summary** | Non-confidential overview for public | Same as technical |

### Final Report
| Component | Content |
|-----------|---------|
| **Final Technical Report** | Comprehensive results, achievement of objectives |
| **Final Financial Statement** | Cumulative costs, final cost claim |
| **Final Publishable Summary** | Project outcomes for general public |
| **PLAN for D&E of Results** | Updated exploitation and dissemination plan |

### Reporting Tips
- **Deviations**: Always explain and justify. Link to amendment if applicable
- **Person-months**: Track actual vs planned. Significant deviations require explanation
- **Deliverables**: List status (submitted/pending/delayed) with justification for delays
- **Milestones**: Report achievement status with evidence

## KPI TRACKING

### Common KPI Categories

| Category | Example KPIs | Measurement |
|----------|-------------|-------------|
| **Publications** | # journal papers, # conference papers | Count + citation metrics |
| **Dissemination** | # events, # attendees, media coverage | Count + reach estimates |
| **Exploitation** | # patents, # licenses, # spin-offs | Count + commercial impact |
| **Training** | # researchers trained, # workshops | Count + satisfaction scores |
| **Data** | # datasets published, FAIR compliance | Count + quality assessment |
| **Software** | # tools released, # downloads, # contributors | Count + adoption metrics |
| **Societal** | Policy impact, public engagement | Qualitative + quantitative |

### KPI Table Format
| KPI ID | Description | Target | Achieved (Period N) | Cumulative | Status |
|--------|-------------|--------|---------------------|------------|--------|
| KPI-1 | Journal publications | 10 | 3 | 5 | On track |
| KPI-2 | Open-source tools | 3 | 1 | 1 | Delayed |

## RISK REGISTER

### Standard Format
| Risk ID | Description | WP | Probability | Impact | Mitigation | Owner | Status |
|---------|-------------|-----|------------|--------|------------|-------|--------|
| R1 | Partner dropout | All | Low | High | Redistribute tasks, subcontract | Coordinator | Active |
| R2 | Technology not at expected TRL | WP3 | Medium | High | Alternative approach identified | WP3 Lead | Active |
| R3 | Dataset access restricted | WP2 | Medium | Medium | Synthetic data fallback | WP2 Lead | Monitoring |

### Probability/Impact Scale
- **Probability**: Low (< 25%), Medium (25-50%), High (> 50%)
- **Impact**: Low (minor delay), Medium (WP affected), High (project objectives at risk)
- **Update frequency**: Every reporting period, or when risk materializes

## DISSEMINATION & EXPLOITATION (D&E) PLAN

### Structure
1. **D&E Strategy**: Overall approach, target audiences, key messages
2. **Dissemination Activities**: Publications, conferences, workshops, media
3. **Exploitation Routes**: Commercialization, standardization, policy influence, open-source
4. **Target Audiences**: Scientific community, industry, policymakers, civil society
5. **Communication Channels**: Website, social media, newsletters, press
6. **IPR Management**: Background IP, foreground IP, access rights, licensing
7. **Timeline**: Activity schedule aligned with project milestones
8. **KPIs**: Measurable indicators for each activity type

### Key Stakeholder Categories
| Stakeholder | Interest | Engagement Method |
|------------|----------|------------------|
| Scientific community | Methods, results, datasets | Publications, conferences, workshops |
| Industry | Solutions, technology, partnerships | Demos, trade fairs, industry events |
| Policymakers | Evidence, recommendations | Policy briefs, consultations |
| Civil society | Impact, ethics, accessibility | Public events, media, education |
| EC / REA | Compliance, progress, impact | Reports, reviews, audits |

## AMENDMENT PROCEDURES

### When Amendments Are Needed
| Change | Amendment Type |
|--------|---------------|
| Budget transfer > 20% between cost categories | Amendment request |
| New beneficiary / partner withdrawal | Amendment request |
| Extension of project duration | Amendment request |
| Change of coordinator | Amendment request |
| Minor budget reallocation (< 20%) | Usually NO amendment needed |
| Deliverable delay (< 2 months) | Inform PO, usually no amendment |
| Change of key personnel | Notify PO, sometimes amendment |

### Amendment Request Process
1. Coordinator contacts Project Officer (PO) informally
2. PO confirms if formal amendment is needed
3. Coordinator submits amendment request via Funding & Tenders Portal
4. EC reviews (typically 30-60 days)
5. Amendment enters into force upon signature by both parties

## WRITING QUALITY CHECKLIST

Before submitting any EU deliverable, verify:
- [ ] Cover page complete with all required fields
- [ ] Document history table up to date
- [ ] EU funding acknowledgment and disclaimer present
- [ ] Executive summary is self-contained and concise
- [ ] All sections linked to DoA objectives
- [ ] Deviations from DoA explained and justified
- [ ] Figures/tables numbered, captioned, and referenced in text
- [ ] Abbreviations list included (if > 10 acronyms)
- [ ] References formatted consistently
- [ ] Partner contributions acknowledged
- [ ] Dissemination level appropriate and justified
- [ ] Quality reviewed by at least one other partner
- [ ] File naming convention: [Acronym]_D[WP].[N]_[Title]_v[Version].pdf`,
}
