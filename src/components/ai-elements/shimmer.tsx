import type { CSSProperties, ElementType } from "react";
import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

// A CSS keyframe (shimmer-sweep in globals.css) rather than a JavaScript
// animation: background-position still repaints the text each frame, but no
// script runs per frame.
const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  return (
    <Component
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--shimmer-highlight:var(--color-background)] dark:[--shimmer-highlight:var(--color-foreground)]",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--shimmer-highlight),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          animation: `shimmer-sweep ${duration}s linear infinite`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
