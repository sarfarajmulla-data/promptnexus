# Runbook: rollback

**When:** a deployment is broken and users are affected.
**Target time:** under 2 minutes.

---

## Why this is easy here

There is no database, no migration, and no server-side state. A rollback cannot
leave data inconsistent, because there is no data to be inconsistent. This is the
main operational benefit of having no persistence.

## Fastest path (preferred)

1. Vercel → **Deployments**
2. Find the last known-good deployment
3. **⋯ → Promote to Production**

Takes effect in seconds. No rebuild, no code change.

## By commit

```bash
git revert <bad-commit>          # creates a revert commit, history stays intact
git push origin main             # triggers an automatic production deploy
```

Prefer `git revert` over `--force`. Loud history beats a rewritten branch, and the
revert records that the change was wrong.

## Verify

```bash
BASE=https://<deployment>.vercel.app

curl -s $BASE/api/health | grep -o '"ok":true'
curl -s -o /dev/null -w '%{http_code}\n' $BASE/                       # 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/engine/index.mjs       # 200
curl -s -X POST $BASE/api/generate -H 'content-type: application/json' \
  -d '{"input":"help me revise for my dbms exam"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('score',r.score.total,'chars',r.prompt.length)})"
```

Then in the browser: generate, copy, save, and open the Library.

## If the rollback itself fails

| Symptom | Cause | Action |
|---|---|---|
| Promote does nothing | Deployment from an old commit removed | Revert by commit instead |
| `/engine/index.mjs` 404 after rollback | The build step did not run in that deployment | Roll back further; then investigate `scripts/build-public-engine.mjs` in the bad commit |
| Health red after rollback | The previous deployment was also broken | Roll back to a known-good tag, not merely "the previous one" |
| Cannot identify a good deployment | No release tags | Tag releases (`v1.0.0`) so there is always a named good state |

## Practise it

Do this once, deliberately, before you need it:

1. Deploy a trivial change.
2. Promote the previous deployment.
3. Run the verification block above.
4. Note how long it took.

A rollback you have never performed is a plan, not a capability.

## Prevention

A rollback should be rare because CI blocks the obvious failures: 71 tests, the
zero-dependency assertion, the browser-safety guard, determinism, and an API smoke
test on every pull request. If a broken deploy reaches production, the more useful
question is which gate should have caught it — and then to add that gate.
