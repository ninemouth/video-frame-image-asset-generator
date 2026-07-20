#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function statusCounts(assets) {
  const counts = {};
  for (const asset of assets) {
    const status = statusOf(asset) || "missing_status";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function recommendationFor(message) {
  if (/missing role acceptance|allowed_final_statuses/.test(message)) {
    return "Rerun planning with the current skill so every prompt target carries role acceptance and final-status rules.";
  }
  if (/legacy status|unknown status/.test(message)) {
    return "Map old QA labels to ready_for_video_model, reference_only, fallback_review_required, retry_required, or failed_role.";
  }
  if (/fallback asset/.test(message)) {
    return "Move fallback crops/masks/reused images to fallback_review_required or reference_only before delivery.";
  }
  if (/plain background/.test(message)) {
    return "Regenerate the plain-background model as a true white/light-gray background asset with no scene residue.";
  }
  if (/pose pack/.test(message)) {
    return "Export individual pose images for each source action beat; keep any collage only as an overview sheet.";
  }
  if (/wardrobe detail/.test(message)) {
    return "Regenerate wardrobe details as material/construction close-ups rather than face or body crops.";
  }
  if (/no generated asset is ready/.test(message)) {
    return "Complete generation and visual QA before claiming the package has video-model-ready assets.";
  }
  return "Review this item before marking assets ready for video-model use.";
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function markdownList(items, emptyText) {
  if (!items.length) return `- ${emptyText}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function buildMarkdownReport({ manifestPath, manifest, promptTargets, generatedAssets, errors, warnings, inspectImages, requireFinal }) {
  const status = errors.length ? "failed" : warnings.length ? "passed_with_warnings" : "passed";
  const recommendations = unique([...errors, ...warnings].map(recommendationFor));
  const counts = statusCounts(generatedAssets);
  const countLines = Object.keys(counts).length
    ? Object.entries(counts).map(([key, value]) => `- \`${key}\`: ${value}`)
    : ["- No generated assets recorded."];

  return [
    "# Asset Validation Report",
    "",
    `- Status: \`${status}\``,
    `- Manifest: \`${manifestPath}\``,
    `- Run id: \`${manifest.run_id || "unknown"}\``,
    `- Prompt targets: ${promptTargets.length}`,
    `- Generated assets: ${generatedAssets.length}`,
    `- Image inspection: ${inspectImages ? "enabled" : "disabled"}`,
    `- Require final: ${requireFinal ? "yes" : "no"}`,
    "",
    "## Blocking Issues",
    "",
    markdownList(errors, "None"),
    "",
    "## Warnings",
    "",
    markdownList(warnings, "None"),
    "",
    "## Delivery Status Counts",
    "",
    countLines.join("\n"),
    "",
    "## Recommended Next Actions",
    "",
    markdownList(recommendations, "No action needed beyond final visual review."),
    "",
    "## Status Vocabulary",
    "",
    "- `ready_for_video_model`: passed role-specific visual QA and can be used as video-model input.",
    "- `reference_only`: useful for human review but not strong enough as a control asset.",
    "- `fallback_review_required`: crop, mask, reused image, or provider-blocked substitute that needs review.",
    "- `retry_required`: generation or role fulfillment should be retried.",
    "- `failed_role`: image content does not match its declared role.",
    ""
  ].join("\n");
}

async function writeReportIfRequested({ args, runDir, manifestPath, manifest, promptTargets, generatedAssets, errors, warnings, inspectImages, requireFinal }) {
  if (!args["write-report"] && !args.report) return null;
  const reportPath = path.resolve(String(args.report || path.join(runDir, "qa", "asset-validation-report.md")));
  await mkdir(path.dirname(reportPath), { recursive: true });
  const markdown = buildMarkdownReport({
    manifestPath,
    manifest,
    promptTargets,
    generatedAssets,
    errors,
    warnings,
    inspectImages,
    requireFinal
  });
  await writeFile(reportPath, markdown);
  return reportPath;
}

function statusOf(asset) {
  return asset.delivery_status || asset.final_status || asset.qa_status || asset.status || "";
}

function arrayField(value, key) {
  return Array.isArray(value?.[key]) ? value[key] : [];
}

function validateProductSceneControlBrief(brief) {
  const errors = [];
  const warnings = [];
  if (!brief || typeof brief !== "object") {
    errors.push("manifest missing product_scene_control_brief");
    return { errors, warnings };
  }

  const requiredArrays = [
    "product_role",
    "action_dependencies",
    "scene_dependencies",
    "interaction_surfaces",
    "material_detail_claims",
    "stable_invariants",
    "isolation_targets",
    "removal_targets",
    "risk_controls",
    "control_layers",
    "required_asset_roles",
    "do_not_generate"
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(brief[key]) || !brief[key].length) {
      errors.push(`product_scene_control_brief.${key} must be a non-empty array`);
    }
  }

  if (!brief.status) errors.push("product_scene_control_brief.status is required");
  if (typeof brief.generation_allowed !== "boolean") errors.push("product_scene_control_brief.generation_allowed must be boolean");
  if (!brief.evidence_completeness) errors.push("product_scene_control_brief.evidence_completeness is required");
  if (!brief.summary) warnings.push("product_scene_control_brief.summary is missing");

  if (brief.status === "blocked_requires_visual_evidence_brief" && brief.generation_allowed !== false) {
    errors.push("blocked product_scene_control_brief must set generation_allowed=false");
  }
  if (brief.generation_allowed === false && !arrayField(brief, "required_asset_roles").includes("request_pack_only")) {
    errors.push("blocked product_scene_control_brief must include request_pack_only in required_asset_roles");
  }

  const requiredRoles = arrayField(brief, "required_asset_roles");
  for (const role of ["clean_scene_plate", "camera_angle_plate_set", "surface_interaction_plate", "ui_free_scene_reconstruction", "negative_control"]) {
    if (brief.generation_allowed && !requiredRoles.includes(role)) {
      warnings.push(`product_scene_control_brief.required_asset_roles does not include ${role}`);
    }
  }

  const hasModelRole = requiredRoles.some((role) => ["clean_model_scene_reference", "clean_model_plain_background", "clean_model_pose_pack"].includes(role));
  const explicitlyModelDriven = [
    ...arrayField(brief, "product_role"),
    ...arrayField(brief, "isolation_targets"),
    ...arrayField(brief, "stable_invariants")
  ].some((value) => /model|person|human|body(?!_or_hand)|clean_model/i.test(String(value)));
  if (explicitlyModelDriven && !hasModelRole) {
    errors.push("product_scene_control_brief is model/body driven but missing clean model asset roles");
  }

  const hasHandOrBodyAction = arrayField(brief, "action_dependencies")
    .some((value) => /hand|body|person/i.test(String(value)));
  if (hasHandOrBodyAction && !requiredRoles.includes("surface_interaction_plate")) {
    errors.push("product_scene_control_brief has hand/body action but missing surface_interaction_plate role");
  }

  return { errors, warnings };
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

  const briefResult = validateProductSceneControlBrief(manifest.product_scene_control_brief);
  errors.push(...briefResult.errors);
  warnings.push(...briefResult.warnings);

  for (const target of promptTargets) {
    if (!target.id) errors.push("prompt target missing id");
    if (!target.role) errors.push(`prompt target ${target.id || "<unknown>"} missing role`);
    if (!Array.isArray(target.acceptance) || target.acceptance.length < 3) {
      errors.push(`prompt target ${target.id || "<unknown>"} missing role acceptance rules`);
    }
    if (!Array.isArray(target.allowed_final_statuses)) {
      errors.push(`prompt target ${target.id || "<unknown>"} missing allowed_final_statuses`);
    }
    if (manifest.product_scene_control_brief?.generation_allowed === false && target.ready_for_generation === true) {
      errors.push(`prompt target ${target.id || "<unknown>"} is ready_for_generation while product_scene_control_brief is blocked`);
    }
    const allowedRoles = new Set(arrayField(manifest.product_scene_control_brief, "required_asset_roles"));
    if (manifest.product_scene_control_brief?.generation_allowed === true && target.role && !allowedRoles.has(target.role)) {
      errors.push(`prompt target ${target.id || "<unknown>"} role ${target.role} is not allowed by product_scene_control_brief.required_asset_roles`);
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

  const reportPath = await writeReportIfRequested({
    args,
    runDir,
    manifestPath,
    manifest,
    promptTargets,
    generatedAssets,
    errors,
    warnings,
    inspectImages,
    requireFinal
  });

  if (errors.length) fail("asset manifest validation failed", { manifestPath, reportPath, errors, warnings });

  console.log(JSON.stringify({
    ok: true,
    manifestPath,
    reportPath,
    prompt_targets: promptTargets.length,
    generated_assets: generatedAssets.length,
    warnings
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
