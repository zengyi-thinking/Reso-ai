from dataclasses import dataclass

from reso_agent.contracts import AgentMode, AgentTurnRequest


@dataclass(frozen=True)
class TurnPerception:
    is_correction: bool
    no_analysis: bool
    asks_expression_help: bool
    asks_analysis: bool
    simple_fatigue: bool


@dataclass(frozen=True)
class ModeSelection:
    mode: AgentMode
    reason: str


class ModeRouter:
    def perceive(self, message: str) -> TurnPerception:
        lowered = message.lower()
        return TurnPerception(
            is_correction=any(marker in lowered for marker in ("不是", "不对", "not really")),
            no_analysis=any(
                marker in lowered for marker in ("不想分析", "别分析", "不要分析", "先别分析")
            ),
            asks_expression_help=any(
                marker in lowered
                for marker in ("不知道怎么说", "怎么回复", "怎么跟", "帮我整理", "怎么表达")
            ),
            asks_analysis=any(
                marker in lowered
                for marker in ("帮我分析", "为什么我总", "什么模式", "你怎么看我", "是不是因为")
            ),
            simple_fatigue=(
                any(marker in lowered for marker in ("累", "疲惫", "没劲")) and len(message) <= 24
            ),
        )

    def route(self, request: AgentTurnRequest, perception: TurnPerception) -> ModeSelection:
        if request.requested_mode is AgentMode.PROXY:
            return ModeSelection(AgentMode.PROXY, "explicit proxy request")
        if perception.no_analysis:
            return ModeSelection(AgentMode.COMPANION, "user explicitly declined analysis")
        if perception.simple_fatigue:
            return ModeSelection(AgentMode.COMPANION, "simple emotional sharing; anti-overanalysis")
        if request.requested_mode is not None:
            return ModeSelection(request.requested_mode, "explicit bounded mode request")
        if perception.asks_expression_help:
            return ModeSelection(AgentMode.PREPROCESSOR, "user asked for help expressing intent")
        if perception.asks_analysis:
            return ModeSelection(AgentMode.MIRROR, "user explicitly invited reflection")
        return ModeSelection(AgentMode.COMPANION, "ordinary sharing or conversation")
