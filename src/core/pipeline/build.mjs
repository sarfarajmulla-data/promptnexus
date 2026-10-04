/**
 * Construction stage — turns the populated context into the final prompt.
 *
 * Two shapes exist:
 *  - linguistic prompts (the 15-section architecture, adapted per archetype)
 *  - media prompts (a dense descriptive block plus explicit exclusions), which
 *    image and video models actually condition on
 */

import { buildSections, recipeIdFor } from '../templates/templates.mjs';
import { renderPrompt, renderMediaPrompt } from './render.mjs';
import { normalizeInput, stripMetaFrame, listOut, unique, titleCase } from '../util/text.mjs';

/* ───────────────────────── media prompts ───────────────────────── */

const STYLE_CUES = [
  [/\b(photorealistic|photo[- ]?real|photograph|dlsr|dslr|realistic)\b/i, 'photorealistic'],
  [/\b(cinematic|film still|movie|anamorphic)\b/i, 'cinematic film still'],
  [/\b(anime|manga|ghibli|studio ghibli)\b/i, 'anime illustration'],
  [/\b(watercolou?r|gouache)\b/i, 'watercolour'],
  [/\b(oil painting|painting|painted)\b/i, 'oil painting'],
  [/\b(3d render|blender|octane|unreal)\b/i, '3D render'],
  [/\b(vector|flat design|minimal|minimalist)\b/i, 'flat vector minimal'],
  [/\b(pixel art|8[- ]bit|16[- ]bit)\b/i, 'pixel art'],
  [/\b(comic|graphic novel|ink drawing|line art)\b/i, 'inked line art'],
  [/\b(isometric)\b/i, 'isometric'],
];

const LIGHT_CUES = [
  [/\b(golden hour|sunset|dusk)\b/i, 'golden-hour sunlight'],
  [/\b(blue hour|twilight)\b/i, 'blue-hour ambient light'],
  [/\b(overcast|cloudy|soft light)\b/i, 'soft overcast light'],
  [/\b(studio light|softbox|rim light)\b/i, 'controlled studio lighting'],
  [/\b(neon|cyberpunk|night city)\b/i, 'neon-lit night lighting'],
  [/\b(harsh (?:sun|light)|midday)\b/i, 'harsh midday sun'],
  [/\b(candle|candlelight|firelight|warm glow)\b/i, 'warm candlelight'],
  [/\b(backlit|backlight|silhouette)\b/i, 'strong backlight'],
  [/\b(moody|dramatic|chiaroscuro|low[- ]key)\b/i, 'dramatic low-key lighting'],
  [/\b(natural light|window light)\b/i, 'natural window light'],
];

const CAMERA_CUES = [
  [/\b(close[- ]?up|macro)\b/i, 'tight close-up, shallow depth of field'],
  [/\b(portrait)\b/i, 'medium close-up, 85mm lens, shallow depth of field'],
  [/\b(wide|landscape|panorama|establishing)\b/i, 'wide establishing shot, 24mm lens'],
  [/\b(aerial|drone|top[- ]down|bird'?s eye)\b/i, 'aerial top-down view'],
  [/\b(low angle|worm'?s eye)\b/i, 'low-angle shot'],
  [/\b(high angle)\b/i, 'high-angle shot'],
  [/\b(dutch angle|tilted)\b/i, 'slight dutch tilt'],
  [/\b(bokeh)\b/i, 'bokeh background, shallow depth of field'],
  [/\b(long exposure|motion blur)\b/i, 'long exposure motion blur'],
];

const COLOUR_CUES = [
  [/\b(monochrome|black and white|bnw|greyscale|grayscale)\b/i, 'monochrome palette'],
  [/\b(pastel|soft palette|muted)\b/i, 'muted pastel palette'],
  [/\b(vibrant|saturated|bold colou?rs?)\b/i, 'rich saturated palette'],
  [/\b(pastel)\b/i, 'pastel palette'],
  [/\b(warm tones?|earthy)\b/i, 'warm earthy palette'],
  [/\b(cool tones?|blues?|teal)\b/i, 'cool blue-teal palette'],
];

const ASPECT_CUES = [
  [/\b1:1\b|\bsquare\b/i, '1:1'],
  [/\b16:9\b|\bwidescreen\b|\bbanner\b/i, '16:9'],
  [/\b9:16\b|\bvertical\b|\bstor(?:y|ies)\b|\breels?\b|\bshorts?\b|\btiktok\b/i, '9:16'],
  [/\b4:3\b/i, '4:3'],
  [/\b3:2\b|\blandscape\b/i, '3:2'],
  [/\b2:3\b|\bportrait\b/i, '2:3'],
  [/\b21:9\b|\bultrawide\b/i, '21:9'],
  [/\bposter\b/i, '2:3'],
  [/\bthumbnail\b|\byoutube\b/i, '16:9'],
];

const BASE_NEGATIVES = [
  'blurry or out-of-focus subject', 'distorted anatomy or extra limbs', 'watermarks or signatures',
  'garbled text artefacts', 'oversaturated colour cast', 'heavy compression artefacts', 'cluttered composition',
];

function pickCues(text, bank) {
  const out = [];
  for (const [re, val] of bank) if (re.test(text) && !out.includes(val)) out.push(val);
  return out;
}

/**
 * Extract the descriptive core of a media request, stripping the request frame.
 * Anchored replacements only — a greedy pattern here silently eats the subject.
 */
function mediaSubject(text) {
  let s = stripMetaFrame(text);

  const frames = [
    /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:i\s+(?:want|need|would like)\s+)?(?:generate|create|make|compose|design|draw|render|produce|write|give me)\s+(?:me\s+)?(?:an?\s+)?(?:new\s+)?(?:image|picture|photo|photograph|video|clip|animation|illustration|artwork|logo|poster|render|prompt)\s+(?:of|showing|with|depicting|for)\s+/i,
    /^(?:an?\s+)?(?:image|picture|photo|photograph|video|clip|animation|illustration|artwork)\s+(?:of|showing|with|depicting)\s+/i,
    /^(?:i\s+(?:want|need|would like)\s+)(?:an?\s+)?(?:image|picture|photo|video|clip)\s+(?:of|showing)\s+/i,
    /^(?:prompt|image prompt|video prompt)\s*(?:for|:)\s*/i,
  ];
  for (const f of frames) s = s.replace(f, '');

  // Trailing purpose clauses describe usage, not the picture.
  s = s.replace(/[,\s]+(?:for|to use (?:it )?(?:on|for|in)|to post on)\s+(?:my|the|our|a)\s+[\w\s]{2,28}$/i, '');
  s = s.replace(/\b(?:aspect ratio|negative prompt|negative|parameters?)\s*[:\-]\s*[^,\n]*/gi, '');

  const stop = s.split(/\s+(?:so that|because|which will|in order to)\b/i)[0];
  s = stop || s;
  return s.replace(/^[,\s]+|[,\s]+$/g, '').replace(/[.]$/, '').trim();
}

export function buildMediaPrompt(spec, ctx) {
  const raw = normalizeInput(spec.media?.raw || spec.objective);
  const kind = spec.media?.kind || 'image';
  const subject = mediaSubject(raw);
  const style = pickCues(raw, STYLE_CUES);
  const light = pickCues(raw, LIGHT_CUES);
  const camera = pickCues(raw, CAMERA_CUES);
  const colour = pickCues(raw, COLOUR_CUES);
  const aspect = (pickCues(raw, ASPECT_CUES)[0]) || (kind === 'video' ? '16:9' : '3:2');

  const assumed = [];
  if (!style.length) { style.push(kind === 'video' ? 'cinematic film still' : 'photorealistic'); assumed.push(`medium → ${style[0]}`); }
  if (!light.length) { light.push('natural window light'); assumed.push('lighting → natural window light'); }
  if (!camera.length) { camera.push(kind === 'video' ? 'medium shot, 35mm lens' : 'medium shot, 50mm lens, natural perspective'); assumed.push('framing → medium shot, 50mm'); }
  if (!colour.length) { colour.push('balanced natural palette'); assumed.push('palette → balanced natural'); }

  const notes = [
    `Swaps: replace "${style[0]}" if you want a different medium; the rest of the stack still applies.`,
    `If the result feels flat, strengthen the lighting clause first — it changes more than any other part.`,
    `Regenerate at the same seed once you like the framing, so only your edits vary.`,
  ];

  let prompt;
  let parameters = [];
  const negatives = unique([...BASE_NEGATIVES, ...(spec.forbidden || []).map((f) => f.toLowerCase())]).slice(0, 10);

  if (kind === 'video') {
    const motion = /\b(walk|run|drive|fly|pan|zoom|orbit|spin|fall|rise|turn|open|close|pour|explode)\w*/i.test(raw)
      ? 'subject motion exactly as described above, continuous and uninterrupted'
      : 'one continuous, natural movement — no cuts';
    const shots = [
      `Shot 1 (${aspect === '9:16' ? '9:16 vertical' : aspect}) — ${subject}`,
      `Framing: ${camera[0]}`,
      `Camera: ${/\b(pan|track|dolly|zoom|orbit|handheld|static|locked)\b/i.test(raw) ? 'as described above' : 'slow push-in, otherwise locked-off and stable'}`,
      `Motion: ${motion}`,
      `Light: ${light[0]}`,
      `Look: ${style[0]}, ${colour[0]}`,
      `Duration: ${/\b\d+\s*(?:s|sec|seconds)\b/i.test(raw) ? 'as specified' : '5 seconds'}`,
    ];
    prompt = shots.join('\n');
    parameters = [`Aspect ratio: ${aspect}`, 'Frame rate: 24fps (cinematic) unless the target model has a fixed frame rate'];
    notes.unshift('Keep each generation to a single shot and a single continuous action; stitch shots in an editor rather than asking for cuts.');
  } else {
    const subjectClause = subject || '[describe the main subject and what it is doing]';
    prompt = [
      subjectClause,
      `framed as ${camera[0]}`,
      `lit by ${light[0]}`,
      `${style[0]} style`,
      colour[0],
      'high detail, clean composition, natural proportions',
    ].join(', ');
    if (spec.media?.editing) {
      notes.unshift('State exactly what must stay identical (pose, identity, framing) — that is what keeps an edit believable.');
    }
    parameters = [`Aspect ratio: ${aspect}`];
  }

  return { prompt, negatives, parameters, notes, aspect, assumed, subjectDetected: Boolean(subject) };
}

/* ───────────────────────── assembly ───────────────────────── */

const OCCAM_RULES = [
  'Prefer the shortest wording that fully carries the instruction.',
  'Do not restate the user’s request back to them as part of the answer.',
  'Do not add sections that this task does not need.',
];

/**
 * Assemble the final prompt from the populated context.
 * @returns {{sections:Array, prompt:string, title:string, template:string}}
 */
export function buildPrompt(ctx) {
  if (ctx.flags.media) {
    const m = ctx.media || (ctx.media = buildMediaPrompt(ctx.spec, ctx));
    const template = recipeIdFor(ctx.primary.id, ctx.flags);
    const prompt = renderMediaPrompt(ctx);
    return { sections: [], prompt, title: `${titleCase(ctx.spec.media.kind)} prompt`, template, media: m };
  }

  ctx.finalRules = unique([
    ...(ctx.finalRules || []),
    'Do not pad the answer. Every sentence must carry information the user needs.',
    ...OCCAM_RULES.slice(1),
  ]);

  if (ctx.flags.wantsAnswerOnly) {
    ctx.finalRules.push('Return the deliverable only — no explanation, no preface, no follow-up offer.');
  }

  const sections = buildSections(ctx);
  const template = recipeIdFor(ctx.primary.id, ctx.flags);
  const title = `${ctx.primary.label} prompt`;
  const prompt = renderPrompt(sections, { target: ctx.target, title });
  return { sections, prompt, title, template };
}

/**
 * Machine-readable companion to the prompt: the brief a caller can use to
 * automate follow-up runs.
 */
export function buildHandoff(ctx) {
  return {
    objective: ctx.spec.objective,
    deliverable: ctx.spec.deliverable,
    target: ctx.target.id,
    techniqueIds: ctx.selected.map((t) => t.id),
    template: ctx.template,
    stages: ctx.planStages,
    stopConditions: ctx.budget.stopConditions,
    assumptions: ctx.assumptions.map((a) => `${a.field}: ${a.assumption}`),
    unknowns: ctx.spec.unknowns,
    mustNotDo: ctx.spec.forbidden,
    requirementSummary: listOut(ctx.spec.requirements.must.slice(0, 5)) || 'see prompt body',
  };
}
