import test from 'node:test';
import assert from 'node:assert/strict';
import { protectImportPlan } from '../src/core/rules.js';
test('imports preserve protected removals and overwrites unless an explicit override is chosen', () => {
  const cookie = { name:'consent',domain:'example.com',path:'/',storeId:'0' };
  const plan = { warnings:[], counts:{}, removals:[cookie], actions:[{action:'overwrite',cookie:{...cookie,value:'new'},previous:cookie}] };
  const rules = [{domain:'example.com',name:'consent',path:'*'}];
  const safe = protectImportPlan(plan,rules);
  assert.equal(safe.removals.length,0); assert.equal(safe.actions[0].action,'skip'); assert.equal(safe.counts.protectedOverwrites,1);
  const override = protectImportPlan(plan,rules,{overrideProtection:true});
  assert.equal(override.removals.length,1); assert.equal(override.actions[0].action,'overwrite'); assert.match(override.warnings.join(' '),/OVERRIDE/);
  assert.equal(plan.actions[0].action,'overwrite');
});
