#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const NO_UPDATE_MANIFEST_FLAG = "--no-update-manifest";

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

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return { name, value };
  }
  return null;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function relativeToRun(runDir, file) {
  return path.relative(runDir, file).split(path.sep).join("/");
}

function statusForProviderResult(result) {
  if (result.status === "generated") return "reference_only";
  if (result.status === "failed" || result.status === "skipped") return "retry_required";
  return "reference_only";
}

function qaStatusForProviderResult(result) {
  if (result.status === "generated") return "pending_visual_review";
  if (result.status === "skipped") return "not_generated";
  if (result.status === "failed") return "provider_failed";
  return "pending_visual_review";
}

function generationGateForRequest(request, args) {
  if (request.ready_for_generation === false && !args["allow-draft"]) {
    return {
      allowed: false,
      reason: "ready_for_generation_false",
      next_action: "Fill visual_evidence_brief, rerun plan-image-assets, then generate."
    };
  }

  const brief = request.product_scene_control_brief;
  if (!brief && !args["allow-legacy-request"]) {
    return {
      allowed: false,
      reason: "missing_product_scene_control_brief",
      next_action: "Rerun plan-image-assets with the current skill so every request carries product_scene_control_brief."
    };
  }

  if (brief?.generation_allowed === false && !args["allow-draft"]) {
    return {
      allowed: false,
      reason: "product_scene_control_brief_blocked",
      next_action: "Fill visual_evidence_brief and rerun planning before provider generation."
    };
  }

  const allowedRoles = new Set(Array.isArray(brief?.required_asset_roles) ? brief.required_asset_roles : []);
  if (brief && request.role && !allowedRoles.has(request.role)) {
    return {
      allowed: false,
      reason: "role_not_allowed_by_product_scene_control_brief",
      next_action: `Do not generate ${request.role} for this task; rerun planning if the visual evidence actually requires it.`
    };
  }

  return { allowed: true };
}

function safeName(value) {
  return String(value || "image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

function extFromContentType(contentType) {
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  return "png";
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image download failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, ext: extFromContentType(contentType) };
}

async function generateOne({ prompt, id, runDir, baseUrl, model, apiKey, size, quality }) {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      n: 1
    })
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`generation failed with HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
  }

  const item = payload?.data?.[0];
  if (!item) throw new Error("provider response did not contain data[0]");

  let buffer;
  let ext = "png";
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const downloaded = await download(item.url);
    buffer = downloaded.buffer;
    ext = downloaded.ext;
  } else {
    throw new Error("provider response did not contain b64_json or url");
  }

  await mkdir(path.join(runDir, "generated-assets"), { recursive: true });
  const file = path.join(runDir, "generated-assets", `${safeName(id)}.${ext}`);
  await writeFile(file, buffer);
  return {
    id,
    status: "generated",
    file,
    provider: "third_party_api",
    model,
    size,
    quality,
    response_id: payload.id || null
  };
}

async function loadRequests(args) {
  if (args["request-pack"]) {
    const file = path.resolve(String(args["request-pack"]));
    const lines = (await readFile(file, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  }

  if (!args.prompt) throw new Error("Provide --prompt or --request-pack");
  return [{
    id: args.id || "third-party-image",
    role: args.role || "generated_image",
    prompt: String(args.prompt),
    size: args.size || "1024x1024",
    quality: args.quality || "auto"
  }];
}

async function updateAssetManifest({ runDir, results, requests, provider, model }) {
  const manifestPath = path.join(runDir, "output", "asset-manifest.json");
  const manifest = await readJson(manifestPath);
  if (!manifest) return null;

  const now = new Date().toISOString();
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const generated = Array.isArray(manifest.generated_assets) ? manifest.generated_assets : [];
  const generatedById = new Map(generated.map((asset) => [asset.id, asset]));
  const promptTargets = Array.isArray(manifest.prompt_targets) ? manifest.prompt_targets : [];
  const promptTargetById = new Map(promptTargets.map((target) => [target.id, target]));

  for (const result of results) {
    const request = requestById.get(result.id) || {};
    const promptTarget = promptTargetById.get(result.id);
    const deliveryStatus = statusForProviderResult(result);
    const qaStatus = qaStatusForProviderResult(result);

    if (promptTarget) {
      promptTarget.status = result.status === "generated" ? "generated_pending_review" : result.status;
      promptTarget.delivery_status = deliveryStatus;
      promptTarget.qa_status = qaStatus;
      promptTarget.provider = provider;
      promptTarget.output_path = result.file ? relativeToRun(runDir, result.file) : null;
      promptTarget.updated_at = now;
      if (result.error) promptTarget.error = result.error;
    }

    if (result.status === "generated" && result.file) {
      generatedById.set(result.id, {
        ...(generatedById.get(result.id) || {}),
        id: result.id,
        role: request.role || promptTarget?.role || "generated_image",
        final_path: relativeToRun(runDir, result.file),
        source: "third_party_api_generation",
        provider,
        model: result.model || model,
        size: result.size || request.size || null,
        quality: result.quality || request.quality || null,
        response_id: result.response_id || null,
        delivery_status: deliveryStatus,
        qa_status: qaStatus,
        prompt_id: result.id,
        generated_at: now,
        note: "Generated by third-party runtime; requires visual QA before ready_for_video_model."
      });
    }
  }

  manifest.generated_assets = Array.from(generatedById.values());
  manifest.prompt_targets = promptTargets;
  manifest.updated_at = now;
  manifest.provider_generation = {
    provider,
    model,
    updated_at: now,
    results_path: "provider/third-party-generation-results.json"
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const configPath = path.resolve(String(args.config || path.join(codexHome, "video-frame-image-asset-generator", "image-provider.json")));
  const config = await readJson(configPath) || {};
  const configured = config.third_party || {};
  const apiKeyEnv = String(args["api-key-env"] || configured.api_key_env || "THINKAI_API_KEY");
  const baseUrl = String(args["base-url"] || process.env.VIDEO_IMAGE_PROVIDER_BASE_URL || configured.base_url || "https://www.thinkai.tv/v1");
  const model = String(args.model || process.env.VIDEO_IMAGE_PROVIDER_MODEL || configured.model || "gpt-image-2");
  const key = firstEnv(["VIDEO_IMAGE_PROVIDER_API_KEY", apiKeyEnv, "THINKAI_API_KEY", "CHARLIE_KEY"]) || (configured.api_key ? { name: "local_config", value: configured.api_key } : null);
  if (!key) {
    throw new Error("No API key found. Set VIDEO_IMAGE_PROVIDER_API_KEY, THINKAI_API_KEY, or CHARLIE_KEY.");
  }

  const requests = await loadRequests(args);
  const results = [];
  for (const request of requests) {
    const gate = generationGateForRequest(request, args);
    if (!gate.allowed) {
      const skipped = {
        id: request.id,
        status: "skipped",
        reason: gate.reason,
        role: request.role || null,
        next_action: gate.next_action
      };
      results.push(skipped);
      console.log(JSON.stringify(skipped));
      continue;
    }
    try {
      const result = await generateOne({
        prompt: request.prompt,
        id: request.id,
        runDir,
        baseUrl,
        model: request.model || model,
        apiKey: key.value,
        size: request.size || args.size || "1024x1024",
        quality: request.quality || args.quality || "auto"
      });
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      const failed = {
        id: request.id,
        status: "failed",
        reason: "provider_generation_failed",
        error: String(error?.message || error).slice(0, 1000),
        next_action: "Retry generation after provider recovery or route this request through native_codex."
      };
      results.push(failed);
      console.log(JSON.stringify(failed));
    }
  }

  await mkdir(path.join(runDir, "provider"), { recursive: true });
  await writeFile(
    path.join(runDir, "provider", "third-party-generation-results.json"),
    `${JSON.stringify({
      schema: "video-frame-image-asset-generator/third-party-generation-results/v1",
      created_at: new Date().toISOString(),
      provider: "third_party_api",
      base_url: baseUrl.replace(/\/+$/, ""),
      model,
      api_key_env: key.name,
      results
    }, null, 2)}\n`
  );

  const manifestPath = args["no-update-manifest"]
    ? null
    : await updateAssetManifest({
        runDir,
        results,
        requests,
        provider: "third_party_api",
        model
      });

  if (manifestPath) {
    console.log(JSON.stringify({
      status: "manifest_updated",
      manifestPath
    }));
  }

  if (results.some((result) => result.status === "failed")) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
