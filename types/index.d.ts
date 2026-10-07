/**
 * The values the plugin's hooks module keeps in `$.state` for the Issue Map
 * pane (ADR 0014). Self-contained, as a contract is: `IssueMapScreen` is
 * `src/pane/screens.ts`'s `Screen`, which the hooks module holds it to.
 */

/** The screen the pane shows. */
export type IssueMapScreen =
  | { kind: "map" }
  | { kind: "island"; head: string; from?: number; mark?: string; openedAt?: number }
  | { kind: "issue"; ref: string; page?: number }
  | { kind: "list"; which: "next" | "groups" | "unlinked"; page?: number; mark?: string };

/** How far a first read of the Project has got: Issues read of all open, how long it's taken, and why it stopped, when it has. */
export type IssueMapProgress = { project: string; read: number; total: number; elapsedMs: number; stopped?: string };

/** What the pane last read with `issue-map pane`, when: the Map's data as printed, a first read's progress, or what to show in its place. */
export type IssueMapRead = { at: number; map?: string; reading?: IssueMapProgress; said?: string };

declare module "claude-code" {
  interface PluginState {
    "issue-map": {
      screen: IssueMapScreen;
      read: IssueMapRead;
      /** While a read runs. */
      reading: boolean;
    };
  }
}
