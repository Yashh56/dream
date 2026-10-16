export interface FileBuffer {
  diskContent: string;
  draftContent: string;
  status: "clean" | "dirty" | "saving" | "conflict";
  /** Why the last save failed, as thrown; null when it did not. */
  error: unknown;
}

export type FileBuffersState = Record<string, FileBuffer>;
export type FileLineEnding = "crlf" | "lf";

export const normalizeFileContentForEditor = (
  content: string,
  lineEnding: FileLineEnding,
) => (lineEnding === "crlf" ? content.replace(/\r\n/g, "\n") : content);

export const serializeEditorContent = (
  content: string,
  lineEnding: FileLineEnding,
) => (lineEnding === "crlf" ? content.replace(/\r?\n/g, "\r\n") : content);

export type FileBufferAction =
  | { type: "load"; key: string; content: string }
  | { type: "edit"; key: string; content: string }
  | { type: "save-start"; key: string }
  | { type: "save-success"; key: string; content: string }
  | { type: "save-failure"; key: string; error: unknown }
  | { type: "save-conflict"; key: string; error: unknown }
  | { type: "discard"; key: string }
  | { type: "invalidate"; key: string }
  | { type: "refresh" };

/** A draft that differs from what was last read from or written to disk. */
export const isBufferDirty = (buffer: FileBuffer | null | undefined) =>
  Boolean(buffer && buffer.draftContent !== buffer.diskContent);

export const fileBuffersReducer = (
  state: FileBuffersState,
  action: FileBufferAction,
): FileBuffersState => {
  switch (action.type) {
    case "load": {
      if (state[action.key]) {
        return state;
      }

      return {
        ...state,
        [action.key]: {
          diskContent: action.content,
          draftContent: action.content,
          status: "clean",
          error: null,
        },
      };
    }
    case "edit": {
      const buffer = state[action.key];
      if (!buffer || buffer.status === "saving") {
        return state;
      }

      return {
        ...state,
        [action.key]: {
          ...buffer,
          draftContent: action.content,
          status:
            buffer.status === "conflict"
              ? "conflict"
              : action.content === buffer.diskContent
                ? "clean"
                : "dirty",
          error: buffer.status === "conflict" ? buffer.error : null,
        },
      };
    }
    case "save-start": {
      const buffer = state[action.key];
      if (!buffer || buffer.status === "clean" || buffer.status === "saving") {
        return state;
      }

      return {
        ...state,
        [action.key]: { ...buffer, status: "saving", error: null },
      };
    }
    case "save-success":
      if (!state[action.key]) {
        return state;
      }

      return {
        ...state,
        [action.key]: {
          diskContent: action.content,
          draftContent: action.content,
          status: "clean",
          error: null,
        },
      };
    case "save-failure": {
      const buffer = state[action.key];
      if (!buffer) {
        return state;
      }

      return {
        ...state,
        [action.key]: {
          ...buffer,
          status:
            buffer.draftContent === buffer.diskContent ? "clean" : "dirty",
          error: action.error,
        },
      };
    }
    case "save-conflict": {
      const buffer = state[action.key];
      if (!buffer) {
        return state;
      }

      return {
        ...state,
        [action.key]: {
          ...buffer,
          status: "conflict",
          error: action.error,
        },
      };
    }
    case "discard": {
      const buffer = state[action.key];
      if (!buffer) {
        return state;
      }

      return {
        ...state,
        [action.key]: {
          ...buffer,
          draftContent: buffer.diskContent,
          status: "clean",
          error: null,
        },
      };
    }
    case "invalidate": {
      if (!state[action.key]) {
        return state;
      }

      const next = { ...state };
      delete next[action.key];
      return next;
    }
    case "refresh": {
      let changed = false;
      const next: FileBuffersState = {};

      for (const [key, buffer] of Object.entries(state)) {
        if (buffer.status === "clean") {
          changed = true;
          continue;
        }
        next[key] = buffer;
      }

      return changed ? next : state;
    }
  }
};
