import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  const envBackup: Record<string, string | undefined> = {};

  const VARS = [
    'MEMORYD_SIDECAR_PATH',
    'MEMORYD_EMBEDDING_PROVIDER',
    'MEMORYD_EMBEDDING_MODEL',
    'MEMORYD_EMBEDDING_URL',
    'MEMORYD_EMBEDDING_DIMENSIONS',
    'OPENAI_API_KEY',
    'MEMORYD_HOST',
    'MEMORYD_PORT',
  ] as const;

  beforeEach(() => {
    for (const key of VARS) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of VARS) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('returns defaults when no env vars are set', () => {
    const config = resolveConfig();
    expect(config.sidecarPath).toContain('.memoryd');
    expect(config.sidecarPath).toEndWith('index.db');
    expect(config.embedding.provider).toBe('noop');
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(3200);
  });

  it('reads sidecar path from env', () => {
    process.env.MEMORYD_SIDECAR_PATH = '/tmp/test.db';
    const config = resolveConfig();
    expect(config.sidecarPath).toBe('/tmp/test.db');
  });

  it('reads embedding provider from env', () => {
    process.env.MEMORYD_EMBEDDING_PROVIDER = 'ollama';
    process.env.MEMORYD_EMBEDDING_MODEL = 'nomic-embed-text';
    process.env.MEMORYD_EMBEDDING_URL = 'http://gpu:11434';
    const config = resolveConfig();
    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.model).toBe('nomic-embed-text');
    expect(config.embedding.endpoint).toBe('http://gpu:11434');
  });

  it('reads OpenAI API key from env', () => {
    process.env.MEMORYD_EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    const config = resolveConfig();
    expect(config.embedding.provider).toBe('openai');
    expect(config.embedding.apiKey).toBe('sk-test-123');
  });

  it('reads embedding dimensions from env', () => {
    process.env.MEMORYD_EMBEDDING_DIMENSIONS = '384';
    const config = resolveConfig();
    expect(config.embedding.dimensions).toBe(384);
  });

  it('reads host and port from env', () => {
    process.env.MEMORYD_HOST = '0.0.0.0';
    process.env.MEMORYD_PORT = '8080';
    const config = resolveConfig();
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8080);
  });

  it('overrides take precedence over env vars', () => {
    process.env.MEMORYD_SIDECAR_PATH = '/tmp/env.db';
    process.env.MEMORYD_PORT = '9999';
    const config = resolveConfig({
      sidecarPath : '/tmp/override.db',
      port        : 4000,
    });
    expect(config.sidecarPath).toBe('/tmp/override.db');
    expect(config.port).toBe(4000);
  });

  it('partial overrides leave other fields from env', () => {
    process.env.MEMORYD_HOST = '0.0.0.0';
    const config = resolveConfig({ port: 5000 });
    expect(config.port).toBe(5000);
    expect(config.host).toBe('0.0.0.0');
  });
});
