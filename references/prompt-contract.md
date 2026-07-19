# Prompt Contract

Use this reference before writing final generation prompts, request packs, or third-party API payloads.

## Prompt Layers

Write prompts in this order:

1. **Source evidence:** frame ids, timestamps, and what each frame proves.
2. **Asset role:** one role from `asset-taxonomy.md`.
3. **Primary request:** the exact deliverable to generate.
4. **Invariants:** subject identity policy, outfit/product geometry, prop placement, camera perspective, aspect ratio, lighting, environment.
5. **Cleanup:** remove UI, captions, watermarks, logos, compression artifacts, black/white transition frames, duplicate ghosting, and mirrored text unless requested.
6. **Background:** scene plate, pure white, light gray, chroma key, transparent-ready, or original environment.
7. **Camera and composition:** angle, lens feeling, crop, padding, safe zones.
8. **Negative constraints:** concrete failure modes to avoid.
9. **QA checks:** what the agent must inspect after generation.

## Template

```text
Use case: video-frame-recreation-asset
Asset role: <role>
Source evidence: <frame ids/timestamps and verified facts>
Primary request: <single image or sheet to generate>
Subject/scene invariants: <what must remain consistent>
Required cleanup: <what to remove>
Background: <plain/scene/chroma-key/transparent-ready>
Composition: <angle, crop, safe zones, aspect ratio>
Style/medium: <photorealistic, studio, cinematic, clean catalog, etc.>
Negative constraints: <specific forbidden failures>
QA acceptance: <checks before delivery>
```

## Character And Identity

- Use `fictionalized character based on outfit, pose, and scene evidence` unless the user explicitly authorizes preserving a real person's identity.
- Preserve visual continuity through clothing, hairstyle category, body proportion class, and pose logic without claiming biometric identity when not authorized.
- Multi-angle sheets should request front, back, side, and three-quarter views on one clean background, with consistent clothing and accessories.

## Scene Plates

For scene plates, state both what to preserve and what to remove:

- Preserve: camera height, vanishing lines, road/floor geometry, lighting direction, time of day, color temperature, architectural rhythm.
- Remove: people, platform UI, captions, watermarks, brand signage when not authorized, motion blur artifacts, black/white transition frames.

## Prop And Wardrobe Cutouts

For isolated props:

- Require the full object inside frame, no cropping, no floating, no extra straps/handles unless visible in evidence.
- Use pure white or light gray for inspection; use chroma-key only for transparent extraction workflows.
- For shiny black items, request visible edge highlights and material separation so details do not collapse into a single dark blob.

## Third-Party API Notes

Third-party text-to-image prompts must be self-contained because the generic runtime does not upload reference images by default. Mention reference frame ids as evidence for the human/Codex operator, but do not assume the provider can see local images unless a provider-specific image-input endpoint is implemented and verified.
