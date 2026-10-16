export interface FileTab {
  path: string;
  // Preview tabs (single-click) are replaced by the next previewed file.
  // Pinned tabs (double-click, Enter, or edits) persist until closed.
  pinned: boolean;
}

/** One project's open file tabs and which of them is showing. */
export interface FileTabsState {
  activePath: string | null;
  tabs: FileTab[];
}

export type FileTabsAction =
  | { type: "preview"; path: string }
  | { type: "pin"; path: string }
  | { type: "activate"; path: string }
  | { type: "close"; path: string }
  | { type: "reorder"; fromIndex: number; toIndex: number };

export const EMPTY_FILE_TABS: FileTabsState = {
  activePath: null,
  tabs: [],
};

/** The next tabs; the same object when the action changes nothing. */
export const fileTabsReducer = (
  state: FileTabsState,
  action: FileTabsAction,
): FileTabsState => {
  switch (action.type) {
    case "preview": {
      if (state.tabs.some((tab) => tab.path === action.path)) {
        return state.activePath === action.path
          ? state
          : { ...state, activePath: action.path };
      }

      const previewIndex = state.tabs.findIndex((tab) => !tab.pinned);
      const nextTab: FileTab = { path: action.path, pinned: false };
      const tabs =
        previewIndex === -1
          ? [...state.tabs, nextTab]
          : state.tabs.map((tab, index) =>
              index === previewIndex ? nextTab : tab,
            );

      return { activePath: action.path, tabs };
    }
    case "pin": {
      const existing = state.tabs.find((tab) => tab.path === action.path);
      if (existing) {
        if (existing.pinned && state.activePath === action.path) {
          return state;
        }
        return {
          activePath: action.path,
          tabs: existing.pinned
            ? state.tabs
            : state.tabs.map((tab) =>
                tab.path === action.path ? { ...tab, pinned: true } : tab,
              ),
        };
      }

      // Pinning a file that isn't open replaces the preview slot (if any),
      // mirroring a double-click that follows a single-click.
      const previewIndex = state.tabs.findIndex((tab) => !tab.pinned);
      const nextTab: FileTab = { path: action.path, pinned: true };
      const tabs =
        previewIndex === -1
          ? [...state.tabs, nextTab]
          : state.tabs.map((tab, index) =>
              index === previewIndex ? nextTab : tab,
            );

      return { activePath: action.path, tabs };
    }
    case "activate": {
      if (
        state.activePath === action.path ||
        !state.tabs.some((tab) => tab.path === action.path)
      ) {
        return state;
      }
      return { ...state, activePath: action.path };
    }
    case "close": {
      const index = state.tabs.findIndex((tab) => tab.path === action.path);
      if (index === -1) {
        return state;
      }

      const tabs = state.tabs.filter((tab) => tab.path !== action.path);
      if (state.activePath !== action.path) {
        return { ...state, tabs };
      }

      const neighbor = tabs[index] ?? tabs[index - 1] ?? null;
      return { activePath: neighbor?.path ?? null, tabs };
    }
    case "reorder": {
      const { fromIndex, toIndex } = action;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.tabs.length ||
        toIndex >= state.tabs.length
      ) {
        return state;
      }

      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      if (!moved) {
        return state;
      }
      tabs.splice(toIndex, 0, moved);
      return { ...state, tabs };
    }
  }
};
