import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Every Tailwind base color at one shade, written out in full so Tailwind's
// class scanner finds them.
const STATUS_DOT_COLORS = {
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  cyan: "bg-cyan-500",
  emerald: "bg-emerald-500",
  fuchsia: "bg-fuchsia-500",
  gray: "bg-gray-500",
  green: "bg-green-500",
  indigo: "bg-indigo-500",
  lime: "bg-lime-500",
  mauve: "bg-mauve-500",
  mist: "bg-mist-500",
  neutral: "bg-neutral-500",
  olive: "bg-olive-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
  slate: "bg-slate-500",
  stone: "bg-stone-500",
  taupe: "bg-taupe-500",
  teal: "bg-teal-500",
  violet: "bg-violet-500",
  yellow: "bg-yellow-500",
  zinc: "bg-zinc-500",
} as const;

export type StatusDotColor = keyof typeof STATUS_DOT_COLORS;

export type StatusDotProps = Omit<ComponentProps<"span">, "color" | "role"> & {
  color?: StatusDotColor;
  pulse?: boolean;
};

export const StatusDot = ({
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  className,
  color = "green",
  pulse = true,
  style,
  ...props
}: StatusDotProps) => {
  return (
    <span
      aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
      aria-label={ariaLabel}
      className={cn(
        "size-2 shrink-0 rounded-full",
        STATUS_DOT_COLORS[color],
        pulse && "animate-pulse",
        className,
      )}
      role="img"
      style={style}
      {...props}
    />
  );
};
