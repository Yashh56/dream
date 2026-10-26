/**
 * Settings > Remote access (the desktop's): whether paired devices can reach
 * this computer and how (Tailscale, or the user's own HTTPS reverse proxy),
 * pairing a device by QR code, link or code, confirming code requests, and
 * revoking paired devices. The host owns all of it (host/remote-access/,
 * host/auth/); this section is its local operator's view.
 */
import {
  Check,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { encode } from "uqr";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot } from "@/components/ui/status-dot";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage, type RemoteDeviceSession } from "@/lib/api-client";
import { getDesktopApi } from "@/lib/electron";
import { useIdeStore } from "../ide-store";
import { createRemoteAccessState } from "./remote-access-state";
import { SettingsGroup } from "./settings-shared";

<<<<<<< HEAD
=======
const POLL_MS = 3_000;

const isValidPort = (value: string) => {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
};

>>>>>>> 0a7673e01ef8e7d79ecabf8fcc87ac14d1f29f86
type ScopeChoice = "view" | "operate" | "manage";
const SCOPES_FOR: Record<ScopeChoice, string[]> = {
  manage: ["view", "operate", "manage"],
  operate: ["view", "operate"],
  view: ["view"],
};

/** The QR code of `text`, as an SVG drawn from its modules. */
const QrImage = ({ text, label }: { text: string; label: string }) => {
  const path = useMemo(() => {
    const { data, size } = encode(text, { border: 2 });
    let d = "";
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (data[y]?.[x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { d, size };
  }, [text]);
  return (
    <svg
      aria-label={label}
      className="size-48 rounded-md bg-white"
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${path.size} ${path.size}`}
    >
      <path d={path.d} fill="#000" />
    </svg>
  );
};

const copyText = async (text: string) => {
  const desktop = getDesktopApi();
  if (desktop) return desktop.writeClipboardText(text);
  await navigator.clipboard.writeText(text);
  return true;
};

export const RemoteAccessSection = () => {
  const t = useTranslations("remote");
  const openExternalUrl = useIdeStore((state) => state.openExternalUrl);
<<<<<<< HEAD
  const remote = useMemo(() => createRemoteAccessState(), []);
  const {
    status,
    initialStatus,
    busy,
    error: failure,
    claims,
    devices,
    pairing,
    pairingUrl,
  } = useSyncExternalStore(
    remote.subscribe,
    remote.getSnapshot,
    remote.getSnapshot,
  );
  useEffect(() => {
    remote.start();
    return remote.stop;
  }, [remote]);
  const error = failure
    ? getApiErrorMessage(
        failure.cause,
        t(
          failure.kind === "load"
            ? "loadFailed"
            : failure.kind === "pair"
              ? "pairFailed"
              : "changeFailed",
        ),
      )
    : null;
  const [modeDraft, setMode] = useState<"tailscale" | "origin" | null>(null);
  const [originDraft, setOrigin] = useState<string | null>(null);
  const [portDraft, setHttpsPort] = useState<string | null>(null);
  const mode = modeDraft ?? initialStatus?.mode ?? "tailscale";
  const origin = originDraft ?? initialStatus?.requestedOrigin ?? "";
  const httpsPort = portDraft ?? String(initialStatus?.httpsPort ?? 443);
=======
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"tailscale" | "origin">("tailscale");
  const [origin, setOrigin] = useState("");
  const [httpsPort, setHttpsPort] = useState("443");
  const [localPort, setLocalPort] = useState("");
  const [claims, setClaims] = useState<RemoteClaim[]>([]);
  const [devices, setDevices] = useState<RemoteDeviceSession[]>([]);
>>>>>>> 0a7673e01ef8e7d79ecabf8fcc87ac14d1f29f86
  const [pairOpen, setPairOpen] = useState(false);
  const changePairOpen = (open: boolean) => {
    setPairOpen(open);
    if (!open) remote.clearPairing();
  };
  const [scope, setScope] = useState<ScopeChoice>("operate");
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] =
    useState<RemoteDeviceSession | null>(null);
<<<<<<< HEAD
  const enable = () =>
    remote.enable(
      mode === "origin"
        ? { mode, origin: origin.trim() }
        : { httpsPort: Number(httpsPort) || 443, mode },
=======

  // The form starts from what the host has saved.
  const adopt = useCallback((next: RemoteAccessStatus) => {
    setStatus(next);
    setMode(next.mode);
    if (next.requestedOrigin) setOrigin(next.requestedOrigin);
    setHttpsPort(String(next.httpsPort));
    setLocalPort(next.port === null ? "" : String(next.port));
  }, []);

  const loadLists = useCallback(async () => {
    const [claimList, sessionList] = await Promise.all([
      apiClient.remoteClaims({}),
      apiClient.remoteSessions({}),
    ]);
    setClaims(claimList.claims);
    setDevices(sessionList.sessions.filter((session) => !session.revokedAt));
  }, []);

  useEffect(() => {
    let stopped = false;
    void apiClient
      .remoteAccess({})
      .then((next) => {
        if (!stopped) adopt(next);
      })
      .catch((failure: unknown) =>
        setError(getApiErrorMessage(failure, t("loadFailed"))),
      );
    const poll = () => {
      void apiClient
        .remoteAccess({})
        .then((next) => {
          if (!stopped) setStatus(next);
        })
        .catch(() => undefined);
      void loadLists().catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [adopt, loadLists, t]);

  const run = async (work: () => Promise<RemoteAccessStatus>) => {
    setBusy(true);
    setError(null);
    try {
      adopt(await work());
    } catch (failure) {
      setError(getApiErrorMessage(failure, t("changeFailed")));
    } finally {
      setBusy(false);
    }
  };

  const enable = () =>
    run(() =>
      apiClient.remoteAccessEnable(
        mode === "origin"
          ? {
              mode,
              origin: origin.trim(),
              port: localPort === "" ? null : Number(localPort),
            }
          : {
              httpsPort: Number(httpsPort),
              mode,
              port: localPort === "" ? null : Number(localPort),
            },
      ),
>>>>>>> 0a7673e01ef8e7d79ecabf8fcc87ac14d1f29f86
    );
  const enabled = status?.enabled ?? false;
<<<<<<< HEAD
=======
  const portsValid =
    (localPort === "" || isValidPort(localPort)) &&
    (mode !== "tailscale" || isValidPort(httpsPort));
  // Only a verified public address is offered to a device.
  const pairingUrl =
    pairing && status?.origin
      ? (pairing.urls.find((url) => url.startsWith(status.origin ?? "")) ??
        null)
      : null;
>>>>>>> 0a7673e01ef8e7d79ecabf8fcc87ac14d1f29f86
  const scopeLabel = (scopes: string[]) =>
    scopes.includes("manage")
      ? t("scopeManage")
      : scopes.includes("operate")
        ? t("scopeOperate")
        : t("scopeView");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium text-base">{t("accessTitle")}</h3>
        <p className="text-muted-foreground text-sm">
          {t("accessDescription")}
        </p>
      </div>

      <SettingsGroup>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm">{t("accessToggle")}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
              {status === null ? (
                <Spinner className="size-3" />
              ) : !enabled ? (
                t("statusOff")
              ) : status.ready ? (
                <Badge className="gap-1.5" variant="outline">
                  <StatusDot color="green" />
                  {t("statusReady")}
                </Badge>
              ) : (
                <Badge className="gap-1.5" variant="outline">
                  <StatusDot
                    color={status.problem ? "red" : "amber"}
                    pulse={!status.problem}
                  />
                  {status.problem ? t("statusNotReady") : t("statusChecking")}
                </Badge>
              )}
              {status?.ready && status.origin ? (
                <span className="select-text break-all font-mono">
                  {status.origin}
                </span>
              ) : null}
            </div>
          </div>
          <Switch
            aria-label={t("accessToggle")}
            checked={enabled}
            disabled={busy || status === null || (!enabled && !portsValid)}
            onCheckedChange={(checked) =>
              void (checked ? enable() : remote.disable())
            }
          />
        </div>

        <div className="grid gap-3 px-4 py-3">
          <div className="grid gap-1.5">
            <Label htmlFor="remote-access-mode">{t("modeLabel")}</Label>
            <Select
              onValueChange={(value) => {
                if (value === "tailscale" || value === "origin") setMode(value);
              }}
              value={mode}
            >
              <SelectTrigger className="w-full sm:w-72" id="remote-access-mode">
                <SelectValue>
                  {mode === "tailscale" ? t("modeTailscale") : t("modeOrigin")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectItem value="tailscale">{t("modeTailscale")}</SelectItem>
                <SelectItem value="origin">{t("modeOrigin")}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">
              {mode === "tailscale"
                ? t("modeTailscaleHint")
                : t("modeOriginHint", { port: String(status?.port ?? "—") })}
            </span>
          </div>
          {mode === "origin" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="remote-access-origin">{t("originLabel")}</Label>
              <Input
                className="font-mono"
                id="remote-access-origin"
                onChange={(event) => setOrigin(event.target.value)}
                placeholder="https://dream.example.com"
                spellCheck={false}
                value={origin}
              />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="remote-access-https-port">
                {t("httpsPortLabel")}
              </Label>
              <Input
                aria-invalid={!isValidPort(httpsPort)}
                className="w-28 font-mono"
                id="remote-access-https-port"
                inputMode="numeric"
                onChange={(event) =>
                  setHttpsPort(event.target.value.replace(/\D/g, ""))
                }
                value={httpsPort}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="remote-access-local-port">
              {t("localPortLabel")}
            </Label>
            <Input
              aria-invalid={localPort !== "" && !isValidPort(localPort)}
              className="w-28 font-mono"
              id="remote-access-local-port"
              inputMode="numeric"
              onChange={(event) =>
                setLocalPort(event.target.value.replace(/\D/g, ""))
              }
              placeholder={t("portAutomatic")}
              value={localPort}
            />
            <span className="text-muted-foreground text-xs">
              {t("localPortHint")}
            </span>
          </div>
          {!portsValid ? (
            <p className="text-destructive text-sm" role="alert">
              {t("portRange")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={
                busy || !portsValid || (mode === "origin" && !origin.trim())
              }
              onClick={() => void enable()}
              size="sm"
              type="button"
            >
              {busy ? <Spinner className="size-3.5" /> : null}
              {enabled ? t("apply") : t("turnOn")}
            </Button>
            {enabled ? (
              <Button
                disabled={busy}
                onClick={() => void remote.check()}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCw className="size-3.5" />
                {t("checkAgain")}
              </Button>
            ) : null}
          </div>
          {enabled && status?.problem ? (
            <div className="grid gap-2 rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-destructive text-sm">
              <span className="select-text break-words">
                {status.problem.message}
              </span>
              {status.problem.url ? (
                <Button
                  className="w-fit"
                  onClick={() => openExternalUrl(status.problem?.url ?? "")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ExternalLink className="size-3.5" />
                  {t("openSetupPage")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p className="select-text text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </SettingsGroup>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-medium text-sm">{t("devicesTitle")}</h4>
        <Button
          disabled={busy || !status?.ready}
          onClick={() => {
            remote.clearPairing();
            setPairOpen(true);
          }}
          size="sm"
          title={status?.ready ? undefined : t("pairNeedsAccess")}
          type="button"
        >
          <QrCode className="size-4" />
          {t("pairDevice")}
        </Button>
      </div>

      {claims.length > 0 ? (
        <SettingsGroup label={t("requestsTitle")}>
          {claims.map((claim) => (
            <div
              className="flex items-center gap-3 px-4 py-3"
              key={claim.claimId}
            >
              <Smartphone className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm">
                  {claim.deviceName}
                </div>
                <div className="text-muted-foreground text-xs">
                  {scopeLabel(claim.scopes)}
                </div>
              </div>
              <Button
                disabled={busy}
                onClick={() => void remote.answer(claim.claimId, false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <X className="size-3.5" />
                {t("deny")}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void remote.answer(claim.claimId, true)}
                size="sm"
                type="button"
              >
                <Check className="size-3.5" />
                {t("confirm")}
              </Button>
            </div>
          ))}
        </SettingsGroup>
      ) : null}

      {devices.length === 0 ? (
        <p className="py-3 text-center text-muted-foreground text-sm">
          {t("noDevices")}
        </p>
      ) : (
        <SettingsGroup>
          {devices.map((device) => (
            <div className="flex items-center gap-3 px-4 py-3" key={device.id}>
              <Smartphone className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm">
                  {device.deviceName}
                </div>
                <div className="text-muted-foreground text-xs">
                  {scopeLabel(device.scopes)} ·{" "}
                  {t("lastUsed", {
                    time: new Date(device.lastUsedAt).toLocaleString(),
                  })}
                </div>
              </div>
              <Button
                aria-label={t("revokeTitle", { device: device.deviceName })}
                disabled={busy}
                onClick={() => setPendingRevoke(device)}
                size="icon-sm"
                title={t("revoke")}
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </SettingsGroup>
      )}

      <Dialog onOpenChange={changePairOpen} open={pairOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pairDevice")}</DialogTitle>
            <DialogDescription>{t("pairDialogDescription")}</DialogDescription>
          </DialogHeader>
          {pairing ? (
            <div className="grid justify-items-center gap-3">
              {pairingUrl ? (
                <>
                  <QrImage label={t("pairDevice")} text={pairingUrl} />
                  <div className="flex w-full items-center gap-2">
                    <Input
                      className="font-mono text-xs"
                      readOnly
                      value={pairingUrl}
                    />
                    <Button
                      aria-label={t("copyLink")}
                      onClick={() =>
                        void copyText(pairingUrl).then(() => {
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        })
                      }
                      size="icon-sm"
                      title={t("copyLink")}
                      type="button"
                      variant="outline"
                    >
                      {copied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </>
              ) : null}
              <p className="text-center text-muted-foreground text-sm">
                {t("pairingCodeHint", { code: pairing.code })}
              </p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="remote-access-scope">{t("accessLevel")}</Label>
              <Select
                onValueChange={(value) => {
                  if (
                    value === "view" ||
                    value === "operate" ||
                    value === "manage"
                  )
                    setScope(value);
                }}
                value={scope}
              >
                <SelectTrigger className="w-full" id="remote-access-scope">
                  <SelectValue>{scopeLabel(SCOPES_FOR[scope])}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectItem value="view">{t("scopeView")}</SelectItem>
                  <SelectItem value="operate">{t("scopeOperate")}</SelectItem>
                  <SelectItem value="manage">{t("scopeManage")}</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs">
                {t("accessLevelHint")}
              </span>
            </div>
          )}
          <DialogFooter>
            {pairing ? (
              <Button onClick={() => changePairOpen(false)} type="button">
                {t("done")}
              </Button>
            ) : (
              <>
                <Button
                  onClick={() => changePairOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  {t("cancel")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void remote.createPairing(SCOPES_FOR[scope])}
                  type="button"
                >
                  {t("createPairing")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        open={pendingRevoke !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("revokeTitle", { device: pendingRevoke?.deviceName ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("revokeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (pendingRevoke) void remote.revoke(pendingRevoke.id);
                setPendingRevoke(null);
              }}
              variant="destructive"
            >
              {t("revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
