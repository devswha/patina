# Fixture: instructional × en

**diff focus:** Imperative verbs at sentence head, numbered structure, hedging stripped, one action per step

---

## Input

Before you begin the setup process, you may want to consider checking whether Node.js is installed on your system. It would be advisable to ensure that the version is 18 or higher. You could then proceed to clone the repository. After installation is complete, you might want to think about starting the development server.

---

## Output (instructional tone applied)

1. Check your Node.js version: `node --version` (requires 18 or higher)
2. Clone the repository: `git clone https://github.com/example/repo`
3. Install dependencies: `npm install`
4. Start the development server: `npm run dev`

---

## Diff notes

- "you may want to consider checking" → "Check" (imperative, hedging stripped)
- "It would be advisable to ensure" → removed as separate step, folded into step 1
- "You could then proceed to" → "Clone" (direct imperative)
- "you might want to think about starting" → "Start" (hedging fully removed)
- Prose → numbered list (one action per step)
- Inline code commands added for precision
- Filler phrases ("Before you begin," "After installation is complete") → replaced by sequence numbers
