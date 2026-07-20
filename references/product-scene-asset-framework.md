# Product Scene Asset Framework

Use this reference when a commercial/product video must be turned into image assets for video recreation. Do not try to enumerate every possible product category. Instead, let Codex derive the needed assets from source-frame evidence using the control layers below.

## Product Scene Control Brief

Before provider generation, write or derive a compact `product_scene_control_brief` from visually inspected frames. The brief must answer:

- **Product role in the video:** hero object, worn item, held prop, body-contact item, surface-contact item, environment-scale item, consumable/effect item, packaging/label item, or ambiguous.
- **What must stay stable:** product shape, scale, color, material, placement, contact surface, body relationship, camera angle, lighting, and scene geometry.
- **What should be isolated:** product/object, model/person, wardrobe, material texture, interaction surface, background scene, or transition language.
- **What should be removed:** platform UI, captions, watermarks, unauthorized logos, temporary clutter, black/white transition frames, hands/people when preparing empty plates.
- **Action dependencies:** hands, face, body pose, lying/sitting/standing/walking, pouring/opening/folding/pressing, before/after effect, or no action.
- **Scene dependencies:** bedroom, street, tabletop, bathroom, kitchen, vehicle, outdoor, studio, store, factory, or source-defined environment. This is descriptive evidence, not a fixed category list.
- **Required asset roles:** choose from the skill taxonomy and explain why each role matters for video-model stability.
- **do-not-generate list:** generic ecommerce packshot, arbitrary lifestyle ad, random new room, new model identity, unsupported product variant, unsourced props, extra text, or any other source-specific failure.

If any field cannot be supported by source frames or user notes, mark it `unknown_from_evidence` and keep provider generation blocked until Codex fills the visual evidence.

## Control Layers

Choose assets by dependency, not by product category:

| control layer | question | typical asset roles |
| --- | --- | --- |
| Environment | What stable place does the video happen in? | `clean_scene_plate`, `camera_angle_plate_set`, `background_plate` |
| Composition | What original frame relationship should survive after UI cleanup? | `ui_free_scene_reconstruction` |
| Interaction surface | Where do hands, body, product, or props make contact? | `surface_interaction_plate` |
| Human action | Does a person/model drive the video logic? | `clean_model_scene_reference`, `clean_model_plain_background`, `clean_model_pose_pack`, `pose_reference_pack` |
| Product/object control | What object must keep shape, scale, and material? | `prop_cutout`, role-specific product prompt in request pack |
| Wear/fit/control on body | Is the product worn, held, applied, rested on, or pressed against the body? | `clean_model_pose_pack`, `pose_reference_pack`, `surface_interaction_plate`, `wardrobe_detail` |
| Material/detail | Is the selling point texture, stitching, gloss, softness, transparency, fill, hardware, liquid/effect state, screen/label zone, or construction? | `product_material_detail`, `wardrobe_detail` only for worn-item evidence, `prop_cutout`, macro/detail prompt |
| Transition/motion language | Does the source use zoom, blur, wipe, speed ramp, or repeated action beats? | `transition_reference`, `negative_control` |
| Risk control | What failures would make the video unusable? | `negative_control`, QA manifest rules |

## Decision Rules

- If the product defines the environment scale, such as bed, sofa, mattress, chair, appliance, vehicle, wall decor, or large furniture, keep it as a possible scene anchor in at least one plate. Also create an empty or cleaned scene plate that removes transient people/UI.
- If the product is used on or near a person, model assets are required when a person appears in the source. Generate in-scene model reference, plain-background model reference, and individual pose/action references before isolated product cutouts.
- If the product depends on contact with a surface or body part, create a clean interaction plate for that contact zone. Do not rely only on a generic product cutout.
- If the video sells material, comfort, fit, texture, softness, shine, waterproofing, transparency, folding, compression, or construction, create macro/detail assets and make the prompt name the exact visible evidence.
- If the video contains platform UI or overlaid text, include a UI-free reconstruction to keep the original composition while removing the overlay.
- If the source has strong camera changes, create camera angle plates before product detail assets.
- If source evidence is weak, generate request packs and QA checklists first; do not send generic prompts to the provider.
- Generate only roles listed in `product_scene_control_brief.required_asset_roles`. If the role is not required for the current task, it must not be sent to the provider. Wrong-place assets such as unrelated wardrobe sets, character turnarounds, bags, shoes, or historical-task products should be blocked before generation, not deferred to QA.
- If the product uses liquid, powder, smoke, steam, foam, food, spray, or other changing states, define the effect contact zone, flow direction, viscosity/state, shadows, and before/after frame match. Do not let the provider invent splashes, vapor, or food textures not present in evidence.
- If the product includes a screen, display, label, package, bottle, or box, define the physical screen/label zone separately from text content. Default to removing or neutralizing unauthorized UI/logo/text; prevent mirrored text and wrong screen aspect.
- If the product is transparent, glass, reflective, metal, or mirror-like, define edge visibility, reflection direction, opacity, and background influence. Do not accept cloudy glass, lost edges, or random reflections.
- If the video demonstrates mechanical motion, folding, hinges, rotating parts, buttons, wheels, or open/closed states, define part count, axis, state order, and scale before generation. Use transition/motion references only after the static states are controlled.
- If the video relies on before/after effect comparison, define matched camera, light, subject scale, and surface state for both sides; do not compare two unrelated scenes.

## Example Reasoning Pattern

For a pillow video with a model lying on a bed, the skill should not choose between "copy the exact lying scene" and "only isolate the model." It should create a control set:

- bedroom/window/bed empty plate for environment stability
- bed surface interaction plate for pillow/body contact
- UI-free scene reconstruction preserving pillow and model placement
- clean in-scene model reference for pose and camera relationship
- clean plain-background model reference for non-identity-locked character control
- individual pose pack for lying, turning, hand touch, sitting up, and close-up beats
- pillow cutout and material/detail references for shape, fabric, edge, loft, and compression
- negative controls for generic hotel room, arbitrary model, floating pillow, wrong bedding, extra UI, and unsupported labels

Use the same reasoning for every product scene: identify what controls video stability, then generate those assets. The product category only changes the visual facts inside the prompts.
