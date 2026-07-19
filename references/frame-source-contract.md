# Frame Source Contract

Use this reference when the input comes from `ffmpeg-video-recreator`, loose screenshots, or an already-written recreation report.

## Preferred FFmpeg Run Inputs

The strongest source run contains:

- `metadata/frame-index.json`: frame id, timestamp, relative image path, extraction mode, and notes.
- `metadata/frame-quality.json`: black/white/low-information filtering results when available.
- `output/keyframes/`: direct keyframe images for visual inspection.
- `output/keyframes-index.md`: human-readable frame list.
- `output/recreate-report.md` or `output/recreation-pack/`: story, timeline, visual DNA, prompt, negatives, and QA notes.

Do not invent visual facts from metadata alone. Metadata can select evidence; Codex visual inspection must confirm subject, clothing, props, camera, environment, overlays, and defects.

## Loose Image Inputs

When no FFmpeg run exists, create a source manifest with:

- absolute path
- role: `reference_frame`, `contact_sheet`, `failed_output`, `style_reference`, `edit_target`, or `supporting_material`
- user-provided notes
- whether identity, artwork, logo, or product details are authorized for preservation

## Direct Access Principle

Every run should write user-facing outputs under `output/`:

- `output/README.md`
- `output/asset-manifest.json`
- `output/prompt-pack.md`
- `output/request-pack.jsonl`

Generated pixels should be copied or moved into `generated-assets/` or `final-assets/` and referenced from `output/asset-manifest.json`.
