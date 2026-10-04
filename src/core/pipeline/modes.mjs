/**
 * Modes — the operating modes the system recognises in a request.
 *
 * A mode changes the *shape of the whole response*, not just a section. Modes
 * compose: a user can ask for a compressed, target-specific, one-copy-paste
 * prompt all at once.
 */

export const MODES = [
  {
    id: 'minimal', label: 'Ultra-minimal (prompt only)',
    detect: /\b(?:just|only)\s+(?:give me\s+)?(?:the\s+)?prompt\b|\bprompt only\b|\bno (?:explanation|analysis|commentary|extra)\b|\bnothing else\b|\bjust the prompt\b|\bgive me just\b/i,
    effect: 'Return the prompt text and nothing else.',
  },
  {
    id: 'best', label: 'Best possible prompt',
    detect: /\bbest (?:possible |quality )?prompt\b|\bstrongest prompt\b|\bperfect prompt\b|\bmost effective prompt\b/i,
    effect: 'Maximise practical quality; resist artificial length.',
  },
  {
    id: 'improve', label: 'Improve an existing prompt',
    detect: /\b(?:improve|rewrite|fix|refine|upgrade|repair|optimi[sz]e|better)\b[^.\n]{0,30}\bprompt\b|\bprompt\b[^.\n]{0,20}\b(?:is bad|sucks|not working|doesn'?t work|fails|weak)\b|\bmake (?:this|my) prompt\b/i,
    requiresPrompt: true,
    effect: 'Diagnose the existing prompt, then rebuild it and list what changed.',
  },
  {
    id: 'compare', label: 'Compare prompts',
    detect: /\bcompare (?:these |the )?(?:two|three|\d)? ?prompts?\b|\bwhich prompt is better\b|\bprompt a\b[\s\S]{0,40}\bprompt b\b|\bprompt 1\b[\s\S]{0,60}\bprompt 2\b/i,
    requiresPrompt: true,
    effect: 'Score both prompts across the evaluation dimensions and declare a winner.',
  },
  {
    id: 'compress', label: 'Compress a prompt',
    detect: /\b(?:compress|shorten|reduce|trim|cut down|condense)\b[^.\n]{0,25}\bprompt\b|\bprompt is too long\b|\bmake (?:this|the) prompt shorter\b|\bfewer tokens\b/i,
    requiresPrompt: true,
    effect: 'Preserve objective, constraints, output contract and verification; strip everything else.',
  },
  {
    id: 'expand', label: 'Expand a prompt',
    detect: /\b(?:expand|strengthen|beef up|elaborate|flesh out|add (?:more )?detail to|deepen)\b[^.\n]{0,25}\bprompt\b|\bprompt is too (?:weak|vague|short|thin)\b|\badd more detail to (?:this|the|my) (?:prompt|instruction)/i,
    requiresPrompt: true,
    effect: 'Add only missing context, constraints, output structure, evaluation and edge cases.',
  },
  {
    id: 'translate', label: 'Translate between model styles',
    detect: /\b(?:translat|convert|port|adapt)\w*\b[^.\n]{0,35}\bprompt\b[^.\n]{0,35}\b(?:for|to|into)\b|\bchatgpt (?:style|format)\b|\bclaude (?:style|format)\b|\bsystem prompt (?:version|format)\b/i,
    effect: 'Restructure the same intent into the conventions of another model or API.',
  },
  {
    id: 'explain', label: 'Explain the prompt',
    detect: /\bexplain (?:the|this|my|why)?\s*prompt\b|\bwhy does this prompt work\b|\bwalk me through (?:the|this) prompt\b|\bwhat does this prompt do\b|\bteach me (?:the )?prompt engineering\b/i,
    effect: 'Explain the architecture, the techniques and why each part is there.',
  },
  {
    id: 'test', label: 'Test / failure simulation',
    detect: /\btest (?:this |the |my )?prompt\b|\bhow (?:would|will) (?:this|the) prompt (?:fail|break)\b|\bfailure (?:cases|modes) for\b|\bstress test\b|\bbreak (?:this|the) prompt\b/i,
    requiresPrompt: true,
    effect: 'Simulate adversarial and edge-case inputs, predict failures, and patch them.',
  },
  {
    id: 'advanced', label: 'Advanced mode',
    detect: /\b(?:maximum|max|highest) quality\b|\badvanced mode\b|\bexpert mode\b|\bmost (?:robust|reliable|capable)\b|\bgo all out\b|\bproduction[- ]grade\b|\bmake it bulletproof\b/i,
    effect: 'Add target adaptation, assumptions, failure-mode safeguards, evaluation rubric and a workflow variant.',
  },
  {
    id: 'beginner', label: 'Beginner mode',
    detect: /\bi(?:'m| am) (?:a )?(?:complete )?(?:beginner|newbie|novice)\b|\bexplain like i(?:'m| am)\b|\bno (?:technical )?jargon\b|\bsimple terms\b|\btotal beginner\b|\bnew to this\b/i,
    effect: 'Instruct the target AI to start from first principles, define terms and check understanding.',
  },
  {
    id: 'expert', label: 'Expert mode',
    detect: /\bi(?:'m| am) (?:an? )?(?:expert|senior|experienced|professional|phd|researcher)\b|\bdeep technical\b|\bdon'?t dumb it down\b|\btechnical audience\b|\bpeer[- ]level\b/i,
    effect: 'Use domain terminology; skip foundational explanations.',
  },
  {
    id: 'copy', label: 'One copy-paste prompt',
    detect: /\bone (?:copy[- ]paste|shot)\b|\bcopy[- ]?pasteable\b|\bsingle prompt\b|\bone prompt\b|\bready to paste\b|\bdrop[- ]in\b/i,
    effect: 'Return exactly one self-contained block with no wrapper text.',
  },
  {
    id: 'workflow', label: 'Multi-prompt workflow',
    detect: /\b(?:multi[- ]?step|workflow|pipeline|chain of prompts|series of prompts|several prompts?|multiple prompts?|break (?:it|this) (?:down|up) into)\b/i,
    effect: 'Split the work into sequential prompts with hand-off contracts.',
  },
  {
    id: 'quick', label: 'Quick answer',
    detect: /\bquick(?:ly)?\b|\bin a hurry\b|\bdon'?t overthink\b|\bkeep it simple\b|\brough idea\b/i,
    effect: 'Keep the prompt lean; skip optional refinement.',
    soft: true,
  },
];

/** Detect every mode present in the request, with evidence. */
export function detectModes(raw) {
  const found = [];
  for (const m of MODES) {
    const match = raw.match(m.detect);
    if (match) found.push({ ...m, evidence: match[0].trim(), confidence: m.soft ? 0.5 : 0.85 });
  }
  const ids = new Set(found.map((f) => f.id));

  // Minimal wins over everything: if the user wants only the prompt, honour it.
  const ordered = found.sort((a, b) => priority(a.id) - priority(b.id));
  return {
    list: ordered,
    ids,
    has: (id) => ids.has(id),
    primary: ordered[0]?.id || 'standard',
    promptOnly: ids.has('minimal') || ids.has('copy'),
    wantsAdvanced: ids.has('advanced'),
  };
}

function priority(id) {
  const order = ['minimal', 'compress', 'compare', 'test', 'improve', 'translate', 'expand', 'workflow', 'advanced', 'best', 'copy', 'explain', 'beginner', 'expert', 'quick'];
  const i = order.indexOf(id);
  return i === -1 ? order.length : i;
}
