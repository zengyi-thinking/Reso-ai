from __future__ import annotations

# A reconsidered final stance must visibly keep facts and interpretation apart.
# Deterministic marker check: uncertainty or distinction language, not private CoT.
_SEPARATION_MARKERS = (
    "不是一回事",
    "两回事",
    "不等于",
    "并不一定",
    "未必",
    "只是",
    "先别",
    "可能",
    "也许",
    "会不会",
    "不确定",
    "像",
    "其中一种",
    "看起来",
    "观察到",
    "你说",
    "你提到",
    "描述像你吗",
)


def separates_fact_from_interpretation(text: str) -> bool:
    return any(marker in text for marker in _SEPARATION_MARKERS)
