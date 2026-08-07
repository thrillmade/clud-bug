← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 17:17 - Fork PRs: the Action's gate stops being a job conclusion, so it can finally be neutral (SPEC §6.5)

**Reasoning:** The review job was literally named clud-bug-review, so GitHub minted a check-run under the gate's name from the job's own conclusion. On a fork PR every step is skipped for want of ANTHROPIC_API_KEY, the job exits 0, and the gate went green having reviewed nothing. Two GitHub facts make that unfixable in place: 'The GITHUB_TOKEN has read-only permissions in pull requests from forked repositories', so that run can post neither a check nor a comment; and a job has no neutral conclusion, while 'Required status checks must have a successful, skipped, or neutral status' — so green and skipped both read as satisfied. Renaming the job to 'review' leaves the API-posted check-run as the single producer of clud-bug-review; a new gate job guarantees one exists on every outcome; and clud-bug-fork-notice.yml (pull_request_target, base-repo token, no checkout) owns the fork case, which is the only surface that can write there.

**Alternatives considered:** Flip the fork path to post a neutral check from the existing job. Rejected: on a fork the token is read-only so the POST 403s, and the job's own green would still shadow it — that ships something that looks like a fix and is not. Also rejected: leaving the job named clud-bug-review and adding the notice workflow anyway, which makes the collision worse (two producers, latest-wins).

**Implications:**
- Template v15. Consumers keep clud-bug-review as their required context — what changed is who produces it. clud-bug update now CREATES clud-bug-fork-notice.yml on any repo that has the review workflow; without it a v15 repo would have no fork-PR producer and a required check would hang unsatisfied. Adds a 'skipped' verdict to the shared deriveCheck brain; the App mirrors the conclusion but cannot import it until its clud-bug pin is bumped.

---

