// ---------------------------------------------------------------------------
// Embedding provider abstraction — pluggable backends for vector embeddings.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

// ---------------------------------------------------------------------------
// NoopProvider — zero vectors for testing / FTS-only mode
// ---------------------------------------------------------------------------

export class NoopProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions: number = 768) {
    this.dimensions = dimensions;
  }

  async embed(_text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0));
  }
}

// ---------------------------------------------------------------------------
// OllamaProvider — calls the Ollama REST API for embeddings
// ---------------------------------------------------------------------------

export class OllamaProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(opts?: {
    model?: string;
    dimensions?: number;
    endpoint?: string;
  }) {
    this.model = opts?.model ?? 'nomic-embed-text';
    this.dimensions = opts?.dimensions ?? 768;
    this.endpoint = opts?.endpoint ?? 'http://localhost:11434';
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.endpoint}/api/embed`, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { embeddings: number[][] };
    return result.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.endpoint}/api/embed`, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      throw new Error(`Ollama batch embedding failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { embeddings: number[][] };
    return result.embeddings;
  }
}

// ---------------------------------------------------------------------------
// OpenAIProvider — calls the OpenAI embeddings API
// ---------------------------------------------------------------------------

export class OpenAIProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(opts: {
    apiKey: string;
    model?: string;
    dimensions?: number;
    endpoint?: string;
  }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'text-embedding-3-small';
    this.dimensions = opts.dimensions ?? 1536;
    this.endpoint = opts.endpoint ?? 'https://api.openai.com';
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.callApi([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.callApi(texts);
  }

  private async callApi(input: string[]): Promise<number[][]> {
    const response = await fetch(`${this.endpoint}/v1/embeddings`, {
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Authorization' : `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model      : this.model,
        input,
        dimensions : this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    return result.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type EmbeddingConfig = {
  provider : 'ollama' | 'openai' | 'noop';
  model? : string;
  dimensions? : number;
  endpoint? : string;
  apiKey? : string;
};

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'noop':
      return new NoopProvider(config.dimensions);
    case 'ollama':
      return new OllamaProvider({
        model      : config.model,
        dimensions : config.dimensions,
        endpoint   : config.endpoint,
      });
    case 'openai':
      if (!config.apiKey) {
        throw new Error('OpenAI embedding provider requires an API key');
      }
      return new OpenAIProvider({
        apiKey     : config.apiKey,
        model      : config.model,
        dimensions : config.dimensions,
        endpoint   : config.endpoint,
      });
    default:
      throw new Error(`Unknown embedding provider: ${(config as EmbeddingConfig).provider}`);
  }
}
