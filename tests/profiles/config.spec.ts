import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  configPath,
  enboxHome,
  listProfiles,
  profileDataPath,
  profilesDir,
  readConfig,
  removeProfile,
  resolveProfile,
  upsertProfile,
  writeConfig,
} from '../../src/profiles/config.js';

// ---------------------------------------------------------------------------
// Test setup — use a temp directory as ENBOX_HOME
// ---------------------------------------------------------------------------

const TEST_HOME = join(tmpdir(), `memoryd-config-test-${Date.now()}`);
let savedEnboxHome: string | undefined;
let savedEnboxProfile: string | undefined;

beforeAll(() => {
  savedEnboxHome = process.env.ENBOX_HOME;
  savedEnboxProfile = process.env.ENBOX_PROFILE;
  process.env.ENBOX_HOME = TEST_HOME;
  delete process.env.ENBOX_PROFILE;
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  if (savedEnboxHome !== undefined) {
    process.env.ENBOX_HOME = savedEnboxHome;
  } else {
    delete process.env.ENBOX_HOME;
  }
  if (savedEnboxProfile !== undefined) {
    process.env.ENBOX_PROFILE = savedEnboxProfile;
  } else {
    delete process.env.ENBOX_PROFILE;
  }
  rmSync(TEST_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  // Clean config between tests.
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
  delete process.env.ENBOX_PROFILE;
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe('path helpers', () => {
  it('enboxHome returns ENBOX_HOME env value', () => {
    expect(enboxHome()).toBe(TEST_HOME);
  });

  it('configPath is config.json under enboxHome', () => {
    expect(configPath()).toBe(join(TEST_HOME, 'config.json'));
  });

  it('profilesDir is profiles/ under enboxHome', () => {
    expect(profilesDir()).toBe(join(TEST_HOME, 'profiles'));
  });

  it('profileDataPath returns correct nested path', () => {
    expect(profileDataPath('alice')).toBe(join(TEST_HOME, 'profiles', 'alice', 'DATA', 'AGENT'));
  });
});

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

describe('readConfig / writeConfig', () => {
  it('readConfig returns default when no config file exists', () => {
    const config = readConfig();
    expect(config.version).toBe(1);
    expect(config.defaultProfile).toBe('');
    expect(config.profiles).toEqual({});
  });

  it('writeConfig + readConfig round-trips', () => {
    const config = {
      version        : 1,
      defaultProfile : 'test',
      profiles       : {
        test: { name: 'test', did: 'did:dht:abc', createdAt: '2025-01-01T00:00:00Z' },
      },
    };
    writeConfig(config);
    const loaded = readConfig();
    expect(loaded).toEqual(config);
  });
});

// ---------------------------------------------------------------------------
// upsertProfile / removeProfile / listProfiles
// ---------------------------------------------------------------------------

describe('upsertProfile', () => {
  it('adds a profile and sets as default if first', () => {
    upsertProfile('alice', { name: 'alice', did: 'did:dht:alice', createdAt: '2025-01-01T00:00:00Z' });
    const config = readConfig();
    expect(config.profiles['alice']).toBeDefined();
    expect(config.defaultProfile).toBe('alice');
  });

  it('second profile does not change default', () => {
    upsertProfile('alice', { name: 'alice', did: 'did:dht:alice', createdAt: '2025-01-01T00:00:00Z' });
    upsertProfile('bob', { name: 'bob', did: 'did:dht:bob', createdAt: '2025-01-02T00:00:00Z' });
    const config = readConfig();
    expect(config.profiles['bob']).toBeDefined();
    expect(config.defaultProfile).toBe('alice');
  });
});

describe('removeProfile', () => {
  it('removes profile and reassigns default', () => {
    upsertProfile('alice', { name: 'alice', did: 'did:dht:alice', createdAt: '2025-01-01T00:00:00Z' });
    upsertProfile('bob', { name: 'bob', did: 'did:dht:bob', createdAt: '2025-01-02T00:00:00Z' });
    removeProfile('alice');
    const config = readConfig();
    expect(config.profiles['alice']).toBeUndefined();
    expect(config.defaultProfile).toBe('bob');
  });

  it('clears default when last profile is removed', () => {
    upsertProfile('only', { name: 'only', did: 'did:dht:only', createdAt: '2025-01-01T00:00:00Z' });
    removeProfile('only');
    const config = readConfig();
    expect(config.defaultProfile).toBe('');
  });
});

describe('listProfiles', () => {
  it('returns profile names', () => {
    upsertProfile('alice', { name: 'alice', did: 'did:dht:alice', createdAt: '2025-01-01T00:00:00Z' });
    upsertProfile('bob', { name: 'bob', did: 'did:dht:bob', createdAt: '2025-01-02T00:00:00Z' });
    const names = listProfiles();
    expect(names).toContain('alice');
    expect(names).toContain('bob');
    expect(names.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe('resolveProfile', () => {
  it('returns explicit flag value when provided', () => {
    expect(resolveProfile('explicit')).toBe('explicit');
  });

  it('returns ENBOX_PROFILE env var when set', () => {
    process.env.ENBOX_PROFILE = 'env-profile';
    expect(resolveProfile()).toBe('env-profile');
    delete process.env.ENBOX_PROFILE;
  });

  it('returns default profile from config', () => {
    upsertProfile('default-one', { name: 'default-one', did: 'did:dht:d1', createdAt: '2025-01-01T00:00:00Z' });
    upsertProfile('other', { name: 'other', did: 'did:dht:other', createdAt: '2025-01-02T00:00:00Z' });
    expect(resolveProfile()).toBe('default-one');
  });

  it('returns single profile when exactly one exists', () => {
    // Write config with no default but one profile.
    writeConfig({
      version        : 1,
      defaultProfile : '',
      profiles       : {
        lonely: { name: 'lonely', did: 'did:dht:lonely', createdAt: '2025-01-01T00:00:00Z' },
      },
    });
    expect(resolveProfile()).toBe('lonely');
  });

  it('returns null when no profiles exist', () => {
    expect(resolveProfile()).toBeNull();
  });
});
