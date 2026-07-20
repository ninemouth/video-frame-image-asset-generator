# Scene Stability Assets

Use this reference when the goal is to improve video recreation stability rather than produce standalone product imagery.

## Why These Assets Matter

AI video recreation often drifts because every segment re-invents the room, street, bed, tabletop, window, lighting, and camera geometry. A clean scene plate gives the video model a stable visual anchor before adding people, products, hands, text, or motion.

## Required Order

For recreation work, generate or prepare assets in this order:

1. `clean_scene_plate`: full-frame empty environment from the strongest wide frame.
2. `camera_angle_plate_set`: 3-4 empty plates for the main camera positions used in the timeline.
3. `surface_interaction_plate`: clean close/detail area where hands, props, or product interactions happen.
4. `ui_free_scene_reconstruction`: same composition with intended subject/product but no platform UI.
5. If a model/person appears in the source: `clean_model_scene_reference`, `clean_model_plain_background`, and `clean_model_pose_pack`.
6. Character, prop, wardrobe, pose, and transition assets.

Do not start with product pack shots, lifestyle ads, explainers, or generic studio renders unless the user explicitly asks for ecommerce images.

## Visual Evidence Brief

Before provider generation, write a compact visual evidence brief. It must name source-grounded facts, not vibes:

- aspect ratio and camera height
- permanent scene geometry
- background structures and their relative positions
- key surface textures and wrinkle/edge directions
- natural/artificial light direction and color temperature
- persistent props or furniture
- transient elements to remove
- product/person placement zones, if later compositing needs them
- whether a model/person appears, plus age range, hairstyle category, clothing category, body crop, pose beats, and interaction with scene/product

For commercial/product videos, also derive the product scene control brief from `product-scene-asset-framework.md`. The brief should identify the product's role in the scene, contact surfaces, action dependencies, material/detail claims, and do-not-generate risks so the asset matrix stays targeted without requiring product-category presets.

Example:

```text
Vertical 9:16 bedroom video. Camera is above and slightly diagonal to a white quilted bed near tall bright windows. Cream curtains and green outdoor foliage stay visible through the windows. White pillows and folded white bedding occupy the lower/middle frame. Soft daylight enters from the window side; overall palette is warm white and pale green. Woman model appears in white camisole/sleepwear, lying and sitting on bed, touching or arranging the white pillow product; use non-identity-locked ordinary commercial model references. Remove Chinese captions, platform UI, and red product labels unless specifically needed.
```

## Prompt Requirements

Every stability plate prompt must say:

- "video recreation stability plate" or equivalent
- preserve original camera/perspective/aspect ratio
- preserve permanent geometry and lighting
- remove people, hands, UI, subtitles, watermarks, and transient artifacts
- avoid generic ecommerce, studio product, lifestyle ad, or arbitrary room redesign

If these details are missing, mark the request pack as `ready_for_generation: false`.

## Model Assets

Do not confuse empty scene plates with complete recreation support. When the source video has a model, the pack is incomplete unless it also includes clean model assets:

- `clean_model_scene_reference`: model remains in the source scene, UI/captions/watermarks removed.
- `clean_model_plain_background`: model isolated on true white/light gray for replacement or compositing; no bed, window, furniture, product, UI, captions, watermarks, or scene residue.
- `clean_model_pose_pack`: several source-grounded pose/action beats from the video timeline; final assets must include individual pose images, not only a collage.

These must preserve clothing category, hairstyle category, pose logic, camera crop, and scene interaction while avoiding biometric identity claims unless the user has explicitly authorized identity preservation.

## Delivery Gate

Scene stability assets are useful only when their role is honest. Before delivery:

- Mark source crops, masked frames, reused older generations, and provider-blocked substitutes as `fallback_review_required` or `reference_only`.
- Mark role-mismatched outputs as `failed_role` or `retry_required`.
- Mark an image `ready_for_video_model` only after visual QA confirms the role-specific constraints in `qa-delivery-contract.md`.
- Run `scripts/validate-asset-manifest.mjs` when an asset manifest is available.
