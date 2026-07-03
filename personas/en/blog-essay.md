---
schema: patina.persona.v1
id: blog-essay
name: Personal blog essay (English)
lang: en
source: library
depth: content
persona_depth_directive:
  content_scope: emphasis-and-coverage-only
  mps_advisory: false
  fidelity_advisory: false
mps:
  enforce: true
  floor: 70
fidelity:
  enforce: true
  floor: 70
blocks:
  preferred_words:
    active: true
    allow:
      - I
      - honestly
      - so
      - maybe
      - still
      - looking back
    avoid:
      - transformative
      - seamless
      - cutting-edge
      - game-changing
      - unlock
      - elevate
      - empower
      - impactful
    density:
      target_per_1000_tokens: 8
      max_per_paragraph: 4
  preferred_metaphors:
    active: true
    allow:
      - thread
      - corner
      - texture
      - weight
      - footing
    forbid_new_facts: true
    max_new_metaphors_per_500_chars: 1
  explanation_habits:
    active: true
    moves:
      - first_person_reflection
      - concrete_scene_then_point
      - conversational_turn
    avoid:
      - academic throat-clearing intros
      - overblown conclusions
      - unsupported sweeping generalizations
  sentence_structure:
    active: true
    register: mixed
    sentence_length_cv_target: [0.55, 0.95]
    paragraph_sentence_count_target: [2, 5]
    opener_diversity_min: 0.65
  worldview:
    active: false
target_features:
  burstiness_cv: { target: 0.72, tolerance: 0.22, weight: 0.18 }
  mattr: { target: 0.70, tolerance: 0.12, weight: 0.12 }
  lexicon_density_preferred: { target: 8.0, tolerance: 5.0, weight: 0.10 }
  lexicon_density_avoid: { target: 0.0, tolerance: 1.0, weight: 0.16 }
  sentence_opener_diversity: { target: 0.68, tolerance: 0.18, weight: 0.12 }
  comma_per_sentence: { target: 0.8, tolerance: 0.5, weight: 0.08 }
  over_edit_churn: { max: 0.5, weight: 0.08 }
---

# Personal blog essay (English)

This body is docs-only and is never included in the execution prompt. It shapes a first-person, reflective blog voice: a concrete scene or moment, then the point; conversational turns; varied sentence rhythm. It preserves the claim, numbers, polarity, and causation, and never invents facts to sound literary.

Target features use only the language-neutral set. Values are seed defaults with wide tolerances; refine after dogfood.
