import { TextWrap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Toggle } from "@/components/ui/toggle";

/** A panel header's word wrap switch, pressed while lines wrap. */
export const WordWrapToggle = ({
  onPressedChange,
  pressed,
}: {
  onPressedChange: (pressed: boolean) => void;
  pressed: boolean;
}) => {
  const panelsT = useTranslations("panels");

  return (
    <Toggle
      aria-label={panelsT("wordWrap")}
      className="size-7 min-w-7 shrink-0 px-0"
      onPressedChange={onPressedChange}
      pressed={pressed}
      size="sm"
      title={panelsT("wordWrap")}
    >
      <TextWrap className="size-4" />
    </Toggle>
  );
};
