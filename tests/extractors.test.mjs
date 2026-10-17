import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDateRange, parseTimeRange, parseLaCalendar, parseBostonCalendar, parseTribePage, assertValidRecords, nextAction } from '../examples/parsers.mjs';
import { classifyResponse } from '../examples/runtime.mjs';
const fixture=name=>readFile(new URL(`fixtures/${name}`,import.meta.url),'utf8');

test('LA inspected date range retains day precision without inventing event times',async()=>{
  const {records}=parseLaCalendar(await fixture('la-calendar.html'));
  assert.equal(records[0].title,'AAO-HNSF 2026 Annual Meeting & OTO EXPO');
  assert.equal(records[0].startDate,'2026-10-17');assert.equal(records[0].endDate,'2026-10-20');
  assert.equal(records[0].startLocal,null);assert.equal(records[0].allDay,null);
});
test('invalid calendar dates and ambiguous year changes are rejected',()=>{
  assert.equal(parseDateRange('Feb 30, 2026').startDate,null);
  assert.equal(parseDateRange('Dec 31 - Jan 1, 2026').startDate,null);
  assert.deepEqual(parseDateRange('Oct 30 - Nov 1, 2026'),{startDate:'2026-10-30',endDate:'2026-11-01'});
});
test('visible clocks handle noon and midnight; malformed hours remain unknown',()=>{
  assert.deepEqual(parseTimeRange('12:00am-12:30pm'),{startTime:'00:00:00',endTime:'12:30:00'});
  assert.equal(parseTimeRange('25:00pm').startTime,null);
});
test('Boston external event websites do not break extraction',async()=>{
  const {records}=parseBostonCalendar(await fixture('boston-calendar.html'));
  const external=records.find(r=>r.title==='MattaHAUNT Woods Discovery Day');
  assert.equal(external.url,'https://thetrustees.org/event/450255/');
});
test('Boston recurrence preserves separate occurrences and source locality',async()=>{
  const {records}=parseBostonCalendar(await fixture('boston-calendar.html'));
  const first=records.find(r=>r.title==='Parks Fitness: Walking Group with Brandy');
  assert.equal(first.startLocal,'2026-10-17T08:00:00');assert.equal(first.endLocal,'2026-10-17T09:00:00');
  assert.equal(first.location.locality,'Dorchester');assert.equal(first.marketCity,'Boston');
  const recurring=records.filter(r=>r.title==='Digital Literacy Workshop');
  assert.equal(recurring.length,2);assert.notEqual(recurring[0].sourceRecordId,recurring[1].sourceRecordId);
  assertValidRecords(records);
});
test('TEC source all-day conflict is retained and flagged rather than silently corrected',async()=>{
  const {records}=parseTribePage(JSON.parse(await fixture('tribe-page.json')));
  assert.equal(records[0].allDay,true);assert.equal(records[0].startLocal,null);
  assert.ok(records[0].warnings.includes('source_all_day_flag_conflicts_with_timed_description'));
});
test('broken selectors or incompatible API envelope request adapter repair',()=>{
  assert.throws(()=>parseLaCalendar('<html>No cards</html>'),{code:'contract_changed'});
  assert.throws(()=>parseTribePage({items:[],total:0}),{code:'contract_changed'});
  assert.equal(nextAction({error:{code:'contract_changed'}}).action,'repair_adapter');
});
test('transport success is insufficient when response is an access challenge',()=>{
  assert.throws(()=>classifyResponse(200,'<title>Just a moment...</title>'),{code:'access_blocked'});
  assert.throws(()=>classifyResponse(429,''),{code:'rate_limited'});
  assert.equal(nextAction({error:{code:'access_blocked'}}).action,'blocked_access');
  assert.equal(nextAction({error:{code:'rate_limited'}}).action,'retry_after_cooldown');
});
test('repeated records cannot masquerade as successful pagination',async()=>{
  const {records}=parseLaCalendar(await fixture('la-calendar.html'));
  assert.throws(()=>assertValidRecords([records[0],records[0]]),{code:'pagination_changed'});
});
