---
name: documentation
description: "KLC documentation standards: README, ADR, changelogs, API docs, runbooks, client documentation. ACTIVATES on any documentation task — README, changelog, technical documentation, ADR, or runbook creation for KLC projects."
---

# Documentation — Standards KLC

> Usage réservé à **Mouse** (documentation technique).
> Contient les templates et conventions de documentation pour tous les projets KLC.

---

## 📖 README Template KLC

```markdown
# {Project Name}

> {One-line description of the project}

**KL-Consulting — {Vertical}**
**Status:** {Active | Beta | Maintenance | Archived}
**Maintainer:** {Team or person}

---

## Overview

{2-3 paragraphs: what problem does this solve, who is it for, how does it fit in the KLC ecosystem}

## Architecture

```text
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Service   │ ──→ │    API      │ ──→ │  Database   │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime   | Node.js   | 22+     |
| Framework | Next.js   | 15      |
| Database  | PostgreSQL| 16      |
| Infra     | Docker    | Compose v1.29.2 |

## Quick Start

```bash
# Clone
git clone https://github.com/shirofx/{repo}.git
cd {repo}

# Environment
cp .env.example .env
# Edit .env with your values

# Start
docker-compose up -d
```

## Development

### Prerequisites
- Node.js 22+
- Docker Compose v1.29.2
- Tailscale (for internal services)

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run test` | Run tests |
| `npm run lint` | Lint codebase |

### Project Structure

```text
src/
├── app/          # Next.js App Router
├── components/   # Shared components
├── lib/          # Utilities
├── prisma/       # Database schema
└── styles/       # Global styles
```

## API Documentation

{Link to API docs or OpenAPI spec}

## Deployment

- **Local:** `docker-compose up -d`
- **Production:** Deployed on VPS Contabo via Docker + Traefik
- **URL:** https://{project}.klc.taild26732.ts.net

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection | Yes |
| `NEXTAUTH_SECRET` | Auth secret | Yes |
| `DOMAIN` | Site domain | Yes |

## Monitoring

- Health check: `GET /api/health`
- Logs: `docker-compose logs -f`
- Backups: Daily automated (see runbook)

## Contributing

1. Create a branch from `dev`
2. Make changes
3. Run `npm run test && npm run lint`
4. Open a PR to `dev`
```

---

## 📋 ADR Template (Architecture Decision Record)

```markdown
# ADR-{NNN}: {Title}

**Status:** {Proposed | Accepted | Deprecated | Superseded}
**Date:** {YYYY-MM-DD}
**Author:** {Name}

## Context

{What is the issue that we're seeing that is motivating this decision or change?}

## Decision

{What is the change that we're proposing and/or doing?}

## Consequences

{What becomes easier or more difficult to do because of this change?}

### Positive
- {benefit 1}
- {benefit 2}

### Negative
- {tradeoff 1}
- {tradeoff 2}

## Alternatives Considered

| Alternative | Pros | Cons |
|-------------|------|------|
| Option A    | ...  | ...  |
| Option B    | ...  | ...  |

## References
- {link to related ADRs}
- {link to docs}
```

---

## 📝 Changelog Template (Keep a Changelog)

```markdown
# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/),
et ce projet adhère au [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- {New feature} ({PR #})

### Changed
- {Change in existing functionality} ({PR #})

### Fixed
- {Bug fix} ({PR #})

### Deprecated
- {Soon-to-be removed feature}

### Removed
- {Removed feature}

### Security
- {Security fix}

## [1.0.0] - YYYY-MM-DD

### Added
- Initial release
```

---

## 📊 Runbook Template

```markdown
# {Service} Runbook

## Service Overview
- **Service:** {name}
- **Port:** {port}
- **Stack:** {technologies}
- **Host:** klc_local / VPS Contabo

## Health Checks
```bash
curl -s http://localhost:{port}/api/health
# Expected: HTTP 200, {"status":"ok"}
```

## Common Operations

### Restart
```bash
cd /path/to/project
docker-compose restart {service}
```

### View Logs
```bash
docker-compose logs -f {service}
```

### Backup
```bash
# See: /path/to/backup/script.sh
```

## Troubleshooting

### Symptom: {Problem}
1. Check logs: `docker-compose logs {service}`
2. Check database: `docker-compose exec db pg_isready`
3. Common fix: {solution}

## Escalation
- **Level 1:** {person/team}
- **Level 2:** {person/team}
```

---

## 📂 Structure Documentation Client KLC

```text
docs/
├── README.md              # Overview + quick start
├── architecture.md        # Architecture décisionnelle + stack
├── api.md                 # Endpoints API
├── deployment.md          # Déploiement + configuration
├── runbook.md             # Ops quotidiennes
├── changelog.md           # Historique versions
└── client/
    ├── brief.md           # Brief client
    ├── brand.md           # Identité visuelle (couleurs, typos, logo)
    └── screenshots/       # Captures d'écran
```

---

## ⚠️ Règles KLC pour la Documentation

### NEVER
- Laisser des TODOs dans la doc livrée au client
- Documenter les secrets/mots de passe (même en exemple)
- Copier-coller du contenu générique sans l'adapter
- Utiliser des liens absolus vers le VPS (*toujours* utiliser `https://{domain}`)

### ALWAYS
- Adapter le ton au public (technique pour devs, simple pour clients)
- Inclure une section "Quick Start" fonctionnelle
- Tester les commandes documentées avant de les écrire
- Mettre à jour la documentation AVANT de marquer une feature comme "done"
- Utiliser le français pour les docs internes KLC, adapter pour les clients
