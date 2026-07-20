#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function readJsonIfExists(file) {
  if (!file || !existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

async function readTextIfExists(file) {
  if (!file || !existsSync(file)) return "";
  return readFile(file, "utf8");
}

function normalizeFrameIndex(raw, sourceRun) {
  const candidates = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.frames)
      ? raw.frames
      : Array.isArray(raw?.keyframes)
        ? raw.keyframes
        : Array.isArray(raw?.items)
          ? raw.items
          : [];

  return candidates.map((frame, index) => {
    const relPath = frame.path || frame.file || frame.image || frame.relative_path || frame.frame_path || "";
    const id = frame.id || frame.frame_id || frame.name || String(index).padStart(8, "0");
    const timestamp = frame.timestamp ?? frame.time ?? frame.time_sec ?? frame.seconds ?? null;
    return {
      id: String(id),
      timestamp,
      path: relPath ? path.resolve(sourceRun, relPath) : null,
      relative_path: relPath || null,
      notes: frame.notes || frame.observation || null
    };
  });
}

function pickFrames(frames, count) {
  if (frames.length <= count) return frames;
  const picked = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i * (frames.length - 1)) / Math.max(1, count - 1));
    picked.push(frames[idx]);
  }
  return picked;
}

function evidenceLine(frames) {
  if (!frames.length) return "No indexed frames were found. Codex must inspect the supplied screenshots or user notes.";
  return frames
    .map((frame) => `${frame.id}${frame.timestamp !== null ? ` @ ${frame.timestamp}s` : ""}`)
    .join(", ");
}

const VIDEO_READY_STATUS = "planned_needs_generation";

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function deriveProductSceneControlBrief(visualBrief, language) {
  const zh = language === "zh";
  const text = String(visualBrief || "");
  const hasBrief = Boolean(text.trim());
  const roleSignals = [];
  const actionDependencies = [];
  const sceneDependencies = [];
  const materialDetailClaims = [];
  const doNotGenerate = zh
    ? [
        "泛化电商棚拍图",
        "任意新场景或新房间",
        "无来源新模特身份",
        "无来源新道具",
        "平台 UI、字幕、水印或未授权 Logo",
        "与源证据不一致的商品形状、比例、材质、接触关系或机位"
      ]
    : [
        "generic ecommerce studio packshot",
        "arbitrary new scene or room",
        "unsourced new model identity",
        "unsourced new props",
        "platform UI, captions, watermarks, or unauthorized logos",
        "product shape, scale, material, contact, or camera mismatch"
      ];

  if (!hasBrief) {
    return {
      status: "blocked_requires_visual_evidence_brief",
      product_role: ["unknown_from_evidence"],
      action_dependencies: ["unknown_from_evidence"],
      scene_dependencies: ["unknown_from_evidence"],
      interaction_surfaces: ["unknown_from_evidence"],
      material_detail_claims: ["unknown_from_evidence"],
      required_asset_roles: ["request_pack_only"],
      do_not_generate: doNotGenerate,
      summary: zh
        ? "缺少视觉证据 brief；必须先由 Codex 查看关键帧并定义商品角色、动作依赖、接触面、材质卖点和场景依赖。"
        : "Visual evidence brief is missing; Codex must inspect frames and define product role, action dependencies, contact surfaces, material claims, and scene dependencies first."
    };
  }

  if (hasAny(text, [/商品|产品|枕头|服装|鞋|包|道具|物体|product|pillow|item|object|prop|bag|shoe|garment/i])) {
    roleSignals.push(zh ? "hero_product_or_prop" : "hero_product_or_prop");
  }
  if (hasAny(text, [/穿|佩戴|上身|服装|鞋|包|worn|wear|outfit|dress|shoe|bag/i])) {
    roleSignals.push("worn_or_styled_item");
  }
  if (hasAny(text, [/躺|坐|站|走|触碰|使用|按压|整理|打开|倒|涂|手|lying|sitting|standing|walking|touch|press|use|open|pour|apply|hand/i])) {
    roleSignals.push("body_or_hand_interaction_product");
    actionDependencies.push("person_or_hand_action");
  }
  if (hasAny(text, [/床|桌|地面|沙发|台面|枕|卧室|街道|房间|surface|bed|table|floor|sofa|desktop|bedroom|street|room/i])) {
    sceneDependencies.push("source_scene_and_contact_surface");
  }
  if (hasAny(text, [/材质|面料|纹理|褶皱|光泽|柔软|压缩|透明|缝线|texture|fabric|material|wrinkle|gloss|soft|compression|transparent|stitch/i])) {
    materialDetailClaims.push("visible_material_or_construction_detail");
  }

  const hasHuman = detectHumanSubject(text);
  const requiredAssetRoles = [
    "clean_scene_plate",
    "camera_angle_plate_set",
    "surface_interaction_plate",
    "ui_free_scene_reconstruction",
    ...(hasHuman ? ["clean_model_scene_reference", "clean_model_plain_background", "clean_model_pose_pack"] : []),
    "prop_cutout",
    "wardrobe_detail",
    "transition_reference",
    "negative_control"
  ];

  return {
    status: "derived_from_visual_evidence_brief",
    product_role: roleSignals.length ? Array.from(new Set(roleSignals)) : ["source_defined_product_or_object"],
    action_dependencies: actionDependencies.length ? Array.from(new Set(actionDependencies)) : ["no_specific_action_detected_from_brief"],
    scene_dependencies: sceneDependencies.length ? Array.from(new Set(sceneDependencies)) : ["source_defined_environment"],
    interaction_surfaces: sceneDependencies.length ? ["source_grounded_contact_zone"] : ["unknown_or_not_required_from_brief"],
    material_detail_claims: materialDetailClaims.length ? Array.from(new Set(materialDetailClaims)) : ["not_explicit_in_brief"],
    required_asset_roles: requiredAssetRoles,
    do_not_generate: doNotGenerate,
    summary: zh
      ? `按证据 brief 采用控制层框架：商品角色=${roleSignals.join(", ") || "source_defined_product_or_object"}；动作依赖=${actionDependencies.join(", ") || "无明确动作"}；场景/接触依赖=${sceneDependencies.join(", ") || "源场景定义"}；材质细节=${materialDetailClaims.join(", ") || "未明确"}。`
      : `Use control-layer framework from evidence brief: product role=${roleSignals.join(", ") || "source_defined_product_or_object"}; action=${actionDependencies.join(", ") || "no specific action"}; scene/contact=${sceneDependencies.join(", ") || "source-defined scene"}; material=${materialDetailClaims.join(", ") || "not explicit"}.`
  };
}

function roleAcceptance(role, zh) {
  const common = zh
    ? [
        "内容必须能被追溯到已视觉核验的源帧事实。",
        "不得包含平台 UI、字幕、水印、未授权品牌标识、黑场/白场转场残影或镜像文字。",
        "若输出来自本地裁切、遮罩或旧结果复用，必须标记为 fallback_review_required 或 reference_only，不能标记 ready_for_video_model。"
      ]
    : [
        "Content must be traceable to visually verified source-frame facts.",
        "No platform UI, captions, watermarks, unauthorized brand marks, black/white transition artifacts, or mirrored text.",
        "If the output is a local crop, mask, or reused older result, mark it fallback_review_required or reference_only, never ready_for_video_model."
      ];

  const rules = {
    clean_scene_plate: zh
      ? [
          "必须是完整空场景，移除人物、手部、临时产品和可移动杂物，除非产品被明确指定为环境锚点。",
          "窗/床/地面/墙面/道路等永久几何、机位高度、透视线、光线方向和色温必须贴近源视频。",
          "不得生成泛化样板间、电商棚拍、无来源家具或任意重新设计的房间/街景。"
        ]
      : [
          "Must be a full clean empty scene, removing people, hands, transient products, and movable clutter unless the product is explicitly an environment anchor.",
          "Permanent geometry, camera height, perspective lines, light direction, and color temperature must stay close to the source video.",
          "Do not generate generic showrooms, ecommerce studios, unsourced furniture, or arbitrary room/street redesigns."
        ],
    camera_angle_plate_set: zh
      ? [
          "必须覆盖时间线主要机位，并保持同一空间连续性。",
          "每个机位都需要对应源视频动作段：开场、主动作、近景/细节、产品或道具操作区。",
          "不接受只生成一张通用漂亮场景图。"
        ]
      : [
          "Must cover the timeline's main camera positions while preserving one continuous space.",
          "Each angle needs a source timeline purpose: opening, main action, close/detail, product or prop operation zone.",
          "A single generic attractive scene is not acceptable."
        ],
    surface_interaction_plate: zh
      ? [
          "必须保留源视频中的承载面材质、褶皱方向、边缘透视、局部光影和接触阴影逻辑。",
          "不得出现手、人、字幕、水印或无来源新道具。",
          "应为后续放置产品、手部或局部动作留出清晰区域。"
        ]
      : [
          "Must preserve source surface material, wrinkle direction, edge perspective, local light, and contact-shadow logic.",
          "No hands, people, captions, watermarks, or unsourced new props.",
          "Must leave a clear zone for later product, hand, or local-action placement."
        ],
    ui_free_scene_reconstruction: zh
      ? [
          "必须保持源视频主体/产品的构图位置和场景关系，只移除 UI、字幕、水印和未授权标识。",
          "不得把画面改造成棚拍、商品详情页或新的场景。"
        ]
      : [
          "Must preserve the source subject/product composition and scene relationship while removing UI, captions, watermarks, and unauthorized marks.",
          "Do not turn the frame into a studio shot, product detail page, or new scene."
        ],
    clean_model_scene_reference: zh
      ? [
          "模特必须保留在源场景干净版中，用于锁定人物位置、姿态和镜头关系。",
          "保留年龄段、发型类别、服装类别、身形比例、动作逻辑和与产品/场景的互动。",
          "不得换成摄影棚或无来源新卧室；不得声称保留真人身份，除非用户明确授权。"
        ]
      : [
          "The model must remain in the cleaned source scene to lock person placement, pose, and camera relationship.",
          "Preserve age range, hairstyle category, clothing category, body proportion, action logic, and interaction with product/scene.",
          "Do not switch to a studio or unsourced new room; do not claim real identity preservation unless explicitly authorized."
        ],
    clean_model_plain_background: zh
      ? [
          "背景必须是真正纯白或浅灰，不得出现床、窗、家具、产品、场景残影、字幕或水印。",
          "人物为非身份锁定商业模特参考，只保留源视频可见的发型类别、服装类别、身形比例和姿态气质。",
          "不得裁掉关键头发、肩颈、手臂或服装结构；不合格时必须标记 failed_role 或 retry_required。"
        ]
      : [
          "Background must be truly plain white or light gray, with no bed, window, furniture, product, scene residue, captions, or watermarks.",
          "The person is a non-identity-locked commercial model reference, preserving only source-visible hairstyle category, clothing category, body proportion, and pose feeling.",
          "Do not crop key hair, shoulders, neck, arms, or clothing structure; mark failed_role or retry_required if this is not met."
        ],
    clean_model_pose_pack: zh
      ? [
          "必须覆盖源时间线 3-5 个主要姿态/动作节点。",
          "除总览 sheet 外，正式交付还必须有每个姿态的独立单图；拼贴图不能作为唯一可用资产。",
          "不得有白块遮罩、Logo 残留、身份漂移、服装漂移、手部畸形或裁切混乱。"
        ]
      : [
          "Must cover 3-5 main source timeline pose/action beats.",
          "Final delivery must include individual files for each pose in addition to any overview sheet; a collage cannot be the only usable asset.",
          "No white mask artifacts, logo remnants, identity drift, wardrobe drift, malformed hands, or chaotic crops."
        ],
    wardrobe_detail: zh
      ? [
          "必须主要展示服装/鞋/配饰的材质、结构、边缘、肩带/扣件/褶皱/纹理等细节。",
          "不得只是人物上半身、人脸裁切或低信息截图。",
          "纯色或微距背景，细节清晰，不得出现无来源 Logo。"
        ]
      : [
          "Must primarily show clothing/shoe/accessory material, construction, edges, straps/closures/wrinkles/textures, or other details.",
          "Must not be merely an upper-body crop, face crop, or low-information screenshot.",
          "Plain or macro background, crisp details, no unsourced logos."
        ],
    prop_cutout: zh
      ? [
          "物体必须完整入画，纯白/浅灰或透明准备背景，足够留白。",
          "比例、轮廓、带子/链条/鞋底/家具边缘等结构必须连续，不得漂浮或断裂。"
        ]
      : [
          "Object must be fully in frame on pure white/light gray or transparent-ready background with generous padding.",
          "Proportions, silhouette, straps/chains/soles/furniture edges must be continuous, not floating or broken."
        ],
    pose_reference_pack: zh
      ? [
          "姿态必须对应源视频关键动作，而不是泛化摆拍。",
          "优先输出独立姿态图；若输出 sheet，也必须无遮罩块、无 UI、无文字。"
        ]
      : [
          "Poses must map to source key actions, not generic posing.",
          "Prefer individual pose files; if a sheet is produced, it must have no mask blocks, UI, or text."
        ],
    transition_reference: zh
      ? [
          "只表达源视频转场语言，如径向模糊、同轴拉近拉远、运动拖影。",
          "不得交付黑场/白场占满画面的低信息帧。"
        ]
      : [
          "Express only the source transition language, such as radial blur, axial zoom, or motion streaks.",
          "Do not deliver low-information full black/white frames."
        ],
    character_turnaround: zh
      ? [
          "必须是同一非身份锁定人物设计的正/侧/背/四分之三视角。",
          "纯色背景，服装、发型和配饰一致。"
        ]
      : [
          "Must be one non-identity-locked character design across front/side/back/three-quarter views.",
          "Plain background with consistent outfit, hairstyle, and accessories."
        ]
  };

  return [...common, ...(rules[role] || [])];
}

function addTargetContract(target, zh) {
  return {
    ...target,
    delivery_status: VIDEO_READY_STATUS,
    acceptance: roleAcceptance(target.role, zh)
  };
}

function buildTargets(frames, language, options = {}) {
  const evidence = evidenceLine(pickFrames(frames, 5));
  const zh = language === "zh";
  const visualBrief = String(options.visualBrief || "").trim();
  const hasVisualBrief = Boolean(visualBrief);
  const hasHumanSubject = detectHumanSubject(visualBrief);
  const productSceneControlBrief = options.productSceneControlBrief || deriveProductSceneControlBrief(visualBrief, language);
  const grounding = hasVisualBrief
    ? (zh
      ? `已核验视觉事实：${visualBrief} 商品场景控制 brief：${productSceneControlBrief.summary}`
      : `Verified visual facts: ${visualBrief} Product scene control brief: ${productSceneControlBrief.summary}`)
    : (zh
      ? "视觉事实待补充：执行生图前必须由 Codex 查看关键帧/截图并填写场景几何、主体、道具、光线、机位和遮挡关系。不要只凭 frame id 直接生成。"
      : "Visual facts required: before generation, Codex must inspect keyframes/screenshots and fill scene geometry, subject, props, lighting, camera angle, and occlusion relationships. Do not generate from frame ids alone.");
  const requestMode = hasVisualBrief ? "auto" : "request_pack_only";
  const commonCleanup = zh
    ? "移除平台 UI、字幕、水印、品牌标识、镜像文字、黑场/白场转场残影和压缩噪点。"
    : "Remove platform UI, captions, watermarks, brand marks, mirrored text, black/white transition artifacts, and compression noise.";
  const stabilityNegative = zh
    ? "不要生成泛化商品图、摄影棚产品图、电商解释图、任意卧室模板、无来源的鲜花/台灯/新家具、额外人物、额外 Logo 或与证据机位不一致的构图。"
    : "Do not generate generic product photos, studio ecommerce plates, explainer graphics, arbitrary bedroom templates, unsourced flowers/lamps/new furniture, extra people, extra logos, or a composition that does not match the evidence camera.";
  const modelNegative = zh
    ? "不要美颜成广告棚拍模特，不要换脸成名人，不要改变年龄段/发型类别/服装类别/姿态逻辑，不要额外肢体、畸形手指、浮空身体、过度性感化、平台 UI、字幕、水印或品牌 Logo。"
    : "Do not turn the subject into a generic studio fashion model, do not use a celebrity face, do not change age range, hairstyle category, clothing category, or pose logic, no extra limbs, malformed fingers, floating body, over-sexualization, platform UI, captions, watermarks, or brand logos.";

  const targets = [
    {
      id: "stability-master-scene-plate-001",
      role: "clean_scene_plate",
      title: zh ? "稳定性主空镜" : "Stability master scene plate",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `基于证据帧 ${evidence} 生成“视频复刻稳定性主空镜”，用于后续视频生成锁定环境。${grounding} 保持原视频的画幅、机位高度、镜头方向、透视线、窗/墙/床/地面或街景等永久结构、自然光方向和色温。${commonCleanup} 移除人物、临时手部、平台文字、字幕和水印；如产品不是环境稳定锚点，也先移除产品。${stabilityNegative}`
        : `Generate a video-recreation stability master scene plate from evidence frames ${evidence}. ${grounding} Preserve the original aspect ratio, camera height, lens direction, perspective lines, permanent structures, natural light direction, and color temperature. ${commonCleanup} Remove people, temporary hands, platform text, captions, and watermarks; remove the product too unless it is explicitly needed as an environment anchor. ${stabilityNegative}`
    },
    {
      id: "stability-camera-plate-set-001",
      role: "camera_angle_plate_set",
      title: zh ? "机位锚点空镜组" : "Camera anchor plate set",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `基于证据帧 ${evidence} 创建同一场景的机位锚点空镜组，用来稳定视频复刻中的镜头切换。${grounding} 输出 3-4 个空镜视角：开场全景、主动作中景、近景/低角度细节区、产品或道具操作区。所有视角必须来自同一真实空间，窗帘/窗外绿色/床面纹理/墙面/家具相对位置保持连续。${commonCleanup} ${stabilityNegative}`
        : `Create a camera anchor plate set for the same scene from evidence frames ${evidence}, used to stabilize shot changes in video recreation. ${grounding} Output 3-4 empty views: opening wide, main-action medium, close/detail area, and product/prop operation zone. All views must belong to the same real space with consistent spatial relationships. ${commonCleanup} ${stabilityNegative}`
    },
    {
      id: "stability-surface-plate-001",
      role: "surface_interaction_plate",
      title: zh ? "局部承载面空镜" : "Surface interaction plate",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `生成证据帧 ${evidence} 中主要承载面/交互区域的干净空镜，用于后续放置人物手部、产品、道具或局部动作。${grounding} 保持材质纹理、褶皱方向、光照渐变、边缘透视、物体接触阴影逻辑，但不要出现人物、手、字幕、水印或无来源新道具。${stabilityNegative}`
        : `Generate a clean surface interaction plate from evidence frames ${evidence}, for later placement of hands, product, props, or close-up action. ${grounding} Preserve material texture, wrinkle direction, lighting gradient, perspective, and contact-shadow logic, with no people, hands, captions, watermarks, or unsourced new props. ${stabilityNegative}`
    },
    {
      id: "ui-free-reconstruction-001",
      role: "ui_free_scene_reconstruction",
      title: zh ? "去 UI 复刻场景" : "UI-free scene reconstruction",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `复刻证据帧 ${evidence} 的画面氛围，但交付为无平台界面、无字幕、无水印的干净画面。${grounding} 保持主体/产品原本应处的位置关系、机位、室内或街景关系、色温和构图；不要把它变成广告棚拍或新场景。${stabilityNegative}`
        : `Recreate the visual feeling of evidence frames ${evidence} without platform UI, captions, or watermarks. ${grounding} Preserve original subject/product placement relationships, camera angle, environment relationship, color temperature, and composition; do not turn it into a studio ad or new scene. ${stabilityNegative}`
    },
    ...humanSubjectTargets({ evidence, zh, grounding, hasVisualBrief, requestMode, modelNegative, enabled: hasHumanSubject }),
    {
      id: "character-turnaround-001",
      role: "character_turnaround",
      title: zh ? "人物多角度纯色背景" : "Character turnaround on plain background",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `根据证据帧 ${evidence} 中已确认的人物服装、发型类别、身形比例、姿态范围和配饰，创建非真人身份锁定的虚构人物多角度参考图。${grounding} 白色或浅灰纯色背景，同一人物设计的正面、侧面、背面、四分之三视角，服装一致，无遮挡，无文字。`
        : `From verified clothing, hairstyle category, body proportion, pose range, and accessory evidence in frames ${evidence}, create a fictionalized character turnaround. ${grounding} Plain white or light gray background, front/side/back/three-quarter views, consistent outfit, no text.`
    },
    {
      id: "wardrobe-detail-001",
      role: "wardrobe_detail",
      title: zh ? "服装材质细节" : "Wardrobe material detail",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `生成服装与配饰细节参考图，基于证据帧 ${evidence} 中确认的上装、下装、鞋履、腰带、包或其他配件。纯色背景，清晰边缘，高光分离深色材质，不要让黑色材质糊成一片，不要额外 Logo。`
        : `Generate wardrobe and accessory detail references from verified evidence in frames ${evidence}. Plain background, crisp edges, separated highlights for dark materials, no collapsed black blobs, no extra logos.`
    },
    {
      id: "prop-cutout-001",
      role: "prop_cutout",
      title: zh ? "道具/包/鞋独立图" : "Prop cutout",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `生成证据帧 ${evidence} 中重点道具、包、鞋或手持物的独立展示图。物体完整入画，纯白或浅灰背景，足够留白，比例真实，链条/带子/鞋底等结构不能漂浮或断裂。`
        : `Generate an isolated prop, bag, shoe, or handheld-object asset from frames ${evidence}. Full object in frame, pure white or light gray background, generous padding, realistic proportions, no floating or broken straps/chains/soles.`
    },
    {
      id: "pose-reference-001",
      role: "pose_reference_pack",
      title: zh ? "关键动作独立姿态图" : "Individual pose reference set",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `创建与证据帧 ${evidence} 对应的关键动作独立姿态图，纯色背景，保持同一人物设计和服装一致，分别输出行走、转身、躺卧/坐起、手部触碰产品、近景肩颈等主要姿态。每个姿态都必须是独立单图，不要拼贴成一张 sheet，不要平台 UI，不要文字，不要多余肢体。`
        : `Create individual pose reference images corresponding to evidence frames ${evidence}. Plain background, consistent character design and outfit, separately output walking, turning, lying/sitting up, hand-touching-product, and shoulder/neck close-up poses. Each pose must be its own image, not a collage sheet. No UI, no text, no extra limbs.`
    },
    {
      id: "transition-reference-001",
      role: "transition_reference",
      title: zh ? "转场视觉参考" : "Transition visual reference",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `生成干净的转场视觉参考，表达证据帧 ${evidence} 中的径向模糊、快速拉近拉远、运动拖影或同轴变焦感。不要黑场/白场占满画面，不要平台 UI，不要破坏中心构图。`
        : `Generate a clean transition reference expressing radial blur, snap zoom, motion streak, or axial push-pull from frames ${evidence}. Avoid full black/white frames, no UI, preserve centered composition.`
    }
  ];
  return targets.map((target) => addTargetContract(target, zh));
}

function detectHumanSubject(text) {
  if (!text) return false;
  return /模特|人物|女性|男性|女人|男人|女孩|男孩|真人|人像|手部|woman|man|female|male|model|person|people|subject|hand/i.test(text);
}

function humanSubjectTargets({ evidence, zh, grounding, hasVisualBrief, requestMode, modelNegative, enabled }) {
  if (!enabled) return [];
  return [
    {
      id: "clean-model-in-scene-001",
      role: "clean_model_scene_reference",
      title: zh ? "场景内干净模特照" : "Clean in-scene model reference",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `基于证据帧 ${evidence} 生成“场景内干净模特照”，用于视频复刻稳定人物位置、姿态和镜头关系。${grounding} 保留模特在原视频中的年龄段、发型类别、服装类别、躺卧/坐起/操作产品等姿态逻辑、与床面/窗户/产品的空间关系、自然光方向和画幅比例。移除平台 UI、中文字幕、水印、未经授权产品 Logo 和压缩噪点；不要移除模特。背景必须仍是证据场景，不要换成摄影棚或新卧室。${modelNegative}`
        : `Generate a clean in-scene model reference from evidence frames ${evidence}, used to stabilize person placement, pose, and camera relationship for video recreation. ${grounding} Preserve age range, hairstyle category, clothing category, lying/sitting/product-interaction pose logic, spatial relationship to the scene, natural light direction, and aspect ratio. Remove UI, captions, watermarks, unauthorized product logos, and compression noise; do not remove the model. Keep the evidence scene, not a studio or new room. ${modelNegative}`
    },
    {
      id: "clean-model-plain-background-001",
      role: "clean_model_plain_background",
      title: zh ? "纯色背景干净模特照" : "Clean model on plain background",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `基于证据帧 ${evidence} 生成“纯色背景干净模特照”，用于后续替换、组合或视频人物参考。${grounding} 模特保持源视频已确认的年龄段、发型类别、服装类别、身形比例和核心姿态气质，但作为非身份锁定的普通商业模特参考；背景为纯白或浅灰，无家具、无床、无产品、无字幕、无水印。输出完整身体或半身取决于源帧证据，不要裁掉关键手臂、肩颈或头发。${modelNegative}`
        : `Generate a clean model reference on a plain background from evidence frames ${evidence}, for later replacement, compositing, or video person reference. ${grounding} Preserve confirmed age range, hairstyle category, clothing category, body proportion, and core pose feeling, but treat it as a non-identity-locked ordinary commercial model reference. Plain white or light gray background, no furniture, bed, product, captions, or watermarks. Full-body or half-body should follow source evidence; do not crop key arms, shoulders, neck, or hair. ${modelNegative}`
    },
    {
      id: "clean-model-pose-pack-001",
      role: "clean_model_pose_pack",
      title: zh ? "干净模特姿态组" : "Clean model pose pack",
      source_evidence: evidence,
      ready_for_generation: hasVisualBrief,
      provider_mode: requestMode,
      prompt: zh
        ? `基于证据帧 ${evidence} 生成 3-5 张“干净模特姿态组”，覆盖原视频中的主要人物动作节点：躺卧休息、侧卧/转头、手部触碰产品、坐起或整理产品、近景面部/肩颈。${grounding} 每张都保持同一非身份锁定模特设计、同一服装类别和自然日光；背景可用源场景干净版或纯浅色背景，但不能混入平台 UI、字幕、水印或无来源新道具。${modelNegative}`
        : `Generate a 3-5 image clean model pose pack from evidence frames ${evidence}, covering the main person-action beats: lying/resting, side pose or head turn, hand touching product, sitting up or arranging product, and face/shoulder close-up. ${grounding} Keep the same non-identity-locked model design, clothing category, and natural light across images. Background can be clean source scene or plain light background, with no UI, captions, watermarks, or unsourced new props. ${modelNegative}`
    }
  ];
}

function promptPack(plan) {
  const lines = [
    `# ${plan.title}`,
    "",
    `- Run id: \`${plan.run_id}\``,
    `- Source run: ${plan.source_run ? `\`${plan.source_run}\`` : "not set"}`,
    `- Frame count: ${plan.frames.length}`,
    "",
    "## Source Evidence",
    ""
  ];

  for (const frame of pickFrames(plan.frames, 12)) {
    lines.push(`- ${frame.id}${frame.timestamp !== null ? ` @ ${frame.timestamp}s` : ""}${frame.relative_path ? `: \`${frame.relative_path}\`` : ""}`);
  }

  if (plan.product_scene_control_brief) {
    const brief = plan.product_scene_control_brief;
    lines.push("", "## Product Scene Control Brief", "");
    lines.push(`- Status: \`${brief.status}\``);
    lines.push(`- Product role: ${brief.product_role.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- Action dependencies: ${brief.action_dependencies.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- Scene dependencies: ${brief.scene_dependencies.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- Interaction surfaces: ${brief.interaction_surfaces.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- Material/detail claims: ${brief.material_detail_claims.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- Required asset roles: ${brief.required_asset_roles.map((item) => `\`${item}\``).join(", ")}`);
    lines.push("");
    lines.push("Do not generate:");
    for (const item of brief.do_not_generate) lines.push(`- ${item}`);
  }

  lines.push("", "## Prompt Targets", "");
  for (const target of plan.targets) {
    lines.push(`### ${target.id} - ${target.title}`, "");
    lines.push(`- Role: \`${target.role}\``);
    lines.push(`- Ready for generation: ${target.ready_for_generation ? "yes" : "no - visual evidence brief required"}`);
    lines.push(`- Source evidence: ${target.source_evidence}`);
    lines.push("");
    lines.push("```text");
    lines.push(target.prompt);
    lines.push("```");
    lines.push("");
    lines.push("QA:");
    lines.push("- Verify the asset matches visually inspected frame evidence.");
    lines.push("- Verify cleanup removed UI, captions, watermarks, black/white artifacts, and unauthorized brands.");
    lines.push("- Verify no new identity, prop, limb, geometry, or aspect-ratio drift was introduced.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(String(args["run-dir"] || process.cwd()));
  const sourceRun = args["source-run"] ? path.resolve(String(args["source-run"])) : null;
  const language = String(args.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
  const visualBriefPath = args["visual-brief"] ? path.resolve(String(args["visual-brief"])) : null;

  await Promise.all(["planning", "output", "qa"].map((dir) => mkdir(path.join(runDir, dir), { recursive: true })));

  const frameIndexPath = sourceRun ? path.join(sourceRun, "metadata", "frame-index.json") : null;
  const frameQualityPath = sourceRun ? path.join(sourceRun, "metadata", "frame-quality.json") : null;
  const reportPath = sourceRun ? path.join(sourceRun, "output", "recreate-report.md") : null;
  const frameIndex = await readJsonIfExists(frameIndexPath);
  const frameQuality = await readJsonIfExists(frameQualityPath);
  const report = await readTextIfExists(reportPath);
  const visualBrief = visualBriefPath
    ? await readTextIfExists(visualBriefPath)
    : String(args["visual-summary"] || "");
  const frames = frameIndex ? normalizeFrameIndex(frameIndex, sourceRun) : [];
  const productSceneControlBrief = deriveProductSceneControlBrief(visualBrief, language);

  const plan = {
    schema: "video-frame-image-asset-generator/asset-generation-plan/v1",
    title: language === "zh" ? "视频抽帧复刻图片资产计划" : "Video frame recreation image asset plan",
    run_id: path.basename(runDir),
    created_at: new Date().toISOString(),
    source_run: sourceRun,
    source_files: {
      frame_index: frameIndexPath && existsSync(frameIndexPath) ? frameIndexPath : null,
      frame_quality: frameQualityPath && existsSync(frameQualityPath) ? frameQualityPath : null,
      recreate_report: reportPath && existsSync(reportPath) ? reportPath : null
    },
    frames,
    frame_quality_summary: frameQuality?.summary || frameQuality?.stats || null,
    report_excerpt: report ? report.slice(0, 4000) : "",
    visual_evidence_brief: visualBrief || null,
    product_scene_control_brief: productSceneControlBrief,
    generation_readiness: visualBrief ? "ready_after_prompt_review" : "draft_requires_visual_evidence_brief",
    targets: buildTargets(frames, language, { visualBrief, productSceneControlBrief }),
    execution_notes: [
      "Codex must visually inspect source frames before treating prompt details as final.",
      "Default strategy is video recreation stability: scene plates and camera anchors come before character, prop, or product shots.",
      "If visual_evidence_brief is missing, do not send request-pack prompts to an image provider; fill the visual facts first.",
      "Use native_codex for reference-aware generation or image edits.",
      "Use third_party_api only for self-contained text-to-image prompts unless provider image input is verified."
    ]
  };

  const assetManifest = {
    schema: "video-frame-image-asset-generator/asset-manifest/v1",
    run_id: plan.run_id,
    created_at: plan.created_at,
    source_run: sourceRun,
    generated_assets: [],
    product_scene_control_brief: productSceneControlBrief,
    prompt_targets: plan.targets.map((target) => ({
      id: target.id,
      role: target.role,
      title: target.title,
      status: "planned",
      delivery_status: target.delivery_status,
      allowed_final_statuses: [
        "ready_for_video_model",
        "reference_only",
        "fallback_review_required",
        "retry_required",
        "failed_role"
      ],
      output_path: null,
      provider: null,
      qa_status: "pending",
      ready_for_generation: target.ready_for_generation,
      acceptance: target.acceptance
    }))
  };

  const requestPack = plan.targets
    .map((target) => JSON.stringify({
      id: target.id,
      role: target.role,
      prompt: target.prompt,
      size: args.size || "1024x1536",
      quality: args.quality || "auto",
      provider_mode: target.provider_mode || "auto",
      ready_for_generation: target.ready_for_generation,
      requires_visual_evidence_brief: !target.ready_for_generation,
      product_scene_control_brief: productSceneControlBrief,
      delivery_status: target.delivery_status,
      acceptance: target.acceptance
    }))
    .join("\n");

  await writeFile(path.join(runDir, "planning", "asset-generation-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(runDir, "output", "prompt-pack.md"), promptPack(plan));
  await writeFile(path.join(runDir, "output", "request-pack.jsonl"), `${requestPack}\n`);
  await writeFile(path.join(runDir, "output", "asset-manifest.json"), `${JSON.stringify(assetManifest, null, 2)}\n`);
  await writeFile(
    path.join(runDir, "qa", "asset-qa-checklist.json"),
    `${JSON.stringify({
      schema: "video-frame-image-asset-generator/asset-qa-checklist/v1",
      run_id: plan.run_id,
      final_statuses: {
        ready_for_video_model: "Generated or edited asset passed role-specific visual QA and can be used as a video-model reference.",
        reference_only: "Useful evidence or operator reference, but not strong enough to control video generation.",
        fallback_review_required: "Local crop, mask, reused asset, or provider-blocked substitute; must not be treated as final video-model input without review.",
        retry_required: "Prompt target is valid but generation failed or result needs rerun.",
        failed_role: "Image content does not match its declared role."
      },
      checks: [
        { id: "source_evidence_visually_inspected", status: "pending" },
        { id: "visual_evidence_brief_filled_before_provider_generation", status: visualBrief ? "passed" : "blocked" },
        { id: "scene_stability_plates_generated_before_character_product_assets", status: "pending" },
        { id: "ui_captions_watermarks_removed_unless_requested", status: "pending" },
        { id: "identity_policy_respected", status: "pending" },
        { id: "plain_background_must_be_plain", applies_to: ["clean_model_plain_background"], status: "pending" },
        { id: "pose_pack_individual_files_required", applies_to: ["clean_model_pose_pack", "pose_reference_pack"], status: "pending" },
        { id: "wardrobe_detail_must_show_material_not_face_crop", applies_to: ["wardrobe_detail"], status: "pending" },
        { id: "scene_plate_source_geometry_score", applies_to: ["clean_scene_plate", "camera_angle_plate_set"], status: "pending" },
        { id: "fallback_cannot_be_final_pass", status: "pending" },
        { id: "black_white_transition_artifacts_avoided", status: "pending" },
        { id: "final_files_copied_into_run_local_final_assets", status: "pending" }
      ],
      role_acceptance: Object.fromEntries(plan.targets.map((target) => [target.id, target.acceptance]))
    }, null, 2)}\n`
  );

  await writeFile(
    path.join(runDir, "output", "README.md"),
    [
      "# Video Frame Image Assets",
      "",
      `- Run id: \`${plan.run_id}\``,
      sourceRun ? `- Source run: \`${sourceRun}\`` : "- Source run: not set",
      `- Planned targets: ${plan.targets.length}`,
      `- Generation readiness: \`${plan.generation_readiness}\``,
      `- Product scene control status: \`${productSceneControlBrief.status}\``,
      "",
      "Direct files:",
      "",
      "- `output/asset-manifest.json`",
      "- `output/prompt-pack.md`",
      "- `output/request-pack.jsonl`",
      "- `planning/asset-generation-plan.json`",
      "- `qa/asset-qa-checklist.json`",
      "",
      "Delivery status contract:",
      "",
      "- `ready_for_video_model`: passed role-specific visual QA.",
      "- `reference_only`: useful for human/operator reference but not a strong video-model control image.",
      "- `fallback_review_required`: local crop, mask, reused image, or provider-blocked substitute; review before use.",
      "- `retry_required`: prompt is valid but generation failed or should be rerun.",
      "- `failed_role`: image content does not match the declared role.",
      ""
    ].join("\n")
  );

  console.log(JSON.stringify({
    runDir,
    sourceRun,
    frames: frames.length,
    targets: plan.targets.length,
    promptPack: path.join(runDir, "output", "prompt-pack.md"),
    requestPack: path.join(runDir, "output", "request-pack.jsonl")
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
