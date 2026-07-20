# QA Delivery Contract

Use this reference before marking generated or fallback files as final assets for video recreation.

## Final Status Vocabulary

Every delivered image must use one of these statuses:

| status | meaning | allowed use |
| --- | --- | --- |
| `ready_for_video_model` | Passed role-specific visual QA and can be used as a video-model reference. | Only for generated or edited assets that match the declared role. |
| `reference_only` | Useful evidence for a human operator, but too weak to control video generation. | Source crops, contact sheets, comparison boards, low-confidence visual notes. |
| `fallback_review_required` | Temporary substitute because generation failed, provider was blocked, or only local crop/mask/reuse exists. | Local source-frame crops, masked logos, reused older generations, emergency handoff images. |
| `retry_required` | Prompt target is valid, but generation failed or the result needs rerun. | Provider HTTP failures, malformed outputs, wrong aspect ratio, missing required subject. |
| `failed_role` | Image content does not match the declared role. | Plain-background image still has scene; wardrobe detail is a face crop; pose pack has artifacts. |

Never mark a fallback, crop, mask, or reused prior-generation image as `ready_for_video_model`.

## Role Gates

### Scene Plates

`clean_scene_plate` and `camera_angle_plate_set` must preserve source geometry: camera height, lens direction, perspective lines, window/bed/floor/road relationships, light direction, and color temperature. They fail when they become generic showrooms, ecommerce studios, arbitrary rooms, or attractive but source-loose backgrounds.

### Surface Interaction Plates

`surface_interaction_plate` must preserve the source interaction surface: texture, wrinkle direction, edge perspective, local light, and contact-shadow logic. It should leave a clean placement zone for hands, products, props, or local action.

### UI-Free Reconstruction

`ui_free_scene_reconstruction` keeps the subject/product composition and scene relationship while removing UI, captions, watermarks, and unauthorized marks. It fails if it becomes a new scene or standalone product ad.

### Model References

`clean_model_scene_reference` keeps the non-identity-locked model in the cleaned source scene and preserves pose logic, clothing category, hairstyle category, body proportion class, camera crop, and product/scene interaction.

`clean_model_plain_background` must have a true plain white or light gray background. It fails if it contains bed, window, furniture, product, scene residue, UI, captions, or watermarks.

`clean_model_pose_pack` must cover 3-5 source timeline pose/action beats. Final delivery must include individual image files for each pose in addition to any overview sheet. A collage sheet alone is `reference_only`, not `ready_for_video_model`.

### Wardrobe And Props

`wardrobe_detail` must primarily show garment, shoe, or accessory material and construction: straps, closures, wrinkles, seams, texture, edges, or hardware. It fails if it is mainly a face crop, upper-body crop, or low-information screenshot.

`prop_cutout` must show the complete object on plain or transparent-ready background with enough padding. Straps, chains, handles, soles, or furniture edges must not float or break.

## Manifest Requirements

`output/asset-manifest.json` must keep:

- `prompt_targets[].acceptance`: role-specific acceptance rules.
- `prompt_targets[].allowed_final_statuses`: the five allowed statuses.
- `generated_assets[].delivery_status` or equivalent status field.
- A clear source/provenance field for local crops, masks, reused images, provider outputs, or native Codex generations.

Run:

```bash
node scripts/validate-asset-manifest.mjs --run-dir /abs/asset-run
```

Use `--inspect-images` on final passes when the generated files are already present and you want lightweight heuristic QA for plain-background and pose-pack failures.

Use `--require-final` only when the task must prove at least one image is ready for video-model input.
