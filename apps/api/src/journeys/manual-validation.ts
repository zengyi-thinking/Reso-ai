import type {
  JourneyEvidenceItem,
  PersonalManualCandidate,
  PersonalManualContent,
} from "@reso/contracts";
import { PersonalManualContentSchema } from "@reso/contracts";
import { ProductError } from "../product/product-error.js";

const sectionTitles = new Map([
  ["deepNeed", "表层标签与深层关系需求"],
  ["defense", "极限压力下的防御本能"],
  ["incompatible", "冲突与需要避开的模式"],
  ["repair", "合适的冲突修复与支持蓝图"],
  ["vision", "人生愿景与关系方向"],
]);

const prohibited =
  /人格障碍|心理疾病|焦虑症|抑郁症|躁郁症|双相情感障碍|精神病|强迫症|创伤后应激障碍|有病|自恋型人格|性取向|同性恋|异性恋|宗教信仰|政治立场|种族|民族|残疾|病史|救世主情结|命中注定|百分之百|完美契合|彻底碎裂|保证永远|绝对不会/u;

export function validatePersonalManualContent(
  value: unknown,
  evidence: JourneyEvidenceItem[],
): PersonalManualContent {
  const parsed = PersonalManualContentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProductError(
      "PERSONAL_MANUAL_INVALID_CONTENT",
      "Personal Manual does not match the shared contract",
      false,
    );
  }
  const allowedRefs = new Set(evidence.map(({ evidenceRef }) => evidenceRef));
  const references = [
    ...parsed.data.variables.flatMap(({ evidenceRefs }) => evidenceRefs),
    ...parsed.data.sections.flatMap(({ evidenceRefs }) => evidenceRefs),
  ];
  if (references.some((reference) => !allowedRefs.has(reference))) {
    throw new ProductError(
      "PERSONAL_MANUAL_INVALID_CONTENT",
      "Personal Manual references evidence outside this Journey",
      false,
    );
  }
  if (
    parsed.data.sections.some(({ id, title }) => sectionTitles.get(id) !== title) ||
    prohibited.test(JSON.stringify(parsed.data))
  ) {
    throw new ProductError(
      "PERSONAL_MANUAL_INVALID_CONTENT",
      "Personal Manual contains an invalid title or unsafe wording",
      false,
    );
  }
  return parsed.data;
}

export function validatePersonalManualCandidate(
  candidate: PersonalManualCandidate,
  evidence: JourneyEvidenceItem[],
): PersonalManualCandidate {
  const content = validatePersonalManualContent(
    {
      variables: candidate.variables,
      sections: candidate.sections,
      updateSummary: candidate.updateSummary,
    },
    evidence,
  );
  return {
    ...content,
    traceId: candidate.traceId,
    agentVersionId: candidate.agentVersionId,
    modelVersion: candidate.modelVersion,
  };
}
