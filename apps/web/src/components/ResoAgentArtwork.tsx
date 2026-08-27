import { resoAgentAssets, type ResoAgentPose } from "./reso-agent-assets.js";

export function ResoAgentArtwork({
  pose,
  alt,
  className = "",
  decorative = false,
}: {
  pose: ResoAgentPose;
  alt: string;
  className?: string;
  decorative?: boolean;
}): React.JSX.Element {
  return (
    <img
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
      className={`reso-agent-artwork ${className}`.trim()}
      decoding="async"
      draggable={false}
      src={resoAgentAssets[pose]}
    />
  );
}
