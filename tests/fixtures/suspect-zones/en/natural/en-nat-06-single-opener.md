---
fixture_id: en-nat-06-single-opener
language: en
class: natural
expected_hot: false
expected_metrics:
  predicted_hot: false
  hot_paragraphs: 0
why_designed_this_way: |
  Natural control for en-ai-07-discourse-candor (issue #391). Work-log register
  with dated, concrete specifics (staging snapshot recovery, a dying pricing
  experiment, demo scheduling) and exactly ONE rhetorical "let's be honest" —
  below the >=2 fake-candor document gate, so discourse tells must stay cold.
  Sentence lengths swing hard (a two-word sentence next to a thirty-word one)
  and vocabulary is non-repetitive, keeping burstiness/MATTR/lexicon cold. If
  the density gate ever weakens to a single opener, this fixture goes hot and
  the benchmark fails.
topic: sprint work log
---

The standup ran long again because the staging database fell over mid-demo. Kwon restored it from the Tuesday snapshot in about six minutes, faster than our documented recovery target and honestly faster than I expected given that snapshot lives in the slow storage tier. We lost the seed data for the pricing experiment though.

Let's be honest, that experiment was half-dead anyway — only forty-one sessions hit the variant in two weeks, and nobody had looked at the dashboard since the kickoff. I filed the ticket to wind it down and took the flag cleanup myself for Thursday.

Lunch drifted into whether the demo environment should move off staging entirely. No conclusion. Minho promised to write up the options before the next planning round, and I promised to stop scheduling demos on deploy days.
