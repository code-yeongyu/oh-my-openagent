import type { BuiltinSkill } from "../types"

export const FRONTEND_SVELTE_SVELTEKIT_SKILL_NAME = "svelte-sveltekit-patterns"

const FRONTEND_SVELTE_SVELTEKIT_SKILL_DESCRIPTION =
  "Svelte 5 runes ($state, $derived, $effect, snippets) and SvelteKit (file-based routing, load functions, form actions, SSR/CSR) patterns"

export const svelteSveltekitPatternsSkill: BuiltinSkill = {
  name: FRONTEND_SVELTE_SVELTEKIT_SKILL_NAME,
  description: FRONTEND_SVELTE_SVELTEKIT_SKILL_DESCRIPTION,
  template: `# Svelte 5 + SvelteKit Patterns

## Svelte 5 Runes (Modern Reactivity)

Runes are compiler primitives replacing \`let x = ...\` reactivity and stores for component state:

| Rune | Purpose | Example |
|------|---------|---------|
| \`$state\` | Reactive state (replaces \`let count = 0\`) | \`let count = $state(0)\` |
| \`$derived\` | Computed values (replaces reactive statements) | \`let doubled = $derived(count * 2)\` |
| \`$derived.by\` | Multi-statement derived values | \`let total = $derived.by(() => { ... })\` |
| \`$effect\` | Side effects (replaces \`$:\` statements) | \`$effect(() => { ... })\` |
| \`$effect.pre\` | Run before DOM update | \`$effect.pre(() => { ... })\` |
| \`$props\` | Component props (replaces \`export let\`) | \`let { name, age = 25 } = $props()\` |
| \`$bindable\` | Bindable props for two-way binding | \`let { value = $bindable() } = $props()\` |
| \`$inspect\` | Debug logging with reactive tracking | \`$inspect(count)\` |
| \`$host\` | Access custom element host | \`$host()\` |

**Migration guide**: \`export let name\` → \`let { name } = $props()\`; \`$: double = count * 2\` → \`let double = $derived(count * 2)\`; \`$: { ... }\` → \`$effect(() => { ... })\`.

## Snippets (Replace Slots)

Snippets are renderable template fragments that replace the legacy slot system:

\`\`\`svelte
{#snippet header(title)}
  <h1>{title}</h1>
{/snippet}

{@render header("Welcome")}
\`\`\`

**Children snippets**: \`let { children } = $props()\` captures a snippet named \`children\` (equivalent to the default slot). Use \`{@render children()}\` to render it. Named snippets work the same way: \`let { header, footer } = $props()\` → \`{@render header()}\`.

**Migration**: \`<slot />\` → pass \`children\` snippet prop; \`<slot name="header" />\` → pass and render named \`header\` snippet. Snippets are first-class values — they compose, pass between components, and are type-safe.

## Component Composition

- **Attachable state**: Use \`$state.frozen()\` for deep objects that should not be proxied
- **Class state**: \`class Counter { count = $state(0) }\` for reactive class instances
- **Non-reactive state**: Skip runes with plain \`let\` for non-reactive locals
- **Sharing state between components**: Use Svelte's context API (\`setContext\`/\`getContext\`) or pass state via props — no global stores needed

## SvelteKit — File-Based Routing

\`\`\`
src/routes/
├── +page.svelte          # Page component (renders at route root)
├── +page.server.js       # Server load function for this page (runs on server)
├── +page.js              # Universal load function (runs on server + client)
├── +layout.svelte        # Layout wrapper for all child routes
├── +layout.server.js     # Server layout data loading
├── +layout.js            # Universal layout data loading
├── +server.js            # API endpoint (GET, POST, PUT, DELETE, PATCH)
├── +error.svelte         # Error boundary for this segment
├── [param]/              # Dynamic route parameter
│   └── +page.svelte
├── [[optional]]/         # Optional route parameter
├── [...rest]/            # Rest/catch-all route parameter
├── (group)/              # Route group (no path segment in URL)
│   └── +page.svelte
└── hooks.server.js       # Server hooks (handle, handleFetch, handleError)
\`\`\`

## Load Functions

**Server load** (\`+page.server.js\` / \`+layout.server.js\`):
\`\`\`js
export async function load({ params, fetch, locals, url, depends, platform, cookies }) {
  const data = await fetch(\`/api/items/\${params.id}\`).then(r => r.json());
  return { items: data };
}
\`\`\`

**Universal load** (\`+page.js\` / \`+layout.js\`): Same signature but runs on client too (access \`browser\` from \`$app/environment\`).

**Streaming**: Return a promise in the data object — SvelteKit streams it automatically:
\`\`\`js
export async function load({ fetch }) {
  return { streamed: { comments: fetch('/api/comments').then(r => r.json()) } };
}
\`\`\` Use \`{#await}\` in +page.svelte to handle the streaming promise.

## Form Actions

\`\`\`js
// +page.server.js
export const actions = {
  default: async ({ request, locals }) => {
    const data = await request.formData();
    const name = data.get('name');
    // Validation
    if (!name) return { error: 'Name required' };
    // Success
    return { success: true };
  },
  delete: async ({ params }) => { ... }
};
\`\`\`

Use \`use:enhance\` for progressive enhancement (JS-enhanced form submission with no page reload):
\`\`\`svelte
<form method="POST" action="?/delete" use:enhance>
\`\`\`

## Data Flow — API Endpoints

\`\`\`js
// +server.js
export async function GET({ url, locals }) { return json({ ok: true }); }
export async function POST({ request, locals }) {
  const body = await request.json();
  return json({ id: crypto.randomUUID(), ...body }, { status: 201 });
}
\`\`\`

Use \`event.fetch\` in load functions and \`+server.js\` — it respects \`hooks.server.js\` request interception.

## State Management

| Approach | When to Use |
|----------|-------------|
| \`$state\` + \`$derived\` | Component-local state (preferred) |
| Context API (\`setContext\`/\`getContext\`) | Shared state within a component tree |
| \`writable\` stores | Legacy — migrate existing code only |
| \`$props$ + snippets | Parent-to-child data flow |

**Context API** (preferred over stores for scoped state):
\`\`\`svelte
<script>
  import { setContext, getContext } from 'svelte';
  const key = Symbol('todos');
  // In parent: let todos = $state([]); setContext(key, { todos, addTodo });
  const ctx = getContext(key); // In child
</script>
\`\`\`

## SSR / CSR

- \`browser\` from \`$app/environment\` is \`true\` only on client — use to guard browser-only code
- \`building\` from \`$app/environment\` — \`true\` during \`vite build\` (prerendering, static adapters)
- \`version\` from \`$app/environment\` — app version string for cache busting
- Use \`{#if browser}\` blocks to defer client-only content to hydration

## Anti-Patterns

- Mixing \`export let\` (legacy) with \`$props()\` (runes) in the same component
- \`$effect\` for derived values — always prefer \`$derived\`
- Mutating \`$state\` outside reactive context (must be inside \`.svelte\` or \`.svelte.js\` files)
- Using \`page.store\` directly — prefer \`$page\` rune import or load function returns\``,
}
