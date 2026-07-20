#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const allowedFinalStatuses = new Set([
  "ready_for_video_model",
  "reference_only",
  "fallback_review_required",
  "retry_required",
  "failed_role"
]);

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

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
  process.exit(1);
}

function statusOf(asset) {
  return asset.delivery_status || asset.final_status || asset.qa_status || asset.status || "";
}

function sourceOf(asset) {
  return String(asset.source || asset.provider || asset.generation_source || "").toLowerCase();
}

function isFallback(asset) {
  const source = sourceOf(asset);
  const status = statusOf(asset);
  return /fallback|local_source|local crop|crop|mask|reused|previous/.test(source)
    || /fallback/.test(String(status).toLowerCase());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const manifestPath = path.resolve(String(args.manifest || path.join(runDir, "output", "asset-manifest.json")));
  const requireFinal = Boolean(args["require-final"]);

  if (!existsSync(manifestPath)) fail("asset manifest not found", { manifestPath });

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const promptTargets = Array.isArray(manifest.prompt_targets) ? manifest.prompt_targets : [];
  const generatedAssets = Array.isArray(manifest.generated_assets) ? manifest.generated_assets : [];
  const errors = [];
  const warnings = [];

  if (!manifest.schema?.includes("asset-manifest")) {
    errors.push("manifest schema must identify an asset-manifest");
  }

  if (!promptTargets.length) {
    errors.push("manifest.prompt_targets must not be empty");
  }

  for (const target of promptTargets) {
    if (!target.id) errors.push("prompt target missing id");
    if (!target.role) errors.push(`prompt target ${target.id || "<unknown>"} missing role`);
    if (!Array.isArray(target.acceptance) || target.acceptance.length < 3) {
      errors.push(`prompt target ${target.id || "<unknown>"} missing role acceptance rules`);
    }
    if (!Array.isArray(target.allowed_final_statuses)) {
      errors.push(`prompt target ${target.id || "<unknown>"} missing allowed_final_statuses`);
    }
  }

  for (const asset of generatedAssets) {
    const id = asset.id || asset.final_path || "<unknown>";
    const status = statusOf(asset);
    if (!status) {
      errors.push(`generated asset ${id} missing delivery/final/qa status`);
      continue;
    }

    if (allowedFinalStatuses.has(status)) continue;

    if (/accepted|pass/i.test(status)) {
      warnings.push(`generated asset ${id} uses legacy status "${status}"; map it to ready_for_video_model, reference_only, fallback_review_required, retry_required, or failed_role`);
    } else if (/pending|planned|blocked/i.test(status)) {
      warnings.push(`generated asset ${id} is not final: ${status}`);
    } else {
      errors.push(`generated asset ${id} has unknown status "${status}"`);
    }
  }

  for (const asset of generatedAssets) {
    const id = asset.id || asset.final_path || "<unknown>";
    const status = statusOf(asset);
    if (isFallback(asset) && status === "ready_for_video_model") {
      errors.push(`fallback asset ${id} cannot be ready_for_video_model`);
    }
  }

  if (requireFinal) {
    const finals = generatedAssets.filter((asset) => statusOf(asset) === "ready_for_video_model");
    if (!finals.length) errors.push("--require-final was set but no generated asset is ready_for_video_model");
  }

  if (errors.length) fail("asset manifest validation failed", { manifestPath, errors, warnings });

  console.log(JSON.stringify({
    ok: true,
    manifestPath,
    prompt_targets: promptTargets.length,
    generated_assets: generatedAssets.length,
    warnings
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
