#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const AI_TEXT = `Coffee has emerged as a pivotal cultural phenomenon that has fundamentally transformed social interactions across the globe. This beloved beverage serves as a catalyst for community building, fosters meaningful connections, and facilitates cross-cultural dialogue. From the bustling cafés of Paris to the serene tea houses repurposed for coffee in Tokyo, this remarkable journey showcases the innovative spirit of human culinary exploration.

The proliferation of coffee shops in urban centers has created unprecedented opportunities for social engagement. Patrons from diverse backgrounds converge in these spaces, united by their shared appreciation for this aromatic brew. Furthermore, the ritual of coffee consumption has transcended mere sustenance, evolving into a cornerstone of modern social etiquette.

Industry experts unanimously agree that the coffee sector will continue its exponential growth trajectory. Despite minor challenges related to climate change and supply chain disruptions, the future remains exceedingly bright. This transformative beverage will undoubtedly maintain its position as an indispensable component of global culture.`;

function loadPromptBuilder() {
  // Dynamically import the prompt builder
  return import('../../src/prompt-builder.js');
}

function loadConfigLoader() {
  return import('../../src/config.js');
}

function loadLoader() {
  return import('../../src/loader.js');
}

async function buildPatinaPrompt(text, mode = 'rewrite') {
  const { loadConfig, getRepoRoot } = await loadConfigLoader();
  const { loadPatterns, loadProfile, loadCoreFile } = await loadLoader();
  const { buildPrompt } = await loadPromptBuilder();

  const config = loadConfig();
  const repoRoot = getRepoRoot();
  const patterns = loadPatterns(repoRoot, 'en');
  const profile = loadProfile(repoRoot, 'default');
  const voice = loadCoreFile(repoRoot, 'voice.md');

  return buildPrompt({
    config,
    patterns,
    profile: profile.body ? profile : null,
    voice: voice.body ? voice : null,
    text,
    mode,
  });
}

async function runWithOpenCode(prompt) {
  const tempFile = resolve(REPO_ROOT, 'tests/e2e/temp-prompt.txt');
  writeFileSync(tempFile, prompt, 'utf8');

  try {
    const result = execSync(
      `opencode run -m opencode/hy3-preview-free --pure "$(cat ${tempFile})"`,
      {
        encoding: 'utf8',
        timeout: 120000,
        cwd: REPO_ROOT,
      }
    );
    return result;
  } catch (err) {
    return err.stdout || err.message;
  }
}

function evaluateQuality(original, humanized) {
  const checks = [];

  // Check 1: AI buzzwords removed
  const aiWords = ['pivotal', 'fundamentally transformed', 'catalyst', 'unprecedented', 'exceedingly bright'];
  const removedWords = aiWords.filter(w => !humanized.toLowerCase().includes(w.toLowerCase()));
  checks.push({
    name: 'AI buzzwords removed',
    pass: removedWords.length >= 3,
    detail: `Removed ${removedWords.length}/${aiWords.length}: ${removedWords.join(', ')}`,
  });

  // Check 2: Meaning preserved
  const keyFacts = [
    'coffee',
    'social',
    'paris',
    'tokyo',
    'café',
    'tea house',
  ];
  const preservedFacts = keyFacts.filter(f => humanized.toLowerCase().includes(f.toLowerCase()));
  checks.push({
    name: 'Key facts preserved',
    pass: preservedFacts.length >= 4,
    detail: `Preserved ${preservedFacts.length}/${keyFacts.length}: ${preservedFacts.join(', ')}`,
  });

  // Check 3: Shorter or similar length
  const lengthRatio = humanized.length / original.length;
  checks.push({
    name: 'Reasonable length',
    pass: lengthRatio >= 0.5 && lengthRatio <= 1.5,
    detail: `Length ratio: ${(lengthRatio * 100).toFixed(1)}%`,
  });

  // Check 4: Has personal voice (first person or contractions)
  const hasVoice = /\b(I|me|my|I've|don't|can't|maybe|probably)\b/i.test(humanized);
  checks.push({
    name: 'Personal voice detected',
    pass: hasVoice,
    detail: hasVoice ? 'Found first-person or contractions' : 'No personal voice markers',
  });

  // Check 5: Sentence variety
  const sentences = humanized.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const lengths = sentences.map(s => s.trim().split(/\s+/).length);
  const hasVariety = lengths.some(l => l < 8) && lengths.some(l => l > 15);
  checks.push({
    name: 'Sentence length variety',
    pass: hasVariety,
    detail: `Sentence word counts: ${lengths.join(', ')}`,
  });

  return checks;
}

async function main() {
  console.log('=== Patina Quality Test ===\n');
  console.log('Original text (AI-generated):');
  console.log('---');
  console.log(AI_TEXT);
  console.log('---\n');

  console.log('Building patina prompt...');
  const prompt = await buildPatinaPrompt(AI_TEXT, 'rewrite');
  console.log(`Prompt size: ${prompt.length} chars\n`);

  console.log('Running through OpenCode (hy3-preview-free)...');
  console.log('This may take 30-60 seconds...\n');

  const humanized = await runWithOpenCode(prompt);

  console.log('Humanized result:');
  console.log('---');
  console.log(humanized);
  console.log('---\n');

  console.log('Quality evaluation:');
  const checks = evaluateQuality(AI_TEXT, humanized);
  let passed = 0;

  for (const check of checks) {
    const icon = check.pass ? '✅' : '❌';
    console.log(`${icon} ${check.name}`);
    console.log(`   ${check.detail}`);
    if (check.pass) passed++;
  }

  console.log(`\nOverall: ${passed}/${checks.length} checks passed`);

  if (passed >= 4) {
    console.log('\n✅ Quality test PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ Quality test FAILED');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
