import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
const { attendanceAnswer } = await tsImport('../src/attendance-questions.ts', import.meta.url);
const group = (label, unique, registered = 20) => ({ label, unique, registered, rate: unique / registered * 100, suppressed: false });
const report = (groups, extra = {}) => ({ dimension: 'block', registryComplete: true, ratesAvailable: true, comparisonSuppressed: false, minimum: 0, groups, ...extra });

test('Q&A requires a complete denominator and never treats suppressed or small groups as zero', () => {
  assert.match(attendanceAnswer(report([], { registryComplete: false })).answer, /complete client registry/);
  assert.match(attendanceAnswer(report([], { ratesAvailable: false })).answer, /attendance history/);
  assert.equal(attendanceAnswer(report([group('101', 5), { label: '102', suppressed: true }], { comparisonSuppressed: true })).rows.length, 0);
  const answer = attendanceAnswer(report([group('101', 0), group('102', 10), group('Tiny', 0, 1), group('Missing', 0), { label: 'Hidden', suppressed: true }]));
  assert.equal(answer.rows.length, 2);
  assert.match(answer.answer, /101.*0%.*0 of 20/);
  assert.match(answer.note, /3 group\(s\) excluded/);
});

test('CFS compares ordered endpoints without inventing a decreasing trend or ordering custom mappings', () => {
  const answer = attendanceAnswer(report([group('CFS 5', 18), group('CFS 7 to 8', 4), group('CFS 1 to 3', 10), group('Custom approved label', 0)], { dimension: 'cfs' }));
  assert.match(answer.answer, /20%.*50%.*30 percentage points lower/);
  assert.match(answer.answer, /does not establish a trend or cause/);
  assert.deepEqual(answer.rows.map(g => g.label), ['CFS 1 to 3', 'CFS 5', 'CFS 7 to 8']);
  assert.match(attendanceAnswer(report([group('CFS 4', 10)], { dimension: 'cfs' })).answer, /Not enough comparable groups/);
});

test('equal rates, no attendance and unordered risk codes produce descriptive answers', () => {
  assert.match(attendanceAnswer(report([group('101', 0), group('102', 0)])).answer, /same recorded participation rate \(0%\)/);
  const answer = attendanceAnswer(report([group('>1', 16), group('0', 4)], { dimension: 'risk' }));
  assert.match(answer.answer, /^0 has the lowest/);
  assert.equal(answer.rows[0].registered, 20);
  assert.doesNotMatch(answer.answer, /higher risk|lower risk/);
});
