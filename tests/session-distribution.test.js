import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDistribution } from '../server/session-distribution.js';

test('median and interpolated quartiles describe skew without changing the mean or inputs', () => {
  const counts = [100, 1, 1, 1], snapshot = [...counts];
  const d = sessionDistribution(counts);
  assert.equal(d.participants, 4); assert.equal(d.median, 1); assert.equal(d.q1, 1); assert.equal(d.q3, 25.75); assert.equal(d.mean, 25.75);
  assert.deepEqual(counts, snapshot);
  const even = sessionDistribution([4, 1, 2, 3]);
  assert.equal(even.median, 2.5); assert.equal(even.q1, 1.75); assert.equal(even.q3, 3.25);
  const odd = sessionDistribution([3, 1, 5]);
  assert.equal(odd.median, 3); assert.equal(odd.q1, 2); assert.equal(odd.q3, 4);
});

test('bins are mutually exclusive and cover all positive distinct session counts', () => {
  const d = sessionDistribution([1, 2, 3, 4, 5, 6, 10, 11, 20, 21, 101]);
  assert.deepEqual(d.bins.map(b => b.count), [1, 2, 2, 2, 2, 2]);
  assert.equal(d.bins.reduce((sum, b) => sum + b.count, 0), d.participants);
  assert.equal(Object.hasOwn(d, 'counts'), false, 'no per-person source values in the result');
});

test('empty and missing distributions stay distinct from zero-session participants', () => {
  const empty = sessionDistribution([]);
  assert.equal(empty.participants, 0); assert.equal(empty.median, null); assert.equal(empty.q1, null); assert.equal(empty.q3, null); assert.equal(empty.mean, null);
  assert.ok(empty.bins.every(b => b.count === 0));
  for (const value of [null, undefined, {}, [0], [null], [1, undefined], [-1], [1.5], ['2'], [Infinity]]) assert.equal(sessionDistribution(value), null);
  const one = sessionDistribution([2]); assert.equal(one.median, 2); assert.equal(one.q1, 2); assert.equal(one.q3, 2); assert.equal(one.mean, 2);
});
