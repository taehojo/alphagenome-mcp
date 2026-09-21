// src/tests/config.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BRIDGE_TIMEOUT_MS,
  getBridgeTimeoutMs,
  getPythonCandidates,
} from '../utils/config.js';

test('the timeout defaults when the variable is unset or blank', () => {
  assert.equal(getBridgeTimeoutMs({}), DEFAULT_BRIDGE_TIMEOUT_MS);
  assert.equal(getBridgeTimeoutMs({ ALPHAGENOME_TIMEOUT_MS: '  ' }), DEFAULT_BRIDGE_TIMEOUT_MS);
});

test('a positive integer overrides the timeout', () => {
  assert.equal(getBridgeTimeoutMs({ ALPHAGENOME_TIMEOUT_MS: '60000' }), 60000);
});

test('a typo cannot disable the timeout', () => {
  for (const bad of ['0', '-5', '1.5', 'abc', 'Infinity']) {
    assert.equal(getBridgeTimeoutMs({ ALPHAGENOME_TIMEOUT_MS: bad }), DEFAULT_BRIDGE_TIMEOUT_MS);
  }
});

test('python3 is tried before python by default', () => {
  assert.deepEqual(getPythonCandidates({}), ['python3', 'python']);
  assert.deepEqual(getPythonCandidates({ ALPHAGENOME_PYTHON: '' }), ['python3', 'python']);
});

test('ALPHAGENOME_PYTHON pins a single interpreter', () => {
  assert.deepEqual(getPythonCandidates({ ALPHAGENOME_PYTHON: ' C:\\venv\\python.exe ' }), [
    'C:\\venv\\python.exe',
  ]);
});
