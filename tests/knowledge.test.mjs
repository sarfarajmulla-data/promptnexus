import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAXONOMY, CATEGORY_INDEX } from '../src/core/knowledge/taxonomy.mjs';
import { TARGETS, TARGET_INDEX, resolveTarget, can } from '../src/core/knowledge/targets.mjs';
import { TECHNIQUES, TECHNIQUE_INDEX, FAMILY_LABELS } from '../src/core/knowledge/techniques.mjs';
import { SECTIONS, RECIPES, CATEGORY_RECIPE, buildSections, recipeFor } from '../src/core/templates/templates.mjs';

test('taxonomy is structurally valid and unique', () => {
  assert.ok(TAXONOMY.length >= 60, 'the master spec lists 60+ task categories');
  const ids = new Set();
  for (const t of TAXONOMY) {
    assert.ok(t.id && !ids.has(t.id), `duplicate or missing id: ${t.id}`);
    ids.add(t.id);
    assert.ok(t.label, `missing label for ${t.id}`);
    assert.ok(t.group, `missing group for ${t.id}`);
    assert.ok(t.role, `missing default role for ${t.id}`);
    assert.ok(Array.isArray(t.must), `missing must-list for ${t.id}`);
    assert.ok(t.tech.length > 0, `no default techniques for ${t.id}`);
    for (const kw of t.kw) assert.ok(typeof kw === 'string' && kw.length > 1, `bad keyword in ${t.id}`);
  }
  assert.equal(ids.size, TAXONOMY.length);
});

test('every category maps to a real recipe with real section builders', () => {
  for (const t of TAXONOMY) {
    const recipeId = CATEGORY_RECIPE[t.id];
    assert.ok(recipeId, `category ${t.id} has no recipe mapping`);
    assert.ok(RECIPES[recipeId], `recipe ${recipeId} does not exist`);
    for (const section of RECIPES[recipeId]) {
      assert.ok(SECTIONS[section], `section builder "${section}" is missing (used by recipe ${recipeId})`);
    }
  }
});

test('target profiles are honest and unique', () => {
  const ids = new Set();
  for (const t of TARGETS) {
    assert.ok(!ids.has(t.id), `duplicate target id ${t.id}`);
    ids.add(t.id);
    assert.ok(t.label && t.kind, `incomplete profile: ${t.id}`);
    assert.ok(typeof t.caps === 'object', `${t.id} missing capability map`);
    assert.ok(t.style && t.style.promptFormat, `${t.id} missing style profile`);
    // The honesty rule: only the portable generic profile may claim verification.
    if (!t.generic) assert.equal(t.verified, false, `${t.id} must not claim verified capabilities`);
    if (!t.generic) assert.ok((t.notes || []).length >= 1, `${t.id} must declare its design assumptions`);
  }
  assert.equal(TARGET_INDEX.generic.generic, true);
});

test('resolveTarget never throws', () => {
  assert.equal(resolveTarget('claude').target.id, 'claude');
  const unknown = resolveTarget('nonexistent-model-xyz');
  assert.equal(unknown.target.id, 'generic');
  assert.equal(unknown.unknown, true);
  assert.equal(resolveTarget(undefined).target.id, 'generic');
  assert.equal(resolveTarget(null).target.id, 'generic');
});

test('capability gating works', () => {
  assert.equal(can(TARGET_INDEX.perplexity, 'webSearch'), true);
  assert.equal(can(TARGET_INDEX.midjourney, 'systemPrompt'), false);
  assert.equal(can(null, 'webSearch'), false);
});

test('technique library is valid and self-consistent', () => {
  const ids = new Set();
  for (const t of TECHNIQUES) {
    assert.ok(t.id && !ids.has(t.id), `duplicate technique id ${t.id}`);
    ids.add(t.id);
    assert.ok(t.label && t.description, `incomplete technique: ${t.id}`);
    assert.ok(FAMILY_LABELS[t.family], `unknown family "${t.family}" on ${t.id}`);
    assert.ok(t.cost >= 1 && t.cost <= 3, `${t.id} cost must be 1-3`);
    assert.equal(typeof t.render, 'function', `${t.id} must be renderable`);
    assert.equal(typeof t.when, 'function', `${t.id} must declare applicability`);
    for (const req of t.requires || []) {
      assert.ok(req in TARGET_INDEX.generic.caps, `${t.id} requires unknown capability ${req}`);
    }
  }
  assert.ok(TECHNIQUES.length >= 20, 'the strategy library should be substantial');
  assert.equal(TECHNIQUE_INDEX.role.family, 'structure');
});

test('every technique renders without throwing against a realistic context', () => {
  const ctx = {
    raw: 'write a research summary about renewable energy policy for my masters dissertation',
    intent: { verbatim: 'write a research summary', headline: 'write a research summary' },
    analysis: { categories: { folded: 'research summary renewable energy policy masters dissertation', primary: CATEGORY_INDEX.research, secondary: [] } },
    categories: { folded: 'x', primary: CATEGORY_INDEX.research, secondary: [], confidence: 0.6 },
    primary: CATEGORY_INDEX.research,
    target: TARGET_INDEX.generic,
    complexity: { level: 4, label: 'Advanced', score: 4, reasons: [] },
    flags: { media: null, hasSourceText: true, longInput: false, needsSources: true, needsVerification: true, requiresVerification: true, wantsMachine: false, targetHasSearch: true, targetHasTools: true, targetAgentic: false, highStakes: false, defensiveSecurity: false, isLearning: false, isBeginner: false, isExpert: false, expertMode: false, creativeOutput: false, roleplayRequested: false, providesExamples: false, styleMatch: false, classification: false, timePrecious: false, wantsGrounded: true, untrustedData: true, largeProject: false, quick: false, wantsAnswerOnly: false, copyReady: false, academicLevel: 'Master’s level', citationStyle: 'APA 7', tone: 'academic', lengthTarget: '2,000 words', techStack: [], country: 'india', budget: null, relationship: null, avoidSaying: [], outputRules: [], extraProcess: null, extraVerification: [], qualityGate: null, constraintFacts: [], language: 'English', sourceStandard: 'peer-reviewed', recency: '3 years', environment: null, depsPolicy: null, asksImpossible: false, questionFirst: false },
    spec: {
      objective: 'Write a research summary on renewable energy policy', topic: 'renewable energy policy', deliverable: 'a research briefing',
      role: ['You are a research analyst.'], context: ['Final-year dissertation.'], audience: 'an academic examiner', inputs: ['the material supplied'],
      formatSpec: 'Structured report with headings.', inputRules: [], requirements: { must: ['cite sources'], should: [], optional: [] },
      constraints: ['Hold the standard expected at Master’s level.'], forbidden: ['opinion disguised as fact'], quality: [], successCriteria: [],
      unknowns: [], assumptions: [], conflicts: [], coverage: { checks: {}, missing: [] }, categoryMusts: [], needsSources: true,
      researchQuestion: 'How effective is renewable energy policy?', options: [], selfContext: null, academicLevel: 'Master’s level',
      citationStyle: 'APA 7', tone: 'academic', lengthTarget: '2,000 words', techStack: [], country: 'india', budget: null, deadline: null,
      urgent: false, freePreferred: false, premium: false, isBeginner: false, isExpert: false, media: null, wantsMachine: false,
      wantsTable: false, wantsSteps: true, styleSource: false, hasSourceText: true, codeBlocks: [], ast: { sentences: 3, words: 60 },
    },
    modes: { list: [], ids: new Set(), has: () => false, primary: 'standard', promptOnly: false, wantsAdvanced: false },
    planStages: ['Frame the question', 'Gather evidence', 'Synthesise', 'Verify'],
    rubricItems: [{ name: 'Evidence discipline', test: 'claims are sourced' }],
    criteria: [{ name: 'Fit', weight: 30 }],
    perspectives: ['the proponent', 'the critic'],
    threatFocus: 'wrong assumptions',
    delimiterStyle: 'fenced blocks',
    schema: null,
    budget: { steps: 8, retries: 1, stopConditions: ['done'] },
    chain: ['1. Frame', '2. Gather'],
    agentRoles: ['scout', 'analyst'],
    availableTools: ['web search'],
    panelRoles: ['expert', 'skeptic'],
    panelSize: 2,
    quantityTarget: 8,
    filterCriteria: 'fits the constraints',
    factCheckCount: 5,
    edgeCases: ['Sources conflict.'],
    finalRules: [],
    assumptions: [],
    selected: [],
  };
  for (const t of TECHNIQUES) {
    const out = t.render(ctx);
    assert.ok(Array.isArray(out), `${t.id} render must return an array`);
    for (const line of out) assert.equal(typeof line, 'string', `${t.id} rendered a non-string`);
  }
  // And the full section assembly must work for every recipe.
  for (const t of TAXONOMY) {
    const local = { ...ctx, primary: t, analysis: { ...ctx.analysis, categories: { ...ctx.analysis.categories, primary: t } } };
    const sections = buildSections(local);
    assert.ok(Array.isArray(sections), `buildSections failed for ${t.id}`);
    for (const s of sections) {
      assert.ok(s.title && Array.isArray(s.lines) && s.lines.length, `empty section ${s.title} for ${t.id}`);
    }
  }
  assert.ok(recipeFor('coding', {}).includes('codeSpec'));
  assert.ok(recipeFor('image-generation', { media: 'image' }).includes('mediaSpec'));
});
