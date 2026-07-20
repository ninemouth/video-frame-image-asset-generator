#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const statusDirs = {
  ready_for_video_model: "ready",
  reference_only: "reference-only",
  fallback_review_required: "fallback-review",
  retry_required: "retry-required",
  failed_role: "failed-role"
};

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

function statusOf(asset) {
  return asset.delivery_status || asset.final_status || asset.qa_status || asset.status || "unknown";
}

function safeName(value) {
  return String(value || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "asset";
}

function rel(runDir, file) {
  return path.relative(runDir, file).split(path.sep).join("/");
}

function assetSourcePath(runDir, asset) {
  const value = asset.final_path || asset.output_path || asset.path;
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(runDir, value);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const manifestPath = path.resolve(String(args.manifest || path.join(runDir, "output", "asset-manifest.json")));
  const outputDir = path.resolve(String(args.output || path.join(runDir, "final-assets")));
  const clean = Boolean(args.clean);

  if (!existsSync(manifestPath)) {
    throw new Error(`asset manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const assets = Array.isArray(manifest.generated_assets) ? manifest.generated_assets : [];
  const copied = [];
  const missing = [];

  if (clean) {
    await rm(outputDir, { recursive: true, force: true });
  }

  for (const dir of Object.values(statusDirs)) {
    await mkdir(path.join(outputDir, dir), { recursive: true });
  }
  await mkdir(path.join(outputDir, "unknown"), { recursive: true });

  for (const asset of assets) {
    const status = statusOf(asset);
    const bucket = statusDirs[status] || "unknown";
    const source = assetSourcePath(runDir, asset);
    const sourceExists = source ? existsSync(source) : false;
    const ext = source ? path.extname(source) || ".png" : ".png";
    const targetName = safeName(`${asset.id || path.basename(source || "asset", ext)}${ext}`);
    const target = path.join(outputDir, bucket, targetName);

    if (!sourceExists) {
      missing.push({
        id: asset.id || null,
        role: asset.role || null,
        status,
        source: source ? rel(runDir, source) : null,
        bucket
      });
      continue;
    }

    await copyFile(source, target);
    copied.push({
      id: asset.id || null,
      role: asset.role || null,
      status,
      bucket,
      source: rel(runDir, source),
      target: rel(runDir, target)
    });
  }

  const counts = {};
  for (const item of copied) counts[item.bucket] = (counts[item.bucket] || 0) + 1;
  for (const item of missing) counts[item.bucket] = counts[item.bucket] || 0;

  const readme = [
    "# Final Assets",
    "",
    "Assets are physically separated by delivery status so users do not need to interpret the manifest before opening files.",
    "",
    "## Directories",
    "",
    "- `ready/`: passed role QA and can be used as video-model input.",
    "- `reference-only/`: useful for review, not strong enough as a control asset.",
    "- `fallback-review/`: local crop, mask, reused image, or substitute that needs review.",
    "- `retry-required/`: prompt target or provider generation should be retried.",
    "- `failed-role/`: image does not match its declared asset role.",
    "- `unknown/`: missing or unsupported status.",
    "",
    "## Counts",
    "",
    ...Object.values(statusDirs).map((dir) => `- \`${dir}\`: ${counts[dir] || 0}`),
    `- \`unknown\`: ${counts.unknown || 0}`,
    `- missing source files: ${missing.length}`,
    "",
    "## Missing Source Files",
    "",
    ...(missing.length
      ? missing.map((item) => `- ${item.id || "unknown"} (${item.status}) -> ${item.source || "no source path"}`)
      : ["- None"]),
    ""
  ].join("\n");

  const index = {
    schema: "video-frame-image-asset-generator/final-assets-index/v1",
    run_id: manifest.run_id || null,
    created_at: new Date().toISOString(),
    manifest: rel(runDir, manifestPath),
    output_dir: rel(runDir, outputDir),
    copied,
    missing
  };

  await writeFile(path.join(outputDir, "README.md"), readme);
  await writeFile(path.join(outputDir, "final-assets-index.json"), `${JSON.stringify(index, null, 2)}\n`);

  manifest.final_assets_directories = {
    output_dir: rel(runDir, outputDir),
    index: rel(runDir, path.join(outputDir, "final-assets-index.json")),
    readme: rel(runDir, path.join(outputDir, "README.md")),
    updated_at: new Date().toISOString()
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    copied: copied.length,
    missing: missing.length,
    index: path.join(outputDir, "final-assets-index.json")
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
