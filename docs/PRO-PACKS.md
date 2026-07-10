# Pro packs

Licensed pattern/persona/lexicon packs, delivered from a private repository to
patina Pro users. They are not in the public repo, not in the npm tarball, and
not baked into any deploy artifact — the only copy a client ever holds is the
one installed into its own gitignored `custom/` directory.

## Why this design

patina's core assets are readable text by necessity (the skill surface is
prose an LLM must read), so binaries or obfuscation cannot protect them. What
works is not shipping them: pro packs live in a private repo and are served
per-request to holders of a valid license. The public repo keeps the engine
and the seed packs; the pro tier gets the calibrated, research-backed ones.

## Using it (Pro users)

```bash
export PATINA_LICENSE_KEY=<your patina Pro license key>   # same key as the hosted API
patina pack list                 # what's available, what's installed
patina pack install ko-structure # one pack
patina pack install --all        # everything your license covers
```

Or persist the key in `.patina.yaml`:

```yaml
license-key: <key>
# packs-url: https://patina.vibetip.help/api/packs   # override only for self-hosting
```

Installed packs land in `custom/` and are picked up automatically with the
same precedence the loaders already give user files:

| kind | destination | discovery |
|---|---|---|
| `pattern` | `custom/patterns/<id>.md` | merged with `patterns/`; same filename → custom wins |
| `persona` | `custom/personas/<lang>/<id>.md` | preferred over built-in personas |
| `lexicon` | `custom/lexicon/ai-<lang>.md` | preferred over `lexicon/`; refuses to overwrite an existing file without `--force` |

Every download is integrity-checked: the CLI recomputes the file's sha256 and
compares it against the server manifest before writing anything.

## Operating it (maintainer)

- Content lives in the private repo (`PATINA_PACKS_REPO`, default
  `devswha/patina-pro-packs`): pack files plus a `manifest.json` listing
  `{id, path, version, lang, kind, description, sha256}` per pack. The
  manifest's sha256 must match the file content exactly — the endpoint refuses
  to serve a mismatch, so publish file + manifest in the same commit.
- Pack ids are `[a-z0-9-]`, and pattern-pack ids must start with their `lang`
  (`ko-structure`), because the id doubles as the discoverable filename.
- The endpoint (`api/packs.js`) authenticates with the same Lemon Squeezy
  validate-only flow as the rewrite API (`Authorization: Bearer <license>`),
  meters downloads per license per UTC day, and caches upstream reads in KV.
  Env: see the "Pro pack delivery" block in `.env.example`.
- Fail-closed properties: no GitHub token → 503 (never a per-license verdict
  it can't honor); upstream failures are never cached; manifest entries that
  fail shape validation are dropped server-side.
