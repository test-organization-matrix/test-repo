'use strict';

// Load .env without any dependency.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file - defaults apply
}

const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;

const ai = {
  apiKey: process.env.AI_API_KEY || '',
  baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.AI_MODEL || 'gpt-4o-mini',
};

const app = createApp({ ai });

app.listen(PORT, () => {
  console.log(`AI Todo app running at http://localhost:${PORT}`);
  console.log(`AI engine: ${ai.apiKey ? `LLM (${ai.model})` : 'built-in rules (no AI_API_KEY set)'}`);
});
