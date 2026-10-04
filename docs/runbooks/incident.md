# Runbook: incident response

**When:** the application is broken for users, or a security issue is suspected.

---

## 1. Declare

An incident exists when any of these is true:

- `/api/health` returns `ok: false`, or the site does not load
- Generation fails for more than a handful of users
- A security issue is suspected (injection bypass, exposed secret, XSS)
- A provider key may have leaked

**Security issues take priority over everything.** If a secret may be exposed,
rotate first and investigate second.

## 2. Stabilise

| Situation | First action |
|---|---|
| Broken deployment | [Rollback](./rollback.md) — promote the previous deployment |
| Bad data or bad output | Roll back; the engine is deterministic, so a bad output reproduces exactly |
| Suspected key exposure | **Rotate the key in the provider dashboard**, then redeploy with the new value |
| Suspected injection bypass | Check whether the payload reached a prompt; if so, treat the affected output as untrusted and preserve the exact input string as evidence |
| Traffic spike or abuse | Nothing to defend: there is no database and no provider spend unless configured. Raise Vercel limits if needed |

## 3. Assess impact

Answer these in order, briefly:

1. **Who is affected?** Everyone, or one path?
2. **What can they not do?** Generate, copy, save, or nothing at all?
3. **Is data at risk?** There is no server-side user data — so the only possible
   exposure is a provider key, or text in transit.
4. **Was anything wrong output?** Because the engine is deterministic, a bad prompt
   is reproducible from its input. Ask the reporter for the exact input.

## 4. Communicate

Be plain, and do not invent a cause before knowing it.

```
We are aware of an issue affecting <what>. <What still works>.
We are investigating and will update within <time>.
```

Update on a schedule you can keep. Silence is worse than "still investigating".

If the cause was our mistake, say so plainly in the write-up. Users forgive
mistakes; they do not forgive being managed.

## 5. Post-incident review

Written within a week, short, and blameless. Template:

```markdown
## What happened
<two or three sentences, factual>

## Impact
<who was affected, for how long, what they could not do>

## Timeline
- HH:MM  detected
- HH:MM  acknowledged
- HH:MM  mitigated by <action>
- HH:MM  verified resolved

## Cause
<the actual cause, not the proximate trigger>

## Why it was not caught
<which CI gate, test or check should have caught it>

## Actions
- [ ] <specific change, owner, date>
- [ ] <gate added so this class of failure cannot recur>

## What went well
<genuinely — this is how good practices get reinforced>
```

## 6. Close

- [ ] Verify with the [rollback verification block](./rollback.md#verify)
- [ ] Add a regression test using the **exact input** that caused the incident
- [ ] Add or strengthen a CI gate if the failure class was not covered
- [ ] Update this runbook if the response was slow or unclear
- [ ] If a secret was involved, confirm rotation and that the old value is dead

## Escalation

This is a single-maintainer project. If you are not the maintainer and you find a
security issue, use
[private vulnerability reporting](https://github.com/sarfarajmulla-data/promptnexus/security/advisories/new)
rather than a public issue — see [`SECURITY.md`](../../SECURITY.md).

## The one rule

**Rotate secrets before investigating.** An afternoon of forensics is worth
nothing if the key is still live.
