/**
 * Strategy selection engine.
 *
 * Chooses the smallest set of techniques that materially improves this task,
 * within a budget derived from task complexity and target context. Techniques
 * are gated by target capability, filtered by applicability, scored by evidence
 * in the request itself, then rendered into instruction text.
 *
 * It also derives the structured strategy payload the templates consume:
 * plan stages, rubric, decision criteria, perspectives, budgets, tool lists.
 */

import { TECHNIQUES } from '../knowledge/techniques.mjs';
import { CATEGORY_INDEX } from '../knowledge/taxonomy.mjs';
import { can } from '../knowledge/targets.mjs';
import { unique } from '../util/text.mjs';

/* ── evidence: user-text signals that make a technique specifically relevant ── */
const EVIDENCE = {
  comparative: /\b(compare|versus|vs\.?|better than|trade[- ]?offs?|alternatives?)\b/i,
  decisionFramework: /\b(decide|decision|choose|should i|options?|undecided|dilemma)\b/i,
  verification: /\b(verify|accurate|correct|precise|proof|double[- ]check|must be right)\b/i,
  citationRules: /\b(cite|citation|reference|source|bibliography|apa|mla|ieee|harvard)\b/i,
  factCheck: /\b(fact|accurate|true|verify|proof|evidence|statistics|data)\b/i,
  retrieval: /\b(latest|current|recent|today|news|2024|2025|2026|up[- ]to[- ]date|right now)\b/i,
  rag: /\b(based on (?:this|the) (?:document|text|file|data)|according to the (?:document|text|data)|from (?:this|the) (?:paper|article|transcript))\b/i,
  schemaOutput: /\b(json|yaml|schema|api|parse|structured data|machine[- ]readable|fields?)\b/i,
  structuredOutput: /\b(table|format|structure|sections?|headings?|bullets?|columns?|template)\b/i,
  fewShot: /\b(example|like this|same style|in the style of|sample|following format)\b/i,
  selfCritique: /\b(quality|high[- ]quality|best|professional|excellent|perfect|rigorous|polished)\b/i,
  subagent: /\b(agent|automate|pipeline|workflow|orchestrat)\b/i,
  multiPerspective: /\b(stakeholders?|perspectives?|both sides|for and against|pros and cons|different angles?)\b/i,
  premortem: /\b(risks?|fail|failure|what could go wrong|mitigat|contingency)\b/i,
  hypothesisTesting: /\b(why (?:does|is|did)|root cause|diagnose|troubleshoot|not working|broken)\b/i,
  decomposition: /\b(complex|multi[- ]?step|end[- ]to[- ]end|everything|whole (?:project|system))\b/i,
  imageRecipe: /\b(image|picture|photo|logo|poster|illustration|render)\b/i,
  videoRecipe: /\b(video|clip|animation|footage|scene|shot)\b/i,
  metaPrompt: /\b(prompt|generator|template|reusable|system)\b/i,
  toolUse: /\b(search|api|tool|browse|database|files?|run)\b/i,
  workedExample: /\b(step[- ]by[- ]step|explain how|show me how|tutorial|solve|walk ?through)\b/i,
  socratic: /\b(learn|teach|understand|study|revise|practice)\b/i,
  generationFiltering: /\b(ideas?|brainstorm|options?|suggest|possibilities|alternatives?)\b/i,
  branchSelect: /\b(creative|story|design|concept|direction|style)\b/i,
  simulation: /\b(what if|scenario|simulate|play out|outcome)\b/i,
  uncertaintyCalibration: /\b(advice|recommend|should i|risk|important|serious)\b/i,
  outputPurity: /\b(copy|paste|ready[- ]to[- ]use|just the|only the|directly)\b/i,
  debate: /\b(debate|argue|both sides|disagree|opposing)\b/i,
  expertPanel: /\b(panel|experts|multidisciplinary|committee|review board)\b/i,
  agentic: /\b(agent|autonomous|automate|workflow|pipeline|loop)\b/i,
  chainOfTasks: /\b(first[\s\S]{0,60}then|stage|phase|pipeline|step \d)\b/i,
};

/** Families that must be represented at each complexity level if applicable. */
const REQUIRED_FAMILIES = {
  1: [],
  2: ['quality'],
  3: ['quality', 'evaluation'],
  4: ['quality', 'evaluation', 'process'],
  5: ['quality', 'evaluation', 'process', 'reasoning'],
};

const COST_BUDGET = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 11 };

/** Choose techniques and return them with rendered instruction text. */
export function selectTechniques(ctx) {
  const { analysis, flags, target, complexity, modes } = ctx;
  const folded = analysis.categories.folded;

  let budget = COST_BUDGET[complexity.level] ?? 4;
  if (flags.quick) budget = Math.max(2, Math.round(budget * 0.6));
  if (modes.wantsAdvanced) budget += 2;
  if (target.style?.contextBudget && target.style.contextBudget < 9000) budget = Math.max(2, budget - 1); // small models: shorter prompts win
  if (analysis.categories.primary.fmt === 'image-prompt' || flags.media) budget = Math.min(budget, 4);

  const defaults = new Set(unique([...(analysis.categories.primary.tech || []), ...analysis.categories.secondary.flatMap((c) => c.tech || [])]));

  const scored = [];
  for (const t of TECHNIQUES) {
    if (t.ownership === 'architecture') continue;
    if (t.requires && !t.requires.every((r) => can(target, r))) continue;
    if (t.applies && !t.applies(ctx)) continue;
    let ok;
    try { ok = t.when ? t.when(ctx) : true; } catch { ok = false; }
    if (!ok) continue;
    if (t.levels && (complexity.level < t.levels[0] || complexity.level > t.levels[1])) {
      // Out of band, but still allow when the task explicitly demands it.
      const ev = EVIDENCE[t.id];
      if (!(ev && ev.test(folded))) continue;
    }

    let score = 1;
    if (defaults.has(t.id)) score += 1.4;
    const ev = EVIDENCE[t.id];
    if (ev && ev.test(folded)) score += 1.2;
    if (t.family === 'evaluation' && flags.requiresVerification) score += 0.5;
    if (t.family === 'structure' && flags.wantsMachine) score += 0.4;
    if (complexity.level >= 4 && t.family === 'process') score += 0.3;
    if (flags.media && t.family !== 'media' && t.family !== 'quality') score -= 1.4;
    score -= (t.cost - 1) * 0.25;

    scored.push({ technique: t, score: score + 1 });
  }

  scored.sort((a, b) => b.score - a.score || a.technique.cost - b.technique.cost);

  const chosen = [];
  const families = new Set();
  let spent = 0;
  for (const { technique } of scored) {
    if (spent + technique.cost > budget) continue;
    if (families.has(technique.family) && technique.family === 'media') continue;
    chosen.push(technique);
    families.add(technique.family);
    spent += technique.cost;
    if (spent >= budget) break;
  }

  // Guarantee the required families for this complexity level.
  for (const fam of REQUIRED_FAMILIES[complexity.level] || []) {
    if (families.has(fam)) continue;
    const fill = scored.find(({ technique }) => technique.family === fam);
    if (fill) { chosen.push(fill.technique); families.add(fam); }
  }

  // Render instruction text with the fully-populated context.
  // Each rendered line is registered against the technique that produced it, so
  // the final prompt can be traced line by line (see provenance.mjs).
  ctx.techniqueLines = ctx.techniqueLines || new Map();
  return chosen.map((t) => {
    let rendered = [];
    try { rendered = t.render(ctx) || []; } catch { rendered = []; }
    for (const line of rendered) {
      if (line && !ctx.techniqueLines.has(line)) ctx.techniqueLines.set(line, t);
    }
    return { ...t, rendered: rendered.filter(Boolean), selected: true };
  });
}

/* ───────────────────── derived strategy payload ───────────────────── */

const PLAN_BY_CATEGORY = {
  research: ['Frame the research question precisely', 'Gather candidate sources', 'Assess each source for quality and recency', 'Map where sources agree and where they contradict', 'Synthesise the position into a defensible answer', 'State the limits of what the evidence supports'],
  'web-research': ['Restate the question as something checkable', 'Search broadly first, then narrow', 'Verify each key claim against a second independent source', 'Resolve contradictions explicitly', 'Deliver the answer with dates and source links'],
  academic: ['Clarify the question being answered and the standard required', 'Assemble the argument structure', 'Support each claim with evidence', 'Address the strongest counter-argument', 'Conclude without overclaiming', 'Check citation completeness'],
  coding: ['Restate the requirement as an input/output contract', 'Identify edge cases and failure modes', 'Choose the simplest approach that satisfies the constraints', 'Implement it completely', 'Check it against the edge cases', 'Explain the non-obvious decisions'],
  debugging: ['Establish the symptom from the evidence given', 'Rank probable causes', 'Identify the cheapest discriminating test', 'Apply the fix that addresses the cause', 'State how to verify and what to watch for', 'Note remaining uncertainty'],
  website: ['Define the users and the one job the page must do', 'Fix the information architecture', 'Specify layout and states, including empty and error states', 'Implement with accessibility and responsiveness built in', 'Verify against the performance and accessibility bar'],
  'data-analysis': ['State what the data is and what it can and cannot answer', 'Clean and check before analysing', 'Analyse with the simplest appropriate method', 'Quantify uncertainty', 'Report findings with their limits attached'],
  decision: ['Frame the decision and its reversibility', 'Set criteria and weights before comparing', 'Gather evidence for each option against each criterion', 'Surface the assumptions each option depends on', 'Recommend, and state what would change the recommendation'],
  business: ['State the objective in measurable terms', 'Assess the present situation honestly', 'Identify the few moves that matter most', 'Sequence them with owners and timing', 'Name the risks and the early warning signs'],
  planning: ['Clarify the end state', 'Work backwards to the phases', 'Assign realistic durations including slack', 'Identify dependencies and critical path', 'Add checkpoints and a recovery path'],
  'agent-design': ['Define the goal and the definition of done', 'Enumerate available tools and their limits', 'Specify the state carried between steps', 'Set stop conditions and budgets', 'Define failure recovery and escalation'],
  'image-generation': ['Identify the subject and the action', 'Fix composition and framing', 'Specify lighting and atmosphere', 'Choose style, medium and colour direction', 'Add camera/optics detail', 'State exclusions and technical parameters'],
  'video-generation': ['Break the idea into shots', 'Define camera and subject motion per shot', 'Lock lighting, palette and continuity', 'Specify audio or dialogue needs', 'State duration and transitions'],
};

const GENERIC_PLAN = ['Restate the objective and the success condition', 'Identify what matters most and what can be skipped', 'Produce the deliverable', 'Check it against every requirement before returning it'];

export function deriveStrategyPayload(ctx) {
  const { analysis, spec, flags, target, complexity } = ctx;
  const primary = analysis.categories.primary;
  const id = primary.id;
  const level = complexity.level;

  const planFull = PLAN_BY_CATEGORY[id] || GENERIC_PLAN;
  const stageCount = level <= 2 ? Math.min(3, planFull.length) : level === 3 ? Math.min(5, planFull.length) : planFull.length;
  const planStages = planFull.slice(0, Math.max(3, stageCount));

  const rubricItems = buildRubric({ primary, spec, flags, complexity });
  const criteria = buildCriteria({ id, spec, raw: spec.objective });
  const perspectives = buildPerspectives(id);
  const threatFocus = buildThreatFocus(id, spec);
  const delimiterStyle = buildDelimiters(target, flags, spec);
  const schema = flags.wantsMachine && !spec.media ? buildSchema(spec) : null;

  const budget = {
    steps: level >= 5 ? 12 : level === 4 ? 8 : 5,
    retries: 1,
    stopConditions: unique([
      'the deliverable is complete and verified against the requirements',
      'the next step needs information only the user can provide',
      level >= 4 ? 'two consecutive steps produced no new information' : null,
      'the cost or risk of continuing exceeds the value of the remaining work',
    ]),
  };

  const chain = planStages.map((s, i) => `${i + 1}. ${s}`);
  const agentRoles = buildAgentRoles(id);
  const availableTools = buildTools(target, id, flags);
  const panelRoles = buildPanelRoles(id);
  const { quantityTarget, filterCriteria } = buildGenerationParams(id, spec, flags);

  return {
    planStages,
    rubricItems,
    criteria,
    perspectives,
    threatFocus,
    delimiterStyle,
    schema,
    budget,
    chain,
    agentRoles,
    availableTools,
    panelRoles,
    panelSize: panelRoles.length,
    quantityTarget,
    filterCriteria,
    factCheckCount: level >= 4 ? 5 : 3,
  };
}

function buildRubric({ primary, spec, flags, complexity }) {
  const items = [
    { name: 'Requirement coverage', test: 'every MUST in the brief is visibly satisfied by the deliverable, not merely gestured at' },
    { name: 'Specificity', test: 'no sentence survives that could have been written for any similar request' },
    { name: 'Output contract', test: 'the response matches the requested format, structure and length exactly' },
    { name: 'Usability', test: 'the user can act on this without a further round of translation work' },
  ];
  if (flags.needsSources) items.push({ name: 'Evidence discipline', test: 'every factual claim is either sourced, derived from the supplied material, or explicitly marked as an assumption' });
  if (complexity.level >= 3) items.push({ name: 'Honesty about limits', test: 'uncertainty, gaps and assumptions are stated rather than smoothed over' });
  if (['coding', 'debugging', 'website', 'app-development', 'devops', 'automation'].includes(primary.id)) items.push({ name: 'Correctness under run', test: 'the code runs as written, handles the stated edge cases, and contains no unused or missing pieces' });
  if (['creative-writing', 'writing', 'marketing', 'social-media', 'communication'].includes(primary.id)) items.push({ name: 'Voice consistency', test: 'the register stays constant and reads as written by one person' });
  if (flags.academicLevel) items.push({ name: 'Marker-readiness', test: `work holds up at ${flags.academicLevel} without needing defensive explanation` });
  if (spec.audience) items.push({ name: 'Audience fit', test: `vocabulary and assumed knowledge match ${spec.audience}` });
  return items.slice(0, 6);
}

function buildCriteria({ id, spec }) {
  if (spec.options?.length > 1) {
    return [
      { name: 'Fit with the stated objective', weight: 30 },
      { name: 'Cost in money and time', weight: 20 },
      { name: 'Risk and reversibility', weight: 20 },
      { name: 'Fit with the stated constraints', weight: 15 },
      { name: 'Speed to first real result', weight: 15 },
    ];
  }
  const byCategory = {
    comparison: [['How well it fits the actual requirement', 30], ['Learning curve', 15], ['Ecosystem and long-term support', 20], ['Cost', 15], ['Maintenance and operational burden', 20]],
    decision: [['Alignment with the objective', 30], ['Downside risk if wrong', 25], ['Cost of switching or reversing', 20], ['Time to payoff', 15], ['Fit with existing constraints', 10]],
    coding: [['Correctness under real inputs', 30], ['Simplicity of the solution', 20], ['Performance where it matters', 15], ['Maintainability', 20], ['Dependency footprint', 15]],
  };
  const raw = byCategory[id] || byCategory.decision;
  return raw.map(([name, weight]) => ({ name, weight }));
}

function buildPerspectives(id) {
  const map = {
    decision: ['the user’s short-term interests', 'their long-term interests (what they will want in two years)', 'the person who bears the downside if it goes wrong', 'the option nobody is currently arguing for'],
    business: ['the customer', 'the operator who has to deliver it', 'the finance owner', 'the competitor who wants you to fail'],
    career: ['the user’s own definition of success', 'a hiring manager reading this in 20 seconds', 'the version of the user five years older', 'the person who depends on the user’s stability'],
    finance: ['capital preservation', 'growth', 'liquidity needs', 'the worst realistic case'],
    comparison: ['a heavy daily user', 'a beginner in month one', 'the person who maintains it at 2am', 'the person paying the bill'],
    'ui-ux': ['a first-time user', 'a user on a slow phone', 'a user with a disability', 'the business owner measuring conversion'],
    research: ['the strongest proponent', 'the strongest critic', 'the methodologist', 'the practitioner applying it'],
    'security-review': ['an external attacker', 'an insider with limited rights', 'the on-call engineer at 3am', 'the auditor asking for evidence'],
    'prompt-engineering': ['the prompt author', 'the model executing it', 'a user who will send unexpected input', 'an attacker attempting injection'],
  };
  return map[id] || ['the primary user', 'the person affected by the outcome', 'the expert who would critique this'];
}

function buildThreatFocus(id, spec) {
  const map = {
    'security-review': 'the highest-impact realistic attack paths first, then the ones that are easy to automate',
    'agent-design': 'runaway loops, tool misuse, prompt injection through tool output, and irreversible actions',
    'prompt-engineering': 'ambiguous input, injected instructions, missing output contract, and inputs that fall outside the declared scope',
    architecture: 'load, failure of dependencies, data integrity, and operational complexity',
    devops: 'secret exposure, blast radius, rollback failure, and single points of failure',
    website: 'untrusted input, authentication boundaries, data exposure, and accessibility regressions',
    legal: 'the clauses that are unenforceable in the relevant jurisdiction and the obligations that are easy to miss',
  };
  return map[id] || 'the assumptions most likely to be wrong in the user’s real situation';
}

function buildDelimiters(target, flags, spec) {
  if (target.style?.promptFormat === 'xml') return 'XML tags such as <source_text>, <data> and <example>';
  if (flags.wantsMachine) return 'fenced blocks labelled with their content type';
  if (spec.codeBlocks?.length) return 'fenced code blocks with the language labelled';
  return 'clearly labelled fenced blocks (e.g. ```text, ```code, ```data) or --- separators';
}

function buildSchema(spec) {
  const fields = [];
  const raw = spec.objective + ' ' + (spec.topic || '');
  if (/\b(list|items|bullet|points?)\b/i.test(raw)) fields.push({ key: 'items', type: 'string[]', note: 'the deliverable items, in the requested order' });
  if (/\b(score|rating|rank)\b/i.test(raw)) fields.push({ key: 'score', type: 'number', note: '0–100, calibrated rather than inflated' });
  if (/\b(reason|why|rationale|explain)\b/i.test(raw)) fields.push({ key: 'rationale', type: 'string', note: 'one paragraph justifying the result' });
  if (/\b(risk|issue|problem)\b/i.test(raw)) fields.push({ key: 'risks', type: 'string[]', note: 'each with an impact estimate' });
  fields.push({ key: 'confidence', type: '"high" | "medium" | "low"', note: 'how certain the answer is, given the information available' });
  fields.push({ key: '_warnings', type: 'string[]', note: 'anything assumed, missing or unverifiable' });
  return Object.fromEntries(fields.map((f) => [f.key, f.type]));
}

function buildAgentRoles(id) {
  const map = {
    research: ['scout — gathers and grades sources', 'analyst — synthesises the evidence', 'verifier — attacks the synthesis and checks citations', 'writer — produces the final briefing'],
    website: ['spec — turns the brief into requirements', 'builder — implements the core', 'critic — reviews accessibility, performance and states', 'integrator — applies fixes and assembles the handover'],
    'prompt-engineering': ['architect — designs the prompt', 'tester — generates adversarial inputs', 'repairer — closes the gaps found', 'documenter — explains the final prompt'],
    business: ['researcher — gathers market facts', 'strategist — proposes the plan', 'skeptic — attacks the assumptions', 'writer — produces the decision document'],
    'app-development': ['planner — defines the product surface', 'engineer — implements', 'tester — covers edge cases and failures', 'reviewer — checks scope and quality'],
  };
  return map[id] || ['planner', 'producer', 'critic', 'integrator'];
}

function buildTools(target, id, flags) {
  const tools = [];
  if (can(target, 'webSearch')) tools.push('web search (for anything time-sensitive or externally verifiable)');
  if (can(target, 'codeExec')) tools.push('code execution (for computation, parsing or checking output)');
  if (can(target, 'vision')) tools.push('image understanding (for supplied screenshots or diagrams)');
  if (can(target, 'fileUpload')) tools.push('uploaded files (as primary source material)');
  if (can(target, 'toolUse') && id === 'automation') tools.push('the specific integrations named in the brief');
  return tools.length ? tools : ['none beyond conversation — do not invent tools'];
}

function buildPanelRoles(id) {
  const map = {
    business: ['the operator who must deliver', 'the customer', 'the finance owner', 'the sceptical board member'],
    'security-review': ['the application security engineer', 'the attacker', 'the compliance owner'],
    career: ['the recruiter', 'the hiring manager', 'the domain expert', 'the career coach'],
    academic: ['the subject expert', 'the methodologist', 'the examiner', 'the critic'],
    decision: ['the advocate', 'the risk owner', 'the domain expert', 'the neutral chair'],
  };
  return map[id] || ['the domain expert', 'the practitioner', 'the sceptic', 'the chair'];
}

function buildGenerationParams(id, spec, flags) {
  const quantity = spec.requirements.optional.length >= 2 || id === 'brainstorming' ? 12 : 8;
  const filter = id === 'marketing'
    ? 'does it speak to the stated audience’s actual problem, and is it distinct from what competitors already say'
    : id === 'creative-writing'
      ? 'is it specific and surprising rather than familiar, and does it serve the stated theme'
      : 'does it genuinely fit the stated constraints, and is it meaningfully different from the other candidates';
  return { quantityTarget: quantity, filterCriteria: filter };
}

/* ───────────────────── flags ───────────────────── */

/** Derive the boolean feature flags templates and techniques rely on. */
export function deriveFlags({ analysis, spec, target, modes, clarity }) {
  const primary = analysis.categories.primary;
  const secondary = analysis.categories.secondary.map((c) => c.id);
  const all = [primary.id, ...secondary];
  const targetHasSearch = can(target, 'webSearch');
  const targetHasTools = can(target, 'toolUse');
  const targetAgentic = Boolean(target.style?.agentic);

  const media = spec.media?.kind || null;
  const highStakesCats = ['legal', 'health', 'finance'];
  const highStakes = all.some((c) => highStakesCats.includes(c)) || Boolean(primary.highStakes);

  return {
    /* capability of the target */
    caps: target.caps,
    targetHasSearch,
    targetHasTools,
    targetAgentic,
    caps_list: Object.entries(target.caps).filter(([, v]) => v).map(([k]) => k),

    /* task character */
    media,
    isAcademic: all.includes('academic') || Boolean(primary.academic),
    isLearning: all.includes('learning') || all.includes('exam-prep'),
    creativeOutput: Boolean(primary.creative) || all.some((c) => CATEGORY_INDEX[c]?.creative),
    highStakes,
    defensiveSecurity: all.includes('security-review'),
    domain: all.includes('health') ? 'health' : all.includes('legal') ? 'legal' : all.includes('finance') ? 'finance' : null,
    academicLevel: spec.academicLevel,
    citationStyle: spec.citationStyle,

    /* input character */
    hasSourceText: spec.hasSourceText,
    longInput: spec.ast.words > 700,
    untrustedData: spec.hasSourceText && all.some((c) => ['research', 'web-research', 'academic', 'summarization', 'legal', 'editing', 'translation', 'document'].includes(c)),
    wantsGrounded: spec.hasSourceText && /\b(based on|according to|from (?:the|this)|using (?:the|this)|in (?:the|this) (?:text|document|data))\b/i.test(spec.objective + ' ' + spec.context.join(' ')),

    /* information needs */
    needsSources: spec.needsSources,
    needsVerification: ['coding', 'debugging', 'mathematics', 'data-analysis', 'finance', 'legal', 'health', 'academic', 'research', 'web-research', 'seo', 'security-review', 'ai-development', 'engineering', 'architecture', 'presentation', 'devops'].includes(primary.id) || spec.needsSources,
    requiresVerification: spec.ast.words > 120 || spec.requirements.must.length >= 4,

    /* output character */
    wantsMachine: spec.wantsMachine,
    wantsTable: spec.wantsTable,
    wantsSteps: spec.wantsSteps,
    wantsAnswerOnly: /\b(?:just|only)\s+(?:the\s+)?(?:answer|solution|code|result|number)\b|\bno explanation\b|\banswer only\b/i.test(spec.objective + ' ' + analysis.intent.verbatim),
    copyReady: modes.promptOnly || modes.has('copy'),
    quick: modes.has('quick'),
    outputRules: [],

    /* personalisation */
    isBeginner: spec.isBeginner || modes.has('beginner'),
    isExpert: spec.isExpert || modes.has('expert'),
    expertMode: spec.isExpert || modes.has('expert') || primary.id === 'ai-development',
    roleplayRequested: primary.id === 'roleplay' || /\b(roleplay|role play|pretend you are|act as my)\b/i.test(analysis.intent.verbatim),
    providesExamples: /\b(for example|e\.g\.|like this|following example|example:)\b/i.test(analysis.intent.verbatim),
    styleMatch: spec.styleSource,
    classification: /\b(classif|categori[sz]e|label|tag|sentiment|extract (?:the )?(?:fields|entities))\b/i.test(analysis.intent.verbatim),
    timePrecious: spec.urgent || Boolean(spec.deadline),
    tone: spec.tone,
    lengthTarget: spec.lengthTarget,
    extraProcess: null,
    extraVerification: [],
    qualityGate: null,
    // Finite, user-stated facts only — derived constraints live in the CONSTRAINTS section.
    constraintFacts: [
      spec.deadline ? `a deadline of ${spec.deadline}` : spec.urgent ? 'limited time' : null,
      spec.budget ? `a budget around ${spec.budget}` : null,
      spec.freePreferred ? 'a preference for free/low-cost solutions' : null,
      spec.techStack.length ? `existing tooling: ${spec.techStack.slice(0, 4).join(', ')}` : null,
    ].filter(Boolean),
    country: spec.country,
    budget: spec.budget,
    techStack: spec.techStack,
    language: detectLanguage(spec),

    /* project character */
    largeProject: /\b(full|complete|entire|end[- ]to[- ]end|production|launch|from scratch)\b/i.test(analysis.intent.verbatim) && ['website', 'app-development', 'agent-design', 'business', 'game-dev'].includes(primary.id),
    asksImpossible: false,
    relationship: detectRelationship(analysis.intent.verbatim),
    avoidSaying: [],
    sourceStandard: flags_sourceStandard(primary.id),
    recency: spec.needsSources ? (/last (?:12 )?months|this year|recent/i.test(analysis.intent.verbatim) ? '12 months' : '3 years') : null,
    environment: null,
    depsPolicy: null,
    asksPromise: false,
    questionFirst: clarity.askFirst,
  };
}

function flags_sourceStandard(id) {
  if (id === 'academic') return 'peer-reviewed literature and primary data first, with no reliance on undated web summaries';
  if (['research', 'web-research'].includes(id)) return 'official documentation, first-party data and peer-reviewed work first';
  if (id === 'legal') return 'statute and regulator guidance first, commentary only as a pointer';
  if (id === 'health') return 'clinical guidance bodies and peer-reviewed medicine first';
  return null;
}

function detectLanguage(spec) {
  const m = (spec.objective + ' ' + spec.context.join(' ')).match(/\b(?:in|into)\s+(english|spanish|french|german|italian|portuguese|dutch|hindi|urdu|bengali|arabic|chinese|japanese|korean|russian|turkish|tamil|telugu|marathi|punjabi|swahili)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

function detectRelationship(text) {
  const m = text.match(/\b(my (?:boss|manager|client|customer|professor|lecturer|teacher|colleague|teammate|friend|partner|landlord|landlady|employee|supplier|vendor))\b/i);
  return m ? `${m[1]} — a relationship where tone carries real consequences`.replace(/^my /i, 'the user’s ') : null;
}

export { COST_BUDGET, EVIDENCE };
