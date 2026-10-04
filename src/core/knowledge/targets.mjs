/**
 * Target registry — the model/tool profiles the optimiser adapts to.
 *
 * HONESTY RULE: model capabilities change faster than any snapshot can track.
 * Every profile here is a *design assumption*, not a claim of fact. Profiles
 * carry `verified:false` and each generated prompt states which assumptions it
 * made, so the user can correct them. The engine will never instruct a model to
 * use a capability its profile does not list.
 */

const CAP = (o = {}) => ({
  systemPrompt: false, longContext: false, toolUse: false, webSearch: false,
  codeExec: false, vision: false, imageOut: false, videoOut: false, audioOut: false,
  structuredOutput: false, fileUpload: false, persistentMemory: false, ...o,
});

export const TARGETS = [
  {
    id: 'generic', label: 'Generic LLM (any chat model)', vendor: 'any', kind: 'chat', verified: true, generic: true,
    kw: ['llm', 'any ai', 'a model', 'chatbot', 'ai assistant'],
    ph: ['for an ai', 'in a chat model', 'any model', 'general purpose'],
    caps: CAP({ systemPrompt: true, longContext: true, structuredOutput: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 24000, headers: true, guidance: 'light' },
    notes: ['Written to be portable: no vendor-specific syntax, tolerant of imperfect inputs.'],
  },
  {
    id: 'chatgpt', label: 'ChatGPT (OpenAI)', vendor: 'openai', kind: 'chat', verified: false,
    kw: ['chatgpt', 'gpt', 'gpt4', 'gpt-4', 'gpt5', 'gpt-5', 'openai', 'custom gpt', 'gpts'],
    ph: ['chat gpt', 'custom instructions', 'my gpt'],
    caps: CAP({ systemPrompt: true, longContext: true, toolUse: true, webSearch: true, codeExec: true, vision: true, imageOut: true, structuredOutput: true, fileUpload: true, persistentMemory: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 32000, headers: true, guidance: 'light' },
    notes: ['Guidance-style instructions are followed consistently; reasoning directives may be internalised rather than shown.'],
  },
  {
    id: 'claude', label: 'Claude (Anthropic)', vendor: 'anthropic', kind: 'chat', verified: false,
    kw: ['claude', 'anthropic', 'sonnet', 'opus', 'haiku', 'claude code'],
    ph: ['claude ai', 'anthropic model'],
    caps: CAP({ systemPrompt: true, longContext: true, toolUse: true, webSearch: true, codeExec: true, vision: true, structuredOutput: true, fileUpload: true }),
    style: { promptFormat: 'xml', instructionPlacement: 'system', contextBudget: 100000, headers: true, guidance: 'light' },
    notes: ['Responds well to XML-style tagged sections for separating instructions, context and data.'],
  },
  {
    id: 'gemini', label: 'Gemini (Google)', vendor: 'google', kind: 'chat', verified: false,
    kw: ['gemini', 'bard', 'google ai', 'gemini pro', 'gemini flash'],
    ph: ['google ai studio', 'gemini ai'],
    caps: CAP({ systemPrompt: true, longContext: true, toolUse: true, webSearch: true, codeExec: true, vision: true, videoOut: true, audioOut: true, structuredOutput: true, fileUpload: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 200000, headers: true, guidance: 'light' },
    notes: ['Very large context — long reference material can be included directly instead of summarised.'],
  },
  {
    id: 'ai-studio', label: 'Google AI Studio', vendor: 'google', kind: 'dev', verified: false,
    kw: ['ai studio', 'aistudio'], ph: ['google ai studio', 'vertex ai studio'],
    caps: CAP({ systemPrompt: true, longContext: true, structuredOutput: true, fileUpload: true, vision: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'system', contextBudget: 100000, headers: true, guidance: 'light' },
    notes: ['Supports explicit system instructions plus temperature and schema controls.'],
  },
  {
    id: 'lmarena', label: 'LMArena / arena model', vendor: 'arena', kind: 'chat', verified: false,
    kw: ['lmarena', 'lmsys', 'arena', 'chatbot arena'], ph: ['lm arena', 'arena models'],
    caps: CAP({ systemPrompt: false, longContext: true, vision: true, fileUpload: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 16000, headers: true, guidance: 'light' },
    notes: ['Side-by-side comparison arena: a single self-contained prompt matters more than system-level configuration.'],
  },
  {
    id: 'grok', label: 'Grok (xAI)', vendor: 'xai', kind: 'chat', verified: false,
    kw: ['grok', 'xai'], ph: ['grok ai'],
    caps: CAP({ systemPrompt: true, longContext: true, webSearch: true, vision: true, toolUse: true, structuredOutput: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 64000, headers: true, guidance: 'light' },
    notes: ['Live social/web signal often available — useful for recency-sensitive questions.'],
  },
  {
    id: 'perplexity', label: 'Perplexity', vendor: 'perplexity', kind: 'search', verified: false,
    kw: ['perplexity', 'pplx'], ph: ['perplexity ai'],
    caps: CAP({ webSearch: true, longContext: true, structuredOutput: true, fileUpload: true }),
    style: { promptFormat: 'plain', instructionPlacement: 'top', contextBudget: 12000, headers: false, guidance: 'none' },
    notes: ['Answer-engine: citations are produced automatically; keep instructions short and ask directly.'],
  },
  {
    id: 'copilot', label: 'Microsoft Copilot', vendor: 'microsoft', kind: 'chat', verified: false,
    kw: ['copilot', 'bing chat', 'microsoft copilot'],
    caps: CAP({ webSearch: true, vision: true, structuredOutput: true, imageOut: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 16000, headers: true, guidance: 'none' },
    notes: ['Consumer versions favour shorter, plainly worded instructions.'],
  },
  {
    id: 'deepseek', label: 'DeepSeek', vendor: 'deepseek', kind: 'chat', verified: false,
    kw: ['deepseek', 'deepseek-r1', 'deepseek v3'],
    caps: CAP({ systemPrompt: true, longContext: true, codeExec: true, structuredOutput: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 64000, headers: true, guidance: 'none' },
    notes: ['Reasoning-flavoured variants may emit their own thinking trace; ask for the final answer only.'],
  },
  {
    id: 'qwen', label: 'Qwen', vendor: 'alibaba', kind: 'chat', verified: false,
    kw: ['qwen', 'tongyi'], ph: ['qwen chat'],
    caps: CAP({ systemPrompt: true, longContext: true, toolUse: true, vision: true, structuredOutput: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 32000, headers: true, guidance: 'light' },
    notes: ['Strong multilingual performance; state the output language explicitly.'],
  },
  {
    id: 'mistral', label: 'Mistral / Le Chat', vendor: 'mistral', kind: 'chat', verified: false,
    kw: ['mistral', 'mixtral', 'le chat', 'codestral'],
    caps: CAP({ systemPrompt: true, longContext: true, toolUse: true, structuredOutput: true, codeExec: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 32000, headers: true, guidance: 'light' },
    notes: ['Concise instruction following; avoid deeply nested formatting.'],
  },
  {
    id: 'oss-llm', label: 'Open-source LLM (Llama, Phi, Gemma…)', vendor: 'community', kind: 'chat', verified: false,
    kw: ['llama', 'llama3', 'phi', 'gemma', 'ollama', 'local model', 'open source model', 'vllm'],
    ph: ['run locally', 'local llm', 'self hosted model'],
    caps: CAP({ systemPrompt: true, longContext: false, structuredOutput: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 8000, headers: true, guidance: 'explicit' },
    notes: ['Smaller models need shorter prompts, plainer instructions and explicit examples.'],
  },
  {
    id: 'claude-code', label: 'Coding agent (Claude Code / Cursor / Codex)', vendor: 'multi', kind: 'code-agent', verified: false,
    kw: ['cursor', 'claude code', 'copilot workspace', 'codex', 'windsurf', 'aider', 'devin', 'cline', 'roo', 'zed agent'],
    ph: ['coding agent', 'agentic ide', 'ai ide', 'terminal agent', 'autonomous coding'],
    caps: CAP({ systemPrompt: true, longContext: true, toolUse: true, codeExec: true, fileUpload: true, structuredOutput: true, persistentMemory: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 60000, headers: true, guidance: 'none', agentic: true },
    notes: ['Expects repository-grounded instructions: file paths, commands, definition of done, scope limits.'],
  },
  {
    id: 'website-builder', label: 'AI website builder (Lovable / v0 / Bolt…)', vendor: 'multi', kind: 'builder', verified: false,
    kw: ['lovable', 'v0', 'vercel v0', 'bolt', 'replit', 'framer ai', 'webflow ai', 'builder.io'],
    ph: ['ai website builder', 'build my site with ai', 'prompt to website'],
    caps: CAP({ codeExec: true, structuredOutput: true, vision: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'top', contextBudget: 12000, headers: true, guidance: 'none', agentic: true },
    notes: ['Responds to product-style specs: screens, states, data, interactions and visual direction.'],
  },
  {
    id: 'midjourney', label: 'Midjourney', vendor: 'midjourney', kind: 'image', verified: false,
    kw: ['midjourney', 'mj', '--ar', '--v 6', '--style raw'],
    caps: CAP({ imageOut: true }),
    style: { promptFormat: 'descriptive', instructionPlacement: 'inline', contextBudget: 120, headers: false, guidance: 'none' },
    notes: ['Comma-separated descriptive phrases + parameter flags work better than full sentences.'],
  },
  {
    id: 'gpt-image', label: 'GPT Image / DALL·E', vendor: 'openai', kind: 'image', verified: false,
    kw: ['dall-e', 'dalle', 'gpt image', 'gpt-image-1', 'chatgpt image'],
    caps: CAP({ imageOut: true, vision: true }),
    style: { promptFormat: 'descriptive', instructionPlacement: 'inline', contextBudget: 500, headers: false, guidance: 'none' },
    notes: ['Follows natural-language scene descriptions, including explicit "do not include" clauses.'],
  },
  {
    id: 'stable-diffusion', label: 'Stable Diffusion / Flux / ComfyUI', vendor: 'community', kind: 'image', verified: false,
    kw: ['stable diffusion', 'sdxl', 'flux', 'comfyui', 'automatic1111', 'invoke', 'negative prompt'],
    caps: CAP({ imageOut: true }),
    style: { promptFormat: 'descriptive', instructionPlacement: 'inline', contextBudget: 200, headers: false, guidance: 'none' },
    notes: ['Separate positive and negative prompt fields; tag-style prompts and weights are supported.'],
  },
  {
    id: 'ideogram', label: 'Ideogram / typography image models', vendor: 'multi', kind: 'image', verified: false,
    kw: ['ideogram', 'recraft', 'text in image', 'typography poster'],
    caps: CAP({ imageOut: true }),
    style: { promptFormat: 'descriptive', instructionPlacement: 'inline', contextBudget: 300, headers: false, guidance: 'none' },
    notes: ['Quote the literal text that must appear in the image.'],
  },
  {
    id: 'video-model', label: 'Video generation model (Sora / Veo / Runway / Kling…)', vendor: 'multi', kind: 'video', verified: false,
    kw: ['sora', 'veo', 'runway', 'kling', 'pika', 'luma', 'dream machine', 'hailuo', 'video model', 'text to video'],
    caps: CAP({ videoOut: true, imageOut: false }),
    style: { promptFormat: 'descriptive', instructionPlacement: 'inline', contextBudget: 800, headers: false, guidance: 'none' },
    notes: ['Shot-based descriptions with explicit camera motion and a single continuous action read best.'],
  },
  {
    id: 'api-system', label: 'API / system prompt (production)', vendor: 'any', kind: 'api', verified: false,
    kw: ['api', 'system prompt', 'developer message', 'production', 'endpoint', 'backend', 'server side'],
    ph: ['system message', 'developer prompt', 'production prompt', 'via api'],
    caps: CAP({ systemPrompt: true, structuredOutput: true, toolUse: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'system', contextBudget: 16000, headers: true, guidance: 'light', strict: true },
    notes: ['Instruction hierarchy: system → developer → user. Keep user-facing behaviour rules in the system message.'],
  },
  {
    id: 'agent-framework', label: 'Agent framework (LangGraph / CrewAI / n8n…)', vendor: 'multi', kind: 'agent', verified: false,
    kw: ['langgraph', 'langchain', 'crewai', 'autogen', 'n8n', 'zapier agents', 'mcp server'],
    caps: CAP({ systemPrompt: true, toolUse: true, structuredOutput: true, persistentMemory: true }),
    style: { promptFormat: 'markdown', instructionPlacement: 'system', contextBudget: 32000, headers: true, guidance: 'light', agentic: true },
    notes: ['Each node/agent needs a narrow role, an explicit input/output contract and a stop condition.'],
  },
];

export const TARGET_INDEX = Object.fromEntries(TARGETS.map((t) => [t.id, t]));

/** Models whose prompt style differs structurally from chat LLMs. */
export const MEDIA_KINDS = new Set(['image', 'video']);

export const CAPABILITY_LABELS = {
  systemPrompt: 'separate system prompt', longContext: 'long context window', toolUse: 'tool / function calling',
  webSearch: 'live web search', codeExec: 'code execution', vision: 'image understanding',
  imageOut: 'image output', videoOut: 'video output', audioOut: 'audio output',
  structuredOutput: 'structured / JSON output', fileUpload: 'file upload', persistentMemory: 'persistent memory',
};

/**
 * Pick a target profile from the id, falling back to the generic profile.
 * Never throws — an unknown target degrades gracefully and is reported.
 */
export function resolveTarget(id) {
  if (!id) return { target: TARGET_INDEX.generic, unknown: false };
  if (TARGET_INDEX[id]) return { target: TARGET_INDEX[id], unknown: false };
  return { target: TARGET_INDEX.generic, unknown: true, requested: id };
}

/** True if the profile lists a capability. Unknown targets expose none. */
export function can(target, capability) {
  return Boolean(target && target.caps && target.caps[capability]);
}
