/**
 * The commit graph beside the log: each commit sits in a lane, and every
 * row says which lane lines pass it, which run down into its node and which
 * leave the node for its parents below.
 *
 * Lanes never move sideways, so a straight line keeps one column for its
 * whole length; a lane freed by a branch that ended is reused by the next
 * one that needs a column.
 */
export interface GitGraphRow {
  /** The lane the commit's node sits in. */
  column: number;
  /** Lanes whose lines run past this row, top to bottom. */
  passing: number[];
  /** Lanes whose lines come down from above into the node. */
  incoming: number[];
  /** Lanes the node's lines go down into, one per parent. */
  outgoing: number[];
  /** Whether the commit has more than one parent. */
  merge: boolean;
}

export interface GitGraph {
  rows: GitGraphRow[];
  /** The most lanes any row uses: the graph's width in lanes. */
  laneCount: number;
}

type GraphCommit = { hash: string; parents: string[] };

const takeFreeLane = (lanes: (string | null)[]) => {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
};

/** Lays out `commits`, newest first with every child before its parents. */
export const buildGitGraph = (commits: readonly GraphCommit[]): GitGraph => {
  // The commit each lane is waiting for; null is a free lane.
  const lanes: (string | null)[] = [];
  const rows: GitGraphRow[] = [];
  let laneCount = 0;

  for (const commit of commits) {
    const incoming: number[] = [];
    const passing: number[] = [];
    lanes.forEach((expected, index) => {
      if (expected === commit.hash) {
        incoming.push(index);
      } else if (expected !== null) {
        passing.push(index);
      }
    });

    // A branch tip nothing above leads to starts in a free lane.
    const column = incoming[0] ?? takeFreeLane(lanes);
    for (const index of incoming) {
      lanes[index] = null;
    }

    const outgoing: number[] = [];
    // A host older than parents in the log sends none: no lines down.
    const parents = commit.parents ?? [];
    const [firstParent, ...otherParents] = parents;
    if (firstParent) {
      lanes[column] = firstParent;
      outgoing.push(column);
    }
    for (const parent of otherParents) {
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        outgoing.push(existing);
        continue;
      }
      const lane = takeFreeLane(lanes);
      lanes[lane] = parent;
      outgoing.push(lane);
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    laneCount = Math.max(
      laneCount,
      column + 1,
      lanes.length,
      ...passing.map((lane) => lane + 1),
    );
    rows.push({
      column,
      incoming,
      merge: parents.length > 1,
      outgoing,
      passing,
    });
  }

  return { laneCount, rows };
};

/** Lane colors, repeating; each reads on light and dark backgrounds. */
export const GIT_GRAPH_COLORS = [
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#ef4444",
] as const;

export const getGitGraphLaneColor = (lane: number) =>
  GIT_GRAPH_COLORS[lane % GIT_GRAPH_COLORS.length];
