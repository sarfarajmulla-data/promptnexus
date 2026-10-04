/**
 * GET /api/targets — the model/tool profiles the optimiser adapts to, plus the
 * task taxonomy the UI groups its selector by.
 *
 * Capability flags are design assumptions. `verified` is only ever true for the
 * portable generic profile, and the UI is expected to say so.
 */

import { TARGETS } from '../src/core/knowledge/targets.mjs';
import { TAXONOMY } from '../src/core/knowledge/taxonomy.mjs';
import { handler, VERSION } from './_lib/http.js';

/** Present the 63 internal categories through the product's coarser vocabulary. */
const GROUPS = [
  { id: 'writing', label: 'Writing', match: ['writing', 'rewriting', 'editing', 'translation', 'summarization', 'document', 'communication', 'creative-writing', 'storytelling'] },
  { id: 'academic', label: 'Academic', match: ['academic', 'learning', 'exam-prep', 'research', 'web-research', 'presentation'] },
  { id: 'technical', label: 'Technical', match: ['coding', 'debugging', 'architecture', 'data-analysis', 'devops', 'engineer', 'ai-development', 'security-review', 'automation', 'data-viz', 'spreadsheet'] },
  { id: 'creative', label: 'Creative', match: ['image-generation', 'image-editing', 'video-generation', 'audio', 'brainstorming', 'roleplay', 'simulation'] },
  { id: 'professional', label: 'Professional', match: ['business', 'entrepreneurship', 'marketing', 'seo', 'social-media', 'career', 'resume', 'interview-prep', 'finance', 'legal', 'project-management', 'productivity', 'decision', 'comparison', 'analysis'] },
  { id: 'product', label: 'Product', match: ['website', 'app-development', 'game-dev', 'ui-ux', 'agent-design', 'prompt-engineering', 'meta-prompting'] },
  { id: 'other', label: 'Other', match: ['general-qa', 'health', 'travel', 'planning', 'science', 'mathematics', 'engineering', 'other'] },
];

export default handler(async () => {
  const byId = Object.fromEntries(TAXONOMY.map((t) => [t.id, t]));
  const seen = new Set();
  const taskTypes = GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    options: g.match
      .filter((id) => byId[id] && !seen.has(id) && (seen.add(id), true))
      .map((id) => ({ id, label: byId[id].label, description: byId[id].must?.[0] || '' })),
  })).filter((g) => g.options.length);

  return {
    version: VERSION,
    targets: TARGETS.map((t) => ({
      id: t.id,
      label: t.label,
      vendor: t.vendor,
      kind: t.kind,
      verified: Boolean(t.verified),
      notes: t.notes || [],
    })),
    taskTypes,
    quality: [
      { id: 'fast', label: 'Fast', description: 'Shortest useful prompt. Best when you will iterate anyway.' },
      { id: 'balanced', label: 'Balanced', description: 'The default: full specification, proportionate length.' },
      { id: 'maximum', label: 'Maximum', description: 'Adds an explicit verification pass. Slower, safer for work you will act on.' },
    ],
    intelligenceModes: [
      { id: 'auto', label: 'Auto', description: 'The engine chooses the strategy from your description.' },
      { id: 'direct', label: 'Direct', description: 'Single-step prompt for a simple task.' },
      { id: 'expert', label: 'Expert', description: 'Domain terminology, no beginner framing.' },
      { id: 'research', label: 'Research', description: 'Evidence, sourcing and verification weighted up.' },
      { id: 'agentic', label: 'Agentic', description: 'Multi-stage workflow with tools and stop conditions.' },
      { id: 'creative', label: 'Creative', description: 'Divergent generation with an explicit filter.' },
      { id: 'precision', label: 'Precision', description: 'Hard output contract, strictly bounded scope.' },
    ],
  };
});
