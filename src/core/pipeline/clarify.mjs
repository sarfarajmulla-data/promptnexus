/**
 * Smart clarification.
 *
 * Rule: ask only when the missing information would materially change the
 * generated prompt. Everything else becomes a labelled assumption inside the
 * prompt. Questions are capped, grouped, and always come with selectable
 * options plus a default — the user can answer, or ignore them entirely and
 * keep the prompt they already have.
 */

import { listOut } from '../util/text.mjs';

/** Nothing to ask when the user has told us to just get on with it. */
const PROCEED_RE = /\b(just do (?:it|your best)|you decide|your (?:call|choice)|surprise me|whatever you think|use your judgement|use your judgment|don'?t ask|no questions|i don'?t know|not sure|figure it out|make it up)\b/i;

const QUESTION_BANK = {
  coding: [
    { id: 'language', when: (s) => !s.coverage.checks.language, q: 'Which language and version should the code target?', options: ['Python 3.12', 'JavaScript / TypeScript (Node 20+)', 'Java 21', 'C++', 'SQL', 'Other — tell me'], impact: 'high', default: 'the most widely used option for this task' },
    { id: 'environment', when: (s) => !s.coverage.checks.environment, q: 'Where will this run?', options: ['Local machine only', 'Docker / container', 'Cloud (AWS/GCP/Azure)', 'Existing codebase — match its conventions', 'Not decided yet'], impact: 'medium', default: 'a portable, dependency-light setup' },
    { id: 'testlevel', when: () => true, q: 'How much testing do you want alongside the code?', options: ['None — just the code', 'Basic sanity checks', 'Unit tests included', 'Full test suite with edge cases'], impact: 'medium', default: 'basic sanity checks plus edge-case notes' },
  ],
  debugging: [
    { id: 'error', when: (s) => !/error|exception|traceback|stack ?trace|failed|failing|crash/i.test(s.raw || ''), q: 'What exactly happens when it fails?', options: ['Error message shown', 'Silent wrong result', 'Crashes / hangs', 'Works sometimes', 'I only know it is broken'], impact: 'high', default: 'no error output available' },
    { id: 'env', when: (s) => !s.techStack?.length, q: 'What is the runtime environment?', options: ['Node.js', 'Python', 'Browser / front-end', 'Mobile', 'Server / OS level'], impact: 'high', default: 'unspecified — include environment checks in the diagnosis' },
  ],
  writing: [
    { id: 'audience', when: (s) => !s.audience, q: 'Who is the reader?', options: ['General public', 'Professionals in the field', 'Academic / examiner', 'A single person (client, boss, colleague)', 'Internal team'], impact: 'high', default: 'an informed non-specialist reader' },
    { id: 'length', when: (s) => !s.lengthTarget, q: 'How long should it be?', options: ['Under 250 words', '300–600 words', '800–1,200 words', '1,500+ words', 'As long as it needs to be'], impact: 'high', default: 'the shortest length that fully covers the brief' },
    { id: 'tone', when: (s) => !s.tone, q: 'Which tone fits?', options: ['Professional', 'Academic', 'Friendly and natural', 'Persuasive', 'Plain and simple'], impact: 'medium', default: 'professional and direct' },
  ],
  academic: [
    { id: 'level', when: (s) => !s.academicLevel, q: 'What academic level is this marked at?', options: ['High school / A-level', 'First-year undergraduate', 'Final-year undergraduate', 'Master’s', 'Doctoral'], impact: 'high', default: 'final-year undergraduate' },
    { id: 'citation', when: (s) => !s.citationStyle, q: 'Which citation style is required?', options: ['APA 7', 'Harvard', 'IEEE', 'MLA 9', 'Chicago', 'None required'], impact: 'high', default: 'APA 7' },
    { id: 'marks', when: (s) => !/marks?|grade|rubric|criteria|weight/i.test(s.raw || ''), q: 'Is there a mark scheme or rubric I should aim at?', options: ['Yes — I will paste it', 'No rubric given', 'Just aim for a strong answer', 'It is graded on originality'], impact: 'medium', default: 'assume a standard higher-education rubric' },
  ],
  research: [
    { id: 'depth', when: () => true, q: 'How deep should the research go?', options: ['Quick scan of the main positions', 'Standard review — 5–10 sources', 'Deep review with methodology comparison', 'Systematic-style review'], impact: 'medium', default: 'a standard review of 5–10 credible sources' },
    { id: 'recency', when: () => true, q: 'How recent must the sources be?', options: ['Last 12 months', 'Last 3 years', 'Last 10 years', 'No limit — include foundational work'], impact: 'high', default: 'the last three years, with older work included where foundational' },
  ],
  decision: [
    { id: 'options', when: (s) => !s.options?.length, q: 'What are the options you are choosing between?', options: ['Just two — I will name them', 'Three or more', 'I do not have options yet — find them', 'I have one option and want to know if it is right'], impact: 'high', default: 'the strongest options identified by the assistant' },
    { id: 'constraints', when: (s) => !s.budget && !s.deadline, q: 'What limits the decision?', options: ['Money', 'Time / deadline', 'Skills or ability', 'Location / availability', 'Other people involved', 'Nothing major'], impact: 'high', default: 'time and cost are both limited' },
  ],
  travel: [
    { id: 'dest', when: (s) => !/\b(to|in|visit|travel(?:ling)? to)\s+[A-Z][a-z]+/m.test(s.raw || ''), q: 'Where are you going (and from where)?', options: ['I will type both', 'Domestic trip', 'International trip', 'Not decided — suggest places'], impact: 'high', default: 'destination unspecified — ask before planning specifics' },
    { id: 'budget', when: (s) => !s.budget, q: 'What is the budget?', options: ['Backpacker / minimal', 'Mid-range', 'Comfortable', 'Luxury', 'Not a constraint'], impact: 'high', default: 'mid-range' },
    { id: 'dates', when: (s) => !s.deadline, q: 'When, and for how long?', options: ['This month', 'In 1–3 months', 'Later this year', 'Dates not fixed yet'], impact: 'high', default: 'flexible dates, three to five days' },
  ],
  image: [
    { id: 'style', when: (s) => !/\b(photo|realistic|anime|cinematic|illustration|painting|3d|minimal|watercolou?r|render|vector|pixel)\b/i.test(s.raw || ''), q: 'What visual style do you want?', options: ['Photorealistic', 'Cinematic film still', 'Digital illustration', 'Flat vector / minimal', 'Watercolour', '3D render'], impact: 'high', default: 'photorealistic with cinematic lighting' },
    { id: 'aspect', when: (s) => !/\b(16:9|9:16|1:1|4:3|3:2|2:3|portrait|landscape|square|widescreen|vertical)\b/i.test(s.raw || ''), q: 'What aspect ratio / framing?', options: ['1:1 square', '16:9 widescreen', '9:16 vertical (stories/reels)', '3:2 landscape', '2:3 portrait'], impact: 'medium', default: '3:2 landscape' },
  ],
  business: [
    { id: 'stage', when: () => true, q: 'What stage is the business at?', options: ['Idea / pre-launch', 'Early revenue', 'Growing', 'Established', 'Turning around a decline'], impact: 'medium', default: 'early stage' },
    { id: 'metric', when: () => true, q: 'What does success look like in numbers?', options: ['Revenue', 'Customers / users', 'Leads', 'Retention', 'Time saved', 'Not defined yet'], impact: 'medium', default: 'the most common metric for this business type, stated explicitly' },
  ],
  health: [
    { id: 'location', when: (s) => !s.country, q: 'Which country’s health system / guidance applies?', options: ['I will type it', 'US', 'UK', 'India', 'EU', 'Other'], impact: 'high', default: 'general guidance with a note that local protocols differ' },
    { id: 'urgency', when: () => true, q: 'How urgent is this?', options: ['Just information', 'Planning a doctor visit', 'Concerned but not urgent', 'Urgent — need to act now'], impact: 'high', default: 'present the red flags that would make it urgent' },
  ],
  presentation: [
    { id: 'duration', when: (s) => !s.lengthTarget, q: 'How long is the talk?', options: ['3–5 minutes', '10 minutes', '20 minutes', '45+ minutes'], impact: 'high', default: '10 minutes' },
    { id: 'audience', when: (s) => !s.audience, q: 'Who is in the room?', options: ['Classmates / peers', 'Lecturers / examiners', 'Executives', 'Clients / investors', 'Mixed general audience'], impact: 'high', default: 'an informed but mixed audience' },
  ],
  coaching: [
    { id: 'role', when: () => true, q: 'What role are you preparing for?', options: ['I will type the job title', 'Internship / graduate role', 'Mid-level', 'Senior / lead', 'Career change'], impact: 'high', default: 'a role matching the background described' },
    { id: 'stage', when: () => true, q: 'What stage is the interview?', options: ['Screening call', 'Technical round', 'Manager / behavioural', 'Final / panel', 'Assessment centre'], impact: 'medium', default: 'a mixed first-round interview' },
  ],
  lifestyle: [
    { id: 'time', when: () => true, q: 'How much time can you realistically give this?', options: ['A few minutes a day', '30–60 minutes a day', 'A few hours a week', 'All-in — this is my priority'], impact: 'high', default: '30–45 minutes a day' },
    { id: 'obstacle', when: () => true, q: 'What has blocked you before?', options: ['No time', 'Losing motivation', 'Do not know where to start', 'Started and stopped', 'External people/obligations'], impact: 'medium', default: 'the plan should assume low starting momentum and recover from missed days' },
  ],
  product: [
    { id: 'scope', when: () => true, q: 'How far should this go?', options: ['Just the plan / specification', 'Plan plus working prototype', 'Complete implementation', 'Implementation plus tests and deployment'], impact: 'high', default: 'the plan plus the working core implementation' },
    { id: 'stack', when: (s) => !s.techStack?.length, q: 'Any stack preference?', options: ['No preference — recommend one', 'I will type it', 'Must use what I already know', 'Must be free/hostable cheaply', 'Corporate-mandated stack'], impact: 'medium', default: 'the simplest stack that meets the requirements' },
  ],
};

/** Map a primary category to its question bank. */
function bankFor(primary, spec) {
  const id = primary.id;
  const map = {
    coding: 'coding', debugging: 'debugging', architecture: 'coding', devops: 'coding', 'ai-development': 'coding',
    writing: 'writing', rewriting: 'writing', editing: 'writing', 'creative-writing': 'writing',
    storytelling: 'writing', communication: 'writing', 'social-media': 'writing', marketing: 'writing',
    'academic': 'academic', 'exam-prep': 'academic', learning: 'academic',
    research: 'research', 'web-research': 'research', 'data-analysis': 'research', analysis: 'research',
    decision: 'decision', comparison: 'decision', career: 'decision', finance: 'decision',
    travel: 'travel',
    'image-generation': 'image', 'image-editing': 'image', 'video-generation': 'image',
    business: 'business', entrepreneurship: 'business', seo: 'business', 'project-management': 'business',
    health: 'health', legal: 'health',
    presentation: 'presentation',
    'interview-prep': 'coaching', resume: 'coaching',
    productivity: 'lifestyle', planning: 'lifestyle',
    website: 'product', 'app-development': 'product', 'game-dev': 'product', 'ui-ux': 'product',
    automation: 'product', 'agent-design': 'product',
  };
  return QUESTION_BANK[map[id]] || QUESTION_BANK[map[spec.media?.kind === 'image' ? 'image' : 'lifestyle']] || [];
}

/**
 * @returns {{questions:Array, assumed:Array, askFirst:boolean, reason:string}}
 */
export function assessMissingInformation({ raw, primary, spec, complexity, flags }) {
  const proceed = PROCEED_RE.test(raw);
  const bank = bankFor(primary, spec);
  const missing = new Set(spec.coverage.missing);

  let candidates = bank.filter((q) => {
    try { return q.when(spec); } catch { return false; }
  });

  // Keep only questions whose answer changes the prompt materially.
  candidates = candidates.filter((q) => q.impact === 'high' || complexity.level >= 3);

  // Drop questions for information the user already gave.
  candidates = candidates.filter((q) => {
    if (q.id === 'language' && spec.techStack.length) return false;
    if (q.id === 'audience' && spec.audience) return false;
    if (q.id === 'length' && spec.lengthTarget) return false;
    if (q.id === 'tone' && spec.tone) return false;
    if (q.id === 'citation' && spec.citationStyle) return false;
    if (q.id === 'level' && spec.academicLevel) return false;
    if (q.id === 'budget' && (spec.budget || spec.freePreferred)) return false;
    if (q.id === 'dest' && missing.size === 0) return false;
    return true;
  });

  const questions = proceed ? [] : candidates.slice(0, 3).map((q) => ({
    id: q.id,
    question: q.q,
    options: q.options,
    default: q.default,
    impact: q.impact,
  }));

  const assumed = spec.coverage.missing.map((m) => ({
    field: m,
    assumption: DEFAULT_ASSUMPTIONS[m] || 'the most common case for this kind of request',
  }));

  const reason = proceed
    ? 'User indicated the assistant should decide — proceeding with labelled assumptions instead of asking.'
    : questions.length
      ? `${questions.length} unanswered detail${questions.length > 1 ? 's' : ''} would materially change the prompt if known.`
      : 'No missing detail would materially change the result — proceeding without questions.';

  return {
    questions,
    assumed,
    askFirst: /\b(ask me|questions first|interview me|clarify first|find out what i need)\b/i.test(raw),
    reason,
    proceededWithoutAsking: proceed,
  };
}

const DEFAULT_ASSUMPTIONS = {
  audience: 'an informed non-specialist audience',
  tone: 'professional and direct',
  length: 'the shortest length that fully covers the brief',
  language: 'the most widely used language for this task type',
  environment: 'a standard modern runtime',
  region: 'general guidance, with jurisdiction-dependent points flagged',
  budget: 'cost-conscious but not free-only',
  academicLevel: 'final-year undergraduate standard',
  citationStyle: 'APA 7',
  options: 'the strongest options identified by the assistant',
  visualStyle: 'photorealistic with cinematic lighting',
};

/** Render the questions as a compact block the user can answer inline. */
export function formatQuestions(questions) {
  if (!questions.length) return '';
  return questions
    .map((q, i) => `${i + 1}. ${q.question}\n   ${q.options.map((o) => `[${o}]`).join('  ')}\n   (default: ${q.default})`)
    .join('\n');
}

export function assumptionLine(assumed) {
  return assumed.length ? listOut(assumed.map((a) => `${a.field} → ${a.assumption}`)) : '';
}
