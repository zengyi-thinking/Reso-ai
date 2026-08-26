from reso_agent.policy.disclosure import DisclosurePolicy, PolicyDecision


def test_proxy_requires_explicit_consent() -> None:
    result = DisclosurePolicy().decide(proxy_requested=True, active_consent=False)
    assert result.decision is PolicyDecision.ASK_USER
