/**
 * A link in the pane on the desktop (ADR 0014), where a Markdown link draws
 * but its press reaches no plugin: a region drawing the link's text, cut to
 * its width and underlined under the pointer, that posts the screen a press
 * leads to.
 */
import type { ClientModule } from "claude-code";
import type { IssueMapScreen } from "../types";

export type LinkProps = { text: string; bold: boolean; to: IssueMapScreen };

/** What a press posts: the screen the link leads to. */
export type LinkPost = { go: IssueMapScreen };

const Link: ClientModule<LinkProps, { over: boolean }> = (props, surface) => {
  const { Text } = surface.elements;
  const over = surface.state?.over ?? false;
  surface.onPointer((e) => {
    // The pointer is held from a press to its release, so a release off the link opens nothing.
    const on = e.type !== "leave" && e.x >= 0 && e.x < surface.columns && e.y >= 0 && e.y < surface.rows;
    if (e.type === "up" && e.button === "left" && on) return surface.post({ go: props.to } satisfies LinkPost);
    if (on !== over) surface.setState({ over: on });
  });
  return (
    <Text color="suggestion" bold={props.bold} underline={over} wrap="truncate-end">
      {props.text}
    </Text>
  );
};

export default Link;
