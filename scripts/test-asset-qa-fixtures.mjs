#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePng(file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(pngBase64, "base64"));
}

function baseManifest(runId, promptTarget) {
  return {
    schema: "video-frame-image-asset-generator/asset-manifest/v1",
    run_id: runId,
    prompt_targets: [promptTarget],
    generated_assets: []
  };
}

function promptTarget(id, role = "clean_scene_plate") {
  return {
    id,
    role,
    title: id,
    status: "planned",
    delivery_status: "planned_needs_generation",
    allowed_final_statuses: [
      "ready_for_video_model",
      "reference_only",
      "fallback_review_required",
      "retry_required",
      "failed_role"
    ],
    qa_status: "pending",
    acceptance: ["source grounded", "no ui", "role matched"]
  };
}

async function createRun(name) {
  const runDir = await mkdtemp(path.join(os.tmpdir(), `vf-fixture-${name}-`));
  await mkdir(path.join(runDir, "output"), { recursive: true });
  return runDir;
}

async function createSourceRun(name) {
  const sourceRun = await mkdtemp(path.join(os.tmpdir(), `vf-source-${name}-`));
  await mkdir(path.join(sourceRun, "metadata"), { recursive: true });
  await mkdir(path.join(sourceRun, "output", "keyframes"), { recursive: true });
  await writeJson(path.join(sourceRun, "metadata", "frame-index.json"), {
    frames: [
      {
        id: "00000000",
        timestamp: 0,
        relative_path: "output/keyframes/00000000.png",
        notes: "opening bedroom scene"
      },
      {
        id: "00000090",
        timestamp: 3,
        relative_path: "output/keyframes/00000090.png",
        notes: "model lying on bed with pillow"
      }
    ]
  });
  return sourceRun;
}

async function testFallbackCannotBeReady() {
  const runDir = await createRun("fallback-ready");
  await writePng(path.join(runDir, "generated-assets", "fallback.png"));
  const manifest = baseManifest("fallback-ready-test", promptTarget("fallback", "clean_model_plain_background"));
  manifest.generated_assets.push({
    id: "fallback",
    role: "clean_model_plain_background",
    final_path: "generated-assets/fallback.png",
    source: "local_source_frame_crop",
    delivery_status: "ready_for_video_model",
    qa_status: "passed"
  });
  await writeJson(path.join(runDir, "output", "asset-manifest.json"), manifest);

  const result = await runNode(["scripts/validate-asset-manifest.mjs", "--run-dir", runDir]);
  assert(result.status !== 0, "fallback-ready fixture should fail validation");
  assert(
    `${result.stdout}\n${result.stderr}`.includes("fallback asset fallback cannot be ready_for_video_model"),
    "fallback-ready fixture did not report fallback ready error"
  );
}

async function startMockImageServer() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/images/generations") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "fixture-response-001",
          data: [{ b64_json: pngBase64 }]
        }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function testThirdPartySuccessUpdatesManifest() {
  const runDir = await createRun("provider-success");
  const id = "provider-success";
  await writeJson(path.join(runDir, "output", "asset-manifest.json"), baseManifest("provider-success-test", promptTarget(id)));
  await writeFile(path.join(runDir, "output", "request-pack.jsonl"), `${JSON.stringify({
    id,
    role: "clean_scene_plate",
    prompt: "fixture image",
    size: "1024x1024",
    quality: "auto",
    ready_for_generation: true
  })}\n`);

  const { server, baseUrl } = await startMockImageServer();
  try {
    const result = await runNode([
      "scripts/third-party-image-runtime.mjs",
      "--run-dir", runDir,
      "--request-pack", path.join(runDir, "output", "request-pack.jsonl"),
      "--base-url", baseUrl,
      "--model", "fixture-image-model"
    ], { env: { VIDEO_IMAGE_PROVIDER_API_KEY: "fixture-key" } });
    assert(result.status === 0, `provider success fixture failed: ${result.stderr || result.stdout}`);
  } finally {
    server.close();
  }

  const manifest = JSON.parse(await readFile(path.join(runDir, "output", "asset-manifest.json"), "utf8"));
  assert(manifest.prompt_targets[0].status === "generated_pending_review", "provider success target status not updated");
  assert(manifest.generated_assets.length === 1, "provider success did not add generated asset");
  assert(manifest.generated_assets[0].delivery_status === "reference_only", "provider success should be reference_only before visual QA");
  assert(manifest.generated_assets[0].qa_status === "pending_visual_review", "provider success should be pending visual QA");
}

async function testThirdPartyFailureUpdatesManifest() {
  const runDir = await createRun("provider-failure");
  const id = "provider-failure";
  await writeJson(path.join(runDir, "output", "asset-manifest.json"), baseManifest("provider-failure-test", promptTarget(id)));
  await writeFile(path.join(runDir, "output", "request-pack.jsonl"), `${JSON.stringify({
    id,
    role: "clean_scene_plate",
    prompt: "fixture image",
    ready_for_generation: true
  })}\n`);

  const result = await runNode([
    "scripts/third-party-image-runtime.mjs",
    "--run-dir", runDir,
    "--request-pack", path.join(runDir, "output", "request-pack.jsonl"),
    "--base-url", "http://127.0.0.1:9",
    "--model", "fixture-image-model"
  ], { env: { VIDEO_IMAGE_PROVIDER_API_KEY: "fixture-key" } });

  assert(result.status !== 0, "provider failure fixture should exit non-zero");
  const manifest = JSON.parse(await readFile(path.join(runDir, "output", "asset-manifest.json"), "utf8"));
  assert(manifest.prompt_targets[0].delivery_status === "retry_required", "provider failure target should require retry");
  assert(manifest.prompt_targets[0].qa_status === "provider_failed", "provider failure target should record provider_failed");
  assert(manifest.generated_assets.length === 0, "provider failure should not add generated assets");
}

async function testFinalAssetsOrganizerBuckets() {
  const runDir = await createRun("organizer");
  await writePng(path.join(runDir, "generated-assets", "ready.png"));
  await writePng(path.join(runDir, "generated-assets", "reference.png"));
  const manifest = baseManifest("organizer-test", promptTarget("ready"));
  manifest.prompt_targets.push(promptTarget("reference", "clean_model_pose_pack"));
  manifest.generated_assets = [
    {
      id: "ready",
      role: "clean_scene_plate",
      final_path: "generated-assets/ready.png",
      delivery_status: "ready_for_video_model",
      qa_status: "passed"
    },
    {
      id: "reference",
      role: "clean_model_pose_pack",
      final_path: "generated-assets/reference.png",
      delivery_status: "reference_only",
      qa_status: "pending_visual_review"
    },
    {
      id: "missing-retry",
      role: "prop_cutout",
      final_path: "generated-assets/missing.png",
      delivery_status: "retry_required",
      qa_status: "provider_failed"
    }
  ];
  await writeJson(path.join(runDir, "output", "asset-manifest.json"), manifest);

  const result = await runNode(["scripts/organize-final-assets.mjs", "--run-dir", runDir, "--clean"]);
  assert(result.status === 0, `organizer fixture failed: ${result.stderr || result.stdout}`);
  assert(existsSync(path.join(runDir, "final-assets", "ready", "ready.png")), "organizer missing ready asset");
  assert(existsSync(path.join(runDir, "final-assets", "reference-only", "reference.png")), "organizer missing reference asset");
  assert(existsSync(path.join(runDir, "final-assets", "final-assets-index.json")), "organizer missing index");

  const updated = JSON.parse(await readFile(path.join(runDir, "output", "asset-manifest.json"), "utf8"));
  assert(updated.final_assets_directories?.index, "organizer did not write final_assets_directories");
}

async function testPlannerBlocksGenerationWithoutVisualBrief() {
  const sourceRun = await createSourceRun("nobrief");
  const runDir = await createRun("planner-nobrief");
  const result = await runNode([
    "scripts/plan-image-assets.mjs",
    "--run-dir", runDir,
    "--source-run", sourceRun,
    "--language", "zh"
  ]);
  assert(result.status === 0, `planner no-brief fixture failed: ${result.stderr || result.stdout}`);

  const requestPack = (await readFile(path.join(runDir, "output", "request-pack.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert(requestPack.length > 0, "planner no-brief fixture did not write request pack");
  assert(requestPack.every((item) => item.ready_for_generation === false), "no-brief request pack should block provider generation");
  assert(requestPack.every((item) => item.provider_mode === "request_pack_only"), "no-brief request pack should use request_pack_only");
}

async function testPlannerIncludesCleanModelTargetsWithHumanBrief() {
  const sourceRun = await createSourceRun("human-brief");
  const runDir = await createRun("planner-human");
  const visualBrief = path.join(runDir, "visual-brief.md");
  await writeFile(visualBrief, [
    "卧室日光场景，年轻成年女性模特躺在床上使用枕头。",
    "可见长发、浅色睡衣、侧卧和坐起动作，床、窗、枕头和模特位置关系需要保持。",
    "需要去除平台 UI 和字幕，但不能丢失模特姿态参考。"
  ].join("\n"));

  const result = await runNode([
    "scripts/plan-image-assets.mjs",
    "--run-dir", runDir,
    "--source-run", sourceRun,
    "--language", "zh",
    "--visual-brief", visualBrief
  ]);
  assert(result.status === 0, `planner human fixture failed: ${result.stderr || result.stdout}`);

  const manifest = JSON.parse(await readFile(path.join(runDir, "output", "asset-manifest.json"), "utf8"));
  const roles = new Set(manifest.prompt_targets.map((target) => target.role));
  for (const role of ["clean_model_scene_reference", "clean_model_plain_background", "clean_model_pose_pack"]) {
    assert(roles.has(role), `planner human fixture missing role: ${role}`);
  }
  assert(
    manifest.prompt_targets.every((target) => target.ready_for_generation === true),
    "human brief targets should be ready for generation after visual evidence is supplied"
  );
}

async function main() {
  const tests = [
    testFallbackCannotBeReady,
    testThirdPartySuccessUpdatesManifest,
    testThirdPartyFailureUpdatesManifest,
    testFinalAssetsOrganizerBuckets,
    testPlannerBlocksGenerationWithoutVisualBrief,
    testPlannerIncludesCleanModelTargetsWithHumanBrief
  ];

  for (const test of tests) {
    await test();
  }

  console.log(JSON.stringify({
    ok: true,
    fixtures: tests.map((test) => test.name)
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
