# Finding the Home Project's Tracker from a local checkout

Research for [#5](https://github.com/romtaugranot/issue-map/issues/5). Checked 2026-09-21 against the source and docs of git, `gh`, `glab` and Git Credential Manager (GCM), and against GitHub and GitLab docs. A few facts come from read-only anonymous requests to github.com and gitlab.com made that day; those are marked *observed*. Terms follow [`CONTEXT.md`](../CONTEXT.md).

## Short answer

- **Reading a remote URL is a solved problem. Copy what `gh` and `glab` do.** Both CLIs:
  - read remotes with `git remote -v`, which already applies `insteadOf` rewrites
  - parse scp-like and URL forms, and resolve SSH host aliases with `ssh -G`
  - rank remotes `upstream`, then `github`/`gitlab`, then `origin`, then the rest
  - honour a choice the user saved in git config: `remote.<name>.gh-resolved` or `remote.<name>.glab-resolved-base`

  The plugin should read those saved choices too, so the Map opens on the same Project that `gh` and `glab` already use.
- **The hostname settles only the well-known cases.** These are github.com, `*.ghe.com`, gitlab.com and `*.gitlab-dedicated.com`. Any other host could be GitHub Enterprise Server (GHES), a self-hosted GitLab, or something else. To tell which, check local config first (hosts that `gh` or `glab` know, `GH_HOST`, `GITLAB_HOST`), then send one anonymous request:
  - GitLab answers `/api/v4/...` with its own JSON errors.
  - GHES answers `/api/v3/meta` with `installed_version`.
  - For private Projects, git's `info/refs` endpoint replies `WWW-Authenticate: Basic realm="GitLab"` or `realm="GitHub"`.
- **In a fork, the Issues usually live in the parent.** Every recent public fork of `cli/cli` in a sample of 30 had Issues turned off (*observed*). GitLab forks copy the repository and some settings, but not Issues. Both APIs name the parent. Open on the parent when the fork has Issues off or has none open. Otherwise ask once and remember the answer.
- **Borrow credentials, don't collect them.** Try these in order:
  1. `gh` or `glab`, calling through `gh api` or `glab api` so the plugin never holds a token
  2. environment tokens, sent only to the hosts each CLI would send them to
  3. the git credential helper, run so it cannot prompt
  4. no credentials, for public Projects
  5. only then, ask the user for a new token through a pre-filled, least-scope link
- **The least scope for reading Issues and their Links:**
  - **GitHub:** a fine-grained token with `Issues: read` on the one Project. A classic token needs no scope for public Projects but the full `repo` scope for private ones.
  - **GitLab:** `read_api` (since 12.10) on a personal, project or group token. From 19.2, a fine-grained token with `Project: Read` and `Work Item: Read` is narrower.

  Tokens that users already have are broader: `gh` asks for `repo read:org gist`; `glab` asks for `api` plus `write_repository`. Reusing them is fine as long as the plugin only reads.
- **Reading without a token gets little.**
  - GitHub allows 60 REST requests an hour and no GraphQL at all (the anonymous GraphQL limit is 0, *observed*).
  - GitLab's REST endpoint for issue links needs a token even on public Projects (source, and *observed*). Anonymous GraphQL does return public Links on gitlab.com (*observed*).
- **Realistic GitLab floor: promise 16.0 and later, try to work back to 13.4, and ignore anything older.** GitLab patches only the last three minor releases (19.2 to 19.4 today), and publishes no figures on which versions self-managed instances run. Its own roadmap says users "have a hard time keeping up". Hard evidence of a long tail comes from GitLab's Linux packages, which stop when an operating system does: 16.11 is the last for Ubuntu 18.04, 17.5 for Debian 10, 17.7 for RHEL/CentOS 7 and 18.11 for Ubuntu 20.04. `glab` itself supports GitLab 16.0 and later.

## 1. From a remote URL to a Tracker and a Project

### URL forms git accepts

Git's URL grammar is `ssh://[<user>@]<host>[:<port>]/<path>`, `git://`, `http[s]://`, `ftp[s]://`, plus the scp-like `[<user>@]<host>:<path>`. The scp-like form counts only "if there are no slashes before the first colon". Local paths, `file://` and `<transport>::<address>` (a remote helper) are also valid ([git-clone, GIT URLS](https://git-scm.com/docs/git-clone#_git_urls)).

Read remotes with `git remote -v` or `git remote get-url <name>`, not by reading `remote.<name>.url` from git config. `get-url` expands `insteadOf` and `pushInsteadOf` ([git-remote](https://git-scm.com/docs/git-remote)), and so does `git ls-remote --get-url` ([git-ls-remote](https://git-scm.com/docs/git-ls-remote)). *Observed* with git 2.43: given `url."git@gitlab.example.com:".insteadOf=work:`, a remote `work:group/sub/proj.git` shows in config as written, while `git remote -v` and `get-url` both print `git@gitlab.example.com:group/sub/proj.git`. `gh` reads `git remote -v` ([`git/client.go`](https://github.com/cli/cli/blob/trunk/git/client.go)), and so does `glab` ([`internal/git/git.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/git/git.go)).

`gh` normalises URLs in [`git/url.go`](https://github.com/cli/cli/blob/trunk/git/url.go):
- It rewrites the scp-like form to `ssh://` and maps `git+ssh`/`git+https` to `ssh`/`https`.
- It drops the SSH port.

Local paths and remote-helper URLs are not Projects. Skip them.

### Examples

| What `git remote -v` prints | Host of the Tracker | Project |
|---|---|---|
| `git@github.com:cli/cli.git` | github.com | `cli/cli` |
| `https://github.com/cli/cli` | github.com | `cli/cli` |
| `ssh://git@ssh.github.com:443/cli/cli.git` | github.com (port-443 SSH host) | `cli/cli` |
| `SUBDOMAIN@SUBDOMAIN.ghe.com:OWNER/REPO.git` | `SUBDOMAIN.ghe.com`, API at `api.SUBDOMAIN.ghe.com` | `OWNER/REPO` |
| `git@gitlab.com:gitlab-org/cli.git` | gitlab.com | `gitlab-org/cli` |
| `ssh://git@altssh.gitlab.com:443/gitlab-org/cli.git` | gitlab.com (port-443 SSH host) | `gitlab-org/cli` |
| `ssh://git@gitlab.example.com:2222/group/sub/project.git` | `gitlab.example.com` | `group/sub/project` |
| `https://example.com/gitlab/group/project.git` | `example.com`, with either a relative URL root `/gitlab` or a top-level group `gitlab`. A probe decides | `group/project` or `gitlab/group/project` |
| `my-alias:group/project.git`, where `my-alias` is a `Host` in the user's SSH config | the `hostname` that `ssh -G my-alias` prints | `group/project` |
| `/srv/git/project.git`, `file:///…` | none: a local remote | — |
| `hg::https://…` | unknown: a remote helper | — |

Rules behind the table:

- **The user and port are not part of the identity. Drop them.** GHE.com uses the subdomain as the SSH user instead of `git` ([GHE.com network details](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom)).
- **An HTTPS remote can hold a secret** (`https://user:TOKEN@host/...`). Strip the userinfo, never print or log a raw remote URL, and don't reuse that token without the user's say-so.
- **SSH host aliases.** Resolve an SSH host through `ssh -G <host>` and take its `hostname` line ([ssh(1)](https://man.openbsd.org/ssh)). `gh` does exactly this ([`go-gh/pkg/ssh`](https://github.com/cli/go-gh/blob/trunk/pkg/ssh/ssh.go)). *Observed*: with OpenSSH 9.6, a `Host` alias resolved to its `HostName` and `Port`. `ssh -G` only reads config; it does not connect.
- **Port-443 SSH hosts.** Map `ssh.github.com` to `github.com` (GitHub's port-443 SSH host, per [GitHub docs](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port)). `gh` already does, and it folds every `*.github.com` into `github.com` ([`go-gh/pkg/auth`](https://github.com/cli/go-gh/blob/trunk/pkg/auth/auth.go)). Map `altssh.gitlab.com:443` to `gitlab.com` ([GitLab.com settings](https://docs.gitlab.com/user/gitlab_com/)).
- **Self-hosted GitLab with a separate SSH host.** Such an instance may answer SSH on another hostname. `glab` records that per host as `ssh_host` (`GITLAB_SSH_HOST`), alongside `api_host`, `api_protocol` and `subfolder` for the relative URL root ([`internal/config/schema.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/config/schema.go)). Where `glab` knows a host, use its mapping.
- **Paths.** Trim the leading and trailing `/`, a trailing `.git`, and a `.wiki` suffix (wiki remotes).
  - On GitHub the path must be exactly `OWNER/REPO`.
  - On GitLab the whole path is the Project, because groups nest up to 20 levels ([subgroups](https://docs.gitlab.com/user/group/subgroups/)). When calling the API, URL-encode it as one segment (`group%2Fsub%2Fproject`) ([namespaced paths](https://docs.gitlab.com/api/rest/#namespaced-paths)).
  - A self-hosted GitLab may sit under a relative URL root of any depth, such as `https://example.com/gitlab` ([relative URL](https://docs.gitlab.com/install/relative_url/)). HTTPS remotes then carry the root in their path, while SSH remotes do not.
- **Use the Project name the API returns, not the one in the URL.** Both Trackers redirect old paths after a rename or transfer ([GitHub: follow redirects](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects); [GitLab: path changes](https://docs.gitlab.com/user/project/working_with_projects/)). Once a request succeeds, key the Project on `full_name` (GitHub), or on `path_with_namespace` plus the numeric `id` (GitLab).

### Which Tracker is at a host

Work through these in order and stop at the first answer. No credential goes to any host until this has settled which Tracker it is.

1. **Well-known names (no network).**
   - `github.com`, or any `*.github.com`, is GitHub. The REST API is at `api.github.com`.
   - `*.ghe.com` is GitHub Enterprise Cloud with data residency. The API is at `api.<host>`. `gh` treats it as "tenancy", not GHES ([`internal/ghinstance/host.go`](https://github.com/cli/cli/blob/trunk/internal/ghinstance/host.go)).
   - `gitlab.com` is GitLab.
   - `*.gitlab-dedicated.com` is GitLab Dedicated. A Dedicated instance can also use a custom domain ([Dedicated network security](https://docs.gitlab.com/administration/dedicated/configure_instance/network_security/)).
2. **Local configuration (no network).**
   - The host is GitHub if `gh` knows it or it equals `GH_HOST`. `gh auth status --hostname H` exits 1 when that host has an authentication problem; `--json` lists known hosts without printing tokens ([gh auth status](https://cli.github.com/manual/gh_auth_status)). A GHES API lives at `https://H/api/v3/` and `https://H/api/graphql` ([`host.go`](https://github.com/cli/cli/blob/trunk/internal/ghinstance/host.go)).
   - The host is GitLab if `glab` knows it (`glab auth status --hostname H`, [docs](https://docs.gitlab.com/cli/auth/status/)), if it equals `GITLAB_HOST`, or if it is a configured `ssh_host`. Take `api_host`, `api_protocol` and `subfolder` from `glab`.
   - GCM's `credential.<url>.provider=github|gitlab` is also a statement by the user ([GCM GitLab docs](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/gitlab.md)).
   - Ask the CLIs rather than reading their files, because those files can hold plaintext tokens.
3. **One anonymous HTTPS probe (no credentials).** The two requests can run in parallel.
   - **GHES:** send `GET https://H/api/v3/meta`. It can be "used without authentication" and returns `installed_version` ([GHES meta](https://docs.github.com/en/enterprise-server@latest/rest/meta/meta)). GHES responses carry `X-GitHub-Enterprise-Version: enterprise-server@3.x.y` ([GHES enterprise admin](https://docs.github.com/en/enterprise-server@latest/rest/enterprise-admin)).
     - An internet-facing GHES must run in private mode, where every user has to sign in ([private mode](https://docs.github.com/en/enterprise-server@latest/admin/configuring-settings/hardening-security-for-your-enterprise/enabling-private-mode)). Such an instance may answer 401. The `X-GitHub-Request-Id` header still marks it as GitHub: that header is how GCM recognises "GitHub.com/GHES" ([`GitHubHostProvider.cs`](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitHub/GitHubHostProvider.cs)).
   - **GitLab:** send `GET https://H{root}/api/v4/projects/{encoded path}`. GitLab answers in JSON with one of these (all *observed* on gitlab.com):
     - 200 with `path_with_namespace`, for a public Project
     - 404 `{"message":"404 Project Not Found"}`, for a private or missing Project
     - 401 `{"message":"401 Unauthorized"}`. GitLab documents this 401 body for every endpoint ([REST authentication](https://docs.gitlab.com/api/rest/authentication/)).

     For an HTTPS remote with extra path segments, try each leading segment as `{root}`, starting with no root. When nothing is at the right prefix, the web server returns an HTML 404, not GitLab's JSON.
   - **Fallback that needs only the remote URL:** send `GET <https remote>/info/refs?service=git-upload-pack`. For a private or missing Project the answer is 401, with a challenge that names the Tracker:
     - GitLab sends `WWW-Authenticate: Basic realm="GitLab"`. The string is hard-coded in GitLab's git HTTP controller in 11.0, 13.0 and today's code ([source](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/controllers/repositories/git_http_client_controller.rb)), and gitlab.com sends it (*observed*).
     - github.com sends `realm="GitHub"` (*observed*; GHES not checked).

     Public Projects answer 200 with no challenge, so this helps only for private ones.
   - A host name that starts with `gitlab.` or `github.` is a hint and nothing more. GCM uses it as one ([`GitLabHostProvider.cs`](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitLab/GitLabHostProvider.cs)).
   - Send probes over HTTPS only. Probe over plain HTTP only when the remote itself uses HTTP, and never send credentials over HTTP.
4. **Otherwise the host is "something else"**, for example Bitbucket, Azure DevOps, Gitea/Forgejo or a plain SSH server. Name the host, say the Map can't open on it, and offer to open a Project by URL instead.
   - For an SSH-only host that has nothing at the same name over HTTPS, steps 1–2 are the only way to identify it.
   - `ssh -T git@H` would identify the Tracker from its greeting: "Welcome to GitLab, @user!" ([GitLab](https://docs.gitlab.com/user/ssh/)), or "...GitHub does not provide shell access." ([GitHub](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection)). But it logs in with the user's keys and can prompt for a passphrase or a hardware-key touch. Use it only when the user asks.

**Reading the version** needs a token on GitLab.
- `GET /api/v4/version` exists in every version since 8.13 and "responds with `200 OK` for authenticated users" ([Version API, 16.0 docs](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/doc/api/version.md)). Anonymous calls get 401 (*observed*).
- `GET /api/v4/metadata` exists from 15.2 ([Metadata API, 16.0 docs](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/doc/api/metadata.md)). Today it also accepts a `read_user` token for GET ([`lib/api/metadata.rb`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/api/metadata.rb)).
- Anonymous GraphQL `metadata { version }` returns `null` (*observed*).
- On GHES, `installed_version` and the header above give the version without a token.

### Choosing the Home Project when there are several remotes

1. **A saved choice wins.** First comes the plugin's own saved choice for this checkout. Then come the choices `gh` and `glab` save:
   - `gh repo set-default` writes `remote.<name>.gh-resolved`, as `base` or `OWNER/REPO`. `gh` checks it before anything else ([`context/context.go`](https://github.com/cli/cli/blob/trunk/context/context.go), [gh repo set-default](https://cli.github.com/manual/gh_repo_set-default)).
   - `glab` reads `remote.<name>.glab-resolved-base`, as `base` or `base:PATH`, and the older `remote.<name>.glab-resolved` ([`internal/glrepo/resolver.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/glrepo/resolver.go), [`internal/git/git.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/git/git.go)).
   - `GH_REPO` and `GITLAB_REPO` are the CLIs' per-command overrides ([gh environment](https://cli.github.com/manual/gh_help_environment), [`envvars.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/config/envvars.go)). Honour them if set.
2. **Map every remote** to a (Tracker, host, Project), using the fetch URL and falling back to the push URL as both CLIs do ([`context/remote.go`](https://github.com/cli/cli/blob/trunk/context/remote.go), [`glrepo/remote.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/glrepo/remote.go)). Drop the remotes that aren't Trackers and remove duplicates.
   - Unlike `gh`, don't drop remotes on hosts you have no credentials for. `gh` keeps only remotes on authenticated hosts ([`factory/remote_resolver.go`](https://github.com/cli/cli/blob/trunk/pkg/cmd/factory/remote_resolver.go)), but a public Project can be read without a login.
3. **If one remains, it is the Home Project.**
4. **If several remain, rank them by name:** `upstream`, then `github` (or `gitlab`), then `origin`, then the rest. Both CLIs use this order ([`context/remote.go`](https://github.com/cli/cli/blob/trunk/context/remote.go), [`glrepo/remote.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/glrepo/remote.go)). Break ties with git's own order, so the result is the same on every run.
5. **Check for a fork** with one API call per leading candidate. If the candidate is a fork, and either it has Issues off or none open, or its parent is also a candidate, open on the parent.
   - **GitHub:** `fork`, `has_issues`, `parent` and `source`. "parent is the repository this repository was forked from, source is the ultimate source for the network" ([Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)). A fork has its own Issues ([about forks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-forks)). All 30 of the newest public forks of `cli/cli` had `has_issues: false` (*observed*), but the docs don't state that default.
   - **GitLab:** `forked_from_project` (a token is needed when the parent is private), `issues_access_level` and `open_issues_count` ([Projects API](https://docs.gitlab.com/api/projects/)). A fork holds "a copy of the upstream project's repository and some project settings, but not project content like issues" ([forking workflow](https://docs.gitlab.com/user/project/repository/forking_workflow/)). Anonymous responses leave these fields out (*observed*), so on GitLab fork detection needs a token.
   - `gh` and `glab` do the same when they may prompt: they add each remote's parent to the list of choices ([`context.go`](https://github.com/cli/cli/blob/trunk/context/context.go), [`resolver.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/glrepo/resolver.go)).
6. **If it is still ambiguous, don't block.** That happens, for example, when both the fork and its parent have open Issues, or when the same code is mirrored on GitHub and GitLab.
   - Open on the best guess, show the alternatives beside the Map, and save the user's pick.
   - `gh` instead refuses and asks for `gh repo set-default` whenever the remotes and their parents give more than one Project. When it can't prompt, it quietly takes the first sorted remote ([`context.go`](https://github.com/cli/cli/blob/trunk/context/context.go)).
7. **When calling `gh` or `glab`, always name the Project and host** (`gh api --hostname H repos/OWNER/REPO/...`, `glab api --hostname H projects/<id>/...`). Otherwise their own remote resolution can disagree with the Map's.

In CI, the Project is already named: `GITHUB_REPOSITORY` in GitHub Actions ([variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)), `CI_PROJECT_PATH` in GitLab CI ([predefined variables](https://docs.gitlab.com/ci/variables/predefined_variables/)). Remotes don't need parsing there.

## 2. Reading Issues with credentials the user already has

### Where credentials come from, in order

| # | Source | GitHub | GitLab |
|---|---|---|---|
| 1 | **The CLI's login** | If `gh auth status --hostname H` succeeds, call through `gh api --hostname H`, for REST or `graphql` ([gh api](https://cli.github.com/manual/gh_api)). The plugin never sees the token. If it needs a raw token for its own HTTP client, `gh auth token --hostname H` prints it ([gh auth token](https://cli.github.com/manual/gh_auth_token)). | If `glab auth status --hostname H` succeeds, call through `glab api --hostname H`, for REST or `graphql` ([glab api](https://docs.gitlab.com/cli/api/)). `glab` has no `auth token` command; `glab auth status --show-token` prints it ([glab auth status](https://docs.gitlab.com/cli/auth/status/)). |
| 2 | **Environment tokens** | `GH_TOKEN`, then `GITHUB_TOKEN`, go only to github.com and `*.ghe.com`. `GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN`, go only to GHES ([gh environment](https://cli.github.com/manual/gh_help_environment)). | `GITLAB_TOKEN`, then `GITLAB_ACCESS_TOKEN`, then `OAUTH_TOKEN`. They beat stored credentials and are "not scoped per host" ([glab authentication](https://docs.gitlab.com/cli/authentication/)). |
| 3 | **git credential helper** | `git credential fill` with `protocol=https`, `host=H` ([git-credential](https://git-scm.com/docs/git-credential)). What comes back is a token: GitHub doesn't accept passwords ([REST auth](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)). GCM's GitHub OAuth token has `repo gist workflow` ([`GitHubConstants.cs`](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitHub/GitHubConstants.cs)). | Same call. What comes back may be a personal token of unknown scope, or a GCM OAuth token scoped only to `write_repository read_repository` ([`GitLabHostProvider.cs`](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitLab/GitLabHostProvider.cs)). Those scopes cover git and the repository files API, not Issues ([scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/)). Try one cheap read and drop the token quietly on 401 or 403. |
| 4 | **Nothing** | Public Projects only. REST allows 60 requests an hour per IP ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). GraphQL is unavailable: `/rate_limit` reports a `graphql` limit of 0 for anonymous callers (*observed*). The `dependencies` and `sub_issues` endpoints do answer anonymously for public Projects ([dependencies](https://docs.github.com/en/rest/issues/issue-dependencies), [sub-issues](https://docs.github.com/en/rest/issues/sub-issues)). | Public Projects only. The issue list works anonymously. REST issue links do not: `lib/api/issue_links.rb` starts with `before { authenticate! }` ([source](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/api/issue_links.rb)), and anonymous calls get 401 on gitlab.com (*observed*). Anonymous GraphQL does return work-item Links for public Projects (*observed*). gitlab.com allows 500 anonymous requests a minute per IP today; the proposed per-plan limits drop that to 60 an hour ([GitLab.com rate limits](https://docs.gitlab.com/user/gitlab_com/rate_limits/)). |
| 5 | **Ask** | Suggest `gh auth login`, or a pre-filled fine-grained token link: `https://github.com/settings/personal-access-tokens/new?name=Issue+Map&target_name=OWNER&issues=read` ([pre-filling](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters)). | Suggest `glab auth login`, or a pre-filled link: `https://H/-/user_settings/personal_access_tokens?name=Issue+Map&scopes=read_api` ([pre-fill](https://docs.gitlab.com/user/profile/personal_access_tokens/#prefill-personal-access-token-details)). The path differs by version. GitLab 15 used `/-/profile/personal_access_tokens` ([15.0 docs](https://gitlab.com/gitlab-org/gitlab/-/blob/v15.0.0-ee/doc/user/profile/personal_access_tokens.md)). From 18.9 the form for this older token type is at `.../personal_access_tokens/legacy/new`, a page that "does not exist" on 18.8 and earlier ([glab docs](https://docs.gitlab.com/cli/authentication/)). |

Rules that keep this safe:

- **Only send a token to the host it was issued for.** `gh` and `glab` store credentials per host, so step 1 handles this already.
- **Environment tokens are the risky case.** For them, identify the Tracker first, then follow `gh`'s host rules above. `glab`'s environment tokens go to any host, so send them only to `GITLAB_HOST` (or gitlab.com if it is unset) and to hosts `glab` knows. A remote that points at an unexpected host must not be able to collect them.
- **Stop the credential helper from prompting.** Set `GIT_TERMINAL_PROMPT=0` ([git](https://git-scm.com/docs/git)), pass `-c credential.interactive=false`, which "some credential helpers respect as well" ([git-config](https://git-scm.com/docs/git-config)), and set `GCM_INTERACTIVE=false` ([GCM environment](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/environment.md#gcm_interactive)). Never call `git credential approve` or `reject`: the plugin must not change the user's credential store.
- **Don't read credential files directly** (`gh`'s `hosts.yml`, `glab`'s `config.yml`). Both CLIs keep tokens in the OS keyring by default and fall back to plaintext files ([gh auth login](https://cli.github.com/manual/gh_auth_login), [glab auth login](https://docs.gitlab.com/cli/auth/login/)). The CLI commands above cover every case.
- **GitLab CI job tokens can't read Issues.** The Issues API is not on the job token's list of allowed endpoints ([CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/)).

### Least scope per Tracker

| | Public Project | Private Project | What users usually have already |
|---|---|---|---|
| **GitHub, fine-grained token** | Nothing: fine-grained tokens "always include read-only access to all public repositories" ([PAT docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)) | `Issues: read` on that Project. The same permission covers listing Issues, dependencies and sub-issues ([issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues), [dependencies](https://docs.github.com/en/rest/issues/issue-dependencies), [sub-issues](https://docs.github.com/en/rest/issues/sub-issues)). `metadata=read` comes with it. Organisations can require owner approval. | — |
| **GitHub, classic token or OAuth** | No scope: "(no scope) grants read-only access to public information" ([scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)) | `repo`, which is full read and write. There is no read-only scope for private Projects. | `gh`: `repo`, `read:org`, `gist` ([gh auth login](https://cli.github.com/manual/gh_auth_login)). GCM: `repo`, `gist`, `workflow`. |
| **GitLab, legacy token** (personal, project or group) | Nothing, except for REST issue links, which need a token (see above) | `read_api`: "read access to the API for the token's scope" ([scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/)). Available since 12.10 ([13.0 docs](https://gitlab.com/gitlab-org/gitlab/-/blob/v13.0.0-ee/doc/user/profile/personal_access_tokens.md)). `read_repository` and `write_repository` cover git only. | `glab` PAT: `api` and `write_repository`. `glab` OAuth: `openid profile read_user write_repository api` ([glab authentication](https://docs.gitlab.com/cli/authentication/)). |
| **GitLab, fine-grained token** (beta 18.10, generally available 19.2) | — | `Project: Read` (`GET /projects/:id`) and `Work Item: Read`, which covers `GET /projects/:id/issues` and `.../issues/:iid/links` ([fine-grained tokens](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/), [REST permissions](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens_rest/)) | — |

Notes on the GitLab token types:
- A personal token reaches everything its user can see. A group token reaches one group and its subgroups; a project token reaches one Project ([scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/)).
- Project and group tokens exist on every self-managed tier, but on gitlab.com only on Premium and Ultimate ([REST authentication](https://docs.gitlab.com/api/rest/authentication/), [group tokens](https://docs.gitlab.com/user/group/settings/group_access_tokens/)).
- A project or group token also carries a role. Guest can view Issues. Confidential Issues need Planner (added in 17.7) or higher ([permissions](https://docs.gitlab.com/user/permissions/)).
- From 16.0, every personal token must have an expiry date ([16.0 docs](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/doc/user/profile/personal_access_tokens.md)). Borrowed tokens can therefore stop working, and the plugin needs a clear "token expired" path.

## 3. How far back "every GitLab version" realistically reaches

**What GitLab maintains.** GitLab backports bug fixes to the current release only, and security fixes to the current release plus the two before it. Today that is 19.4, 19.3 and 19.2. Minor releases come on the third Thursday of each month, and major releases every May; 20.0 is due 2027-05-20 ([maintenance policy](https://docs.gitlab.com/policy/maintenance/)). There is no long-term-support line. An internal working group lists "Expand upgrade cadence options (ie. LTS)" as a goal, and its status is Paused ([Upgrade Improvements working group](https://handbook.gitlab.com/handbook/company/working-groups/upgrade-improvements/)).

**What is known about adoption.** No breakdown of the versions self-managed instances run turned up anywhere GitLab publishes: its docs, handbook or roadmap epics. What it does say publicly:
- the roadmap's problem statement: "GitLab self-managed users have a hard time keeping up with the current patched version of GitLab" ([epic &10949](https://gitlab.com/groups/gitlab-org/-/epics/10949))
- the working group's north star: "increasing the number of self-managed GitLab instances running on maintained versions" ([working group](https://handbook.gitlab.com/handbook/company/working-groups/upgrade-improvements/))

Upgrades take effort, too. Each jump must pass through required stops, which since 17.5 fall at x.2, x.5, x.8 and x.11 ([upgrade paths](https://docs.gitlab.com/update/upgrade_paths/)).

**Where installs get stuck.** GitLab stops building Linux packages when an operating system reaches end of life. An install cannot upgrade past that point without moving to a newer OS first ([Linux package, end-of-life versions](https://docs.gitlab.com/install/package/)):

| OS | Last GitLab package |
|---|---|
| Ubuntu 16.04 | 13.12 |
| CentOS 8 | 14.6 |
| Debian 9 | 15.2 |
| Ubuntu 18.04 | 16.11 |
| Debian 10 | 17.5 |
| CentOS 7 / RHEL 7 / Oracle Linux 7 | 17.7 |
| Ubuntu 20.04 | 18.11 |

Docker and Helm installs don't have this ceiling.

**What GitLab's own clients support.**
- `glab`: "officially supports GitLab versions 16.0 and later... no support is provided for" 15.x and earlier ([README](https://gitlab.com/gitlab-org/cli/-/blob/main/README.md)).
- The VS Code extension: only the currently maintained versions ([README](https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/main/README.md)).

**Version floors that matter here.** The floors for each kind of Link belong to [#2](https://github.com/romtaugranot/issue-map/issues/2).

| Capability | From |
|---|---|
| API v4 (API v3 was removed in 11.0) | 9.0 ([v3 to v4](https://gitlab.com/gitlab-org/gitlab/-/blob/v11.0.0-ee/doc/api/v3_to_v4.md)) |
| `GET /version`, with a token | 8.13 ([9.0 docs](https://gitlab.com/gitlab-org/gitlab/-/blob/v9.0.0-ee/doc/api/version.md)) |
| `read_api` scope | 12.10 |
| `relates to` Links on the Free tier | 13.4 ([14.0 docs](https://gitlab.com/gitlab-org/gitlab/-/blob/v14.0.0-ee/doc/api/issue_links.md)) |
| `GET /metadata` | 15.2 |
| Personal tokens must expire | 16.0 |
| Planner role | 17.7 |
| Fine-grained personal tokens | 19.2 (beta from 18.10) |

**Recommendation.** This is input for [#10](https://github.com/romtaugranot/issue-map/issues/10), not a decision.
- **Promise and test 16.0 and later.** That matches `glab`. It covers the OS ceilings at 16.11, 17.5, 17.7 and 18.11, and every token type the plugin would ask for, except fine-grained tokens. A test matrix could be 16.0, 16.11, 17.7, 18.11 and the current release.
- **Try to work, without testing, from 13.4 to 15.11.** `read_api` exists and Free-tier Links exist. Use `/version` where `/metadata` is missing. Expect fewer Link kinds.
- **Below 13.4, say the version is too old.** 12.10 to 13.3 would need a paid tier for any Links, and below 12.10 the only token that works is a full `api` token.

For comparison, GHES supports each release for about a year. Today 3.17 (closing 2026-09-22) through 3.22 are supported ([GHES releases](https://docs.github.com/en/enterprise-server@latest/admin/all-releases)).

## Questions this raises

- **GitLab's REST issue links need a token even on public Projects.** That shapes the anonymous path. Reading with no token would need GraphQL, which may not exist on older versions. This is input for [#2](https://github.com/romtaugranot/issue-map/issues/2) and [#10](https://github.com/romtaugranot/issue-map/issues/10).
- **Where the plugin saves "this checkout's Home Project".** It could write the `gh-resolved` and `glab-resolved-base` keys, which would change `gh` and `glab` behaviour too. Or it could keep a key of its own in git config, or state outside the checkout. The fork and mirror question in step 6 also needs a UX answer. This fits the Map prototype ([#9](https://github.com/romtaugranot/issue-map/issues/9)).
- **Whether the plugin may run `gh`, `glab`, `ssh -G` and `git credential` at all.** That depends on the surface chosen after [#4](https://github.com/romtaugranot/issue-map/issues/4). A page running in a browser can't run them; a local server or the Bash tool can.

## Sources

**git and OpenSSH**
- [git-clone: GIT URLS](https://git-scm.com/docs/git-clone#_git_urls), [git-remote](https://git-scm.com/docs/git-remote), [git-ls-remote](https://git-scm.com/docs/git-ls-remote), [git-credential](https://git-scm.com/docs/git-credential), [git-config (`credential.interactive`)](https://git-scm.com/docs/git-config), [git (`GIT_TERMINAL_PROMPT`)](https://git-scm.com/docs/git)
- [ssh(1), `-G`](https://man.openbsd.org/ssh)

**`gh` (cli/cli, go-gh)**
- Source: [`context/remote.go`](https://github.com/cli/cli/blob/trunk/context/remote.go), [`context/context.go`](https://github.com/cli/cli/blob/trunk/context/context.go), [`git/client.go`](https://github.com/cli/cli/blob/trunk/git/client.go), [`git/url.go`](https://github.com/cli/cli/blob/trunk/git/url.go), [`pkg/cmd/factory/remote_resolver.go`](https://github.com/cli/cli/blob/trunk/pkg/cmd/factory/remote_resolver.go), [`internal/ghinstance/host.go`](https://github.com/cli/cli/blob/trunk/internal/ghinstance/host.go), [`go-gh/pkg/ssh/ssh.go`](https://github.com/cli/go-gh/blob/trunk/pkg/ssh/ssh.go), [`go-gh/pkg/auth/auth.go`](https://github.com/cli/go-gh/blob/trunk/pkg/auth/auth.go)
- Manual: [environment](https://cli.github.com/manual/gh_help_environment), [auth login](https://cli.github.com/manual/gh_auth_login), [auth token](https://cli.github.com/manual/gh_auth_token), [auth status](https://cli.github.com/manual/gh_auth_status), [repo set-default](https://cli.github.com/manual/gh_repo_set-default), [api](https://cli.github.com/manual/gh_api)

**`glab` (gitlab-org/cli)**
- Source: [`internal/glrepo/resolver.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/glrepo/resolver.go), [`internal/glrepo/remote.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/glrepo/remote.go), [`internal/git/git.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/git/git.go), [`internal/config/schema.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/config/schema.go), [`internal/config/envvars.go`](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/config/envvars.go), [README](https://gitlab.com/gitlab-org/cli/-/blob/main/README.md)
- Docs: [authentication](https://docs.gitlab.com/cli/authentication/), [auth login](https://docs.gitlab.com/cli/auth/login/), [auth status](https://docs.gitlab.com/cli/auth/status/), [api](https://docs.gitlab.com/cli/api/)

**Git Credential Manager**
- [`GitHubHostProvider.cs`](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitHub/GitHubHostProvider.cs), [`GitHubConstants.cs`](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitHub/GitHubConstants.cs), [`GitLabHostProvider.cs`](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitLab/GitLabHostProvider.cs), [docs/gitlab.md](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/gitlab.md), [docs/environment.md](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/environment.md#gcm_interactive)

**GitHub docs**
- Tokens and auth: [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [REST authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api), [GraphQL: forming calls](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql), [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects)
- Endpoints: [issues](https://docs.github.com/en/rest/issues/issues), [issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies), [sub-issues](https://docs.github.com/en/rest/issues/sub-issues), [repositories](https://docs.github.com/en/rest/repos/repos#get-a-repository), [about forks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-forks)
- GHES and GHE.com: [GHES meta](https://docs.github.com/en/enterprise-server@latest/rest/meta/meta), [GHES enterprise admin (version header)](https://docs.github.com/en/enterprise-server@latest/rest/enterprise-admin), [GHES private mode](https://docs.github.com/en/enterprise-server@latest/admin/configuring-settings/hardening-security-for-your-enterprise/enabling-private-mode), [GHES releases](https://docs.github.com/en/enterprise-server@latest/admin/all-releases), [GHE.com network details](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom)
- SSH: [SSH over the HTTPS port](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port), [testing an SSH connection](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection)

**GitLab docs and source**
- API: [REST authentication](https://docs.gitlab.com/api/rest/authentication/), [REST namespaced paths](https://docs.gitlab.com/api/rest/#namespaced-paths), [Projects API](https://docs.gitlab.com/api/projects/), [Metadata API](https://docs.gitlab.com/api/metadata/), [Issue links API](https://docs.gitlab.com/api/issue_links/)
- Tokens and roles: [token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/), [fine-grained tokens](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/), [fine-grained REST permissions](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens_rest/), [personal access tokens](https://docs.gitlab.com/user/profile/personal_access_tokens/), [project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/), [group access tokens](https://docs.gitlab.com/user/group/settings/group_access_tokens/), [permissions](https://docs.gitlab.com/user/permissions/), [CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/)
- gitlab.com and deployment: [GitLab.com rate limits](https://docs.gitlab.com/user/gitlab_com/rate_limits/), [GitLab.com settings (altssh)](https://docs.gitlab.com/user/gitlab_com/), [relative URL](https://docs.gitlab.com/install/relative_url/), [subgroups](https://docs.gitlab.com/user/group/subgroups/), [forking workflow](https://docs.gitlab.com/user/project/repository/forking_workflow/), [SSH](https://docs.gitlab.com/user/ssh/), [Dedicated network security](https://docs.gitlab.com/administration/dedicated/configure_instance/network_security/)
- Versions: [maintenance policy](https://docs.gitlab.com/policy/maintenance/), [upgrade paths](https://docs.gitlab.com/update/upgrade_paths/), [Linux package (OS end-of-life table)](https://docs.gitlab.com/install/package/)
- Source: [`lib/api/metadata.rb`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/api/metadata.rb), [`lib/api/issue_links.rb`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/api/issue_links.rb), [`git_http_client_controller.rb`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/controllers/repositories/git_http_client_controller.rb)
- Docs as shipped with older versions: [Version API (9.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v9.0.0-ee/doc/api/version.md), [API v3 to v4 (11.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v11.0.0-ee/doc/api/v3_to_v4.md), [personal access tokens (13.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v13.0.0-ee/doc/user/profile/personal_access_tokens.md), [(15.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v15.0.0-ee/doc/user/profile/personal_access_tokens.md), [(16.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/doc/user/profile/personal_access_tokens.md), [Issue links API (14.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v14.0.0-ee/doc/api/issue_links.md), [Version API (16.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/doc/api/version.md), [Metadata API (16.0)](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/doc/api/metadata.md)
- CI: [GitHub Actions variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables), [GitLab predefined CI/CD variables](https://docs.gitlab.com/ci/variables/predefined_variables/)
- Planning: [Upgrade Improvements working group](https://handbook.gitlab.com/handbook/company/working-groups/upgrade-improvements/), [epic &10949](https://gitlab.com/groups/gitlab-org/-/epics/10949), [GitLab for VS Code README](https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/main/README.md)

**Observed on 2026-09-21** (anonymous, read-only)
- gitlab.com:
  - `/api/v4/version` and `/api/v4/metadata` → 401 `{"message":"401 Unauthorized"}`
  - `/api/v4/projects/gitlab-org%2Fcli` → 200 with basic fields only
  - a missing Project → 404 `{"message":"404 Project Not Found"}`
  - `/issues/:iid/links` → 401
  - GraphQL: `project.workItems` returns `LINKED_ITEMS` with `blocks`, `is_blocked_by` and `relates_to` on `gitlab-org/cli`; `metadata` → `null`
  - `info/refs` for a missing Project → 401 `Basic realm="GitLab"`
- github.com:
  - `/rate_limit` → `graphql` limit 0 when anonymous
  - the 30 newest forks of `cli/cli` → all `has_issues: false`
  - `info/refs` for a missing Project → 401 `Basic realm="GitHub"`
