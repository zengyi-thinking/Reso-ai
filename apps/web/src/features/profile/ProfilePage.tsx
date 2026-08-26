import { FeaturePlaceholder } from "../../components/FeaturePlaceholder.js";

export function ProfilePage(): React.JSX.Element {
  return (
    <FeaturePlaceholder
      eyebrow="My · Personal Manual"
      title="保存过去，也允许改变"
      description="这里会呈现 Persona Version、证据、置信度与待确认修改。Memory 记录发生过什么，Persona 记录当前如何理解。"
    />
  );
}
