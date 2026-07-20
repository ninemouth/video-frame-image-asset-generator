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
  "references/scene-stability-assets.md",
  "references/prompt-contract.md",
  "references/qa-delivery-contract.md",
  "references/provider-routing.md",
  "scripts/configure-image-provider.mjs",
  "scripts/create-asset-run.mjs",
  "scripts/organize-final-assets.mjs",
  "scripts/plan-image-assets.mjs",
  "scripts/resolve-image-provider.mjs",
  "scripts/third-party-image-runtime.mjs",
  "scripts/validate-asset-manifest.mjs",
  "scripts/test-asset-qa-fixtures.mjs",
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
  for (const term of ["native_codex", "third_party_api", "request_pack_only", "imagegen", "frame-index.json", "scene-stability-assets.md", "qa-delivery-contract.md", "fallback_review_required", "--inspect-images"]) {
    if (!skill.includes(term)) fail(`SKILL.md missing required term: ${term}`);
  }

  const planner = await readFile(path.join(root, "scripts", "plan-image-assets.mjs"), "utf8");
  for (const term of ["visual_evidence_brief", "ready_for_generation", "camera_angle_plate_set", "surface_interaction_plate", "clean_model_scene_reference", "clean_model_plain_background", "clean_model_pose_pack", "request_pack_only", "ready_for_video_model", "fallback_review_required", "failed_role", "plain_background_must_be_plain"]) {
    if (!planner.includes(term)) fail(`plan-image-assets.mjs missing stability guard: ${term}`);
  }

  const manifestValidator = await readFile(path.join(root, "scripts", "validate-asset-manifest.mjs"), "utf8");
  for (const term of ["allowedFinalStatuses", "ready_for_video_model", "fallback_review_required", "failed_role", "acceptance", "asset-validation-report.md", "Recommended Next Actions"]) {
    if (!manifestValidator.includes(term)) fail(`validate-asset-manifest.mjs missing required term: ${term}`);
  }

  const thirdPartyRuntime = await readFile(path.join(root, "scripts", "third-party-image-runtime.mjs"), "utf8");
  for (const term of ["updateAssetManifest", "pending_visual_review", "reference_only", "retry_required", "generated_assets", "prompt_targets", "--no-update-manifest"]) {
    if (!thirdPartyRuntime.includes(term)) fail(`third-party-image-runtime.mjs missing manifest update behavior: ${term}`);
  }

  const finalAssetsOrganizer = await readFile(path.join(root, "scripts", "organize-final-assets.mjs"), "utf8");
  for (const term of ["ready_for_video_model", "reference-only", "fallback-review", "retry-required", "failed-role", "final-assets-index.json"]) {
    if (!finalAssetsOrganizer.includes(term)) fail(`organize-final-assets.mjs missing final asset directory behavior: ${term}`);
  }

  const provider = await readFile(path.join(root, "references", "provider-routing.md"), "utf8");
  for (const term of ["VIDEO_IMAGE_PROVIDER_API_KEY", "THINKAI_API_KEY", "CHARLIE_KEY", "/images/generations", "image-provider.json", "pending_visual_review"]) {
    if (!provider.includes(term)) fail(`provider routing missing required term: ${term}`);
  }

  const qaContract = await readFile(path.join(root, "references", "qa-delivery-contract.md"), "utf8");
  for (const term of ["ready_for_video_model", "reference_only", "fallback_review_required", "retry_required", "failed_role", "clean_model_plain_background", "clean_model_pose_pack", "wardrobe_detail", "pose_reference_pack"]) {
    if (!qaContract.includes(term)) fail(`qa-delivery-contract.md missing required term: ${term}`);
  }

  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (pkg.repository?.url !== "https://github.com/ninemouth/video-frame-image-asset-generator.git") {
    fail("package.json repository URL must point to the public GitHub repo");
  }
  if (!pkg.scripts?.["configure:image-provider"]) {
    fail("package.json missing configure:image-provider script");
  }
  if (!pkg.scripts?.["organize:final-assets"]) {
    fail("package.json missing organize:final-assets script");
  }
  if (!pkg.scripts?.["validate:manifest"]) {
    fail("package.json missing validate:manifest script");
  }
  if (!pkg.scripts?.["validate:manifest:images"]) {
    fail("package.json missing validate:manifest:images script");
  }
  if (!pkg.scripts?.["validate:manifest:report"]) {
    fail("package.json missing validate:manifest:report script");
  }
  if (pkg.scripts?.["test:asset-qa-fixtures"] !== "node scripts/test-asset-qa-fixtures.mjs") {
    fail("package.json missing test:asset-qa-fixtures script");
  }

  for (const file of requiredFiles.filter((file) => file.endsWith(".mjs"))) {
    checkSyntax(file);
  }

  const fixtureResult = spawnSync(process.execPath, ["scripts/test-asset-qa-fixtures.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  if (fixtureResult.status !== 0) {
    fail(`asset QA fixtures failed\n${fixtureResult.stderr || fixtureResult.stdout}`);
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
