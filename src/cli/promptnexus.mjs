#!/usr/bin/env node
/**
 * PromptNexus CLI.
 *
 *   promptnexus "i need to revise for my dbms exam next week"
 *   promptnexus "build me a portfolio site" --target claude --workflow
 *   promptnexus improve "<paste a prompt>" --json
 *   promptnexus compress "<paste a prompt>"
 *   promptnexus compare "<two prompts>"
 *   promptnexus serve --port 4317
 */

import { readFileSync } from 'node:fs';
import { architect, toText, TARGETS, MODES, analyzePrompt, compressPrompt, testPrompt, comparePrompts, explain } from '../core/index.mjs';
import { generate } from '../core/pipeline/engine.mjs';
import { start } from '../server/server.mjs';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  purple: '\x1b[38;5;141m', cyan: '\x1b[38;5;80m', green: '\x1b[38;5;79m',
  yellow: '\x1b[38;5;221m', red: '\x1b[38;5;210m', grey: '\x1b[38;5;245m',
};
const c = (colour, s) => (process.stdout.isTTY ? `${colour}${s}${C.reset}` : String(s));

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else if (a.startsWith('-') && a.length === 2) {
      flags[a[1]] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

function readStdinIfPiped() {
  if (process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

/** Misuse: the command was named but its required input is missing. */
function misuse(command) {
  console.error(c(C.red, `error: "${command}" needs some text to work on.`));
  console.error(c(C.grey, `  try: promptnexus ${command} "<paste your text here>"`));
  console.error(c(C.dim, '  run `promptnexus --help` for every option'));
  process.exitCode = 1;
}

function usage() {
  console.log(`${c(C.bold, 'PromptNexus')} ${c(C.grey, '— Universal AI Prompt Architect')}

${c(C.bold, 'USAGE')}
  promptnexus "<your situation>"              Build the best prompt for it
  promptnexus improve "<existing prompt>"     Diagnose and rebuild a prompt
  promptnexus expand "<existing prompt>"      Add only what is missing
  promptnexus compress "<existing prompt>"    Keep every constraint, cut the filler
  promptnexus test "<existing prompt>"        Simulate how it fails, then harden it
  promptnexus compare "<two prompts>"         Score both, declare a winner
  promptnexus explain "<your situation>"      Show why the prompt is built that way
  promptnexus targets                         List target model profiles
  promptnexus modes                           List recognised operating modes
  promptnexus serve                           Run the web app + JSON API
  promptnexus demo                            Run a spread of example cases

${c(C.bold, 'FLAGS')}
  --target <id>     Optimise for a specific model (see: promptnexus targets)
  --json            Output the full result object as JSON
  --minimal         Print the prompt only — nothing else
  --why             Show where every line of the prompt came from
  --advanced        Maximum-quality build (adds verification pass)
  --workflow        Force a multi-prompt workflow
  --out <file>      Write the prompt to a file
  --port <n>        Port for serve (default 4317)

${c(C.bold, 'PIPES')}
  cat notes.txt | promptnexus improve --minimal > better-prompt.md
  echo "help me plan a trip to japan" | promptnexus --json | jq .score.total
`);
}


/**
 * `--why` — show where every line of the generated prompt came from.
 * This is the difference between "the engine wrote something" and
 * "the engine can account for every line it wrote".
 */
function printProvenance(result) {
  if (!result.provenance?.length) return;
  console.log(c(C.bold, '\n🔍 WHERE EVERY LINE CAME FROM\n'));
  for (const sec of result.provenance) {
    console.log(c(C.purple, `  ${sec.section}`) + c(C.dim, `   ${sec.lines} line${sec.lines === 1 ? '' : 's'}`));
    for (const t of sec.trace) {
      const colour = /technique/.test(t.source) ? C.cyan
        : /repair/.test(t.source) ? C.yellow
          : /extractor/.test(t.source) ? C.green : C.grey;
      console.log(`    ${c(colour, '[' + shortSource(t.source) + ']')} ${c(C.grey, truncate(t.text, 74))}`);
    }
    console.log('');
  }
  const counts = {};
  for (const sec of result.provenance) for (const t of sec.trace) {
    const k = t.source.split(':')[0];
    counts[k] = (counts[k] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(c(C.bold, '  SUMMARY'));
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.max(1, Math.round((v / total) * 28)));
    console.log(`    ${c(C.grey, k.padEnd(26))} ${c(C.cyan, bar)} ${v} (${Math.round((v / total) * 100)}%)`);
  }
  console.log(c(C.dim, '\n  Every line has a source. Nothing in this prompt was invented without a rule behind it.'));
}

function shortSource(s) {
  if (/technique: (.+)/.test(s)) return 'technique: ' + s.replace(/^technique: /, '').slice(0, 20);
  if (/repair/.test(s)) return 'red-team repair';
  if (/extractor/.test(s)) return 'your words';
  if (/taxonomy/.test(s)) return 'task class';
  if (/output-format/.test(s)) return 'format rule';
  if (/edge-case/.test(s)) return 'edge cases';
  if (/conflict/.test(s)) return 'conflict rule';
  if (/rubric/.test(s)) return 'quality bar';
  if (/capability/.test(s)) return 'capability gate';
  if (/recipe/.test(s)) return 'archetype';
  return s.slice(0, 22);
}

function truncate(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/* ───────────────────────── output helpers ───────────────────────── */

function printResult(result, flags) {
  if (result.error) { console.error(c(C.red, result.error)); process.exitCode = 1; return; }
  if (flags.json) { console.log(JSON.stringify(result, null, 2)); return; }
  if (flags.minimal) { console.log(result.prompt); return; }

  const out = [];
  out.push(c(C.bold, '🎯 UNDERSTOOD GOAL'));
  out.push(result.goal || '—');
  out.push('');
  out.push(c(C.bold, '🧠 STRATEGY'));
  out.push(result.strategy?.summary || '');
  for (const r of result.strategy?.rationale || []) out.push(c(C.grey, `  · ${r}`));
  out.push('');
  out.push(c(C.bold, '📋 FINAL PROMPT'));
  out.push(c(C.cyan, result.prompt));
  if (result.customization?.length) {
    out.push('');
    out.push(c(C.bold, '⚙️  CUSTOMIZATION'));
    for (const x of result.customization.slice(0, 8)) out.push(`  ${c(C.grey, x.field + ':')} ${x.value}`);
  }
  if (result.score?.total != null) {
    const t = result.score.total;
    const colour = t >= 85 ? C.green : t >= 72 ? C.cyan : t >= 58 ? C.yellow : C.red;
    out.push('');
    out.push(c(C.bold, '📊 QUALITY SCORE') + `  ${c(colour, t + '/100')}`);
    out.push(c(C.grey, result.score.verdict));
    for (const l of result.score.levers || []) out.push(c(C.grey, `  → ${l}`));
  }
  if (result.openQuestions?.length) {
    out.push('');
    out.push(c(C.bold, '❓ OPTIONAL — answer these for a sharper prompt'));
    for (const q of result.openQuestions) out.push(`  ${q.question}\n    ${c(C.grey, q.options.join(' | '))}   ${c(C.dim, 'default: ' + q.default)}`);
  }
  const notes = [...(result.warnings || []), ...(result.limitations || [])];
  if (notes.length) {
    out.push('');
    out.push(c(C.bold, '⚠️  NOTES'));
    for (const n of notes) out.push(c(C.grey, `  · ${n}`));
  }
  if (result.repairs?.length) {
    out.push('');
    out.push(c(C.dim, `  repairs applied before delivery: ${result.repairs.length}`));
  }
  console.log(out.join('\n'));
  if (flags.why) printProvenance(result);

  if (flags.out) {
    import('node:fs').then((fs) => {
      fs.writeFileSync(String(flags.out), result.prompt);
      console.error(c(C.green, `\nwrote ${flags.out}`));
    });
  }
}

/* ───────────────────────── commands ───────────────────────── */

function buildOptions(flags) {
  return {
    targetId: flags.target && flags.target !== true ? String(flags.target) : undefined,
    minimal: Boolean(flags.minimal),
    advanced: Boolean(flags.advanced),
    workflow: Boolean(flags.workflow),
    variants: flags.json !== true,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);

  // `--help`/`-h` and a bare invocation are help requests, not misuse: they exit 0.
  const askedForHelp = flags.help || flags.h || argv.length === 0;

  const isCommand = positional[0] && ['improve', 'expand', 'compress', 'test', 'compare', 'explain', 'targets', 'modes', 'serve', 'demo', 'help'].includes(positional[0]);
  if (askedForHelp && !isCommand) return usage();
  let command = 'generate';
  if (isCommand) command = positional.shift();

  const piped = readStdinIfPiped();
  const argText = positional.join(' ').trim();
  const input = argText || piped.trim();

  switch (command) {
    case 'help':
    case '--help':
      return usage();

    case 'targets': {
      console.log(c(C.bold, 'Target profiles') + c(C.grey, '   (verified = conservative generic profile, others are design assumptions)\n'));
      for (const t of TARGETS) {
        const badge = t.verified ? c(C.green, 'verified ') : c(C.yellow, 'assumed  ');
        console.log(`  ${badge} ${t.id.padEnd(18)} ${c(C.grey, t.label)}`);
      }
      console.log(c(C.grey, '\n  Use with: --target <id>'));
      return;
    }

    case 'modes': {
      console.log(c(C.bold, 'Recognised modes\n'));
      for (const m of MODES) console.log(`  ${m.id.padEnd(12)} ${c(C.grey, m.label)} ${c(C.dim, '— ' + m.effect)}`);
      return;
    }

    case 'serve': {
      await start(Number(flags.port && flags.port !== true ? flags.port : process.env.PORT || 4317));
      return;
    }

    case 'demo': {
      const cases = [
        ['Exam revision', 'i need help revising for my dbms exam next week, i keep forgetting normalization'],
        ['Debugging', 'my node script that uploads a csv to postgres keeps timing out and i do not know why'],
        ['Life decision', 'should i take the internship in bangalore or finish my final year project first?'],
        ['Vague request', 'help me with my startup'],
        ['Image', 'a poster for our college tech fest, neon cyberpunk, instagram size'],
        ['Improve', 'improve this prompt: you are a helpful assistant. write me a blog post. make it good.'],
      ];
      for (const [name, text] of cases) {
        const r = generate(text, {});
        console.log(`${c(C.bold, name.padEnd(16))} ${c(C.grey, `mode=${r.mode ?? 'standard'} type=${r.strategy?.categories?.[0]?.id} level=${r.strategy?.complexity?.level} score=${r.score?.total}`)}`);
      }
      return;
    }

    case 'compress': {
      if (!input) return misuse(command);
      const r = compressPrompt(input);
      if (flags.json) return console.log(JSON.stringify(r, null, 2));
      console.log(c(C.bold, `${r.saved}% smaller`) + c(C.grey, `  ${r.before.words} → ${r.after.words} words · ${r.after.tokens} tokens`));
      console.log('\n' + c(C.cyan, r.text));
      if (r.removed.length) {
        console.log('\n' + c(C.bold, 'Removed'));
        for (const x of r.removed.slice(0, 10)) console.log(c(C.grey, `  · ${x}`));
      }
      return;
    }

    case 'test': {
      if (!input) return misuse(command);
      const r = testPrompt(input);
      if (flags.json) return console.log(JSON.stringify(r, null, 2));
      console.log(c(C.bold, `Resiliency ${r.resiliency}/100\n`));
      for (const s of r.scenarios) {
        const colour = s.status === 'guarded' ? C.green : s.status === 'partially guarded' ? C.yellow : C.red;
        console.log(`${c(colour, s.status.padEnd(18))} ${c(C.bold, s.label)} ${c(C.grey, `(${Math.round(s.likelihood * 100)}% likely)`)}`);
        console.log(c(C.grey, `  input:  ${s.input}`));
        console.log(c(C.grey, `  result: ${s.failure}`));
        console.log(c(C.dim, `  patch:  ${s.patch}\n`));
      }
      return;
    }

    case 'compare': {
      if (!input) return misuse(command);
      const [a, b] = input.split(/\n\s*\n\s*(?:vs\.?|versus|and|—)\s*\n\s*\n/i);
      if (!a || !b) {
        const halves = input.split(/\n(?=prompt\s*[b2])/i);
        if (halves.length === 2) return printCompare(halves[0], halves[1], flags);
        console.error(c(C.red, 'Give me two prompts separated by a blank line containing "vs".'));
        process.exitCode = 1;
        return;
      }
      return printCompare(a, b, flags);
    }

    case 'explain': {
      if (!input) return misuse(command);
      const r = architect(input, buildOptions(flags));
      if (flags.json) return console.log(JSON.stringify({ ...r, explanation: explain(r) }, null, 2));
      console.log(toText(r));
      console.log('\n' + c(C.bold, 'EXPLANATION'));
      for (const part of explain(r)) {
        console.log('\n' + c(C.purple, part.heading));
        for (const line of part.body) console.log(c(C.grey, `  • ${line}`));
      }
      return;
    }

    case 'improve':
    case 'expand':
    case 'translate': {
      if (!input) return misuse(command);
      const r = architect(`${command} this prompt:\n\n${input}`, buildOptions(flags));
      if (!flags.json && r.improvements?.length) {
        console.log(c(C.bold, 'DIAGNOSIS'));
        for (const i of r.improvements) {
          const colour = i.severity === 'high' ? C.red : i.severity === 'medium' ? C.yellow : C.grey;
          console.log(`  ${c(colour, i.severity.padEnd(6))} ${i.issue}`);
          console.log(c(C.grey, `         ${i.why}`));
          console.log(c(C.dim, `         fix: ${i.applied || i.fix}`));
        }
        console.log('');
      }
      return printResult(r, flags);
    }

    default: {
      if (!input) return misuse(command);
      const r = architect(input, buildOptions(flags));
      printResult(r, flags);
    }
  }
}

function printCompare(a, b, flags) {
  const cmp = comparePrompts(a, b, { labelA: 'Prompt A', labelB: 'Prompt B' });
  if (flags.json) return console.log(JSON.stringify(cmp, null, 2));
  console.log(c(C.bold, cmp.verdict) + '\n');
  console.log(c(C.grey, 'dimension'.padEnd(22) + 'A'.padStart(5) + 'B'.padStart(7) + '   better'));
  for (const d of Object.keys(cmp.breakdown['Prompt A']).filter((k) => k !== 'overall')) {
    const av = cmp.breakdown['Prompt A'][d];
    const bv = cmp.breakdown['Prompt B'][d];
    const colour = av === bv ? C.grey : av > bv ? C.cyan : C.purple;
    console.log(`${d.padEnd(22)}${String(av).padStart(5)}${String(bv).padStart(7)}   ${c(colour, av === bv ? 'tie' : av > bv ? 'A' : 'B')}`);
  }
  console.log('\n' + c(C.grey, `overall: A ${cmp.scores['Prompt A']} vs B ${cmp.scores['Prompt B']}`));
  if (cmp.reasons.length) console.log('\n' + cmp.reasons.map((r) => c(C.grey, '  · ' + r)).join('\n'));
  console.log('\n' + c(C.bold, 'Notable gaps'));
  if (cmp.uniqueToA.length) console.log(c(C.grey, '  A has: ' + cmp.uniqueToA.join(', ')));
  if (cmp.uniqueToB.length) console.log(c(C.grey, '  B has: ' + cmp.uniqueToB.join(', ')));
}

main().catch((e) => {
  console.error(c(C.red, `error: ${e.message}`));
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
