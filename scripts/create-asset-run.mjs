#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
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

function slugify(value) {
  return String(value || "asset-run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset-run";
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRun = args["source-run"] ? path.resolve(String(args["source-run"])) : null;
  const input = args.input ? path.resolve(String(args.input)) : null;
  const baseDir = path.resolve(String(args["base-dir"] || process.cwd()));
  const runId = `${timestamp()}-${slugify(args.slug || (sourceRun ? path.basename(sourceRun) : "asset-run"))}`;
  const runDir = path.resolve(String(args["run-dir"] || path.join(baseDir, "work", "image-asset-runs", runId)));

  const dirs = [
    "input",
    "frame-source",
    "planning",
    "provider",
    "generated-assets",
    "final-assets",
    "qa",
    "output"
  ];

  await mkdir(runDir, { recursive: true });
  await Promise.all(dirs.map((dir) => mkdir(path.join(runDir, dir), { recursive: true })));

  const manifest = {
    schema: "video-frame-image-asset-generator/source-manifest/v1",
    run_id: runId,
    created_at: new Date().toISOString(),
    run_dir: runDir,
    source_run: sourceRun,
    input,
    outputs: {
      asset_manifest: "output/asset-manifest.json",
      prompt_pack: "output/prompt-pack.md",
      request_pack: "output/request-pack.jsonl"
    },
    notes: []
  };

  await writeFile(path.join(runDir, "input", "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(runDir, "output", "README.md"),
    [
      "# Image Asset Run",
      "",
      `- Run id: \`${runId}\``,
      sourceRun ? `- Source FFmpeg run: \`${sourceRun}\`` : "- Source FFmpeg run: not set",
      input ? `- Input: \`${input}\`` : "- Input: not set",
      "",
      "Next step:",
      "",
      "```bash",
      `node scripts/plan-image-assets.mjs --run-dir "${runDir}"${sourceRun ? ` --source-run "${sourceRun}"` : ""}`,
      "```",
      ""
    ].join("\n")
  );

  console.log(JSON.stringify({ runDir, runId, sourceRun, input }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
