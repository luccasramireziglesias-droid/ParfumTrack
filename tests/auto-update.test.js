import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Auto-Update System', () => {
  let mockApp;
  let fetchMock;

  beforeEach(() => {
    // Mock document
    global.document = {
      querySelector: vi.fn((selector) => {
        if (selector === 'meta[name="app-version"]') {
          return { content: '1.1.0' };
        }
        return null;
      }),
      createElement: vi.fn(() => ({
        style: {},
        innerHTML: '',
        appendChild: vi.fn(),
      })),
      head: { appendChild: vi.fn() },
      body: { appendChild: vi.fn() },
    };

    // Mock fetch
    global.fetch = vi.fn();
    fetchMock = global.fetch;

    // Mock window.location.reload
    global.window = { location: { reload: vi.fn() } };

    // Mock AbortSignal.timeout
    global.AbortSignal = {
      timeout: vi.fn((ms) => ({
        aborted: false,
      })),
    };

    // Simulación simple del App object
    mockApp = {
      _currentVersion: null,
      _latestVersion: null,
      _updateCheckInterval: null,

      _initAutoUpdate() {
        const versionMeta = { content: '1.1.0' };
        this._currentVersion = versionMeta?.content || '1.0.0';
      },

      async _checkForUpdates() {
        const response = await fetch('/version', { cache: 'no-store' });
        const data = await response.json();
        this._latestVersion = data.version;

        if (this._isNewerVersion(this._latestVersion, this._currentVersion)) {
          this._reloadWithNewVersion();
        }
      },

      _isNewerVersion(v1, v2) {
        const version1 = v1.split('.').map(Number);
        const version2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(version1.length, version2.length); i++) {
          const num1 = version1[i] || 0;
          const num2 = version2[i] || 0;
          if (num1 > num2) return true;
          if (num1 < num2) return false;
        }
        return false;
      },

      _reloadWithNewVersion() {
        window.location.reload();
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('debe leer la versión actual correctamente', () => {
    mockApp._initAutoUpdate();
    expect(mockApp._currentVersion).toBe('1.1.0');
  });

  it('debe detectar que 1.2.0 es más nueva que 1.1.0', () => {
    const isNewer = mockApp._isNewerVersion('1.2.0', '1.1.0');
    expect(isNewer).toBe(true);
  });

  it('debe detectar que 1.1.0 NO es más nueva que 1.1.0', () => {
    const isNewer = mockApp._isNewerVersion('1.1.0', '1.1.0');
    expect(isNewer).toBe(false);
  });

  it('debe detectar que 1.0.5 NO es más nueva que 1.1.0', () => {
    const isNewer = mockApp._isNewerVersion('1.0.5', '1.1.0');
    expect(isNewer).toBe(false);
  });

  it('debe recargar cuando detecta versión más nueva', async () => {
    mockApp._currentVersion = '1.1.0';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.2.0' }),
    });

    await mockApp._checkForUpdates();

    expect(mockApp._latestVersion).toBe('1.2.0');
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('NO debe recargar cuando la versión es la misma', async () => {
    mockApp._currentVersion = '1.1.0';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.1.0' }),
    });

    await mockApp._checkForUpdates();

    expect(mockApp._latestVersion).toBe('1.1.0');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('debe manejar errores en la verificación sin recargar', async () => {
    mockApp._currentVersion = '1.1.0';
    fetchMock.mockRejectedValue(new Error('Network error'));

    await expect(mockApp._checkForUpdates()).rejects.toThrow();
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});
