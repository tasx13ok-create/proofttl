const CINEMATICS_SCHEMA = "proofttl-cinematic-v3";
const DEFAULT_PLANNER_MODEL = "@cf/zai-org/glm-4.7-flash";
const STORYBOARD_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const VIDEO_MODEL_TEXT = "minimax/hailuo-2.3";
const VIDEO_MODEL_IMAGE = "minimax/hailuo-2.3-fast";
const MAX_PROMPT_CHARS = 1800;
const MAX_SHOTS = 6;

export function cinematicsCapability(env) {
  return {
    service: "ProofTTL Cinematics",
    schema: CINEMATICS_SCHEMA,
    ai_binding: Boolean(env?.AI),
    planner_model: env?.PROOFTTL_CINEMATICS_PLANNER_MODEL || env?.PROOFTTL_RESPONSE_MODEL || DEFAULT_PLANNER_MODEL,
    storyboard_model: STORYBOARD_MODEL,
    video_models: {
      text_to_video: VIDEO_MODEL_TEXT,
      image_to_video: VIDEO_MODEL_IMAGE,
    },
    render_requires_authentication: true,
    render_requires_explicit_cost_confirmation: true,
    local_previs: true,
  };
}

export async function handleCinematics(request, env, pathname, entitlement = null) {
  if (request.method === "GET" && pathname === "/cinematics/status") {
    return json(cinematicsCapability(env));
  }
  if (request.method === "POST" && pathname === "/cinematics/plan") {
    return handlePlan(request, env);
  }
  if (request.method === "POST" && pathname === "/cinematics/storyboard") {
    return handleStoryboard(request, env);
  }
  if (request.method === "POST" && pathname === "/cinematics/render") {
    return handleRender(request, env, entitlement);
  }
  return json({ error: "cinematics_route_not_found" }, 404);
}

async function handlePlan(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  const prompt = normalizePrompt(body.prompt);
  if (!prompt) return json({ error: "prompt_required" }, 400);
  const shotCount = clampInt(body.shot_count ?? 4, 1, MAX_SHOTS);
  const duration = clampInt(body.duration_seconds ?? shotCount * 5, shotCount * 3, shotCount * 10);
  const aspectRatio = normalizeAspect(body.aspect_ratio);
  const style = normalizeString(body.style, "stylized grounded martial-arts cinema").slice(0, 180);
  const seed = clampInt(body.seed ?? Math.floor(Math.random() * 2147483647), 0, 4294967295);

  const fallback = deterministicPlan({ prompt, shotCount, duration, aspectRatio, style, seed });
  if (!env?.AI || typeof env.AI.run !== "function") {
    return json({ ...fallback, planning: { mode: "deterministic_fallback", reason: "ai_binding_unavailable" } });
  }

  const model = env.PROOFTTL_CINEMATICS_PLANNER_MODEL || env.PROOFTTL_RESPONSE_MODEL || DEFAULT_PLANNER_MODEL;
  try {
    const response = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: plannerSystemPrompt(shotCount, duration, aspectRatio, style),
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.35,
      max_tokens: 2600,
    });
    const parsed = parseJsonResult(response);
    const normalized = normalizeAiPlan(parsed, fallback);
    return json({ ...normalized, planning: { mode: "ai", model } });
  } catch (error) {
    return json({
      ...fallback,
      planning: {
        mode: "deterministic_fallback",
        reason: "planner_failed",
        detail: safeError(error),
      },
    });
  }
}

async function handleStoryboard(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  const prompt = normalizePrompt(body.prompt);
  if (!prompt) return json({ error: "prompt_required" }, 400);
  if (!env?.AI || typeof env.AI.run !== "function") return json({ error: "ai_unavailable" }, 503);
  const seed = clampInt(body.seed ?? Math.floor(Math.random() * 2147483647), 0, 4294967295);
  const width = clampInt(body.width ?? 1024, 512, 1536);
  const height = clampInt(body.height ?? 576, 512, 1536);
  const imagePrompt = `${prompt}\n\nSingle cinematic keyframe. Original graphic martial-arts film language, grounded anatomy, believable contact and body mechanics, dramatic composition, painterly toon lighting, controlled color palette, no text, no watermark, no collage.`.slice(0, 3000);

  try {
    const response = await env.AI.run(STORYBOARD_MODEL, {
      prompt: imagePrompt,
      seed,
      width,
      height,
      num_steps: 4,
    });
    const image = extractBase64Image(response);
    if (!image) return json({ error: "storyboard_image_missing" }, 502);
    return json({
      schema: CINEMATICS_SCHEMA,
      model: STORYBOARD_MODEL,
      seed,
      prompt: imagePrompt,
      image_data_url: `data:image/jpeg;base64,${image}`,
    });
  } catch (error) {
    return json({ error: "storyboard_generation_failed", detail: safeError(error) }, 502);
  }
}

async function handleRender(request, env, entitlement) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  if (!entitlement?.authenticated) {
    return json({
      error: "authentication_required",
      message: "AI video rendering is protected because it can incur provider cost. Sign in before rendering final shots.",
    }, 401);
  }
  if (body.confirm_cost !== true) {
    return json({
      error: "explicit_cost_confirmation_required",
      message: "Set confirm_cost=true only after the user explicitly starts a paid AI render.",
    }, 409);
  }
  if (!env?.AI || typeof env.AI.run !== "function") return json({ error: "ai_unavailable" }, 503);

  const prompt = normalizePrompt(body.prompt);
  if (!prompt) return json({ error: "prompt_required" }, 400);
  const firstFrame = typeof body.first_frame_image === "string" && body.first_frame_image.length < 9_000_000
    ? body.first_frame_image
    : "";
  const resolution = body.resolution === "1080P" ? "1080P" : "768P";
  const duration = normalizeVideoDuration(body.duration_seconds);
  const model = firstFrame ? VIDEO_MODEL_IMAGE : VIDEO_MODEL_TEXT;
  const input = {
    prompt: prompt.slice(0, 1900),
    duration,
    resolution,
    prompt_optimizer: true,
    fast_pretreatment: Boolean(body.fast_pretreatment),
    ...(firstFrame ? { first_frame_image: firstFrame } : {}),
  };

  try {
    const response = await env.AI.run(model, input);
    const video = extractVideoUrl(response);
    if (!video) {
      return json({
        error: "video_missing_from_provider_response",
        model,
        provider_state: response?.state || response?.result?.status || null,
      }, 502);
    }
    return json({
      schema: CINEMATICS_SCHEMA,
      model,
      video_url: video,
      task_id: response?.result?.task_id || response?.task_id || null,
      provider_state: response?.state || response?.result?.status || "Completed",
      resolution,
      duration_seconds: duration,
    });
  } catch (error) {
    return json({ error: "video_generation_failed", model, detail: safeError(error) }, 502);
  }
}

function plannerSystemPrompt(shotCount, duration, aspectRatio, style) {
  return `You are ProofTTL Cinematics Director. Convert the user's idea into a coherent film scene, not disconnected clips. Return ONLY valid JSON with this exact top-level shape:
{
  "title": string,
  "logline": string,
  "environment": string,
  "time_of_day": string,
  "palette": string,
  "character_bible": string,
  "continuity_bible": string,
  "shots": [
    {
      "id": string,
      "name": string,
      "duration_seconds": number,
      "camera": string,
      "action": string,
      "contact": string,
      "continuity_in": string,
      "continuity_out": string,
      "render_prompt": string,
      "storyboard_prompt": string
    }
  ]
}
Create exactly ${shotCount} shots totaling about ${duration} seconds. Aspect ratio ${aspectRatio}. Visual direction: ${style}.
Rules:
- Treat it as one continuous scene with persistent people, wardrobe, geography, damage, props, lighting, and screen direction.
- Every combat action must describe who initiates, exact physical contact, defender reaction, and where bodies end the beat.
- Never write "they fight". Specify readable actions and contact.
- Avoid impossible simultaneous crowd attacks; stage attackers in turns and keep others active in the background.
- Make camera cuts motivated by action. No constant zooming.
- Character bible must be concrete enough to repeat verbatim in every render prompt.
- Each render_prompt must stand alone and include character continuity, environment continuity, exact motion, contact, camera, lighting, and the desired final body positions.
- Do not mention copyrighted characters, game titles, studios, or proprietary visual assets. Describe an original graphic martial-arts film aesthetic instead.`;
}

function deterministicPlan({ prompt, shotCount, duration, aspectRatio, style, seed }) {
  const perShot = Math.max(3, Math.min(10, Math.round(duration / shotCount)));
  const environment = inferEnvironment(prompt);
  const characterBible = "Hero: lean adult martial artist in a dark crimson jacket, black trousers, short dark hair. Attackers: adult men in muted navy, charcoal, and brown street clothes. Human proportions, grounded anatomy, readable silhouettes.";
  const continuityBible = `One continuous ${environment} scene. Keep wardrobe, faces, prop placement, lighting direction, injuries, and screen direction consistent between shots. Original ${style}.`;
  const beats = splitPromptIntoBeats(prompt, shotCount);
  const cameras = ["24mm stable wide", "40mm shoulder-height tracking", "55mm side medium", "35mm low three-quarter", "70mm impact close medium", "28mm overhead-wide finish"];
  const shots = Array.from({ length: shotCount }, (_, index) => {
    const action = beats[index] || beats[beats.length - 1] || prompt;
    const before = index === 0 ? "Scene begins with all actors established and separated." : `Continue directly from shot ${index}; preserve exact body positions and prop state.`;
    const after = index === shotCount - 1 ? "End on a readable held composition that resolves the scene." : "End with stable body positions that the next shot can continue from.";
    const camera = cameras[index % cameras.length];
    const common = `${characterBible} ${continuityBible} Shot ${index + 1}/${shotCount}. Camera: ${camera}. Action: ${action}. Physical motion must show believable weight transfer, actual contact where described, immediate human reaction, foot planting, and follow-through. ${before} ${after}`;
    return {
      id: `shot-${String(index + 1).padStart(2, "0")}`,
      name: index === 0 ? "Establish" : index === shotCount - 1 ? "Finish" : `Beat ${index + 1}`,
      duration_seconds: perShot,
      camera,
      action,
      contact: inferContact(action),
      continuity_in: before,
      continuity_out: after,
      render_prompt: common,
      storyboard_prompt: `${common} Freeze the strongest readable instant of this beat as a single cinematic keyframe.`,
    };
  });
  return {
    schema: CINEMATICS_SCHEMA,
    seed,
    prompt,
    title: "Untitled Cinematic",
    logline: prompt.slice(0, 240),
    environment,
    time_of_day: inferTimeOfDay(prompt),
    palette: "deep charcoal, muted blue, controlled amber practical light, restrained crimson hero accent",
    aspect_ratio: aspectRatio,
    style,
    character_bible: characterBible,
    continuity_bible: continuityBible,
    shots,
  };
}

function normalizeAiPlan(raw, fallback) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.shots) || raw.shots.length === 0) return fallback;
  const shots = raw.shots.slice(0, MAX_SHOTS).map((shot, index) => {
    const base = fallback.shots[Math.min(index, fallback.shots.length - 1)];
    return {
      id: normalizeString(shot?.id, base.id).slice(0, 64),
      name: normalizeString(shot?.name, base.name).slice(0, 90),
      duration_seconds: clampInt(shot?.duration_seconds ?? base.duration_seconds, 2, 10),
      camera: normalizeString(shot?.camera, base.camera).slice(0, 220),
      action: normalizeString(shot?.action, base.action).slice(0, 700),
      contact: normalizeString(shot?.contact, base.contact).slice(0, 500),
      continuity_in: normalizeString(shot?.continuity_in, base.continuity_in).slice(0, 600),
      continuity_out: normalizeString(shot?.continuity_out, base.continuity_out).slice(0, 600),
      render_prompt: normalizeString(shot?.render_prompt, base.render_prompt).slice(0, 1900),
      storyboard_prompt: normalizeString(shot?.storyboard_prompt, base.storyboard_prompt).slice(0, 1900),
    };
  });
  return {
    ...fallback,
    title: normalizeString(raw.title, fallback.title).slice(0, 120),
    logline: normalizeString(raw.logline, fallback.logline).slice(0, 500),
    environment: normalizeString(raw.environment, fallback.environment).slice(0, 120),
    time_of_day: normalizeString(raw.time_of_day, fallback.time_of_day).slice(0, 80),
    palette: normalizeString(raw.palette, fallback.palette).slice(0, 300),
    character_bible: normalizeString(raw.character_bible, fallback.character_bible).slice(0, 1000),
    continuity_bible: normalizeString(raw.continuity_bible, fallback.continuity_bible).slice(0, 1000),
    shots,
  };
}

function parseJsonResult(response) {
  if (!response) return null;
  const candidates = [
    response.response,
    response.output_text,
    response.result?.response,
    response.result?.output_text,
    response.choices?.[0]?.message?.content,
    response.result?.choices?.[0]?.message?.content,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate;
    if (typeof candidate !== "string") continue;
    try { return JSON.parse(candidate); } catch {}
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
  }
  return null;
}

function extractBase64Image(response) {
  const candidates = [response?.image, response?.result?.image, response?.result, response?.response];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 100) return candidate.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  }
  return null;
}

function extractVideoUrl(response) {
  const candidates = [response?.result?.video, response?.video, response?.result?.url, response?.url];
  return candidates.find((value) => typeof value === "string" && /^https:\/\//i.test(value)) || null;
}

function splitPromptIntoBeats(prompt, count) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const segments = cleaned
    .split(/(?:\.|;|,\s+then\s+|\s+then\s+|\s+before\s+|\s+while\s+)/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 12);
  if (segments.length >= count) return segments.slice(0, count);
  const result = [];
  for (let i = 0; i < count; i += 1) result.push(segments[i % Math.max(segments.length, 1)] || cleaned);
  return result;
}

function inferContact(action) {
  const lower = action.toLowerCase();
  if (/throw|slam|table|wall/.test(lower)) return "Show clear grip/contact, body momentum transfer, then visible impact against the named surface with a physical reaction.";
  if (/kick|punch|strike|elbow|knee|hit/.test(lower)) return "Show the striking limb visibly reach the target at the active frame, compress the target's posture, then recoil and follow through.";
  if (/block|parry/.test(lower)) return "Show attacker limb meeting the defender's forearm/hand at a readable contact point, redirected away from the defender's centerline.";
  if (/dodge|slip|duck|miss/.test(lower)) return "Show the attack pass visibly through the space the defender just vacated, with believable evasive footwork.";
  return "Preserve believable spacing and physical cause-and-effect between performers.";
}

function inferEnvironment(prompt) {
  const lower = prompt.toLowerCase();
  const options = ["restaurant kitchen", "warehouse", "dojo", "alley", "rooftop", "nightclub", "apartment", "hallway", "courtyard"];
  return options.find((value) => lower.includes(value)) || "cinematic interior";
}

function inferTimeOfDay(prompt) {
  const lower = prompt.toLowerCase();
  if (/night|neon|midnight/.test(lower)) return "night";
  if (/sunset|golden hour|dusk/.test(lower)) return "dusk";
  if (/dawn|sunrise/.test(lower)) return "dawn";
  return "interior practical lighting";
}

function normalizeVideoDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 6;
  return n <= 6 ? 6 : 10;
}

function normalizeAspect(value) {
  const allowed = new Set(["16:9", "9:16", "1:1", "4:3", "21:9"]);
  return allowed.has(value) ? value : "16:9";
}

function normalizePrompt(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_CHARS);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : fallback;
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 240);
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
