import { memo } from "react";
import { cn } from "@/lib/utils";
import { type GitGraphRow, getGitGraphLaneColor } from "./log-graph";

const LANE_WIDTH = 12;
const GRAPH_PADDING = 4;
/** Lanes past this are clipped rather than pushing the messages aside. */
const MAX_VISIBLE_LANES = 10;

const laneX = (lane: number) =>
  GRAPH_PADDING + LANE_WIDTH / 2 + lane * LANE_WIDTH;

export const getGitGraphWidth = (laneCount: number) =>
  GRAPH_PADDING * 2 +
  Math.max(1, Math.min(laneCount, MAX_VISIBLE_LANES)) * LANE_WIDTH;

/**
 * One row of the commit graph, as tall as its log row: the lines passing
 * it, those joining its commit's node and those leaving for its parents.
 * The SVG stretches vertically (y runs 0 to 100), so strokes do not scale
 * and the node is drawn in HTML to stay round.
 */
const GitLogGraphCellImpl = ({
  row,
  width,
}: {
  row: GitGraphRow;
  width: number;
}) => {
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
      className="relative shrink-0 self-stretch overflow-hidden"
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
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span
        className={cn(
          "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-2.5 rounded-full ring-2 ring-background",
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
