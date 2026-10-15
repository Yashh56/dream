import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/** The element in the Git panel's header where the shown tab puts its actions. */
export const GitPanelHeaderSlotContext = createContext<HTMLElement | null>(
  null,
);

/**
 * A tab's header actions (merge, refresh, ...). The tabs share one header,
 * so only the shown tab's actions are rendered into it.
 */
export const GitPanelHeaderActions = ({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) => {
  const slot = useContext(GitPanelHeaderSlotContext);
  return active && slot ? createPortal(children, slot) : null;
};
