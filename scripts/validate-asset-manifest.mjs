#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

function basenameOf(asset) {
  return path.basename(String(asset.final_path || asset.output_path || asset.path || ""));
}

function isFallback(asset) {
  const source = sourceOf(asset);
  const status = statusOf(asset);
  return /fallback|local_source|local crop|crop|mask|reused|previous/.test(source)
    || /fallback/.test(String(status).toLowerCase());
}

function siblingCountForAsset(asset, directoryEntries) {
  const base = basenameOf(asset).replace(/\.(png|jpe?g|webp)$/i, "");
  return directoryEntries.filter((name) =>
    name !== basenameOf(asset)
    && name.startsWith(base)
    && /\.(png|jpe?g|webp)$/i.test(name)
  ).length;
}

function ffprobeDimensions(file) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    file
  ], { encoding: "utf8" });

  if (result.status !== 0) return null;
  try {
    const payload = JSON.parse(result.stdout || "{}");
    const stream = payload.streams?.[0];
    if (!stream?.width || !stream?.height) return null;
    return { width: Number(stream.width), height: Number(stream.height) };
  } catch {
    return null;
  }
}

function sampleRgbCrop(file, crop) {
  const filter = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},format=rgb24`;
  const result = spawnSync("ffmpeg", [
    "-v", "error",
    "-i", file,
    "-vf", filter,
    "-f", "rawvideo",
    "pipe:1"
  ], { encoding: null, maxBuffer: 64 * 1024 * 1024 });

  if (result.status !== 0 || !result.stdout) return null;
  return Buffer.from(result.stdout);
}

function summarizeRgb(buffer) {
  const pixelCount = Math.floor(buffer.length / 3);
  if (!pixelCount) return null;
  let white = 0;
  let dark = 0;
  let sum = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 3;
    const r = buffer[base];
    const g = buffer[base + 1];
    const b = buffer[base + 2];
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    const y = (r + g + b) / 3;
    if (min >= 245) white += 1;
    if (max <= 15) dark += 1;
    sum += y;
  }
  return {
    pixelCount,
    whiteRatio: white / pixelCount,
    darkRatio: dark / pixelCount,
    meanLuma: sum / pixelCount
  };
}

function inspectImage(file) {
  const dims = ffprobeDimensions(file);
  if (!dims) return null;
  const edge = Math.max(1, Math.round(Math.min(dims.width, dims.height) * 0.08));
  const center = {
    x: Math.floor(dims.width * 0.25),
    y: Math.floor(dims.height * 0.25),
    width: Math.max(1, Math.floor(dims.width * 0.5)),
    height: Math.max(1, Math.floor(dims.height * 0.5))
  };
  const crops = {
    top: { x: 0, y: 0, width: dims.width, height: edge },
    bottom: { x: 0, y: dims.height - edge, width: dims.width, height: edge },
    left: { x: 0, y: 0, width: edge, height: dims.height },
    right: { x: dims.width - edge, y: 0, width: edge, height: dims.height },
    center
  };

  const stats = {};
  for (const [key, crop] of Object.entries(crops)) {
    const sample = sampleRgbCrop(file, crop);
    if (!sample) return null;
    stats[key] = summarizeRgb(sample);
  }

  const borderStats = [stats.top, stats.bottom, stats.left, stats.right].filter(Boolean);
  const borderWhiteRatio = borderStats.reduce((sum, stat) => sum + stat.whiteRatio, 0) / borderStats.length;
  const borderDarkRatio = borderStats.reduce((sum, stat) => sum + stat.darkRatio, 0) / borderStats.length;
  const borderMeanLuma = borderStats.reduce((sum, stat) => sum + stat.meanLuma, 0) / borderStats.length;
  const centerWhiteRatio = stats.center.whiteRatio;
  const centerMeanLuma = stats.center.meanLuma;
  const fullAspect = dims.width / dims.height;
  return {
    width: dims.width,
    height: dims.height,
    aspect: fullAspect,
    borderWhiteRatio,
    borderDarkRatio,
    borderMeanLuma,
    centerWhiteRatio,
    centerMeanLuma
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const manifestPath = path.resolve(String(args.manifest || path.join(runDir, "output", "asset-manifest.json")));
  const requireFinal = Boolean(args["require-final"]);
  const inspectImages = Boolean(args["inspect-images"]);

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

    if (inspectImages && asset.final_path) {
      const file = path.resolve(runDir, asset.final_path);
      if (existsSync(file)) {
        const metrics = inspectImage(file);
        if (!metrics) {
          warnings.push(`unable to inspect image metrics for ${id}`);
          continue;
        }

        if (asset.role === "clean_model_plain_background") {
          if (metrics.borderWhiteRatio < 0.55 || metrics.borderMeanLuma < 190) {
            errors.push(`plain background asset ${id} does not look plain enough at the border`);
          }
          if (metrics.centerWhiteRatio > 0.96 && metrics.centerMeanLuma > 240) {
            warnings.push(`plain background asset ${id} looks almost empty; confirm a visible subject remains`);
          }
        }

        if (asset.role === "wardrobe_detail") {
          if (metrics.borderWhiteRatio < 0.35 && metrics.borderMeanLuma < 150) {
            warnings.push(`wardrobe detail asset ${id} may be too dark or too busy at the border`);
          }
        }

        if (asset.role === "clean_model_pose_pack") {
          let siblingCount = 0;
          try {
            siblingCount = siblingCountForAsset(asset, readdirSync(path.dirname(file)));
          } catch {
            siblingCount = 0;
          }
          if (metrics.width > metrics.height && metrics.borderWhiteRatio > 0.55) {
            warnings.push(`pose pack asset ${id} looks collage-like; individual pose files should be delivered alongside it`);
          }
          if (!siblingCount && !/-(\d{2,}|left|right|front|back|side|three-quarter)$/i.test(basenameOf(asset))) {
            if (status === "ready_for_video_model") {
              errors.push(`pose pack asset ${id} is marked ready_for_video_model but has no obvious individual pose siblings next to it`);
            } else {
              warnings.push(`pose pack asset ${id} has no obvious individual pose siblings next to it`);
            }
          }
        }
      } else {
        warnings.push(`image file missing for ${id}: ${file}`);
      }
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
