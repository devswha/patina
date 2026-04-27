import { getRepoRoot } from './config.js';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_RETRIES = 2;

export async function callLLM({
  prompt,
  apiKey,
  baseURL = 'https://api.openai.com/v1',
  model = 'gpt-4o',
  temperature = 0.7,
  timeout = DEFAULT_TIMEOUT,
  maxRetries = DEFAULT_MAX_RETRIES,
}) {
  const url = `${baseURL}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM API');
      }

      return content;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = 1000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`LLM API failed after ${maxRetries + 1} attempts: ${lastError.message}`);
}

export async function callLLMMultiple({
  prompt,
  models,
  apiKey,
  baseURL = 'https://api.openai.com/v1',
  temperature = 0.7,
  timeout = DEFAULT_TIMEOUT,
  onStart,
  onComplete,
}) {
  const promises = models.map(async (model) => {
    if (onStart) onStart(model);
    try {
      const result = await callLLM({
        prompt,
        apiKey,
        baseURL,
        model,
        temperature,
        timeout,
      });
      if (onComplete) onComplete(model, true);
      return { model, result, ok: true };
    } catch (err) {
      if (onComplete) onComplete(model, false);
      return { model, error: err.message, ok: false };
    }
  });

  return Promise.all(promises);
}
