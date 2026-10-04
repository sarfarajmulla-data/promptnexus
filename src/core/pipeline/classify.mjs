/**
 * Classification stage.
 *
 * Produces: intent, category ranking (multi-label), target model, and a
 * complexity level. Every decision carries the evidence that produced it, so
 * the UI can show the user *why* the engine chose that strategy — a decision
 * summary, never private chain-of-thought.
 */

import { TAXONOMY, CATEGORY_INDEX } from '../knowledge/taxonomy.mjs';
import { TARGETS, TARGET_INDEX } from '../knowledge/targets.mjs';
import { rankSignals, matchSignals } from '../util/match.mjs';
import { normalizeInput, fold, countWords, sentences, clamp, stripMetaFrame, firstMeaningfulSentence, looksLikeTask } from '../util/text.mjs';

/* ───────────────────────── intent ───────────────────────── */

const ACTION_BY_CATEGORY = {
  'general-qa': 'explain', research: 'research and synthesise evidence on',
  'web-research': 'find and verify current information about', academic: 'produce academic-quality work on',
  learning: 'teach', 'exam-prep': 'prepare the user for assessment on',
  writing: 'write', rewriting: 'rewrite', editing: 'edit', translation: 'translate',
  summarization: 'summarise', analysis: 'analyse', comparison: 'compare',
  decision: 'help decide', planning: 'plan', coding: 'write code for', debugging: 'diagnose and fix',
  architecture: 'design the architecture for', 'data-analysis': 'analyse the data for',
  mathematics: 'solve', science: 'explain', engineering: 'design',
  business: 'produce a business deliverable for', entrepreneurship: 'evaluate and plan',
  marketing: 'produce marketing material for', seo: 'improve search performance for',
  'social-media': 'create social content for', presentation: 'build a presentation for',
  document: 'produce documentation for', resume: 'improve the résumé for',
  'interview-prep': 'run interview practice for', career: 'plan the career path for',
  productivity: 'design a workable system for', 'project-management': 'plan and de-risk',
  travel: 'plan the trip for', finance: 'analyse the financial situation for',
  legal: 'explain the legal position for', health: 'explain the health information for',
  'creative-writing': 'write', storytelling: 'shape the narrative for',
  'image-generation': 'compose an image prompt for', 'image-editing': 'compose an edit instruction for',
  'video-generation': 'compose a video prompt for', audio: 'produce the audio design for',
  'ui-ux': 'design the interface for', website: 'build the website for',
  'app-development': 'build the application for', 'game-dev': 'design the game for',
  automation: 'automate', 'agent-design': 'specify the AI agent for',
  'ai-development': 'build the AI/ML system for', 'prompt-engineering': 'engineer the prompt for',
  'meta-prompting': 'build the prompt-generator for', brainstorming: 'generate and filter ideas for',
  simulation: 'simulate', roleplay: 'set up the practice scenario for',
  communication: 'draft the communication for', devops: 'produce the infrastructure plan for',
  'security-review': 'review the security of', 'data-viz': 'design the visualisation for',
  spreadsheet: 'build the spreadsheet solution for', other: 'complete the task of',
};

/** Remove prompt-request framing and conversational filler from user text. */
export function detectIntent(raw) {
  const clean = normalizeInput(raw);
  const framed = clean;
  const core = stripMetaFrame(clean);
  const first = firstMeaningfulSentence(core) || core;
  return {
    verbatim: framed,
    core,
    headline: first,
    isPromptRequest: /\b(prompt|prompting|system message|instructions? for (an? )?(ai|model|llm|chatgpt|claude))\b/i.test(core),
    words: countWords(core),
    sentences: sentences(core).length,
  };
}

/** Turn a classified intent into a one-line goal statement. */
export function goalSentence(intent, primary, spec) {
  // When extraction flagged an override attempt, anything in the topic is
  // treated as untrusted: it must pass a structural plausibility test on its own
  // merits, and the raw headline is never used as a fallback. Otherwise a payload
  // could become the objective the model is instructed to carry out.
  let topic;
  if (spec?.injectedContent) {
    const candidate = String(spec?.topic || '').replace(/[.?!]+$/, '').trim();
    topic = looksLikeTask(candidate) ? candidate : '';
  } else {
    topic = String(spec?.topic || intent.headline || '').replace(/[.?!]+$/, '').trim();
  }
  const verb = ACTION_BY_CATEGORY[primary.id] || 'complete the task of';
  if (!topic) return `Produce the best possible ${primary.label.split(/[/—]/)[0].trim().toLowerCase()} deliverable.`;
  const trimmedTopic = topic.length > 220 ? topic.slice(0, 217).trimEnd() + '…' : topic;
  // "i keep failing physics quizzes, teach me kinematics" → the second clause is the real goal.
  let body = trimmedTopic;
  const commaParts = body.split(/,\s+/);
  if (commaParts.length > 1 && /^i\s+(?:keep|am|have|need|want|can'?t|don'?t|'m|m|always|never)\b/i.test(commaParts[0])) {
    body = commaParts.slice(1).join(', ');
  }
  body = body.replace(/^(?:please\s+|can you\s+|could you\s+)/i, '');
  const capitalised = body.charAt(0).toUpperCase() + body.slice(1);
  // If the sentence already opens with a verb, it *is* the goal — stacking our
  // own action verb on top would just restate it. Tested on the processed body,
  // not on the raw topic, so a stripped lead-in clause cannot hide the verb.
  const bodyStartsWithVerb = /^(write|create|build|make|design|analyse|analyze|explain|compare|plan|fix|debug|translate|summari[sz]e|generate|draft|review|improve|teach|find|calculate|solve|convert|refactor|optimi[sz]e|learn|decide|choose|prepare|develop|implement|revis\w+|help|show|suggest|give)\b/i.test(body);
  if (bodyStartsWithVerb || /^i\s+\w+\b/i.test(body)) return capitalised;
  return `${verb.charAt(0).toUpperCase() + verb.slice(1)}: ${body}`;
}

/* ───────────────────────── categories ───────────────────────── */

/**
 * High-confidence domain markers. Surface vocabulary ("write a…") can out-score
 * the actual context, so when one of these fires the domain wins outright and
 * the override is recorded as evidence.
 */
const DOMAIN_OVERRIDES = [
  { id: 'academic', re: /\b(coursework|assignment|dissertation|thesis|term paper|bibliography|apa|mla|ieee|harvard|chicago|oscola|rubric|mark scheme|grading|word essay|lecturer|professor)\b/i, why: 'academic coursework markers are present' },
  { id: 'exam-prep', re: /\b(revision|revising|revise for|studying for|exam on|exams? (?:next|this|tomorrow|on)|past papers?|viva|midterm|finals|mock exam|flashcards|syllabus)\b/i, why: 'assessment preparation markers are present' },
  { id: 'debugging', re: /\b(?:(?:my|our|this|the|when i)\s+(?:[\w.'/-]+\s+){0,8}(?:throws?|crashes?|fails?|is broken|won'?t (?:run|start|build|compile|work)|isn'?t working|not working|keeps? (?:failing|crashing|timing out|breaking|erroring)|times? out|hangs|freezes|gives? (?:me )?an? error|errors? out|stopped working)|(?:no idea|don'?t know|can'?t figure out|not sure)\s+why\b)/i, why: 'a first-person failure symptom is described' },
  { id: 'research', re: /\b(literature review|systematic review|research question|evidence base|state of the art)\b/i, why: 'a research deliverable is named' },
  { id: 'coding', re: /\b(python|javascript|typescript|java|c\+\+|c#|csharp|golang|rust|ruby|php|kotlin|swift|dart|sql|react|vue|angular|svelte|node|express|django|flask|fastapi|laravel|spring|rails|tailwind|docker|kubernetes|terraform|regex|endpoint)\b/i, why: 'a programming language, framework or programming construct is named' },
  { id: 'image-generation', re: /\b(?:make|create|design|generate|draw|render)\b[^.\n]{0,45}\b(?:image|picture|photo|poster|logo|thumbnail|wallpaper|banner|illustration|artwork|mockup)\b|\b(?:poster|logo|thumbnail|wallpaper|banner)\s+(?:for|of)\b|\b(?:image|picture|photo)s? of\b/i, why: 'the request is to produce a visual artefact' },
  { id: 'website', re: /\b(?:build|create|make|design|redesign)\b[^.\n]{0,45}\b(?:website|web site|web app|web application|landing page|full[- ]stack|saas|dashboard|portfolio site)\b/i, why: 'the request is to build a web product' },
];

export function classifyCategories(raw) {
  const folded = fold(raw);
  const ranked = rankSignals(folded, TAXONOMY.map((t) => ({
    id: t.id, ...t, kw: t.kw, ph: t.ph, re: t.re,
  })));

  if (!ranked.length) {
    return { ranked: [{ ...CATEGORY_INDEX.other, score: 0.1, hits: [], confidence: 0.2 }], primary: CATEGORY_INDEX.other, secondary: [], folded };
  }

  // Multi-label: keep everything within a sensible margin of the leader.
  const top = ranked[0];
  const keep = ranked.filter((r, i) => i < 4 && (r.score >= top.score * 0.28 || r.hits.length >= 3));
  let primaryEntry = CATEGORY_INDEX[top.id] || CATEGORY_INDEX.other;
  let primaryScore = top.score;
  let primaryHits = top.hits;
  let rest = keep.filter((r) => r.id !== top.id);

  for (const ov of DOMAIN_OVERRIDES) {
    if (!ov.re.test(raw)) continue;
    if (primaryEntry.id === ov.id) break;
    const promoted = CATEGORY_INDEX[ov.id];
    if (!promoted) continue;
    // Demote the previous leader so it still informs the build.
    rest = [{ ...primaryEntry, score: primaryScore, hits: primaryHits }, ...rest].slice(0, 4);
    primaryEntry = promoted;
    primaryScore = Math.max(primaryScore, 3);
    primaryHits = [...(primaryHits || []), ov.why];
    break;
  }

  const primary = primaryEntry;
  const secondary = rest.map((r) => ({ ...(CATEGORY_INDEX[r.id] || CATEGORY_INDEX.other), score: r.score, hits: r.hits }));

  return {
    ranked: keep,
    primary: { ...primary, score: primaryScore, hits: primaryHits },
    secondary,
    folded,
    confidence: clamp(top.score / (top.score + 6), 0.15, 0.95),
  };
}

/* ───────────────────────── target ───────────────────────── */

export function detectTarget(raw, { explicitId } = {}) {
  if (explicitId) {
    const t = TARGET_INDEX[explicitId];
    if (t) return { target: t, source: 'stated', confidence: 1, alternatives: [] };
  }

  const folded = fold(raw);
  const scored = TARGETS.filter((t) => !t.generic)
    .map((t) => {
      const { score, hits } = matchSignals(folded, { kw: t.kw, ph: t.ph, weight: { kw: 1.6, ph: 2.4 } });
      return { target: t, score, hits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.target.id).localeCompare(String(b.target.id)));

  // An explicit mention of a model name (not just a generic word like "image") wins.
  const strong = scored.find((x) => x.hits.some((h) => TARGETS.find((t) => t.id === x.target.id)?.kw?.includes(h)));
  if (strong && strong.score >= 1.6) {
    return {
      target: strong.target,
      source: 'mentioned',
      confidence: clamp(0.5 + strong.score / 10, 0.5, 0.95),
      alternatives: scored.slice(1, 4).map((s) => s.target),
      evidence: strong.hits,
    };
  }

  return {
    target: TARGET_INDEX.generic,
    source: 'unspecified',
    confidence: 0.4,
    alternatives: scored.slice(0, 4).map((s) => s.target),
    evidence: scored.length ? scored[0].hits : [],
  };
}

/* ───────────────────────── complexity ───────────────────────── */

/**
 * Minimum complexity floor per task class. These are structural judgements, not
 * difficulty inflation: a decision brief or an architecture review genuinely
 * cannot be satisfied by a single flat step.
 */
const CATEGORY_MIN_LEVEL = {
  decision: 3, comparison: 2, career: 3, finance: 3, planning: 2, 'project-management': 3,
  research: 3, 'web-research': 3, academic: 3, 'exam-prep': 2, 'data-analysis': 3,
  architecture: 4, 'agent-design': 4, 'ai-development': 4, website: 3, 'app-development': 4,
  'game-dev': 4, debugging: 3, devops: 3, 'security-review': 4, automation: 3,
  business: 3, entrepreneurship: 3, marketing: 2, legal: 2, health: 2, 'prompt-engineering': 3,
  'meta-prompting': 3, 'ui-ux': 3, 'creative-writing': 2, presentation: 2, document: 2, travel: 2,
  'interview-prep': 2, engineering: 3, mathematics: 2, 'image-generation': 2, 'video-generation': 2,
};

const HARD_CATEGORIES = new Set([
  'research', 'web-research', 'academic', 'architecture', 'agent-design', 'ai-development',
  'security-review', 'app-development', 'website', 'game-dev', 'debugging', 'devops',
  'data-analysis', 'business', 'entrepreneurship', 'legal', 'health', 'finance', 'meta-prompting',
]);

export function assessComplexity({ intent, categories, spec, flags, raw }) {
  const reasons = [];
  let score = 1;

  const nWords = intent.words;
  // Framing-removal shrinks short requests; the floor test must see the real length.
  const rawWords = countWords(raw);
  if (nWords > 220) { score += 1.2; reasons.push(`${nWords} words of brief — substantial context to carry.`); }
  else if (nWords > 90) { score += 0.7; reasons.push(`${nWords} words of brief.`); }
  else if (nWords < 12) { score -= 0.4; reasons.push('Very short brief — most requirements must be inferred.'); }

  if (categories.secondary.length >= 2) { score += 0.8; reasons.push(`Spans ${categories.secondary.length + 1} task types (${[categories.primary, ...categories.secondary].map((c) => c.label).join(', ')}) — multiple disciplines must be reconciled.`); }
  else if (categories.secondary.length === 1) { score += 0.35; reasons.push(`Blends ${categories.primary.label} with ${categories.secondary[0].label}.`); }

  const hard = [...categories.secondary.map((c) => c.id), categories.primary.id].some((id) => HARD_CATEGORIES.has(id));
  if (hard) { score += 0.7; reasons.push('Domain carries structural depth (not a single-step answer).'); }

  if (spec.requirements.must.length >= 6) { score += 0.7; reasons.push(`${spec.requirements.must.length} hard requirements must hold simultaneously.`); }
  else if (spec.requirements.must.length >= 3) { score += 0.35; reasons.push(`${spec.requirements.must.length} hard requirements identified.`); }

  if (spec.options?.length >= 2) { score += 0.6; reasons.push(`A choice between named options (${spec.options.join(' / ')}) — judging trade-offs is inherent to the task.`); }
  if (/first[\s\S]{0,120}then|step 1|stage|phase|workflow|pipeline|multi[- ]?step|end to end|end-to-end/i.test(raw)) { score += 0.7; reasons.push('User described a multi-stage process.'); }
  if (/and also|as well as|plus|in addition/i.test(raw)) { score += 0.3; reasons.push('Brief contains additional secondary asks.'); }
  if (flags.needsSources) { score += 0.4; reasons.push('Output depends on external evidence.'); }
  if (flags.targetHasTools && flags.targetAgentic) { score += 0.8; reasons.push('Target has tools/agentic capability, enabling a workflow rather than a single answer.'); }
  if (flags.largeProject) { score += 0.9; reasons.push('Scope looks like a full product or project build.'); }
  if (spec.conflicts.length) { score += 0.4; reasons.push('Conflicting requirements detected and must be resolved.'); }
  if (spec.unknowns.length >= 3) { score += 0.3; reasons.push(`${spec.unknowns.length} material unknowns remain.`); }
  if (flags.requiresVerification) { score += 0.35; reasons.push('Output must be verified before use.'); }

  // Some task classes are structurally deeper than any surface signal reveals:
  // a decision brief or a system design cannot be answered in one flat step.
  let level = clamp(Math.round(score), 1, 5);
  if (rawWords >= 6) {
    const floor = CATEGORY_MIN_LEVEL[categories.primary.id];
    if (floor && floor > level) {
      level = Math.min(5, floor);
      reasons.push(`${categories.primary.label} tasks inherently require ${floor >= 4 ? 'multi-stage, verified' : 'multi-component'} work.`);
    }
  }
  const label = ['Simple — single step', 'Moderate — several requirements, one output', 'Complex — multiple reasoning components', 'Advanced — multi-stage with verification', 'Agentic — tools, iteration or multiple stages'][level - 1];

  return { level, label, score, reasons };
}
