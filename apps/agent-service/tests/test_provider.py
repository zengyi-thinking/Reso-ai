import pytest

from reso_agent.models.provider import ModelProviderError, ProviderConfig


def test_real_provider_config_fails_explicitly_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    for name in (
        "LLM_PROVIDER",
        "LLM_API_KEY",
        "MINIMAX_API_KEY",
        "MiniMax_AUTH_TOKEN",
        "LLM_MODEL",
        "MINIMAX_MODEL",
        "MiniMax_DEFAULT_HAIKU_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "minimax")

    with pytest.raises(ModelProviderError, match="missing"):
        ProviderConfig.from_env()
