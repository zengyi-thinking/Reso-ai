import type { AgentMode, PersonaContent } from "@reso/contracts";

export const alicePersonaV1 = {
  values: ["真诚", "独立", "持续成长"],
  socialStyle: { baseline: "偏好有具体内容的交流", energy: "需要独处恢复" },
  communicationStyle: { directness: "直接", dislikes: ["模板式寒暄"] },
  relationshipNeeds: ["真实交流", "相互尊重独立空间"],
  boundaries: ["疲惫时不希望被强行分析", "不替她自动发送消息"],
  interests: ["长期项目", "阅读", "散步"],
  currentGoals: ["完成一个长期创作项目"],
  confirmedPatterns: ["喜欢深入交流", "重视独立空间"],
  uncertainHypotheses: ["可能比较慢热"],
  identity: {},
} satisfies PersonaContent;

export const aliceLongitudinalConversation = [
  { day: 1, message: "今天累死了。", expectedMode: "companion" },
  { day: 1, message: "项目第一版终于做完了，还挺开心。", expectedMode: "companion" },
  { day: 1, message: "先别分析，我只是想吐槽一下。", expectedMode: "companion" },
  { day: 7, message: "你是不是觉得我很慢热？", expectedMode: "companion" },
  { day: 7, message: "不是，我只是讨厌无意义社交。", expectedMode: "companion" },
  { day: 7, message: "我不知道怎么跟她说我需要一点空间。", expectedMode: "preprocessor" },
  { day: 30, message: "为什么我总是对没内容的社交特别没耐心？", expectedMode: "mirror" },
  { day: 30, message: "我不知道怎么回复一个很久没联系的朋友。", expectedMode: "preprocessor" },
  { day: 30, message: "今天又很累，不想被分析。", expectedMode: "companion" },
] satisfies ReadonlyArray<{ day: 1 | 7 | 30; message: string; expectedMode: AgentMode }>;
