/**
 * Laid over the pane's chart, which takes no presses itself (ADR 0014): names
 * the island under the pointer, as the chart's own hover does where nothing
 * lies over it, and posts what a press lands on to the hooks module. The
 * chart is drawn as wide as this region, and as tall as its cells are
 * reckoned to be, so a cell here is found on the chart by its share of the
 * region.
 */
import type { ClientModule } from "claude-code";

/** An island: its middle, how far it reaches, the Issue heading its Group, its name and what it holds. */
type Isle = [x: number, y: number, r: number, open: string, name: string, said: string];
/** An Issue box: its corner, its size, and its Issue. */
type IssueBox = [x: number, y: number, w: number, h: number, open: string];

export type ChartProps = { width: number; height: number; isles: Isle[]; boxes: IssueBox[] };

type Held = { over: number | null };

const Chart: ClientModule<ChartProps, Held> = (props, surface) => {
  const { Box, Text } = surface.elements;
  const { columns, rows } = surface;
  /** What lies under the cell at (`x`, `y`): an island, by its place, or an Issue box, by its place after the islands. */
  const under = (x: number, y: number): number | null => {
    if (columns === 0 || rows === 0) return null;
    const cx = ((x + 0.5) / columns) * props.width;
    const cy = ((y + 0.5) / rows) * props.height;
    const isle = props.isles.findIndex(([ix, iy, r]) => Math.hypot(ix - cx, iy - cy) <= r + 4);
    if (isle >= 0) return isle;
    const box = props.boxes.findIndex(([bx, by, w, h]) => cx >= bx - 3 && cx <= bx + w + 3 && cy >= by - 3 && cy <= by + h + 3);
    return box >= 0 ? props.isles.length + box : null;
  };
  const openOf = (spot: number) => (spot < props.isles.length ? props.isles[spot]![3] : props.boxes[spot - props.isles.length]![4]);
  surface.onPointer((e) => {
    if (e.type === "leave") return surface.setState({ over: null });
    const spot = under(e.x, e.y);
    if (e.type === "up" && e.button === "left" && spot !== null) return surface.post({ open: openOf(spot) });
    if (spot !== (surface.state?.over ?? null)) surface.setState({ over: spot });
  });
  const over = surface.state?.over ?? null;
  const isle = over !== null && over < props.isles.length ? props.isles[over] : undefined;
  return (
    <Box flexDirection="column" justifyContent="flex-end" width="100%" height={rows || 1}>
      {isle && (
        <Box flexDirection="column" paddingX={1}>
          <Text inverse bold wrap="truncate-end">{` ${isle[4]} `}</Text>
          <Text inverse wrap="truncate-end">{` ${isle[5]} `}</Text>
        </Box>
      )}
    </Box>
  );
};

export default Chart;
