/**
 * Renderer — turns the assembled section list into the exact text the user
 * pastes into their target AI.
 *
 * Structure adapts to the target: markdown headings for chat models, tagged
 * sections for XML-native models, tight plain text for search-style tools, and
 * a single descriptive block for image/video models.
 */

import { MEDIA_KINDS } from '../knowledge/targets.mjs';

const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/**
 * @param {Array<{title:string,lines:string[]}>} sections
 * @param {{target:object, style?:object}} opts
 * @returns {string}
 */
export function renderPrompt(sections, { target, title } = {}) {
  const format = target?.style?.promptFormat || 'markdown';

  if (format === 'plain') {
    return sections
      .map((s) => s.lines.join('\n'))
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (format === 'xml') {
    const head = title ? `<prompt name="${xmlEscape(title)}">` : '<prompt>';
    const body = sections
      .map((s) => `<${tagFor(s.title)}>\n${s.lines.map((l) => (l.startsWith('-') ? l : l)).join('\n')}\n</${tagFor(s.title)}>`)
      .join('\n\n');
    return `${head}\n${body}\n</prompt>`;
  }

  // markdown (default)
  return sections
    .map((s, i) => `## ${i + 1}. ${s.title}\n${s.lines.join('\n')}`)
    .join('\n\n');
}

function tagFor(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'section';
}

/**
 * Rendering for image/video models: media models want a dense descriptive
 * block plus explicit exclusions, not a fifteen-section specification.
 */
export function renderMediaPrompt(ctx) {
  const m = ctx.media || {};
  const parts = [];
  const target = ctx.target;
  const isSD = target?.id === 'stable-diffusion';

  if (target?.style?.promptFormat === 'descriptive') {
    parts.push(m.prompt);
    if (isSD) {
      // Tag-style models separate the negative field; don't cram negatives into the prompt.
      if (m.parameters?.length) parts.push(m.parameters.join(', '));
    } else if (m.negatives?.length) {
      parts.push(`Do not include: ${m.negatives.join(', ').replace(/\.$/, '')}.`);
    }
    if (m.aspect && !String(m.prompt || '').match(/--ar|aspect/i)) parts.push(`Aspect ratio ${m.aspect}.`);
  } else {
    parts.push(m.prompt);
  }

  let out = parts.filter(Boolean).join('\n\n').trim();

  if (isSD && m.negatives?.length) {
    out += `\n\nNEGATIVE PROMPT: ${m.negatives.join(', ')}`;
  }
  return out;
}

/**
 * Compact "how to use this" footer for copy-ready blocks.
 * Kept short deliberately — the prompt block stays the hero.
 */
export function renderUsage(target, { compressed = false, variants = [] } = {}) {
  const bits = [];
  if (target && !target.generic) bits.push(`Optimised for: ${target.label}`);
  if (compressed) bits.push('Compressed build — see the full version if quality drops.');
  if (variants.length) bits.push(`Alternate builds: ${variants.join(', ')}`);
  return bits;
}

/** Split a prompt into paste-safe chunks without breaking sections. */
export function chunkPrompt(prompt, maxChars = 6000) {
  if (prompt.length <= maxChars) return [prompt];
  const blocks = prompt.split(/\n(?=## )/);
  const chunks = [];
  let cur = '';
  for (const b of blocks) {
    if ((cur + b).length > maxChars && cur) {
      chunks.push(cur.trim());
      cur = b;
    } else {
      cur += (cur ? '\n' : '') + b;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export { MEDIA_KINDS };
