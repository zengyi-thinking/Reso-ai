from dataclasses import dataclass
from enum import StrEnum


class PolicyDecision(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    ASK_USER = "ASK_USER"


@dataclass(frozen=True)
class DisclosureResult:
    decision: PolicyDecision
    reason_code: str


class DisclosurePolicy:
    """Fail closed: Proxy requires an explicit, active grant for the requested scope."""

    def decide(self, *, proxy_requested: bool, active_consent: bool) -> DisclosureResult:
        if not proxy_requested:
            return DisclosureResult(PolicyDecision.ALLOW, "non-proxy-action")
        if not active_consent:
            return DisclosureResult(PolicyDecision.ASK_USER, "explicit-consent-required")
        return DisclosureResult(PolicyDecision.ALLOW, "active-consent")
