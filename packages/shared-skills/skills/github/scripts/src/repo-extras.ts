// Repository side settings (autolinks, deploy keys) and GitHub's gitignore and license template catalogs.
import { op, s } from "../vendor/surface/index.ts";
import {
  enc,
  irreversible,
  limitField,
  reads,
  repoField,
  writes,
} from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, bool, num, optStr, str } from "./read.ts";
import { strings } from "./repo-settings.ts";

const idField = (what: string) => s.integer({ description: `${what} id.` });

const autolink = (x: unknown) => ({
  id: num(x, "id"),
  keyPrefix: str(x, "key_prefix"),
  urlTemplate: str(x, "url_template"),
  alphanumeric: bool(x, "is_alphanumeric"),
});

const deployKey = (x: unknown) => ({
  id: num(x, "id"),
  title: optStr(x, "title"),
  key: str(x, "key"),
  readOnly: bool(x, "read_only"),
  createdAt: optStr(x, "created_at"),
});

const license = (x: unknown) => ({
  key: str(x, "key"),
  name: str(x, "name"),
  spdxId: optStr(x, "spdx_id"),
});

export const repoExtraOps = (gh: GitHub) => ({
  autolink: {
    list: op({
      description:
        "Autolink references of a repository. Replaces `gh repo autolink list`.",
      input: s.object({ repo: repoField }),
      annotations: reads,
      run: async ({ repo }) => {
        const r = await gh.repo(repo);
        const body = await gh.rest("GET", `repos/${r.full}/autolinks`);
        return { repo: r.full, items: arr(body, "autolinks").map(autolink) };
      },
    }),
    view: op({
      description: "One autolink reference. Replaces `gh repo autolink view`.",
      input: s.object({ repo: repoField, id: idField("Autolink") }),
      annotations: reads,
      run: async ({ repo, id }) => {
        const r = await gh.repo(repo);
        return {
          repo: r.full,
          ...autolink(await gh.rest("GET", `repos/${r.full}/autolinks/${id}`)),
        };
      },
    }),
    create: op({
      description:
        "Add an autolink: text starting with keyPrefix links to urlTemplate with <num> replaced. Alphanumeric references unless numeric. Replaces `gh repo autolink create`.",
      input: s.object({
        repo: repoField,
        keyPrefix: s.string({
          description: "Prefix that triggers the link, e.g. TICKET-.",
        }),
        urlTemplate: s.string({
          description:
            "URL containing <num>, e.g. https://example.com/t/<num>.",
        }),
        numeric: s.optional(
          s.boolean({ description: "Match only digits after the prefix." }),
        ),
      }),
      annotations: writes,
      run: async ({ repo, keyPrefix, urlTemplate, numeric }) => {
        const r = await gh.repo(repo);
        const x = await gh.rest("POST", `repos/${r.full}/autolinks`, {
          body: {
            key_prefix: keyPrefix,
            url_template: urlTemplate,
            is_alphanumeric: numeric !== true,
          },
        });
        return { repo: r.full, ...autolink(x) };
      },
    }),
    delete: op({
      description:
        "Delete an autolink reference. Replaces `gh repo autolink delete --yes`.",
      input: s.object({ repo: repoField, id: idField("Autolink") }),
      annotations: irreversible,
      run: async ({ repo, id }) => {
        const r = await gh.repo(repo);
        await gh.rest("DELETE", `repos/${r.full}/autolinks/${id}`);
        return { repo: r.full, id, deleted: true };
      },
    }),
  },
  deployKey: {
    list: op({
      description:
        "Deploy keys of a repository. Replaces `gh repo deploy-key list`.",
      input: s.object({ repo: repoField, limit: limitField(100) }),
      annotations: reads,
      run: async ({ repo, limit }) => {
        const r = await gh.repo(repo);
        return {
          repo: r.full,
          items: (await gh.list(`repos/${r.full}/keys`, limit ?? 100)).map(
            deployKey,
          ),
        };
      },
    }),
    add: op({
      description:
        "Add a deploy key from its public key text, read-only unless allowWrite. Replaces `gh repo deploy-key add`.",
      input: s.object({
        repo: repoField,
        key: s.string({
          description: "Public key text, e.g. the contents of id_ed25519.pub.",
        }),
        title: s.optional(s.string()),
        allowWrite: s.optional(s.boolean({ description: "Let the key push." })),
      }),
      annotations: writes,
      run: async ({ repo, key, title, allowWrite }) => {
        const r = await gh.repo(repo);
        const x = await gh.rest("POST", `repos/${r.full}/keys`, {
          body: {
            key: key.trim(),
            read_only: allowWrite !== true,
            ...(title === undefined ? {} : { title }),
          },
        });
        return { repo: r.full, ...deployKey(x) };
      },
    }),
    delete: op({
      description: "Remove a deploy key. Replaces `gh repo deploy-key delete`.",
      input: s.object({ repo: repoField, id: idField("Deploy key") }),
      annotations: irreversible,
      run: async ({ repo, id }) => {
        const r = await gh.repo(repo);
        await gh.rest("DELETE", `repos/${r.full}/keys/${id}`);
        return { repo: r.full, id, deleted: true };
      },
    }),
  },
  gitignore: {
    list: op({
      description:
        "Names of GitHub's gitignore templates. Replaces `gh repo gitignore list`.",
      input: s.object({}),
      annotations: reads,
      run: async () => ({
        items: strings(
          await gh.rest("GET", "gitignore/templates"),
          "templates",
        ),
      }),
    }),
    view: op({
      description:
        "One gitignore template's text. Replaces `gh repo gitignore view`.",
      input: s.object({
        name: s.string({
          description: "Template name, e.g. Node (case-sensitive).",
        }),
      }),
      annotations: reads,
      run: async ({ name }) => {
        const x = await gh.rest("GET", `gitignore/templates/${enc(name)}`);
        return { name: str(x, "name"), source: str(x, "source") };
      },
    }),
  },
  license: {
    list: op({
      description:
        "Commonly used licenses with their keys and SPDX ids. Replaces `gh repo license list`.",
      input: s.object({}),
      annotations: reads,
      run: async () => ({
        items: arr(await gh.rest("GET", "licenses"), "licenses").map(license),
      }),
    }),
    view: op({
      description:
        "One license's text, summary, permissions, conditions and limitations, by key or SPDX id. Replaces `gh repo license view`.",
      input: s.object({
        license: s.string({
          description: "License key or SPDX id, e.g. mit or Apache-2.0.",
        }),
      }),
      annotations: reads,
      run: async ({ license: key }) => {
        const x = await gh.rest("GET", `licenses/${enc(key.toLowerCase())}`);
        return {
          ...license(x),
          description: optStr(x, "description"),
          implementation: optStr(x, "implementation"),
          permissions: strings(at(x, "permissions") ?? [], "permissions"),
          conditions: strings(at(x, "conditions") ?? [], "conditions"),
          limitations: strings(at(x, "limitations") ?? [], "limitations"),
          body: str(x, "body"),
          url: optStr(x, "html_url"),
        };
      },
    }),
  },
});
