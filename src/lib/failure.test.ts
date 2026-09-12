import { describe, expect, it } from 'vitest';
import { classifyError, failureReason, statedFailure, userFacingReason } from './failure';

// The errors below are shaped like the real ones: the SDK and driver
// classes are imported lazily at their call sites, so classification is by
// shape and these fixtures are the contract.

function named<T extends object>(name: string, extra: T): Error & T {
  const err = Object.assign(new Error('internal detail nobody should read'), extra);
  err.name = name;
  return err as Error & T;
}

describe('classifyError', () => {
  it('names an Anthropic SDK error a model failure', () => {
    expect(classifyError(named('RateLimitError', { status: 429 }))).toBe('model');
    expect(classifyError(named('APIConnectionError', {}))).toBe('model');
    expect(classifyError(new Error('ANTHROPIC_API_KEY is not configured'))).toBe('model');
  });

  it('names a driver error a database failure', () => {
    expect(classifyError(named('LibsqlError', { code: 'URL_INVALID' }))).toBe('database');
    // node-postgres attaches the server's SQLSTATE and severity.
    expect(classifyError(named('error', { code: '28P01', severity: 'FATAL' }))).toBe('database');
  });

  it('names an abort or a timeout a timeout', () => {
    expect(classifyError(named('AbortError', {}))).toBe('timeout');
    expect(classifyError(new Error('request timed out after 90000ms'))).toBe('timeout');
  });

  it('names a failed fetch an upstream failure', () => {
    const err = new TypeError('fetch failed');
    expect(classifyError(err)).toBe('upstream');
    expect(classifyError(named('Error', { cause: { code: 'ECONNREFUSED' } }))).toBe('upstream');
  });

  it('names everything else unknown, including non-errors', () => {
    expect(classifyError(new Error('something odd'))).toBe('unknown');
    expect(classifyError('a string')).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
  });

  it('prefers the model over the transport, so an SDK timeout still reads as the model', () => {
    expect(classifyError(named('APIConnectionTimeoutError', {}))).toBe('model');
  });
});

describe('userFacingReason', () => {
  it('is a fixed string per kind, carrying no detail from the error', () => {
    const reasons = (['model', 'database', 'upstream', 'timeout', 'unknown'] as const).map(
      userFacingReason,
    );
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) {
      expect(reason).toMatch(/^[a-z][a-z ]+$/);
    }
  });

  it('a stated failure carries its own message through failureReason', () => {
    // Model output that fails our own schema is named, not generalized: a
    // fixed reason would erase what the stage actually learned (SPEC 24).
    const err = statedFailure('vision output failed validation: severity is required');
    expect(failureReason(err)).toBe('vision output failed validation: severity is required');
    expect(failureReason(err)).not.toBe(userFacingReason('model'));
  });

  it('an SDK error is never a stated failure', () => {
    const sdk = Object.assign(
      new Error('429 rate_limit_error request_id=req_011CQ key sk-ant-api03-XYZ'),
      { name: 'RateLimitError', status: 429 },
    );
    expect(failureReason(sdk)).toBe(userFacingReason('model'));
    expect(failureReason(sdk)).not.toContain('sk-ant');
    // Nor is anything else that merely looks like one.
    expect(failureReason(new Error('vision output failed validation'))).toBe(
      userFacingReason('unknown'),
    );
  });

  it('failureReason is the classification and the wording in one call', () => {
    expect(failureReason(named('RateLimitError', { status: 429 }))).toBe(userFacingReason('model'));
    expect(failureReason('anything')).toBe(userFacingReason('unknown'));
  });
});
