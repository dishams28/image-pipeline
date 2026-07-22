const test = require('node:test');
const assert = require('node:assert');

const { PLATE_REGEX } = require('../src/services/analysis/ocrPlate');
const { hammingDistanceHex } = require('../src/utils/hash');
const { computeOverallScore } = require('../src/services/scoring.service');

test('PLATE_REGEX accepts valid Indian plate formats', () => {
  assert.ok(PLATE_REGEX.test('KA05MH1234'));
  assert.ok(PLATE_REGEX.test('MH12AB1234'));
  assert.ok(PLATE_REGEX.test('DL3CAB1234'));
});

test('PLATE_REGEX rejects malformed plates', () => {
  assert.ok(!PLATE_REGEX.test('ABCDEF'));
  assert.ok(!PLATE_REGEX.test('123456789'));
  assert.ok(!PLATE_REGEX.test('KA05MH12')); // missing digits
});

test('hammingDistanceHex returns 0 for identical hashes', () => {
  assert.strictEqual(hammingDistanceHex('abcd1234', 'abcd1234'), 0);
});

test('hammingDistanceHex counts differing bits correctly', () => {
  // 0x0 = 0000, 0xF = 1111 -> 4 bits differ
  assert.strictEqual(hammingDistanceHex('0', 'f'), 4);
});

test('hammingDistanceHex throws on mismatched lengths', () => {
  assert.throws(() => hammingDistanceHex('ab', 'abcd'));
});

test('computeOverallScore returns 0 risk when all checks pass', () => {
  const results = [
    { checkName: 'blur', passed: true, severity: 'info' },
    { checkName: 'brightness', passed: true, severity: 'info' },
  ];
  const { overallIssueCount, overallRiskScore } = computeOverallScore(results);
  assert.strictEqual(overallIssueCount, 0);
  assert.strictEqual(overallRiskScore, 0);
});

test('computeOverallScore weights critical failures higher than warnings', () => {
  const warningOnly = computeOverallScore([{ checkName: 'a', passed: false, severity: 'warning' }]);
  const criticalOnly = computeOverallScore([{ checkName: 'a', passed: false, severity: 'critical' }]);
  assert.ok(criticalOnly.overallRiskScore > warningOnly.overallRiskScore);
});

test('computeOverallScore caps risk score at 1', () => {
  const results = Array.from({ length: 10 }, (_, i) => ({
    checkName: `c${i}`, passed: false, severity: 'critical',
  }));
  const { overallRiskScore } = computeOverallScore(results);
  assert.strictEqual(overallRiskScore, 1);
});
