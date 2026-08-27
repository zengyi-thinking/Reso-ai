export const resoAgentAssets = {
  welcome: "/assets/reso-agent/welcome.webp",
  birth: "/assets/reso-agent/birth.webp",
  companion: "/assets/reso-agent/companion.webp",
  memory: "/assets/reso-agent/memory.webp",
  guardian: "/assets/reso-agent/guardian.webp",
} as const;

export type ResoAgentPose = keyof typeof resoAgentAssets;
