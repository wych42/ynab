import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_MONEY_SPEC = "../shared/money.mjs";
const ENTRY = "server/index.mjs";

function readRepo(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function relativeImportSpecs(source) {
  const specs = [];
  const re = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    if (match[1].startsWith(".")) specs.push(match[1]);
  }
  return specs;
}

function repoModulesReachableFrom(entryRel) {
  const pending = [entryRel.replace(/\\/g, "/")];
  const visited = new Set();
  while (pending.length) {
    const rel = pending.pop();
    if (visited.has(rel)) continue;
    visited.add(rel);
    const abs = path.join(repoRoot, rel);
    if (!abs.endsWith(".mjs") || !fs.existsSync(abs)) continue;
    const dir = path.posix.dirname(rel);
    for (const spec of relativeImportSpecs(fs.readFileSync(abs, "utf8"))) {
      const resolved = path.posix.normalize(path.posix.join(dir, spec));
      if (resolved.startsWith("..")) continue;
      pending.push(resolved);
    }
  }
  return visited;
}

function repoPathFromDocker(p) {
  let s = p.replace(/\\/g, "/");
  if (s.startsWith("/app/")) s = s.slice("/app/".length);
  else if (s === "/app") s = "";
  s = s.replace(/^\.\//, "");
  if (s === ".") s = "";
  return s.replace(/\/+$/, "");
}

function runtimeCopyInstructions(dockerfile) {
  const copies = [];
  let inRuntime = false;
  for (const raw of dockerfile.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const from = line.match(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/i);
    if (from) {
      inRuntime = from[1] === "runtime";
      continue;
    }
    if (!inRuntime || !/^COPY\b/.test(line)) continue;
    const tokens = line.split(/\s+/).slice(1).filter((t) => !t.startsWith("--"));
    if (tokens.length < 2) continue;
    copies.push({ sources: tokens.slice(0, -1), dest: tokens[tokens.length - 1] });
  }
  return copies;
}

function copyPlacesFile(source, dest, file) {
  const src = repoPathFromDocker(source);
  const dst = repoPathFromDocker(dest);
  if (!src) return false;
  const destIsDir = dst === "" || !path.posix.extname(dst);
  if (src === file) {
    const placed = destIsDir ? path.posix.join(dst, path.posix.basename(file)) : dst;
    return placed === file;
  }
  if (file === src || file.startsWith(`${src}/`)) {
    if (!destIsDir) return false;
    const rel = file.slice(src.length + 1);
    const placed = dst === "" ? rel : path.posix.join(dst, rel);
    return placed === file;
  }
  return false;
}

function runtimeCovers(copies, file) {
  return copies.some((copy) =>
    copy.sources.some((source) => copyPlacesFile(source, copy.dest, file)),
  );
}

describe("Docker runtime-stage copy contract", () => {
  it("copies shared/money.mjs because server/money.mjs imports it on the index.mjs graph", () => {
    const moneySource = readRepo("server/money.mjs");
    const moneySpecs = relativeImportSpecs(moneySource);
    expect(moneySpecs).toContain(SHARED_MONEY_SPEC);

    const sharedMoney = path.posix.normalize(path.posix.join("server", SHARED_MONEY_SPEC));
    expect(sharedMoney).toBe("shared/money.mjs");
    expect(fs.existsSync(path.join(repoRoot, sharedMoney))).toBe(true);

    const reachable = repoModulesReachableFrom(ENTRY);
    expect(reachable.has("server/money.mjs")).toBe(true);
    expect(reachable.has(sharedMoney)).toBe(true);

    const copies = runtimeCopyInstructions(readRepo("Dockerfile"));
    expect(copies.length).toBeGreaterThan(0);

    const missing = [...reachable].filter((rel) => rel.endsWith(".mjs") && !runtimeCovers(copies, rel));
    expect(missing).toEqual([]);
    expect(runtimeCovers(copies, sharedMoney)).toBe(true);
  });
});
