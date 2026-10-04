/* PromptNexus web client — vanilla JS, no build step, no dependencies. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  result: null,
  options: { minimal: false, workflow: false, advanced: false },
  answers: {},
  busy: false,
};

const EXAMPLES = [
  'i need help revising for my dbms exam next week, i keep forgetting normalization',
  'my node script that uploads a csv to postgres keeps timing out, i have no idea why',
  'help me write a message to my landlord about the broken heater, i don\'t want to sound rude',
  'should i take the internship in bangalore or stay and finish my final year project?',
  'i want a poster for our college tech fest, neon cyberpunk vibe, instagram size',
  'literature review on the effect of social media on teen mental health, APA, final year',
  'build me a full-stack expense tracker i can actually deploy for free',
];

/* ───────────────── setup ───────────────── */

fetch('./api/targets')
  .then((r) => r.json())
  .then(({ targets }) => {
    const sel = $('#target');
    const sel2 = $('#translateTarget');
    for (const t of targets) {
      const label = t.verified ? `${t.label}` : `${t.label} (assumed)`;
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(t.id)}">Target: ${esc(label)}</option>`);
      sel2.insertAdjacentHTML('beforeend', `<option value="${esc(t.id)}">${esc(t.label)}</option>`);
    }
    sel2.value = 'claude';
  })
  .catch(() => { $('#enginePill').textContent = 'targets unavailable'; });

const ex = $('#examples');
EXAMPLES.forEach((e) => {
  const b = document.createElement('span');
  b.className = 'chip';
  b.textContent = e.length > 46 ? e.slice(0, 44) + '…' : e;
  b.title = e;
  b.onclick = () => { $('#input').value = e; $('#input').focus(); };
  ex.appendChild(b);
});

$$('.chip[data-opt]').forEach((c) => {
  c.onclick = () => {
    const k = c.dataset.opt;
    state.options[k] = !state.options[k];
    c.classList.toggle('on', state.options[k]);
  };
});

$$('#tabs .tab').forEach((t) => {
  t.onclick = () => {
    $$('#tabs .tab').forEach((x) => x.classList.toggle('on', x === t));
    $$('.tabbody').forEach((b) => b.classList.add('hidden'));
    const body = $(`#tab-${t.dataset.tab}`);
    if (body) body.classList.remove('hidden');
  };
});

$('#clearBtn').onclick = () => { $('#input').value = ''; $('#results').classList.add('hidden'); };
$('#goBtn').onclick = run;
$('#input').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); });
$('#copyBtn').onclick = () => copy(state.result?.prompt || '');
$('#downloadBtn').onclick = () => {
  const blob = new Blob([state.result?.prompt || ''], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'promptnexus-prompt.md';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#refineBtn').onclick = () => {
  state.answers = {};
  $$('#questions [data-qid]').forEach((el) => { if (el.value) state.answers[el.dataset.qid] = el.value; });
  run();
};
$$('button[data-tool]').forEach((b) => { b.onclick = () => runTool(b.dataset.tool); });

/* ───────────────── main run ───────────────── */

async function run() {
  const input = $('#input').value.trim();
  if (!input) { $('#input').focus(); return; }
  if (state.busy) return;
  setBusy(true, 'Architecting the prompt…');
  try {
    const res = await fetch('./api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input,
        targetId: $('#target').value || undefined,
        answers: Object.keys(state.answers).length ? state.answers : undefined,
        minimal: state.options.minimal,
        workflow: state.options.workflow,
        advanced: state.options.advanced,
        explain: true,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'generation failed');
    state.result = data;
    render(data);
  } catch (err) {
    alert('Something went wrong: ' + err.message);
  } finally {
    setBusy(false);
  }
}

function setBusy(b, text) {
  state.busy = b;
  $('#goBtn').disabled = b;
  $('#status').classList.toggle('hidden', !b);
  if (text) $('#statusText').textContent = text;
}

/* ───────────────── render ───────────────── */

function render(r) {
  $('#results').classList.remove('hidden');
  $('#goalLine').innerHTML = `<strong>🎯 Understood goal:</strong> ${esc(r.goal || '—')}`;

  $('#resultTags').innerHTML = [
    tag(r.strategy?.categories?.[0]?.label || 'unclassified', ''),
    tag(`level ${r.strategy?.complexity?.level ?? '?'}/5`, 'alt'),
    tag(r.target?.label || 'generic', r.target?.verified ? 'ok' : 'warn'),
    r.mode && r.mode !== 'standard' ? tag(`mode: ${r.mode}`, 'alt') : '',
  ].filter(Boolean).join(' ');

  $('#promptOut').textContent = r.prompt || '';
  $('#promptMeta').textContent = `${(r.prompt || '').length} chars · ${r.strategy?.sections?.length || 0} sections`;

  // questions
  const qs = r.openQuestions || [];
  $('#questionsCard').classList.toggle('hidden', qs.length === 0);
  $('#questions').innerHTML = qs.map((q) => `
    <div class="q">
      <div class="qt">${esc(q.question)} <span class="tag ${q.impact === 'high' ? '' : 'alt'}">${esc(q.impact)} impact</span></div>
      <div>${q.options.map((o) => `<button class="opt" onclick="pick('${q.id}', this)">${esc(o)}</button>`).join('')}</div>
      <div class="small dim" style="margin-top:6px">default: ${esc(q.default)}</div>
      <input type="text" data-qid="${esc(q.id)}" placeholder="or type your own…" style="width:100%;margin-top:8px" />
    </div>`).join('');

  // customisation
  $('#customization').innerHTML = (r.customization || []).map((c) => `
    <div class="kv"><div class="k">${esc(c.field)}<div class="small dim">${esc(c.hint)}</div></div><div class="v">${esc(c.value)}</div></div>`).join('')
    || '<div class="muted small">Nothing to customise — the prompt is already tuned to this request.</div>';

  // reasoning
  $('#rGoal').innerHTML = `<div style="font-size:15px">${esc(r.goal || '')}</div>`;
  $('#rStrategy').innerHTML = `
    <div style="font-size:14px;margin-bottom:10px">${esc(r.strategy?.summary || '')}</div>
    <ul class="tight">${(r.strategy?.rationale || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="small dim" style="margin-top:8px">Sections: ${esc((r.strategy?.sections || []).join(' → '))}</div>`;
  $('#rClass').innerHTML = (r.strategy?.categories || []).map((c) => `
    <div class="kv"><div class="k">${esc(c.label)}</div><div class="v">${c.confidence ? Math.round(c.confidence * 100) + '% match' : 'secondary'}</div></div>`).join('');
  $('#rComplexity').innerHTML = `
    <div class="kv"><div class="k">Level</div><div class="v">${esc(r.strategy?.complexity?.label || '')}</div></div>
    ${(r.strategy?.complexity?.reasons || []).map((x) => `<div class="small muted" style="margin-top:6px">• ${esc(x)}</div>`).join('')}`;
  $('#rTech').innerHTML = (r.strategy?.techniques || []).map((t) => `
    <details><summary>${esc(t.label)} <span class="tag alt">${esc(t.family)}</span> <span class="small dim">cost ${t.cost}</span></summary>
      <div class="small muted" style="margin-top:6px">${esc(t.description)}</div>
      ${t.risk ? `<div class="small" style="margin-top:6px;color:var(--warn)">Risk: ${esc(t.risk)}</div>` : ''}
    </details>`).join('') || '<span class="muted small">No techniques required — this is a single-step task.</span>';
  $('#rFailure').innerHTML = (r.failureModes || []).map((f) => `
    <div class="kv"><div class="k">${esc(f.label)} <span class="small dim">— ${esc(f.risk)}</span></div>
      <div class="v"><span class="tag ${f.status === 'guarded' ? 'ok' : f.status === 'repaired' ? 'warn' : 'alt'}">${esc(f.status)}</span></div></div>`).join('');
  $('#rAssump').innerHTML = `
    ${r.injectionDefense?.applicable ? `<div class="small" style="margin-bottom:8px"><span class="tag ${r.injectionDefense.defended ? 'ok' : 'bad'}">injection defence ${r.injectionDefense.defended ? 'active' : 'not needed'}</span> ${esc(r.injectionDefense.vector)}</div>` : ''}
    ${(r.assumptions || []).map((a) => `<div class="kv"><div class="k">${esc(a.field)}</div><div class="v">${esc(a.assumption)}</div></div>`).join('') || '<div class="muted small">No assumptions were needed.</div>'}
    ${(r.explanation || []).map((p) => `<details><summary>${esc(p.heading)}</summary><ul class="tight">${p.body.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></details>`).join('')}`;

  // quality
  const total = r.score?.total ?? 0;
  const hue = total >= 85 ? 'var(--ok)' : total >= 72 ? 'var(--acc2)' : total >= 58 ? 'var(--warn)' : 'var(--bad)';
  $('#ring').style.background = `conic-gradient(${hue} ${total * 3.6}deg, #1b1f2c 0)`;
  $('#ring').innerHTML = `<div style="width:96px;height:96px;border-radius:50%;background:var(--panel);display:grid;place-items:center"><div style="text-align:center"><div class="num">${total}</div><div class="lab">/ 100</div></div></div>`;
  $('#verdict').textContent = r.score?.verdict || '';
  $('#levers').innerHTML = (r.score?.levers || []).map((l) => `• ${esc(l)}`).join('<br/>');
  $('#calibration').textContent = r.score?.calibration || '';
  $('#dims').innerHTML = (r.score?.dimensions || []).map((d) => `
    <div style="margin-bottom:10px">
      <div class="row between"><span class="small">${esc(d.name)}</span><span class="small dim">${d.score}</span></div>
      <div class="bar"><i style="width:${d.score}%"></i></div>
    </div>`).join('');
  $('#checks').innerHTML = (r.qualityChecks || []).map((c) => `
    <div class="kv"><div class="k">${esc(c.label)}</div><div class="v"><span class="tag ${c.pass ? 'ok' : 'warn'}">${c.pass ? 'pass' : 'watch'}</span><div class="small dim" style="margin-top:4px">${esc(c.note)}</div></div></div>`).join('');
  const notices = [...(r.warnings || []), ...(r.limitations || [])];
  $('#warnCard').classList.toggle('hidden', notices.length === 0);
  $('#warns').innerHTML = notices.map((w) => `<div class="small" style="margin-bottom:7px">• ${esc(w)}</div>`).join('');

  // variants
  $('#variants').innerHTML = (r.variants || []).map((v, i) => `
    <details ${i === 0 ? 'open' : ''}><summary>${esc(v.label)} <span class="small dim">· ${v.tokens} tokens</span></summary>
      <p class="small muted">${esc(v.note)}</p>
      <pre class="promptbox" style="max-height:320px">${esc(v.prompt)}</pre>
      <div class="row" style="margin-top:8px"><button onclick="copy(${JSON.stringify(v.prompt).replace(/"/g, '&quot;')})">Copy this version</button></div>
    </details>`).join('') || '<span class="muted small">No variants for this build.</span>';

  // workflow
  const wf = r.workflow;
  $('#workflow').innerHTML = wf
    ? `<p class="small muted">${esc(wf.why)}</p>${wf.prompts.map((p) => `
        <details><summary>Step ${p.step} — ${esc(p.title)} <span class="small dim">(takes ${esc(p.takes)})</span></summary>
          <pre class="promptbox" style="max-height:280px;margin-top:8px">${esc(p.prompt)}</pre>
          <div class="row" style="margin-top:8px"><button onclick="copy(${JSON.stringify(p.prompt).replace(/"/g, '&quot;')})">Copy step ${p.step}</button></div>
        </details>`).join('')}
       <p class="small dim" style="margin-top:10px">${esc(wf.handoff)}</p>`
    : '<span class="muted small">This task is best served by a single prompt — splitting it would add hand-off risk without adding quality.</span>';

  // handoff json
  $('#handoffOut').textContent = JSON.stringify(r.handoff || {}, null, 2);

  window.scrollTo({ top: $('#results').offsetTop - 70, behavior: 'smooth' });
  $$('#tabs .tab')[0].click();
}

function tag(t, cls) { return `<span class="tag ${cls}">${esc(t)}</span>`; }

window.pick = (qid, el) => {
  const input = document.querySelector(`#questions [data-qid="${qid}"]`);
  if (input) input.value = el.textContent;
  el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
  el.classList.add('on');
};

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('Copied');
  }
}
window.copy = copy;

function toast(msg) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1600);
}

/* ───────────────── prompt tools ───────────────── */

async function runTool(op) {
  const input = $('#toolInput').value.trim();
  if (!input) { $('#toolInput').focus(); return; }
  $('#toolOut').innerHTML = '<span class="spin"></span> analysing…';
  try {
    const res = await fetch('./api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: wrapForTool(op, input),
        targetId: op === 'translate' ? $('#translateTarget').value : $('#target').value || undefined,
        explain: op === 'improve',
      }),
    });
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    $('#toolOut').innerHTML = renderTool(op, r);
  } catch (e) {
    $('#toolOut').innerHTML = `<div class="card err">${esc(e.message)}</div>`;
  }
}

function wrapForTool(op, input) {
  if (op === 'compare') return `compare these two prompts:\n\n${input}`;
  if (op === 'compress') return `compress this prompt:\n\n${input}`;
  if (op === 'test') return `test this prompt:\n\n${input}`;
  if (op === 'expand') return `expand this prompt:\n\n${input}`;
  if (op === 'translate') return `translate this prompt:\n\n${input}`;
  return `improve this prompt:\n\n${input}`;
}

function renderTool(op, r) {
  if (op === 'compress') {
    return `<div class="card">
      <h2>Compressed · ${r.compressed.saved}% smaller</h2>
      <p class="small muted">${r.compressed.words} words · ${r.compressed.tokens} tokens · ${r.compressed.keptRules} rules kept</p>
      <pre class="promptbox">${esc(r.compressed.prompt)}</pre>
      <div class="row" style="margin-top:10px"><button onclick="copy(${JSON.stringify(r.compressed.prompt).replace(/"/g, '&quot;')})">Copy</button></div>
      <details><summary>What was removed (${r.removed.length})</summary><ul class="tight">${r.removed.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul></details>
      <details><summary>Always preserved</summary><ul class="tight">${r.preserved.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul></details>
      ${(r.warnings || []).map((w) => `<p class="small" style="color:var(--warn)">${esc(w)}</p>`).join('')}
    </div>`;
  }
  if (op === 'test') {
    return `<div class="card"><h2>Resiliency ${r.resiliency}/100</h2>
      <table><thead><tr><th>Scenario</th><th>Status</th><th>Likelihood</th><th>What happens</th><th>Patch</th></tr></thead><tbody>
      ${r.scenarios.map((s) => `<tr>
        <td><strong>${esc(s.label)}</strong><div class="small dim">${esc(s.input)}</div></td>
        <td><span class="tag ${s.status === 'guarded' ? 'ok' : s.status === 'partially guarded' ? 'warn' : 'bad'}">${esc(s.status)}</span></td>
        <td>${s.likelihood}%</td>
        <td class="small">${esc(s.failure || '—')}</td>
        <td class="small">${esc(s.patch || '—')}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card"><h2>Hardened version</h2><pre class="promptbox">${esc(r.patchedPrompt)}</pre>
      <div class="row" style="margin-top:10px"><button onclick="copy(${JSON.stringify(r.patchedPrompt).replace(/"/g, '&quot;')})">Copy</button></div></div>`;
  }
  if (op === 'compare') {
    return `<div class="card"><h2>${esc(r.verdict)}</h2>
      <table><thead><tr><th>Dimension</th><th>Prompt A</th><th>Prompt B</th><th>Better</th><th>Gap</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr><td>${esc(x.dimension)}</td><td>${x.a}</td><td>${x.b}</td><td>${esc(x.better === 'A' ? 'Prompt A' : x.better === 'B' ? 'Prompt B' : 'tie')}</td><td>${x.gap}</td></tr>`).join('')}
      </tbody></table>
      <p class="small" style="margin-top:12px"><strong>Recommendation:</strong> ${esc(r.recommendation)}</p>
      <ul class="tight">${(r.reasons || []).map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul></div>`;
  }
  // improve / expand / translate
  const parts = [];
  if (r.original) {
    parts.push(`<div class="card"><h2>Diagnosis of your prompt</h2>
      <p class="small muted">${r.original.stats.words} words · scored ${r.original.score ?? '—'}/100</p>
      <table><thead><tr><th>Issue</th><th>Severity</th><th>Why it matters</th><th>Fix</th></tr></thead><tbody>
      ${(r.improvements || []).map((x) => `<tr><td>${esc(x.issue)}</td><td><span class="tag ${x.severity === 'high' ? 'bad' : x.severity === 'medium' ? 'warn' : 'alt'}">${esc(x.severity)}</span></td><td class="small">${esc(x.why)}</td><td class="small">${esc(x.applied || x.fix)}</td></tr>`).join('')}
      </tbody></table></div>`);
  }
  parts.push(`<div class="card"><h2>${op === 'translate' ? 'Translated prompt' : 'Rebuilt prompt'} ${r.score?.total ? `· ${r.score.total}/100` : ''}</h2>
    ${r.note ? `<p class="small muted">${esc(r.note)}</p>` : ''}
    <pre class="promptbox">${esc(r.prompt)}</pre>
    <div class="row" style="margin-top:10px"><button onclick="copy(${JSON.stringify(r.prompt).replace(/"/g, '&quot;')})">Copy</button></div>
    ${r.comparison ? `<p class="small" style="margin-top:12px">${esc(r.comparison.verdict)}</p>` : ''}</div>`);
  if (r.explanation) {
    parts.push(`<div class="card"><h2>Why this works</h2>${r.explanation.map((p) => `<details><summary>${esc(p.heading)}</summary><ul class="tight">${p.body.map((b) => `<li class="small">${esc(b)}</li>`).join('')}</ul></details>`).join('')}</div>`);
  }
  return parts.join('');
}
