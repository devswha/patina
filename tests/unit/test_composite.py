import contextlib
import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COMPOSITE_PATH = ROOT / "patina-max" / "composite.py"
SPEC = importlib.util.spec_from_file_location("patina_max_composite", COMPOSITE_PATH)
composite = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = composite
SPEC.loader.exec_module(composite)


class CompositeTest(unittest.TestCase):
    def test_parse_metric_handles_ranges_notes_and_placeholders(self):
        self.assertEqual(composite.parse_metric("0-2 (within noise floor)"), 1.0)
        self.assertEqual(composite.parse_metric("92 (all anchors preserved)"), 92.0)
        self.assertEqual(composite.parse_metric("  '73.5'  "), 73.5)
        self.assertIsNone(composite.parse_metric("pending"))
        self.assertIsNone(composite.parse_metric("—"))
        self.assertIsNone(composite.parse_metric(None))

    def test_normalise_weights_scales_positive_weights(self):
        weights = composite.normalise_weights({"ai": 2.0, "mps": 1.0, "rss": 1.0})

        self.assertAlmostEqual(sum(weights.values()), 1.0)
        self.assertAlmostEqual(weights["ai"], 0.5)
        self.assertAlmostEqual(weights["mps"], 0.25)
        self.assertAlmostEqual(weights["rss"], 0.25)

    def test_normalise_weights_rejects_zero_sum(self):
        with self.assertRaisesRegex(ValueError, "positive"):
            composite.normalise_weights({"ai": 0.0, "mps": 0.0})

    def test_main_selects_highest_composite_winner(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            (run_dir / "input.md").write_text("제품은 안정적입니다. 팀은 빠르게 대응합니다.\n", encoding="utf-8")
            (run_dir / "claude.md").write_text("제품은 안정적입니다. 팀은 빠르게 대응합니다.\n", encoding="utf-8")
            (run_dir / "gemini.md").write_text("제품은 안정적이에요. 팀은 빠르게 대응해요.\n", encoding="utf-8")
            (run_dir / "codex.md").write_text("failed\n", encoding="utf-8")
            (run_dir / "meta.md").write_text(
                """candidates:
  - model: claude
    status: success
    ai_score: 20
    mps: 92
  - model: gemini
    status: success
    ai_score: 45
    mps: 72
  - model: codex
    status: failed
    ai_score: n/a
    mps: n/a
""",
                encoding="utf-8",
            )

            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = composite.main([str(run_dir), "--config", str(run_dir / "missing.yaml")])

            self.assertEqual(exit_code, 0)
            winner = (run_dir / "winner.md").read_text(encoding="utf-8")
            report = (run_dir / "composite.md").read_text(encoding="utf-8")
            self.assertIn("winner_model: claude", winner)
            self.assertIn("**Winner:** `claude`", report)
            self.assertIn("| codex | failed |", report)


if __name__ == "__main__":
    unittest.main()
