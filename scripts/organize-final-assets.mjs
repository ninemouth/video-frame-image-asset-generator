#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const finalStatusDirs = {
  ready_for_video_model: "ready"
};

const reviewStatusDirs = {
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
  const reviewDir = path.resolve(String(args["review-output"] || path.join(runDir, "review-assets")));
  const clean = Boolean(args.clean);

  if (!existsSync(manifestPath)) {
    throw new Error(`asset manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const assets = Array.isArray(manifest.generated_assets) ? manifest.generated_assets : [];
  const copiedFinal = [];
  const copiedReview = [];
  const missing = [];

  if (clean) {
    await rm(outputDir, { recursive: true, force: true });
    await rm(reviewDir, { recursive: true, force: true });
  }

  for (const dir of Object.values(finalStatusDirs)) {
    await mkdir(path.join(outputDir, dir), { recursive: true });
  }
  for (const dir of Object.values(reviewStatusDirs)) {
    await mkdir(path.join(reviewDir, dir), { recursive: true });
  }
  await mkdir(path.join(reviewDir, "unknown"), { recursive: true });

  for (const asset of assets) {
    const status = statusOf(asset);
    const isFinal = status === "ready_for_video_model";
    const bucket = isFinal ? finalStatusDirs[status] : reviewStatusDirs[status] || "unknown";
    const bucketRoot = isFinal ? outputDir : reviewDir;
    const source = assetSourcePath(runDir, asset);
    const sourceExists = source ? existsSync(source) : false;
    const ext = source ? path.extname(source) || ".png" : ".png";
    const targetName = safeName(`${asset.id || path.basename(source || "asset", ext)}${ext}`);
    const target = path.join(bucketRoot, bucket, targetName);

    if (!sourceExists) {
      missing.push({
        id: asset.id || null,
        role: asset.role || null,
        status,
        source: source ? rel(runDir, source) : null,
        bucket,
        destination: isFinal ? "final-assets" : "review-assets"
      });
      continue;
    }

    await copyFile(source, target);
    const copiedItem = {
      id: asset.id || null,
      role: asset.role || null,
      status,
      bucket,
      source: rel(runDir, source),
      target: rel(runDir, target)
    };
    if (isFinal) copiedFinal.push(copiedItem);
    else copiedReview.push(copiedItem);
  }

  const finalCounts = {};
  for (const item of copiedFinal) finalCounts[item.bucket] = (finalCounts[item.bucket] || 0) + 1;
  const reviewCounts = {};
  for (const item of copiedReview) reviewCounts[item.bucket] = (reviewCounts[item.bucket] || 0) + 1;
  for (const item of missing) {
    if (item.destination === "final-assets") finalCounts[item.bucket] = finalCounts[item.bucket] || 0;
    else reviewCounts[item.bucket] = reviewCounts[item.bucket] || 0;
  }

  const readme = [
    "# Final Assets",
    "",
    "This directory contains only assets marked `ready_for_video_model`.",
    "",
    copiedFinal.length
      ? "Use files here as direct video-model inputs after checking the manifest."
      : "No assets are currently marked `ready_for_video_model`. Do not use review or fallback assets as final video-model inputs.",
    "",
    "## Directories",
    "",
    "- `ready/`: passed role QA and can be used as video-model input.",
    "",
    "## Counts",
    "",
    ...Object.values(finalStatusDirs).map((dir) => `- \`${dir}\`: ${finalCounts[dir] || 0}`),
    `- review assets moved outside final directory: ${copiedReview.length}`,
    `- missing source files: ${missing.filter((item) => item.destination === "final-assets").length}`,
    "",
    "## Review Assets",
    "",
    `Non-final assets are isolated under \`${rel(runDir, reviewDir)}\` for audit only.`,
    "",
    "- `reference-only/`: useful for review, not strong enough as a control asset.",
    "- `fallback-review/`: local crop, mask, reused image, or substitute that needs review.",
    "- `retry-required/`: prompt target or provider generation should be retried.",
    "- `failed-role/`: image does not match its declared asset role.",
    "- `unknown/`: missing or unsupported status.",
    "",
    "## Missing Source Files",
    "",
    ...(missing.filter((item) => item.destination === "final-assets").length
      ? missing
        .filter((item) => item.destination === "final-assets")
        .map((item) => `- ${item.id || "unknown"} (${item.status}) -> ${item.source || "no source path"}`)
      : ["- None"]),
    ""
  ].join("\n");

  const reviewReadme = [
    "# Review Assets",
    "",
    "This directory contains non-final assets for audit, diagnosis, or manual reference. These files are not clean final deliverables and must not be used directly as video-model inputs.",
    "",
    "## Directories",
    "",
    "- `reference-only/`: useful for review, not strong enough as a control asset.",
    "- `fallback-review/`: local crop, mask, reused image, or substitute that needs review.",
    "- `retry-required/`: prompt target or provider generation should be retried.",
    "- `failed-role/`: image does not match its declared asset role.",
    "- `unknown/`: missing or unsupported status.",
    "",
    "## Counts",
    "",
    ...Object.values(reviewStatusDirs).map((dir) => `- \`${dir}\`: ${reviewCounts[dir] || 0}`),
    `- \`unknown\`: ${reviewCounts.unknown || 0}`,
    `- missing source files: ${missing.filter((item) => item.destination === "review-assets").length}`,
    "",
    "## Missing Source Files",
    "",
    ...(missing.filter((item) => item.destination === "review-assets").length
      ? missing
        .filter((item) => item.destination === "review-assets")
        .map((item) => `- ${item.id || "unknown"} (${item.status}) -> ${item.source || "no source path"}`)
      : ["- None"]),
    ""
  ].join("\n");

  const index = {
    schema: "video-frame-image-asset-generator/final-assets-index/v1",
    run_id: manifest.run_id || null,
    created_at: new Date().toISOString(),
    manifest: rel(runDir, manifestPath),
    output_dir: rel(runDir, outputDir),
    final_only: true,
    copied: copiedFinal,
    review_assets: {
      output_dir: rel(runDir, reviewDir),
      count: copiedReview.length,
      index: rel(runDir, path.join(reviewDir, "review-assets-index.json"))
    },
    missing: missing.filter((item) => item.destination === "final-assets")
  };

  const reviewIndex = {
    schema: "video-frame-image-asset-generator/review-assets-index/v1",
    run_id: manifest.run_id || null,
    created_at: new Date().toISOString(),
    manifest: rel(runDir, manifestPath),
    output_dir: rel(runDir, reviewDir),
    copied: copiedReview,
    missing: missing.filter((item) => item.destination === "review-assets")
  };

  await writeFile(path.join(outputDir, "README.md"), readme);
  await writeFile(path.join(outputDir, "final-assets-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  await writeFile(path.join(reviewDir, "README.md"), reviewReadme);
  await writeFile(path.join(reviewDir, "review-assets-index.json"), `${JSON.stringify(reviewIndex, null, 2)}\n`);

  manifest.final_assets_directories = {
    output_dir: rel(runDir, outputDir),
    index: rel(runDir, path.join(outputDir, "final-assets-index.json")),
    readme: rel(runDir, path.join(outputDir, "README.md")),
    final_only: true,
    review_output_dir: rel(runDir, reviewDir),
    review_index: rel(runDir, path.join(reviewDir, "review-assets-index.json")),
    review_readme: rel(runDir, path.join(reviewDir, "README.md")),
    updated_at: new Date().toISOString()
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    reviewDir,
    copied: copiedFinal.length,
    reviewCopied: copiedReview.length,
    missing: missing.length,
    index: path.join(outputDir, "final-assets-index.json")
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
