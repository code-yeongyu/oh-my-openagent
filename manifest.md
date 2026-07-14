# MaTrix — Manifeste de Projet

> Document de référence persistant. Toute nouvelle session DOIT lire ce fichier
> en premier pour se situer. Mis à jour à chaque décision majeure.

---

## 1. Identité du projet

**Nom** : MaTrix (Matrix Engine v0.1.0)
**Origine** : Fork du moteur `oh-my-opencode` v4.14.0 (rebadge `oh-my-openagent`)
**Objectif** : Vrai fork du moteur, pas un overlay
- Modifier le moteur OMO lui-même (orchestration, mémoire, routing, agents)
- Garder ce qui marche, ajuster ce qui doit l'être, recoder ce qui doit l'être
- Rebrander les agents dans l'univers Matrix (Morpheus = orchestrateur)
- Privé : repo `shirofx/MaTrix` (GitHub, privé)

**Rebranding principal** :
| OMO | MaTrix |
|-----|--------|
| Sisyphus (orchestrateur) | **Morpheus** |
| Sisyphus-Junior | **Neo** |
| Hephaestus | **Tank** |
| Prometheus | **Prometheus** (gardé, c'est un bon nom) |
| Oracle | **Oracle** (gardé) |
| Atlas | **Operator** |
| Explore | **Ghost** |
| Librarian | **Link** |
| Multimodal-Looker | **Analyst** |
| Metis | **Keymaker** |
| Momus | **AgentSmith** |

**Nouveaux agents Matrix** : Trinity (design), Cypher (copy), Sentinel (QA),
Mouse (docs), Dreamer (mémoire background), The Architect (auto-amélioration).

---

## 1.5. Accès repo Git (pour nouvelle session)

**Workspace KLC (canonique)** : `/home/shiro/MaTrix-test/` (clone SSH du repo — c'est ici qu'on travaille)
**Source OMO forké** : `/home/shiro/MaTrix-test/engine/` (3888 fichiers .ts)
**Server KLC** : `/home/shiro/MaTrix-test/` (clone SSH, déjà présent)

**Repo GitHub** : `shirofx/MaTrix` (privé)
**URL** : https://github.com/shirofx/MaTrix
**Branche** : `main`

**Token GitHub** : **NE PAS STOCKER EN CLAIR DANS CE FICHIER** — source de vérité = `KLC_Vault/`. Utiliser l'authentification **SSH** (`git@github.com:shirofx/MaTrix.git`) ou un token tiré du vault. (Ancien token en clair présent ici a été retiré le 2026-07-13 pour conformité KLC : Secrets jamais en clair dans le code.)

**Commandes utiles** :
```bash
# Cloner le repo ailleurs
git clone https://github.com/shirofx/MaTrix.git

# Configurer le remote
cd MaTrix
git remote set-url origin git@github.com:shirofx/MaTrix.git

# Push
git push origin main

# Pull
git pull origin main
```

**Workflow de reprise en nouvelle session** :
1. `cd /home/shiro/MaTrix-test`
2. `git pull origin main` (récupérer les derniers commits)
3. Lire `manifest.md` (ce fichier) en entier
4. Lire `ARCHITECTURE.md` (plan technique)
5. Lire `.omo/evidence/20260703-matrix-fork/` (3 fichiers d'evidence)
6. Vérifier l'état du worktree : `git status`
7. Pour tester : `cd /home/shiro/MaTrix-test` (workspace KLC)

**Scripts PowerShell utiles** :
- `Test-Path "G:\ProjetShiro\MaTrix\manifest.md"` → doit retourner True
- `git -C "G:\ProjetShiro\MaTrix" log --oneline -5` → derniers commits

---

## 1.6. Accès SSH au server KLC

**Host** : `shiro@klc` (Tailscale, `klc.taild26732.ts.net`)
**Auth** : clé SSH sans mot de passe (déjà dans `authorized_keys`)
**Home** : `/home/shiro/`
**Bun** : `/home/shiro/.local/bin/bun` (v1.3.14)
**OpenCode** : `/home/shiro/.hermes/node/bin/opencode` (v1.17.6)
**OpenCode cache** : `~/.hermes/node/lib/node_modules/`

**Workspace MaTrix sur KLC** : `/home/shiro/MaTrix-test/`
**Providers LLM** : `~/.secrets/zen-key-1`, etc. (5 clés, chmod 600)
**Plugins installés** : `oh-my-openagent@4.9.2` (réinstallé), symlink `matrix-engine`
**Config OpenCode** : `~/.config/opencode/opencode.json` (matrix-engine + oh-my-openagent)

**Commandes KLC utiles** :
```bash
# Sync repo
ssh shiro@klc "cd /home/shiro/MaTrix-test && git pull origin main"

# Build
ssh shiro@klc "cd /home/shiro/MaTrix-test/engine && bun run build"

# Typecheck
ssh shiro@klc "cd /home/shiro/MaTrix-test/engine && bun run typecheck"

# Tests
ssh shiro@klc "cd /home/shiro/MaTrix-test/engine && bun test"

# Run opencode avec plugin MaTrix
ssh shiro@klc "cd /home/shiro/MaTrix-test && opencode run 'hello'"

# Test isolated XDG sandbox
ssh shiro@klc "cd /tmp/qa-home && export XDG_DATA_HOME=/tmp/qa-data XDG_CONFIG_HOME=/tmp/qa-config XDG_CACHE_HOME=/tmp/qa-cache XDG_STATE_HOME=/tmp/qa-state HOME=/tmp/qa-home && opencode agent list"
```

**⚠️ Fichiers à NE PAS toucher sur KLC** :
- `~/.config/opencode/opencode.json` (contient les plugins production)
- `~/.local/share/opencode/opencode.db` (sessions actives)

**Plugin loading sur KLC** : utiliser **chemin absolu** dans la config :
```json
{
  "plugin": ["/home/shiro/MaTrix-test/engine/dist/index.js"]
}
```

---

## 1.7 État actuel du projet (2026-07-13, post-redémarrage OpenCode)

**Roster agents** : 16 agents Matrix actifs (`engine/packages/omo-opencode/src/agents/builtin-agents.ts`) : morpheus, tank, oracle, link, ghost, analyst, keymaker, agent-smith, operator, neo, trinity, cypher, sentinel, mouse, dreamer, architect.

**Magic Context** : ✅ **TERMINÉ** (portage natif, opt-in). Fonctionnel + vérifié par QA réelle OpenCode (voir §17.6). Activation via bloc `magic_context` dans la config (`mock` = zéro dépendance, ou `openai-compatible` pour embedding sémantique via KLC Router). `I0`/`J0b` différés.

**Orchestration** : ✅ vérifiée end-to-end (boot sandbox + délégation ghost/oracle exit 0). 100 tests pass sur le périmètre touché ; 2 fail préexistants (rename `matrix-engine` + sémantique team-mode `task`), non liés à nos changements.

**Dashboard Mission Control** : serveur Node (`:4321`), onglets Overview/Agents/Costs/Health/Providers/Schedule/Board, profils Daily/Balanced/Performance. Dernières màj : onglet **Agent Swarm** (proxy `/api/swarm`), proxy **`/api/agent`** (agent solo + outils KLC Router). Auto-amélioration : boucle L1→L2 live + dispatch auto des tâches de fix.

**Git** : HEAD `64cf54b93` (locale), **4 commits non poussés** vs `origin/main`. WIP non commité : `dashboard/architect_state.json`, `dashboard/index.html`, `dashboard/server.ts` (onglet Swarm + proxy `/api/agent`). → à committer/pousser en reprise.

**Sécurité** : token GitHub retiré de ce fichier (était en clair) le 2026-07-13. Secrets uniquement dans `KLC_Vault/`.

---

## 2. Décisions architecturales

### 2.1 Fork modulaire progressif (3 phases)

**Pas tout recoder d'un coup.** Approche par phases :

| Phase | Description | Statut |
|-------|-------------|--------|
| **1** | Cloner source OMO → renommer agents (Morpheus etc.) → ajouter agents Matrix nativement | ✅ |
| **2** | Intégrer routing, mémoire, profils, cost tracking **dans le moteur** (pas en hooks) | ✅ |
| **3** | MoA natif, auto-amélioration 3 niveaux, Kanban natif | ✅ |
| **4** | Câblage runtime + tests unitaires + QA | ✅ |
| **5** | Fix 4 agents + plugin id + absolute path loading | ✅ |

### 2.2 Univers Matrix comme naming
- Sisyphus (OMO) → **Morpheus** (Matrix) : c'est le parallèle le plus naturel (le capitaine du Nebuchadnezzar)
- Pas de promesses marketing : on garde les noms qui marchent (Oracle, Prometheus)

### 2.3 Garde-fous auto-amélioration (3 niveaux)

**Niveau 1 — Code métier** : patterns détectés, règles ajoutées au vault
**Niveau 2 — Comportement agents** : prompts ajustés dynamiquement
**Niveau 3 — Le moteur lui-même** : modifs du source OMO, avec :
- **Backup git obligatoire** avant toute modif
- **Rollback auto** si tests échouent ou si régression télémétrie
- **Approbation humaine OBLIGATOIRE** pour les changements majeurs
  (nouvel agent, modif d'orchestration, etc.)

Le système propose, l'humain dispose. La souveraineté humaine n'est jamais bypassée.

### 2.4 Séparation dev / QA

- **Dev** : historiquement ton PC Windows (`G:\ProjetShiro\MaTrix\`) — désormais le travail se fait directement sur le **server KLC** (`/home/shiro/MaTrix-test/`).
- **QA** : server KLC Ubuntu, repo `/home/shiro/MaTrix-test/`
- Tu pushes depuis KLC, ou depuis dev puis KLC pull et build
- KLC est un environnement propre (Linux), pas de pollution Windows

**Pourquoi c'est important** : KLC a révélé 2 bugs (paths hardcodés Windows,
plugin id) que les tests unitaires ne pouvaient pas voir.

### 2.5 Watchdog anti-blocage

Tout subagent doit émettre un **heartbeat** (fichier `.matrix/heartbeats/<task-id>.txt`
mis à jour toutes les 60s). Si pas de heartbeat depuis > 2N secondes :
- Log dans `.matrix/logs/timeout-YYYY-MM-DD.log`
- Notification Morpheus
- Plan B (reformuler, réassigner, escalader)

Le système ne peut JAMAIS rester silencieux en bloquant. Un OS qui s'auto-
améliore doit d'abord savoir s'auto-surveiller.

---

## 3. Ce qui existe (Matrice-KL v1 → MaTrix)

### 3.1 Le moteur forké

| Composant | Statut | Notes |
|-----------|--------|-------|
| Source OMO v4.14.0 forké | ✅ | 3888 fichiers .ts, 0 erreur TypeScript |
| 10 agents OMO renommés | ✅ | Sisyphus→Morpheus, etc. |
| 6 agents Matrix créés nativement | ✅ | Trinity, Cypher, Sentinel, Mouse, Dreamer, Architect |
| Tests unitaires | ✅ | 30 tests, portables Linux/Windows |
| Bundle build | ✅ | 5.48 MB, 1903 modules, target=browser |
| **Plugin se charge dans OpenCode** | ✅ | **12 agents, Morpheus default** (via absolute path) |
| **QA evidence** | ✅ | `.omo/evidence/20260703-matrix-fork/` (3 fichiers) |

### 3.2 Les features natives

| Module | Statut | Description |
|--------|--------|-------------|
| `shared/cost-tracker.ts` | ✅ | Pricing 16 modèles, JSONL log, dashboard HTML |
| `config/profiles.ts` | ✅ | 7 profils builtin + validation + defaults |
| `features/moa/` | ✅ | Mixture of Agents : 2-3 LLMs en parallèle + agrégation |
| `features/self-improvement/` | ✅ | L1-L2 (patterns) + L3 (moteur se modifie) |
| `features/kanban/` | ✅ | 7 états, 4 priorités, dashboard auto-refresh |

### 3.3 Les 7 profils

| Profil | Usage | Agents principaux |
|--------|-------|-------------------|
| **custom** | Défaut, configurable | Tous |
| **saas** | App SaaS | Morpheus, Tank, Trinity, Sentinel, Architect |
| **web-cms** | WordPress, Drupal | Morpheus, Keymaker, Trinity, Operator |
| **mobile** | React Native, Expo | Morpheus, Tank, Trinity, Sentinel |
| **intranet** | Outillage interne | Morpheus, Operator, AgentSmith, Mouse |
| **research** | Veille, R&D | Morpheus, Ghost, Link, Analyst, Cypher |
| **business** | Stratégie | Morpheus, Oracle, Operator, Architect |

---

## 4. Ce qui reste à faire (Phases 6+)

### 4.1 Phase 6 — Test end-to-end sur KLC
- Lancer `opencode run "hello"` → Morpheus doit répondre
- Tester `/moa` et `/learn` (commandes slash)
- Vérifier le Kanban sur un vrai projet
- Coût tracking live

### 4.2 Phase 7 — Documentation install
- README utilisateur
- Procédure d'install pour KLC et Windows
- Config absolute path documentée
- Migration depuis OMO vers MaTrix

### 4.3 Phase 8 — Auto-amélioration phase pilote
- Implémenter le backup git automatique
- Implémenter le rollback si tests échouent
- Première proposition d'évolution majeure → approbation humaine
- Dashboard temps réel de l'auto-amélioration

### 4.4 Phase 9+ — Features avancées
- Open Design integration pour Trinity
- Subagent-watchdog (skill)
- 6 MCPs (WordPress, Drupal, Notion, RSS, Open Design)
- Tests d'intégration end-to-end
- Release v1.0

---

## 5. L'existant à respecter (garde-fous)

- **Sisyphus/OMO reste production** : jamais désactiver OMO avant que MaTrix soit mature (3+ mois, vrais projets validés)
- **Backup avant auto-amélioration** : obligatoire (git snapshot avec tag)
- **Approbation humaine pour majeur** : non-négociable
- **Heartbeat subagents** : non-négociable
- **Tests OMO** : `bun test` ne suffit pas, il faut aussi QA OpenCode réel (KLC)

---

## 6. Le manifeste contient maintenant

- Section 1 : Identité projet
- Section 1.5 : Accès repo Git (token, URL, remote, scripts)
- Section 1.6 : Accès SSH KLC
- Section 2 : Décisions architecturales (4 sous-sections)
- Section 3 : Ce qui existe (3 sous-sections)
- Section 4 : Ce qui reste (4 sous-sections)
- Section 5 : Garde-fous
- Section 6 : Plan du document
- Section 7 : Catégories skills/spawning
- Section 8 : Conventions
- Section 9 : Décisions de design détaillées
- Section 10 : Contraintes
- Section 11 : Reprise session marathon + guide de reprise Phase 5.2+

---

## 7. Catégories & spawning

### 7.1 Catégories d'agents
- **primary** : agents principaux routables directement (Morpheus, build, plan)
- **subagent** : agents invocables via `task()` (tous les autres)

### 7.2 Spawning
- `task(description, prompt, agent)` : délègue à un sub-agent
- `call_omo_agent(agent_name, prompt)` : appel direct
- Background tasks : max 5 concurrents par `${providerID}/${modelID}`
- Chaque appel crée une session indépendante, isolée, jetable

### 7.3 Watchdog anti-blocage (NON-NÉGOCIABLE)

Tout subagent doit émettre un **heartbeat** toutes les 60s. Si pas de
heartbeat depuis > 120s, le subagent est marqué comme bloqué.

**Implémentation prévue** :
- 2 hooks : `morpheus/heartbeat-monitor` + `morpheus/subagent-timeout`
- 1 skill : `subagent-watchdog` (dispatch intelligent)
- Détection par fichier `.matrix/heartbeats/<task-id>.txt` mis à jour

**Pourquoi c'est non-négociable** : un OS qui s'auto-améliore doit d'abord
savoir s'auto-surveiller. C'est exactement ce qui s'est passé avec le
subagent `deep` qui a timeout 21m45s sans progression réelle. Sans watchdog,
on ne sait pas distinguer "ça travaille" de "c'est bloqué".

**Incidents passés** : 4 timeouts OMO + subagent hooks/ (8+ min sans
progression) — leçon intégrée au manifeste.

---

## 8. Conventions

### 8.1 Code
- TypeScript strict mode
- Pas de `as any`, `@ts-ignore`, `@ts-expect-error`
- Factory pattern : `createXXX()` pour tous les tools/hooks/agents
- File naming : kebab-case
- Module structure : barrel `index.ts`, pas de catch-all
- Imports : relatifs dans un module, barrel entre modules
- Pas de path aliases `@/`

### 8.2 Config
- JSONC avec comments + trailing commas
- Zod v4 validation
- snake_case keys
- Schema autocomplete via `"$schema": "https://raw.githubusercontent.com/...oh-my-opencode.schema.json"`

### 8.3 Tests
- `bun test` pour les tests unitaires
- `opencode run --format json` pour les tests CLI
- QA OMO skill pour les tests d'intégration réels
- Pas d'AAA comments → given/when/then

### 8.4 Build
- `bun build` (ESM, target=browser par défaut)
- `tsc --emitDeclarationOnly` pour les `.d.ts`
- External : `zod` (seul)
- Pas de hashline sur les bundles
- Path aliases interdits dans `src/`

---

## 9. Décisions de design détaillées

### 9.1 Pourquoi Morpheus
Sisyphus = celui qui pousse le rocher sans fin, qui orchestre sans s'arrêter.
Morpheus = le capitaine du Nebuchadnezzar, qui coordonne les missions, délègue
à ses spécialistes. Même moteur, même obstination. Le parallèle le plus naturel.

### 9.2 Pourquoi garder Prometheus et Oracle
Les noms sont parfaits pour ce qu'ils font (plan stratégique / consultant
technique). Pas de raison de les renommer.

### 9.3 Pourquoi un fork et pas un overlay
Overlay (Matrix-KL v1) = zéro modification du moteur, juste des couches.
Limite : pas d'accès à l'état interne, dépend de l'API qui peut changer.
Fork = on contrôle tout, mais maintenance long-terme. C'est le trade-off.

### 9.4 Pourquoi 3 phases pour le moteur
Phase 1 = essentielle (rebrand et structure)
Phase 2 = importante (features natives)
Phase 3 = innovations (MoA, auto-amélioration, Kanban)

All-in-one = 3+ mois. Sprint = 2 semaines.

### 9.5 Pourquoi KLC pour le QA
Linux = environnement plus standard, isolé, toujours up
Tu peux travailler de n'importe où (Tailscale)
Le server joue le rôle de bac à sable de test réel

---

## 10. Contraintes

### 10.1 Contraintes techniques
- **Watchdog anti-blocage obligatoire** : aucun subagent silencieux, heartbeat +
  détection + lessons learned. **Incidents** : 4 timeouts OMO + subagent hooks/
  en cours depuis 8+ min. Pas de récidive.
- TypeScript strict
- Pas de commit secrets
- `bun test` n'est PAS un QA. Le QA c'est sur OpenCode réel.

### 10.2 Contraintes de design
- Rebranding Matrix pour les agents (univers narratif cohérent)
- Souveraineté humaine sur l'auto-amélioration (approbation obligatoire pour majeur)
- Backup git avant toute modif du moteur par l'auto-amélioration
- Pas de promesses marketing (AI slop) — focus sur le vrai travail

### 10.3 Contraintes d'usage
- MaTrix est privé (repo `shirofx/MaTrix`)
- Pas de publication npm
- Compatible avec OMO installé en parallèle (cohabitation KLC)

---

## 11. Reprise de session marathon + guide Phase 5.2+

### 11.1 Résumé de la session marathon (2026-07-03)

**6 phases complétées** :
- Phase 1 : Fork moteur OMO (16 agents Matrix) ✅
- Phase 2 : Cost tracking + 7 profils ✅
- Phase 3 : MoA + Self-improvement 3 niveaux + Kanban ✅
- Phase 4 : Câblage runtime + 30 tests ✅
- Phase 5.1 : 4 agents Matrix créés + plugin id fix ✅
- Phase 5.2 : Runtime plugin loading via absolute path ✅

**5 commits majeurs pushés** :
1. `cea80c7` evidence: QA proof plugin loader blocked (side-quest bun build)
2. `157f4cc` evidence: BREAKTHROUGH - MaTrix plugin loads via absolute path
3. `4f3a764` fix: remove matrix-debug logs after QA confirmed
4. `329216b` manifest: BREAKTHROUGH -12 agents, Morpheus default
5. (avant) 11 commits de Phase 1-5.1

**3 fichiers d'evidence** dans `.omo/evidence/20260703-matrix-fork/` :
- `README.md` : preuve que le bundle bun est incompatible Node
- `SUCCESS-PLUGIN-LOADS.md` : BREAKTHROUGH absolute path
- `CLEANUP-DEBUG-LOGS.md` : preuve que le retrait des logs ne casse rien

### 11.2 Découvertes clés

1. **Le fork du moteur est faisable** mais demande plusieurs jours de travail minutieux
2. **L'agent order ne survit pas** au `Agent.list()` d'OpenCode → sort shim nécessaire
3. **Le bundle `bun build` target=browser** marche très bien avec **chemin absolu**
4. **OpenCode résout les plugins** par nom npm OU par chemin absolu (PAS de symlink
   npm non publié)
5. **Tests unitaires ne suffisent pas** — le QA KLC a révélé 2 bugs que `bun test`
   ne pouvait pas voir

### 11.3 Configuration actuelle (2026-07-03)

**Sur ton PC (Windows)** :
- OMO installé (`oh-my-openagent`)
- MaTrix en worktree `G:\ProjetShiro\MaTrix-test` (source seulement, pas de plugin)
- Tu utilises Sisyphus/OMO par défaut

**Sur KLC (Ubuntu)** :
- OMO réinstallé (`oh-my-openagent@4.9.2`)
- Symlink `matrix-engine` dans `~/.hermes/node/lib/node_modules/`
- Repo `MaTrix-test` cloné et à jour
- Bundle 5.48 MB dans `engine/dist/`
- Config KLC actuelle : `plugin: ["matrix-engine", "oh-my-openagent"]`
  (matrix-engine est silencieusement ignoré, oh-my-openagent fonctionne)

### 11.4 Pour utiliser MaTrix sur KLC

**Modifier la config KLC** :
```bash
ssh shiro@klc
cat > ~/.config/opencode/opencode.json << 'EOF'
{
  "plugin": [
    "/home/shiro/MaTrix-test/engine/dist/index.js",
    "oh-my-openagent"
  ],
  "model": "zen-1/deepseek-v4-flash-free"
}
EOF
```

**Tester** :
```bash
ssh shiro@klc
opencode run "hello"           # Morpheus répond
opencode agent list            # 12 agents Matrix visibles
```

### 11.5 Pour la prochaine session

**Workflow recommandé** :
1. Lire `manifest.md` (ce fichier) en entier
2. Lire `ARCHITECTURE.md` (plan technique)
3. Lire `.omo/evidence/20260703-matrix-fork/` (3 fichiers)
4. `git log --oneline -20` (voir l'historique)
5. Vérifier KLC : `ssh shiro@klc "cd /home/shiro/MaTrix-test && git pull"`
6. Si tu veux tester Morpheus : utiliser le format absolute path dans la config

**Améliorations futures** (à considérer) :
- Phase 6 : Test end-to-end `opencode run` avec Morpheus
- Phase 7 : Documenter la procédure d'install
- Phase 8 : Implémenter le watchdog (heartbeat + détection)
- Phase 9 : Première auto-amélioration (L1 uniquement, jamais L3 sans approbation)
- Phase 10 : Release v1.0 (semantic versioning, changelog)

**À NE PAS faire** :
- Ne jamais désactiver OMO avant que MaTrix soit mature (3+ mois)
- Ne jamais bypasser l'approbation humaine pour l'auto-amélioration majeure
- Ne jamais commit des secrets
- Ne jamais merger sans QA OpenCode réel

---

## 12. Statut final honnête (2026-07-03)

**Statut honnête final (mis à jour après QA KLC)** :
- ✅ **Code source** : 100% correct, 0 erreur TS, 30 tests passent
- ✅ **Build** : 1903 modules, 5.48 MB, 0 erreur
- ✅ **Runtime MaTrix** : **le plugin se charge via absolute path !** (12 agents
  enregistrés, Morpheus = default agent, config hook fire, isolated XDG sandbox)
  - Evidence : `.omo/evidence/20260703-matrix-fork/SUCCESS-PLUGIN-LOADS.md`
- ⚠️ **Cohabitation KLC** : le symlink npm `matrix-engine` est silencieusement
  ignoré par OpenCode (qui résout les noms via npm). Il faut utiliser un
  **chemin absolu** dans la config :
  ```json
  { "plugin": ["/abs/path/to/MaTrix-test/engine/dist/index.js"] }
  ```
- ✅ **Production** : Sisyphus/OMO reste l'agent principal, mais on peut tester
  Morpheus sans casser OMO

**Valeur du travail** : Le code MaTrix est une **base solide et testée** pour
un vrai fork. Le **breakthrough** récent (2026-07-03) : le plugin se charge
parfaitement via absolute path. La "side-quest" jsonc-parser n'était pas le
vrai blocker — c'était le nom npm `matrix-engine` qui n'est pas publié.

---

## 13. Phases complétées vs en cours

| # | Phase | Statut | Détails |
|---|-------|--------|---------|
| 1 | Fork moteur OMO (16 agents Matrix) | ✅ | 0 erreur TS, 3888 fichiers .ts |
| 2 | Cost tracking + 7 profils métier | ✅ | 17/17 tests passent |
| 3 | MoA + Self-improvement + Kanban | ✅ | 30/30 tests passent |
| 4 | Câblage runtime + tests + QA KLC | ✅ | 4 bugs trouvés par QA |
| 5.1 | 4 agents Matrix créés + plugin id fix | ✅ | neo, tank, operator, oracle-planner |
| 5.2 | Runtime loading via absolute path | ✅ | **BREAKTHROUGH 2026-07-03** |
| 6 | Test end-to-end `opencode run` | ⏳ | Prochaine session |
| 7 | Documentation install flow | ⏳ | Prochaine session |
| 8 | Watchdog subagents (heartbeat) | ⏳ | À coder |
| 9 | Auto-amélioration L1 (code métier) | ⏳ | Module existe, à câbler |
| 10 | Release v1.0 | ⏳ | Quand phases 1-9 stables |

**Phase 6 est la prochaine priorité.** C'est le vrai test : Morpheus doit
répondre à un prompt simple dans une session OpenCode réelle.

---

---

## 14. Procédure d'Installation de MaTrix (plugin OpenCode)

### Prérequis

- Repository cloné localement: `git clone git@github.com:shirofx/MaTrix.git`
- Bun installé : `bun --version`
- OpenCode installé : `opencode --version`

### Build du bundle

```bash
# Depuis la racine du repo MaTrix
cd engine/packages/omo-opencode
bun install --ignore-scripts  # skip postinstall (platform.js manquant dans le fork)
bun build ./src/index.ts --outfile dist/index.js --target bun
# => produit dist/index.js (~6.46 MB, 2071 modules)
```

### Test avec un sandbox isolé

```bash
# Sur le server KLC (ou tout Linux avec OpenCode)
export XDG_DATA_HOME=/tmp/qa-data
export XDG_CONFIG_HOME=/tmp/qa-config
export XDG_CACHE_HOME=/tmp/qa-cache
export XDG_STATE_HOME=/tmp/qa-state

# Config minimale
cat > $XDG_CONFIG_HOME/opencode/opencode.json << 'EOF'
{
  "plugin": ["/abs/path/to/engine/packages/omo-opencode/dist/index.js"],
  "model": "zen-1/deepseek-v4-flash-free"
}
EOF

# Copier les clés API dans le sandbox
cp ~/.secrets/* $HOME/.secrets/
chmod 600 $HOME/.secrets/*

# Vérifier que le plugin charge (12 agents, default Morpheus)
opencode agent list | head -20

# Tester un prompt simple
opencode run "say hi in one sentence"
```

### Sur le server KLC

Le server KLC est déjà configuré :
- Repo : `/home/shiro/MaTrix-test/engine/packages/omo-opencode/`
- Bundle : `dist/index.js` (6.46 MB, 2071 modules)
- Symlink npm : `~/.hermes/node/lib/node_modules/matrix-engine` → engine/ (pour compat npm)
- Config `~/.config/opencode/opencode.json` : plugin via absolute path
- 5 clés secrètes dans `~/.secrets/`

### Sur PC Windows (development)

- OMO/Sisyphus reste l'agent principal de production
- MaTrix est testé exclusivement via SSH sur KLC
- Les commandes /moa et /learn sont **fonctionnelles en mode interactif** (TUI),
  pas en `opencode run --command` (car nécessitent des tools)

### Limitations connues

| Limitation | Cause | Workaround |
|---|---|---|
| Plugin ne charge pas via nom npm | OpenCode ne résout que les packages npm publiés | Utiliser `file://` ou plugin absolute path |
| `/moa` et `/learn` timeout en non-interactif | Templates nécessitent tools (task, read, write) | Utiliser en session TUI interactive |
| postinstall échoue | fork n'a pas bin/platform.js | `bun install --ignore-scripts` |
| `bun run build` introuvable | package.json `scripts` minimal | Build directement avec `bun build` |
| `.d.ts` non générées | tsc --emitDeclarationOnly non configuré | Non bloquant (plugin fonctionne sans) |

---

*Dernière mise à jour : 2026-07-13 (reprise post-redémarrage OpenCode — MC terminé, token retiré, paths Linux corrigés)*
*Manifeste version 1.1 — voir aussi ARCHITECTURE.md pour le plan technique*

---

## 12. Install Flow MaTrix (KLC / Ubuntu)

### Prérequis
- Ubuntu 22+ avec Bun 1.3+
- OpenCode installé (via npm ou bun)

### Installation

```bash
# 1. Cloner le fork (déjà fait sur KLC)
cd /home/shiro/MaTrix-test
git pull origin main

# 2. Installer les dépendances
cd engine
bun install --ignore-scripts  # skip postinstall défaillant

# 3. Builder le bundle
bun build ./packages/omo-opencode/src/index.ts --outfile ./packages/omo-opencode/dist/index.js --target bun --external zod

# 4. Copier/ajouter les clés API dans ~/.secrets/
# (openai, anthropic, openrouter, zen, google — déjà fait sur KLC)

# 5. Configurer opencode.json
cat > ~/.config/opencode/opencode.json << 'EOF'
{
  "plugin": ["/home/shiro/MaTrix-test/engine/packages/omo-opencode/dist/index.js"],
  "model": "zen-1/deepseek-v4-flash-free",
  "provider": {}
}
EOF

# 6. Configurer oh-my-openagent.json (agents Matrix)
# Fichier existant à copier depuis ~/.config/opencode/oh-my-openagent.json
# (déjà présent sur KLC, contient les 16 agents + 7 profils)

# 7. Tester
opencode run "say hi"
# → Doit répondre avec Morpheus

# 8. Lister les agents
opencode agent list
# → Doit montrer 12 agents Matrix (morpheus, oracle, link, ghost, analyst, 
#    keymaker, agent-smith, trinity, cypher, sentinel, mouse, dreamer, architect)
```

### Configs clés
| Fichier | Path KLC | Notes |
|---------|----------|-------|
| Plugin bundle | `/home/shiro/MaTrix-test/engine/packages/omo-opencode/dist/index.js` | 5.45 MB, 1904 modules |
| opencode.json | `~/.config/opencode/opencode.json` | Plugin via **absolute path**, pas npm name |
| oh-my-openagent.json | `~/.config/opencode/oh-my-openagent.json` | Agents + profils + providers |
| Secrets | `~/.secrets/` | 5 clés API (chmod 600) |

### Pièges connus
- **Plugin ne charge pas via nom npm** → OpenCode résout seulement les packages npm **publiés**. Utiliser un **absolute path**.
- **postinstall échoue** → `bun install --ignore-scripts`
- **Typecheck échoue** → certaines erreurs `.d.ts` pré-existantes, le JS bundle est OK
- **`/moa` / `/learn` timeout en non-interactif** → utiliser en session TUI interactive

### Workflow dev
```bash
# Dev local (Windows PC) : coder, push
cd G:\ProjetShiro\MaTrix
git add -A && git commit -m "feat: ..." && git push

# QA sur KLC (Ubuntu Server) : pull, build, test
ssh shiro@klc.taild26732.ts.net
cd /home/shiro/MaTrix-test
git pull
bun install --ignore-scripts
bun build ./packages/omo-opencode/src/index.ts --outfile ./packages/omo-opencode/dist/index.js --target bun --external zod
opencode run "say hi"  # smoke test
```

---

## Phase 10 — Installation automatisée ✅

- `install-matrix.sh` : script unique tout-en-un (deps, build, backup config, affichage path)
- `features/subagent-watchdog/heartbeat.ts` : heartbeat + stall detection + lessons learned
- Commande `/watchdog` enregistrée (list, report, lessons)
- **7 tests watchdog passent**
- Validé KLC : `exit=0` après installation propre

## Phase 11 — Documentation utilisateur ✅

- `README.md` : présentation, quick start, 16 agents, commandes, structure, état
- `docs/INSTALL.md` : guide détaillé (install standard, Windows, serveur headless, troubleshooting, mise à jour)
- `tmp-matrix-config.json` nettoyé

## Prochaine étape recommandée

**Phase 12** : Test interactif `/moa` et `/learn` sur KLC en session TUI (nécessite toi sur KLC)
- `ssh shiro@klc.taild26732.ts.net`
- `opencode` (lancer le TUI)
- Taper `/moa Quel est le meilleur langage pour une API ?`
- Observer si MoA consulte 3 agents en parallèle

Alternativement : **Phase 13** : Ajouter les `.d.ts` pour le packaging npm (peut se faire sans toi).

## Phase 14 — Unification logging + résilience MoA ✅

- `shared/matrix-logger.ts` : append-only JSONL vers `~/.matrix/logs/` (session-agnostique)
- cost-tracker, kanban, heartbeat → logs unifiés via `~/.matrix/logs/`
- Hook unique `matrix-lifecycle` : enregistre les 3 subsystems en un point
- Presets MoA corrigés : uniquement modèles qui marchent (`deepseek-v4-flash-free` + `big-pickle`)
- Agent Ghost switché sur `deepseek-v4-flash-free`
- Self-critique preset ajouté à MOA_PRESETS
- Template `/moa` simplifié (instructions réduites, pas de mur de texte)
- Validé KLC : `/moa` spawn 3 advisors, logs écrits, cost/kanban/heartbeat persistés

## Phase 15 — Dashboard Mission Control (Hermes-inspired) ⏳

- `scripts/dashboard-server.ts` : serveur Node.js (pas bun, pour fiabilité daemon)
- **7 onglets** : Overview, Agents, Costs, Health, Providers, Schedule, Board
- **3 profils switchables** : Daily / Balanced / Performance (boutons)
- **Métriques VPS** : CPU / RAM / Disk / Uptime depuis /proc
- **Stats par agent** : total, complétées, échouées, dernier seen, taux succès
- **Coûts** : par jour (7 jours) + par modèle
- **Cron jobs** : depuis /etc/crontab
- **Board personnel** : tâches perso (seed auto, CRUD via API)
- **Onglet Providers** : ajout/suppression de providers (Ollama, NVIDIA, etc.) depuis l'UI
- **Service systemd** : `/etc/systemd/system/matrix-dashboard.service` (auto-start, auto-restart)
- **Wrapper bash** : `/home/shiro/MaTrix-test/engine/scripts/start-dashboard.sh`
- **Problème réseau** : le dashboard répond sur KLC (curl localhost:4321 ✅, curl 100.67.198.36:4321 ✅) mais pas depuis ton PC (firewall/routage Tailscale à vérifier)

## Phase 16 — API Ollama configurée ⏳

- Clé API reçue : `f94d2d5d1d1746a5b637dc464f9f3ff1.VpXHOUrznFwFQxGb_cg-XPmJ`
- Modèles cloud disponibles : `gemini-3-flash-preview:cloud`, `deepseek-v4-flash:cloud`, `minimax-m3:cloud`, `kimi-k2.7-code:cloud`, `glm-5.2:cloud`, `gemma4:31b-cloud`
- Provider non encore ajouté à la config KLC (dashboard non accessible depuis ton PC)
- **Solution** : ajouter le provider via l'onglet Providers du dashboard quand accessible, OU via SSH direct

---

## 17. Portage Magic Context — décision & roadmap (2026-07-12)

**Contexte** : Magic Context (`@cortexkit/opencode-magic-context`, MIT, v0.32.0) est un plugin OpenCode tiers apportant un contexte « infini » cache-aware + mémoire inter-sessions. Research + test isolé menés le 2026-07-12. Décision Shiro : **PORTER l'architecture dans MaTrix** (pas forker le plugin).

### 17.1 D'où on vient (origine)
- Magic Context = plugin tiers CortexKit, **PAS** une feature OpenCode officielle.
- Test isolé dans `/home/shiro/mc-sandbox` (opencode.json + magic-context.jsonc, compaction native désactivée).
- Source clonée et lue : `/tmp/mc-src/packages/plugin` (MIT).
- **Conflit découvert** : MC se désactive auto si il détecte OMO (package `oh-my-opencode`/`oh-my-openagent`) via 3 hooks (`preemptive-compaction`, `context-window-monitor`, `anthropic-context-window-limit-recovery`). Or MaTrix = fork OMO → MC ne peut PAS cohabiter comme plugin tiers.
- **Résolution** : on n'installe PAS MC comme plugin tiers, on réimplémente ses capacités DANS MaTrix → le `conflict-detector` MC ne s'applique plus.

### 17.2 Où on est (état actuel — 2026-07-12)
- Plan de conception décisionnel rédigé (Plan agent) : port natif dans `packages/omo-opencode/src/features/magic-context/`.
- **6 décisions validées par Shiro** (voir §17.4).
- Cartographie MaTrix confirmée : hook `experimental.chat.messages.transform` **DISPONIBLE** (SDK 1.15.13 engine / 1.17.6 runtime) → point d'injection réutilisable.
- Existant réutilisable : `ContextCollector`, `context-injector`, `rules-injector`, wiring hooks transform/system.
- Ce que MaTrix N'A PAS (à porter) : SQLite store, embeddings + recherche sémantique 6 sources, message-history index, historian background no-pause, compartment system, dreamer code-driven (actuellement prompt-only dans `agents/dreamer.ts`).

### 17.3 Où on va (roadmap — vagues parallèles)
- **Wave 1** (indép.) : `A0` SQLite shim + schéma (~50 tables) · `C0` config Zod · `K0` vérif SDK 1.15.13→1.17.6
- **Wave 2** : `B0` embedding pipeline · `F0` moteur recherche sémantique · `G0` dreamer code-driven (11 tâches, lease-based)
- **Wave 3** : `D0` historian compressor (risque max) · `I0` sidekick (DIFFÉRÉ) · `J0b` TUI (DIFFÉRÉ)
- **Wave 4** : `E0` injection transform (extend ContextCollector) · `H0` outils `ctx_*` (ctx_reduce/memory/search/expand/note) + lifecycle
- **Wave 5** : `L0` QA + tests intégration
- **Effort estimé** : ~30–42 jours (6–8 sem. avec 2 workers parallèles).
- **Cible code** : `packages/omo-opencode/src/features/magic-context/` (db/, embedding/, search/, historian/, transform/, dreamer/, tools/, lifecycle.ts).

### 17.4 Les 6 décisions validées (Shiro, 2026-07-12)
| # | Décision | Choix retenu |
|---|----------|--------------|
| D1 | Historian vs compaction natif MaTrix | **COORDINER** : historian = compression proactive (seuil 65%), `preemptive-compaction` = filet de secours (seuil 80%+). Garder le module `anthropic-context-window-limit-recovery` (39 fichiers) comme sécurité. |
| D2 | Sous-agents Dreamer MC | **Porter comme nouveaux agents MaTrix** (`dreamer-extractor`, `dreamer-classifier`, `dreamer-reviewer`) dans `builtin-agents.ts`. |
| D3 | Provider d'embedding | **`openai-compatible` par défaut** (KLC Router), `local` HuggingFace en opt-in (évite +150MB node_modules + risque compat Bun). |
| D4 | Emplacement SQLite | **`.matrix/magic-context/magic-context.db`** (overridable via `magic_context.sqlite.path`). |
| D5 | Sidekick | **DIFFÉRER** (MaTrix a déjà `background-agent` + team-mode). |
| D6 | TUI sidebar | **DIFFÉRER** (dépend `solid-js`/`@opentui` absents de MaTrix). |

### 17.5 Références
- Source MC : `/tmp/mc-src/packages/plugin` (clone, MIT) — lire `src/index.ts`, `shared/conflict-detector.ts`, `features/magic-context/compaction.ts`, `plugin/messages-transform.ts`, `storage-db.ts`.
- Sandbox test isolé : `/home/shiro/mc-sandbox` (opencode.json + magic-context.jsonc + node_modules).
- Hooks clés MaTrix à réutiliser : `packages/omo-opencode/src/plugin-interface.ts:70` (messages.transform), `plugin/hooks/create-transform-hooks.ts`, `features/context-injector/collector.ts`.
- Plan détaillé : output Plan agent (tâches A0..L0, fichiers cibles, critères d'acceptation, vagues d'exécution).

### 17.6 Avancement (journal)
- **2026-07-12 — Wave 1 TERMINÉE** : `A0` (SQLite shim cross-runtime + 66 tables + CRUD dans `features/magic-context/db/`), `C0` (config Zod `magic_context` + `build:schema` regénéré), `K0` (compat SDK 1.15.13 validée, aucun shim requis). Typecheck : 0 erreur sur `magic-context`. Restent des erreurs préexistantes hors périmètre (`boulder-state`, `agent-names.test.ts`).
- **2026-07-12 — Wave 2 TERMINÉE** : `B0` (embedding pipeline 6 fichiers, Embedder + openai-compatible/local/mock), `F0` (recherche sémantique 10 fichiers, 5/5 tests pass), `G0` (dreamer 9 fichiers + 3 agents enregistrés dans builtin-agents.ts). Vérif indépendante : 37 fichiers présents, interface Embedder correcte, agents enregistrés, typecheck 0 erreur sur magic-context.
- **2026-07-12 — Wave 3 TERMINÉE** : `D0` (historian compressor, 7 fichiers, 11/11 tests pass, module additif non câblé — handler `createHistorianCompactor` prêt pour Wave 4 E0). `I0` (sidekick) et `J0b` (TUI) DIFFÉRÉS.
- **2026-07-12 — Wave 4 TERMINÉE (typecheck clean, vérif indépendante)** : `E0` (transform hook `magicContextInjector` câblé additivement dans `create-transform-hooks.ts` + `messages-transform.ts`), `H0` (10 fichiers tools/, `ctx_search/remember/forget/list/compact/dream` enregistrés additivement dans `tool-registry.ts`). 0 nouvelle erreur typecheck (seules erreurs `boulder-state` préexistantes).
- **2026-07-12 — Wave 5 EN COURS (OBLIGATOIRE per repo AGENTS.md)** : `L0` QA réelle OpenCode via `opencode-qa` (sandbox XDG isolé + evidence `.omo/evidence/20260712-magic-context-qa/`). Modules E0/H0 WIRÉS → QA réelle requise avant déclaration fonctionnelle. `I0`/`J0b` toujours DIFFÉRÉS.
- **2026-07-13 — Wave 5 root cause #1 CORRIGÉ (wiring)** : `create-tools.ts` ne passait pas `magicContextDeps` à `createToolRegistry` (gate `tool-registry.ts:69` toujours false) → outils `ctx_*` jamais enregistrés. `create-transform-hooks.ts:116` passait `null` à `createMagicContextTransformHook`. Corrigé : fabrique `createMagicContextDeps` (`features/magic-context/deps.ts`) construite + passée aux 2 points. Ajout `"mock"` à l'enum `EmbeddingSubConfigSchema.provider` (`magic-context.ts:13`) — sandbox KLC Router retourne 404 sur embeddings, `mock` requis pour QA.
- **2026-07-13 — Wave 5 Case B PASS (server boot)** : sandbox XDG, `--hostname 127.0.0.1 --port 9643`, health HTTP 200, plugin charge proprement. Evidence `serve2-boot.log`.
- **2026-07-13 — Wave 5 Case A PARTIEL** : `opencode run --auto` → le modèle a APPELÉ `ctx_remember`/`ctx_list`/`ctx_search` (preuve wiring OK). 2 bugs trouvés : (a) `"no such table: memories"` → `runMigrations(db)` non appelé dans `deps.ts` (corrigé) ; (b) `ctx_search` → "No results found" → `searchMemory` (memory-searcher.ts:26 INNER JOIN `memories`×`memory_embeddings`) or `insertMemory`/`insertMemoryIdempotent` n'écrit JAMAIS l'embedding (l'original MC utilisait `queueMemoryEmbedding` async, supprimé au port).
- **2026-07-13 — Wave 5 root cause #2 CORRIGÉ (embedding storage + mock)** : `ctx-remember.ts` calcule désormais `deps.embedder.embedText(content)` + `memories.saveMemoryEmbedding(db, memory.id, vector, modelId)` après insert (try/catch non-fatal + `console.error`). `registry.ts` passe `embedder`+`modelId` à `createCtxRememberTool` ; `deps.ts` dérive `modelId = \`${provider}:${model||"default"}\``. Mock embedder (`embedder.ts`) était hash plein-texte → vecteurs orthogonaux → search ne matchait jamais des phrasings différents ; rendu **token-overlap (bag-of-words)**. Bundle rebuildé 5.60 MB (1943 modules).
- **2026-07-13 — Wave 5 RE-RUN Case A PASS ✅** : rebuild terminé APRÈS tous les fix. Re-lancé `ctx_remember`→`ctx_list`→`ctx_search` (sandbox XDG, query LIÉE "cross-session memory"). `ctx_remember` → Saved memory [ID: 1] ; `ctx_search` → **Found 1 result, score=1.00** (retourne la mémoire stockée, avant "No results found") ; `ctx_list` → Found 1 active memory. `ctx_search` fonctionnel (embedding persisté + mock token-overlap). Evidence `run4-remember.jsonl`.
- **2026-07-13 — Wave 5 Case B RE-PASS ✅** : server boot `--hostname 127.0.0.1 --port 9643`, health HTTP 200, `opencode server listening`. Evidence `serve3-boot.log`.
- **2026-07-13 — Wave 5 STATUT FINAL** : Magic Context est **fonctionnel** (mémoire inter-sessions + contexte cache-aware) dans MaTrix, vérifié par QA réelle OpenCode (sandbox XDG isolé). 2 root causes corrigées + bundle 5.60 MB. `I0`/`J0b` toujours DIFFÉRÉS. Dossier evidence : `.omo/evidence/20260712-magic-context-qa/`.

---

## Prochaine étape recommandée

**TRAVAIL MAJEUR SUIVANT — Portage Magic Context (voir §17)** : démarrer la Wave 1 (tâches `A0` SQLite shim + schéma ~50 tables, `C0` config Zod, `K0` vérif SDK 1.15.13→1.17.6). Les 6 décisions sont déjà validées (§17.4). Lancer `A0` + `C0` + `K0` en parallèle via subagents `deep`. Référence : plan détaillé en §17.3 / §17.5.

**Secondaire — Résoudre l'accès au dashboard** : vérifier la connectivité Tailscale entre ton PC et KLC (ping, Test-NetConnection, port 4321). Une fois le dashboard accessible, tu pourras :
1. Ajouter ton API Ollama depuis l'onglet Providers
2. Ajouter NVIDIA API plus tard
3. Switcher les profils (Daily/Balanced/Performance) en un clic
4. Voir les stats en temps réel

**Alternativement** : ajouter le provider Ollama directement via SSH :
```bash
ssh shiro@klc
# Ajouter dans ~/.matrix/config.json
```
