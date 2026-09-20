import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { readFileSync } from 'node:fs';

process.loadEnvFile('.env');
const client = new Anthropic({ apiKey: process.argv[4] ?? process.env.AI_API_KEY_LOCAL ?? '', timeout: 60000, maxRetries: 1 });

const per100g = z.object({
  calories: z.number(), protein: z.number(), fat: z.number(), carbs: z.number()
});
const schema = z.object({
  isFood: z.boolean(),
  items: z.array(z.object({
    name: z.string(), estimatedGrams: z.number(), preparation: z.string(),
    confidence: z.number(), notes: z.string(), fallbackPer100g: per100g
  })),
  overallConfidence: z.number()
});

const image = readFileSync(process.argv[2]).toString('base64');
const prompts = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const runs = 3;

for (const [label, system] of Object.entries(prompts)) {
  console.log(`\n=== ${label} ===`);
  for (let i = 0; i < runs; i += 1) {
    const res = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 4096,
      system,
      output_config: { format: zodOutputFormat(schema), effort: 'low' },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
        { type: 'text', text: 'Разбери это фото еды на компоненты и оцени вес каждого из них.' }
      ] }]
    });
    const parsed = res.parsed_output ?? res.parsed ?? null;
    if (!parsed) { console.log('нет разбора:', JSON.stringify(res).slice(0, 200)); continue; }
    const items = parsed.items.map((it) => `${it.name} ${it.estimatedGrams}г (${it.fallbackPer100g.calories}/100г)`).join('; ');
    const kcal = parsed.items.reduce((s, it) => s + it.estimatedGrams * it.fallbackPer100g.calories / 100, 0);
    console.log(`${i + 1}: по оценке модели ${Math.round(kcal)} ккал — ${items}`);
  }
}
