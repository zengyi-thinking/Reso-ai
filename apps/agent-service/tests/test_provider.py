from uuid import uuid4

import pytest

from reso_agent.contracts import AgentMode, RecentMessage
from reso_agent.models.provider import (
    MiniMaxModelProvider,
    ModelProviderError,
    ModelRequest,
    ProviderConfig,
)


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


def test_minimax_maps_domain_agent_role_to_provider_assistant() -> None:
    provider = MiniMaxModelProvider(
        ProviderConfig(
            provider="minimax",
            model="MiniMax-M3",
            api_key="test-only",
            base_url="https://api.minimax.io/v1",
        )
    )
    request = ModelRequest(
        mode=AgentMode.COMPANION,
        system_prompt="test",
        user_message="第二轮",
        recent_messages=(
            RecentMessage(id=uuid4(), role="user", content="第一轮"),
            RecentMessage(id=uuid4(), role="agent", content="第一轮回复"),
        ),
        memory_summaries=(),
        is_correction=False,
        no_analysis=False,
    )

    assert provider._messages(request) == [
        {"role": "user", "content": "第一轮"},
        {"role": "assistant", "content": "第一轮回复"},
        {"role": "user", "content": "第二轮"},
    ]
