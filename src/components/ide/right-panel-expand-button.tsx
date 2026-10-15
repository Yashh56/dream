import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The right panel's expand toggle, at the end of each view's header: it
 * widens the panel over the chats, and back.
 */
export const RightPanelExpandButton = ({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) => {
  const commonT = useTranslations("common");
  const label = expanded ? commonT("collapse") : commonT("expand");

  return (
    <button
      aria-label={label}
      aria-pressed={expanded}
      className="mb-px flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0 text-muted-foreground transition-colors hover:bg-surface-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 dark:hover:bg-surface-800 dark:focus-visible:ring-surface-500"
      onClick={onToggle}
      title={label}
      type="button"
    >
      {expanded ? (
        <Minimize2 className="size-4" />
      ) : (
        <Maximize2 className="size-4" />
      )}
    </button>
  );
};
