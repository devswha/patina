"""Compatibility shim — canonical module: dgmh_runtime.engine.patina_judge (ADR-015 amendment)."""

import sys

from dgmh_runtime.engine import patina_judge as _canonical

sys.modules[__name__] = _canonical
