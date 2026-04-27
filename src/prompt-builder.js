export function buildPrompt({ config, patterns, profile, voice, scoring, text, mode = 'rewrite' }) {
  const lang = config.language || 'ko';
  const profileName = config.profile || 'default';

  const structurePacks = patterns.filter((p) => p.isStructure);
  const lexicalPacks = patterns.filter((p) => !p.isStructure);

  let prompt = `You are an editor who detects and removes AI writing patterns from text, rewriting it into natural, human-written prose.\n\n`;

  prompt += `## Configuration\n\n`;
  prompt += `- Language: ${lang}\n`;
  prompt += `- Profile: ${profileName}\n`;
  prompt += `- Output mode: ${mode}\n`;
  if (config.blocklist?.length > 0) {
    prompt += `- Blocklist: ${config.blocklist.join(', ')}\n`;
  }
  if (config.allowlist?.length > 0) {
    prompt += `- Allowlist: ${config.allowlist.join(', ')}\n`;
  }
  prompt += `\n`;

  prompt += `## Pattern Packs\n\n`;
  for (const pack of patterns) {
    prompt += `### Pack: ${pack.frontmatter?.pack || pack.file}\n\n`;
    prompt += `${pack.body}\n\n`;
  }

  prompt += `## Profile\n\n`;
  if (profile) {
    prompt += `${profile.body}\n\n`;
  }

  prompt += `## Voice Guidelines\n\n`;
  if (voice) {
    prompt += `${voice.body}\n\n`;
  }

  if (mode === 'score' || mode === 'ouroboros') {
    prompt += `## Scoring Algorithm\n\n`;
    if (scoring) {
      prompt += `${scoring.body}\n\n`;
    }
  }

  prompt += `## Instructions\n\n`;
  prompt += `Process the following text according to the output mode "${mode}".\n\n`;

  if (mode === 'rewrite') {
    prompt += buildRewriteInstructions(structurePacks, lexicalPacks);
  } else if (mode === 'diff') {
    prompt += buildDiffInstructions(structurePacks, lexicalPacks);
  } else if (mode === 'audit') {
    prompt += buildAuditInstructions();
  } else if (mode === 'score') {
    prompt += buildScoreInstructions(config, lang);
  } else if (mode === 'ouroboros') {
    prompt += buildOuroborosInstructions(config, structurePacks, lexicalPacks);
  }

  prompt += `\n## Input Text\n\n${text}\n\n`;
  prompt += `## Output\n\n`;

  return prompt;
}

function buildRewriteInstructions(structurePacks, lexicalPacks) {
  let inst = `Follow the 3-Phase pipeline:\n\n`;

  if (structurePacks.length > 0) {
    inst += `### Phase 1: Structure Scan\n\n`;
    inst += `Apply the structure patterns to fix document-level issues:\n`;
    for (const pack of structurePacks) {
      inst += `- ${pack.frontmatter?.pack || pack.file}\n`;
    }
    inst += `\n1. Scan paragraph layout, repetition, translationese, passive patterns\n`;
    inst += `2. Correct structural issues — diversify paragraph structure\n`;
    inst += `3. Verify core claims and logical flow survive structural changes\n`;
    inst += `4. Intentionally vary paragraph length and sentence count (burstiness)\n\n`;
    inst += `**Skip if**: text is ≤2 paragraphs OR no structure packs loaded.\n\n`;
  }

  inst += `### Phase 2: Sentence/Lexical Rewrite\n\n`;
  inst += `Apply all remaining pattern packs (content, language, style, communication, filler):\n`;
  for (const pack of lexicalPacks) {
    inst += `- ${pack.frontmatter?.pack || pack.file}\n`;
  }
  inst += `\n1. Scan all patterns for AI tells\n`;
  inst += `2. Rewrite AI-sounding expressions into natural alternatives\n`;
  inst += `3. Preserve core meaning, claims, polarity, causation, numbers\n`;
  inst += `4. Match profile tone\n`;
  inst += `5. Inject personality per voice guidelines\n`;
  inst += `6. Respect blocklist/allowlist and pattern overrides\n\n`;

  inst += `### Phase 3: Self-Audit\n\n`;
  inst += `1. Scan for remaining AI tells\n`;
  inst += `2. Verify no polarity inversions (negation → positive or vice versa)\n`;
  inst += `3. Ensure Phase 1 corrections were not reverted in Phase 2\n`;
  inst += `4. Final check: meaning preserved?\n\n`;

  inst += `Provide:\n`;
  inst += `1. A brief list of what still looks AI-written (if anything)\n`;
  inst += `2. The final humanized text\n`;

  return inst;
}

function buildDiffInstructions(structurePacks, lexicalPacks) {
  return `Show what changed and why, pattern by pattern. For each change:\n` +
    `- Show the original text\n` +
    `- Show the corrected text\n` +
    `- Name the pattern that triggered the change\n` +
    `- Explain why it was changed\n`;
}

function buildAuditInstructions() {
  return `Detect AI patterns ONLY — do not rewrite. Output a table:\n\n` +
    `| Pattern | Category | Severity | Location |\n` +
    `|---------|----------|----------|----------|\n`;
}

function buildScoreInstructions(config, lang) {
  const weights = config.ouroboros?.['category-weights']?.[lang] || {};
  let inst = `Calculate an AI-likeness score (0-100) with per-category breakdown:\n\n`;

  for (const [cat, weight] of Object.entries(weights)) {
    inst += `- ${cat}: weight ${weight}\n`;
  }

  inst += `\nSeverity scale: Low=1, Medium=2, High=3 points per detection.\n`;
  inst += `Category score = (sum of adjusted severities / (pattern_count × 3)) × 100\n`;
  inst += `Overall = weighted average of category scores.\n\n`;
  inst += `Output format:\n`;
  inst += `| Category | Weight | Detected | Raw Score | Weighted |\n`;
  inst += `|----------|--------|----------|-----------|----------|\n`;
  inst += `| **Overall** | | | | **XX.X (±10)** |\n\n`;
  inst += `Interpretation: 0-15 human | 16-30 mostly human | 31-50 mixed | 51-70 AI-like | 71-100 heavily AI\n`;

  return inst;
}

function buildOuroborosInstructions(config, structurePacks, lexicalPacks) {
  const ouroboros = config.ouroboros || {};
  const targetScore = ouroboros['target-score'] ?? 30;
  const maxIterations = ouroboros['max-iterations'] ?? 3;
  const plateauThreshold = ouroboros['plateau-threshold'] ?? 10;
  const fidelityFloor = ouroboros['fidelity-floor'] ?? 70;
  const mpsFloor = ouroboros['mps-floor'] ?? 70;

  let inst = `Iterative self-improvement loop:\n\n`;
  inst += `1. Measure initial AI-likeness score\n`;
  inst += `2. If score ≤ ${targetScore}, stop immediately\n`;
  inst += `3. Repeat (max ${maxIterations} iterations):\n`;
  inst += `   a. Run Phase 1 → Phase 2 → Phase 3 pipeline\n`;
  inst += `   b. Score the result\n`;
  inst += `   c. delta = previous - current (positive = improvement)\n`;
  inst += `   d. Terminate if:\n`;
  inst += `      - Score ≤ ${targetScore} → target met\n`;
  inst += `      - delta < 0 → regression → rollback to previous\n`;
  inst += `      - 0 ≤ delta ≤ ${plateauThreshold} → plateau\n`;
  inst += `      - iteration ≥ ${maxIterations} → max iterations\n`;
  inst += `      - fidelity < ${fidelityFloor} → fidelity violation → rollback\n`;
  inst += `      - MPS < ${mpsFloor} → MPS violation → rollback\n`;
  inst += `4. Output iteration log and final text\n\n`;
  inst += buildRewriteInstructions(structurePacks, lexicalPacks);

  return inst;
}
