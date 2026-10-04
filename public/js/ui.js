/**
 * Reusable components: searchable listbox, toasts, modal focus handling.
 * No dependency, no framework — plain DOM with full keyboard support.
 */

/* ── listbox ─────────────────────────────────────────────────────────── */

let openListbox = null;

/**
 * Accessible searchable dropdown anchored to a trigger button.
 * @param {{trigger:HTMLElement, groups?:Array, options?:Array, value?:string, placeholder?:string, onSelect:Function, searchThreshold?:number}} cfg
 */
export function listbox(cfg) {
  closeListbox();

  const { trigger, onSelect } = cfg;
  const groups = cfg.groups?.length ? cfg.groups : [{ label: '', options: cfg.options || [] }];
  const flat = groups.flatMap((g) => g.options.map((o) => ({ ...o, group: g.label })));
  const searchable = cfg.searchThreshold === undefined ? flat.length > 7 : flat.length >= cfg.searchThreshold;

  const box = document.createElement('div');
  box.className = 'listbox';
  box.setAttribute('role', 'listbox');
  box.innerHTML = `
    ${searchable ? '<input type="text" placeholder="Search…" aria-label="Search options" autocomplete="off">' : ''}
    <div class="options"></div>`;
  const input = box.querySelector('input');
  const list = box.querySelector('.options');

  let active = Math.max(0, flat.findIndex((o) => o.id === cfg.value));
  let filtered = flat;

  function render() {
    list.innerHTML = '';
    if (!filtered.length) {
      list.innerHTML = '<div class="empty-opt">No matches</div>';
      return;
    }
    let lastGroup = null;
    filtered.forEach((opt, i) => {
      if (opt.group && opt.group !== lastGroup) {
        lastGroup = opt.group;
        const g = document.createElement('div');
        g.className = 'group-label';
        g.textContent = opt.group;
        list.append(g);
      }
      const el = document.createElement('div');
      el.className = 'opt';
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(opt.id === cfg.value));
      el.dataset.active = String(i === active);
      el.innerHTML = `<span>${escapeHtml(opt.label)}</span>${opt.hint ? `<small>${escapeHtml(opt.hint)}</small>` : ''}`;
      el.addEventListener('mouseenter', () => { active = i; render(); });
      el.addEventListener('click', () => choose(opt));
      list.append(el);
    });
    list.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(opt) {
    closeListbox();
    onSelect(opt);
  }

  function move(delta) {
    active = (active + delta + filtered.length) % filtered.length;
    render();
  }

  function onKey(e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Enter': e.preventDefault(); if (filtered[active]) choose(filtered[active]); break;
      case 'Tab': closeListbox(); break;
      case 'Home': e.preventDefault(); active = 0; render(); break;
      case 'End': e.preventDefault(); active = filtered.length - 1; render(); break;
    }
  }

  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeListbox(); trigger.focus(); } });
  document.addEventListener('keydown', onKey, true);
  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      filtered = q ? flat.filter((o) => o.label.toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q)) : flat;
      active = 0;
      render();
    });
  }

  const rect = trigger.getBoundingClientRect();
  box.style.left = `${Math.min(rect.left, window.innerWidth - Math.min(380, window.innerWidth - 16) - 8)}px`;
  const below = window.innerHeight - rect.bottom;
  if (below > 260 || below > rect.top) box.style.top = `${rect.bottom + 6}px`;
  else box.style.bottom = `${window.innerHeight - rect.top + 6}px`;

  document.body.append(box);
  render();
  input?.focus();

  openListbox = () => {
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('resize', closeListbox);
  };
  trigger.setAttribute('aria-expanded', 'true');
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', closeListbox);
  }, 0);

  function onOutside(e) {
    if (!box.contains(e.target) && !trigger.contains(e.target)) closeListbox();
  }
}

export function closeListbox() {
  if (openListbox) { const fn = openListbox; openListbox = null; fn(); }
}

/* ── toasts ──────────────────────────────────────────────────────────── */

export function toast(message, kind = '', ms = 2600) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 200ms'; setTimeout(() => el.remove(), 220); }, ms);
}

/* ── modal helpers ───────────────────────────────────────────────────── */

const restorers = new Map();

export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const previous = document.activeElement;
  el.hidden = false;
  restorers.set(id, previous);
  const focusable = el.querySelector('input, button, textarea, [tabindex]:not([tabindex="-1"])');
  focusable?.focus();
  el.addEventListener('keydown', trap);
  const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeModal(id); } };
  el.addEventListener('keydown', onEsc);
  restorers.set(`${id}:esc`, onEsc);
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = true;
  el.removeEventListener('keydown', trap);
  const onEsc = restorers.get(`${id}:esc`);
  if (onEsc) { el.removeEventListener('keydown', onEsc); restorers.delete(`${id}:esc`); }
  restorers.get(id)?.focus?.();
  restorers.delete(id);
}

function trap(e) {
  if (e.key !== 'Tab') return;
  const nodes = [...e.currentTarget.querySelectorAll('button, input, textarea, [href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ── helpers ─────────────────────────────────────────────────────────── */

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

export function debounce(fn, ms = 180) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
