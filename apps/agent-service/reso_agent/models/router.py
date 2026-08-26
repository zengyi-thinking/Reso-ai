from __future__ import annotations

import os

from reso_agent.models.provider import (
    DeterministicModelProvider,
    ModelProvider,
    ModelProviderError,
    create_real_provider_from_env,
)


def model_route_from_env() -> str:
    """Production defaults to the real MiniMax provider; tests may opt out explicitly."""
    route = os.getenv("RESO_MODEL_ROUTE", "real").strip().lower()
    if route not in {"real", "deterministic"}:
        raise ModelProviderError(
            f"RESO_MODEL_ROUTE must be 'real' or 'deterministic', got: {route}"
        )
    return route


def model_provider_for(route: str) -> ModelProvider:
    if route == "deterministic":
        return DeterministicModelProvider()
    if route == "real":
        return create_real_provider_from_env()
    raise ValueError(f"Unsupported internal model route: {route}")
