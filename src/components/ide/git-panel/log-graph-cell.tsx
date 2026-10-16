import { memo } from "react";
import { cn } from "@/lib/utils";
import { type GitGraphRow, getGitGraphLaneColor } from "./log-graph";

const GRAPH_PADDING = 4;
const MAX_LANE_WIDTH = 12;
const MIN_LANE_WIDTH = 6;
/** The lanes' share of the row: they narrow to fit it before any clip. */
const MAX_LANES_WIDTH = 160;
/** Below this lane width the node shrinks so it does not cover neighbours. */
const SMALL_NODE_LANE_WIDTH = 10;

/** How wide the graph and each of its lanes are drawn. */
export interface GitGraphLayout {
  laneWidth: number;
  width: number;
  /** Whether lanes past the right edge are cut off (faded out). */
  clipped: boolean;
}

/**
 * Lanes narrow as the graph gets busier, from 12px to 6px, to fit about
 * 160px; only a graph wider than that at 6px is clipped.
 */
export const getGitGraphLayout = (laneCount: number): GitGraphLayout => {
  const lanes = Math.max(1, laneCount);
  const laneWidth = Math.max(
    MIN_LANE_WIDTH,
    Math.min(MAX_LANE_WIDTH, Math.floor(MAX_LANES_WIDTH / lanes)),
  );
  const visibleLanes = Math.min(lanes, Math.floor(MAX_LANES_WIDTH / laneWidth));
  return {
    clipped: visibleLanes < lanes,
    laneWidth,
    width: GRAPH_PADDING * 2 + visibleLanes * laneWidth,
  };
};

/**
 * One row of the commit graph, as tall as its log row: the lines passing
 * it, those joining its commit's node, those leaving for its parents and
 * those moving over a lane.
 * The SVG stretches vertically (y runs 0 to 100), so strokes do not scale
 * and the node is drawn in HTML to stay round.
 */
const GitLogGraphCellImpl = ({
  layout,
  row,
}: {
  layout: GitGraphLayout;
  row: GitGraphRow;
}) => {
  const { clipped, laneWidth, width } = layout;
  const laneX = (lane: number) =>
    GRAPH_PADDING + laneWidth / 2 + lane * laneWidth;
  const nodeX = laneX(row.column);
  const nodeColor = getGitGraphLaneColor(row.column);
  const paths: { color: string; d: string; key: string }[] = [];

  for (const lane of row.passing) {
    const x = laneX(lane);
    paths.push({
      color: getGitGraphLaneColor(lane),
      d: `M ${x} 0 L ${x} 100`,
      key: `p${lane}`,
    });
  }
  for (const shift of row.shifting) {
    const from = laneX(shift.from);
    const to = laneX(shift.to);
    paths.push({
      color: getGitGraphLaneColor(shift.to),
      d: `M ${from} 0 C ${from} 50, ${to} 50, ${to} 100`,
      key: `s${shift.from}`,
    });
  }
  for (const lane of row.incoming) {
    const x = laneX(lane);
    paths.push({
      color: getGitGraphLaneColor(lane),
      d:
        lane === row.column
          ? `M ${x} 0 L ${x} 50`
          : `M ${x} 0 C ${x} 25, ${x} 50, ${nodeX} 50`,
      key: `i${lane}`,
    });
  }
  for (const lane of row.outgoing) {
    const x = laneX(lane);
    paths.push({
      color: getGitGraphLaneColor(lane),
      d:
        lane === row.column
          ? `M ${x} 50 L ${x} 100`
          : `M ${nodeX} 50 C ${x} 50, ${x} 75, ${x} 100`,
      key: `o${lane}`,
    });
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative shrink-0 self-stretch overflow-hidden",
        // Lanes past the edge fade out rather than end in a hard cut.
        clipped &&
          "[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]",
      )}
      style={{ width }}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full"
        fill="none"
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} 100`}
        width={width}
      >
        {paths.map((path) => (
          <path
            d={path.d}
            key={path.key}
            stroke={path.color}
            strokeLinecap="round"
            strokeWidth={laneWidth < SMALL_NODE_LANE_WIDTH ? 1.5 : 2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span
        className={cn(
          "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 rounded-full ring-2 ring-background",
          laneWidth < SMALL_NODE_LANE_WIDTH ? "size-2" : "size-2.5",
          row.merge && "border-2 bg-background",
        )}
        style={{
          backgroundColor: row.merge ? undefined : nodeColor,
          borderColor: row.merge ? nodeColor : undefined,
          left: nodeX,
        }}
      />
    </div>
  );
};

export const GitLogGraphCell = memo(GitLogGraphCellImpl);
GitLogGraphCell.displayName = "GitLogGraphCell";
