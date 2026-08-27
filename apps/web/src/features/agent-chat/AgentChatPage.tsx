import { FeaturePlaceholder } from "../../components/FeaturePlaceholder.js";

export function AgentChatPage(): React.JSX.Element {
  return (
    <FeaturePlaceholder
      eyebrow="Reso Agent · Companion"
      title="先陪你待一会儿"
      description="聊天通过 Product API 接入真实 Reso Agent，并使用统一的 AgentTurn Contract。"
      nextPath="/profile"
      nextLabel="查看 Persona Evolution"
    />
  );
}
