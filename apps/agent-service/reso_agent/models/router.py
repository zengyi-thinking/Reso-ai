from reso_agent.models.provider import (
    DeterministicModelProvider,
    ModelProvider,
    create_real_provider_from_env,
)


def model_provider_for(route: str) -> ModelProvider:
    if route == "deterministic":
        return DeterministicModelProvider()
    if route == "real":
        return create_real_provider_from_env()
    raise ValueError(f"Unsupported internal model route: {route}")
