export function buildPrompt({ config, patterns, profile, voice, scoring, text, mode = 'rewrite', tone = null, promptMode = 'strict', variants = 1 }) {
  // v3.11+ prompt-mode dispatch (case-04 hypothesis test). minimal prompt
  // strips pattern definitions/examples and uses a casual instruction; only
  // applies to rewrite mode where voice prior matters most.
  if (promptMode === 'minimal' && mode === 'rewrite') {
    return buildMinimalPrompt({ config, patterns, text, tone, variants });
  }

  const lang = config.language || 'ko';
  const profileName = config.profile || 'default';

  // score_only packs (e.g., viral-hook) are detection-only: included in score
  // and audit modes but excluded from rewrite/diff/ouroboros so we don't force
  // edits to viral-hook patterns that may be intentional rhetoric.
  const includeScoreOnly = mode === 'score' || mode === 'audit';
  const activePatterns = includeScoreOnly
    ? patterns
    : patterns.filter((p) => !p.isScoreOnly);

  const structurePacks = activePatterns.filter((p) => p.isStructure);
  const lexicalPacks = activePatterns.filter((p) => !p.isStructure);

  let prompt = `You are an editor who detects and removes AI writing patterns from text, rewriting it into natural, human-written prose.\n\n`;

  // Tone context (v3.10). Surface resolved tone metadata at the top so the LLM
  // applies Phase 4.5b/5b/6 logic per SKILL.md. Body text in rewrite mode must
  // not leak tone metadata (A7) — only the YAML footer at the end carries it.
  if (tone && tone.tone_source) {
    prompt += `## Tone Resolution (v3.10)\n\n`;
    prompt += `- resolved_tone: ${tone.tone === null ? 'null' : tone.tone}\n`;
    prompt += `- tone_source: ${tone.tone_source}\n`;
    prompt += `- tone_evidence: ${JSON.stringify(tone.tone_evidence ?? [])}\n`;
    prompt += `- tone_confidence: ${tone.tone_confidence ?? 'null'}\n`;
    if (tone.tone_source === 'auto') {
      prompt += `\nRun Phase 4.5b heuristic detection per SKILL.md to resolve a single tone, evidence, and confidence. Apply Phase 5b tone-derived overrides (replace, not stack) and emit Phase 6 YAML footer.\n`;
    } else if (tone.tone_source === 'user') {
      prompt += `\nApply Phase 5b tone-derived overrides for "${tone.tone}" (replace, not stack with profile overrides). Emit Phase 6 YAML footer with these exact values.\n`;
    } else if (tone.tone_source === 'unsupported_language_fallback') {
      prompt += `\nzh/ja with explicit tone is unsupported in v1; proceed in profile-only mode. Emit Phase 6 YAML footer with tone: null and the fallback warning preserved in tone_evidence.\n`;
    } else if (tone.tone_source === 'profile_only') {
      prompt += `\nNo tone specified — profile-only mode (regression-safe path). Phase 4.5b is skipped. Emit Phase 6 YAML footer with tone: null and tone_source: profile_only.\n`;
    }
    prompt += `\n`;
  }

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
  for (const pack of activePatterns) {
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
    prompt += buildRewriteInstructions(structurePacks, lexicalPacks, { variants });
  } else if (mode === 'diff') {
    prompt += buildDiffInstructions();
  } else if (mode === 'audit') {
    prompt += buildAuditInstructions();
  } else if (mode === 'score') {
    prompt += buildScoreInstructions(config, lang, text);
  } else if (mode === 'ouroboros') {
    prompt += buildOuroborosInstructions(config, structurePacks, lexicalPacks);
  }

  prompt += `\n## Input Text\n\n${text}\n\n`;
  prompt += `## Output\n\n`;

  return prompt;
}

function buildRewriteInstructions(structurePacks, lexicalPacks, { includeSelfAudit = true, variants = 1 } = {}) {
  const phaseCount = includeSelfAudit ? 3 : 2;
  let inst = `Follow the ${phaseCount}-Phase pipeline:\n\n`;

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

  if (includeSelfAudit) {
    inst += `### Phase 3: Self-Audit\n\n`;
    inst += `1. Scan for remaining AI tells\n`;
    inst += `2. Verify no polarity inversions (negation → positive or vice versa)\n`;
    inst += `3. Ensure Phase 1 corrections were not reverted in Phase 2\n`;
    inst += `4. Final check: meaning preserved?\n\n`;

    inst += `### Output format (STRICT — v3.11)\n\n`;
    inst += `Produce output in this exact order, with no other text outside the tagged blocks:\n\n`;

    if (variants > 1) {
      inst += `1. Produce ${variants} stylistic VARIANTS of the rewrite, each ` +
        `wrapped in \`[VARIANT n]\`/\`[/VARIANT]\` tags where n is 1..${variants}. ` +
        `Each variant must preserve all facts, numbers, and causation, but ` +
        `differ in voice (e.g., V1 casual conversational, V2 direct/punchy, ` +
        `V3 measured/professional). No headings, no preamble inside the tags.\n`;
      inst += `2. Self-audit notes wrapped in \`[SELF_AUDIT]\`/\`[/SELF_AUDIT]\` tags ` +
        `(brief: what differs across variants, residual AI signals, applied patterns).\n`;
      inst += `3. The Phase 6 YAML footer if tone resolution requires it.\n\n`;
      inst += `Example shape:\n\n`;
      inst += "```\n";
      for (let i = 1; i <= variants; i++) {
        inst += `[VARIANT ${i}]\n<rewritten text — voice ${i}>\n[/VARIANT]\n\n`;
      }
      inst += `[SELF_AUDIT]\n- voice axis: ...\n- residual signals: ...\n[/SELF_AUDIT]\n\n`;
      inst += "---\ntone: ...\ntone_source: ...\ntone_evidence: [...]\ntone_confidence: ...\n---\n";
      inst += "```\n";
    } else {
      inst += `1. The rewritten text wrapped in \`[BODY]\`/\`[/BODY]\` tags. ` +
        `The body block must contain ONLY the user-facing rewrite — no headings, ` +
        `no Phase labels, no preamble like "잔여 AI 티" or "최종 결과물".\n`;
      inst += `2. Self-audit notes wrapped in \`[SELF_AUDIT]\`/\`[/SELF_AUDIT]\` tags ` +
        `(brief: what still looks AI-written, which patterns were applied). ` +
        `This block is for downstream review — patina strips it before showing the user.\n`;
      inst += `3. The Phase 6 YAML footer if tone resolution requires it.\n\n`;
      inst += `Example shape:\n\n`;
      inst += "```\n";
      inst += `[BODY]\n<rewritten text>\n[/BODY]\n\n`;
      inst += `[SELF_AUDIT]\n- residual signals: ...\n- patterns applied: ...\n[/SELF_AUDIT]\n\n`;
      inst += "---\ntone: ...\ntone_source: ...\ntone_evidence: [...]\ntone_confidence: ...\n---\n";
      inst += "```\n";
    }
  } else {
    // Self-audit suppressed: external evaluators (scoreText, scoreMPS,
    // scoreFidelity) handle AI-tell detection, polarity, and meaning checks
    // downstream. Output only the rewritten text so iterations stay clean.
    inst += `Output ONLY the final humanized text. Do not include analysis, ` +
      `pattern lists, or commentary — downstream evaluators handle that.\n`;
  }

  return inst;
}

function buildDiffInstructions() {
  return `Show what changed and why, pattern by pattern. For each change:\n` +
    `- Show the original text\n` +
    `- Show the corrected text\n` +
    `- Name the pattern that triggered the change (use exact \`N. Pattern Name\` from the loaded packs)\n` +
    `- Explain why it was changed\n`;
}

function buildAuditInstructions() {
  return `Detect AI patterns ONLY — do not rewrite. Output a table.\n\n` +
    `**Strict requirements:**\n` +
    `- Use the EXACT pattern name AND number from the loaded Pattern Packs above. ` +
    `Format: \`N. Pattern Name\` (e.g., \`30. Rhetorical Question Openers\` or \`13. Em Dash Overuse\`). ` +
    `Do not paraphrase, abbreviate, or invent names.\n` +
    `- The Category column must be the exact pack name from the loaded packs ` +
    `(e.g., \`en-structure\`, \`ko-filler\`, \`zh-content\`). Do not use generic ` +
    `category names like "Style", "Filler", or "Content".\n` +
    `- If you suspect an AI tell that doesn't match any loaded pattern exactly, ` +
    `omit it from the table rather than coining a new name.\n\n` +
    `Output format:\n` +
    `| Pattern | Category | Severity | Location |\n` +
    `|---------|----------|----------|----------|\n`;
}

function buildScoreInstructions(config, lang, text = '') {
  const weights = config.ouroboros?.['category-weights']?.[lang] || {};
  let inst = `Calculate an AI-likeness score (0-100) using EXACTLY these category weights. Do NOT invent extra categories (no "discord", no "tone", no "general"). Use only the categories listed:\n\n`;

  for (const [cat, weight] of Object.entries(weights)) {
    inst += `- ${cat}: ${weight}\n`;
  }

  inst += `\nSeverity scale: Low=1, Medium=2, High=3 points per detection.\n`;
  inst += `Category score = (sum of adjusted severities / (pattern_count × 3)) × 100\n`;
  inst += `Overall = weighted average using the EXACT weights above (sum should equal 1.00).\n\n`;

  // v3.11 Phase 3.2: short text (~200 chars or ≤3 paragraphs) often shows
  // clear voice/register shifts that the standard formula barely registers
  // because so few pattern instances accumulate. Tell the model to apply a
  // 1.5x severity multiplier to register-sensitive categories (language,
  // style, viral-hook) in this regime, capped at 3 (High) per detection.
  const isShort = isShortText(text);
  if (isShort) {
    inst += `**Short-text boost (input ≤200 chars OR ≤3 paragraphs):** for `;
    inst += `register-sensitive categories (\`language\`, \`style\`, \`viral-hook\`) `;
    inst += `apply a 1.5x severity multiplier per detection (cap at 3). This `;
    inst += `surfaces voice/register shifts (e.g., \`~다\` ↔ \`~습니다\` swap) `;
    inst += `that the long-text formula otherwise undercounts.\n\n`;
  }

  inst += `Output format (the Weight column must echo the values above verbatim):\n`;
  inst += `| Category | Weight | Detected | Raw Score | Weighted |\n`;
  inst += `|----------|--------|----------|-----------|----------|\n`;
  inst += `| **Overall** | | | | **XX.X (±10)** |\n\n`;
  inst += `Interpretation: 0-15 human | 16-30 mostly human | 31-50 mixed | 51-70 AI-like | 71-100 heavily AI\n`;

  return inst;
}

// v3.11 Phase 3.2 helper: classify a text as "short" for scoring boost.
// Threshold: ≤200 non-whitespace chars OR ≤3 non-empty paragraphs.
export function isShortText(text) {
  if (!text) return true;
  const stripped = text.replace(/\s+/g, '');
  if (stripped.length <= 200) return true;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return paragraphs.length <= 3;
}

// v3.11 minimal prompt — case-04 hypothesis test.
// Strips pattern definitions/examples and uses a casual instruction so the
// model's natural voice prior isn't overridden by analytical framing. Only
// invoked for rewrite mode; score/audit/diff/ouroboros stay on the strict
// path because they need precise pattern references.
function buildMinimalPrompt({ config, patterns, text, tone, variants = 1 }) {
  const lang = config.language || 'ko';
  const activePatterns = patterns.filter((p) => !p.isScoreOnly);

  const watchWords = [];
  for (const pack of activePatterns) {
    const packName = pack.frontmatter?.pack || pack.file;
    const words = extractWatchWords(pack.body);
    if (words.length > 0) {
      watchWords.push(`- **${packName}**: ${words.join(', ')}`);
    }
  }

  const instruction = lang === 'ko'
    ? `이 글이 AI가 쓴 것 같아 보여서 사람이 쓴 것처럼 자연스럽게 다듬어줘. 아래 어휘들이 보이면 자연스러운 한국어로 풀어줘. 무리하게 의역하지 말고 의미·숫자·인과관계는 그대로 보존해.`
    : `This text reads like AI. Rewrite it so it sounds like a real person wrote it. If you spot any of the phrases below, swap them out for something natural. Don't over-paraphrase — keep the meaning, numbers, and causation intact.`;

  let prompt = `${instruction}\n\n`;

  if (watchWords.length > 0) {
    prompt += lang === 'ko' ? `## AI 신호 어휘 (참고)\n\n` : `## AI signal words (reference)\n\n`;
    prompt += watchWords.join('\n');
    prompt += '\n\n';
  }

  if (tone && tone.tone_source) {
    prompt += lang === 'ko' ? `## 톤\n` : `## Tone\n`;
    prompt += `- tone: ${tone.tone === null ? 'null' : tone.tone}\n`;
    prompt += `- source: ${tone.tone_source}\n\n`;
  }

  prompt += lang === 'ko' ? `## 출력 형식\n\n` : `## Output format\n\n`;
  if (variants > 1) {
    prompt += `1. ${variants}개 voice variant를 각각 \`[VARIANT 1]\` ~ \`[VARIANT ${variants}]\` ` +
      `태그 안에. 사실·숫자·인과관계는 동일하되 voice만 다르게 (예: V1 캐주얼 대화체, V2 직설·짧은 문장, V3 정중·차분).\n`;
    prompt += `2. \`[SELF_AUDIT]\` ... \`[/SELF_AUDIT]\` 안에 짧게: variant별 voice 차이, 남은 AI 신호.\n`;
    prompt += `3. 톤 정보가 있으면 마지막에 YAML 푸터.\n\n`;
  } else {
    prompt += `1. 다듬은 본문을 \`[BODY]\` ... \`[/BODY]\` 안에. 본문만, 머리말·메타·"최종 결과물" 같은 라벨 없이.\n`;
    prompt += `2. \`[SELF_AUDIT]\` ... \`[/SELF_AUDIT]\` 안에 짧게: 어떤 부분 손봤는지, 남은 AI 신호 있는지.\n`;
    prompt += `3. 톤 정보가 있으면 마지막에 YAML 푸터: \`---\\ntone: ...\\ntone_source: ...\\ntone_evidence: [...]\\ntone_confidence: ...\\n---\`\n\n`;
  }

  prompt += lang === 'ko' ? `## 입력\n\n${text}\n\n` : `## Input\n\n${text}\n\n`;
  prompt += lang === 'ko' ? `## 출력\n\n` : `## Output\n\n`;

  return prompt;
}

// Extract the comma-separated values that follow a "주의 어휘:" or "Watch words:"
// label in a pattern pack body. Used by buildMinimalPrompt to compress packs
// from full definitions+examples down to just the trigger vocab.
function extractWatchWords(body) {
  const re = /\*\*(?:주의 어휘|Watch words):\*\*\s*([^\n]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push(m[1].trim());
  }
  return out;
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
  // Skip Phase 3 self-audit: each iteration runs through external evaluators
  // (scoreText, scoreMPS, scoreFidelity) in src/ouroboros.js, so an in-prompt
  // self-audit duplicates work and inflates token cost.
  inst += buildRewriteInstructions(structurePacks, lexicalPacks, { includeSelfAudit: false });

  return inst;
}
