# Pattern Catalog

Patina ships 172 pattern entries across four languages. The language-specific references below expand each pack with pattern numbers, names, watch words, fire conditions, source links, and examples.

| Language | Reference | Rewrite-capable patterns | Score/audit-only viral-hook patterns |
|----------|-----------|--------------------------|--------------------------------------|
| Korean | [PATTERNS-KO.md](PATTERNS-KO.md) | 34 | 9 |
| English | [PATTERNS-EN.md](PATTERNS-EN.md) | 34 | 9 |
| Chinese | [PATTERNS-ZH.md](PATTERNS-ZH.md) | 34 | 9 |
| Japanese | [PATTERNS-JA.md](PATTERNS-JA.md) | 34 | 9 |

## Notes

- Rewrite-capable patterns are applied by the rewrite modes (default rewrite, `--verify`, and the skill's `--ouroboros` loop) and `--diff`, according to their pack metadata and runtime mode.
- Viral-hook patterns are score/audit-only SNS-marketing signals. They affect `--score` and `--audit`, but rewrite modes skip them because the rhetoric may be intentional.
- Pattern packs are auto-discovered from `patterns/{lang}-*.md`. To add a language or custom pack, follow [CONTRIBUTING.md](../CONTRIBUTING.md) and the frontmatter format used in the existing packs.

## Supporting References

- [Scoring](../core/scoring.md) — category weights, AI-likeness score, fidelity, and MPS
- [Stylometry](../core/stylometry.md) — burstiness, MATTR, and AI-lexicon overlap
- [Examples](../examples/README.md) — standalone failure/success fixtures used by the pattern docs
