# Support is decided by what each Project shows; versions only set what is promised

The plugin doesn't keep a table of which Link kinds each Tracker version has. Each time it opens a Project, it checks which Link kinds it can read there and whether the login can write. Version numbers do only two jobs. They decide what is tested and promised, and they choose the note the Map shows. There are three bands:

- **Promised**: tested, and Link Suggestions can be written. This covers github.com, GHEC (including `*.ghe.com`), the GitHub Enterprise Server releases GitHub still supports, gitlab.com, GitLab Dedicated, and self-hosted GitLab 16.0 and later on every tier.
- **Best effort**: the Map opens if it can read at least one Link kind, and it says the version is untested. Nothing is written here. This covers older GHES and GitLab 13.4–15.11.
- **Refused**: the Tracker records no Link kind the Map can read, for example GitLab before 13.4.

Self-hosted GitLab has a long tail of installs stuck on old versions, which a rolling window would drop. The GHES window rolls because GitHub retires releases after about a year. The 16.0 floor matches `glab`, whose login the plugin borrows. Writing wrong changes someone's Tracker, while reading wrong costs one bad draw, so untested versions only read.

## Considered Options

- **Refuse everything outside the promised range.** This is simpler, but it turns away the old self-hosted installs that most need a Map they can move through.
- **Open anything, and show whatever can't be read as Unlinked.** This breaks the Map's main promise, because an Issue whose Blocks can't be seen would look unblocked.
- **A rolling window for GitLab too**, covering only the three maintained releases (19.2–19.4 today).
- **Promise GitLab 16.3 and later**, so that a single GraphQL read covers every Link kind. That would save a REST read path but drop 16.0–16.2.

## Consequences

- **"Can't read" counts the same as "can't record".** If the Map can't read a Project's Blocks Links, because of the tier, the version or the login, no Issue is Unblocked. The note names every Link kind the Map can't show, and why.
- **GitLab EE before 17.10 can't state its licence**, and unlicensed EE returns empty Blocks fields rather than errors. The Map infers Blocks support from whether REST returns an Issue's `weight` key. If that is ambiguous, the Project counts as "can't tell", and nothing is Unblocked.
- **Reading GitLab tasks depends on GitLab's work-item GraphQL**, which GitLab still labels "Experiment". The test matrix has to catch fields that change.
- **The login's write access can be "can't tell"**, as with GitHub fine-grained tokens. The plugin then offers the write and stops at the first refusal.
