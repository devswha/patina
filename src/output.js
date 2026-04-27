export function formatOutput(result, mode, parsed) {
  if (typeof result === 'string') {
    return result.trim();
  }

  if (result?.type === 'max-mode') {
    return formatMaxModeOutput(result);
  }

  return String(result).trim();
}

function formatMaxModeOutput(result) {
  const { candidates, best } = result;

  let output = '## MAX Mode Results\n\n';
  output += '| Model | AI Score | MPS | Status |\n';
  output += '|-------|----------|-----|--------|\n';

  for (const c of candidates) {
    const status = c.ok ? (c.model === best?.model ? '✅ best' : '✅') : '❌ failed';
    const score = c.aiScore ?? '--';
    const mps = c.mps ?? '--';
    output += `| ${c.model} | ${score} | ${mps} | ${status} |\n`;
  }

  output += `\n**Best: ${best?.model || 'none'}**\n\n`;

  if (best?.result) {
    output += '### Final Text\n\n';
    output += best.result.trim();
    output += '\n\n';
  }

  for (const c of candidates) {
    if (c.model !== best?.model && c.ok && c.result) {
      output += `\n<details>\n<summary>${c.model} result</summary>\n\n`;
      output += c.result.trim();
      output += '\n</details>\n';
    }
  }

  return output;
}
