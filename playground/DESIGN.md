---
version: alpha
name: patina-chat-design
extends: ../DESIGN.md (brand source of truth)
base: lovable.dev (getdesign.md) + patina brand accents
description: >
  Design tokens for the full-page patina chat, reskinned in Lovable's warm-light
  language: a faintly-warm near-white canvas, a signature aurora gradient behind
  the empty-state hero, charcoal text on a charcoal-opacity gray scale, hairline
  borders (not shadows) for containment, full-pill action buttons with an inset
  shadow, and humanist display type. patina's brand stays as the functional
  accent system: teal = humanized output, copper = the AI "before", amber/gold =
  preserved meaning.

colors:
  # Surfaces (Lovable warm-light)
  bg: "#faf9f6"            # page (near-white, faintly warm)
  bg-cream: "#f7f4ed"      # warm cream surface
  bg-side: "#f4f1e9"       # sidebar
  bg-elev: "#ffffff"       # composer / cards
  border: "#eceae4"        # passive hairline
  border-strong: "rgba(28,28,28,0.22)"  # interactive border

  # Text (charcoal opacity scale)
  text: "#1c1c1c"
  text-dim: "#5f5f5d"
  text-faint: "rgba(28,28,28,0.42)"

  # Patina accents (deepened for contrast on light)
  accent: "#0d9488"        # patina teal — avatar, send, focus, links, after
  accent-press: "#0f766e"
  on-accent: "#ffffff"
  copper: "#b45c25"        # AI "packaging" / the "before"
  gold: "#a16207"          # preserved-meaning (deep amber)

  # Lovable signature primary (used for high-emphasis dark CTAs if needed)
  dark: "#1c1c1c"
  on-dark: "#fcfbf8"

typography:
  sans: '"Camera Plain Variable", ui-rounded, Inter, ui-sans-serif, -apple-system, "Segoe UI", "Noto Sans KR", sans-serif'
  mono: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
  weights: "400 body/UI, 600 headings (Lovable caps at 600)"
  notes: >
    Camera Plain Variable is Lovable's font and is NOT bundled — the stack falls
    back to ui-rounded/Inter/system. Headings run tight (letter-spacing -1.2px at
    44px). Numeric data (badges/signals) uses mono.

depth:
  philosophy: "Shallow. Hairline #eceae4 borders contain; one soft focus shadow."
  inset: "rgba(255,255,255,0.2) 0 0.5px 0 0 inset, rgba(0,0,0,0.18) 0 0 0 0.5px inset, rgba(0,0,0,0.05) 0 1px 2px 0"
  focus: "rgba(0,0,0,0.1) 0 4px 12px"

rounded:
  sm: 8px        # controls
  card: 12px     # chips / cards
  bubble: 18px   # message bubbles
  composer: 26px # big Lovable composer card
  pill: 9999px   # buttons, badges, send

aurora:
  use: "Behind the empty-state hero only (the landing moment); reading surfaces stay cream."
  value: >
    radial-gradient(60% 55% at 50% -8%, rgba(120,160,255,.40), transparent 70%),
    radial-gradient(48% 42% at 16% 48%, rgba(196,150,255,.34), transparent 70%),
    radial-gradient(52% 46% at 86% 60%, rgba(255,150,205,.34), transparent 72%),
    radial-gradient(62% 52% at 50% 116%, rgba(255,180,120,.40), transparent 70%)

components:
  app-canvas:  { backgroundColor: "{colors.bg}", textColor: "{colors.text}" }
  sidebar:     { backgroundColor: "{colors.bg-side}", borderColor: "{colors.border}" }
  newchat:     { backgroundColor: "{colors.bg-elev}", radius: pill, shadow: inset }
  empty-hero:  { background: aurora, logo: "{colors.accent}", title: "44px / 600 / -1.2px" }
  msg-user:    { backgroundColor: "{colors.bg-cream}", borderLeft: "2px {colors.copper}" } # AI "before"
  msg-patina:  { avatar: "{colors.accent}", textColor: "{colors.text}" }                   # the "after"
  badge:       { backgroundColor: "{colors.bg-cream}", font: mono, valueColor: "{colors.gold}" } # preserved meaning
  signal:      { before: "{colors.copper}", after: "{colors.accent}" }                      # copper → teal arc
  composer:    { backgroundColor: "{colors.bg-elev}", radius: composer, borderColor: "{colors.border}", focus: focus-shadow }
  send-button: { backgroundColor: "{colors.accent}", textColor: "{colors.on-accent}", radius: pill, shadow: inset }
---

## Overview

The chat adopts Lovable's warm-light language — a faintly-warm near-white page
(`#faf9f6`), charcoal text (`#1c1c1c`) on a charcoal-opacity gray scale, hairline
`#eceae4` borders instead of drop shadows, full-pill action buttons with the
signature multi-layer inset shadow, and the signature aurora gradient (blue →
purple → pink → orange) behind the empty-state hero. Brand strategy lives in the
root [`DESIGN.md`](../DESIGN.md); this file is the chat implementation token set.

patina's brand survives as the **functional accent system**, in light-readable
shades, so each rewrite still replays the icon's copper → teal → gold story:

- **teal `#0d9488`** — humanized output. Single dominant accent: avatar/logo,
  send button, focus, links, the **after** AI-signal count.
- **copper `#b45c25`** — the AI "packaging". Left edge of the **user** message
  (the pasted, AI-sounding input) and the **before** AI-signal count.
- **amber/gold `#a16207`** — preserved meaning. The **MPS / fidelity** numbers, in mono.

**Key characteristics**

- Warm near-white canvas; aurora only behind the empty hero, never behind reading.
- Hairline borders contain; depth is shallow (one soft focus shadow, inset on buttons).
- Full-pill buttons/badges; big rounded composer card; humanist headings run tight.
- Two weights (400 / 600); patina teal/copper/gold carry meaning, not decoration.

## Applied in

- `playground/chatgpt.css` — tokens in `:root`; aurora on `.empty`; semantic rules
  on `.msg--user` (copper edge), `.msg--patina`/`.composer__send`/avatars (teal),
  `.badge b` (gold mono), `.signal-bar .sig-before|.sig-after` (copper→teal).
- `playground/chatgpt.js` — emits `.sig-before` / `.sig-after` spans.

> Note: a dark patina×voltagent variant is preserved in git history (commit
> `style(playground): dark patina×voltagent chat theme (checkpoint)`).
