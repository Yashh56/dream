/**
 * The commit graph beside the log: each commit sits in a lane, and every
 * row says which lane lines pass it, which run down into its node, which
 * leave the node for its parents below and which shift into another lane.
 *
 * Two lines waiting for the same commit become one as soon as the second
 * appears, kept in the leftmost of their lanes, so a merged branch's lane
 * closes where its last commit is drawn rather than running on to the
 * distant commit it forked from. A freed lane is reused by the next line
 * that needs one.
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
  /** Lines that move from one lane (above) to another (below) in this row. */
  shifting: { from: number; to: number }[];
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

/** Lays out `commits`, every child before its parents. */
export const buildGitGraph = (commits: readonly GraphCommit[]): GitGraph => {
  // The commit each lane is waiting for; null is a free lane.
  const lanes: (string | null)[] = [];
  const rows: GitGraphRow[] = [];
  let laneCount = 0;

  for (const commit of commits) {
    const before = [...lanes];
    const incoming: number[] = [];
    before.forEach((expected, index) => {
      if (expected === commit.hash) {
        incoming.push(index);
      }
    });

    // A branch tip nothing above leads to starts in a free lane.
    const column = incoming[0] ?? takeFreeLane(lanes);
    for (const index of incoming) {
      lanes[index] = null;
    }

    const outgoing: number[] = [];
    const shifting: { from: number; to: number }[] = [];
    // A host older than parents in the log sends none: no lines down.
    const parents = commit.parents ?? [];
    const [firstParent, ...otherParents] = parents;
    if (firstParent) {
      const waiting = lanes.indexOf(firstParent);
      if (waiting === -1) {
        lanes[column] = firstParent;
        outgoing.push(column);
      } else if (waiting < column) {
        // Join the line already on its way there, further left.
        outgoing.push(waiting);
      } else {
        // The line further right moves over into this commit's lane.
        lanes[column] = firstParent;
        lanes[waiting] = null;
        outgoing.push(column);
        shifting.push({ from: waiting, to: column });
      }
    }
    for (const parent of otherParents) {
      const waiting = lanes.indexOf(parent);
      if (waiting !== -1) {
        outgoing.push(waiting);
        continue;
      }
      const lane = takeFreeLane(lanes);
      lanes[lane] = parent;
      outgoing.push(lane);
    }

    const shifted = new Set(shifting.map((shift) => shift.from));
    const passing: number[] = [];
    before.forEach((expected, index) => {
      if (
        expected !== null &&
        expected !== commit.hash &&
        !shifted.has(index)
      ) {
        passing.push(index);
      }
    });

    laneCount = Math.max(laneCount, before.length, column + 1, lanes.length);
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    rows.push({
      column,
      incoming,
      merge: parents.length > 1,
      outgoing,
      passing,
      shifting,
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
