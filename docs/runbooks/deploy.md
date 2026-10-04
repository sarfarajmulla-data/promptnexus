# Runbook: deploy to Vercel

**Applies to:** production and preview deployments
**Time:** ~5 minutes for the first deploy, ~1 minute thereafter
**Human required:** yes, for the first deploy (account access)

---

## Prerequisites

- A Vercel account (free tier is sufficient — there is no database, no storage,
  and no long-running process)
- Push access to `sarfarajmulla-data/promptnexus`

No API keys are needed. The application runs fully on the deterministic engine
with zero environment variables configured.

---

## First deploy — dashboard

1. Go to **https://vercel.com/new**
2. Import **`sarfarajmulla-data/promptnexus`**
3. Vercel reads `vercel.json` and fills in the settings. **Change nothing.**
   - Build command: `npm run build`
   - Output directory: `public`
   - Framework preset: **Other**
   - Root directory: `./`
4. Leave **Environment Variables** empty.
5. Click **Deploy**.
6. Verify using the checklist below.

## First deploy — CLI

```bash
npm i -g vercel
cd promptnexus
vercel login
vercel link            # accept the detected settings, root = ./
vercel                 # preview
vercel --prod          # production
```

---

## Verify the deploy

Run all five. Do not mark the deploy successful if any fails.

```bash
BASE=https://<your-deployment>.vercel.app

# 1. Engine self-check — must return {"ok":true} with all four checks true
curl -s $BASE/api/health | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))"

# 2. Prompt generation — must return a prompt and a numeric score
curl -s -X POST $BASE/api/generate -H 'content-type: application/json' \
  -d '{"input":"help me revise for my dbms exam"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('score',r.score.total,'chars',r.prompt.length,'cat',r.strategy.categories[0].label)})"

# 3. Browser engine shipped — must be JavaScript, not 404
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/engine/index.mjs

# 4. SPA fallback — must return 200 text/html, not 404
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/library

# 5. Security headers present
curl -sI $BASE/ | grep -iE 'x-content-type-options|referrer-policy|permissions-policy'
```

In the browser, additionally:

- [ ] The header chip reads **No-AI mode** (engine running, no provider)
- [ ] Typing a sentence and pressing **Generate** produces a scored prompt
- [ ] The **Line sources** panel lists sources and percentages
- [ ] `⌘K` opens the command palette; `Esc` closes it
- [ ] A fresh private window shows the three-choice onboarding, and **Skip all** works

---

## How the build works

```
npm run build
  → scripts/build-public-engine.mjs
    1. asserts every module under src/core/ is browser-safe
       (fails the build if any `node:` import or require() appears)
    2. copies src/core/** verbatim to public/engine/**
    3. writes public/engine/BUILD.json with a timestamp and module count
```

`public/engine/` is **gitignored** — it is generated on every deploy. It exists so
the browser can run the engine directly when the API is unreachable. See
[decision 0002](../decisions/0002-browser-runs-the-engine.md).

---

## Rollback

**Instant (recommended):** Vercel dashboard → **Deployments** → select the last
known-good deployment → **⋯ → Promote to Production**. Takes effect in seconds,
no rebuild.

**By commit:**

```bash
git revert <bad-commit>
git push origin main        # triggers an automatic production deploy
```

**Verify after rollback:**

```bash
curl -s $BASE/api/health | grep -o '"ok":true'
```

There is no database and no migration step, so **rollback cannot leave state
inconsistent**. This is the main operational benefit of having no persistence.

---

## If the deploy fails

| Symptom | Likely cause | Fix |
|---|---|---|
| `engine copied` never appears in build logs | Build command overridden in project settings | Set it back to `npm run build` |
| Build fails with "not browser-safe" | A `node:` import was added to `src/core/` | Move the Node-specific code to `api/`; the engine must stay pure |
| 404 on every route including `/` | Output directory wrong | Must be `public`, not `.` or `dist` |
| 404 on `/api/*` | Functions not detected | Confirm `api/*.js` exist at the repo root and export a default handler |
| 404 on `/engine/index.mjs` only | Build step skipped | Check build logs; the file is generated, never committed |
| UI loads but generation fails | Function error | Check **Deployments → Functions** logs; the error is shaped, not a stack trace |
| Everything works but the chip says "degraded" | API unreachable from the browser | Expected behaviour — the local engine took over. Check the function logs |

---

## Cost expectations

| Item | Free tier | Notes |
|---|---|---|
| Static hosting | Included | ~60 KB of HTML/CSS/JS plus the generated engine |
| Serverless invocations | 100 GB-hours / month | Each generate call is well under 1 s of compute |
| Bandwidth | 100 GB / month | The engine is served once per visitor and cached immutably |

With no provider configured there is no per-request cost of any kind. At typical
usage this runs entirely inside the free tier.
