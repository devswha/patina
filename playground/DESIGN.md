---
version: alpha
name: patina-chat-design
extends: ../DESIGN.md (brand source of truth)
base: voltagent (getdesign.md) + patina brand icon
description: >
  Design tokens for the full-page, ChatGPT-style patina chat. VoltAgent's restraint —
  one near-black canvas, a single dominant accent, hairline chrome, no gradients,
  Inter + SF Mono — reskinned with patina's brand palette pulled straight from the
  app icon (assets/brand/patina-icon.svg). The icon's copper → teal → gold arc is
  reused as a semantic system: copper = the AI "before", teal = the humanized
  "after", gold = preserved meaning.

colors:
  # Surfaces (patina icon canvas; VoltAgent single-dark-surface discipline)
  canvas: "#020617"        # page background (patina icon bg, navy-black)
  canvas-soft: "#0a1120"   # sidebar
  canvas-elev: "#111a2b"   # cards / composer / bubbles
  canvas-elev-2: "#1b2740" # hover
  hairline: "#1e293b"      # 1px borders (patina logo border); no shadows

  # Text
  ink-strong: "#f8fafc"    # patina wordmark
  ink: "#e8eef7"
  body: "#94a3b8"          # patina tagline slate
  mute: "#5f6b80"

  # Accent — single dominant accent (VoltAgent role), in patina teal
  primary: "#2dd4bf"       # patina icon teal — avatar, send, focus, links, pass state
  primary-soft: "#5eead4"  # hover / streaming cursor
  primary-deep: "#14b8a6"  # press
  on-primary: "#04181a"    # text on a teal fill

  # Brand semantics (patina icon story — used sparingly per VoltAgent restraint)
  copper: "#c46a2a"        # AI "packaging" / the "before" (user input edge, signal before)
  gold: "#ffe6a8"          # preserved-meaning core (MPS / fidelity numbers)
  emerald: "#34d399"       # logo underline / success

typography:
  sans: Inter, ui-sans-serif, -apple-system, "Segoe UI", "Noto Sans KR", Roboto, sans-serif
  mono: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace  # metrics, signals, code
  notes: >
    Numeric/diagnostic data (MPS/fidelity badges, AI-signal counts) renders in mono
    for the engineered VoltAgent feel. Body and UI use Inter/system sans.

rounded:
  sm: 8px        # cards, foldouts, controls
  bubble: 20px   # message bubbles
  composer: 24px # ChatGPT-style composer pill (kept as product identity)
  pill: 9999px   # status badges only

components:
  app-canvas:    { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}" }
  sidebar:       { backgroundColor: "{colors.canvas-soft}", borderColor: "{colors.hairline}" }
  brand-mark:    { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}" }       # the "p"
  msg-user:      { backgroundColor: "{colors.canvas-elev}", borderColor: "{colors.copper} @24%" } # the AI "before"
  msg-patina:    { avatar: "{colors.primary}", textColor: "{colors.ink}" }                        # the "after"
  badge:         { font: "{typography.mono}", valueColor: "{colors.gold}", border: "{colors.hairline}" } # preserved meaning
  badge-pass:    { borderColor: "{colors.primary} @33%" }
  badge-warn:    { borderColor: "#f59e0b55", valueColor: "#fbbf24" }
  signal-before: { color: "{colors.copper}" }   # AI signal before
  signal-after:  { color: "{colors.primary}" }  # AI signal after (copper → teal arc)
  composer:      { backgroundColor: "{colors.canvas-elev}", borderColor: "{colors.hairline}", focus: "{colors.primary} @40%" }
  send-button:   { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}" }
---

## Overview

patina's chat takes VoltAgent's engineered restraint — one continuous near-black
surface, a single reserved accent, 1px hairline chrome with no shadows or
gradients, Inter for prose and SF Mono for numbers — and swaps VoltAgent's
electric green for patina's own brand palette, read directly off the app icon
(`assets/brand/patina-icon.svg`). Brand strategy lives in the root
[`DESIGN.md`](../DESIGN.md); this file is the implementation token set for the
chat surface.

The icon tells patina's story in three colors, and the UI reuses them as meaning,
not decoration:

- **copper `#c46a2a`** — the AI "packaging" the tool strips. It edges the **user**
  message (the pasted, AI-sounding input) and the **before** AI-signal count.
- **teal `#2dd4bf`** — the humanized result. The single dominant accent: the
  patina avatar/logo, the send button, focus rings, links, and the **after**
  AI-signal count.
- **gold `#ffe6a8`** — the preserved-meaning core. It renders the **MPS / fidelity**
  numbers (the meaning-preservation metrics) in mono.

So every rewrite visually replays the icon: a copper-edged input flows into a
teal response, scored by a gold preservation number — copper → teal → gold.

**Key characteristics**

- Near-black navy canvas `#020617` is the only surface; no light mode.
- One dominant accent (teal). Copper and gold are reserved for the specific
  semantic roles above — never generic decoration.
- Hairline borders (`#1e293b`, 1px), minimal shadows; ChatGPT layout retained
  (sidebar + centered 768px column + bottom composer pill).
- Inter for UI/prose, SF Mono for all numeric/diagnostic data.

## Applied in

- `playground/chatgpt.css` — tokens live in `:root`; semantic rules on
  `.msg--user` (copper), `.msg--patina` / `.composer__send` / avatars (teal),
  `.badge b` (gold mono), `.signal-bar .sig-before|.sig-after` (copper→teal).
- `playground/chatgpt.js` — emits `.sig-before` / `.sig-after` spans so the
  copper→teal arc renders on the AI-signal row.
