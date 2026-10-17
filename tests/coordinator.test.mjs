import test from 'node:test';
import assert from 'node:assert/strict';
import { planSource } from '../scripts/status.mjs';
const schedule={enabled:true,intervalHours:6};
test('a failed parser is sent to repair instead of recollection on the next pass',()=>{
  assert.equal(planSource(schedule,{error:{code:'contract_changed'}}).action,'repair_adapter');
});
test('access challenges remain blocked instead of entering a rewrite loop',()=>{
  assert.equal(planSource(schedule,{error:{code:'access_blocked'}}).action,'blocked_access');
});
test('per-source cadence controls selection independently of coordinator frequency',()=>{
  const result={finishedAt:'2026-10-16T00:00:00Z'};
  assert.equal(planSource(schedule,result,new Date('2026-10-16T01:00:00Z')).action,'wait');
  assert.equal(planSource(schedule,result,new Date('2026-10-16T07:00:00Z')).action,'collect');
});
test('disabled examples cannot be scheduled even after a successful smoke test',()=>{
  assert.equal(planSource({...schedule,enabled:false},null).action,'disabled');
});
