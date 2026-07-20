#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
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

function rel(runDir, file) {
  return path.relative(runDir, file).split(path.sep).join("/");
}

async function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

async function listFiles(root, current = root) {
  const { readdir, stat } = await import("node:fs/promises");
  if (!existsSync(current)) return [];
  const entries = await readdir(current);
  const files = [];
  for (const entry of entries) {
    if (entry === ".DS_Store") continue;
    const absolute = path.join(current, entry);
    const stats = await stat(absolute);
    if (stats.isDirectory()) {
      files.push(...await listFiles(root, absolute));
    } else if (stats.isFile()) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function createZip(sourceDir, archivePath) {
  const parent = path.dirname(sourceDir);
  const base = path.basename(sourceDir);
  const platform = os.platform();

  if (platform === "darwin") {
    return spawnSync("ditto", ["-c", "-k", "--keepParent", "--norsrc", "--noextattr", base, archivePath], {
      cwd: parent,
      encoding: "utf8"
    });
  }

  if (platform === "win32") {
    return spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Compress-Archive",
      "-Path",
      base,
      "-DestinationPath",
      archivePath,
      "-Force"
    ], {
      cwd: parent,
      encoding: "utf8"
    });
  }

  return spawnSync("zip", ["-r", archivePath, base, "-x", "*.DS_Store"], {
    cwd: parent,
    encoding: "utf8"
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const manifestPath = path.resolve(String(args.manifest || path.join(runDir, "output", "asset-manifest.json")));
  const finalDir = path.resolve(String(args["final-dir"] || path.join(runDir, "final-assets")));
  const deliveryDir = path.resolve(String(args.output || path.join(runDir, "delivery", "final-assets-handoff")));
  const archivePath = path.resolve(String(args.zip || path.join(path.dirname(deliveryDir), `${path.basename(deliveryDir)}.zip`)));
  const clean = Boolean(args.clean);
  const noZip = Boolean(args["no-zip"]);

  if (!existsSync(finalDir)) {
    throw new Error(`final assets directory not found: ${finalDir}. Run organize-final-assets.mjs first.`);
  }

  const finalIndexPath = path.join(finalDir, "final-assets-index.json");
  const finalIndex = await readJson(finalIndexPath);
  if (!finalIndex?.final_only) {
    throw new Error(`final-assets-index.json must exist and include final_only: true. Run organize-final-assets.mjs first: ${finalIndexPath}`);
  }

  if (clean) {
    await rm(deliveryDir, { recursive: true, force: true });
    if (!noZip) await rm(archivePath, { force: true });
  }

  await mkdir(deliveryDir, { recursive: true });
  const copiedFinalDir = path.join(deliveryDir, "final-assets");
  await rm(copiedFinalDir, { recursive: true, force: true });
  await cp(finalDir, copiedFinalDir, { recursive: true });

  const finalFiles = await listFiles(copiedFinalDir);
  const readyFiles = finalFiles.filter((file) => file.startsWith("ready/"));
  const manifest = await readJson(manifestPath, {});
  const handoffManifest = {
    schema: "video-frame-image-asset-generator/clean-final-handoff/v1",
    run_id: manifest.run_id || finalIndex.run_id || null,
    created_at: new Date().toISOString(),
    final_only: true,
    source_manifest: rel(runDir, manifestPath),
    source_final_index: rel(runDir, finalIndexPath),
    included_root: "final-assets",
    included_statuses: ["ready_for_video_model"],
    included_files: finalFiles,
    ready_asset_files: readyFiles,
    excluded_roots: [
      "review-assets",
      "generated-assets",
      "local-reference-assets",
      "qa",
      "provider",
      "planning"
    ],
    excluded_statuses: [
      "reference_only",
      "fallback_review_required",
      "retry_required",
      "failed_role"
    ]
  };

  const readme = [
    "# Clean Final Asset Handoff",
    "",
    "This handoff contains only the `final-assets/` directory from the run.",
    "",
    "It excludes review, fallback, retry-required, failed-role, provider, planning, QA, and internal generated asset folders.",
    "",
    "## Counts",
    "",
    `- ready asset files: ${readyFiles.length}`,
    `- total included files: ${finalFiles.length}`,
    "",
    readyFiles.length
      ? "Use the files under `final-assets/ready/` as direct video-model inputs."
      : "No files are currently ready for video-model input. Treat this as a failed or review-required generation, not a usable final asset pack.",
    ""
  ].join("\n");

  await writeFile(path.join(deliveryDir, "README.md"), readme);
  await writeFile(path.join(deliveryDir, "clean-final-handoff-manifest.json"), `${JSON.stringify(handoffManifest, null, 2)}\n`);

  let archive = null;
  if (!noZip) {
    await mkdir(path.dirname(archivePath), { recursive: true });
    const zipResult = createZip(deliveryDir, archivePath);
    if (zipResult.status !== 0) {
      throw new Error(`failed to create clean final archive\n${zipResult.stderr || zipResult.stdout}`);
    }
    archive = archivePath;
  }

  const updatedManifest = {
    ...manifest,
    clean_final_handoff: {
      output_dir: rel(runDir, deliveryDir),
      manifest: rel(runDir, path.join(deliveryDir, "clean-final-handoff-manifest.json")),
      archive: archive ? rel(runDir, archive) : null,
      final_only: true,
      ready_asset_count: readyFiles.length,
      updated_at: new Date().toISOString()
    }
  };
  if (existsSync(manifestPath)) {
    await writeFile(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    ok: true,
    runDir,
    deliveryDir,
    archive,
    finalOnly: true,
    readyAssetFiles: readyFiles.length,
    includedFiles: finalFiles.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
