import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getClientPlatform } from "@/lib/connections/platform";
import { getDesktopApi } from "@/lib/electron";
import { listHostChoices } from "../../../../electron/shared/host-connections.js";
import { useIdeStore } from "../ide-store";
import { SettingsGroup } from "../settings/settings-shared";
import type { HostRuntimeState } from "../store/ide-store-types";
import {
  EMPTY_HOST_FORM,
  type HostFormValues,
  SshHostDialog,
  useAddSshHost,
  useHostStateLabel,
} from "./ssh-hosts-settings-section";

export function ConnectionsSettingsSection() {
  const t = useTranslations("connections");
  const sshT = useTranslations("sshHosts");
  const stateLabel = useHostStateLabel();
  const connections = useIdeStore((state) => state.hostConnections);
  const sshHosts = useIdeStore((state) => state.settings.sshHosts);
  const hosts = useIdeStore((state) => state.hosts);
  const home = connections.find(
    (host) => host.id === "local" && host.routes.length > 1,
  );
  const choices = [
    ...(home && getClientPlatform().hasHomeHost
      ? [{ id: "local", label: getClientPlatform().homeLabel }]
      : []),
    ...listHostChoices(connections, sshHosts),
  ];
  const saveSsh = useAddSshHost();
  const [sshForm, setSshForm] = useState<{
    owner?: string;
    edit?: string;
  } | null>(null);
  const [pairing, setPairing] = useState<{
    owner?: string;
    routeId?: string;
  } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message.replace(
              /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
              "",
            )
          : String(reason),
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = sshHosts.find((host) => host.id === sshForm?.edit);
  const save = (values: HostFormValues) => {
    const form = sshForm;
    setSshForm(null);
    void run(async () => {
      const state = useIdeStore.getState();
      if (form?.edit) await state.updateSshHost(form.edit, values);
      else if (form?.owner) await state.addSshRoute(form.owner, values);
      else {
        const host = saveSsh(values);
        await state.connectHost(host.id);
      }
    });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-medium text-base">{t("hosts")}</h3>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={busy}
            onClick={() => setSshForm({})}
            size="sm"
            variant="outline"
          >
            <Plus className="size-4" />
            {sshT("add")}
          </Button>
          <Button disabled={busy} onClick={() => setPairing({})} size="sm">
            {t("pair")}
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="break-words text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <SettingsGroup>
        {choices.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground text-sm">
            {t("empty")}
          </p>
        ) : null}
        {choices.map((choice) => {
          const saved = connections.find((host) => host.id === choice.id);
          const isHome = choice.id === "local";
          const runtime: HostRuntimeState | undefined = isHome
            ? {
                state: "connected",
                loaded: true,
                error: null,
                routeId: "local",
              }
            : hosts[choice.id];
          const live =
            runtime?.state === "connected" || runtime?.state === "reconnecting";
          const routes = saved?.routes ?? [
            {
              id: `ssh:${choice.id}`,
              kind: "ssh" as const,
              sshHostId: choice.id,
            },
          ];
          return (
            <div key={choice.id} className="space-y-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{choice.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {stateLabel(runtime?.state)}
                  </p>
                </div>
                <Button
                  disabled={busy || isHome || runtime?.state === "connecting"}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run(() =>
                      live
                        ? useIdeStore.getState().disconnectHost(choice.id)
                        : useIdeStore.getState().connectHost(choice.id),
                    )
                  }
                >
                  {live ? sshT("disconnect") : sshT("connect")}
                </Button>
                <Button
                  aria-label={sshT("remove")}
                  disabled={busy || isHome}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setPendingRemove(choice)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {runtime?.error ? (
                <p className="select-text break-words text-destructive text-xs">
                  {runtime.error}
                </p>
              ) : null}
              <ol className="space-y-2">
                {routes.map((route, index) => {
                  const config =
                    route.kind === "ssh"
                      ? sshHosts.find((host) => host.id === route.sshHostId)
                      : null;
                  const status = runtime?.routes?.find(
                    (item) => item.routeId === route.id,
                  );
                  const target =
                    route.kind === "https"
                      ? route.origin
                      : (config?.target ?? "");
                  return (
                    <li
                      key={route.id}
                      className="flex items-start gap-1 rounded-md border px-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={target}>
                          {index + 1}.{" "}
                          {route.kind === "local"
                            ? sshT("localMachine")
                            : route.kind === "ssh"
                              ? "SSH"
                              : "HTTPS"}{" "}
                          · {target}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {runtime?.routeId === route.id
                            ? t("active")
                            : status
                              ? t(status.state)
                              : t("idle")}
                        </p>
                        {status?.error ? (
                          <p className="select-text break-words text-destructive text-xs">
                            {status.error}
                          </p>
                        ) : null}
                      </div>
                      {saved && !isHome ? (
                        <>
                          <Button
                            aria-label={t("up")}
                            disabled={busy || index === 0}
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              void run(() =>
                                useIdeStore.getState().setHostRoutes(
                                  choice.id,
                                  routes.map((item, i) =>
                                    i === index - 1
                                      ? route
                                      : i === index
                                        ? routes[index - 1]
                                        : item,
                                  ),
                                ),
                              )
                            }
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            aria-label={t("down")}
                            disabled={busy || index === routes.length - 1}
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              void run(() =>
                                useIdeStore.getState().setHostRoutes(
                                  choice.id,
                                  routes.map((item, i) =>
                                    i === index + 1
                                      ? route
                                      : i === index
                                        ? routes[index + 1]
                                        : item,
                                  ),
                                ),
                              )
                            }
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                        </>
                      ) : null}
                      <Button
                        aria-label={sshT("edit")}
                        disabled={busy || route.kind === "local"}
                        size="icon-sm"
                        variant="ghost"
                        onClick={() =>
                          config
                            ? setSshForm({ edit: config.id })
                            : setPairing({
                                owner: choice.id,
                                routeId: route.id,
                              })
                        }
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      {saved ? (
                        <Button
                          aria-label={t("removeRoute")}
                          disabled={
                            busy ||
                            routes.length === 1 ||
                            route.kind === "local"
                          }
                          size="icon-sm"
                          variant="ghost"
                          onClick={() =>
                            void run(() =>
                              useIdeStore.getState().setHostRoutes(
                                choice.id,
                                routes.filter((item) => item.id !== route.id),
                              ),
                            )
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {saved ? (
                <div className="flex gap-2">
                  <Button
                    disabled={busy || routes.length >= 8}
                    size="xs"
                    variant="outline"
                    onClick={() => setSshForm({ owner: choice.id })}
                  >
                    {t("addSshRoute")}
                  </Button>
                  <Button
                    disabled={busy || routes.length >= 8}
                    size="xs"
                    variant="outline"
                    onClick={() => setPairing({ owner: choice.id })}
                  >
                    {t("addHttpsRoute")}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </SettingsGroup>
      {sshForm ? (
        <SshHostDialog
          initial={edit ?? EMPTY_HOST_FORM}
          isNew={!edit}
          onCancel={() => setSshForm(null)}
          onSave={save}
        />
      ) : null}
      {pairing ? (
        <PairHostDialog
          onCancel={() => setPairing(null)}
          onPair={async (url, label) => {
            await useIdeStore
              .getState()
              .pairHost(url, label, pairing.owner, pairing.routeId);
            setPairing(null);
          }}
        />
      ) : null}
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sshT("removeTitle", { name: pendingRemove?.label ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sshT("removeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{sshT("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingRemove)
                  void run(() =>
                    useIdeStore.getState().removeSshHost(pendingRemove.id),
                  );
                setPendingRemove(null);
              }}
            >
              {sshT("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PairHostDialog({
  onCancel,
  onPair,
}: {
  onCancel: () => void;
  onPair: (url: string, label: string) => Promise<void>;
}) {
  const t = useTranslations("connections");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void onPair(url.trim(), label)
              .catch((reason) =>
                setError(
                  reason instanceof Error
                    ? reason.message.replace(
                        /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
                        "",
                      )
                    : String(reason),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pair")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{t("pairHint")}</p>
          <div className="space-y-2">
            <Label htmlFor="pair-host-link">{t("pairLink")}</Label>
            <Input
              autoFocus
              id="pair-host-link"
              type="password"
              autoComplete="off"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pair-host-name">{t("name")}</Label>
            <Input
              id="pair-host-name"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="break-words text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={busy || !url.trim() || !getDesktopApi()}
              type="submit"
            >
              {busy ? t("pairing") : t("pair")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
