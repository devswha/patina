---
fixture_id: en-ai-07-discourse-candor
language: en
class: ai
expected_hot: true
expected_metrics:
  predicted_hot: true
  hot_paragraphs: 3
  signal_score_min: 1
  detectors:
    burstiness: false
    koDiagnostics: false
    mattr: false
    lexicon: false
    endingMonotony: false
    candor: true
    thematicBreak: false
why_designed_this_way: |
  Discourse-tell regression net for issue #391 (the corpus previously had zero
  fake-candor coverage). Blog-register AI prose with three manufactured-intimacy
  openers from FAKE_CANDOR_RULES ("Here's the thing", "Let's be honest", "I'll
  be honest with you") spread across all three paragraphs, clearing the >=2
  document density gate. Sentence lengths and vocabulary are deliberately varied
  so burstiness/MATTR/lexicon stay cold — per-paragraph candor attribution must
  be the ONLY signal that makes the paragraphs (and the document) hot.
  hot_paragraphs pins the attribution itself: a document-level OR could keep
  predicted_hot true with zero hot paragraphs, but then hot_paragraphs drops
  from 3 to 0 and the benchmark fails. signal_score_min guards the ranking leg:
  a candor-hot paragraph must never carry zero signal strength.
topic: writing shorter changelogs
---

Here's the thing: nobody actually reads a five-hundred-word changelog. I learned this after our last release, when three users asked about a feature we had documented twice. People skim, they search, and they leave. A changelog that respects that behavior gets shorter with every release, not longer.

Let's be honest: the first version of ours was written for the team, not for users. It listed internal ticket numbers, referenced branches nobody outside the repo could see, and buried the one breaking change under twelve bullet points of refactoring notes. We rewrote it. Plain sentences, the breaking change at the top, and the upgrade questions dropped within a month.

I'll be honest with you: keeping it short is harder than it sounds. Every engineer wants their fix mentioned, and every fix feels urgent the week it ships, so the list creeps back toward twelve bullets unless somebody owns the pruning. The rule that saved us was simple. If a reader cannot act on the line, the line goes.
