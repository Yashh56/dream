import { LOCAL_HOST_ID } from "@/lib/host-routing";

type OpenAttemptResult =
  | { status: "opened" | "cancelled" | "unavailable" }
  | { status: "failed"; error: unknown };

/** Owns the lifetime of a dialog's typed and native Project opens. */
export const createOpenProjectAttempt = ({
  connect,
  resolveFolder,
  pickFolder,
  openProject,
}: {
  connect: (hostId: string) => Promise<boolean>;
  resolveFolder: (
    hostId: string,
    path: string,
    signal: AbortSignal,
  ) => Promise<string>;
  pickFolder: () => Promise<string | null | undefined>;
  openProject: (
    hostId: string,
    path: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
}) => {
  let active: AbortController | null = null;
  const cancel = () => {
    active?.abort();
    active = null;
  };

  const run = async (
    hostId: string,
    folder: (signal: AbortSignal) => Promise<string | null | undefined>,
  ): Promise<OpenAttemptResult> => {
    cancel();
    const attempt = new AbortController();
    active = attempt;
    const current = () => active === attempt && !attempt.signal.aborted;
    try {
      const path = await folder(attempt.signal);
      if (!current()) return { status: "cancelled" };
      if (!path) return { status: "unavailable" };
      const opened = await openProject(hostId, path, attempt.signal);
      if (!current()) return { status: "cancelled" };
      return { status: opened ? "opened" : "unavailable" };
    } catch (error) {
      return current() ? { status: "failed", error } : { status: "cancelled" };
    } finally {
      if (active === attempt) active = null;
    }
  };

  return {
    cancel,
    typed: (hostId: string, path: string) =>
      run(hostId, async (signal) => {
        if (hostId !== LOCAL_HOST_ID && !(await connect(hostId))) return null;
        if (signal.aborted) return null;
        return resolveFolder(hostId, path, signal);
      }),
    browse: (hostId: string) => run(hostId, () => pickFolder()),
  };
};
