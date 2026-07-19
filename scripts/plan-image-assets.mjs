#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

async function readJsonIfExists(file) {
  if (!file || !existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

async function readTextIfExists(file) {
  if (!file || !existsSync(file)) return "";
  return readFile(file, "utf8");
}

function normalizeFrameIndex(raw, sourceRun) {
  const candidates = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.frames)
      ? raw.frames
      : Array.isArray(raw?.keyframes)
        ? raw.keyframes
        : Array.isArray(raw?.items)
          ? raw.items
          : [];

  return candidates.map((frame, index) => {
    const relPath = frame.path || frame.file || frame.image || frame.relative_path || frame.frame_path || "";
    const id = frame.id || frame.frame_id || frame.name || String(index).padStart(8, "0");
    const timestamp = frame.timestamp ?? frame.time ?? frame.time_sec ?? frame.seconds ?? null;
    return {
      id: String(id),
      timestamp,
      path: relPath ? path.resolve(sourceRun, relPath) : null,
      relative_path: relPath || null,
      notes: frame.notes || frame.observation || null
    };
  });
}

function pickFrames(frames, count) {
  if (frames.length <= count) return frames;
  const picked = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i * (frames.length - 1)) / Math.max(1, count - 1));
    picked.push(frames[idx]);
  }
  return picked;
}

function evidenceLine(frames) {
  if (!frames.length) return "No indexed frames were found. Codex must inspect the supplied screenshots or user notes.";
  return frames
    .map((frame) => `${frame.id}${frame.timestamp !== null ? ` @ ${frame.timestamp}s` : ""}`)
    .join(", ");
}

function buildTargets(frames, language) {
  const evidence = evidenceLine(pickFrames(frames, 5));
  const zh = language === "zh";
  const commonCleanup = zh
    ? "移除平台 UI、字幕、水印、品牌标识、镜像文字、黑场/白场转场残影和压缩噪点。"
    : "Remove platform UI, captions, watermarks, brand marks, mirrored text, black/white transition artifacts, and compression noise.";

  return [
    {
      id: "scene-plate-001",
      role: "clean_scene_plate",
      title: zh ? "干净场景空镜" : "Clean scene plate",
      source_evidence: evidence,
      prompt: zh
        ? `基于证据帧 ${evidence}，生成同一机位、同一透视和同一光线的干净空场景图。${commonCleanup} 不要人物，不要可识别品牌，不要新增夸张道具，保持道路/室内几何、天空/灯光方向和画面纵横比。`
        : `Using evidence frames ${evidence}, generate a clean empty scene plate with the same camera height, perspective, and lighting. ${commonCleanup} No people, no recognizable brands, no exaggerated new props; preserve geometry and aspect ratio.`
    },
    {
      id: "ui-free-reconstruction-001",
      role: "ui_free_scene_reconstruction",
      title: zh ? "去 UI 复刻场景" : "UI-free scene reconstruction",
      source_evidence: evidence,
      prompt: zh
        ? `复刻证据帧 ${evidence} 的视频画面氛围，但交付为无平台界面、无字幕、无水印的干净画面。保持主体位置、低/高机位、街景或室内关系、色温和构图。`
        : `Recreate the visual feeling of evidence frames ${evidence} as a clean image without platform UI, captions, or watermarks. Preserve subject placement, camera angle, environment relationship, color temperature, and composition.`
    },
    {
      id: "character-turnaround-001",
      role: "character_turnaround",
      title: zh ? "人物多角度纯色背景" : "Character turnaround on plain background",
      source_evidence: evidence,
      prompt: zh
        ? `根据证据帧 ${evidence} 中已确认的服装、发型类别、身形比例和配饰，创建一个非真人身份锁定的虚构人物多角度参考图。白色或浅灰纯色背景，同一人物设计的正面、侧面、背面、四分之三视角，服装和道具一致，无遮挡，无文字。`
        : `From verified outfit, hairstyle category, body proportion, and accessory evidence in frames ${evidence}, create a fictionalized character turnaround. Plain white or light gray background, front/side/back/three-quarter views, consistent outfit and props, no text.`
    },
    {
      id: "wardrobe-detail-001",
      role: "wardrobe_detail",
      title: zh ? "服装材质细节" : "Wardrobe material detail",
      source_evidence: evidence,
      prompt: zh
        ? `生成服装与配饰细节参考图，基于证据帧 ${evidence} 中确认的上装、下装、鞋履、腰带、包或其他配件。纯色背景，清晰边缘，高光分离深色材质，不要让黑色材质糊成一片，不要额外 Logo。`
        : `Generate wardrobe and accessory detail references from verified evidence in frames ${evidence}. Plain background, crisp edges, separated highlights for dark materials, no collapsed black blobs, no extra logos.`
    },
    {
      id: "prop-cutout-001",
      role: "prop_cutout",
      title: zh ? "道具/包/鞋独立图" : "Prop cutout",
      source_evidence: evidence,
      prompt: zh
        ? `生成证据帧 ${evidence} 中重点道具、包、鞋或手持物的独立展示图。物体完整入画，纯白或浅灰背景，足够留白，比例真实，链条/带子/鞋底等结构不能漂浮或断裂。`
        : `Generate an isolated prop, bag, shoe, or handheld-object asset from frames ${evidence}. Full object in frame, pure white or light gray background, generous padding, realistic proportions, no floating or broken straps/chains/soles.`
    },
    {
      id: "pose-reference-001",
      role: "pose_reference_pack",
      title: zh ? "关键动作姿态包" : "Pose reference pack",
      source_evidence: evidence,
      prompt: zh
        ? `创建与证据帧 ${evidence} 对应的关键动作姿态参考图，纯色背景，保持人物设计和服装一致，输出行走/转身/近景/细节展示等主要姿态。不要平台 UI，不要文字，不要多余肢体。`
        : `Create pose references corresponding to evidence frames ${evidence}. Plain background, consistent character design and outfit, include main walking/turning/close-up/detail poses. No UI, no text, no extra limbs.`
    },
    {
      id: "transition-reference-001",
      role: "transition_reference",
      title: zh ? "转场视觉参考" : "Transition visual reference",
      source_evidence: evidence,
      prompt: zh
        ? `生成干净的转场视觉参考，表达证据帧 ${evidence} 中的径向模糊、快速拉近拉远、运动拖影或同轴变焦感。不要黑场/白场占满画面，不要平台 UI，不要破坏中心构图。`
        : `Generate a clean transition reference expressing radial blur, snap zoom, motion streak, or axial push-pull from frames ${evidence}. Avoid full black/white frames, no UI, preserve centered composition.`
    }
  ];
}

function promptPack(plan) {
  const lines = [
    `# ${plan.title}`,
    "",
    `- Run id: \`${plan.run_id}\``,
    `- Source run: ${plan.source_run ? `\`${plan.source_run}\`` : "not set"}`,
    `- Frame count: ${plan.frames.length}`,
    "",
    "## Source Evidence",
    ""
  ];

  for (const frame of pickFrames(plan.frames, 12)) {
    lines.push(`- ${frame.id}${frame.timestamp !== null ? ` @ ${frame.timestamp}s` : ""}${frame.relative_path ? `: \`${frame.relative_path}\`` : ""}`);
  }

  lines.push("", "## Prompt Targets", "");
  for (const target of plan.targets) {
    lines.push(`### ${target.id} - ${target.title}`, "");
    lines.push(`- Role: \`${target.role}\``);
    lines.push(`- Source evidence: ${target.source_evidence}`);
    lines.push("");
    lines.push("```text");
    lines.push(target.prompt);
    lines.push("```");
    lines.push("");
    lines.push("QA:");
    lines.push("- Verify the asset matches visually inspected frame evidence.");
    lines.push("- Verify cleanup removed UI, captions, watermarks, black/white artifacts, and unauthorized brands.");
    lines.push("- Verify no new identity, prop, limb, geometry, or aspect-ratio drift was introduced.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const sourceRun = args["source-run"] ? path.resolve(String(args["source-run"])) : null;
  const language = String(args.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";

  await Promise.all(["planning", "output", "qa"].map((dir) => mkdir(path.join(runDir, dir), { recursive: true })));

  const frameIndexPath = sourceRun ? path.join(sourceRun, "metadata", "frame-index.json") : null;
  const frameQualityPath = sourceRun ? path.join(sourceRun, "metadata", "frame-quality.json") : null;
  const reportPath = sourceRun ? path.join(sourceRun, "output", "recreate-report.md") : null;
  const frameIndex = await readJsonIfExists(frameIndexPath);
  const frameQuality = await readJsonIfExists(frameQualityPath);
  const report = await readTextIfExists(reportPath);
  const frames = frameIndex ? normalizeFrameIndex(frameIndex, sourceRun) : [];

  const plan = {
    schema: "video-frame-image-asset-generator/asset-generation-plan/v1",
    title: language === "zh" ? "视频抽帧复刻图片资产计划" : "Video frame recreation image asset plan",
    run_id: path.basename(runDir),
    created_at: new Date().toISOString(),
    source_run: sourceRun,
    source_files: {
      frame_index: frameIndexPath && existsSync(frameIndexPath) ? frameIndexPath : null,
      frame_quality: frameQualityPath && existsSync(frameQualityPath) ? frameQualityPath : null,
      recreate_report: reportPath && existsSync(reportPath) ? reportPath : null
    },
    frames,
    frame_quality_summary: frameQuality?.summary || frameQuality?.stats || null,
    report_excerpt: report ? report.slice(0, 4000) : "",
    targets: buildTargets(frames, language),
    execution_notes: [
      "Codex must visually inspect source frames before treating prompt details as final.",
      "Use native_codex for reference-aware generation or image edits.",
      "Use third_party_api only for self-contained text-to-image prompts unless provider image input is verified."
    ]
  };

  const assetManifest = {
    schema: "video-frame-image-asset-generator/asset-manifest/v1",
    run_id: plan.run_id,
    created_at: plan.created_at,
    source_run: sourceRun,
    generated_assets: [],
    prompt_targets: plan.targets.map((target) => ({
      id: target.id,
      role: target.role,
      title: target.title,
      status: "planned",
      output_path: null,
      provider: null,
      qa_status: "pending"
    }))
  };

  const requestPack = plan.targets
    .map((target) => JSON.stringify({
      id: target.id,
      role: target.role,
      prompt: target.prompt,
      size: args.size || "1024x1536",
      quality: args.quality || "auto",
      provider_mode: "auto"
    }))
    .join("\n");

  await writeFile(path.join(runDir, "planning", "asset-generation-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(runDir, "output", "prompt-pack.md"), promptPack(plan));
  await writeFile(path.join(runDir, "output", "request-pack.jsonl"), `${requestPack}\n`);
  await writeFile(path.join(runDir, "output", "asset-manifest.json"), `${JSON.stringify(assetManifest, null, 2)}\n`);
  await writeFile(
    path.join(runDir, "qa", "asset-qa-checklist.json"),
    `${JSON.stringify({
      schema: "video-frame-image-asset-generator/asset-qa-checklist/v1",
      run_id: plan.run_id,
      checks: [
        "source evidence visually inspected",
        "UI/captions/watermarks removed unless requested",
        "identity policy respected",
        "props and wardrobe do not drift",
        "scene geometry and camera perspective preserved",
        "black/white transition artifacts avoided",
        "final files copied into run-local generated-assets or final-assets"
      ]
    }, null, 2)}\n`
  );

  await writeFile(
    path.join(runDir, "output", "README.md"),
    [
      "# Video Frame Image Assets",
      "",
      `- Run id: \`${plan.run_id}\``,
      sourceRun ? `- Source run: \`${sourceRun}\`` : "- Source run: not set",
      `- Planned targets: ${plan.targets.length}`,
      "",
      "Direct files:",
      "",
      "- `output/asset-manifest.json`",
      "- `output/prompt-pack.md`",
      "- `output/request-pack.jsonl`",
      "- `planning/asset-generation-plan.json`",
      "- `qa/asset-qa-checklist.json`",
      ""
    ].join("\n")
  );

  console.log(JSON.stringify({
    runDir,
    sourceRun,
    frames: frames.length,
    targets: plan.targets.length,
    promptPack: path.join(runDir, "output", "prompt-pack.md"),
    requestPack: path.join(runDir, "output", "request-pack.jsonl")
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
