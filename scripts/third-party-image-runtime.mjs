#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    prompt: String(args.prompt),
    size: args.size || "1024x1024",
    quality: args.quality || "auto"
  }];
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
    if (request.ready_for_generation === false && !args["allow-draft"]) {
      const skipped = {
        id: request.id,
        status: "skipped",
        reason: "ready_for_generation_false",
        next_action: "Fill visual_evidence_brief, rerun plan-image-assets, then generate."
      };
      results.push(skipped);
      console.log(JSON.stringify(skipped));
      continue;
    }
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
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
