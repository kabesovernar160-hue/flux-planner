import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
process.loadEnvFile('.env');
const token = process.env.TELEGRAM_BOT_TOKEN.trim();
const base = 'https://flux-planner-rili1.vercel.app';
const file = process.argv[2];
const runs = Number(process.argv[3] ?? 3);

const sign = (id) => {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAFtest',
    user: JSON.stringify({ id, first_name: 'Проверка', username: `local_test_${id}`, language_code: 'ru' })
  };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
};

const bytes = readFileSync(file);
const totals = [];

for (let i = 0; i < runs; i += 1) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: file.endsWith('.png') ? 'image/png' : 'image/jpeg' }), 'meal.png');
  const res = await fetch(`${base}/api/nutrition/analyze`, {
    method: 'POST',
    headers: { 'x-telegram-init-data': sign(999100000 + Date.now() % 100000 + i), origin: base },
    body: form
  });
  const json = await res.json();
  if (!json.result) { console.log(i + 1, res.status, JSON.stringify(json).slice(0, 120)); continue; }
  const items = json.result.items.map((it) => `${it.name} ${it.estimatedGrams}г`).join(', ');
  const grams = json.result.items.reduce((sum, it) => sum + it.estimatedGrams, 0);
  totals.push(json.result.totals.calories);
  console.log(`${i + 1}: ${Math.round(json.result.totals.calories)} ккал, вес ${grams} г — ${items}`);
}

if (totals.length > 1) {
  console.log(`разброс: ${Math.min(...totals)}–${Math.max(...totals)} ккал, среднее ${Math.round(totals.reduce((a, b) => a + b, 0) / totals.length)}`);
}
