export const colors = {
  paper: "#FCFBFF",
  lavender: "#EEE8FF",
  violet: "#7C55E7",
  violetDeep: "#5E3ED1",
  orchid: "#C176E7",
  peach: "#FFB890",
  muted: "#817A91",
  cream: "#FFF8E8",
  sky: "#A9D8F5",
  skyDeep: "#5B9EC9",
  leaf: "#BFD9B5",
  apricot: "#F4C39D",
  ink: "#29233C",
  mist: "#EEF5F4",
  white: "#FFFFFF",
} as const;

export const radii = { soft: "18px", card: "28px", pill: "999px" } as const;
export const shadows = {
  soft: "0 18px 48px rgba(94, 62, 209, 0.12)",
  lift: "0 24px 72px rgba(72, 48, 145, 0.16)",
} as const;

export const spacing = { base: "4px", pageMobile: "22px" } as const;
export const motion = { control: "180ms", entry: "280ms", progress: "500ms" } as const;
