/**
 * Requirement extraction engine.
 *
 * Converts free-form human language into a structured internal specification:
 * objective, context, audience, inputs, requirements (must/should/optional),
 * constraints, forbidden content, unknowns and conflicts.
 *
 * Design principle: never invent personal information. Anything not stated by
 * the user is either inferred with visible evidence, or listed as an assumption
 * the user can correct — never silently fabricated.
 */

import { CATEGORY_INDEX } from '../knowledge/taxonomy.mjs';
import { normalizeInput, sentences, lines, countWords, fold, unique, titleCase, truncateWords, extractCodeBlocks, similarity, stripMetaFrame, firstMeaningfulSentence, looksLikeTask } from '../util/text.mjs';

/* ───────────────────── pattern banks ───────────────────── */

const HARD_RE = /\b(must|have to|has to|need to|needs to|required|requirement|make sure|ensure|essential|critical|imperative|no later than|exactly|mandatory)\b/i;
const SOFT_RE = /\b(should|ideally|prefer|preferably|try to|aim for|good to)\b/i;
const OPT_RE = /\b(maybe|perhaps|possibly|if possible|optionally|nice to have|would be nice|could also|bonus)\b/i;
const NEG_RE = /\b(avoid|don'?t|do not|never|no |without|exclude|excluded|must not|shouldn'?t|not include|skip|refrain)\b/i;

/**
 * Audience detection only fires on words that actually denote people or groups.
 * A loose suffix rule ("anything ending in -s") happily turned "for my DBMS"
 * into an audience, which then poisoned the whole CONTEXT section.
 */
const AUDIENCE_NOUNS = [
  'students?', 'pupils?', 'learners?', 'beginners?', 'children', 'kids', 'parents',
  'teachers?', 'professors?', 'lecturers?', 'tutors?', 'examiners?', 'markers?', 'supervisors?',
  'recruiters?', 'employers?', 'hiring managers?', 'interviewers?', 'employees?', 'colleagues?',
  'teammates?', 'team', 'class', 'managers?', 'bosses?', 'boss', 'executives?', 'directors?', 'board',
  'investors?', 'clients?', 'customers?', 'users?', 'readers?', 'viewers?', 'listeners?', 'audience',
  'subscribers?', 'followers?', 'stakeholders?', 'committee', 'panel', 'jury', 'staff', 'community',
  'general public', 'the public', 'non[- ]technical readers?', 'technical readers?', 'peers?',
  'landlords?', 'landladies', 'tenants?', 'neighbours?', 'neighbors?', 'friends?', 'partners?',
  'family', 'my family', 'vendor', 'suppliers?', 'contractors?', 'freelancers?', 'developers?',
];
const AUDIENCE_RE = new RegExp(
  `\\b(?:for|to|aimed at|targeting|target audience|audience is|read by|presenting to|sending (?:it )?to|sent to)\\s+(?:my|our|the|a|an)?\\s*(${AUDIENCE_NOUNS.join('|')})\\b`,
  'i',
);
const POSSESSIVE_AUDIENCE_RE = /\bmy\s+(boss|manager|client|customer|teacher|professor|lecturer|team|class|landlord|landlady|supervisor|recruiter|interviewer|colleagues?|partner|parents?|family)\b/i;

const TONE_MAP = [
  [/formal|professional|business[- ]like|corporate/i, 'professional and formal'],
  [/academic|scholarly|scholarly tone|university/i, 'academic'],
  [/casual|informal|conversational|relaxed|chill/i, 'casual and conversational'],
  [/friendly|warm|approachable|kind/i, 'friendly and approachable'],
  [/persuasive|convincing|compelling|pitch/i, 'persuasive'],
  [/funny|humorous|witty|playful|light[- ]hearted/i, 'light and witty'],
  [/serious|sober|grave|sensitive/i, 'serious and measured'],
  [/simple|plain|easy to (read|understand)|jargon[- ]free|layman/i, 'plain and jargon-free'],
  [/technical|rigorous|precise|scientific/i, 'technical and precise'],
  [/motivat|inspiring|uplifting|energetic/i, 'motivating'],
  [/empathetic|compassionate|understanding|supportive/i, 'empathetic'],
];

const LENGTH_MAP = [
  [/\b(\d{2,5})\s*words?\b/i, (m) => `about ${m[1]} words`],
  [/\b(\d{1,3})\s*pages?\b/i, (m) => `about ${m[1]} pages`],
  [/\b(\d{1,3})\s*(?:slides|bullet points|bullets|tweets|posts|ideas|options)\b/i, (m) => `${m[1]} items`],
  [/\b(?:one|a single)\s+(?:paragraph|sentence|page)\b/i, (m) => m[0]],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+(?:paragraphs?|pages?|sentences?|slides?)\b/i, (m) => m[0]],
  [/\b(short|brief|concise|succinct|compact|punchy)\b/i, () => 'concise — no padding'],
  [/\b(detailed|in[- ]depth|thorough|comprehensive|extensive|exhaustive)\b/i, () => 'detailed and thorough'],
  [/\b(tl;?dr|one[- ]liner|brief summary)\b/i, () => 'very short'],
];

const CITATION_STYLES = [
  [/\bapa\b/i, 'APA 7th edition'], [/\bmla\b/i, 'MLA 9th edition'], [/\bieee\b/i, 'IEEE'],
  [/\bharvard\b/i, 'Harvard'], [/\bchicago\b/i, 'Chicago'], [/\boscola\b/i, 'OSCOLA'],
  [/\b(acm|vancouver)\b/i, (m) => m[0].toUpperCase()],
];

const ACADEMIC_LEVELS = [
  [/\b(high school|secondary school|a[- ]level|gcse)\b/i, 'high-school / A-level standard'],
  [/\b(first year|freshman|year 1|100[- ]level|introductory (course|module))\b/i, 'first-year undergraduate'],
  [/\b(final year|senior|capstone|thesis|dissertation|graduation project|year 3|year 4|level [56])\b/i, 'final-year undergraduate'],
  [/\b(master'?s?|msc|meng|mba|postgrad|postgraduate|level 7)\b/i, 'Master’s level'],
  [/\b(phd|doctoral|doctorate|level 8)\b/i, 'doctoral level'],
];

const TECH_TOKENS = [
  'python', 'javascript', 'typescript', 'java', 'c\\+\\+', 'c#', 'go', 'golang', 'rust', 'php', 'ruby', 'kotlin', 'swift', 'dart', 'sql', 'html', 'css', 'scss',
  'react', 'vue', 'angular', 'svelte', 'next\\.js', 'nuxt', 'node', 'express', 'django', 'flask', 'fastapi', 'spring', 'laravel', 'rails', '\\.net',
  'tailwind', 'bootstrap', 'mysql', 'postgres', 'postgresql', 'mongodb', 'sqlite', 'redis', 'prisma',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'nginx', 'linux', 'git',
  'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'pandas', 'numpy', 'opencv',
  'flutter', 'react native', 'unity', 'unreal', 'godot', 'android', 'ios', 'figma', 'wordpress', 'shopify',
];
const TECH_RE = new RegExp(`\\b(${TECH_TOKENS.join('|')})\\b`, 'gi');

const COUNTRY_RE = /\b(india|usa|united states|uk|united kingdom|canada|australia|germany|france|spain|italy|netherlands|ireland|nigeria|kenya|south africa|pakistan|bangladesh|sri lanka|uae|dubai|singapore|malaysia|japan|china|brazil|mexico|philippines|indonesia|vietnam|saudi arabia|new zealand|poland|sweden|norway|denmark|portugal|switzerland)\b/i;

const BUDGET_RE = /\b(?:budget(?:\s+is)?|under|below|max(?:imum)?|up to|about|around|less than)\s*[$£€₹]?\s*(\d[\d,.]*)\s*(k|thousand|million)?\b/i;
const FREE_RE = /\b(free|no[- ]cost|zero[- ]cost|freemium|open[- ]source|cheap|low[- ]cost|low[- ]budget|student budget|broke)\b/i;
const PREMIUM_RE = /\b(premium|paid|enterprise|best (?:quality|money can buy)|budget is not|no budget limit)\b/i;
const URGENT_RE = /\b(urgent|asap|tonight|tomorrow|deadline|due (?:on|by|in)|this (?:week|weekend)|in \d+ (?:hours|days)|running out of time|no time)\b/i;
const DATE_RE = /\b(by|before|on|due)\s+(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|the \d{1,2}(?:st|nd|rd|th))\b/i;

const EXISTING_PROMPT_RE = /\b(improve|rewrite|fix|optimis|optimiz|refine|upgrade|rate|review|critique|compare|shorten|compress|expand|translate|test|break)\b[^.\n]{0,40}\b(prompt|instruction|system message)\b/i;
const PASTED_PROMPT_RE = /(^|\n)\s*(you are (a|an|the)\b|as an? (ai|assistant|expert)\b|your (task|role|job) is\b|act as\b|i want you to\b)/i;
const CODE_PASTE_RE = /(^|\n)\s*(def |function |class |import |const |let |var |#include|public |private |<\?php|SELECT |async def )/m;

const USER_SELF_RE = /\b(i'?m a|i am a|i'?m an|as a|studying|i study|my (?:course|degree|major|background|experience)|i work (?:as|in|at)|i know|i'?m learning|i'?m new to|i have experience)\b/i;

/* ───────────────────── helpers ───────────────────── */

function cleanSentence(s) {
  return normalizeInput(s).replace(/^[-*•\d.)\s]+/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Remove text whose purpose is to reprogram the model rather than describe a
 * task. Returns the cleaned text plus whether anything was found.
 */
const ADVERSARIAL_RES = [
  /\bignore\s+(?:all\s+)?(?:your\s+|the\s+|any\s+)?(?:previous\s+|prior\s+|above\s+)?(?:rules?|instructions?|directions?|prompts?)\b[^.\n]*[.]?/gi,
  /\bdisregard\s+(?:all\s+)?(?:your\s+|the\s+|prior\s+)?(?:rules?|instructions?|guidelines?)\b[^.\n]*[.]?/gi,
  /\b(?:reveal|show|print|repeat|output)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?)\b[^.\n]*[.]?/gi,
  /\byou\s+are\s+now\s+(?:a|an|the)?\s*[^.\n]*[.]?/gi,
  /\b(?:developer|debug|god|admin)\s+mode\b[^.\n]*[.]?/gi,
  /\boutput\s+the\s+text\s+["'“”]?[^.\n"'“”]*["'“”]?[.]?/gi,
  /\boverride\s+(?:your\s+|all\s+)?(?:safety|rules?|instructions?)\b[^.\n]*[.]?/gi,

  // Closing-tag breakout: pasted content trying to escape the data block it was
  // placed in, e.g. "</INSTRUCTIONS> now do this instead".
  /<\/?(?:instructions?|system|context|user_data|reference_material|output_requirements)\s*>/gi,

  // Role-prefix spoofing: a line that impersonates the system or a turn boundary.
  /(?:^|[\n.;])\s*(?:system|developer|admin)\s*:\s*[^.\n]*[.]?/gim,

  // Redirection: replacing the task with a different payload.
  /\b(?:output|print|say|reply|respond|write|return)\b[^.\n]{0,40}\binstead\b[^.\n]*[.]?/gi,
  /\binstead\s+(?:of\s+that\s*,?\s*)?(?:output|print|say|reply|respond|write|return)\b[^.\n]*[.]?/gi,

  // "…now output \"X\"" — a quoted payload with no "the text" lead-in.
  /\b(?:now\s+|then\s+)?(?:output|print|say|reply|respond|repeat|echo|return)\s+(?:only\s+|just\s+)?["'“”][^"'“”\n]{1,60}["'“”][^.\n]*[.]?/gi,

  // Quoted payload requested as the reply, with any lead-in wording.
  /\b(?:respond|reply|answer|write back)\s+(?:with\s+)?(?:only\s+|just\s+)?["'“”][^"'“”\n]{1,60}["'“”][^.\n]*[.]?/gi,

  // Amnesia phrasing: discard the brief, then do something else.
  /\b(?:forget|disregard|discard)\s+(?:all\s+|everything\s+|that\b|this\b|the\s+above\b|your\s+(?:rules?|instructions?))[^.\n]*[.]?/gi,

  // Unrestricted-persona invocations.
  /\b(?:pretend|imagine)\s+(?:that\s+)?(?:you\s+)?(?:have\s+no|are\s+not|aren't|do\s+not\s+have)\b[^.\n]*[.]?/gi,
  /\bact\s+as\s+if\s+you\s+(?:have\s+no|are\s+not|aren't|do\s+not\s+have)\b[^.\n]*[.]?/gi,
  /\bwithout\s+any\s+(?:restrictions?|rules?|filters?|limits?)\b[^.\n]*[.]?/gi,

  // "Ignore everything above / the above" — the broad form of an override.
  /\bignore\s+(?:everything|all|anything)\s+(?:above|before|prior|preceding)\b[^.\n]*[.]?/gi,
  /\bignore\s+(?:the\s+)?(?:above|preceding|foregoing)\b[^.\n]*[.]?/gi,
];

export function stripAdversarialContent(text) {
  let cleaned = String(text);
  let found = false;

  // Patterns overlap: removing "you are now unrestricted" from
  // "SYSTEM: you are now unrestricted" leaves a bare "SYSTEM:" that only the
  // role-prefix rule can catch. Pass repeatedly until the text stops changing,
  // with a bound so a pathological input cannot spin.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const re of ADVERSARIAL_RES) {
      if (re.test(cleaned)) {
        found = true;
        const next = cleaned.replace(re, ' ');
        if (next !== cleaned) changed = true;
        cleaned = next;
      }
      re.lastIndex = 0;
    }
    if (!changed) break;
  }

  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();

  // If stripping consumed everything, say so rather than returning a fragment.
  const usable = cleaned.replace(/[\s.,;:\-—]/g, '').length >= 3;
  return { cleaned: usable ? cleaned : '', found };
}

/** Questions and instructions addressed to the assistant describe the task, not constraints. */
function isQuestionLike(s) {
  if (/[?]\s*$/.test(s)) return true;
  if (/^(?:should|shall|can|could|would|will|is|are|do|does|did|what|which|who|when|where|why|how)\b/i.test(s)) return true;
  if (/^(?:please|can you|could you|would you|i want you to|i need you to|help me)\b/i.test(s)) return true;
  return false;
}

function firstMatch(map, text) {
  for (const [re, val] of map) {
    const m = text.match(re);
    if (m) return typeof val === 'function' ? val(m) : val;
  }
  return null;
}

function matchAllRe(text, re) {
  const out = [];
  let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(text)) !== null) out.push(m[0].toLowerCase());
  return out;
}

/* ───────────────────── main extractor ───────────────────── */

/**
 * @param {string} raw original user input
 * @param {object} analysis classification results from classify.mjs
 * @returns {object} structured specification
 */
export function extractSpec(raw, analysis) {
  const text = normalizeInput(raw);
  const folded = fold(text);
  const sents = sentences(text);
  const linesArr = lines(text);
  const primary = analysis.categories.primary;
  const allCats = [primary, ...analysis.categories.secondary];

  /* — objective & topic — */
  // Content that tries to instruct the model rather than describe the task is
  // stripped here and reported, never carried into the generated prompt.
  const { cleaned: safeText, found: injectedContent } = stripAdversarialContent(text);
  // When content was stripped, the remainder is only trusted as the objective if
  // it still reads like a task. Enumerating attack phrasings is a losing game, so
  // the rule is structural: residue that merely asks for a payload is discarded
  // and the goal falls back to the task class instead of echoing the attack.
  const residualIsTask = injectedContent ? looksLikeTask(safeText) : true;
  const objectiveRaw = injectedContent
    ? (residualIsTask && looksLikeTask(safeText) ? (firstMeaningfulSentence(stripMetaFrame(safeText)) || safeText) : '')
    : (analysis.intent.headline || text);
  const objective = cleanSentence(objectiveRaw) || '';
  const topic = truncateWords(objective.replace(/^(i\s+(?:want|need|would like)\s+(?:you\s+)?to\s+)/i, ''), 60);
  const deliverable = inferDeliverable(primary, allCats, folded);

  /* — requirements by force level — */
  const must = [];
  const should = [];
  const optional = [];
  const forbidden = [];

  for (const s of sents) {
    const c = cleanSentence(s);
    if (countWords(c) < 3) continue;
    if (countWords(c) > 45) continue;
    if (isQuestionLike(c)) continue; // questions state the task, not the requirements
    if (NEG_RE.test(c) && /\b(avoid|don'?t|do not|never|must not|shouldn'?t|exclude|not include|without)\b/i.test(c)) {
      forbidden.push(cleanForbidden(c));
      continue;
    }
    if (HARD_RE.test(c)) { must.push(c); continue; }
    if (OPT_RE.test(c)) { optional.push(c); continue; }
    if (SOFT_RE.test(c)) { should.push(c); continue; }
  }

  // Bullet lists are almost always requirement lists.
  for (const l of linesArr) {
    if (!/^[-*•\d]/.test(l)) continue;
    const c = cleanSentence(l);
    if (countWords(c) < 3 || countWords(c) > 40) continue;
    if (must.includes(c) || should.includes(c) || optional.includes(c) || forbidden.includes(c)) continue;
    if (NEG_RE.test(c)) forbidden.push(cleanForbidden(c));
    else should.push(c);
  }

  /* — target audience — */
  const audience = detectAudience(text);

  /* — tone / length / style — */
  const tone = firstMatch(TONE_MAP, text);
  let lengthTarget = null;
  for (const [re, val] of LENGTH_MAP) {
    const m = text.match(re);
    if (m) { lengthTarget = typeof val === 'function' ? val(m) : val; break; }
  }

  /* — style reference — */
  const styleSource = /\b(match (?:the|this|my) style|same style as|in the style of|like (?:this|the) (?:example|sample)|copy the (?:tone|style))\b/i.test(text);

  /* — audience-provided examples — */
  const codeBlocks = extractCodeBlocks(text);
  const hasSourceText = codeBlocks.length > 0 || /\b(here(?:'s| is) (?:my|the|this)|below is|following (?:text|code|data|document)|attached|paste[dr]? below|this (?:text|code|document|data|transcript|email))\b/i.test(text);

  /* — target environment & constraints — */
  const techStack = unique(matchAllRe(text, TECH_RE)).map((t) => TECH_FIX[t] || t);
  const country = (text.match(COUNTRY_RE) || [])[1] || null;
  const budget = detectBudget(text);
  const deadline = (text.match(DATE_RE) || [])[0] || null;
  const urgent = URGENT_RE.test(text);
  const freePreferred = FREE_RE.test(text);
  const premium = PREMIUM_RE.test(text);

  /* — academic specifics — */
  // Only interpret "masters"/"phd" as the required standard when the work itself is academic.
  const academicTask = ['academic', 'exam-prep', 'learning', 'research'].includes(primary.id)
    || /\b(assignment|coursework|dissertation|thesis|term paper|essay|report|exam|revision|module|course)\b/i.test(text);
  const academicLevel = academicTask ? firstMatch(ACADEMIC_LEVELS, text) : null;
  const citationStyle = academicTask || /\b(cite|citation|references?|bibliography)\b/i.test(text)
    ? firstMatch(CITATION_STYLES, text) : null;

  /* — capability & audience skill signals — */
  const isBeginner = /\b(beginner|new to|no experience|just started|first time|learning|from scratch|novice|dummy|explain like i(?:'m| am) (?:a )?(?:five|5|beginner))\b/i.test(text);
  const isExpert = /\b(expert|advanced|experienced|senior|professional|specialist|deep dive|internals|optimis|optimiz|research[- ]level)\b/i.test(text);

  /* — media specifics — */
  const media = detectMediaIntent(primary, text, folded);

  /* — decision options — */
  const options = detectOptions(text);

  /* — research question — */
  const researchQuestion = /\b(whether|does|is|are|can|what|how|why|impact of|effect of|relationship between)\b/i.test(objective) ? objective : null;

  /* — user self-disclosure — */
  const selfContext = detectSelfContext(sents);

  /* — machine-readable output — */
  const wantsMachine = /\b(json|yaml|xml|csv|schema|api response|machine[- ]readable|parse[able]*|data structure|object with|array of)\b/i.test(text);
  const wantsTable = /\b(table|spreadsheet|matrix|comparison table)\b/i.test(text);
  const wantsSteps = /\b(step[- ]by[- ]step|steps|walk ?through|guide|tutorial|instructions)\b/i.test(text);

  /* — format request — */
  const explicitFormat = detectFormat(text, { wantsMachine, wantsTable, wantsSteps, primary });

  /* — conflicts — */
  const conflicts = detectConflicts({ text, tone, lengthTarget, freePreferred, premium, isBeginner, isExpert, must, should });

  /* — coverage of category-required elements — */
  const coverage = assessCoverage(primary, {
    text, folded, audience, tone, lengthTarget, techStack, country, budget, academicLevel,
    citationStyle, media, selfContext, options, deadline,
  });

  const role = deriveRoles(primary, allCats, { text, folded, isExpert, isBeginner, techStack, academicLevel });

  const spec = {
    objective,
    topic,
    deliverable,
    role,
    context: deriveContext({ text, sents, primary, audience, selfContext, country, deadline, urgent, constraints: [...must, ...should], objective }),
    audience,
    inputs: deriveInputs({ primary, hasSourceText, codeBlocks, techStack, raw: text }),
    formatSpec: explicitFormat,
    inputRules: [],
    requirements: { must, should, optional },
    constraints: deriveConstraints({ tone, lengthTarget, freePreferred, premium, country, deadline, urgent, techStack, academicLevel, citationStyle, raw: text }),
    forbidden,
    quality: deriveQuality(primary),
    successCriteria: [],
    unknowns: [],
    assumptions: [],
    conflicts,
    coverage,
    categoryMusts: primary.must || [],
    needsSources: Boolean(primary.needsSources || (allCats.some((c) => c.needsSources) && /\b(source|reference|citation|evidence|research|cite|study|studies)\b/i.test(text))),
    researchQuestion,
    options,
    selfContext,
    academicLevel,
    citationStyle,
    tone,
    lengthTarget,
    techStack,
    country,
    budget,
    deadline,
    urgent,
    freePreferred,
    premium,
    isBeginner,
    isExpert,
    media,
    wantsMachine,
    wantsTable,
    wantsSteps,
    styleSource,
    hasSourceText,
    injectedContent,
    codeBlocks,
    ast: { sentences: sents.length, words: countWords(text) },
  };

  return spec;
}

/* ───────────────────── sub-extractors ───────────────────── */

const TECH_FIX = { 'c++': 'C++', 'c#': 'C#', 'next.js': 'Next.js', golang: 'Go', '.net': '.NET', 'react native': 'React Native' };

function inferDeliverable(primary, allCats, folded) {
  const byCategory = {
    research: 'a structured research briefing with sourced findings',
    'web-research': 'a verified briefing on the current state of the question',
    academic: 'academic-quality written work that can be submitted after review',
    learning: 'a staged learning plan with explanations and practice',
    'exam-prep': 'revision material with questions, answers and mark-scheme logic',
    writing: 'a finished written piece',
    rewriting: 'the rewritten text, preserving meaning',
    editing: 'an edited version plus a list of the changes made',
    translation: 'the translated text, ready to use',
    summarization: 'a faithful summary in the requested form',
    analysis: 'an analytical breakdown with evidence and implications',
    comparison: 'a criteria-based comparison ending in a recommendation',
    decision: 'a decision brief ending in a recommendation and its flip conditions',
    planning: 'a sequenced, resource-aware plan',
    coding: 'working, complete code with the surrounding explanation',
    debugging: 'the root cause, the fix, and how to verify it',
    architecture: 'an architecture proposal with trade-offs made explicit',
    'data-analysis': 'findings, method, and the limits of what the data supports',
    mathematics: 'a fully worked solution with each step justified',
    science: 'an explanation grounded in the underlying mechanism',
    engineering: 'an engineering design with standards, units and tolerances stated',
    business: 'a decision-ready business document',
    entrepreneurship: 'an evaluated plan with the risks named',
    marketing: 'campaign-ready copy and the reasoning behind it',
    seo: 'an actionable SEO plan tied to search intent',
    'social-media': 'platform-native content, sized and formatted for the channel',
    presentation: 'a slide-by-slide deck outline with speaker notes',
    document: 'a structured document following the required sections',
    resume: 'an improved résumé or cover letter, truthfully framed',
    'interview-prep': 'practice questions, model answers and targeted feedback',
    career: 'a career plan with concrete next actions',
    productivity: 'a realistic system the user will actually sustain',
    'project-management': 'a delivery plan with dependencies and risks',
    travel: 'a practical itinerary with cost and time realism',
    finance: 'an analysis with assumptions and risks stated plainly',
    legal: 'an explanation of the position with jurisdiction limits flagged',
    health: 'information with clear boundaries and escalation guidance',
    'creative-writing': 'the finished creative piece',
    storytelling: 'a narrative with working structure and voice',
    'image-generation': 'a production-ready image prompt',
    'image-editing': 'a precise edit instruction set',
    'video-generation': 'a shot-based video prompt',
    audio: 'an audio/music specification ready for the target tool',
    'ui-ux': 'a design specification covering states, flows and accessibility',
    website: 'a build specification plus the implementation',
    'app-development': 'an app specification plus the implementation',
    'game-dev': 'a scoped game design plus implementation plan',
    automation: 'a working automation design with failure handling',
    'agent-design': 'a complete agent specification with tools, state and stop conditions',
    'ai-development': 'an ML plan with evaluation criteria and a baseline',
    'prompt-engineering': 'a validated prompt with its quality assessment',
    'meta-prompting': 'a reusable prompt generator',
    brainstorming: 'a filtered idea set with the strongest options developed',
    simulation: 'a scenario run with branch points and assumptions',
    roleplay: 'an interactive scenario with structured feedback',
    communication: 'a message the user can send as-is',
    devops: 'a runbook with rollback paths',
    'security-review': 'a prioritised findings list with fixes',
    'data-viz': 'a visualisation specification that makes the message clear',
    spreadsheet: 'formulas and structure the user can paste in',
    'general-qa': 'a direct, correct answer at the right depth',
    other: 'a complete deliverable for the stated objective',
  };
  const extra = allCats.find((c) => c.id !== primary.id && byCategory[c.id]);
  return byCategory[primary.id] || (extra ? byCategory[extra.id] : byCategory.other);
}

function cleanForbidden(sentence) {
  return cleanSentence(sentence)
    .replace(/^(?:please\s+)?(?:avoid|don'?t|do not|never|must not|should not|shouldn'?t|exclude|skip|refrain from)\s+/i, '')
    .replace(/^(?:any|the|all)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectAudience(text) {
  const m = text.match(AUDIENCE_RE);
  if (m && m[1]) {
    const a = m[1].trim().replace(/\s+/g, ' ').toLowerCase();
    if (a.split(' ').length <= 4) return a.replace(/^(?:my)\s+/, 'the user’s ');
  }
  const possessive = text.match(POSSESSIVE_AUDIENCE_RE);
  if (possessive) return possessive[1].toLowerCase().replace(/^my /, '').replace(/^(boss|manager|teacher|professor|lecturer|landlord|landlady|supervisor)$/, 'the user’s $1');
  return null;
}

function detectBudget(text) {
  const m = text.match(BUDGET_RE);
  if (!m) return null;
  const num = m[1].replace(/,/g, '');
  const mult = m[2] ? (m[2].toLowerCase().startsWith('k') || m[2] === 'thousand' ? '000' : '000000') : '';
  const currency = (text.match(/[$£€₹]/) || ['$'])[0];
  return `${currency}${num}${mult}`;
}

function detectMediaIntent(primary, text, folded) {
  const isImage = ['image-generation', 'image-editing'].includes(primary.id);
  const isVideo = primary.id === 'video-generation';
  if (!isImage && !isVideo) {
    if (/\b(image prompt|midjourney|dall-?e|stable diffusion|logo design|poster)\b/i.test(text)) return null;
    return null;
  }
  return {
    kind: isVideo ? 'video' : 'image',
    editing: primary.id === 'image-editing',
    raw: text,
  };
}

function detectOptions(text) {
  // Strip the question frame so the option phrases start at the real content.
  let t = text.replace(/^(?:so\s+|ok\s+|okay\s+|basically\s+)?/i, '');
  t = t.replace(/^(?:help me\s+)?(?:decide|choose|pick|work out)\s*(?:between|whether)?\s*/i, '');
  t = t.replace(/^(?:should|shall|do|does|can|could|would|will|is|are|am)\s+(?:i|we|you)\s+/i, '');
  t = t.replace(/^(?:i\s+(?:want|need|would like)\s+to\s+)/i, '');
  t = t.replace(/^(?:it be better to|better to)\s+/i, '');

  const clean = (s) => truncateWords(
    s.replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
      .replace(/\b(?:or|and|but|so|because|since|while)\b[\s\S]*$/i, '')
      .replace(/\s+/g, ' ').trim(), 12);

  const between = t.match(/\bbetween\s+(.{3,70}?)\s+and\s+(.{3,70}?)(?:[.?!]|$|\s+(?:but|so|because|i have|and i))/i);
  if (between) {
    const a = clean(between[1]); const b = clean(between[2]);
    if (a && b && a !== b) return [a, b];
  }

  const vs = t.split(/\s+(?:vs\.?|versus)\s+/i);
  if (vs.length === 2) {
    const a = clean(vs[0].split(/[.;]/).pop()); const b = clean(vs[1].split(/[.;]/)[0]);
    if (a && b && countWords(a) >= 1 && countWords(b) >= 1) return [a, b];
  }

  const or = t.match(/(.{3,80}?)\s+or\s+(.{3,80}?)(?:[.?!]|$)/i);
  if (or) {
    const a = clean(or[1].split(/[,;]/).pop() || '');
    const b = clean(or[2]);
    if (a && b && countWords(a) >= 2 && countWords(b) >= 1 && !/^(?:more|less|so|but|it|that|something)$/i.test(a)) return [a, b];
  }
  return [];
}

function detectSelfContext(sents) {
  const bits = [];
  for (const s of sents) {
    const c = cleanSentence(s);
    if (USER_SELF_RE.test(c) && countWords(c) <= 30) bits.push(c);
  }
  return bits.length ? truncateWords(bits.slice(0, 3).join('; '), 60) : null;
}

function detectFormat(text, { wantsMachine, wantsTable, wantsSteps, primary }) {
  if (wantsMachine && /\bjson\b/i.test(text)) return 'Return one valid JSON object, formatted for direct parsing.';
  if (wantsMachine && /\byaml\b/i.test(text)) return 'Return valid YAML, formatted for direct parsing.';
  if (wantsMachine && /\bcsv\b/i.test(text)) return 'Return CSV with a header row.';
  if (wantsTable || primary.fmt === 'table') return 'Return the core comparison as a markdown table, with prose only where a table would lose necessary nuance.';
  switch (primary.fmt) {
    case 'code': return 'Return complete, runnable code in fenced blocks with the language tagged, followed by a short explanation of the key decisions.';
    case 'slides': return 'Return a slide-by-slide outline: one block per slide with a title, 3–5 bullets, and speaker notes.';
    case 'document': return 'Return a structured document with headings, so sections can be lifted out individually.';
    case 'plan': return 'Return the plan as numbered phases, each with tasks, owner, and a checkable completion condition.';
    case 'decision-brief': return 'Return a decision brief: options table, then recommendation, then what would change it.';
    case 'build-spec': return 'Return the specification first (structure, data, states), then the files in order, each in its own code block.';
    case 'agent-spec': return 'Return the agent specification in labelled blocks: goal, inputs, tools, stages, decision points, verification, failure recovery, output.';
    case 'runbook': return 'Return numbered steps, each with the exact command and the expected result.';
    case 'structured-report': return 'Return a structured report with clear headings: findings first, then evidence, then implications, then limits.';
    case 'academic': return 'Return the work in academic structure with full citations where sources are used.';
    case 'bullets': return 'Return tight bullets — one idea per bullet, no nested filler.';
    case 'prose': return 'Return finished prose in the requested structure — no meta-commentary about the writing.';
    default: return null;
  }
}

function deriveConstraints(f) {
  const out = [];
  if (f.tone) out.push(`Write in a ${f.tone} register throughout.`);
  if (f.lengthTarget) out.push(`Respect the length target: ${f.lengthTarget}.`);
  if (f.techStack.length) out.push(`Stay within the stated stack (${f.techStack.join(', ')}) — do not introduce unrequested frameworks.`);
  if (f.freePreferred) out.push('Prefer free or low-cost options; if a paid tool is genuinely necessary, say why and give the free alternative.');
  if (f.premium) out.push('Quality matters more than cost here — recommend paid tools where they are clearly better.');
  if (f.deadline) out.push(`The user mentioned a deadline (${f.deadline}) — respect it and prioritise accordingly.`);
  else if (f.urgent) out.push('The user is under time pressure — front-load the fastest useful path, and mark anything that takes longer.');
  if (f.academicLevel) out.push(`Hold the standard expected at ${f.academicLevel} — not lower, not higher.`);
  if (f.citationStyle) out.push(`Use ${f.citationStyle} citation style consistently.`);
  if (f.country) out.push(`The user is in ${titleCase(f.country)} — prefer sources, regulations, pricing and examples relevant there.`);
  if (f.raw && /\bno ai|not sound (?:like|as) ai|sound human|human[- ]?written|natural|detect(?:able)? ai\b/i.test(f.raw)) {
    out.push('Write so the output reads as human-authored: vary sentence length, avoid tricolons and "delve/leverage/robust" filler, and never mention that AI was involved.');
  }
  if (/\b(cite|sources?|references?|evidence|proof)\b/i.test(f.raw)) out.push('Do not present a claim as established without saying what supports it.');
  return out;
}

function deriveQuality(primary) {
  const shared = ['Claims are specific and checkable, not generic filler.', 'Nothing important from the brief is silently dropped.'];
  const byGroup = {
    knowledge: ['Evidence quality is proportional to how much the answer matters.'],
    academic: ['Reasoning is explicit enough for a marker to follow without inference.'],
    engineering: ['The solution works in a real environment, not just in principle.'],
    business: ['Recommendations are tied to a measurable outcome.'],
    creative: ['The work has a consistent voice rather than generic phrasing.'],
    media: ['The output is directly usable in the target tool without editing.'],
    life: ['The advice is realistic given the user’s stated constraints.'],
    'high-stakes': ['Uncertainty and professional-verification needs are stated honestly.'],
  };
  return unique([...shared, ...(byGroup[primary.group] || byGroup.knowledge)]);
}

function withArticle(phrase) {
  const p = String(phrase || '').trim();
  if (!p) return p;
  if (/^(?:a|an|the)\s/i.test(p)) return p;
  return `${/^[aeiou]/i.test(p) ? 'an' : 'a'} ${p}`;
}

function deriveRoles(primary, allCats, { folded, isExpert, isBeginner, techStack, academicLevel }) {
  const roles = [`You are ${withArticle(primary.role)}.`];
  for (const c of allCats.slice(1, 3)) {
    if (c.role && !roles[0].includes(c.role)) roles.push(`You also bring the judgement of ${withArticle(c.role)}.`);
  }
  if (academicLevel && /Master|doctoral/i.test(academicLevel)) roles.push('You also bring the standards of a research supervisor: claims must be defensible and citations real.');
  if (isExpert) roles.push('You work with domain-level precision and skip beginner explanations.');
  if (isBeginner) roles.push('You are unusually good at making complex material click for newcomers.');
  if (techStack.length) roles.push(`You are fluent in ${techStack.slice(0, 4).join(', ')} and aware of their real-world pitfalls.`);
  return roles.slice(0, 4);
}

function deriveContext({ sents, audience, selfContext, country, deadline, urgent, constraints, objective }) {
  const out = [];
  if (selfContext) out.push(`The user's own description of their situation: ${selfContext}.`);
  if (audience) out.push(`The output is for ${audience}.`);
  if (country) out.push(`Relevant context: ${titleCase(country)}-specific conditions apply.`);
  if (deadline) out.push(`Time horizon: ${deadline}.`);
  else if (urgent) out.push('The user is working to a tight timeline.');
  const situational = sents.filter((s) => /\b(i (?:am|have|work|study|run|manage|need|live)|my (?:team|company|class|project|client|budget)|we (?:are|have))\b/i.test(s)).slice(0, 3);
  for (const s of situational) {
    const c = cleanSentence(s);
    // Skip the sentence that *is* the objective — it already appears above it.
    if (objective && similarity(c, objective) > 0.45) continue;
    if (/\?$/.test(c) || isQuestionLike(c)) continue;
    if (!out.some((o) => o.includes(c)) && countWords(c) <= 35) out.push(c.endsWith('.') ? c : c + '.');
  }
  return out.slice(0, 6);
}

function deriveInputs({ primary, hasSourceText, codeBlocks, techStack, raw }) {
  const inputs = [];
  if (hasSourceText) inputs.push('the material supplied in this message');
  if (codeBlocks.length) inputs.push(`${codeBlocks.length === 1 ? 'a code block' : `${codeBlocks.length} code blocks`} to work on`);
  // Only claim data will be supplied when the user points at actual data
  // (not, for example, when the job title is "data analyst").
  if (/\b(?:my|our|this|these|the|uploaded|attached)\s+(?:data|dataset|data ?set|spreadsheet|csv|excel file|table|numbers)\b/i.test(raw)
    && !/\bdata (?:analyst|scientist|engineer|science|role|job|internship|position)\b/i.test(raw)) {
    inputs.push('the data described or attached');
  }
  if (/\b(chat|conversation|transcript|thread|email chain)\b/i.test(raw)) inputs.push('the conversation text provided');
  if (/\b(screenshot|image|photo|picture)\b/i.test(raw)) inputs.push('the image provided');
  if (!inputs.length) inputs.push('no external material — work from this brief');
  return inputs;
}

function assessCoverage(primary, f) {
  const checks = {
    audience: Boolean(f.audience),
    tone: Boolean(f.tone),
    length: Boolean(f.lengthTarget),
    language: /\b(python|javascript|typescript|java|go|rust|php|ruby|kotlin|swift|sql|c\+\+|c#)\b/i.test(f.text) || !['coding', 'debugging'].includes(primary.id),
    environment: Boolean(f.techStack.length) || !['coding', 'debugging', 'devops'].includes(primary.id),
    region: Boolean(f.country) || !['legal', 'health', 'finance', 'travel'].includes(primary.id),
    budget: Boolean(f.budget) || !['travel', 'business', 'productivity', 'finance', 'website'].includes(primary.id),
    academicLevel: Boolean(f.academicLevel) || !['academic', 'exam-prep'].includes(primary.id),
    citationStyle: Boolean(f.citationStyle) || !['academic', 'research', 'web-research'].includes(primary.id),
    options: Boolean(f.options.length) || !['decision', 'comparison'].includes(primary.id),
    visualStyle: Boolean(f.media) && /\b(style|photo|realistic|anime|cinematic|illustration|watercolou?r|3d|minimal|render)\b/i.test(f.text) || !f.media,
  };
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return { checks, missing };
}

function detectConflicts({ text, tone, lengthTarget, freePreferred, premium, isBeginner, isExpert, must, should }) {
  const conflicts = [];
  if (freePreferred && premium) conflicts.push('free/low-cost preferred, but premium quality was also requested');
  if (isBeginner && isExpert) conflicts.push('beginner framing and expert depth were both requested');
  if (lengthTarget && /concise|very short|no padding/i.test(lengthTarget) && must.length >= 6) conflicts.push(`"${lengthTarget}" output but ${must.length} hard requirements to cover`);
  if (/\b(short|brief|concise)\b/i.test(text) && /\b(detailed|comprehensive|thorough|exhaustive|everything)\b/i.test(text)) conflicts.push('short and exhaustive were both requested');
  if (/\b(fast|quick|asap|tonight|today)\b/i.test(text) && /\b(perfect|comprehensive|research|thorough|careful)\b/i.test(text)) conflicts.push('speed and thoroughness were both requested');
  if (/\b(don'?t|do not|never)\b/i.test(text) && /\b(include|cover|mention|explain)\b/i.test(text) && /\b(same|same thing|that same)\b/i.test(text)) conflicts.push('an instruction and its apparent negation overlap');
  return unique(conflicts);
}
