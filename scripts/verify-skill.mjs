#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "package.json",
  "references/frame-source-contract.md",
  "references/asset-taxonomy.md",
  "references/prompt-contract.md",
  "references/provider-routing.md",
  "scripts/configure-image-provider.mjs",
  "scripts/create-asset-run.mjs",
  "scripts/plan-image-assets.mjs",
  "scripts/resolve-image-provider.mjs",
  "scripts/third-party-image-runtime.mjs",
  "scripts/sync-to-codex-skill.mjs"
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`${file} failed node --check\n${result.stderr || result.stdout}`);
  }
}

async function main() {
  for (const file of requiredFiles) {
    if (!existsSync(path.join(root, file))) fail(`missing required file: ${file}`);
  }

  const skill = await readFile(path.join(root, "SKILL.md"), "utf8");
  if (!skill.startsWith("---\nname: video-frame-image-asset-generator\n")) {
    fail("SKILL.md frontmatter name is invalid");
  }
  for (const term of ["native_codex", "third_party_api", "request_pack_only", "imagegen", "frame-index.json"]) {
    if (!skill.includes(term)) fail(`SKILL.md missing required term: ${term}`);
  }

  const provider = await readFile(path.join(root, "references", "provider-routing.md"), "utf8");
  for (const term of ["VIDEO_IMAGE_PROVIDER_API_KEY", "THINKAI_API_KEY", "CHARLIE_KEY", "/images/generations", "image-provider.json"]) {
    if (!provider.includes(term)) fail(`provider routing missing required term: ${term}`);
  }

  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (pkg.repository?.url !== "https://github.com/ninemouth/video-frame-image-asset-generator.git") {
    fail("package.json repository URL must point to the public GitHub repo");
  }
  if (!pkg.scripts?.["configure:image-provider"]) {
    fail("package.json missing configure:image-provider script");
  }

  for (const file of requiredFiles.filter((file) => file.endsWith(".mjs"))) {
    checkSyntax(file);
  }

  console.log(JSON.stringify({
    ok: true,
    root,
    files: requiredFiles.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
