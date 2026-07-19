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

function mask(value) {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const requestedMode = String(args.mode || "auto");
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const configPath = path.resolve(String(args.config || path.join(codexHome, "video-frame-image-asset-generator", "image-provider.json")));
  const config = await readJson(configPath) || {};
  const configured = config.third_party || {};
  const apiKeyEnv = String(args["api-key-env"] || configured.api_key_env || "THINKAI_API_KEY");
  const baseUrl = String(args["base-url"] || process.env.VIDEO_IMAGE_PROVIDER_BASE_URL || configured.base_url || "https://www.thinkai.tv/v1").replace(/\/+$/, "");
  const model = String(args.model || process.env.VIDEO_IMAGE_PROVIDER_MODEL || configured.model || "gpt-image-2");
  const key = firstEnv(["VIDEO_IMAGE_PROVIDER_API_KEY", apiKeyEnv, "THINKAI_API_KEY", "CHARLIE_KEY"]) || (configured.api_key ? { name: "local_config", value: configured.api_key } : null);

  let providerMode = "native_codex";
  let blockedReason = null;

  if (requestedMode === "native") {
    providerMode = "native_codex";
  } else if (requestedMode === "third-party" || requestedMode === "third_party_api") {
    providerMode = key ? "third_party_api" : "configuration_required";
    blockedReason = key ? null : "third-party mode requested but no API key environment variable was found";
  } else if (requestedMode === "request-pack" || requestedMode === "request_pack_only") {
    providerMode = "request_pack_only";
  } else if (requestedMode === "auto") {
    providerMode = (process.env.VIDEO_IMAGE_PROVIDER_MODE === "third_party_api" || config.provider_mode === "third_party_api" || configured.enabled === true) && key
      ? "third_party_api"
      : "native_codex";
  } else {
    providerMode = "configuration_required";
    blockedReason = `unknown mode: ${requestedMode}`;
  }

  const resolution = {
    schema: "video-frame-image-asset-generator/provider-resolution/v1",
    created_at: new Date().toISOString(),
    requested_mode: requestedMode,
    provider_mode: providerMode,
    base_url: providerMode === "third_party_api" || providerMode === "configuration_required" ? baseUrl : null,
    model: providerMode === "third_party_api" || providerMode === "configuration_required" ? model : null,
    api_key_env: key?.name || null,
    api_key_preview: mask(key?.value || ""),
    blocked_reason: blockedReason,
    provider_config: configPath,
    notes: [
      "native_codex means load/use the system imagegen skill and built-in generation path.",
      "third_party_api uses the bundled OpenAI-compatible text-to-image runtime.",
      "No API key value is written to this file."
    ]
  };

  await mkdir(path.join(runDir, "provider"), { recursive: true });
  await writeFile(path.join(runDir, "provider", "provider-resolution.json"), `${JSON.stringify(resolution, null, 2)}\n`);
  console.log(JSON.stringify(resolution, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
