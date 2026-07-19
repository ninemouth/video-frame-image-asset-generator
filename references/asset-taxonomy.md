# Asset Taxonomy

Use this reference when choosing what image assets to generate from frame evidence.

## Default Asset Matrix

| role | purpose | normal background | common source evidence |
| --- | --- | --- | --- |
| `clean_scene_plate` | Empty or clean environment for video regeneration/compositing | original scene, no UI/person/clutter | wide frames, opening frame |
| `camera_angle_plate_set` | Multiple empty scene anchors for main video camera positions | original scene, no people/UI | representative wide/medium/detail frames |
| `surface_interaction_plate` | Clean local surface where hands, product, or props will later appear | original surface, no hands/UI | close-up interaction frames |
| `ui_free_scene_reconstruction` | Scene that keeps composition but removes app UI/captions/watermarks | original scene | frames with platform overlays |
| `background_plate` | Reusable backdrop without the subject | original scene, neutral lighting | stable environment frames |
| `character_turnaround` | Multi-angle same designed character or authorized person | plain light gray or white | best full-body and close-up frames |
| `pose_reference_pack` | Pose states matching video timeline | plain light gray, white, or chroma key | action frames, transition endpoints |
| `wardrobe_detail` | Clothing, shoes, accessories, material and construction | white, light gray, or macro studio | close-ups and detail frames |
| `prop_cutout` | Isolated bag, tool, object, product, vehicle, furniture, etc. | pure white or chroma key | close-up frames and product focus |
| `transition_reference` | Clean still for radial blur, zoom, smear, motion streak language | source scene or abstract transparent-ready streaks | transition frames, blur endpoints |
| `negative_control` | Prevent wrong identities, logos, UI, extra limbs, floating props, bad aspect | text-only QA/request pack | failed frames and risk notes |

## Video Recreation Defaults

- Preserve aspect ratio unless the user asks for a different generation target.
- Prioritize scene stability plates before product, character, lifestyle, explainer, or detail assets.
- Remove social UI, captions, creator watermarks, brand marks, mirrored text, and black/white transition artifacts by default.
- Do not generate generic ecommerce/product/studio imagery when the source is a video scene. The output must stay anchored to visually inspected frame geometry.
- For character packs, prefer one consistent fictionalized design unless the user explicitly authorizes preserving a real person.
- For props and wardrobe, isolate on pure background with generous padding; use chroma key only when transparent delivery is needed.
- For scene plates, remove people and movable objects only when doing so will not break the geometry of the scene.

## Suggested Minimum Pack

For a normal short fashion/street video recreation:

- 1 clean scene plate
- 1 camera angle plate set
- 1 surface interaction plate
- 1 UI-free scene reconstruction
- 1 character turnaround sheet prompt
- 3 wardrobe/detail prompts: upper body, lower body/shoes, bag/prop
- 2 pose reference prompts matching the main walk/action beats
- 1 transition reference prompt
- 1 negative-control entry
