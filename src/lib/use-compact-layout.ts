/**
 * Whether the window is phone-sized: below this width the workspace shows
 * one chat, and its other panels open over it as full sheets instead of
 * beside it (workspaces/code-workspace.tsx).
 */
import { useSyncExternalStore } from "react";

export const COMPACT_LAYOUT_QUERY = "(max-width: 639px)";

const subscribe = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(COMPACT_LAYOUT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const read = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.(COMPACT_LAYOUT_QUERY).matches);

export const useCompactLayout = () =>
  useSyncExternalStore(subscribe, read, () => false);
