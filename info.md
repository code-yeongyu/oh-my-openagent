MATRIX : Architecture et Contexte Technique (V2 de OMO)
1. Contexte et Objectif
Matrix est un framework multi-agents en TypeScript conçu pour remplacer et améliorer OMO (Oh My OpenAgent). Il est destiné à une agence d'intégration web pour gérer des projets clients de bout en bout (Code, Infra, Design, WordPress, Drupal, Mobile, SEO, Maintenance). Il doit être agnostique au niveau des LLMs (Ollama Cloud, API custom, OpenAI, Anthropic) et s'auto-améliorer via une mémoire persistante.

2. Mapping des Agents (De OMO à Matrix)
Dans OMO, "Sisyphus" était l'orchestrateur. Dans Matrix, les rôles sont redistribués et spécialisés selon l'univers Matrix :

Sisyphus (Orchestrateur) devient 🏗️ The Architect : Gère la state machine, lit/écrit dans le Vault Obsidian. Il a un compteur d'itérations strict pour éviter les boucles infinies.
Le Planner devient 🧠 The Oracle : Utilise le Mixture of Agents (MoA) et la réflexion étendue (style Hermes).
Le Coder devient 💻 Neo : Multilingage, utilise la cartographie AST pour modifier les fichiers sans perte de contexte.
Le Reviewer/Critic devient 🕴️ Agent Smith : Exécute tests et linters, impitoyable.
L'Agent UI/UX devient 🎨 Trinity : S'intègre avec Open Design pour extraire les maquettes Figma et générer le code frontend au pixel près.
Le DevOps devient ⚙️ Morpheus : Gère Docker, CI/CD, serveurs, déploiements.
L'Intégrateur CMS devient 🔌 The Keymaker : Spécialiste WordPress, Drupal, API tiers.
Le Copywriter devient ✍️ Cypher : SEO, contenu client, meta tags.
3. Concepts Techniques Clés
A. Mixture of Agents (MoA) - Inspiré de Nous Research / Hermes
The Oracle ne utilise pas un seul modèle. Pour une tâche complexe :

Matrix lance 3 LLMs en parallèle (ex: Claude 3.5, GPT-4o, Llama 3).
The Oracle (Agrégateur) reçoit les 3 réponses et synthétise le plan final ultime, éliminant les hallucinations.
B. Auto-amélioration et Mémoire Obsidian
Matrix utilise un dossier local vault/ au format Obsidian (Markdown avec liens [[comme ceci]]).

[[Client_X]].md : Contexte du client.
[[Regles_Neo]].md : Règles de codage.
À la fin d'une tâche, The Architect analyse les erreurs trouvées par Agent Smith et modifie dynamiquement les fichiers .md du Vault pour que les agents ne refassent plus les erreurs.
C. Dashboard Kanban et Télémétrie
Un serveur local Express.js + WebSocket affiche un Kanban (localhost:3000) montrant en temps réel :

Les cartes de tâches passant de Neo à Agent Smith.
La consommation de tokens API de chaque agent.
Le temps d'exécution.
4. Optimisations Avancées (Veille Technologique)
Prompt Caching : Utiliser le cache d'Anthropic/OpenAI pour les gros prompts système (Vault) afin de réduire les coûts et la latence.
Cartographie AST (Abstract Syntax Tree) : Neo ne lit pas les gros fichiers en entier. Il utilise tree-sitter pour générer un squelette du fichier et ne demande que les lignes autour de la modification.
Outil TodoWrite : The Architect écrit son plan dans un kanban.json et met à jour les statuts ("in_progress", "done") en temps réel via function calling.
Web Search Tool : The Oracle et Cypher ont accès à un outil search_web (Tavily/Exa) pour vérifier la documentation officielle des CMS/Frameworks en temps réel.
5. Stack Technique
Langage : TypeScript (Node.js / Bun)
SDK LLM : Vercel AI SDK (ai, @ai-sdk/openai, @ai-sdk/anthropic)
Validation : Zod (Structured Outputs)
CLI : Commander.js, Chalk
Mémoire : Fichiers Markdown locaux (Obsidian Vault)
6. Configuration du Routeur LLM (Agnostique)
Matrix doit supporter les variables d'environnement pour Ollama Cloud Pro et les providers custom :

OLLAMA_API_BASE_URL=https://ton-ollama-cloud.com/v1OLLAMA_API_KEY=ta_cle_api_ollamaCUSTOM_API_BASE_URL=https://ton-provider-custom.com/v1CUSTOM_API_KEY=ta_cle_api_custom
7. Code de démarrage : LLM Router
Voici la base du routeur utilisant le Vercel AI SDK :

typescript

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

const ollamaCloud = createOpenAI({
  baseURL: process.env.OLLAMA_API_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.OLLAMA_API_KEY || 'ollama',
});

const customProvider = createOpenAI({
  baseURL: process.env.CUSTOM_API_BASE_URL,
  apiKey: process.env.CUSTOM_API_KEY,
});

export const matrixModels = {
  oracle: anthropic('claude-3-5-sonnet-20240620'), // Pour MoA
  neo: customProvider('ton-modele-custom-de-code'), 
  smith: openai('gpt-4o-mini'), // Rapide et peu coûteux
  trinity: ollamaCloud('llava:13b'), // Modèle vision
};
8. PROMPT DE DÉMARRAGE POUR OPENCODE
Pour lancer le développement de Matrix dans OpenCode, utiliser ce prompt :

"Bonjour. Aujourd'hui, nous allons développer Matrix, un framework multi-agents en TypeScript conçu pour remplacer OMO.

L'architecture de Matrix :

The Architect : L'orchestrateur (ex-Sisyphus). Gère la state machine, lit/écrit dans le Vault Obsidian (vault/).
The Oracle : Planification via Mixture of Agents (MoA) et réflexion étendue.
Neo : Le Coder. Utilise une cartographie AST pour modifier les fichiers sans perte de contexte.
Trinity : UI/UX. S'intègre avec Open Design.
Agent Smith : Le Reviewer. Exécute tests et linters, impitoyable.
Règles techniques pour le code que tu vas générer :

Utilise le Vercel AI SDK (ai package) pour le routeur LLM. Je dois pouvoir utiliser Ollama Cloud et des API custom via des variables d'environnement.
Implémente le Prompt Caching pour les gros prompts système.
Les agents doivent communiquer via des schémas Zod stricts (Structured Outputs).
The Architect doit utiliser un outil TodoWrite pour tracker son avancement dans un fichier kanban.md.
Première tâche :
Initialise le projet Node.js avec TypeScript. Installe les dépendances (ai, @ai-sdk/openai, @ai-sdk/anthropic, zod, fs-extra). Crée la structure de dossiers (src/agents, src/core, vault/). Puis, génère le code de src/core/llm-router.ts en t'assurant qu'il supporte le baseURL custom pour Ollama. Commence."

9. Portage Magic Context (état 2026-07-13 — ✅ TERMINÉ)

Magic Context (`@cortexkit/opencode-magic-context`, MIT) a été **porté nativement** dans MaTrix (voir manifest.md §17 pour la décision + roadmap complète + journal d'avancement).

**D'où on vient** : plugin tiers CortexKit qui se désactive auto si il détecte OMO (MaTrix = fork OMO) → on ne l'installe pas comme plugin tiers, on réimplémente l'architecture dans MaTrix (`packages/omo-opencode/src/features/magic-context/`).

**Où on est** : ✅ **TERMINÉ et vérifié par QA réelle OpenCode** (sandbox XDG isolé). Waves 1-5 toutes terminées : SQLite store 66 tables, embedding pipeline 6 sources, recherche sémantique, dreamer code-driven ×3 agents, historian compressor, transform hook, outils `ctx_*` enregistrés. 2 root causes corrigées en QA (wiring `magicContextDeps` + persistance embedding). Bundle 5.60 MB. Case A (tool exec `ctx_remember`→`ctx_search` score 1.0) PASS, Case B (server boot) PASS.

**Où on va** : Magic Context est **fonctionnel** (mémoire inter-sessions + contexte cache-aware), activable en opt-in via le bloc `magic_context` dans la config (`mock` = zéro dépendance, `openai-compatible` = embedding sémantique via KLC Router). `I0` (sidekick) et `J0b` (TUI) restent différés.

**Activer** : voir `engine/docs/guide/magic-context.md` (commit `b915529ac`) + référence capacité épinglée dans `morpheus-agent-config.ts` (`MORPHEUS_BUILTIN_CAPABILITIES`).

Emplacement config : `magic_context` dans `oh-my-openagent.json`. Embedding défaut `openai-compatible` (KLC Router), `mock` pour QA sandbox. SQLite : `.matrix/magic-context/magic-context.db` (overridable via `magic_context.sqlite.path`).