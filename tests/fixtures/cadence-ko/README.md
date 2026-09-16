# 문두 접속사 candidate fixture (KO)

`ko-conjunction-50.jsonl` is the 50-document evaluation manifest
`process/pattern-freshness.md` requires before the 문두 접속사 gap named in #880
can become a shipped rule.

- **25 hot** documents where connective openers are genuine 남발.
- **25 cold** controls, of which **17 are hard negatives**: 상담/고객지원 공감
  문장, 쉼표가 많은 긴 복문, human writing that uses one connective legitimately,
  and — most importantly — five **boundary** documents that open three of three
  sentences with connectives while carrying real anchors (contract terms, incident
  causes, refund windows, costs).
- **Two registers**: 업무 문서 and 블로그.

Those five boundary documents exist because the first version of this fixture
scored the candidate at precision 1.00, which was a property of the fixture, not
the rule: every hot document had been written in the rule's own shape. Probing
the boundary with legitimate conjunction-heavy Korean made all five fire, so they
were folded in and the honest number dropped to 0.83.

## Provenance and licensing

Every document is **synthetic**, authored for this repository as part of #880.
No scraped Korean text, no private drafts, no real personal data, so the manifest
is redistributable with the repo.

## Scoring

```bash
npm run benchmark:ko-conjunction           # human-readable
npm run benchmark:ko-conjunction -- --json # machine-readable
```

`scripts/ko-conjunction-candidate-eval.mjs` is measurement only. The candidate
rule lives inside that script as a pure function and is **not wired** into
`src/features`, any pattern pack, or any rewrite path.
