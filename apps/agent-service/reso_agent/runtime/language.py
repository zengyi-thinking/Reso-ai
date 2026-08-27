"""Deterministic content anchoring for public copy.

All user-visible thinking text is derived from what the runtime actually has
(message, memories) so the same phase never repeats the same canned line.
"""

from __future__ import annotations

import re

# Function characters that carry no topical weight on their own.
_FUNCTION_CHARS = set(
    "我你他她它的了是把被和跟也就都在吗吧呢啊呀啦嗯很不个这那还又再先才很挺蛮更最一只们"
)
_FUNCTION_CHAR_TEXT = "".join(_FUNCTION_CHARS)
# Connectors that split a run from the inside: "朋友跟说" -> "朋友", "说".
_CONNECTOR_SPLIT = re.compile(r"[跟和与或但也所以然后把被对]")
# Leading filler words stripped before per-character trimming in fragments.
_LEADING_FILLER_WORDS = (
    "最近",
    "今天",
    "昨天",
    "明天",
    "然后",
    "就是",
    "但是",
    "所以",
    "今天早上",
    "今天下午",
    "今天晚上",
)
# Bigrams that are grammatical filler even when both characters look contentful.
_FUNCTION_BIGRAMS = {
    "今天",
    "昨天",
    "明天",
    "最近",
    "有点",
    "感觉",
    "觉得",
    "时候",
    "什么",
    "怎么",
    "可以",
    "没有",
    "是不是",
    "一件事",
    "一下",
    "这样",
    "那样",
    "然后",
    "可能",
    "自己",
    "一个",
}


def _is_stop_bigram(bigram: str) -> bool:
    if bigram in _FUNCTION_BIGRAMS:
        return True
    return all(character in _FUNCTION_CHARS for character in bigram)


def content_runs(text: str, *, limit: int = 2, cap: int = 12) -> list[str]:
    """Content-bearing CJK/latin spans, used as topical anchors.

    Spans are cut at functional bigrams (both characters grammatical, or an
    explicit filler pair), trimmed at function-character edges, and split at
    internal connectors, e.g. "我养了一只猫叫团子" -> "猫叫团子".
    """
    normalized = re.sub(r"[\s，。！？；：、,.!?;:()（）\"'“”‘’…\-—~]+", "", text.lower())
    latin_runs = [run[:cap] for run in re.findall(r"[a-z0-9]{2,}", normalized)]
    cjk = "".join(re.findall(r"[\u3400-\u9fff]", normalized))
    runs: list[str] = []
    start = 0
    for index in range(len(cjk) - 1):
        if _is_stop_bigram(cjk[index : index + 2]):
            runs.append(cjk[start:index])
            start = index + 2
    runs.append(cjk[start:])
    candidates: list[str] = []
    for run in runs:
        trimmed = run.strip(_FUNCTION_CHAR_TEXT)
        if len(trimmed) < 2:
            continue
        pieces = [piece for piece in _CONNECTOR_SPLIT.split(trimmed) if piece]
        candidates.extend(piece[:cap] for piece in pieces)
    if not candidates:
        # Last resort: a single content character still anchors better than a
        # generic line ("猫" beats "想起了一件事").
        singles = [char for char in cjk if char not in _FUNCTION_CHARS]
        return (latin_runs + singles[:limit])[:limit]
    # Longest first, earliest occurrence breaks ties so the anchor stays stable.
    ranked = sorted(set(candidates), key=lambda run: (-len(run), candidates.index(run)))
    return (latin_runs + ranked)[:limit]


def quote_terms(text: str, *, limit: int = 2) -> str:
    """Render content anchors as 「…」 references, e.g. 「团子」「咖啡杯」."""
    terms = content_runs(text, limit=limit)
    return "".join(f"「{term}」" for term in terms)


def has_terms(text: str) -> bool:
    return bool(content_runs(text, limit=1))


def fragment_summary(message: str, *, cap: int = 56) -> str:
    """Distill a message into its densest clauses without restating it wholesale.

    Splits on punctuation, strips leading function-word prefixes, keeps the two
    most content-dense clauses in their original order. This is the
    deterministic fallback only; the model-written observation is primary.
    """
    clauses = re.split(r"[，。！？；、\n,.!?;:]+", message.strip())
    distilled: list[tuple[int, str]] = []
    for position, clause in enumerate(clauses):
        cleaned = clause.strip()
        changed = True
        while changed:
            changed = False
            for filler in _LEADING_FILLER_WORDS:
                if cleaned.startswith(filler) and len(cleaned) > len(filler):
                    cleaned = cleaned[len(filler) :].lstrip()
                    changed = True
            if cleaned and cleaned[0] in _FUNCTION_CHARS and len(cleaned) > 1:
                cleaned = cleaned[1:].lstrip()
                changed = True
        content = re.sub(r"\s+", "", cleaned)
        if len(content) >= 3:
            distilled.append((position, cleaned))
    densest = sorted(distilled, key=lambda item: -len(re.sub(r"\s+", "", item[1])))[:2]
    selected = "；".join(clause for _, clause in sorted(densest))
    return selected[:cap]
