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
5. Character, prop, wardrobe, pose, and transition assets.

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

Example:

```text
Vertical 9:16 bedroom video. Camera is above and slightly diagonal to a white quilted bed near tall bright windows. Cream curtains and green outdoor foliage stay visible through the windows. White pillows and folded white bedding occupy the lower/middle frame. Soft daylight enters from the window side; overall palette is warm white and pale green. Remove woman, hands, Chinese captions, platform UI, and red product labels unless specifically needed.
```

## Prompt Requirements

Every stability plate prompt must say:

- "video recreation stability plate" or equivalent
- preserve original camera/perspective/aspect ratio
- preserve permanent geometry and lighting
- remove people, hands, UI, subtitles, watermarks, and transient artifacts
- avoid generic ecommerce, studio product, lifestyle ad, or arbitrary room redesign

If these details are missing, mark the request pack as `ready_for_generation: false`.
