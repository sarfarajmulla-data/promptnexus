# Design brief

The design system as implemented, with the reasoning. Written to be checked against
`public/styles.css`, which is the source of truth.

---

## Direction

**Intelligence, precision, trust, restraint.** A research workstation, not a
dashboard and not a chatbot.

The interface must survive the three-second test on every screen: *where am I, what
do I do, what do I click.* Anything that competes with the composer, the primary
CTA or the generated prompt is removed rather than restyled.

## Principles, in priority order

1. **Usability** — the workflow works before it looks good.
2. **Performance** — fast is a feature; slow is a bug.
3. **Clarity** — one purpose, one primary action per screen.
4. **Professionalism** — reads as a product, not a demo.
5. **Immersion** — atmosphere that supports focus.
6. **Decoration** — last, and usually cut.

## Colour

One accent. Surfaces carry the hierarchy; the accent marks interaction and nothing
else.

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` | `#08090b` | `#f7f8fa` | Page |
| `--bg-deep` | `#050608` | `#eef0f4` | Rail, tab bar |
| `--surface-1` | `#0d0f13` | `#ffffff` | Cards, composer |
| `--surface-2` | `#12151b` | `#f4f6f9` | Inputs, listboxes |
| `--surface-3` | `#171b22` | `#eceff4` | Hover, active segments |
| `--line` / `--line-strong` | `#1d222b` / `#2a313d` | `#e2e6ec` / `#cfd5df` | Dividers, borders |
| `--text` / `--text-2` / `--text-3` | `#e8ebf0` / `#a8b0bd` / `#6b7484` | `#14181f` / `#4d5666` / `#7b8494` | Body, secondary, muted |
| `--accent` | `#4f7fff` | `#2f5fe0` | Primary action, focus, active state |
| `--ok` / `--warn` / `--bad` | `#3ecf8e` / `#e5b567` / `#ef6b6b` | same | Status only |

**Rules.** No rainbow gradients. No gradient on text. `--accent-dim` tints only
meaningful surfaces (selected rail item, focus ring, chips). Status colours never
decorate — they only report.

## Typography

System sans stack (`system-ui`) for everything; monospace for prompt output and
technical values.

| Token | Size | Use |
|---|---|---|
| `--t-3xl` / `--t-2xl` | 52 / 38 px | Landing hero only |
| `--t-xl` | 28 px | Screen titles |
| `--t-lg` | 21 px | Section heads, modal titles |
| `--t-md` | 17 px | Composer input, lede |
| `--t-base` | 15 px | Body |
| `--t-sm` | 13 px | Secondary, buttons |
| `--t-xs` | 11 px | Labels, metadata, counters |

Headings use `-0.02em` tracking and a 560 weight — heavier reads as shouting on a
dark surface. Uppercase is reserved for micro-labels at `0.09em` tracking; never
for sentences.

## Space, radius, elevation

- **Space scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 px (`--s1`…`--s9`).
  Screen padding is `--s8` on desktop, `--s6` on tablet, `--s4` on mobile.
- **Radius:** 8 (small controls) · 12 (buttons, inputs) · 16 (cards) · 22 (composer) · full (chips).
- **Elevation:** three shadows only. `--shadow-1` resting, `--shadow-2` raised (composer, cards on hover), `--shadow-3` floating (modals, palette).
- **Focus:** a two-ring `box-shadow` (background + accent line), never a colour change alone — it must be visible on any surface.

## Components

| Component | States | Notes |
|---|---|---|
| Button | default, hover, active, disabled, loading (`aria-busy`) | Primary, ghost, text, icon, toolbar variants |
| Input / textarea | rest, focus, filled, disabled | Focus ring uses the accent ring, never a border colour alone |
| Select (listbox) | closed, open, active option, selected, searchable, empty | Full keyboard: ↑↓, Enter, Esc, Home, End, type-to-filter |
| Modal | open, closing, focus-trapped | Esc closes, focus returns to the invoking control |
| Toast | info, success, error | Bottom-centre, auto-dismiss, `role="status"` |
| Card | rest, hover, focus-within | Templates, library entries |
| Switch / segmented | on, off, indeterminate | 42×24 px switch; ≥ 24 px touch targets elsewhere |
| Score bar | value-driven | Width transitions once, no continuous animation |
| Empty state | — | Always: explanation + example + action |

## Motion

| Token | Value |
|---|---|
| Standard duration | 190 ms |
| Micro-interactions | 140–220 ms |
| Enter animations (palette, modal) | 220 ms rise, 8 px |
| Easing | `cubic-bezier(.22,.61,.36,1)` |
| Reduced motion | All animation and transition reduced to ~0 ms |

Nothing bounces. Nothing loops indefinitely except the generation spinner and the
ambient field, both of which stop or are removed under reduced motion.

## The ambient field

A 2D canvas particle lattice with depth-of-field and parallax — chosen over WebGL
because it produces the same atmospheric depth without a 600 KB library, a shader
compile stall, or a meaningful GPU cost.

| State | Intensity | What changes |
|---|---|---|
| Idle | 0.35 | Slow drift, no connection lines |
| Typing | 0.55 | Drift speeds up slightly |
| Generating | 0.90 | Faint connection lines appear between near particles |
| Success | 0.60 + one pulse | A single soft radial pulse, then settles |
| Error | 0.25 | Dims; no red, no shake |
| Reduced motion | not rendered | Static background |

Particle count scales with viewport area (40–150). Pointer parallax is capped at
26 px. It is never interactive, never blocks input, and never becomes the focal
point: it sits behind every surface at low opacity.

## Accessibility requirements

- Full keyboard operation; every interactive element is reachable and visible as focused.
- Semantic landmarks (`header`, `nav`, `main`, `aside`) and a skip link.
- Labelled controls; `aria-expanded` / `aria-selected` on custom widgets; `role="status"` on toasts and generation.
- Focus trapped in modals and the palette; restored on close.
- Live regions announce generation stages and results without reading the whole prompt aloud.
- Contrast: body text ≥ 7:1, muted ≥ 4.5:1 in both themes.
- Touch targets ≥ 24 px, ≥ 44 px for the primary CTA and tab bar.
- The ambient field is `aria-hidden` and removed entirely under reduced motion.

## Anti-clutter rules

Applied as architecture, not taste:

1. One dominant purpose and one primary CTA per screen.
2. Secondary actions live behind "More options", menus, or the palette.
3. Whitespace is a feature; empty columns stay empty.
4. No widget merely because a value exists.
5. Every UI element answers: *does this help complete the current task?* If no, it is cut.
6. Mobile subtracts functionality rather than compressing it.
