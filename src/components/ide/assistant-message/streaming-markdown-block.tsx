import { useContext, useMemo } from "react";
import { Block, type BlockProps, parseMarkdownIntoBlocks } from "streamdown";
import {
  dreamStreamingRehypePlugin,
  getMarkdownBlockAnimationTokenStartIndices,
  getMarkdownBlockStartOffsets,
  StreamingMarkdownBlockContext,
  type StreamingMarkdownBlockContextValue,
} from "./streaming-message";

type StreamingAnimationLayout = {
  blockStartOffsets: number[];
  blockTokenStartIndices: number[];
};

// Every block of a message reads the same context value, so the whole-message
// layout is computed once per value instead of once per block. A context value
// is never mutated, which keeps this safe under concurrent rendering.
const streamingAnimationLayouts = new WeakMap<
  StreamingMarkdownBlockContextValue,
  StreamingAnimationLayout
>();

const getStreamingAnimationLayout = (
  context: StreamingMarkdownBlockContextValue,
) => {
  const cachedLayout = streamingAnimationLayouts.get(context);
  if (cachedLayout) {
    return cachedLayout;
  }

  const blocks = parseMarkdownIntoBlocks(context.markdownText);
  const layout = {
    blockStartOffsets: getMarkdownBlockStartOffsets(
      context.markdownText,
      blocks,
    ),
    blockTokenStartIndices: getMarkdownBlockAnimationTokenStartIndices(
      context.markdownText,
      context.markdownAnimationStartOffset,
      blocks,
    ),
  };
  streamingAnimationLayouts.set(context, layout);
  return layout;
};

const StreamingMarkdownBlock = (props: BlockProps) => {
  const animationContext = useContext(StreamingMarkdownBlockContext);
  const layout = animationContext?.animateStreamedText
    ? getStreamingAnimationLayout(animationContext)
    : null;
  const blockAnimationStartOffset =
    layout && animationContext
      ? Math.min(
          props.content.length,
          Math.max(
            0,
            animationContext.markdownAnimationStartOffset -
              (layout.blockStartOffsets[props.index] ?? 0),
          ),
        )
      : props.content.length;
  const animationTokenStartIndex =
    layout?.blockTokenStartIndices[props.index] ?? 0;
  // A block with nothing left to reveal keeps Streamdown's own plugin list.
  // Streamdown's Block is memoized on that list's identity, so settled blocks
  // skip the markdown pipeline on every tick and when the animation turns off.
  const animatesBlock = blockAnimationStartOffset < props.content.length;
  const rehypePlugins = useMemo<BlockProps["rehypePlugins"]>(
    () =>
      animatesBlock
        ? [
            ...(props.rehypePlugins ?? []),
            // The per-block offsets are plugin options on purpose: Streamdown
            // caches processors by plugin name and options, so state captured
            // in a closure would be shared across blocks. See
            // dreamStreamingRehypePlugin.
            [
              dreamStreamingRehypePlugin,
              {
                animationStartOffset: blockAnimationStartOffset,
                animationTokenStartIndex,
              },
            ],
          ]
        : props.rehypePlugins,
    [
      animatesBlock,
      animationTokenStartIndex,
      blockAnimationStartOffset,
      props.rehypePlugins,
    ],
  );

  return <Block {...props} rehypePlugins={rehypePlugins} />;
};

export default StreamingMarkdownBlock;
