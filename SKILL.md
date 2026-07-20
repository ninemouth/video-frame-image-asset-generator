---
name: video-frame-image-asset-generator
description: "Use when Codex needs to turn video keyframes, FFmpeg recreation runs, screenshots, pasted frames, or recreation reports into clean image-generation assets for video remake work: clean scene plates, UI-free backgrounds, multi-angle character references on plain backgrounds, prop and wardrobe cutouts, prompt packs, request packs, QA manifests, or generated images through Codex native imagegen or an OpenAI-compatible third-party image API."
---

# Video Frame Image Asset Generator

## Purpose

Use this skill to convert extracted video-frame evidence into reusable image assets for recreation work. The skill owns what to generate and how to describe the generation target; the execution layer only creates pixels.

Keep the two responsibilities separate:

- **Asset control layer:** inspect frames and reports, choose asset roles, lock continuity, write prompts, create request packs, and QA outputs.
- **Generation capability layer:** use system `imagegen` / built-in image generation for Codex-native reference-aware work, or use the bundled OpenAI-compatible third-party runtime when the user selects or configures that path.

## Core Workflow

1. Locate source evidence:
   - Prefer an FFmpeg recreation run containing `metadata/frame-index.json`, `metadata/frame-quality.json`, `output/recreate-report.md`, `output/keyframes/`, or `output/recreation-pack/`.
   - Also accept loose frame images, pasted screenshots, contact sheets, or user-provided source descriptions.
2. Create a run folder:
   ```bash
   node ${CODEX_HOME:-$HOME/.codex}/skills/video-frame-image-asset-generator/scripts/create-asset-run.mjs \
     --source-run /abs/ffmpeg-run \
     --slug sg01-clean-assets
   ```
3. Inspect the keyframes visually before final prompt writing. Scripts can index files and draft the matrix, but only Codex visual inspection should assert clothing, face, prop, environment, UI, or action facts. For video recreation, write a visual evidence brief before provider generation; read `references/scene-stability-assets.md` when the goal is stable empty scene plates. If a model/person appears in the source, the pack must include clean model references, not only empty scenes and product assets.
4. Plan the target asset matrix:
   ```bash
   node ${CODEX_HOME:-$HOME/.codex}/skills/video-frame-image-asset-generator/scripts/plan-image-assets.mjs \
     --run-dir /abs/asset-run \
     --source-run /abs/ffmpeg-run \
     --language zh \
     --visual-brief /abs/visual-evidence-brief.md
   ```
5. Resolve provider before execution:
   ```bash
   node ${CODEX_HOME:-$HOME/.codex}/skills/video-frame-image-asset-generator/scripts/resolve-image-provider.mjs \
     --run-dir /abs/asset-run \
     --mode auto
   ```
   If the user is installing through `$ffmpeg-video-recreator`, its installer will install/update this skill and run the provider configuration prompt. To configure manually:
   ```bash
   node ${CODEX_HOME:-$HOME/.codex}/skills/video-frame-image-asset-generator/scripts/configure-image-provider.mjs \
     --prompt-if-missing
   ```
6. Generate assets:
   - For `native_codex`, load and use the system `imagegen` skill. Use built-in image generation by default, especially when reference images or edit semantics matter.
- For `third_party_api`, use `scripts/third-party-image-runtime.mjs` for text-to-image prompts and request packs. Do not claim reference-image editing unless the configured provider is known to support that exact endpoint.
   - If `visual_evidence_brief` is missing, do not send request-pack entries to any image provider. Fill the visual facts first, then rerun planning.
   - For blocked or review-first work, deliver `output/prompt-pack.md` and `output/request-pack.jsonl`.
7. QA and deliver:
   - Save final images under the run-local `generated-assets/` or `final-assets/`.
   - Update `output/asset-manifest.json` with final paths, provider, prompt id, source evidence, and QA status.
   - Use role-level delivery statuses: `ready_for_video_model`, `reference_only`, `fallback_review_required`, `retry_required`, or `failed_role`.
   - Local crops, masked frames, reused older generations, and provider-blocked substitutes are useful references, but they must be marked `fallback_review_required` or `reference_only`; never mark them `ready_for_video_model`.
   - Run `scripts/validate-asset-manifest.mjs` before delivery when an asset manifest exists.
   - Provide direct-access output files; do not make the user hunt through internal work folders.

## Asset Roles

Default roles are:

- `clean_scene_plate`: same location without people, UI, captions, watermarks, products, hands, or transient clutter unless a product is explicitly required as an anchor.
- `camera_angle_plate_set`: multiple empty plates matching the timeline's main camera positions, used to stabilize segment-to-segment video generation.
- `surface_interaction_plate`: clean close-up surface/interaction area for later hands, products, props, or motion.
- `ui_free_scene_reconstruction`: same shot feeling but clean, brand-free, platform-UI-free.
- `clean_model_scene_reference`: source-grounded clean model photo inside the cleaned original scene.
- `clean_model_plain_background`: clean non-identity-locked model/person photo on true white or light gray background; no bed, window, furniture, product, UI, or scene residue.
- `clean_model_pose_pack`: 3-5 clean source-grounded model pose/action references from the video timeline; final delivery must include individual pose images, not only a collage sheet.
- `character_turnaround`: same designed character or user-authorized subject, front/side/back/three-quarter on plain light background.
- `wardrobe_detail`: clothing/accessory material, silhouette, closures, texture, and layered details.
- `prop_cutout`: bag, shoe, tool, furniture, handheld item, vehicle detail, or other isolated prop.
- `background_plate`: reusable environment plate for later compositing or video generation.
- `pose_reference_pack`: repeated poses matching key timeline moments, usually on pure background.
- `transition_reference`: clean stills that express radial blur, zoom, smear, motion streak, or other transition language without baked UI.
- `negative_control`: examples and prompt negatives that prevent identity drift, mirrored text, floating props, brand logos, extra limbs, wrong aspect ratio, and low-information frames.

Read `references/asset-taxonomy.md` when role choice matters or the user asks for a full asset pack.
Read `references/scene-stability-assets.md` when the user complains about unstable video recreation, generic image outputs, or asks for empty scene plates.
Read `references/qa-delivery-contract.md` before deciding whether generated files can be placed in `final-assets/` or marked video-ready.

## Prompt Contract

Write every prompt as a production brief, not a generic caption. Include:

- Source evidence: frame ids/timestamps and what each frame proves.
- Visual evidence brief: verified scene geometry, camera, light, persistent surfaces, transient elements to remove, and source-grounded placement zones.
- Target asset role and final use.
- Subject/scene invariants: identity policy, clothing, props, environment, perspective, lighting, aspect ratio.
- Required cleanup: remove UI overlays, watermarks, captions, brands, compression artifacts, black/white transition frames, and mirrored text unless explicitly requested.
- Background and angle: pure background, chroma-key, transparent-ready, scene plate, or exact camera perspective.
- Negative constraints and QA checks.

Read `references/prompt-contract.md` before writing final prompts or request packs.

## Provider Routing

Use `references/provider-routing.md` before changing provider behavior.

- `native_codex`: preferred for normal Codex tasks, image edits, reference-aware generation, chroma-key-to-transparent flows, and project-bound assets. Load the system `imagegen` skill and follow its save-path rules.
- `third_party_api`: OpenAI-compatible API path for text-to-image when the user requests third-party generation, Codex native generation is unavailable, or local config selects a proxy. Defaults are configurable and must never expose API keys.
- `request_pack_only`: use when generation is blocked, provider capability is unknown, or the user wants a handoff package for another generator.

Third-party runtime environment variables:

- `VIDEO_IMAGE_PROVIDER_API_KEY`, `VIDEO_IMAGE_PROVIDER_BASE_URL`, `VIDEO_IMAGE_PROVIDER_MODEL`
- fallback key names: `THINKAI_API_KEY`, `CHARLIE_KEY`
- default compatible profile: `https://www.thinkai.tv/v1`, model `gpt-image-2`
- local config: `${CODEX_HOME:-$HOME/.codex}/video-frame-image-asset-generator/image-provider.json` with `0600` permissions. The config may store a local API key when the user enters it during installation; never commit or display this file.

## Safety And Rights

- Do not preserve a private real person's identity unless the user owns/has permission for that use or explicitly asks for a fictional replacement inspired only by clothing, pose, or scene.
- Do not copy logos, watermarks, platform UI, creator marks, or brand identifiers unless the user owns them and asks for exact preservation.
- Treat exact artwork, printed patterns, tattoos, decals, product labels, and fabric graphics as canonical material only when supplied by the user and permitted. Otherwise recreate the broad visual role, not the protected mark.
- For source videos with social-platform overlays, default to clean, brand-free, UI-free deliverables.

## Bundled Resources

- `scripts/create-asset-run.mjs`: create a run skeleton and source manifest.
- `scripts/configure-image-provider.mjs`: prompt for or write local third-party provider config.
- `scripts/plan-image-assets.mjs`: build `asset-generation-plan.json`, `prompt-pack.md`, `request-pack.jsonl`, and manifest drafts from frame evidence.
- `scripts/resolve-image-provider.mjs`: resolve native, third-party, or request-pack routing without exposing secrets.
- `scripts/third-party-image-runtime.mjs`: execute OpenAI-compatible text-to-image prompts and save images to the run.
- `scripts/validate-asset-manifest.mjs`: validate prompt targets, role acceptance rules, final status vocabulary, and fallback status safety.
- `scripts/verify-skill.mjs`: validate file shape, script syntax, and required contract terms.
- `scripts/sync-to-codex-skill.mjs`: sync a development copy into `${CODEX_HOME:-$HOME/.codex}/skills/video-frame-image-asset-generator`.
- `references/frame-source-contract.md`: expected source inputs and frame-index mapping.
- `references/asset-taxonomy.md`: asset role definitions and default shot matrix.
- `references/scene-stability-assets.md`: stability-first scene plate rules for improving video recreation consistency.
- `references/prompt-contract.md`: prompt schema, evidence locks, negatives, and QA rules.
- `references/qa-delivery-contract.md`: hard role QA and final delivery status rules.
- `references/provider-routing.md`: native and third-party execution boundaries.
