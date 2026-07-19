#!/usr/bin/env node
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const DEFAULT_BASE_URL = "https://www.thinkai.tv/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_KEY_ENV = "THINKAI_API_KEY";

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

async function askText(question, defaultValue = "") {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultValue;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  rl.close();
  return answer.trim() || defaultValue;
}

async function askSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "";
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";
    stdout.write(`${question}: `);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char) => {
      if (char === "\u0003") {
        stdin.setRawMode?.(false);
        stdout.write("\n");
        process.exit(130);
      }
      if (char === "\r" || char === "\n") {
        stdin.off("data", onData);
        stdin.setRawMode?.(false);
        stdout.write("\n");
        resolve(value.trim());
        return;
      }
      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const configPath = path.resolve(args.config || path.join(codexHome, "video-frame-image-asset-generator", "image-provider.json"));
  const existing = await readJson(configPath) || {};
  const promptIfMissing = args["prompt-if-missing"] !== false && args["no-prompt"] !== true;

  let baseUrl = String(args["base-url"] || process.env.VIDEO_IMAGE_PROVIDER_BASE_URL || existing.third_party?.base_url || "");
  let model = String(args.model || process.env.VIDEO_IMAGE_PROVIDER_MODEL || existing.third_party?.model || DEFAULT_MODEL);
  let apiKeyEnv = String(args["api-key-env"] || existing.third_party?.api_key_env || DEFAULT_KEY_ENV);
  let apiKey = String(args["api-key"] || process.env.VIDEO_IMAGE_PROVIDER_API_KEY || process.env[apiKeyEnv] || existing.third_party?.api_key || "");

  if (!baseUrl && promptIfMissing) {
    baseUrl = await askText("Third-party image provider base URL", DEFAULT_BASE_URL);
  }
  if (!baseUrl) baseUrl = DEFAULT_BASE_URL;

  if (!apiKey && promptIfMissing) {
    apiKey = await askSecret(`Third-party image API key for ${apiKeyEnv} (leave blank to skip)`);
  }

  const config = {
    schema: "video-frame-image-asset-generator/image-provider-config/v1",
    configured_at: new Date().toISOString(),
    provider_mode: apiKey ? "third_party_api" : "native_codex",
    third_party: {
      enabled: Boolean(apiKey),
      name: args.name || existing.third_party?.name || "ThinkAI",
      base_url: baseUrl.replace(/\/+$/, ""),
      model,
      api_key_env: apiKeyEnv,
      api_key: apiKey || existing.third_party?.api_key || ""
    }
  };

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try { await chmod(configPath, 0o600); } catch {}

  console.log(JSON.stringify({
    status: apiKey ? "configured" : "configured_without_api_key",
    config_path: configPath,
    provider_mode: config.provider_mode,
    provider: {
      name: config.third_party.name,
      base_url: config.third_party.base_url,
      model: config.third_party.model,
      api_key_env: config.third_party.api_key_env,
      api_key_preview: mask(config.third_party.api_key)
    },
    chmod: "600"
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
