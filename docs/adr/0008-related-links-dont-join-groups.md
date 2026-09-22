# Related Links don't join Groups; the strongest Link wins

A Group is joined by Parent and Blocks Links. A Related Link is drawn — on the Issue card, and as a count against an Issue's line in an outline — but it does not join two Issues that a Parent or Blocks Link already places somewhere. An Issue with no Parent or Blocks Link is grouped with the Issues it is Related to, which likewise have none, so nothing leaves the Map and the Unlinked list is unchanged.

Related is the weakest of the three kinds: it says two Issues belong together, with no direction or order. It is also the catch-all — any other kind someone set counts as a Related Link, and where a Tracker records Mentions with nothing to tell them apart, those count too. Letting a bucket that loose join Issues as firmly as a Parent Link is what merges unrelated trees into one blob.

Measured on the `gitlab-org/gitlab` snapshot taken for #22 (48,243 open work items, 3,763 Related pairs):

| | Related joins | This decision |
|---|---|---|
| Groups | 4,369 | 5,812 |
| Largest Group | 1,859 | 306 |
| Groups of 100 or more | 13 | 9 |
| Issues on the Map | 22,797 | 22,797 |
| Unlinked Issues | 25,446 | 25,446 |

2,992 of the 3,763 Related pairs join two otherwise separate Parent/Blocks trees, and only 771 sit inside a tree already joined. Related's effect on the Map was therefore almost entirely merging. The Issues it alone holds — 2,348 of them — settle into 1,490 groups whose largest holds 20, so grouping them among themselves risks no second blob.

The rule is the same on every Tracker and tier. Related is a GitLab kind today: GitHub records no "relates to" at all, and GitLab Free records "relates to" and issue→task, which is a Parent Link to a Task-level child. No supported Tracker is left with Related as its only kind.

## Considered Options

- **Related joins Groups**, as #7 first set it. One Group of 1,859 Issues on `gitlab-org/gitlab`, with 360 Issues at its top, so opening it lists 360 lines that have little to do with each other.
- **Related never joins, and an Issue it alone holds goes to the Unlinked list.** Simpler to state, but 2,348 Issues would sit on a list defined as Issues with no Link to another open Issue while plainly having one — so the term would have to be redefined, and a real Link would stop being drawn anywhere on the Map.
- **Related joins, and the overview splits Groups by size instead.** Paging hides a blob rather than preventing one, and the split points would fall wherever the count landed, not where the Links mean something.
- **Let the rule follow the Tracker**, joining on Links where a Tracker records nothing stronger. ADR 0003 sets the bands by what the Map can read, not by what a Link means, and ADR 0007 fixes a kind's meaning to what the Tracker states. A kind meaning one thing on Free and another on Premium breaks both.

## Consequences

- **A Group's outline stays a tree.** Related Links have no place in a Parent tree, so an outline marks an Issue with the number of Related Links it has and the Issue card lists them.
- **The overview draws no line between Groups.** A cross-Group Related count would put the blob back on the busiest screen.
- **Groups get more numerous and much smaller.** The overview names only the largest few and holds the rest in a count, so a longer tail costs nothing on screen.
- **An Outside Issue joins a Group only through a Parent or Blocks Link**, or, among Issues that have neither, through a Related Link.
- **Take next is untouched.** An Issue whose only Link is Related still has a Link to an open Issue, so it is Unblocked in the usual way and can be taken next.
- **A Project that plans with Related alone**, rather than with parents or blockers, gets many small Groups instead of one large one, which is the intended reading of what it recorded.
