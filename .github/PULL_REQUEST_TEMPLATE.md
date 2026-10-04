## What changed

<!-- One paragraph. What is different now, not a file list. -->

## Why

<!-- The problem this solves. Link the issue if there is one. -->

Closes #

## How it was tested

<!-- Paste the actual output, not a description of it. -->

```
$ npm test
# tests 37
# pass 37
# fail 0

$ npm run build
engine copied → public/engine  (20 modules, browser-safe)
```

## Checklist

- [ ] `npm test` passes
- [ ] `npm run build` passes (the engine is still browser-safe)
- [ ] No dependencies added
- [ ] Logic added to `src/core`, not duplicated in `api/` or `public/`
- [ ] Nothing about the user is invented; unknowns are labelled assumptions
- [ ] No unverified model capability claims added
- [ ] No secrets, keys or `.env` files in the diff

## Risk and uncertainty

<!-- What could break, what you are unsure about, what you deliberately left out. -->

## Screenshots

<!-- For any UI change: light and dark, plus 375px width. -->
