# Pattern Catalog

Patina ships 184 pattern entries across four languages. The language-specific references below expand each pack with pattern numbers, names, watch words, fire conditions, source links, and examples.

| Language | Reference | Rewrite-capable patterns | Score/audit-only viral-hook patterns |
|----------|-----------|--------------------------|--------------------------------------|
| Korean | [PATTERNS-KO.md](PATTERNS-KO.md) | 37 | 9 |
| English | [PATTERNS-EN.md](PATTERNS-EN.md) | 37 | 9 |
| Chinese | [PATTERNS-ZH.md](PATTERNS-ZH.md) | 37 | 9 |
| Japanese | [PATTERNS-JA.md](PATTERNS-JA.md) | 37 | 9 |

## Notes

- Rewrite-capable patterns are applied by the rewrite modes (default rewrite, `--verify`, and the explicit skill-only `/patina --instruction-only --strict` multi-pass flow) and `--diff`, according to their pack metadata and runtime mode. Default `/patina` and ordinary `/patina --strict` return verified CLI output; the host-agent multi-pass flow is opt-in, not an inline fallback for CLI failure.
- Viral-hook patterns are score/audit-only SNS-marketing signals. They affect `--score` and `--audit`, but rewrite modes skip them because the rhetoric may be intentional.
- Pattern packs are auto-discovered from `patterns/{lang}-*.md`. To add a language or custom pack, follow [CONTRIBUTING.md](../CONTRIBUTING.md) and the frontmatter format used in the existing packs.

## Custom Patterns

The CLI loads built-in patterns from `patterns/{lang}-*.md` and user or licensed
Pro patterns from `custom/patterns/{lang}-*.md`. A custom file replaces a built-in
file with the same name. Follow the existing frontmatter format and include
fire conditions, exclusions, meaning-preservation notes, and before/after examples.
Keep a separate copy of custom files before reinstalling the CLI.

### Retired community packs

Community-pack support was retired from the source checkout on 2026-09-08.
The `patina pattern` command no longer installs, lists, or removes packs, and
the CLI no longer loads `custom/community-packs/`. Existing files there are
left untouched.

To keep an old pack, review its Markdown files and copy only the patterns you
want into `custom/patterns/`. Check filenames first: a same-name file overrides
a built-in pattern or replaces an existing custom file. The old `pack.yaml`
and `installed.json` files are not used by the custom-pattern loader.
The separate `patina pack` command for licensed Pro packs remains available.

## Supporting References

- [Scoring](../core/scoring.md) — category weights, AI-likeness score, fidelity, and MPS
- [Stylometry](../core/stylometry.md) — burstiness, MATTR, and AI-lexicon overlap
- [Examples](../examples/README.md) — standalone failure/success fixtures used by the pattern docs
