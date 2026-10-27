import { create } from "zustand";

interface OpenProjectDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Whether the dialog is open; opened from the empty page or the shortcut. */
export const useOpenProjectDialog = create<OpenProjectDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Opens the dialog; Settings closes once a project opens. */
export const showOpenProjectDialog = () => {
  useOpenProjectDialog.getState().setOpen(true);
};
