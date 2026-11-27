// Downloads and uploads: bodies that are not JSON and hosts that are not the API.
import { SurfaceError } from "../vendor/surface/index.ts";
import type { Deps, GitHub } from "./types.ts";
import { UPLOAD_ORIGIN, type Wire } from "./wire.ts";

export const createTransfer = (
  deps: Deps,
  wire: Wire,
): Pick<GitHub, "logs" | "bytes" | "content" | "upload"> => {
  // GitHub answers a download with a redirect to blob storage; that second request must not carry the token.
  const follow = async (
    path: string,
    accept: string | undefined,
    what: string,
    expiry: string,
  ): Promise<Response> => {
    const target = wire.url(path, undefined);
    const res = await wire.send(
      "GET",
      target,
      accept === undefined ? {} : { accept },
    );
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location)
        throw new SurfaceError(
          "invalid_response",
          `${what} redirect had no location`,
          "retry",
        );
      const blob = await deps.fetch(location, { method: "GET" });
      if (!blob.ok)
        throw new SurfaceError(
          blob.status === 404 || blob.status === 410 ? "not_found" : "http",
          `${what} download ${blob.status}`,
          expiry,
        );
      return blob;
    }
    if (!res.ok) return wire.fail("GET", target, res);
    return res;
  };

  return {
    logs: async (path) =>
      (
        await follow(
          path,
          undefined,
          "log",
          "logs expire after the retention window",
        )
      ).text(),
    bytes: async (path, accept) =>
      new Uint8Array(
        await (
          await follow(
            path,
            accept,
            "file",
            "it was deleted or expired (artifacts expire after the retention window)",
          )
        ).arrayBuffer(),
      ),
    content: async (from) => {
      const target = new URL(from);
      if (target.protocol !== "https:")
        throw new SurfaceError(
          "usage",
          `not an https URL: ${target.origin}`,
          "pass the URL GitHub returned (raw_url, bundle_url)",
        );
      const res = await deps.fetch(target.href, { method: "GET" });
      if (!res.ok)
        throw new SurfaceError(
          res.status === 404 || res.status === 410 ? "not_found" : "http",
          `content download ${res.status}`,
          "read the resource again for a fresh URL; signed URLs expire",
        );
      return new Uint8Array(await res.arrayBuffer());
    },
    upload: async (to, body, contentType) => {
      const target = new URL(to);
      if (target.origin !== UPLOAD_ORIGIN)
        throw new SurfaceError(
          "usage",
          `not a GitHub upload URL: ${target.origin}`,
          "pass the upload_url GitHub returned for the release",
        );
      const res = await wire.send("POST", target, {
        raw: { bytes: body, contentType },
      });
      if (!res.ok) return wire.fail("POST", target, res);
      return wire.decode(res);
    },
  };
};
