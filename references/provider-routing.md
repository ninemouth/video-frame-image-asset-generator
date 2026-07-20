# Provider Routing

Use this reference before executing generated-image requests or changing provider behavior.

## Modes

### `native_codex`

Use for most Codex tasks:

- reference-aware generation from attached or visible images
- editing an existing image
- visual continuity from keyframes
- transparent-ready chroma-key generation plus local alpha removal
- project-bound assets that must be inspected and copied into a workspace

Load the system `imagegen` skill and follow its rules. In particular, built-in image generation is the default path; project-bound results must be copied out of the default Codex generated-images location and into the current run.

### `third_party_api`

Use when the user asks for third-party/proxy generation, local config selects it, or native generation is unavailable and a compatible API key is configured.

The bundled runtime is intentionally narrow:

- endpoint: OpenAI-compatible `POST /images/generations`
- input: text prompt
- output: image from `b64_json` or downloadable `url`
- defaults: `https://www.thinkai.tv/v1`, `gpt-image-2`

Do not expose API keys in logs or user-facing text. Store only the selected key environment variable name and a masked key preview in `provider/provider-resolution.json`.

### `request_pack_only`

Use when:

- generation is blocked or user only wants a handoff package
- reference-image support is required but only generic third-party text-to-image is configured
- provider capability is unknown
- the user wants review/approval before spending generation budget

## Environment

Provider selection can use:

- `VIDEO_IMAGE_PROVIDER_API_KEY`
- `VIDEO_IMAGE_PROVIDER_BASE_URL`
- `VIDEO_IMAGE_PROVIDER_MODEL`
- `THINKAI_API_KEY`
- `CHARLIE_KEY`
- `${CODEX_HOME:-$HOME/.codex}/video-frame-image-asset-generator/image-provider.json`

Never hardcode secrets in skill source, Git, prompts, reports, or user-facing text. If no key is found for third-party mode, ask the user to set an environment variable locally or run:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/video-frame-image-asset-generator/scripts/configure-image-provider.mjs --prompt-if-missing
```

The configuration file is local-only, written with `0600` permissions, and may contain the entered key. Do not copy it into a repo or run output.

## Output Diagnostics

Write provider diagnostics under `provider/`:

- selected mode
- base URL origin/path, but no key
- model
- key environment variable name
- local provider config path
- blocked reason, if any
- timestamp

Keep raw HTTP failures in run diagnostics. User-facing summaries should say what is blocked and the smallest next step.

The third-party runtime updates `output/asset-manifest.json` unless `--no-update-manifest` is supplied. Provider-generated files are added to `generated_assets` as `delivery_status: reference_only` and `qa_status: pending_visual_review`; visual QA must promote them before `ready_for_video_model`. Provider failures and skipped draft requests are recorded on their prompt targets so `validate-asset-manifest.mjs --write-report` can explain what to retry.
