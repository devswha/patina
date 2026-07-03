---
version: beta
name: patina-chat-design
extends: ../DESIGN.md (brand source of truth)
base: editorial dark (patina brand accents on a near-black canvas)
description: >
  Design tokens for the full-page patina playground (landing + chat), in the
  editorial-dark language actually shipped in chatgpt.css: a neutral near-black
  canvas, white type on a gray opacity scale, hairline borders for containment,
  a single restrained teal accent (no rainbow/aurora slop), full-pill action
  buttons with an inset shadow, and humanist display type. patina's brand stays
  as the functional accent system: teal = humanized output, copper = the AI
  "before", gold = preserved meaning.

colors:
  # Surfaces — neutral near-black
  bg: "#0a0a0b"            # page canvas
  bg-cream: "#1b1b1f"      # elevated surface (cards / badges / bar+foot)
  bg-side: "#0e0e10"       # sidebar
  bg-elev: "#141417"       # composer / prompt / editor panel
  bg-hover: "rgba(255,255,255,0.05)"
  bg-hover-2: "rgba(255,255,255,0.08)"

  # Text — white on near-black
  text: "#fafafa"
  text-dim: "#a1a1aa"
  text-faint: "#7c7c84"

  # Borders — neutral hairlines
  border: "#27272a"
  border-strong: "#3f3f46"

  # Patina semantic accents
  accent: "#2dd4bf"        # patina teal — the single primary accent
  accent-soft: "#5eead4"
  accent-press: "#14b8a6"
  on-accent: "#04181a"     # dark text on a teal fill
  copper: "#d9772f"        # AI "packaging" / the "before"
  gold: "#ffe6a8"          # preserved-meaning core (MPS/fidelity values)

  # High-emphasis pill (nav GitHub button): white on near-black
  dark: "#fafafa"
  on-dark: "#0a0a0b"

typography:
  sans: '"Pretendard Variable", Pretendard, Inter, ui-sans-serif, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans SC", "Noto Sans JP", Roboto, Helvetica, Arial, sans-serif'
  mono: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
  weights: "400 body/UI, 600 headings"
  notes: >
    Pretendard Variable is loaded from jsDelivr (the only external origin the
    page touches). Headings run tight (letter-spacing -1.6px at the hero clamp,
    -1.2px at section titles). Numeric data (badges/signals) uses mono.

depth:
  philosophy: "Shallow. Hairline #27272a borders contain; one soft focus shadow; inset on pills."
  inset: "rgba(255,255,255,0.08) 0 0.5px 0 0 inset, rgba(0,0,0,0.35) 0 0 0 0.5px inset, rgba(0,0,0,0.25) 0 1px 2px 0"
  focus: "rgba(0,0,0,0.55) 0 4px 16px"

rounded:
  sm: 8px        # controls
  card: 16px     # editor panel / bench cards
  bubble: 18px   # message bubbles
  composer: 26px # composer card (prompt card is 28px)
  pill: 9999px   # buttons, badges, send

glow:
  use: "Behind the hero only; reading surfaces stay flat near-black."
  value: >
    radial-gradient(60% 48% at 50% -10%, rgba(45,212,191,0.07), transparent 72%),
    radial-gradient(90% 60% at 50% 122%, rgba(255,255,255,0.02), transparent 70%)
  notes: "Single-accent teal glow + a fine dot-grid texture masked toward the title. Deliberately not a multi-color aurora."

accessibility:
  focus-ring: "outline: 2px solid {colors.accent}; outline-offset: 2px on :focus-visible for every interactive control."
  live-regions: "#thread is role=log aria-live=polite; error notes are role=alert; aria-busy toggles during streaming."
  mobile-sidebar: "closed off-canvas sidebar gets visibility:hidden so it leaves the tab order and a11y tree."
  mobile-nav: "≤900px the nav links wrap onto a full-width scrollable row instead of being hidden."

components:
  app-canvas:  { backgroundColor: "{colors.bg}", textColor: "{colors.text}" }
  sidebar:     { backgroundColor: "{colors.bg-side}", borderColor: "{colors.border}" }
  newchat:     { backgroundColor: "{colors.bg-elev}", radius: pill, shadow: inset }
  hero:        { background: glow, accentWord: "{colors.accent}", title: "clamp(40px,6.4vw,64px) / 600 / -1.6px" }
  msg-user:    { backgroundColor: "{colors.bg-cream}", borderColor: "{colors.border}" }
  msg-patina:  { avatar: "{colors.bg-cream}", textColor: "{colors.text}" }
  badge:       { backgroundColor: "{colors.bg-cream}", font: mono, valueColor: "{colors.gold}" }
  signal:      { before: "{colors.copper}", after: "{colors.accent}" }
  composer:    { backgroundColor: "{colors.bg-elev}", radius: composer, borderColor: "{colors.border}", focus: focus-shadow }
  send-button: { backgroundColor: "{colors.accent}", textColor: "{colors.on-accent}", radius: pill, shadow: inset, stopState: "is-stop swaps to {colors.bg-cream} with a square stop glyph" }
  editor:      { backgroundColor: "{colors.bg-elev}", chrome: "{colors.bg-cream}", tabs: "teal is-active tint", diff: "copper removals / teal additions" }
---

## Overview

The playground ships an **editorial dark** theme — a neutral near-black canvas
(`#0a0a0b`), white type (`#fafafa`) on a gray opacity scale, hairline `#27272a`
borders instead of drop shadows, full-pill action buttons with a multi-layer
inset shadow, and a single restrained teal glow behind the hero. Brand strategy
lives in the root [`DESIGN.md`](../DESIGN.md); this file is the playground
implementation token set and mirrors `playground/chatgpt.css` exactly.

patina's brand is the **functional accent system**, so each rewrite replays the
icon's copper → teal → gold story:

- **teal `#2dd4bf`** — humanized output. The single dominant accent: hero grad
  word, send button, focus rings, links, tabs, the **after** AI-signal count.
- **copper `#d9772f`** — the AI "packaging". The **before** diff removals and
  the **before** AI-signal count.
- **gold `#ffe6a8`** — preserved meaning. The **MPS / fidelity** numbers, in mono.

**Key characteristics**

- Near-black canvas; a single-accent teal glow + dot grid behind the hero only.
- Hairline borders contain; depth is shallow (one soft focus shadow, inset pills).
- Full-pill buttons/badges; big rounded composer card; humanist headings run tight.
- Two weights (400 / 600); teal/copper/gold carry meaning, not decoration.
- Keyboard-first: every interactive control has a visible `:focus-visible` ring;
  streamed output and errors are announced via live regions.

## Applied in

- `playground/chatgpt.css` — tokens in `:root`; glow on `.hero__sky`; semantic
  rules on the editor diff (`.dtok--rm` copper / `.dtok--add` teal), `.badge b`
  (gold mono), `.signal-bar .sig-before|.sig-after` (copper→teal); the shared
  `:focus-visible` ring block; mobile rules (nav link row ≤900px, off-canvas
  sidebar visibility ≤820px).
- `playground/chatgpt.js` — emits `.sig-before` / `.sig-after` spans and builds
  all localized copy via DOM nodes (`textContent` + `createElement`; no
  innerHTML for localized strings).
- Landing (VDL-inspired editorial layer, from vibedesignlab.net): Pretendard
  Variable as primary `--font`; `.sec__head` left-aligned with a chip-on-hairline
  `.eyebrow` device (`<span>` chip + `::after` rule); larger clamped `.hero__title`
  / `.sec__title` scale. Accent stays patina teal — VDL's single-hot-accent
  principle, not its red.

## Analytics

`playground/analytics.js` is an **intentional no-op queue shim** for
`window.va` (`vercel.json` rewrites `/analytics.js` to it). It is not loaded by
`index.html` and performs no network calls; it exists so a deployment layer that
injects Vercel Analytics finds a same-origin queue instead of erroring. Keep it
no-op — enabling real telemetry needs an explicit product decision, and the CSP
stays self-only either way.

> History: an earlier Lovable-style **warm-light** token set (near-white
> `#faf9f6` canvas, multi-color aurora) is preserved in git history for this
> file; the shipped theme has been the editorial dark set above since the
> `style(playground)` dark-theme checkpoint.
