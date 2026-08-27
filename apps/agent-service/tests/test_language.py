from reso_agent.runtime.language import content_runs, fragment_summary, quote_terms


def test_content_runs_anchor_names_and_objects() -> None:
    runs = content_runs("我养了一只猫叫团子，今天它把我的咖啡杯碰倒了。")
    assert "猫叫团子" in runs
    assert any("咖啡杯" in run for run in runs)


def test_content_runs_falls_back_to_single_characters() -> None:
    # Everything functional except one content character still anchors.
    assert content_runs("猫呢？") == ["猫"]


def test_content_runs_returns_empty_when_all_functional() -> None:
    # Fully grammatical messages anchor nothing; callers use variant copy.
    assert content_runs("你在吗？") == []


def test_quote_terms_renders_brackets() -> None:
    quoted = quote_terms("我养了一只猫叫团子", limit=1)
    assert quoted.startswith("「")
    assert quoted.endswith("」")


def test_fragment_summary_keeps_original_clause_order() -> None:
    summary = fragment_summary("今天它把我的咖啡杯碰倒了，我养了一只猫叫团子。")
    assert "猫叫团子" in summary
    assert "咖啡杯" in summary
    # Original message order is preserved instead of ranking by density alone.
    assert summary.index("咖啡杯") < summary.index("猫叫团子")
    assert not summary.startswith("今天")


def test_fragment_summary_strips_correction_fillers() -> None:
    assert "无意义社交" in fragment_summary("不是，我只是讨厌无意义社交。")
