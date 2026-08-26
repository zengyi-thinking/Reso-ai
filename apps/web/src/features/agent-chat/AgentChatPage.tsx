import { FeaturePlaceholder } from "../../components/FeaturePlaceholder.js";

export function AgentChatPage(): React.JSX.Element {
  return (
    <FeaturePlaceholder
      eyebrow="Reso Agent · Companion"
      title="先陪你待一会儿"
      description="聊天默认接入 Mock Agent。真实 Agent 上线后仍使用同一 AgentTurn Contract，Web 不需要重写。"
      nextPath="/profile"
      nextLabel="查看 Persona Evolution"
    />
  );
}
