import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  createEmbeddingProvider,
  NoopProvider,
  OllamaProvider,
  OpenAIProvider,
} from '../../src/sidecar/embeddings.js';

// ---------------------------------------------------------------------------
// Save / restore the real fetch so mocked tests don't leak
// ---------------------------------------------------------------------------

let realFetch: typeof globalThis.fetch;

beforeAll(() => {
  realFetch = globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// NoopProvider
// ---------------------------------------------------------------------------

describe('NoopProvider', () => {
  it('embed returns a zero vector of correct dimensions', async () => {
    const provider = new NoopProvider(4);
    const vec = await provider.embed('hello');
    expect(vec).toEqual([0, 0, 0, 0]);
  });

  it('embed returns default 768 dimensions', async () => {
    const provider = new NoopProvider();
    const vec = await provider.embed('hello');
    expect(vec.length).toBe(768);
    expect(vec.every(v => v === 0)).toBe(true);
  });

  it('embed returns custom dimensions when configured', async () => {
    const provider = new NoopProvider(256);
    expect(provider.dimensions).toBe(256);
    const vec = await provider.embed('test');
    expect(vec.length).toBe(256);
  });

  it('embedBatch returns correct number of vectors', async () => {
    const provider = new NoopProvider(4);
    const vecs = await provider.embedBatch(['a', 'b', 'c']);
    expect(vecs.length).toBe(3);
  });

  it('embedBatch each vector has correct dimensions', async () => {
    const provider = new NoopProvider(4);
    const vecs = await provider.embedBatch(['a', 'b']);
    for (const vec of vecs) {
      expect(vec.length).toBe(4);
      expect(vec).toEqual([0, 0, 0, 0]);
    }
  });
});

// ---------------------------------------------------------------------------
// OllamaProvider (mocked HTTP)
// ---------------------------------------------------------------------------

describe('OllamaProvider', () => {
  beforeEach(() => {
    globalThis.fetch = realFetch;
  });

  it('embed calls correct endpoint with correct body', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OllamaProvider();
    await provider.embed('hello world');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/embed');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.model).toBe('nomic-embed-text');
    expect(body.input).toBe('hello world');
  });

  it('embed returns the embedding from the response', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OllamaProvider({ dimensions: 3 });
    const vec = await provider.embed('test');
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });

  it('embed throws on non-OK response', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      'Internal Server Error',
      { status: 500, statusText: 'Internal Server Error' },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OllamaProvider();
    await expect(provider.embed('test')).rejects.toThrow('Ollama embedding failed: 500 Internal Server Error');
  });

  it('embedBatch sends all texts in one request', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ embeddings: [[0.1], [0.2], [0.3]] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OllamaProvider({ dimensions: 1 });
    await provider.embedBatch(['a', 'b', 'c']);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.input).toEqual(['a', 'b', 'c']);
  });

  it('embedBatch returns all embeddings', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OllamaProvider({ dimensions: 2 });
    const vecs = await provider.embedBatch(['a', 'b']);
    expect(vecs).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('uses default model/endpoint when not configured', () => {
    const provider = new OllamaProvider();
    expect(provider.dimensions).toBe(768);
    // model and endpoint are private, so we verify via the fetch call
  });

  it('uses custom model/endpoint when configured', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ embeddings: [[1.0]] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OllamaProvider({
      model      : 'custom-model',
      dimensions : 1,
      endpoint   : 'http://my-ollama:9999',
    });
    await provider.embed('test');

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://my-ollama:9999/api/embed');
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.model).toBe('custom-model');
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider (mocked HTTP)
// ---------------------------------------------------------------------------

describe('OpenAIProvider', () => {
  beforeEach(() => {
    globalThis.fetch = realFetch;
  });

  it('embed calls correct endpoint with correct headers', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ data: [{ embedding: [0.1, 0.2], index: 0 }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: 'sk-test', dimensions: 2 });
    await provider.embed('hello');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(opts.method).toBe('POST');

    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('embed returns the embedding from the response', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ data: [{ embedding: [0.5, 0.6, 0.7], index: 0 }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: 'sk-test', dimensions: 3 });
    const vec = await provider.embed('test');
    expect(vec).toEqual([0.5, 0.6, 0.7]);
  });

  it('embed throws on non-OK response', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      'Unauthorized',
      { status: 401, statusText: 'Unauthorized' },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: 'bad-key' });
    await expect(provider.embed('test')).rejects.toThrow('OpenAI embedding failed: 401 Unauthorized');
  });

  it('embedBatch sends all texts in one request', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({
        data: [
          { embedding: [0.1], index: 0 },
          { embedding: [0.2], index: 1 },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: 'sk-test', dimensions: 1 });
    await provider.embedBatch(['a', 'b']);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.input).toEqual(['a', 'b']);
  });

  it('embedBatch returns embeddings sorted by index', async () => {
    // Return out of order to verify sorting
    const mockFetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({
        data: [
          { embedding: [0.3], index: 2 },
          { embedding: [0.1], index: 0 },
          { embedding: [0.2], index: 1 },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    globalThis.fetch = mockFetch as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: 'sk-test', dimensions: 1 });
    const vecs = await provider.embedBatch(['a', 'b', 'c']);
    expect(vecs).toEqual([[0.1], [0.2], [0.3]]);
  });
});

// ---------------------------------------------------------------------------
// Factory — createEmbeddingProvider
// ---------------------------------------------------------------------------

describe('createEmbeddingProvider', () => {
  it('creates NoopProvider', () => {
    const provider = createEmbeddingProvider({ provider: 'noop', dimensions: 32 });
    expect(provider).toBeInstanceOf(NoopProvider);
    expect(provider.dimensions).toBe(32);
  });

  it('creates OllamaProvider', () => {
    const provider = createEmbeddingProvider({ provider: 'ollama' });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.dimensions).toBe(768);
  });

  it('creates OpenAIProvider', () => {
    const provider = createEmbeddingProvider({ provider: 'openai', apiKey: 'sk-test' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.dimensions).toBe(1536);
  });

  it('throws for OpenAI without API key', () => {
    expect(() => createEmbeddingProvider({ provider: 'openai' })).toThrow(
      'OpenAI embedding provider requires an API key',
    );
  });

  it('throws for unknown provider', () => {
    expect(() => createEmbeddingProvider({ provider: 'unknown' as 'noop' })).toThrow(
      'Unknown embedding provider: unknown',
    );
  });
});
