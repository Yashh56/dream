/**
 * Opening a folder as a project, in a browser client: a phone has no
 * folder of the host to pick, so the host's own folders are browsed
 * through its directory API (or a path typed), and the project opens on
 * the home host.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useIdeStore } from "@/components/ide/ide-store";
import { HostFolderBrowser } from "@/components/ide/ssh/host-folder-browser";
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
import { LOCAL_HOST_ID } from "@/lib/host-routing";

export const OpenHomeFolderDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useTranslations("remote");
  const commonT = useTranslations("sshHosts");
  const addProject = useIdeStore((state) => state.addProject);
  const setSettingsOpen = useIdeStore((state) => state.setSettingsOpen);
  const [path, setPath] = useState("");

  const handleOpen = () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setSettingsOpen(false);
    addProject(trimmed);
    setPath("");
    onOpenChange(false);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("openFolderTitle", { host: getClientPlatform().homeLabel })}
          </DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleOpen();
          }}
        >
          {open ? (
            <HostFolderBrowser hostId={LOCAL_HOST_ID} onPathChange={setPath} />
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="open-home-folder-path">{t("folderPath")}</Label>
            <Input
              autoCapitalize="off"
              autoCorrect="off"
              className="font-mono"
              id="open-home-folder-path"
              onChange={(event) => setPath(event.target.value)}
              spellCheck={false}
              value={path}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              {commonT("cancel")}
            </Button>
            <Button disabled={!path.trim()} type="submit">
              {commonT("open")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
