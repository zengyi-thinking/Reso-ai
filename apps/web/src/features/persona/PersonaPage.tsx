import { FeaturePlaceholder } from "../../components/FeaturePlaceholder.js";

export function PersonaPage(): React.JSX.Element {
  return (
    <FeaturePlaceholder
      eyebrow="Personal Manual · Draft"
      title="这不是关于你的定论"
      description="它是一份可以解释、修改、补充和持续演进的理解草稿。任何 Persona Patch 都需要你的确认。"
      nextPath="/patch-review"
      nextLabel="看看理解如何被修正"
    />
  );
}
