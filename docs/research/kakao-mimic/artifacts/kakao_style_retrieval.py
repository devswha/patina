"""Compatibility shim — canonical module: dgmh_runtime.memory.kakao_style (ADR-015 amendment)."""

import sys

from dgmh_runtime.memory import kakao_style as _canonical

sys.modules[__name__] = _canonical
