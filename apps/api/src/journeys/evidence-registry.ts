import type {
  JourneyAnswerInput,
  JourneyEvidenceItem,
  JourneyEvidenceSignal,
  JourneyVersion,
} from "@reso/contracts";

interface ChoiceDefinition {
  id: string;
  optionText: string;
  summary: string;
  signals: JourneyEvidenceSignal[];
  companionMood: string;
}

interface QuestionDefinition {
  stageId: string;
  questionId: string;
  contextTags: string[];
  pressure: JourneyEvidenceItem["pressure"];
  choices: ChoiceDefinition[];
}

export interface JourneyDefinition {
  version: JourneyVersion;
  evidenceVersion: 1;
  questions: QuestionDefinition[];
}

const signal = (dimension: string, value: string, weight = 1): JourneyEvidenceSignal => ({
  dimension,
  value,
  weight,
});

const mountainV1 = {
  version: "mountain-v1",
  evidenceVersion: 1,
  questions: [
    {
      stageId: "invitation",
      questionId: "invitation",
      contextTags: ["mountain", "shared-trip", "planning"],
      pressure: "medium",
      choices: [
        {
          id: "planned",
          optionText: "好呀，不过我先列个装备清单，查天气和备用路线吧。",
          summary: "共同出行前倾向先确认装备、天气和备用路线",
          signals: [signal("planning", "structured", 2), signal("risk", "cautious")],
          companionMood: "安心",
        },
        {
          id: "escape",
          optionText: "一言为定，周五下班就开飞行模式，一起去山里做快乐的失踪人口！",
          summary: "共同出行时重视暂离日常和即兴体验",
          signals: [signal("exploration", "spontaneous", 2), signal("autonomy", "escape-routine")],
          companionMood: "兴奋",
        },
        {
          id: "devoted",
          optionText: "只要你想去，再险我也陪你。",
          summary: "面对伴侣想尝试的冒险时倾向优先陪伴",
          signals: [signal("closeness", "devoted", 2), signal("risk", "relationship-first")],
          companionMood: "感动",
        },
      ],
    },
    {
      stageId: "fatigue",
      questionId: "fatigue",
      contextTags: ["mountain", "fatigue", "support"],
      pressure: "medium",
      choices: [
        {
          id: "solve",
          optionText: "拿出地图或指南针：别慌，我们先核对海拔和剩余路程。",
          summary: "疲惫出现时倾向先核对信息并寻找可执行办法",
          signals: [
            signal("emotionalSupport", "problem-solving", 2),
            signal("stressResponse", "practical"),
          ],
          companionMood: "放松",
        },
        {
          id: "empathize",
          optionText: "递过水壶：是挺坑的，累了就多休整一会儿，大不了原路返回。",
          summary: "疲惫出现时倾向先承认感受并允许调整计划",
          signals: [signal("emotionalSupport", "empathy", 3), signal("support", "reassurance", 2)],
          companionMood: "被理解",
        },
        {
          id: "blame",
          optionText: "是你非要找这种野线，现在只能硬着头皮上了。",
          summary: "疲惫压力下倾向先指出决定来源和责任归属",
          signals: [signal("conflict", "blame-first", 2), signal("accountability", "externalized")],
          companionMood: "退缩",
        },
      ],
    },
    {
      stageId: "slip",
      questionId: "slip",
      contextTags: ["mountain", "sudden-danger", "support"],
      pressure: "high",
      choices: [
        {
          id: "command",
          optionText: "大吼：别往下看！看着我！把另一只手给我！",
          summary: "突发危险中倾向用明确指令组织双方行动",
          signals: [signal("stressResponse", "directive", 3), signal("support", "verbal-guidance")],
          companionMood: "紧张",
        },
        {
          id: "support",
          optionText: "一声不吭趴进泥里，用身体和腿卡住岩石，给同伴一个支点。",
          summary: "突发危险中倾向先用具体行动提供支点",
          signals: [
            signal("stressResponse", "action-support", 3),
            signal("reliability", "hands-on", 2),
          ],
          companionMood: "安心",
        },
        {
          id: "freeze",
          optionText: "呼吸骤停，大脑空白半秒后才慌乱扑向崖边。",
          summary: "突发危险中可能先短暂停顿，再进入行动",
          signals: [
            signal("stressResponse", "delayed-response", 2),
            signal("overload", "brief-pause"),
          ],
          companionMood: "恐慌",
        },
      ],
    },
    {
      stageId: "storm-thought",
      questionId: "storm-thought",
      contextTags: ["mountain", "storm", "risk-boundary"],
      pressure: "high",
      choices: [
        {
          id: "finish",
          optionText: "既然设定了登顶的目标，就算被暴雨吞噬也必须按计划完成，绝不允许失控。",
          summary: "计划受阻时倾向坚持原定目标",
          signals: [signal("decision", "goal-persistence", 3), signal("risk", "fixed-plan", 2)],
          companionMood: "紧绷",
        },
        {
          id: "extreme",
          optionText: "越是生死一线的绝境，强行登顶后的风景和我们的羁绊才越是刻骨铭心。",
          summary: "不确定情境中容易关注少见体验的吸引力",
          signals: [signal("risk", "thrill-seeking", 3), signal("exploration", "novelty", 2)],
          companionMood: "忐忑",
        },
        {
          id: "retreat",
          optionText: "失温的风险已经超过临界值，别管什么沉没成本，现在立刻下撤才是唯一的生路。",
          summary: "危险超过临界时倾向停止原定目标并主动下撤",
          signals: [signal("decision", "safety-boundary", 3), signal("risk", "retreat", 2)],
          companionMood: "安心",
        },
        {
          id: "protect",
          optionText: "什么登顶的执念都不重要了，我现在唯一的任务就是带同伴活着回到安全区。",
          summary: "危险情境中倾向主动承担保护责任",
          signals: [signal("support", "protective", 3), signal("responsibility", "take-charge", 2)],
          companionMood: "安心",
        },
      ],
    },
    {
      stageId: "cave-repair",
      questionId: "cave-repair",
      contextTags: ["mountain", "post-crisis", "repair"],
      pressure: "medium",
      choices: [
        {
          id: "lecture",
          optionText: "边擦雨水边说：你看，我早说该做备用计划吧？",
          summary: "危机过后倾向先复盘错误和改进办法",
          signals: [
            signal("repair", "correction-first", 2),
            signal("communication", "analysis-first", 2),
          ],
          companionMood: "委屈",
        },
        {
          id: "hug",
          optionText: "把同伴紧紧抱在怀里，不断说：没事了，有我在。",
          summary: "危机过后倾向先通过拥抱和确认恢复连接",
          signals: [
            signal("repair", "reconnect-first", 3),
            signal("emotionalSupport", "reassurance", 3),
          ],
          companionMood: "安心",
        },
        {
          id: "space",
          optionText: "倒一杯热咖啡递给同伴，然后退开半步，让同伴安静缓冲。",
          summary: "危机过后倾向提供实际照顾，并给对方缓冲空间",
          signals: [signal("repair", "space-first", 3), signal("emotionalSupport", "practical", 2)],
          companionMood: "放松",
        },
      ],
    },
    {
      stageId: "home-message",
      questionId: "home-message",
      contextTags: ["home", "after-intensity", "closeness"],
      pressure: "medium",
      choices: [
        {
          id: "avoid",
          optionText: "先不主动发消息，明天白天再客套地问一句：昨晚休息得好吗？",
          summary: "高强度共同经历后倾向先独处，再恢复联系",
          signals: [
            signal("closeness", "recovery-distance", 2),
            signal("communication", "delayed", 2),
          ],
          companionMood: "失落",
        },
        {
          id: "secure",
          optionText: "我的腿还在发软，客厅也被我踩脏了。但雨里的你比完美标签更真实。",
          summary: "关系加深时愿意接纳彼此不完美和脆弱的一面",
          signals: [signal("vulnerability", "acceptance", 3), signal("closeness", "honest", 2)],
          companionMood: "感动",
        },
        {
          id: "anxious",
          optionText: "发一大段复盘，反复确认：如果你出了事我怎么办？我们以后别分开了好吗？",
          summary: "关系加深后倾向通过充分复盘和确认获得安心",
          signals: [
            signal("closeness", "reassurance-seeking", 3),
            signal("communication", "intensive", 2),
          ],
          companionMood: "压力",
        },
      ],
    },
    {
      stageId: "city-realization",
      questionId: "city-realization",
      contextTags: ["city", "future", "life-direction"],
      pressure: "low",
      choices: [
        {
          id: "build",
          optionText: "我只想在城市里深深扎根，建立一个能挡风遮雨的家。",
          summary: "经历不确定后更重视稳定生活和长期建设",
          signals: [signal("futureHome", "stable", 3), signal("lifestyle", "rooted", 2)],
          companionMood: "安心",
        },
        {
          id: "enjoy",
          optionText: "未来规划算什么，我只想痛痛快快享受每一口热饭和每一次拥抱。",
          summary: "经历不确定后更重视当下体验和真实感受",
          signals: [signal("lifestyle", "present-focused", 3), signal("planning", "flexible")],
          companionMood: "温暖",
        },
        {
          id: "roam",
          optionText: "如果安稳就是这条车河，我宁愿一直在路上，去更远更野的地方。",
          summary: "经历不确定后仍向往流动生活和未知探索",
          signals: [signal("futureHome", "mobile", 2), signal("exploration", "open", 3)],
          companionMood: "向往",
        },
      ],
    },
  ],
} satisfies JourneyDefinition;

const definitions = new Map<JourneyVersion, JourneyDefinition>([[mountainV1.version, mountainV1]]);

export function getJourneyDefinition(version: JourneyVersion): JourneyDefinition {
  const definition = definitions.get(version);
  if (definition === undefined) throw new JourneyDefinitionError("Unknown Journey version");
  return definition;
}

export function nextQuestionId(
  version: JourneyVersion,
  answeredQuestionIds: string[],
): string | null {
  const answered = new Set(answeredQuestionIds);
  return (
    getJourneyDefinition(version).questions.find(({ questionId }) => !answered.has(questionId))
      ?.questionId ?? null
  );
}

export function resolveJourneyEvidence(
  version: JourneyVersion,
  answer: JourneyAnswerInput,
  metadata: { answerId: string; answeredAt: string },
): JourneyEvidenceItem {
  const definition = getJourneyDefinition(version);
  const question = definition.questions.find(
    ({ stageId, questionId }) => stageId === answer.stageId && questionId === answer.questionId,
  );
  if (question === undefined) throw new JourneyDefinitionError("Unknown Journey stage/question");

  const isFreeResponse = answer.choiceId === "free-response";
  const choice = question.choices.find(({ id }) => id === answer.choiceId);
  if (choice === undefined && !isFreeResponse) {
    throw new JourneyDefinitionError("Unknown Journey choice");
  }

  if (isFreeResponse) {
    return {
      evidenceRef: `${version}/${answer.questionId}/${answer.choiceId}@${metadata.answerId}`,
      journeyVersion: version,
      stageId: answer.stageId,
      questionId: answer.questionId,
      choiceId: answer.choiceId,
      optionText: "自由回答",
      responseText: answer.responseText ?? null,
      target: "self",
      summary: "用户在该情境中提供了自由回答，内容需要结合其他证据谨慎理解",
      signals: [signal("freeResponse", "user-authored", 1)],
      contextTags: [...question.contextTags, "free-response"],
      pressure: question.pressure,
      companionMood: null,
      elapsedMs: answer.elapsedMs ?? null,
      answeredAt: metadata.answeredAt,
    };
  }

  if (choice === undefined) throw new JourneyDefinitionError("Unknown Journey choice");

  return {
    evidenceRef: `${version}/${answer.questionId}/${answer.choiceId}@${metadata.answerId}`,
    journeyVersion: version,
    stageId: answer.stageId,
    questionId: answer.questionId,
    choiceId: answer.choiceId,
    optionText: choice.optionText,
    responseText: null,
    target: "self",
    summary: choice.summary,
    signals: choice.signals.map((item) => ({ ...item })),
    contextTags: [...question.contextTags],
    pressure: question.pressure,
    companionMood: choice.companionMood,
    elapsedMs: answer.elapsedMs ?? null,
    answeredAt: metadata.answeredAt,
  };
}

export class JourneyDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JourneyDefinitionError";
  }
}
