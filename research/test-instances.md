# Where the build gets a test Tracker for every promised version and tier

Research note for the question "Where does a public, open-source build get test instances for every Tracker version and tier the plugin promises, and what does each one cost to keep running?" The matrix comes from [ADR 0003](../docs/adr/0003-support-by-detected-capability.md) and the resolution of issue #10:

- **Self-hosted GitLab** 16.0, 16.11, 17.7, 18.11 and current (19.4 today), each as CE, as EE without a licence, and as EE Premium, plus Ultimate where multi-level epics are tested.
- **GitHub Enterprise Server** 3.18–3.22.
- **github.com and gitlab.com**, on public Projects and on Premium or Ultimate groups.

Terms follow [`CONTEXT.md`](../CONTEXT.md). A "test Tracker" here means a Tracker the build starts or keeps only for testing (the ticket's "test instance").

Researched 2026-09-22. Sources were read at these snapshots:

- GitLab docs at `master` commit `61d50d38` (2026-09-22). GitLab source at `b64a7e48` (`19.5.0-pre`), as in [CAP]. Omnibus docs at `5c19807d`. GitLab handbook at `1baf7a0a`.
- GitHub's docs source at `1d0d9a86` (2026-09-21) and `github/rest-api-description` at `338cb199` (2026-09-18), as in [CAP] and [TL]. `actions/runner` at `80bb1fb8` (latest release v2.337.0).
- Prior art: `python-gitlab` at `a3e37132` (2026-09-21) and `gh` at `5e5cd85e`.

Live checks were read-only ([LV1]–[LV4]). They read Docker Hub tag lists, manifests and image configs through the registry API, the public logs of one `python-gitlab` CI run, and anonymous GraphQL on gitlab.com and github.com. **No image was pulled, no server was started, and no trial, licence or account was requested.** So boot times come from someone else's CI run, not from a run of our own. Facts the earlier notes settle are cited rather than re-checked: [TL] (how Trackers record Links), [HP] (finding the Home Project's Tracker) and [CAP] (what the Map can detect and write).

## Short answer

- **Self-hosted GitLab fits on GitHub's free hosted runners, one test Tracker per job.**
  - Every promised version is still on Docker Hub as CE and EE, from 16.0.10 to 19.4.0 [LV1].
  - A public repository's Linux runner (4 vCPU, 16 GB RAM) is free. `python-gitlab` runs EE on one, first test about 7 minutes in [LV2].
  - The 20-job matrix equals the Free plan's concurrency limit. No dedicated host is needed.
- **Premium and Ultimate licences are the unsettled piece.**
  - Self-managed trials don't suit throwaway Trackers: 30 days, Ultimate only, and a single-use activation code.
  - GitLab for Open Source assumes a public self-managed instance that hosts the Project.
  - A Technology Partner "not for resale" (NFR) licence fits best, if this project can register: 12 months, with "integration testing" allowed.
  - `python-gitlab` mints its own two-day licence under the EE licence's "development and testing" clause: no secret, any tier, but unconfirmed by GitLab.
  - Keys GitLab issues must stay CI secrets.
- **GHES can't run in public CI.** A trial appliance needs 4 vCPU, 32 GB RAM and 900 GB of disk, and its trial and partner licences ask for a company. **Stand in with GitHub's per-version GraphQL schemas (`github/docs`) and OpenAPI descriptions (`github/rest-api-description`).** They settle which fields and paths exist, not runtime behaviour.
- **Fixture Projects:**
  - **github.com:** Free organisations record every GitHub Link kind. Cross-owner Blocks Links need two organisations.
  - **gitlab.com:** Free groups record only Related and task Parent Links. Blocks and epics need Premium, which new public Projects no longer get free. GitLab for Open Source (Ultimate, renewed by hand each year) is the free route, if GitLab accepts a fixture group.
  - Rate limits don't bind. Fork pull requests get no secrets, so live and licensed runs stay on trusted branches.
- **Split:**
  - **Every change:** contract tests, with no secrets and no running Tracker: queries against every version's schema, and the Map on recorded responses.
  - **Main branch and nightly:** reads of the github.com and gitlab.com fixtures.
  - **Before a release:** the full GitLab matrix with Link writes, which re-records the schemas and responses.
  - **Schema and contract tests only:** GHES, GHEC and GitLab Dedicated.

## The matrix at a glance

| Target | Where it can run | Licence or tier from | Money | Upkeep | Suggested tier |
|---|---|---|---|---|---|
| GitLab CE, 5 versions | GitHub-hosted runner, one per job | none | $0 on a public repository [GH10] | Bump "current" monthly [GL24] | Release |
| GitLab EE without a licence, 5 versions | Same | none; without a licence only Free features are on [GL5] | $0 | Same | Release |
| GitLab EE Premium, 5 versions | Same | Unsettled: partner NFR, or a self-generated test licence (section 2) | $0 if either is allowed | NFR renewal every 12 months | Release |
| GitLab EE Ultimate (multi-level epics) | Same | Same, or GitLab for Open Source if GitLab agrees | $0 if allowed | Same | Release |
| github.com, GHEC | github.com fixture organisations | Free plan has every GitHub Link kind [TL] | $0 | Keep fixtures from drifting | Nightly reads; release writes |
| gitlab.com Free | gitlab.com fixture group | Free | $0 | Same | Nightly |
| gitlab.com Premium / Ultimate | gitlab.com fixture group | GitLab for Open Source (Ultimate) or paid | $0 with the programme | Manual renewal every year [GL9] | Nightly |
| GHES 3.18–3.22 | Not in public CI (VM appliance) | Trial (45 days) or partner licences | One VM per release plus licences | Window shifts each quarter [GH7] | Schema only |
| GitLab Dedicated | Not available | — | — | Runs the previous minor release [GL23] | Covered by the matrix only if that release is in it |

## 1. Self-hosted GitLab: images, hardware, CI

### Images per promised version

All five versions are published as `gitlab/gitlab-ce` and `gitlab/gitlab-ee` on Docker Hub, which GitLab's install docs point to [GL3] [DK1]. The registry served a manifest for each tag checked, including 16.0.10 [LV1].

| Version | Last patch tag | Pushed | Download size (amd64, compressed), CE / EE | Architectures |
|---|---|---|---|---|
| 16.0 | `16.0.10-ce.0` / `16.0.10-ee.0` | 2024-09-25 | 1.40 GB / 1.50 GB | amd64 |
| 16.11 | `16.11.10-…` | 2024-09-17 | 1.26 GB / 1.38 GB | amd64 |
| 17.7 | `17.7.7-…` | 2025-03-12 | 1.71 GB / 1.86 GB | amd64 |
| 18.11 | `18.11.11-…` | 2026-08-17 | 1.82 GB / 1.95 GB | amd64, arm64 |
| current | `19.4.0-…` | 2026-09-17 | 1.52 GB / 1.70 GB | amd64, arm64 |

EE without a licence is the same EE image with no licence added. "Current" moves every month, because minor releases ship on the third Thursday [GL24].

Docker Hub allows 100 anonymous pulls every 6 hours per IPv4 address (or IPv6 /64), and 200 when signed in. Its docs mention no exemption for CI [DK2]. A 20-job matrix spreads across runners, so this is unlikely to bind, but it isn't guaranteed.

### Hardware

- **GitLab's baseline for one node is 8 vCPU and 16 GB RAM.** The requirements page adds that "in memory-constrained environments, GitLab can run with at least 8 GB of memory" [GL1].
- **The Omnibus page on memory-constrained environments goes much lower:** 2 GB RAM plus 1 GB swap as the minimum, 2.5 GB plus 1 GB swap as the optimum, and 20 GB of storage, for up to 5 developers [GL2]. It lists the settings and what each saved:
  - `puma['worker_processes'] = 0`: 100–400 MB.
  - Monitoring off (Prometheus and the exporters): 300 MB.
  - `sidekiq['concurrency'] = 10`.
  - Gitaly concurrency limits, and jemalloc decay settings.
- The two pages disagree. A hosted runner's 16 GB meets either one.
- **Give the container 256 MB of `/dev/shm`**, or turn Prometheus off. Docker's default of 64 MB is too small for GitLab's metrics files [GL3].
- GitLab's Docker docs give no boot time, only "the initialization process may take a long time" [GL3]. The best evidence is the `python-gitlab` run in the next section.

### On GitHub-hosted runners

- **Runner:** for public repositories the standard Linux runner has 4 CPUs, 16 GB RAM and 14 GB SSD, and its use "is free and unlimited" [GH10].
- **Limits** on the Free plan [GH11]:
  - 20 concurrent jobs.
  - 6 hours per job.
  - 256 jobs per matrix.
- **Prior art: `python-gitlab`.** It runs its functional tests against `gitlab/gitlab-ee:19.3.2-ee.0` on `ubuntu-24.04` [PA1] [PA2]. It starts the container with Docker Compose from inside its test step (through `pytest-docker`), not as a service container. Its setup:
  - Monitoring is off.
  - It polls readiness every 10 s for up to 300 s.
  - It caps the job at 30 minutes.
- **Timings from its main-branch run of 2026-09-21** [LV2]:
  - Pull and start: about 2 minutes.
  - Then 3 min 21 s of readiness polling ("GitLab container is now ready after 3 minute(s), 21 seconds").
  - A personal access token created through `gitlab-rails runner`: 66 s.
  - First test: about 6.5 minutes after the container started, and 7 minutes into the job.
  - The two jobs took 12 and 19 minutes in all. The shorter one ran 109 tests.
- **Older images have run there too.** Over 2023–2025 the project pinned versions from 16.8 through 18.7, including 16.11 and 17.7 [PA1]. Nothing shows 16.0 booting on today's runners (see open questions).

**As a service container.** This works, with three caveats:

1. **Service containers need a Linux runner.** Their `options` key takes any `docker create` option, so `--shm-size 256m` and the health-check flags can be set [GH12].
2. **The runner waits with no time limit while Docker reports the container as `starting`,** checking again with a back-off from 2 to 32 s. It fails the job if the container turns `unhealthy` [GH13]. The GitLab images declare their own health check: `gitlab-healthcheck` every 60 s, a 30 s timeout, 5 retries and no start period. The config is the same on 16.0.10, 17.7.7 and 19.4.0 [LV1]. Without a start period every failure counts [DK3]. So **a Tracker that isn't ready after about five failed checks fails the job**. Pass `--health-start-period` (or a shorter interval with more retries) in `options`.
3. **Service containers start before the first step,** so the job's checkout can't feed them files. Configuration can go in `GITLAB_OMNIBUS_CONFIG` and the root password in environment variables [PA1]. A licence can be added after boot with `POST /license`, which needs admin and exists at 16.0 and today [GL15].

Starting the container from a step (`docker run` or Compose), as `python-gitlab` does, gives the same result with more control: logs on failure, and the licence written into `/etc/gitlab` before start.

### Lighter ways

- **CE is lighter than EE.** GitLab's own advice when memory is the concern is "install GitLab CE" [GL2]. The matrix needs both anyway.
- **The memory-constrained settings above** trim a few hundred MB. They matter only when several test Trackers share one machine.
- **GDK (GitLab Development Kit) is heavier, not lighter.** It needs at least 16 GB RAM and 30 GB disk. GDK-in-a-box is a download of more than 8 GB and needs 30 GB disk [GL22]. It is built to develop GitLab itself, not to run old releases.
- **Snapshots.** The images declare `/etc/gitlab`, `/var/opt/gitlab` and `/var/log/gitlab` as volumes [LV1], and `docker commit` "do[es] not include any data contained in mounted volumes" [DK4]. BuildKit keeps build-step changes to a declared volume, but the legacy builder discards them [DK3]. The other route is to save a seeded `/var/opt/gitlab` in the Actions cache: 10 GB per repository, and entries unused for 7 days are evicted [GH19]. Whether that saves boot time wasn't tested, since `gitlab-ctl reconfigure` still runs at each start.
- **A dedicated host** would pay off only if boot time became the bottleneck. It adds a machine to patch, and its Trackers drift over time. Nothing above calls for one.

## 2. Premium and Ultimate licences for self-managed EE

Apart from buying, every source except the self-generated licence gives Ultimate or doesn't state the tier. None of them yields a **Premium-only** Tracker, whose epics are licensed but multi-level epics are not. That matters, because [CAP] detects epics and multi-level epics separately.

| Source | Tier | How long | Fits throwaway CI Trackers? | In public CI | Notes |
|---|---|---|---|---|---|
| **Self-managed Ultimate trial** | Ultimate | 30 days, starting when the email arrives | **No.** The activation code "is valid for only one use", and the instance must sync its subscription with GitLab [GL6] | — | Nothing for Premium |
| **GitLab for Open Source** (self-managed) | Ultimate, "self-managed or SaaS" | 1 year. Membership "do[es] not auto-renew"; the same Customers Portal account must reapply [GL9] | **Doubtful.** Applicants "must explain why they need a self-managed solution" and link a publicly accessible namespace on the instance. Use "outside of program requirements" needs written permission [GL9] | Keep secret: the agreement forbids distributing "any access key provided by GitLab" (3.2(d)) and modifying the software (3.2(b)) [GL8] | Rights are "for the purposes of developing and managing Open Source Software" (2.1). The project must not seek profit from the software or related services (2.1.1) [GL8]. Every Project must be publicly visible and OSI-licensed [GL8] [GL10] |
| **Technology Partner NFR licence** | Not stated on the page | 12 months, up to 10 users, SaaS and/or self-managed | **Yes by purpose.** Permitted uses include "Integration testing with related devops products and platforms". Use "in a customer environment" is prohibited [GL11] | Keep secret: the Technology Partner Agreement forbids distributing "any access key" (3.3(e)) [GL12] | Only registered Technology Partners are eligible, through the Partner Portal and the Technology Partner Agreement. Whether a project without a company can register wasn't found |
| **Wider-community contributor licence** | Ultimate by default, marked as a trial | 90 days; renewed for a year after active contributions | Purpose is contributing to GitLab EE code in GDK [GL13] | — | Not meant for testing third-party tools |
| **Self-generated test licence** (`python-gitlab`) | Any plan; they use Ultimate | 2 days, made on every run | **Yes** | **No secret at all** | Generates a key pair, writes the public key over the one GitLab ships in the container, and signs its own licence. Cites the EE licence: "you may copy and modify the Software for development and testing purposes, without requiring a subscription" [PA1] [GL14]. In use since 2022-07-26. GitLab's view wasn't found |
| **Buying Premium or Ultimate** | Either | 1 year | Yes | Keep secret | Price not researched |

Behaviour worth knowing, whatever the source:

- **An expired licence makes the instance read-only.** GitLab "locks features, like Git pushes and issue creation" [GL4]. A lapsed CI licence would break seeding, not just the licensed tests, so the build should check the licence's expiry date first and fail with a clear message.
- **The licence names its holder.** `GET /license` returns `licensee` with a name and email [GL15]. Under the public-ready rule, CI must never print it.
- **Activation codes need online sync. A licence file doesn't** [GL4] [GL5]. For Trackers that exist for 20 minutes, a licence file added through `POST /license` or `gitlab_rails['initial_license_file']` is the workable form.

**Keeping a licence out of public view** (GitHub Actions):

- **Fork pull requests get no secrets.** Apart from `GITHUB_TOKEN`, secrets aren't passed to workflows triggered from forks, and Dependabot runs are treated the same way [GH15].
- **Log redaction "is not guaranteed".** GitHub advises against "structured data as a secret" [GH15]. Store the licence as one base64 line and never echo it. Secrets are capped at 48 KB [GH15].
- **Put it in an environment with required reviewers.** A job can't read environment secrets until a reviewer approves, and required reviewers are available on public repositories on every plan [GH15].
- **Any code in a licensed job can read the licence,** through the admin API or `docker exec`. So licensed jobs must run only trusted code: pushes to the main branch, tags, schedules, or approved environments. Never check out a pull request's code under `pull_request_target` [GH15].

## 3. GitHub Enterprise Server

### Getting GHES

| Route | What it gives | Terms |
|---|---|---|
| **Trial** | A 45-day licence and the appliance download [GH1] | The form asks for a company email address and confirmation of authority to act for the organisation; it offers AWS, Azure, Google Cloud or on-premises [GH2]. Extensions go through sales. Dependabot and GitHub Connect aren't in trials [GH1] |
| **Technology Partner Program** | "5 GitHub Enterprise Server licenses for development and testing" [GH6] | The application asks for company, business website, headquarters and place of incorporation [GH6]. Eligibility for a project without a company isn't stated |
| **Developer Program** | Nothing for GHES today | Until 2026-03-21 the page said to email GitHub "to request developer licenses to build and test your application against GitHub Enterprise Server". That section was removed in `github/docs` commit `409a84c2` [GH5] |
| **Buy** | Licences | — |

**Hardware and images:**

- **Size:** for "Trial, demo, or 10 light users" the minimum is 4 x86-64 vCPUs, 32 GB RAM, 400 GB root disk, a separate 500 GB data disk and 600 IOPS [GH3]. Only x86-64 is supported [GH3].
- **Image formats:** OVA (VMware ESXi), VHD (Hyper-V) and QCOW2 (OpenStack KVM), plus cloud images for AWS, Azure and Google Cloud. "Images obtained from sources other than the channels listed below are not supported" [GH4].
- **No sandbox:** no hosted or sandbox GHES was found in GitHub's docs or programme pages.

**Why it doesn't fit public CI:**

- A hosted runner has half the RAM and 14 GB of disk [GH10], so GHES would need its own VMs.
- The window is five releases. It shifts roughly every quarter: 3.17 is deprecated on 2026-09-22, 3.18 on 2026-10-14, and 3.23 ships on 2026-11-10 [GH7].
- So a real GHES matrix means five licensed appliances, rebuilt as the window moves, on paid VMs. **For an open-source build this isn't realistic.**

### What stands in, and how faithful each is

| Question the Map asks | Stand-in | How faithful |
|---|---|---|
| Does a GraphQL field or mutation exist on GHES 3.x? For example `Issue.blockedBy`, `addSubIssue`, `trackedIssues` | `src/graphql/data/ghes-3.x/schema.docs-enterprise.graphql` in `github/docs`, one per supported release. Check every query the plugin sends against each one with a GraphQL validator, offline | **Exact for the public schema.** The files are synced by automation from each release branch's `schema.docs-enterprise.graphql` [GH8]. They reproduce the facts in [TL]: `blockedBy` from 3.19 only, `addSubIssue` on every release, `trackedIssues` on none. **Deprecated releases are deleted** from `github/docs` (3.16 is already gone), so copy the files into this repository or pin a commit |
| Does a REST path or response key exist? For example sub-issue paths (absent on every GHES), dependency paths (3.19+), `installed_version` in `/api/v3/meta` [HP] | `descriptions/ghes-3.x/ghes-3.x.json` in `github/rest-api-description`: 11 MB bundled for 3.19, kept for every release from 2.18 to 3.22 | **High.** The repository "is automatically kept up to date with the description used to validate GitHub API requests as well as powering contract tests" [GH9]. Known gaps: "Not all headers are described", so the `X-OAuth-Scopes` check in [CAP] can't be contract-tested. Some paths have aliases. 192 inaccuracy reports have been filed, 17 still open [GH9] |
| What comes back when a field is missing? (It decides "can't read" in ADR 0003) | A response recorded from github.com | github.com and gitlab.com both answer HTTP 200 with no `data`, and `errors[].extensions.code: "undefinedField"` with `typeName` and `fieldName` [LV4]. That is the same library's shape on both Trackers. **That GHES answers the same way is assumed, not checked** |
| What comes back for a REST path that doesn't exist? | github.com recording (`404`, `"message": "Not Found"`) [LV4] | Same shape as the OpenAPI `basic-error` component. GHES unverified |
| Permission and token errors, rate-limit headers | github.com recordings | Probably the same on GHES; unverified |
| Anything that depends on data, admin settings or licensing | none | **Not covered.** Only a real GHES would tell |

**Prior art:** `gh` tests its GHES support with hand-written GraphQL introspection responses served by a mock HTTP registry ("GHE with relationship support", "GHE without relationship support"), not with a live GHES [PA3].

**GHEC and `*.ghe.com`:** the github.com and GHEC schema files in `github/docs` are byte-identical at this snapshot [GH8]. So github.com live tests stand in for GHEC's fields. A GHEC trial lasts 30 days [GH18], too short to hold fixtures. Detecting a `*.ghe.com` host can only be unit-tested; `gh` does this [PA3].

## 4. Fixture Projects on github.com and gitlab.com

### github.com

- **Link kinds:** every GitHub Link kind is on the Free plan: Parent Links (sub-issues), Blocks Links (dependencies), and tracked-by from task lists (github.com and GHEC only) [TL].
- **Owners:**
  - A sub-issue must share its parent's owner, but dependencies can cross owners [TL]. So **two fixture organisations** are needed to test a Blocks Link to an Outside Issue owned by another account.
  - **One private repository** is needed to test an Outside Issue the login can't read.
  - Both organisations should belong to the project and have more than one owner.
- **Logins:**
  - **A GitHub App** installed on the fixture organisations gives installation tokens: 5,000 GraphQL points an hour, rising up to 12,500 [GH14]. Its private key is a secret.
  - **A machine account** also works. GitHub's terms allow one free machine account per person, "set up by an individual human … responsible for its actions" [GH16].
  - **`GITHUB_TOKEN`** has permissions "limited to the repository that contains your workflow" [GH15]. Whether it can read another owner's public fixture repositories through GraphQL wasn't checked (see open questions).
- **Drift:**
  - Anyone can comment on a public Issue. Locking the conversation limits comments to people with write access [GH17].
  - **Archiving** a repository makes its Issues and comments "read-only" for everyone [GH17]. Read-only fixtures can be archived, with a separate sandbox repository for write tests.
  - Whether a stranger can attach a Blocks Link to a fixture Issue from their own repository is the open cross-repository question in [CAP].

### gitlab.com

- **Free groups record only Related Links and task Parent Links.** Blocks Links and epics need Premium; multi-level epics need Ultimate [TL] [CAP].
- **New public Projects no longer get paid features for free.**
  - The rule is `open_source_license_granted?`: a public Project in a public namespace, and, on gitlab.com, `legacy_open_source_license_available` set on the Project [GL16].
  - That setting takes its default from an ops feature flag whose gitlab.com state isn't public. It is reset to false when a Project changes visibility or moves group, and for public Projects inactive for a year [GL16].
  - **Live check [LV3]:** 15 public Projects created on gitlab.com on 2026-09-22 inside groups. 12 reported no Blocks. The 3 that reported Blocks sat in top-level groups that had it too. **None had Blocks on its own.** The 4 such Projects in [CAP] came from samples of active and most-starred Projects, not new ones.
- **Routes to Premium or Ultimate for a fixture group:**
  - **GitLab for Open Source** gives Ultimate at no cost [GL7]. Its conditions:
    - It applies to the whole namespace. Every Project in it must be public and carry an OSI-approved licence, with one private Project allowed by default "for security needs" [GL7] [GL9]. That one private Project could hold the unreadable Outside Issue.
    - Renewal is manual and yearly [GL9].
    - It gives Ultimate only, so gitlab.com would have no Premium-only fixture.
    - Whether GitLab accepts a group whose Projects are test fixtures for a tool hosted on GitHub is an open question.
  - **A trial** lasts 30 days, once per group [GL6].
  - Paying.
- **Logins:**
  - Anonymous REST calls for Links return 401 [TL], so CI needs a token.
  - **Group access tokens** need Premium or Ultimate on gitlab.com, are "not available during a trial", and by default expire within 365 days, so they need rotating at least yearly [GL21].
  - Otherwise, a personal token from a bot user, with the `read_api` scope for reads.
- **Archiving** a GitLab project makes its Issues read-only [GL26]. This suits read-only fixtures in the same way as on GitHub.

### Rate limits for CI reads

| Tracker | Login | Limit |
|---|---|---|
| github.com | `GITHUB_TOKEN` | 1,000 REST requests and 1,000 GraphQL points an hour, **per repository**, shared by every job [GH14] |
| github.com | Personal token or machine account | 5,000 an hour [GH14] |
| github.com | GitHub App installation | 5,000 points an hour, up to 12,500 [GH14] |
| github.com | Anonymous | 60 REST requests an hour per IP, and no GraphQL [GH14] [HP] |
| gitlab.com | Any authenticated user | Today: 2,000 API requests a minute. Proposed, not yet in force: Free 5,000 an hour with bursts of 100 a minute; Premium 15,000; Ultimate 25,000 [GL20] |
| gitlab.com | Anonymous | Today: 500 a minute per IP. Proposed: **60 an hour** per IP [GL20] |

Reading a few fixture Projects takes tens to hundreds of requests, so no limit binds. The proposed gitlab.com anonymous limit is one more reason the Map always signs in (ADR 0003, point 5).

**gitlab.com changes first.** "All changes are deployed to GitLab.com before being considered for a self-managed release", several times a day [GL25]. Nightly reads there are the earliest warning that a work-item GraphQL field marked "Experiment" has moved.

## 5. Recommended split

| Tier | Trigger | What runs | Secrets | Cost and time |
|---|---|---|---|---|
| **Contract** | Every push and pull request, forks included | Unit tests of the Map on **recorded responses**. **Every GraphQL query** the plugin sends is validated against the github.com schema, each GHES 3.18–3.22 schema, and the **recorded GitLab schema** for each version × edition. **Every REST path and key** the plugin reads is checked against `api.github.com` and each GHES description. | None | Short; no Tracker started |
| **Live reads** | Push to main, and nightly | Read-only runs over the github.com and gitlab.com fixture Projects, including the Link kinds, Outside Issues, the unreadable Issue, and the detection fields from [CAP] | GitHub App or machine-account token; gitlab.com `read_api` token | Minutes; far below every rate limit |
| **Release** | Before each release, and on a schedule (weekly, say) | The **GitLab matrix**: 5 versions × {CE, EE without a licence, EE Premium, EE Ultimate} = 20 jobs, one test Tracker each. Each job seeds fixtures through the API, runs reads and Link writes (safe, because each Tracker is thrown away), checks the `weight` proxy on EE 16.x and 17.x (ADR 0003), and **re-records** the GitLab schema by introspection and the responses the contract tier uses. Link writes also run on sandbox fixture Projects on github.com and gitlab.com | Licence, unless self-generated; write tokens. In an environment with required reviewers | 20 jobs fill the Free plan's 20 concurrent slots; about 10–20 minutes wall clock (by [LV2]); $0 on a public repository |
| **Schema and contract only** | Part of the contract tier | GHES 3.18–3.22 (fields and paths only; error shapes assumed from github.com). GHEC and `*.ghe.com` (github.com schema; host detection unit-tested). GitLab Dedicated | — | Refresh the GHES files when a release ships or is deprecated, about quarterly [GH7] |

Why the GitLab schemas must be recorded:

- **GitLab publishes no schema file per version.** From 18.9 a running instance serves introspection from `public/-/graphql/introspection_result.json`, but that file is built into the package, not kept in the repository [GL17].
- **The per-tag GraphQL reference is no substitute.** It is Markdown "auto generated" from the schema: 1.6 MB at 16.0 and 4.9 MB at 19.4. It includes EE-only fields such as `WorkItemWidgetLinkedItems.blocked`, so it can't describe CE [GL18].
- **GitLab's OpenAPI file doesn't cover the range.** It has 9 paths at 16.0, 771 at 17.7 and 868 at 19.4, and the Issues list endpoint appears only in 19.4 [GL19].
- So the release tier's introspection of each version × edition is the source. The contract tier reuses it until the next release run.

What this leaves uncovered:

- **GitLab Dedicated** runs "the previous minor version (N-1)" [GL23], on Ultimate. The matrix covers it only if it includes the previous minor on EE Ultimate, which is one more job.
- **The Best-effort band** (GHES before 3.18, GitLab 13.4–15.11) is untested by design (ADR 0003). If it is ever checked, REST descriptions exist back to GHES 2.18 [GH9]. GHES GraphQL schemas for deprecated releases survive only in `github/docs` history.

## Open questions

- **Is a self-generated test licence allowed?** The EE licence lets anyone "copy and modify the Software for development and testing purposes, without requiring a subscription" [GL14], and `python-gitlab` has relied on that since 2022 [PA1]. Whether GitLab reads the clause as covering a swapped licence key in public CI wasn't found. It should be asked in writing before the build depends on it.
- **Can this project get a Technology Partner NFR licence?** Eligibility requires registering as a GitLab Technology Partner [GL11]. The agreement's preamble speaks of "an individual acting on behalf of an entity" [GL12]; whether a maintainer without a company can be a Partner isn't stated. What tier the licence carries, and whether it comes as an offline licence file, isn't stated.
- **Would GitLab for Open Source cover the fixture group,** and CI test Trackers on self-managed with written permission [GL9]?
- **Where does a Premium-only Tracker come from?** Every GitLab-issued route found is Ultimate or unstated. Without one, "epics licensed, multi-level epics not" can be tested only with a self-generated licence, or read-only on some third party's public Premium group, as [CAP] did.
- **Does 16.0 boot within the health-check window on today's hosted runners?** The earliest version `python-gitlab`'s history shows is 16.8 [PA1].
- **Would restoring a seeded `/var/opt/gitlab` from the Actions cache shorten boot?** `reconfigure` still runs at each start.
- **Can `GITHUB_TOKEN` read another owner's public fixture repositories through GraphQL?** The docs say its permissions are limited to its own repository [GH15]. If it can, the github.com live-read tier needs no secret.
- **Do GHES error bodies match github.com's** for an undefined GraphQL field, a missing REST path and a 403? Only a real GHES, or a GHES user willing to run a read-only recorder, can say.
- **Can outsiders add Links to a public fixture Issue** from their own repository or Project? This is the cross-repository permission question from [CAP]. If they can, live assertions should check that expected Links are present, not that the list is exact.

## Sources

Earlier notes:

- **TL** — How Trackers record Links between Issues — <https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md>
- **HP** — Finding the Home Project's Tracker from a local checkout — <https://github.com/romtaugranot/issue-map/blob/research/home-project/research/home-project.md>
- **CAP** — What the Map can detect and write — <https://github.com/romtaugranot/issue-map/blob/research/capabilities/research/capabilities.md>

Live checks, read-only, 2026-09-22:

- **LV1** — Docker Hub:
  - Tag listings for `gitlab/gitlab-ce` and `gitlab/gitlab-ee` (`hub.docker.com/v2/repositories/gitlab/<repo>/tags?name=<minor>.`). Sizes are the amd64 image's compressed `size`.
  - Anonymous registry `HEAD` of manifests for `gitlab-ce:16.0.10-ce.0`, `gitlab-ee:16.0.10-ee.0`, `17.7.7-ee.0` and `19.4.0-ee.0` (all 200).
  - Image config blobs of `gitlab-ee` 16.0.10, 17.7.7 and 19.4.0: `Healthcheck` `gitlab-healthcheck --fail --max-time 10`, Interval 60 s, Timeout 30 s, Retries 5; `Volumes` `/etc/gitlab`, `/var/log/gitlab`, `/var/opt/gitlab`.
- **LV2** — `python-gitlab` workflow run 35550929763 on `main` (commit `a3e37132`, 2026-09-21), jobs `functional (api_func_v4)` and `functional (cli_func_v4)`: step timings through the Actions API, and the public log of the second job — <https://github.com/python-gitlab/python-gitlab/actions/runs/35550929763>
- **LV3** — gitlab.com, anonymous:
  - REST `GET /projects?visibility=public&order_by=created_at` (200 Projects created 04:05–05:01 UTC; 15 in groups).
  - GraphQL `namespace(fullPath:) { availableFeatures { hasBlockedIssuesFeature hasEpicsFeature } }` on each Project and on its top-level group.
- **LV4** — The same query with an unknown field on `Issue`: `gh api graphql` on github.com (`cli/cli#12438`) and anonymous `POST /api/graphql` on gitlab.com (`gitlab-org/gitlab`). Also `gh api` on an unknown REST path under `cli/cli#12438`.

GitLab (docs at <https://gitlab.com/gitlab-org/gitlab/-/tree/61d50d38a807159046987fffe0086e99dcf334df/doc>; source at `b64a7e48`; handbook at <https://gitlab.com/gitlab-com/content-sites/handbook/-/tree/1baf7a0ac9>):

- **GL1** — Installation requirements (8 vCPU, 16 GB baseline; 8 GB in memory-constrained environments) — `doc/install/requirements.md` — <https://docs.gitlab.com/install/requirements/>
- **GL2** — Running GitLab in a memory-constrained environment — omnibus-gitlab `doc/settings/memory_constrained_envs.md` at `5c19807d` — <https://docs.gitlab.com/omnibus/settings/memory_constrained_envs/>
- **GL3** — Install GitLab in a Docker container: installation, configuration, troubleshooting (`/dev/shm`) — `doc/install/docker/` — <https://docs.gitlab.com/install/docker/installation/>
- **GL4** — Activate GitLab EE with a license file (expiry makes the instance read-only) — `doc/administration/license_file.md` — <https://docs.gitlab.com/administration/license_file/>
- **GL5** — Activate GitLab EE with an activation code (without a licence only Free features are on) — `doc/administration/license.md` — <https://docs.gitlab.com/administration/license/>
- **GL6** — Ultimate trials (30 days; single-use activation code; sync required) — `doc/subscriptions/free_trials.md` — <https://docs.gitlab.com/subscriptions/free_trials/>
- **GL7** — Community programs (GitLab for Open Source) — `doc/subscriptions/community_programs.md` — <https://docs.gitlab.com/subscriptions/community_programs/>
- **GL8** — GitLab for Open Source Program Agreement, revised 2022-08-19 — `content/handbook/legal/opensource-agreement.md` — <https://handbook.gitlab.com/handbook/legal/opensource-agreement/>
- **GL9** — GitLab for Open Source Program handbook page and workflows — `content/handbook/marketing/developer-relations/programs/open-source-program/_index.md`, `oss-program-workflows.md` — <https://handbook.gitlab.com/handbook/marketing/developer-relations/programs/open-source-program/>
- **GL10** — Join the GitLab for Open Source Program — <https://about.gitlab.com/solutions/open-source/join/>
- **GL11** — Technology partners: NFR licences — <https://about.gitlab.com/partners/technology-partners/integrate/>
- **GL12** — Technology Partner Agreement (1.6, 1.7, 3.3) — `content/handbook/legal/technology-partner-agreement.md` — <https://handbook.gitlab.com/handbook/legal/technology-partner-agreement/>
- **GL13** — Contributing to GitLab EE (community contributor licence) — `content/handbook/marketing/developer-relations/engineering/community-contributors-workflows.md`; Creating a wider community license — `content/handbook/support/license-and-renewals/workflows/self-managed/creating-wider-community-license.md`
- **GL14** — The GitLab Enterprise Edition (EE) license — `ee/LICENSE` — <https://gitlab.com/gitlab-org/gitlab/-/blob/master/ee/LICENSE>
- **GL15** — License API (`GET /license` with `licensee`; `POST /license`) — `doc/api/license.md` — <https://docs.gitlab.com/api/license/>; `ee/lib/api/license.rb` present at `v16.0.0-ee`
- **GL16** — `ee/app/models/ee/project.rb` (`open_source_license_granted?`, reset on visibility change), `app/models/project_setting.rb` (default from the flag), `config/feature_flags/ops/legacy_open_source_license_available.yml` (14.8, `type: ops`), `ee/app/services/projects/disable_legacy_inactive_projects_service.rb`, `ee/app/services/ee/groups/transfer_service.rb`
- **GL17** — `app/controllers/graphql_controller.rb` (`load_static_schema`, `public/-/graphql/introspection_result.json`)
- **GL18** — GraphQL API reference: `doc/api/graphql/reference/index.md` at `v16.0.0-ee` (1.6 MB), `_index.md` at `v19.4.0-ee` (4.9 MB, "auto generated")
- **GL19** — `doc/api/openapi/openapi_v2.yaml` at `v16.0.0-ee`, `v17.7.0-ee`, `v19.4.0-ee`
- **GL20** — GitLab.com rate limits — `doc/user/gitlab_com/rate_limits.md` — <https://docs.gitlab.com/user/gitlab_com/rate_limits/>
- **GL21** — Group access tokens — `doc/user/group/settings/group_access_tokens.md` — <https://docs.gitlab.com/user/group/settings/group_access_tokens/>
- **GL22** — GDK README at `fe09ff61` (16 GB RAM, 30 GB disk) — <https://gitlab.com/gitlab-org/gitlab-development-kit>; GDK-in-a-box — `doc/development/contributing/first_contribution/configure-dev-env-gdk-in-a-box.md`
- **GL23** — GitLab Dedicated releases and versioning (N-1) — `doc/administration/dedicated/releases.md` — <https://docs.gitlab.com/administration/dedicated/releases/>
- **GL24** — GitLab release and maintenance policy (monthly minor on the third Thursday) — `doc/policy/maintenance.md` — <https://docs.gitlab.com/policy/maintenance/>
- **GL25** — Deployments and releases (GitLab.com gets changes first) — `content/handbook/engineering/deployments-and-releases/_index.md` — <https://handbook.gitlab.com/handbook/engineering/deployments-and-releases/>
- **GL26** — Archive a project — `doc/user/project/working_with_projects.md` — <https://docs.gitlab.com/user/project/working_with_projects/>

Docker:

- **DK1** — Docker Hub `gitlab/gitlab-ce` and `gitlab/gitlab-ee` tags — <https://hub.docker.com/r/gitlab/gitlab-ee/tags>, <https://hub.docker.com/r/gitlab/gitlab-ce/tags>
- **DK2** — Docker Hub usage and limits — <https://docs.docker.com/docker-hub/usage/>
- **DK3** — Dockerfile reference: `HEALTHCHECK` (defaults; start period) and `VOLUME` (build-step changes: discarded by the legacy builder, kept by BuildKit) — <https://docs.docker.com/reference/dockerfile/>
- **DK4** — `docker container commit` — <https://docs.docker.com/reference/cli/docker/container/commit/>

GitHub (docs source at <https://github.com/github/docs/tree/1d0d9a86ebdba79d8a290f81a086727dc2d815f3>):

- **GH1** — Setting up a trial of GitHub Enterprise Server (45 days) — `content/admin/overview/setting-up-a-trial-of-github-enterprise-server.md`
- **GH2** — GitHub Enterprise Server trial form — <https://enterprise.github.com/trial>
- **GH3** — Hardware: `data/reusables/enterprise_installation/hardware-rec-table.md`, `hardware-considerations-all-platforms.md`
- **GH4** — About GitHub Enterprise Server (supported platforms) — `content/admin/overview/about-github-enterprise-server.md`; installing on VMware (OVA), Hyper-V (VHD) and OpenStack KVM (QCOW2) — `content/admin/installing-your-enterprise-server/setting-up-a-github-enterprise-server-instance/`
- **GH5** — GitHub Developer Program — `content/integrations/concepts/github-developer-program.md`; removal of "Take on the enterprise" in commit `409a84c2` (2026-03-21) — <https://github.com/github/docs/commit/409a84c2f0>
- **GH6** — GitHub Technology Partners — <https://github.com/partners/technology-partners>; application form — <https://github.com/partners/apply.html>; Technology Partner terms (updated August 2026) — <https://github.com/partners/technology-partners-terms.html>
- **GH7** — GHES release and deprecation dates — `src/ghes-releases/lib/enterprise-dates.json`, `src/versions/lib/enterprise-server-releases.ts` (supported 3.17–3.22 at this snapshot)
- **GH8** — GraphQL schemas: `src/graphql/data/{fpt,ghec,ghes-3.17…3.22}/` and `src/graphql/data/README.md`
- **GH9** — `github/rest-api-description` at `338cb199`: `descriptions/` (api.github.com, ghec, ghes-2.18 … ghes-3.22), README "Limitations" and "Contributing"; `inaccuracy` label: 192 issues, 17 open on 2026-09-22 — <https://github.com/github/rest-api-description>
- **GH10** — Standard GitHub-hosted runners for public repositories — `data/reusables/actions/supported-github-runners.md` — <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
- **GH11** — Actions limits — `content/actions/reference/limits.md` — <https://docs.github.com/en/actions/reference/limits>
- **GH12** — Service containers: `jobs.<job_id>.services.<service_id>.options` in `content/actions/reference/workflows-and-actions/workflow-syntax.md`; `content/actions/tutorials/use-containerized-services/use-docker-service-containers.md`
- **GH13** — `actions/runner` `src/Runner.Worker/ContainerOperationProvider.cs` (`ContainerHealthcheck`) — <https://github.com/actions/runner/blob/80bb1fb827fa44d489263061e71ef4adba7ad8cd/src/Runner.Worker/ContainerOperationProvider.cs>
- **GH14** — Rate limits for the REST API — `content/rest/using-the-rest-api/rate-limits-for-the-rest-api.md`, `data/reusables/rest-api/primary-rate-limit-*.md`; Rate limits for the GraphQL API — `content/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api.md`
- **GH15** — Secrets and tokens in Actions: `data/reusables/actions/forked-secrets.md`, `data/reusables/actions/workflow-runs-dependabot-note.md`, `content/actions/reference/security/secrets.md` (48 KB; structured data), `content/actions/reference/security/secure-use.md` (redaction "not guaranteed"; `pull_request_target`), `content/actions/reference/workflows-and-actions/deployments-and-environments.md` (required reviewers, environment secrets), `content/actions/concepts/security/github_token.md`
- **GH16** — GitHub Terms of Service, account requirements (machine accounts) — `content/site-policy/github-terms/github-terms-of-service.md`
- **GH17** — Locking conversations — `content/communities/moderating-comments-and-conversations/locking-conversations.md`; Archiving repositories — `content/repositories/archiving-a-github-repository/archiving-repositories.md`
- **GH18** — Setting up a trial of GitHub Enterprise Cloud (30 days) — `content/admin/overview/setting-up-a-trial-of-github-enterprise-cloud.md`
- **GH19** — Dependency caching limits (10 GB, 7 days) — `content/actions/reference/workflows-and-actions/dependency-caching.md`

Prior art:

- **PA1** — `python-gitlab` functional-test fixtures at `a3e37132`: `tests/functional/fixtures/.env` (`gitlab/gitlab-ee:19.3.2-ee.0`), `docker-compose.yml`, `create_license.rb` (added 2022-07-26, "chore: enable using GitLab EE in functional tests"), `set_token.rb`, `tests/functional/conftest.py`; history of `.env` pins — <https://github.com/python-gitlab/python-gitlab/tree/a3e37132d0abe8410d35c393fa4a49d58799ca2d/tests/functional/fixtures>
- **PA2** — `python-gitlab` `.github/workflows/test.yml` (`functional` job on `ubuntu-24.04`, 30-minute timeout) — <https://github.com/python-gitlab/python-gitlab/blob/a3e37132d0abe8410d35c393fa4a49d58799ca2d/.github/workflows/test.yml>
- **PA3** — `gh` `internal/featuredetection/feature_detection_test.go` at `5e5cd85e` — <https://github.com/cli/cli/blob/5e5cd85ea40988abf5c15ec83d90f545151d220e/internal/featuredetection/feature_detection_test.go>

[TL]: https://github.com/romtaugranot/issue-map/blob/research/tracker-links/research/tracker-links.md
[HP]: https://github.com/romtaugranot/issue-map/blob/research/home-project/research/home-project.md
[CAP]: https://github.com/romtaugranot/issue-map/blob/research/capabilities/research/capabilities.md
[LV1]: #sources
[LV2]: https://github.com/python-gitlab/python-gitlab/actions/runs/35550929763
[LV3]: #sources
[LV4]: #sources
[GL1]: https://docs.gitlab.com/install/requirements/
[GL2]: https://docs.gitlab.com/omnibus/settings/memory_constrained_envs/
[GL3]: https://docs.gitlab.com/install/docker/installation/
[GL4]: https://docs.gitlab.com/administration/license_file/
[GL5]: https://docs.gitlab.com/administration/license/
[GL6]: https://docs.gitlab.com/subscriptions/free_trials/
[GL7]: https://docs.gitlab.com/subscriptions/community_programs/
[GL8]: https://handbook.gitlab.com/handbook/legal/opensource-agreement/
[GL9]: https://handbook.gitlab.com/handbook/marketing/developer-relations/programs/open-source-program/
[GL10]: https://about.gitlab.com/solutions/open-source/join/
[GL11]: https://about.gitlab.com/partners/technology-partners/integrate/
[GL12]: https://handbook.gitlab.com/handbook/legal/technology-partner-agreement/
[GL13]: https://handbook.gitlab.com/handbook/marketing/developer-relations/engineering/community-contributors-workflows/
[GL14]: https://gitlab.com/gitlab-org/gitlab/-/blob/master/ee/LICENSE
[GL15]: https://docs.gitlab.com/api/license/
[GL16]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/ee/app/models/ee/project.rb
[GL17]: https://gitlab.com/gitlab-org/gitlab/-/blob/b64a7e488809e53ff3e5c157a824f646d33c4b24/app/controllers/graphql_controller.rb
[GL18]: https://gitlab.com/gitlab-org/gitlab/-/blob/v19.4.0-ee/doc/api/graphql/reference/_index.md
[GL19]: https://gitlab.com/gitlab-org/gitlab/-/blob/v19.4.0-ee/doc/api/openapi/openapi_v2.yaml
[GL20]: https://docs.gitlab.com/user/gitlab_com/rate_limits/
[GL21]: https://docs.gitlab.com/user/group/settings/group_access_tokens/
[GL22]: https://gitlab.com/gitlab-org/gitlab-development-kit
[GL23]: https://docs.gitlab.com/administration/dedicated/releases/
[GL24]: https://docs.gitlab.com/policy/maintenance/
[GL25]: https://handbook.gitlab.com/handbook/engineering/deployments-and-releases/
[GL26]: https://docs.gitlab.com/user/project/working_with_projects/
[DK1]: https://hub.docker.com/r/gitlab/gitlab-ee/tags
[DK2]: https://docs.docker.com/docker-hub/usage/
[DK3]: https://docs.docker.com/reference/dockerfile/
[DK4]: https://docs.docker.com/reference/cli/docker/container/commit/
[GH1]: https://docs.github.com/en/enterprise-server@latest/admin/overview/setting-up-a-trial-of-github-enterprise-server
[GH2]: https://enterprise.github.com/trial
[GH3]: https://github.com/github/docs/blob/1d0d9a86ebdba79d8a290f81a086727dc2d815f3/data/reusables/enterprise_installation/hardware-rec-table.md
[GH4]: https://docs.github.com/en/enterprise-server@latest/admin/overview/about-github-enterprise-server
[GH5]: https://github.com/github/docs/commit/409a84c2f0
[GH6]: https://github.com/partners/technology-partners
[GH7]: https://github.com/github/docs/blob/1d0d9a86ebdba79d8a290f81a086727dc2d815f3/src/ghes-releases/lib/enterprise-dates.json
[GH8]: https://github.com/github/docs/tree/1d0d9a86ebdba79d8a290f81a086727dc2d815f3/src/graphql/data
[GH9]: https://github.com/github/rest-api-description/tree/338cb199baa4f326790b0b1c246d8d4f481a82a0
[GH10]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
[GH11]: https://docs.github.com/en/actions/reference/limits
[GH12]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
[GH13]: https://github.com/actions/runner/blob/80bb1fb827fa44d489263061e71ef4adba7ad8cd/src/Runner.Worker/ContainerOperationProvider.cs
[GH14]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[GH15]: https://docs.github.com/en/actions/reference/security/secure-use
[GH16]: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
[GH17]: https://docs.github.com/en/repositories/archiving-a-github-repository/archiving-repositories
[GH18]: https://docs.github.com/en/enterprise-cloud@latest/admin/overview/setting-up-a-trial-of-github-enterprise-cloud
[GH19]: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
[PA1]: https://github.com/python-gitlab/python-gitlab/tree/a3e37132d0abe8410d35c393fa4a49d58799ca2d/tests/functional/fixtures
[PA2]: https://github.com/python-gitlab/python-gitlab/blob/a3e37132d0abe8410d35c393fa4a49d58799ca2d/.github/workflows/test.yml
[PA3]: https://github.com/cli/cli/blob/5e5cd85ea40988abf5c15ec83d90f545151d220e/internal/featuredetection/feature_detection_test.go
