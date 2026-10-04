#!/usr/bin/env node
/**
 * Secret scanner.
 *
 * Zero dependencies, deliberately shallow, and tuned for THIS repository: it
 * looks for credentials in the places they actually appear, rather than trying to
 * be a general-purpose entropy scanner that cries wolf until people ignore it.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs              # scan tracked files
 *   node scripts/scan-secrets.mjs --staged     # scan staged files only (pre-commit)
 *   node scripts/scan-secrets.mjs --history    # scan every blob in git history
 *
 * Exit code 1 if anything is found, so it works as a commit or CI gate.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const MODE = process.argv.includes('--history') ? 'history'
  : process.argv.includes('--staged') ? 'staged'
    : 'tree';

/** Patterns that indicate a real credential, with the reason each is dangerous. */
const PATTERNS = [
  [/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/, 'OpenAI-style secret key'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/, 'Anthropic API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/, 'GitLab token'],
  [/\bsk_live_[A-Za-z0-9]{20,}\b/, 'Stripe live key'],
  [/\br8_[A-Za-z0-9]{30,}\b/, 'Replicate token'],
  [/\bhf_[A-Za-z0-9]{30,}\b/, 'Hugging Face token'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm token'],
  [/\bdop_v1_[A-Za-z0-9]{40,}\b/, 'DigitalOcean token'],
  [/\bxai-[A-Za-z0-9]{20,}\b/, 'xAI API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/, 'Stripe live secret'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'JWT'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key'],
  [/\bpostgres(?:ql)?:\/\/[^\s:@"']+:[^\s@"']+@/, 'database URL with password'],
  [/\bmongodb(?:\+srv)?:\/\/[^\s:@"']+:[^\s@"']+@/, 'database URL with password'],
  [/\b(?:https?:\/\/)?[a-z0-9-]+\.supabase\.co\b[^\n]*\b(?:service_role|anon)\b[^\n]*\beyJ/, 'Supabase service key'],
];

/**
 * Strings that look like a credential but are plainly a placeholder.
 *
 * These are tested against the **matched value**, not the whole line. Testing
 * the line was a real false negative: a genuine key sharing a line with the
 * word "placeholder" or the string "example.com" was silently skipped, which
 * would also let a careless `sk-...` paste slip through.
 */
const PLACEHOLDER = [
  /^sk-\.\.\.$/,              // sk-... — documented shorthand
  /^sk-x{3,}$/i,                 // sk-xxx
  /x{5,}/i,                      // xxxxx masking
  /your[-_]?(?:api[-_])?key/i,   // your-api-key
  /placeholder/i,
  /example\.com/i,               // documentation hostnames
  /^<[A-Z_]+>$/,                 // <YOUR_KEY>
  /^\$\{[A-Z_]+\}$/,            // ${PROVIDER_API_KEY}
  /^process\.env\./              // process.env.OPENAI_API_KEY
];

/** Binary and generated files are not worth scanning. */
const SKIP = /\.(png|jpe?g|gif|webp|ico|woff2?|pdf|zip|gz|tgz)$|^public\/engine\/|^\.git\//;

function listFiles() {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (MODE === 'staged') return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
  return git(['ls-files']).split('\n').filter(Boolean);
}

function scanText(text, label) {
  const findings = [];
  const lines = text.split('\n');
  for (const [re, reason] of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = re.exec(line);
      if (!match) continue;
      // Judge only the credential-shaped substring, never the whole line.
      if (PLACEHOLDER.some((a) => a.test(match[0]))) continue;
      findings.push({ label, line: i + 1, reason, excerpt: line.trim().slice(0, 100) });
    }
  }
  return findings;
}

function scanTree() {
  const findings = [];
  for (const file of listFiles()) {
    if (SKIP.test(file)) continue;
    try {
      if (statSync(file).size > 2_000_000) continue;
      findings.push(...scanText(readFileSync(file, 'utf8'), file));
    } catch { /* unreadable or deleted: skip */ }
  }
  return findings;
}

function scanHistory() {
  // Only blob contents, not diffs — a secret removed later is still in history.
  const blobs = execFileSync('git', ['rev-list', '--objects', '--all'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\n')
    .map((l) => l.split(' '))
    .filter(([, path]) => path && !SKIP.test(path));
  const findings = [];
  for (const [sha, path] of blobs) {
    if (!/\.(mjs|js|cjs|json|md|yml|yaml|txt|env|example|sh)$/.test(path)) continue;
    try {
      const text = execFileSync('git', ['cat-file', '-p', sha], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      findings.push(...scanText(text, `${path}@${sha.slice(0, 8)}`));
    } catch { /* blob gone */ }
  }
  return findings;
}

const findings = MODE === 'history' ? scanHistory() : scanTree();

if (findings.length) {
  console.error(`\n✖ Possible secrets found (${MODE} scan):\n`);
  for (const f of findings) {
    console.error(`  ${f.label}:${f.line}  ${f.reason}`);
    console.error(`    ${f.excerpt}\n`);
  }
  console.error('Remove the value, rotate the credential, and commit the removal.');
  console.error('If this is a false positive, widen PLACEHOLDER in scripts/scan-secrets.mjs.\n');
  process.exit(1);
}

console.log(`✓ No secrets found (${MODE} scan, ${MODE === 'history' ? 'history' : listFiles().length + ' files'})`);
