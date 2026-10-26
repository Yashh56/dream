import { ArrowUp, Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  apiClient,
  getApiErrorMessage,
  type HostDirectoriesResponse,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  completeFolder,
  folderToList,
  matchFolders,
  splitFolderInput,
} from "./folder-path";

/** Typing pauses this long before the folder being typed in is listed. */
const LIST_DELAY_MS = 120;

interface Listing {
  /** The typed parent it was listed for. */
  parent: string;
  result: HostDirectoriesResponse | null;
  error: string | null;
}

/**
 * A folder path on a host, typed with the folders that could come next
 * listed under it from the host's own API: a click or Tab enters one, the
 * arrow keys pick one, Enter opens the typed path. While the host cannot
 * be listed, `unavailable` stands in for the list.
 */
export const FolderPathField = ({
  hostId,
  id,
  onChange,
  trailing,
  unavailable,
  value,
}: {
  hostId: string;
  id: string;
  onChange: (value: string) => void;
  /** Beside the input, such as a native picker button. */
  trailing?: ReactNode;
  /** Shown instead of the list while the host is not reachable. */
  unavailable?: ReactNode;
  value: string;
}) => {
  const t = useTranslations("sshHosts");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const separator = listing?.result?.separator ?? "/";
  const { parent, prefix } = splitFolderInput(value, separator);
  const listable = !unavailable;

  // The folder being typed in is listed once typing pauses; only the
  // newest request's answer is kept.
  const requestRef = useRef(0);
  useEffect(() => {
    if (!listable) return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      apiClient
        .hostDirectories({ path: folderToList(parent) }, { hostId })
        .then((result) => {
          if (request === requestRef.current)
            setListing({ error: null, parent, result });
        })
        .catch((failure) => {
          if (request === requestRef.current)
            setListing({
              error: getApiErrorMessage(failure, t("foldersFailed")),
              parent,
              result: null,
            });
        });
    }, LIST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hostId, listable, parent, t]);

  const current = listing?.parent === parent ? listing : null;
  const loading = listable && !current;
  const matches = current?.result
    ? matchFolders(current.result.directories, prefix)
    : [];

  useEffect(() => {
    if (highlight < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  // New text starts with no folder picked.
  const change = (next: string) => {
    setHighlight(-1);
    onChange(next);
  };

  const enter = (name: string) => {
    change(completeFolder(parent, name, separator));
    inputRef.current?.focus();
  };

  const goUp = () => {
    const up = current?.result?.parent;
    if (!up) return;
    change(up.endsWith(separator) ? up : `${up}${separator}`);
    inputRef.current?.focus();
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Input
          aria-autocomplete="list"
          aria-controls={`${id}-folders`}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          autoFocus
          className="font-mono"
          id={id}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (matches.length === 0) return;
              event.preventDefault();
              const last = matches.length - 1;
              const down = event.key === "ArrowDown";
              setHighlight((index) =>
                down
                  ? index >= last
                    ? 0
                    : index + 1
                  : index <= 0
                    ? last
                    : index - 1,
              );
            } else if (event.key === "Tab" && !event.shiftKey) {
              const match = matches[Math.max(highlight, 0)];
              if (!match || (prefix === "" && highlight < 0)) return;
              event.preventDefault();
              enter(match.name);
            } else if (event.key === "Enter" && highlight >= 0) {
              const match = matches[highlight];
              if (!match) return;
              event.preventDefault();
              enter(match.name);
            }
          }}
          spellCheck={false}
          value={value}
        />
        {trailing}
      </div>
      {unavailable ? (
        <div className="flex h-56 flex-col items-center justify-center gap-3 rounded-md border px-4 text-center text-muted-foreground text-sm">
          {unavailable}
        </div>
      ) : (
        <div className="flex h-56 flex-col overflow-hidden rounded-md border">
          <div className="flex items-center gap-1 border-b px-1.5 py-1">
            <Button
              aria-label={t("upFolder")}
              disabled={!current?.result?.parent}
              onClick={goUp}
              size="icon-xs"
              title={t("upFolder")}
              type="button"
              variant="ghost"
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <span
              className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs"
              title={current?.result?.path}
            >
              {current?.result?.path ?? ""}
            </span>
            {loading ? <Spinner className="size-3.5 shrink-0" /> : null}
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto py-1"
            id={`${id}-folders`}
            ref={listRef}
            role="listbox"
          >
            {current?.error ? (
              <div className="px-3 py-2 text-muted-foreground text-sm">
                {current.error}
              </div>
            ) : !current ? (
              <div className="px-3 py-2 text-muted-foreground text-sm">
                {t("loadingFolders")}
              </div>
            ) : matches.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground text-sm">
                {t("noFolders")}
              </div>
            ) : (
              matches.map((entry, index) => (
                <button
                  aria-selected={index === highlight}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-accent",
                    index === highlight && "bg-accent",
                    entry.hidden && "text-muted-foreground",
                  )}
                  data-index={index}
                  key={entry.path}
                  onClick={() => enter(entry.name)}
                  // Keep the caret in the input while clicking a folder.
                  onMouseDown={(event) => event.preventDefault()}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            )}
            {current?.result?.truncated ? (
              <div className="px-3 py-1 text-muted-foreground text-xs">
                {t("foldersTruncated", {
                  count: current.result.directories.length,
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
