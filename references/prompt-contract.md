# Prompt Contract

Use this reference before writing final generation prompts, request packs, or third-party API payloads.

## Prompt Layers

Write prompts in this order:

1. **Source evidence:** frame ids, timestamps, and what each frame proves.
2. **Visual evidence brief:** verified scene geometry, camera, light, persistent objects/surfaces, and transient removals.
3. **Product scene control brief:** for commercial/product videos, state product role, action dependencies, contact surfaces, material/detail claims, scene dependencies, required asset roles, and do-not-generate list.
4. **Asset role:** one role from `asset-taxonomy.md`.
5. **Primary request:** the exact deliverable to generate.
6. **Invariants:** subject identity policy, outfit/product geometry, prop placement, camera perspective, aspect ratio, lighting, environment.
7. **Cleanup:** remove UI, captions, watermarks, logos, compression artifacts, black/white transition frames, duplicate ghosting, and mirrored text unless requested.
8. **Background:** scene plate, pure white, light gray, chroma key, transparent-ready, or original environment.
9. **Camera and composition:** angle, lens feeling, crop, padding, safe zones.
10. **Negative constraints:** concrete failure modes to avoid.
11. **QA checks:** what the agent must inspect after generation.

## Template

```text
Use case: video-frame-recreation-asset
Asset role: <role>
Source evidence: <frame ids/timestamps and verified facts>
Visual evidence brief: <scene geometry, camera, light, persistent surfaces, transient elements to remove>
Product scene control brief: <product role, action dependencies, contact surface, material/detail claims, required asset roles, do-not-generate list>
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
- Avoid: generic ecommerce product shots, studio pack shots, explainer diagrams, arbitrary room redesign, decorative props not visible in evidence, and mismatched camera angles.

If the visual evidence brief is missing, the prompt is a draft only and must not be sent to an image provider.

## Model References

When the source includes a model/person, include model prompts before product/prop prompts:

- `clean_model_scene_reference`: keep the model in the original cleaned scene.
- `clean_model_plain_background`: isolate a non-identity-locked ordinary model reference on true white/light gray with no bed, window, furniture, product, UI, captions, watermarks, or scene residue.
- `clean_model_pose_pack`: cover the main source pose/action beats and request individual image files for each pose in addition to any overview sheet.

Model prompts must preserve visible source-grounded facts such as age range, hairstyle category, clothing category, body crop, pose logic, camera angle, and interaction with the scene/product. They must remove UI, captions, watermarks, unauthorized logos, and compression artifacts. Do not claim exact identity preservation unless the user explicitly confirms rights and intent.

Reject role-mismatched outputs: a plain-background model with scene residue is `failed_role` or `retry_required`; a collage-only pose sheet is `reference_only`; a local crop or mask fallback is `fallback_review_required`.

## Prop And Wardrobe Cutouts

For isolated props:

- Require the full object inside frame, no cropping, no floating, no extra straps/handles unless visible in evidence.
- Use pure white or light gray for inspection; use chroma-key only for transparent extraction workflows.
- For shiny black items, request visible edge highlights and material separation so details do not collapse into a single dark blob.

For wardrobe details, require material and construction evidence such as straps, closures, wrinkles, texture, edges, hardware, or layered garment structure. A face crop or low-information body crop does not satisfy `wardrobe_detail`.

## Delivery Status

Before delivery, classify every image with the status vocabulary in `qa-delivery-contract.md`: `ready_for_video_model`, `reference_only`, `fallback_review_required`, `retry_required`, or `failed_role`. Do not place uncertain fallback outputs into `final-assets/` without a manifest status that makes the limitation clear.

## Third-Party API Notes

Third-party text-to-image prompts must be self-contained because the generic runtime does not upload reference images by default. Mention reference frame ids as evidence for the human/Codex operator, but do not assume the provider can see local images unless a provider-specific image-input endpoint is implemented and verified.
