---
deployment_status: none
deployment_last_assessed: 2026-10-09
deployment_targets: []
---

# T3 fork deployment

The fork deploys nothing. The Mac Mini server it used to run (`ops/mini-fork-alpha`, launchd `com.mimen.t3code.fork-alpha` on port 8446) was retired on 2026-10-08, and its code was removed from the repo.

The fork ships as a desktop app, "T3 Code (Fork)", published as prereleases on `mimen/t3code` with a `nightly-mac.yml` update feed. `FORK.md` names the release command. The npm, Vercel, Cloudflare, and EAS release configuration inherited from upstream stays in the tree, unused, because GitHub Actions is disabled on the fork.
