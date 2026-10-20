/**
 * A browser client's connection to its home host, when it is not ready:
 * what the page is showing instead (what this device saved) and, for a host
 * that is not the one it paired with, a way out (signing out of it). An
 * unpaired or revoked client sees the pairing screen instead (app.tsx).
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { forgetHomeConnection } from "@/lib/connections/forget";
import { getClientPlatform } from "@/lib/connections/platform";
import { useConnectionState } from "@/lib/connections/use-connection-state";
import { LOCAL_HOST_ID } from "@/lib/host-routing";
import { cn } from "@/lib/utils";

export const ConnectionBanner = () => {
  const t = useTranslations("remote");
  const state = useConnectionState(LOCAL_HOST_ID);
  const [signingOut, setSigningOut] = useState(false);
  const platform = getClientPlatform();
  if (platform.kind !== "web") return null;
  if (
    state.status === "ready" ||
    state.status === "connecting" ||
    state.status === "unauthorized"
  ) {
    return null;
  }

  const host = platform.homeLabel;
  const incompatible = state.status === "incompatible";
  const message = incompatible
    ? (state.error ?? t("incompatible", { host }))
    : state.status === "reconnecting"
      ? t("reconnecting", { host })
      : t("offline", { host });

  return (
    <div
      className={cn(
        "fixed inset-x-0 top-12 z-50 mx-auto flex w-fit max-w-[92vw] flex-wrap items-center gap-3 rounded-md border px-4 py-2 text-sm shadow-md",
        incompatible
          ? "border-destructive-border bg-destructive-surface text-destructive"
          : "bg-popover text-muted-foreground",
      )}
      role={incompatible ? "alert" : "status"}
    >
      <span className="min-w-0">{message}</span>
      {incompatible ? (
        <Button
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void forgetHomeConnection().finally(() =>
              window.location.replace("/"),
            );
          }}
          size="sm"
          variant="outline"
        >
          {t("signOut")}
        </Button>
      ) : null}
    </div>
  );
};
