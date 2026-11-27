// How a gist is addressed (id or URL) and how GitHub's gist JSON is trimmed for results.
import { basename } from "node:path";
import { s, SurfaceError } from "../vendor/surface/index.ts";
import { at, bool, isObj, obj, optStr, str } from "./read.ts";

export const gistField = s.string({
  description: "Gist id or its gist.github.com URL.",
});

export const gistId = (given: string): string => {
  const last = given
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop();
  const id = last?.replace(/\.git$/, "") ?? "";
  if (!/^[\da-f]+$/i.test(id))
    throw new SurfaceError(
      "usage",
      `not a gist id or URL: ${given}`,
      "pass the id from `gist list` or a https://gist.github.com/<user>/<id> URL",
    );
  return id;
};

export const fileList = (g: unknown) =>
  Object.values(obj(at(g, "files"), "files")).flatMap((f) =>
    isObj(f) ? [f] : [],
  );

export const gistSummary = (g: unknown) => ({
  id: str(g, "id"),
  description: optStr(g, "description"),
  public: bool(g, "public"),
  url: str(g, "html_url"),
  updatedAt: optStr(g, "updated_at"),
});

export const gistWritten = (g: unknown) => ({
  ...gistSummary(g),
  files: fileList(g).map((f) => str(f, "filename")),
});

export const readPaths = async (paths: readonly string[]) =>
  Object.fromEntries(
    await Promise.all(
      paths.map(async (p) => [
        basename(p),
        { content: await Bun.file(p).text() },
      ]),
    ),
  );

export const contentsOf = (files: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, { content }]),
  );
