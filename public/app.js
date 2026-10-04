/**
 * PromptNexus Beta — application shell.
 *
 * One screen, one purpose, one primary action. Everything optional is behind
 * progressive disclosure. State is a single object; views are pure functions
 * of it. No framework, no build step, no runtime dependency.
 */

import { generate, analyze, targets as fetchTargets, runtime } from './js/api.js';
import { state, update, updateSettings, updateDraft, savePrompt, deletePrompt, toggleFavourite, wipe, applyTheme } from './js/store.js';
import { listbox, closeListbox, toast, openModal, closeModal, escapeHtml as esc, debounce, copyText } from './js/ui.js';
import { initField, setFieldEnabled, setFieldState } from './js/field.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let catalogue = { targets: [], taskTypes: [], quality: [], intelligenceModes: [] };
let current = null;             // last generation result
let outputMode = 'prompt';      // prompt | workflow | agent
let generating = false;

/* ── boot ─────────────────────────────────────────────────────────────── */

async function boot() {
  applyTheme();
  bindChrome();
  bindShortcuts();
  initField();
  setFieldEnabled(state.settings.field);

  renderQuickChips();
  renderLandingPreview();

  catalogue = await fetchTargets();
  renderRuntime();
  renderProviderList();
  renderTemplates();

  go(state.view === 'landing' ? 'landing' : state.view, { silent: true });

  if (!state.onboarded) openModal('onboarding');
  window.addEventListener('matchMedia', () => {});
}

/* ── chrome: nav, theme, palette ──────────────────────────────────────── */

function bindChrome() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-go]');
    if (nav) {
      const view = nav.dataset.go;
      go(view);
      if (nav.dataset.focus === 'composer') setTimeout(() => $('#composer')?.focus(), 60);
      if (view !== 'create') $('#composer')?.blur();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) return handleResultAction(act.dataset.act);
    const copy = e.target.closest('[data-copy]');
    if (copy) return doCopy($('#' + copy.dataset.copy)?.textContent || '');
  });

  $('#themeBtn').addEventListener('click', () => {
    const next = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark';
    updateSettings({ theme: next });
    applyTheme(); renderSettings();
    setFieldState('idle');
  });
  $('#paletteBtn').addEventListener('click', () => openPalette());
  $('#engineChip').addEventListener('click', () => { renderProviderList(); openModal('providerDialog'); });
  $('#provClose').addEventListener('click', () => closeModal('providerDialog'));
  $('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });

  $('#onbSkip').addEventListener('click', finishOnboarding);
  $('#onbDone').addEventListener('click', finishOnboarding);
  addEventListener('click', (e) => {
    const onb = e.target.closest('[data-onb] [data-v]');
    if (!onb) return;
    const group = onb.closest('[data-onb]').dataset.onb;
    $$('[data-onb] [data-v]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    onb.setAttribute('aria-pressed', 'true');
    state.profile[group] = onb.dataset.v;
  });

  addEventListener('resize', closeListbox);
  addEventListener('scroll', closeListbox, true);
}

function finishOnboarding() {
  update({ onboarded: true });
  // Three choices, applied as defaults only — never as invented facts about the user.
  if (state.profile.favourite) updateSettings({ defaultTarget: state.profile.favourite });
  if (state.profile.experience === 'advanced') updateSettings({ compact: false });
  closeModal('onboarding');
  if (state.profile.use === 'coding') { updateDraft({ taskType: 'technical' }); }
  else if (state.profile.use === 'academic') { updateDraft({ taskType: 'academic' }); }
  else if (state.profile.use === 'creative') { updateDraft({ taskType: 'creative' }); }
  else if (state.profile.use === 'professional') { updateDraft({ taskType: 'professional' }); }
  toast('Ready. Describe anything.', 'good', 2000);
  setTimeout(() => $('#composer')?.focus(), 100);
}

/* ── routing ──────────────────────────────────────────────────────────── */

function go(view, { silent = false } = {}) {
  closeListbox();
  const target = $(`[data-view="${view}"]`) ? view : 'create';
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== target; });
  $$('.rail-item').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.go === target)));
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.go === target));
  $('#workspace').scrollTop = 0;
  update({ view: target }, { persist: true });
  if (!silent) {
    const titles = { create: 'Create', optimize: 'Optimize', test: 'Test', compare: 'Compare', templates: 'Templates', library: 'Library', settings: 'Settings', landing: 'Home' };
    document.title = target === 'landing' ? 'PromptNexus — Universal AI Prompt Architect' : `${titles[target]} · PromptNexus`;
    setFieldState(target === 'create' ? 'idle' : 'idle');
  }
  if (target === 'library') renderLibrary();
  if (target === 'settings') renderSettings();
  if (target === 'templates') renderTemplates();
}

/* ── runtime / provider status ────────────────────────────────────────── */

function renderRuntime() {
  const rt = runtime();
  $('#engineLabel').textContent = rt.label;
  $('#engineDot').dataset.state = rt.provider ? 'provider' : rt.mode === 'server' ? 'local' : rt.mode === 'offline' ? 'degraded' : 'local';
  $('#engineChip').title = rt.reason || 'Deterministic engine running locally. No key configured.';
  const note = $('#providerNote');
  if (note) note.textContent = rt.reason || 'Running on the deterministic engine. A provider key is optional and server-side only.';
}

function renderProviderList() {
  const rt = runtime();
  const configured = Boolean(rt.provider);
  const rows = [
    { label: 'No-AI mode', hint: 'Deterministic engine · always available', ready: true },
    { label: 'Provider refinement', hint: configured ? `Configured: ${rt.provider}` : 'Not configured — set PROVIDER + API key in the deployment environment', ready: configured },
  ];
  $('#provList').innerHTML = rows.map((r) => `
    <li class="${r.ready ? '' : 'off'}">
      <span>${esc(r.label)}<br><small class="dim">${esc(r.hint)}</small></span>
      <span class="pill ${r.ready ? 'ready' : ''}">${r.ready ? 'ready' : 'off'}</span>
    </li>`).join('');
  $('#provFoot').textContent = configured
    ? 'Routing is server-side: the browser never holds a key, and the engine decides what intelligence a task needs before the router decides which model supplies it.'
    : 'Prompts are identical in structure with or without a provider. Refinement only softens wording; it never changes classification, scoring or safeguards.';
}

/* ── create view ──────────────────────────────────────────────────────── */

function bindCreate() {
  const ta = $('#composer');
  ta.value = state.draft.input || '';
  autoGrow(ta);
  updateCounter();

  ta.addEventListener('input', () => {
    autoGrow(ta);
    updateCounter();
    updateDraft({ input: ta.value });
    setFieldState(ta.value.trim() ? 'typing' : 'idle');
    $('#clearBtn').hidden = !ta.value;
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runGenerate(); }
    if (e.key === 'Escape') { ta.blur(); }
  });

  $('#clearBtn').addEventListener('click', () => {
    ta.value = '';
    updateDraft({ input: '' });
    autoGrow(ta); updateCounter();
    $('#clearBtn').hidden = true;
    $('#attachments').hidden = true;
    $('#attachments').innerHTML = '';
    setFieldState('idle');
    ta.focus();
  });

  $('#attachBtn').addEventListener('click', attachMaterial);
  $('#generateBtn').addEventListener('click', runGenerate);
  $('#cancelGen').addEventListener('click', cancelGenerate);
  $('#editRequest').addEventListener('click', backToComposer);

  $('#advancedToggle').addEventListener('click', (e) => {
    const open = $('#advancedPanel').hidden;
    $('#advancedPanel').hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  for (const [id, key] of [['optAudience', 'audience'], ['optTone', 'tone'], ['optLength', 'length'], ['optInstructions', 'instructions']]) {
    const input = $('#' + id);
    input.value = state.draft.advanced?.[key] || '';
    input.addEventListener('input', () => updateDraft({ advanced: { [key]: input.value } }));
  }

  buildSelect('#selTarget', targetOptions(), state.draft.targetId, (opt) => {
    updateDraft({ targetId: opt.id });
    setSelectValue('#selTarget', opt.label);
  }, { searchThreshold: 8 });
  buildSelect('#selTask', taskOptions(), state.draft.taskType, (opt) => {
    updateDraft({ taskType: opt.id });
    setSelectValue('#selTask', opt.label);
  });
  buildSelect('#selQuality', catalogue.quality.map((q) => ({ id: q.id, label: q.label, hint: q.description })), state.draft.quality, (opt) => {
    updateDraft({ quality: opt.id });
    setSelectValue('#selQuality', opt.label);
  });
  buildSelect('#selMode', catalogue.intelligenceModes.map((m) => ({ id: m.id, label: m.label, hint: m.description })), state.draft.mode, (opt) => {
    updateDraft({ mode: opt.id });
    setSelectValue('#selMode', opt.label);
  }, { searchThreshold: 99 });

  setSelectValue('#selTarget', labelFor('#selTarget', state.draft.targetId) || 'Auto detect');
  setSelectValue('#selTask', labelFor('#selTask', state.draft.taskType) || 'Auto detect');
  setSelectValue('#selQuality', labelFor('#selQuality', state.draft.quality) || 'Balanced');
  setSelectValue('#selMode', labelFor('#selMode', state.draft.mode) || 'Auto');
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.46) + 'px';
}

function updateCounter() {
  const v = $('#composer').value.trim();
  const words = v ? v.split(/\s+/).length : 0;
  const tokens = v ? Math.ceil(v.length / 4) : 0;
  $('#counter').textContent = v ? `${words} word${words === 1 ? '' : 's'} · ~${tokens} tokens` : '0 words';
}

function targetOptions() {
  const list = catalogue.targets.length
    ? catalogue.targets
    : [{ id: 'generic', label: 'Generic AI' }, { id: 'chatgpt', label: 'ChatGPT' }, { id: 'claude', label: 'Claude' }, { id: 'gemini', label: 'Gemini' }];
  return [{ id: '', label: 'Auto detect', hint: 'Let the engine decide' }]
    .concat(list.filter((t) => t.kind !== 'image' || true).map((t) => ({ id: t.id, label: t.label, hint: t.verified ? '' : 'assumed capabilities' })));
}

function taskOptions() {
  if (catalogue.taskTypes?.length) {
    return [{ id: '', label: 'Auto detect', hint: 'Read from your description' }]
      .concat(catalogue.taskTypes.map((g) => ({ id: g.id, label: g.label, group: g.label, hint: `${g.options.length} types` })));
  }
  return [{ id: '', label: 'Auto detect' }];
}

function buildSelect(sel, options, value, onSelect, { searchThreshold = 7 } = {}) {
  const trigger = $(sel);
  if (!trigger || trigger.dataset.bound) return;
  trigger.dataset.bound = '1';
  trigger.dataset.options = 'yes';
  trigger._options = options;
  trigger._onSelect = onSelect;
  trigger._searchThreshold = searchThreshold;
  trigger.addEventListener('click', () => {
    listbox({ trigger, options: trigger._options, value: trigger.dataset.value || '', searchThreshold: trigger._searchThreshold, onSelect: trigger._onSelect });
  });
}

function labelFor(sel, id) {
  const trigger = $(sel);
  const opt = (trigger?._options || []).find((o) => o.id === id);
  return opt?.label;
}

function setSelectValue(sel, label) {
  const trigger = $(sel);
  const span = trigger?.querySelector('[data-value]');
  if (span) span.textContent = label;
  if (trigger) trigger.dataset.value = (trigger._options || []).find((o) => o.label === label)?.id ?? '';
}

/* ── material attachment (local only) ─────────────────────────────────── */

function attachMaterial() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,.csv,.json,.js,.mjs,.py,.ts,.html,.css';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 200_000) { toast('That file is over 200 KB — paste the relevant part instead.', 'bad'); return; }
    const text = await file.text();
    const ta = $('#composer');
    ta.value = ta.value ? `${ta.value}\n\n${text}` : text;
    autoGrow(ta); updateCounter(); updateDraft({ input: ta.value });
    renderAttachments([{ name: file.name, size: file.size }]);
    toast(`Added ${file.name} (read locally, never uploaded)`, 'good');
  });
  input.click();
}

function renderAttachments(files) {
  const host = $('#attachments');
  host.hidden = !files.length;
  host.innerHTML = files.map((f) => `<span class="attach">${esc(f.name)} <span class="dim">${Math.round(f.size / 1024)} KB</span></span>`).join('');
}

/* ── generation ───────────────────────────────────────────────────────── */

const STAGES = [
  'Understanding your objective',
  'Identifying requirements',
  'Selecting prompt strategy',
  'Optimising for the target model',
  'Checking edge cases and failure modes',
  'Finalising prompt',
];

async function runGenerate() {
  const input = $('#composer').value.trim();
  if (!input) { toast('Describe what you want to accomplish first.', 'bad'); $('#composer').focus(); return; }
  if (generating) return;

  generating = true;
  setFieldState('generating');
  $('#quickstart').hidden = true;
  showGenerating();

  const started = performance.now();
  const stageTimers = startStages();

  const payload = {
    input,
    targetId: state.draft.targetId || undefined,
    instructions: state.draft.advanced?.instructions || '',
    options: {
      audience: state.draft.advanced?.audience || '',
      tone: state.draft.advanced?.tone || '',
      length: state.draft.advanced?.length || '',
    },
    explain: true,
    variants: true,
  };

  try {
    const result = await generate(payload);
    // Never let the animation outpace the result: keep the last stage visible
    // just long enough for it to read as a step, not a flicker.
    const elapsed = performance.now() - started;
    await wait(Math.max(0, 900 - elapsed));
    clearInterval(stageTimers);
    markAllStagesDone();

    current = result;
    renderResult(result);
    setFieldState('success');
    setTimeout(() => setFieldState('idle'), 1400);
  } catch (err) {
    clearInterval(stageTimers);
    showError(err);
    setFieldState('error');
    setTimeout(() => setFieldState('idle'), 1600);
  } finally {
    generating = false;
    $('#generating').hidden = true;
  }
}

function startStages() {
  const list = $('#genStages');
  list.innerHTML = STAGES.map((s, i) => `<li data-i="${i}"><span class="tick">${i === 0 ? '' : ''}</span><span>${esc(s)}</span></li>`).join('');
  let i = 0;
  const advance = () => {
    const items = $$('#genStages li');
    items.forEach((li, idx) => {
      li.classList.toggle('done', idx < i);
      li.classList.toggle('active', idx === i);
      const tick = li.querySelector('.tick');
      if (idx < i) tick.textContent = '✓';
    });
    $('#genTitle').textContent = STAGES[Math.min(i, STAGES.length - 1)];
  };
  advance();
  const timer = setInterval(() => { i = Math.min(i + 1, STAGES.length - 1); advance(); }, 260);
  return timer;
}

function markAllStagesDone() {
  $$('#genStages li').forEach((li) => { li.classList.add('done'); li.classList.remove('active'); li.querySelector('.tick').textContent = '✓'; });
}

function showGenerating() {
  $('#createStage').hidden = true;
  $('#result').hidden = true;
  $('#generating').hidden = false;
}

function cancelGenerate() {
  generating = false;
  $('#generating').hidden = true;
  $('#createStage').hidden = false;
  $('#quickstart').hidden = false;
  setFieldState('idle');
}

function showError(err) {
  $('#generating').hidden = true;
  $('#createStage').hidden = false;
  $('#quickstart').hidden = false;
  const retry = `<button class="btn ghost sm" id="retryGen">Try again</button>`;
  const edit = `<button class="btn ghost sm" id="editGen">Edit request</button>`;
  const host = $('#createStage');
  const existing = $('#inlineError');
  existing?.remove();
  const box = document.createElement('div');
  box.id = 'inlineError';
  box.className = 'verdict';
  box.style.borderColor = 'rgba(239,107,107,.45)';
  box.innerHTML = `<strong>${esc(err.message || 'Something went wrong while generating your prompt.')}</strong>
    ${err.hint ? `<p class="small" style="margin-top:6px">${esc(err.hint)}</p>` : ''}
    <div class="row" style="margin-top:12px">${retry}${edit}</div>`;
  host.insertBefore(box, $('#ctaRow') || null);
  $('#retryGen').onclick = () => { box.remove(); runGenerate(); };
  $('#editGen').onclick = () => { box.remove(); $('#composer').focus(); };
  $('#quickstart').hidden = false;
}

/* ── result rendering ─────────────────────────────────────────────────── */

function renderResult(r) {
  $('#createStage').hidden = true;
  $('#generating').hidden = true;
  $('#result').hidden = false;

  $('#resultRequest').textContent = r.understoodGoal || r.goal || state.draft.input;
  const cat = r.strategy?.categories?.[0];
  const level = r.strategy?.complexity?.level ?? '—';
  const target = r.target?.label || 'Generic AI';
  $('#resultMeta').innerHTML = [
    cat ? `<span class="tag accent">${esc(cat.label)}</span>` : '',
    `<span class="tag">Level ${level}/5</span>`,
    `<span class="tag">${esc(target)}${r.target?.verified === false ? ' · assumed' : ''}</span>`,
    modeTag(r),
  ].join('');

  outputMode = 'prompt';
  $$('.mode-switch button').forEach((b) => b.classList.toggle('on', b.dataset.outmode === 'prompt'));
  paintOutput(r);

  renderScore(r);
  renderWhy(r);
  renderSources(r);
  renderQuestions(r);
  updateIndicator(r);
}

function modeTag(r) {
  if (r.workflow?.prompts?.length) return `<span class="tag">Workflow available</span>`;
  return '';
}

/** Output mode switch: prompt / workflow / agent, using the engine's own output. */
function paintOutput(r) {
  const box = $('#promptOut');
  box.contentEditable = 'false';
  let text = r.prompt;
  let note = `${r.tokens ?? Math.ceil(r.prompt.length / 4)} tokens · ${r.prompt.split('\n').length} lines`;

  if (outputMode === 'workflow' && r.workflow?.prompts?.length) {
    text = r.workflow.prompts
      .map((p, i) => `─── STEP ${i + 1}${p.label ? ` · ${p.label}` : ''} ───\n\n${p.prompt}`)
      .join('\n\n');
    note = `${r.workflow.prompts.length} sequential prompts${r.workflow.stopCondition ? ` · stop when: ${r.workflow.stopCondition}` : ''}`;
  } else if (outputMode === 'agent' && r.workflow?.agent) {
    text = r.workflow.agent;
    note = 'Goal, tools, decision logic and verification';
  } else if (outputMode !== 'prompt' && !r.workflow?.prompts?.length) {
    // Recommended mode unavailable for this request: say so rather than showing nothing.
    const hint = outputMode === 'workflow'
      ? 'This request is single-step, so no workflow was generated. Regenerate with an agentic mode to force one.'
      : 'No agent specification was generated for this request.';
    text = `${hint}\n\n${r.prompt}`;
    note = hint;
  }

  box.textContent = text;
  $('#promptStats').textContent = note;
}

function renderScore(r) {
  const s = r.score;
  if (!s) return;
  $('#scoreNum').textContent = s.total;
  $('#scoreBand').textContent = s.band;
  $('#scoreNote').textContent = s.calibration || '';
  const dims = (s.dimensions || []).slice(0, 6);
  $('#scoreDims').innerHTML = dims.map((d) => `
    <div class="dim-row">
      <span>${esc(d.name)}</span><span style="text-align:right">${d.score}</span>
      <div class="dim-bar"><i style="width:${d.score}%"></i></div>
    </div>`).join('');
}

function renderWhy(r) {
  const e = r.explanation || buildExplanationFallback(r);
  $('#whyBody').innerHTML = (Array.isArray(e) ? e : []).map((part) => `
    <h4>${esc(part.heading)}</h4>
    <ul>${[].concat(part.body || []).slice(0, 6).map((b) => `<li>${esc(stripMd(b))}</li>`).join('')}</ul>`).join('')
    || '<p class="dim">No reasoning summary for this request.</p>';
}

function stripMd(s) {
  return String(s).replace(/\*\*/g, '').replace(/`/g, '').replace(/^[-•]\s*/, '');
}

function buildExplanationFallback(r) {
  const out = [];
  if (r.strategy?.summary) out.push({ heading: 'Strategy', body: [r.strategy.summary] });
  if (r.assumptions?.length) out.push({ heading: 'Assumptions to check', body: r.assumptions.slice(0, 4).map((a) => `${a.field}: ${a.assumption}`) });
  return out;
}

function renderSources(r) {
  const p = r.provenance || [];
  if (!p.length) { $('#sourcesPanel').hidden = true; return; }
  $('#sourcesPanel').hidden = false;
  const counts = {};
  for (const sec of p) for (const t of sec.trace) {
    const kind = /^technique/.test(t.source) ? 'Technique' : /repair/.test(t.source) ? 'Red-team repair' : /extractor/.test(t.source) ? 'Your words' : /taxonomy/.test(t.source) ? 'Task-class default' : /recipe|archetype/.test(t.source) ? 'Archetype library' : 'Engine rule';
    counts[kind] = (counts[kind] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $('#sourcesBody').innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
    <div style="margin-bottom:6px">
      <div class="row" style="justify-content:space-between"><span>${esc(k)}</span><span class="dim">${v} · ${Math.round((v / total) * 100)}%</span></div>
      <div class="dim-bar" style="margin-top:4px"><i style="width:${(v / total) * 100}%"></i></div>
    </div>`).join('') + '<p class="dim" style="margin-top:8px">Every line traces to a rule. Nothing here was invented.</p>';
}

function renderQuestions(r) {
  const qs = r.openQuestions || [];
  if (!qs.length) { $('#questionsPanel').hidden = true; return; }
  $('#questionsPanel').hidden = false;
  $('#questionsBody').innerHTML = qs.slice(0, 3).map((q) => `
    <div style="margin-bottom:10px">
      <p class="small">${esc(q.question)}</p>
      <p class="tiny dim">${esc((q.options || []).slice(0, 4).join(' · '))}${q.default ? ` → default: ${esc(q.default)}` : ''}</p>
    </div>`).join('');
}

function updateIndicator(r) {
  const ind = $('#workspaceIndicator');
  ind.hidden = false;
  $('#indicatorText').textContent = r.title || 'Untitled prompt';
}

function backToComposer() {
  $('#result').hidden = true;
  $('#createStage').hidden = false;
  $('#quickstart').hidden = !$('#composer').value.trim() ? false : true;
  $('#composer').focus();
}

/* ── result actions ───────────────────────────────────────────────────── */

async function handleResultAction(act) {
  switch (act) {
    case 'copy': return doCopy($('#promptOut').textContent);
    case 'edit': {
      const box = $('#promptOut');
      const on = box.contentEditable === 'true';
      box.contentEditable = on ? 'false' : 'true';
      if (!on) { box.focus(); toast('Editing — changes stay on this device', '', 2000); }
      return;
    }
    case 'regenerate': return runGenerate();
    case 'improveMenu': return openImproveMenu();
    case 'save': return saveCurrent();
    case 'export': return exportCurrent();
    case 'test': {
      go('test');
      const improved = $('#promptOut').textContent;
      $('#testA').value = state.draft.input;
      $('#testB').value = improved.slice(0, 20000);
      return;
    }
    case 'compare': {
      go('compare');
      $('#cmpA').value = state.draft.input;
      $('#cmpB').value = $('#promptOut').textContent.slice(0, 20000);
      return;
    }
    default: return undefined;
  }
}

async function doCopy(text) {
  if (!text) return;
  const ok = await copyText(text);
  toast(ok ? 'Copied' : 'Copy failed — select the text manually', ok ? 'good' : 'bad', 1600);
}

function openImproveMenu() {
  const trigger = $('[data-act="improveMenu"]');
  const options = [
    { id: 'precise', label: 'Make more precise' },
    { id: 'shorter', label: 'Make shorter' },
    { id: 'powerful', label: 'Make more powerful' },
    { id: 'beginner', label: 'Make beginner-friendly' },
    { id: 'verify', label: 'Add verification' },
    { id: 'examples', label: 'Add examples' },
    { id: 'retarget', label: 'Optimise for another AI' },
    { id: 'workflow', label: 'Convert to workflow' },
  ];
  listbox({
    trigger, options, searchThreshold: 99,
    onSelect: (opt) => applyImprovement(opt.id),
  });
}

async function applyImprovement(kind) {
  const base = $('#promptOut').textContent;
  const map = {
    precise: 'make this more precise and specific',
    shorter: 'make this shorter without losing any constraint',
    powerful: 'make this more powerful and more robust',
    beginner: 'make this beginner-friendly and plainer',
    verify: 'add an explicit verification step',
    examples: 'add one worked example',
    retarget: 'optimise this for a different target model',
  };
  if (kind === 'workflow') {
    outputMode = 'workflow';
    $$('.mode-switch button').forEach((b) => b.classList.toggle('on', b.dataset.outmode === 'workflow'));
    paintOutput(current);
    toast(current?.workflow?.prompts?.length ? 'Switched to workflow' : 'This request is single-step — no workflow generated', current?.workflow?.prompts?.length ? 'good' : '');
    return;
  }
  toast('Refining…', '', 1200);
  try {
    const res = await analyze({ action: 'improve', prompt: base, targetId: state.draft.targetId || undefined });
    if (res?.prompt) {
      $('#promptOut').textContent = res.prompt;
      $('#promptStats').textContent = `${res.tokens ?? Math.ceil(res.prompt.length / 4)} tokens · refined (${map[kind] || kind})`;
      if (res.score) {
        $('#scoreNum').textContent = res.score.total;
        $('#scoreBand').textContent = res.score.band;
        renderScore(res);
      }
      toast('Refined', 'good', 1600);
    } else {
      toast('No refinement produced — the prompt is unchanged.', 'bad');
    }
  } catch (err) {
    toast(err.message || 'Refinement failed.', 'bad');
  }
}

function saveCurrent() {
  if (!current) return;
  const cat = current.strategy?.categories?.[0];
  const saved = savePrompt({
    prompt: $('#promptOut').textContent,
    request: state.draft.input,
    category: cat?.label || 'Other',
    targetId: current.target?.id,
    targetLabel: current.target?.label,
    score: current.score?.total ?? null,
    tags: (current.strategy?.techniques || []).slice(0, 3).map((t) => t.label),
  });
  toast(`Saved to library · ${saved.name}`, 'good');
}

function exportCurrent() {
  if (!current) return;
  const text = [
    `# ${current.title || 'Prompt'}`,
    '',
    `> ${current.understoodGoal || current.goal || ''}`,
    '',
    `Target: ${current.target?.label || 'generic'} · Score: ${current.score?.total ?? '—'}/100 · ${current.score?.band || ''}`,
    '',
    '## Prompt',
    '',
    $('#promptOut').textContent,
    '',
    '## Assumptions to check',
    '',
    ...(current.assumptions || []).map((a) => `- **${a.field}** — ${a.assumption}`),
    '',
    `_Generated by PromptNexus — deterministic engine. ${current.score?.calibration || ''}_`,
  ].join('\n');
  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(current.title || 'prompt').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported as Markdown');
}

/* ── optimize view ────────────────────────────────────────────────────── */

function bindOptimize() {
  buildSelect('#optTarget', targetOptions(), '', (opt) => setSelectValue('#optTarget', opt.label), { searchThreshold: 8 });
  setSelectValue('#optTarget', 'Auto detect');
  $('#optimizeBtn').addEventListener('click', async () => {
    const prompt = $('#optInput').value.trim();
    if (!prompt) { toast('Paste a prompt to improve.', 'bad'); return; }
    const btn = $('#optimizeBtn');
    btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Optimizing…';
    try {
      const res = await analyze({ action: 'improve', prompt, targetId: $('#optTarget').dataset.value || undefined, explain: true });
      $('#optOut').textContent = res.prompt;
      const before = res.baseline?.total ?? res.improvement?.before ?? null;
      const after = res.score?.total ?? null;
      $('#optDelta').innerHTML = after === null ? '' : `
        <div><span class="label">Before</span><div class="big">${before ?? '—'}</div></div>
        <div><span class="label">After</span><div class="big">${after}</div></div>
        <div><span class="label">Change</span><div class="big ${after > before ? 'up' : 'down'}">${before == null ? '—' : (after - before > 0 ? '+' : '') + (after - before)}</div></div>`;
      const ex = res.explanation || [];
      $('#optWhy').innerHTML = ex.length
        ? ex.map((p) => `<h4>${esc(p.heading)}</h4><ul>${[].concat(p.body).slice(0, 5).map((b) => `<li>${esc(stripMd(b))}</li>`).join('')}</ul>`).join('')
        : '<p class="dim">Rebuilt from your prompt with missing structure added.</p>';
      $('#optResult').hidden = false;
      toast('Prompt rebuilt', 'good');
    } catch (err) {
      toast(err.message || 'Could not improve that prompt.', 'bad');
    } finally {
      btn.removeAttribute('aria-busy'); btn.textContent = 'Optimize prompt';
    }
  });
}

/* ── test + compare views ─────────────────────────────────────────────── */

function bindTest() {
  $('#addPromptBtn').addEventListener('click', () => {
    $('#testCWrap').hidden = false;
    $('#addPromptBtn').hidden = true;
  });
  $('#runTestBtn').addEventListener('click', async () => {
    const prompts = [
      { label: 'A', text: $('#testA').value.trim() },
      { label: 'B', text: $('#testB').value.trim() },
      { label: 'C', text: $('#testC').value.trim() },
    ].filter((p) => p.text);
    if (!prompts.length) { toast('Paste at least one prompt.', 'bad'); return; }
    await runEvaluation(prompts, 'testTable', 'testVerdict', 'testCalibration', '#runTestBtn', 'Run evaluation');
  });

  $('#runCompareBtn').addEventListener('click', async () => {
    const prompts = [
      { label: 'A', text: $('#cmpA').value.trim() },
      { label: 'B', text: $('#cmpB').value.trim() },
      { label: 'C', text: $('#cmpC').value.trim() },
    ].filter((p) => p.text);
    if (prompts.length < 2) { toast('Add at least two prompts to compare.', 'bad'); return; }
    await runEvaluation(prompts, 'cmpTable', 'cmpVerdict', 'cmpCalibration', '#runCompareBtn', 'Compare');
  });
}

async function runEvaluation(prompts, tableId, verdictId, calibId, btnSel, label) {
  const btn = $(btnSel);
  btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Working…';
  try {
    const res = await analyze({ action: 'compare', prompts });
    renderEvaluation(res, tableId, verdictId, calibId);
  } catch (err) {
    toast(err.message || 'Evaluation failed.', 'bad');
  } finally {
    btn.removeAttribute('aria-busy'); btn.textContent = label;
    $(`#${tableId}`).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderEvaluation(res, tableId, verdictId, calibId) {
  const items = res.items || [];
  const labels = res.metricLabels || {};
  const keys = Object.keys(items[0]?.metrics || {}).filter((k) => k !== 'overall');
  const best = (key) => Math.max(...items.map((i) => i.metrics[key]));

  $(`#${tableId}`).innerHTML = `
    <thead><tr><th>Metric</th>${items.map((i) => `<th>${esc(i.label)}</th>`).join('')}</tr></thead>
    <tbody>
      ${keys.map((k) => `<tr><td>${esc(labels[k] || k)}</td>${items.map((i) => `<td class="${i.metrics[k] === best(k) && items.length > 1 ? 'best' : ''}">${i.metrics[k]}</td>`).join('')}</tr>`).join('')}
      <tr class="overall"><td>Overall</td>${items.map((i) => `<td>${i.metrics.overall}</td>`).join('')}</tr>
    </tbody>`;

  $(`#${verdictId}`).innerHTML = `<strong>${esc(res.verdict)}</strong>${res.pairwise?.mergeAdvice ? `<p class="small" style="margin-top:6px">${esc(res.pairwise.mergeAdvice)}</p>` : ''}`;
  $(`#${calibId}`).textContent = res.calibration || '';
  $(tableId.replace('Table', 'Result')).hidden = false;
  $(`#${tableId}`).closest('[hidden]')?.removeAttribute('hidden');
  document.getElementById(tableId.replace('Table', 'Result')).hidden = false;
  toast('Evaluation complete', 'good');
}

/* ── templates ────────────────────────────────────────────────────────── */

const TEMPLATES = [
  { id: 'deep-research', label: 'Deep research', group: 'Research', blurb: 'Evidence-weighted investigation with source classification.', text: 'Research [topic] thoroughly. Separate what is established, contested and unknown. Cite sources for each claim and state how confident you are.' },
  { id: 'coding-expert', label: 'Coding expert', group: 'Engineering', blurb: 'Production-grade implementation with tests and edge cases.', text: 'Implement [feature] in [language/framework]. Cover edge cases, handle errors explicitly, and include tests that would fail if the logic were broken.' },
  { id: 'debugging', label: 'Debugging', group: 'Engineering', blurb: 'Ranked hypotheses, cheapest discriminating test first.', text: 'I have this bug: [symptom]. Rank the most likely causes, then give the single cheapest test that eliminates the most of them. Fix the root cause.' },
  { id: 'academic-writing', label: 'Academic writing', group: 'Academic', blurb: 'Argument, evidence and citation discipline.', text: 'Write [section] for [course/paper] on [topic]. Maintain an academic register, support each claim, and mark anything needing verification.' },
  { id: 'exam-tutor', label: 'Exam tutor', group: 'Academic', blurb: 'Active recall, spaced self-testing, marking rubric.', text: 'Help me revise [subject] for an exam in [timeframe]. Test me with questions rather than explaining, and track which topics I keep failing.' },
  { id: 'website-builder', label: 'Website builder', group: 'Product', blurb: 'Layout, states, responsiveness, accessibility.', text: 'Build a [type] site for [purpose]. Handle loading, empty, error and success states. Responsive to 375px. Accessible by default.' },
  { id: 'product-designer', label: 'Product designer', group: 'Product', blurb: 'One message above the fold, then remove what does not serve it.', text: 'Review the interface. State what it is, who it is for and the next step above the fold — then remove everything that does not support that one message.' },
  { id: 'business-strategist', label: 'Business strategist', group: 'Professional', blurb: 'Options, trade-offs, recommendation under uncertainty.', text: 'Analyse [situation]. Give me three options with honest trade-offs, the risks I am underweighting, and a clear recommendation with the reasoning.' },
  { id: 'data-analyst', label: 'Data analyst', group: 'Engineering', blurb: 'Method, assumptions, and what the data cannot tell you.', text: 'Analyse [dataset/question]. State your method, the assumptions it depends on, and what conclusions the data cannot support.' },
  { id: 'image-prompt', label: 'Image prompt', group: 'Creative', blurb: 'Subject, composition stack, parameters, negatives.', text: 'Create an image of [subject] in [style]. Specify composition, lighting and lens; give an aspect ratio and exclusions.' },
  { id: 'video-prompt', label: 'Video prompt', group: 'Creative', blurb: 'Shot, motion, duration and continuity.', text: 'Create a [duration] video of [subject]. Specify the shot, camera motion, lighting and continuity across the sequence.' },
  { id: 'ai-agent', label: 'AI agent', group: 'Product', blurb: 'Goal, tools, decision logic, stop conditions.', text: 'Design an agent that [goal]. Give it tools, decision rules, escalation triggers, stop conditions and a verification step before it reports done.' },
  { id: 'decision-analyst', label: 'Decision analyst', group: 'Professional', blurb: 'Criteria, weights, reversibility, recommendation.', text: 'I am deciding between [options]. Build the criteria, weight them, score each option, and identify which choice is reversible and which is not.' },
  { id: 'email', label: 'Professional email', group: 'Writing', blurb: 'Purpose, tone, length, one clear ask.', text: 'Write an email to [recipient] about [subject]. One clear ask, professional and direct, under [length]. No filler opening.' },
  { id: 'summarise', label: 'Summarise a document', group: 'Writing', blurb: 'Compression with fidelity rules.', text: 'Summarise [document] in [length]. Preserve every decision, number and commitment. State what was left out and why.' },
  { id: 'explain-simply', label: 'Explain simply', group: 'Learning', blurb: 'Plain language, analogy, then depth.', text: 'Explain [concept] to someone with no background. Use one analogy, then add the detail that analogy cannot carry.' },
];

let tplFilter = 'All';
let tplQuery = '';

function renderTemplates() {
  const groups = ['All', ...new Set(TEMPLATES.map((t) => t.group))];
  $('#tplFilters').innerHTML = groups.map((g) => `<button data-g="${esc(g)}" aria-pressed="${g === tplFilter}">${esc(g)}</button>`).join('');
  $$('#tplFilters button').forEach((b) => b.addEventListener('click', () => { tplFilter = b.dataset.g; renderTemplates(); }));

  const q = tplQuery.toLowerCase();
  const list = TEMPLATES.filter((t) => (tplFilter === 'All' || t.group === tplFilter) && (!q || (t.label + t.blurb + t.text).toLowerCase().includes(q)));

  $('#tplGrid').innerHTML = list.map((t) => `
    <article class="card">
      <div class="card-meta"><span class="tag">${esc(t.group)}</span></div>
      <h3>${esc(t.label)}</h3>
      <p>${esc(t.blurb)}</p>
      <div class="card-actions">
        <button class="btn primary sm" data-tpl="${t.id}">Use template</button>
      </div>
    </article>`).join('') || `<div class="empty"><h3>No templates match</h3><p>Try a different search term or category.</p></div>`;

  $$('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    const t = TEMPLATES.find((x) => x.id === b.dataset.tpl);
    go('create');
    const ta = $('#composer');
    ta.value = t.text;
    updateDraft({ input: t.text });
    autoGrow(ta); updateCounter();
    ta.focus();
    ta.setSelectionRange(ta.value.indexOf('['), (ta.value.indexOf(']') + 1) || ta.value.length);
    toast(`Template loaded — replace the bracketed parts`, '', 2400);
  }));
}

/* ── library ──────────────────────────────────────────────────────────── */

let libQuery = '';
let libFilter = 'all';

function renderLibrary() {
  const items = state.library.filter((p) => {
    if (libFilter === 'favourites' && !p.favourite) return false;
    if (libFilter === 'recent' && Date.now() - new Date(p.updatedAt).getTime() > 7 * 864e5) return false;
    if (libFilter === 'high' && (p.score ?? 0) < 75) return false;
    if (libQuery && !(p.name + p.prompt + p.category).toLowerCase().includes(libQuery.toLowerCase())) return false;
    return true;
  });

  $('#libEmpty').hidden = state.library.length > 0;
  $('#libSub').textContent = state.library.length
    ? `${state.library.length} saved · stored in this browser only`
    : 'Saved prompts live in this browser. Nothing is uploaded.';

  $('#libFilters').innerHTML = [
    ['all', 'All'], ['favourites', 'Favourites'], ['recent', 'Recent'], ['high', 'Score 75+'],
  ].map(([id, label]) => `<button data-f="${id}" aria-pressed="${libFilter === id}">${label}</button>`).join('');
  $$('#libFilters button').forEach((b) => b.addEventListener('click', () => { libFilter = b.dataset.f; renderLibrary(); }));

  $('#libGrid').innerHTML = items.map((p) => `
    <article class="card">
      <div class="card-meta">
        <span class="tag">${esc(p.category)}</span>
        ${p.score != null ? `<span class="tag accent">${p.score}/100</span>` : ''}
        ${p.favourite ? '<span class="tag">★</span>' : ''}
      </div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.prompt.split('\n').filter((l) => l.trim()).slice(1, 3).join(' ').slice(0, 120) || p.request || '')}</p>
      <div class="card-meta tiny dim">
        <span>${esc(p.targetLabel || 'Generic')}</span><span>·</span>
        <span>${new Date(p.updatedAt).toLocaleDateString()}</span>
      </div>
      <div class="card-actions">
        <button class="btn ghost sm" data-open="${p.id}">Open</button>
        <div class="row">
          <button class="icon-action" data-fav="${p.id}" title="Favourite">★</button>
          <button class="icon-action" data-dup="${p.id}" title="Duplicate">⧉</button>
          <button class="icon-action" data-del="${p.id}" title="Delete">✕</button>
        </div>
      </div>
    </article>`).join('');

  $$('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const p = state.library.find((x) => x.id === b.dataset.open);
    go('create');
    const ta = $('#composer');
    ta.value = p.request || p.name;
    updateDraft({ input: ta.value });
    autoGrow(ta); updateCounter();
    toast('Loaded into the composer', 'good');
  }));
  $$('[data-fav]').forEach((b) => b.addEventListener('click', () => { toggleFavourite(b.dataset.fav); renderLibrary(); }));
  $$('[data-dup]').forEach((b) => b.addEventListener('click', () => {
    const p = state.library.find((x) => x.id === b.dataset.dup);
    savePrompt({ ...p, id: null, name: `${p.name} (copy)` });
    renderLibrary(); toast('Duplicated');
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
    deletePrompt(b.dataset.del); renderLibrary(); toast('Deleted');
  }));
}

/* ── settings ─────────────────────────────────────────────────────────── */

function renderSettings() {
  const s = state.settings;
  $$('#setTheme button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.theme));
  $('#setMotion').classList.toggle('on', s.motion === 'reduced');
  $('#setMotion').setAttribute('aria-checked', String(s.motion === 'reduced'));
  $('#setField').classList.toggle('on', s.field);
  $('#setField').setAttribute('aria-checked', String(s.field));
  $('#setCompact').classList.toggle('on', s.compact);
  $('#setCompact').setAttribute('aria-checked', String(s.compact));
  $('#dataCount').textContent = `${state.library.length} saved prompt${state.library.length === 1 ? '' : 's'}`;
  $('#versionTag').textContent = '1.0.0';
  const note = $('#providerNote');
  if (note && !note.textContent.trim()) note.textContent = 'Deterministic engine active.';
  renderRuntime();
}

function bindSettings() {
  $$('#setTheme button').forEach((b) => b.addEventListener('click', () => { updateSettings({ theme: b.dataset.v }); applyTheme(); renderSettings(); }));
  $('#setMotion').addEventListener('click', () => { updateSettings({ motion: state.settings.motion === 'reduced' ? 'auto' : 'reduced' }); applyTheme(); renderSettings(); if (state.settings.motion === 'reduced') setFieldEnabled(false); else setFieldEnabled(state.settings.field); });
  $('#setField').addEventListener('click', () => { updateSettings({ field: !state.settings.field }); setFieldEnabled(state.settings.field); renderSettings(); });
  $('#setCompact').addEventListener('click', () => { updateSettings({ compact: !state.settings.compact }); applyTheme(); renderSettings(); });
  $('#exportAll').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.library, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'promptnexus-library.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('Exported');
  });
  $('#wipeData').addEventListener('click', () => {
    if (confirm('Delete every saved prompt and setting in this browser? This cannot be undone.')) wipe();
  });
  buildSelect('#setTarget', targetOptions(), s0().defaultTarget, (o) => { updateSettings({ defaultTarget: o.id }); setSelectValue('#setTarget', o.label); }, { searchThreshold: 8 });
  buildSelect('#setQuality', catalogue.quality.map((q) => ({ id: q.id, label: q.label, hint: q.description })), s0().defaultQuality, (o) => { updateSettings({ defaultQuality: o.id }); setSelectValue('#setQuality', o.label); }, { searchThreshold: 99 });
  setSelectValue('#setTarget', labelFor('#setTarget', s0().defaultTarget) || 'Auto detect');
  setSelectValue('#setQuality', labelFor('#setQuality', s0().defaultQuality) || 'Balanced');
}

function s0() { return state.settings; }

/* ── command palette ──────────────────────────────────────────────────── */

const COMMANDS = [
  { id: 'gen', label: 'Generate prompt', hint: 'Create', run: () => { go('create'); runGenerate(); } },
  { id: 'new', label: 'New prompt', hint: 'Create', run: () => { go('create'); $('#composer').value = ''; updateDraft({ input: '' }); $('#composer').focus(); } },
  { id: 'opt', label: 'Optimize an existing prompt', hint: 'Optimize', run: () => go('optimize') },
  { id: 'test', label: 'Test / evaluate prompts', hint: 'Test', run: () => go('test') },
  { id: 'cmp', label: 'Compare prompts', hint: 'Compare', run: () => go('compare') },
  { id: 'tpl', label: 'Open templates', hint: 'Templates', run: () => go('templates') },
  { id: 'lib', label: 'Open library', hint: 'Library', run: () => go('library') },
  { id: 'set', label: 'Settings', hint: 'Settings', run: () => go('settings') },
  { id: 'home', label: 'Go to home', hint: 'Landing', run: () => go('landing') },
  { id: 'theme', label: 'Toggle theme', hint: 'Interface', run: () => { $('#themeBtn').click(); } },
  { id: 'hero', label: 'Rewrite the hero of a page', hint: 'Template', run: () => { go('create'); loadText(TEMPLATES.find((t) => t.id === 'product-designer').text); } },
  { id: 'debug', label: 'Debug something', hint: 'Template', run: () => { go('create'); loadText(TEMPLATES.find((t) => t.id === 'debugging').text); } },
  { id: 'copy', label: 'Copy current prompt', hint: 'Action', run: () => doCopy($('#promptOut')?.textContent || '') },
];

function loadText(text) {
  const ta = $('#composer');
  ta.value = text;
  updateDraft({ input: text });
  autoGrow(ta); updateCounter(); ta.focus();
}

let paletteIndex = 0;
let paletteItems = COMMANDS;

function openPalette() {
  const host = $('#palette');
  host.hidden = false;
  $('#paletteInput').value = '';
  paletteItems = COMMANDS;
  paletteIndex = 0;
  renderPalette();
  $('#paletteInput').focus();
}

function closePalette() { $('#palette').hidden = true; }

function renderPalette() {
  $('#paletteList').innerHTML = paletteItems.map((c, i) => `
    <li role="option" aria-selected="${i === paletteIndex}" data-i="${i}">
      <span>${esc(c.label)}</span><kbd>${esc(c.hint)}</kbd>
    </li>`).join('') || '<li class="empty-opt">No matching action</li>';
  $$('#paletteList li[data-i]').forEach((li) => {
    li.addEventListener('mouseenter', () => { paletteIndex = Number(li.dataset.i); renderPalette(); });
    li.addEventListener('click', () => executeCommand(paletteItems[Number(li.dataset.i)]));
  });
}

function executeCommand(cmd) {
  if (!cmd) return;
  closePalette();
  cmd.run();
}

/* ── shortcuts ────────────────────────────────────────────────────────── */

function bindShortcuts() {
  addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette').hidden ? openPalette() : closePalette(); return; }
    if (e.key === 'Escape') { closePalette(); closeListbox(); return; }

    if (!$('#palette').hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = (paletteIndex + 1) % paletteItems.length; renderPalette(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = (paletteIndex - 1 + paletteItems.length) % paletteItems.length; renderPalette(); }
      else if (e.key === 'Enter') { e.preventDefault(); executeCommand(paletteItems[paletteIndex]); }
      return;
    }

    if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); doCopy($('#promptOut')?.textContent || ''); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (current) saveCurrent(); return; }
    if (mod && e.key === 'Enter' && state.view === 'create') { e.preventDefault(); runGenerate(); }
  });

  $('#paletteInput').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    paletteItems = q ? COMMANDS.filter((c) => (c.label + c.hint).toLowerCase().includes(q)) : COMMANDS;
    paletteIndex = 0;
    renderPalette();
  });

  $('#tplSearch')?.addEventListener('input', debounce((e) => { tplQuery = e.target.value; renderTemplates(); }, 160));
  $('#libSearch')?.addEventListener('input', debounce((e) => { libQuery = e.target.value; renderLibrary(); }, 160));
}

/* ── quick start + landing preview ────────────────────────────────────── */

const EXAMPLES = [
  'Build my portfolio website',
  'Help me prepare for tomorrow’s exam',
  'Analyse this research topic for me',
  'Debug my Python code',
  'Create an image prompt for a poster',
  'Compare these career options',
];

function renderQuickChips() {
  $('#quickChips').innerHTML = EXAMPLES.map((ex) => `<button type="button">${esc(ex)}</button>`).join('');
  $$('#quickChips button').forEach((b) => b.addEventListener('click', () => {
    const ta = $('#composer');
    ta.value = b.textContent;
    updateDraft({ input: ta.value });
    autoGrow(ta); updateCounter();
    ta.focus();
  }));
}

/** Real engine output in the landing transform — never a hand-written mock. */
async function renderLandingPreview() {
  try {
    const r = await generate({ input: 'I need AI to help me build a website for my project', minimal: true });
    const lines = String(r.prompt || '').split('\n').slice(0, 16).join('\n');
    $('#transformPreview').textContent = lines + '\n…';
    $('#transformNote').textContent = `Real engine output · classified as ${r.strategy?.categories?.[0]?.label || 'general'} · ${r.score?.total ?? '—'}/100 · ${r.target?.label || 'Generic AI'}`;
  } catch {
    $('#transformPreview').textContent = 'Engine unavailable in this browser.';
    $('#transformNote').textContent = '';
  }
}

/* ── wiring ───────────────────────────────────────────────────────────── */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

bindCreate();
bindOptimize();
bindTest();
bindSettings();
boot().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<div class="toast bad" style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%)">Failed to start: ${esc(err.message)}</div>`);
});
