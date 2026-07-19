#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = path.resolve(String(args.source || process.cwd()));
  const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex");
  const target = path.resolve(String(args.target || path.join(codexHome, "skills", "video-frame-image-asset-generator")));
  if (source === target) {
    console.log(JSON.stringify({ source, target, skipped: true, reason: "source equals target" }, null, 2));
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(source, target, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(source, src);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      return !parts.includes("node_modules") && !parts.includes(".git") && !parts.includes("work");
    }
  });

  console.log(JSON.stringify({ source, target, synced: true }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
