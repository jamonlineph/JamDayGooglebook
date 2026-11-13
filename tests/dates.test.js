// Run with: npm test   (Node 20+)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../app/js/dates.js';
import { parseQuick } from '../app/js/tokens.js';

const base = new Date(2026, 10, 13, 10, 0); // Friday, Nov 13 2026, 10:00
const p = (s) => D.parseNatural(s, { base, weekStart: 1 });

test('relative days and times', () => {
  assert.deepEqual([p('tomorrow 3pm').date, p('tomorrow 3pm').time], ['2026-11-14', '15:00']);
  assert.equal(p('in 2 weeks').date, '2026-11-27');
  assert.equal(p('next fri').date, '2026-11-20');
  assert.equal(p('tonight').time, '20:00');
  assert.equal(p('Lunch at noon').rest, 'Lunch');
});

test('absolute dates', () => {
  assert.equal(p('nov 20').date, '2026-11-20');
  assert.equal(p('20 nov').date, '2026-11-20');
  assert.equal(p('11/25').date, '2026-11-25');
  assert.equal(p('2026-12-01').date, '2026-12-01');
  assert.equal(p('the 5th').date, '2026-12-05');
});

test('spans and someday', () => {
  assert.deepEqual([p('this week').kind, p('this week').date], ['week', '2026-11-09']);
  assert.deepEqual([p('next month').kind, p('next month').date], ['month', '2026-12-01']);
  assert.equal(p('someday').kind, 'someday');
});

test('time ranges', () => {
  const r = p('standup 9:30-10am');
  assert.deepEqual([r.time, r.endTime, r.rest], ['09:30', '10:00', 'standup']);
});

test('repeat rules', () => {
  const r = p('gym every mon, wed and fri');
  assert.deepEqual(r.repeat.days, [1, 3, 5]);
  assert.equal(D.describeRepeat(r.repeat), 'Every Mon, Wed, Fri');
  assert.equal(D.describeRepeat(p('every weekday').repeat), 'Every weekday');
  assert.equal(D.nextOccurrence({ freq: 'month', interval: 1, monthDay: 31, anchor: '2026-01-31' }, '2026-02-01'), '2026-02-28');
});

test('habit streaks count completions within each occurrence window', () => {
  const daily = { id: 'a', updatedAt: 1, repeat: { freq: 'day', interval: 1, anchor: '2026-11-01' }, completions: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'] };
  assert.equal(D.habitStats(daily, '2026-11-13').streak, 4);
  const weekly = { id: 'b', updatedAt: 1, repeat: { freq: 'week', interval: 1, days: [5], anchor: '2026-10-02' }, completions: ['2026-11-05', '2026-10-30', '2026-10-23'] };
  // finished a day early this week (Thu) still counts for Friday
  assert.equal(D.habitStats(weekly, '2026-11-13').streak, 3);
});

test('quick tokens', () => {
  const q = parseQuick('Call Ana @tomorrow 3pm #home &Family !high +Sam');
  assert.equal(q.title, 'Call Ana');
  assert.deepEqual(q.tagNames, ['home']);
  assert.equal(q.folderName, 'Family');
  assert.equal(q.priority, 3);
  assert.deepEqual(q.people, ['Sam']);
  assert.equal(q.parsed.time, '15:00');
  assert.equal(parseQuick('Ship it !!!').priority, 4);
});
