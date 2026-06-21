"""insane-search engine — generic WAF-profile-based fetch chain.

No site-specific logic lives here. Site specifics belong to runtime hints or
observations, never to code. See `../SKILL.md` for the No-Site-Name Rule.
"""

from .validators import Verdict, ValidationResult, validate, CHALLENGE_MARKERS
from .waf_detector import detect
from .url_transforms import TRANSFORMS, apply_transform
from .fetch_chain import fetch, FetchResult, Attempt

__all__ = [
    "Verdict",
    "ValidationResult",
    "validate",
    "CHALLENGE_MARKERS",
    "detect",
    "TRANSFORMS",
    "apply_transform",
    "fetch",
    "FetchResult",
    "Attempt",
]
