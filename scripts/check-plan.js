import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const prompt = readFileSync('Cookiebase_Codex_Masterprompt.md', 'utf8');
const plan = readFileSync('docs/IMPLEMENTATION_PLAN.md', 'utf8');
const matrix = readFileSync('docs/REVIEW_REQUIREMENTS.md', 'utf8');
for (let id = 1; id <= 11; id++) assert.ok(prompt.includes(`CB-${String(id).padStart(2, '0')}`) && matrix.includes(`CB-${String(id).padStart(2, '0')}`));
for (let phase = 1; phase <= 8; phase++) assert.match(plan, new RegExp(`\\| ${phase} `));
console.log('Audit: eight phases and CB-01 through CB-11 traced.');
