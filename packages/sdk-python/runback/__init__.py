"""
Runback SDK for Python.

Capture, replay, and audit every AI agent decision. Built primarily for
LangGraph (Python is where real LangGraph usage is — see the design notes
in the monorepo's plan for why this exists as its own package rather than
a LangGraph.js wrapper in @runback/sdk). Also usable standalone
(Collector + redaction) from any other Python agent framework's own hooks.

Public API is re-exported here as each piece lands:
    from runback import Collector, create_redactor, RunbackCallbackHandler
"""

__version__ = "0.1.0"

from .redact import Redactor, RedactOptions, RedactionLogEntry, create_redactor  # noqa: E402
from .patterns import RedactionRule, RedactionTier, RULES, SENSITIVE_KEYS, apply_rule  # noqa: E402
from .collector import Collector, Actor, FlushResult, FinishResult  # noqa: E402

__all__ = [
    "__version__",
    "create_redactor",
    "Redactor",
    "RedactOptions",
    "RedactionLogEntry",
    "RedactionRule",
    "RedactionTier",
    "RULES",
    "SENSITIVE_KEYS",
    "apply_rule",
    "Collector",
    "Actor",
    "FlushResult",
    "FinishResult",
]

# langchain-core/langgraph are optional (see pyproject.toml's [langgraph]
# extra) — a caller who only wants Collector/redact standalone shouldn't
# need them installed just to `import runback`. RunbackCallbackHandler
# itself raises a clear ImportError with install instructions if accessed
# without the extra.
try:
    from .langgraph import RunbackCallbackHandler  # noqa: E402

    __all__.append("RunbackCallbackHandler")
except ImportError:
    pass
