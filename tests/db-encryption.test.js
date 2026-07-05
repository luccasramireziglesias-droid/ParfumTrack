// Test DB Encryption Integration (BLK-01)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Mock IndexedDB
class MockIndexedDB {
  constructor() {
    this.stores = {};
  }

  open() {
    return {
      createObjectStore: (name) => {
        this.stores[name] = new Map();
      }
    };
  }
}

// Simplified mock for testing
class MockDB {
  constructor() {
    this.data = {};
    this._encryptedStores = new Set(['perfumes', 'ventas', 'cuotas', 'pedidos', 'gastos', 'caja']);
  }

  _shouldEncrypt(store) {
    return this._encryptedStores.has(store) && this.licenseCode;
  }

  async _encryptBeforeStore(store, data) {
    if (!this._shouldEncrypt(store)) return data;
    try {
      const encrypted = await this.ENCRYPTION.encryptDataWithVersion(data, 1, this.licenseCode);
      return { _encrypted: encrypted, _v: 1 };
    } catch (e) {
      console.warn('Encryption failed, storing plaintext:', e.message);
      return data;
    }
  }

  async _decryptAfterRetrieve(store, data) {
    if (!this._shouldEncrypt(store) || !data) return data;
    if (Array.isArray(data)) {
      return Promise.all(data.map(item => this._decryptAfterRetrieve(store, item)));
    }
    if (data._encrypted && data._v) {
      try {
        return await this.ENCRYPTION.decryptDataWithVersion(data._encrypted, 1, this.licenseCode);
      } catch (e) {
        console.warn('Decryption failed, returning as-is:', e.message);
        return data;
      }
    }
    return data;
  }

  async put(store, data) {
    const encrypted = await this._encryptBeforeStore(store, data);
    if (!this.data[store]) this.data[store] = new Map();
    this.data[store].set(data.id || 'default', encrypted);
    return data.id || 'default';
  }

  async get(store, id) {
    if (!this.data[store]) return null;
    const data = this.data[store].get(id);
    return this._decryptAfterRetrieve(store, data);
  }

  async getAll(store) {
    if (!this.data[store]) return [];
    const items = Array.from(this.data[store].values());
    return this._decryptAfterRetrieve(store, items);
  }

  // Minimal ENCRYPTION mock
  ENCRYPTION = {
    async encryptDataWithVersion(data, version = 1, licenseCode) {
      const dataStr = JSON.stringify(data);
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        Buffer.from(licenseCode + 'salt'),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: Buffer.from('test-salt'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        256
      );

      const key = await crypto.subtle.importKey(
        'raw',
        derivedBits,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const dataBuffer = new TextEncoder().encode(dataStr);

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        dataBuffer
      );

      const result = new Uint8Array(2 + 12 + encrypted.byteLength);
      const view = new DataView(result.buffer);
      view.setUint16(0, version);
      result.set(iv, 2);
      result.set(new Uint8Array(encrypted), 2 + 12);

      return Buffer.from(result).toString('base64');
    },

    async decryptDataWithVersion(encrypted, version = 1, licenseCode) {
      const data = Buffer.from(encrypted, 'base64');
      const view = new DataView(data.buffer);

      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        Buffer.from(licenseCode + 'salt'),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: Buffer.from('test-salt'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        256
      );

      const key = await crypto.subtle.importKey(
        'raw',
        derivedBits,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      const iv = data.slice(2, 2 + 12);
      const encryptedData = data.slice(2 + 12);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedData
      );

      return JSON.parse(new TextDecoder().decode(decrypted));
    }
  };
}

describe('DB Encryption Integration (BLK-01)', () => {
  let db;

  beforeEach(() => {
    db = new MockDB();
    db.licenseCode = 'PT-TEST-LICENSE-CODE';
  });

  it('encrypts sensitive store (perfumes) when license available', async () => {
    const perfume = { id: 1, nombre: 'Haramain Gold', precioCompra: 2700, precioVenta: 3900, stock: 8 };

    await db.put('perfumes', perfume);

    const stored = db.data.perfumes.get(1);
    expect(stored._encrypted).toBeTruthy();
    expect(stored._v).toBe(1);
    expect(stored._encrypted).not.toContain('Haramain');
    expect(stored._encrypted).not.toContain('2700');
    console.log('✅ Perfume encrypted before storage');
  });

  it('decrypts sensitive store (perfumes) when retrieved', async () => {
    const original = { id: 1, nombre: 'Yara EDT', precioCompra: 3200, precioVenta: 4400, stock: 3 };

    await db.put('perfumes', original);
    const retrieved = await db.get('perfumes', 1);

    expect(retrieved).toEqual(original);
    expect(retrieved.nombre).toBe('Yara EDT');
    expect(retrieved.precioCompra).toBe(3200);
    console.log('✅ Perfume decrypted correctly');
  });

  it('encrypts ventas (sales records)', async () => {
    const venta = {
      id: 1,
      perfume: 'Haramain Gold',
      cliente: 'Juan Pérez',
      precioVenta: 3900,
      precioCompra: 2700,
      fecha: Date.now()
    };

    await db.put('ventas', venta);
    const stored = db.data.ventas.get(1);

    expect(stored._encrypted).toBeTruthy();
    expect(stored._encrypted).not.toContain('Juan Pérez');
    expect(stored._encrypted).not.toContain('3900');
    console.log('✅ Venta encrypted');
  });

  it('encrypts cuotas (payment plans)', async () => {
    const cuota = {
      id: 1,
      ventaId: 1,
      numero: 1,
      total: 2,
      monto: 1950,
      montoTotal: 3900,
      pagado: false,
      vence: Date.now() + 30 * 24 * 60 * 60 * 1000
    };

    await db.put('cuotas', cuota);
    const stored = db.data.cuotas.get(1);

    expect(stored._encrypted).toBeTruthy();
    expect(stored._encrypted).not.toContain('1950');
    console.log('✅ Cuota encrypted');
  });

  it('encrypts gastos (expenses)', async () => {
    const gasto = {
      id: 1,
      descripcion: 'Transporte a proveedor',
      categoria: 'transporte',
      monto: 500,
      fecha: Date.now()
    };

    await db.put('gastos', gasto);
    const stored = db.data.gastos.get(1);

    expect(stored._encrypted).toBeTruthy();
    expect(stored._encrypted).not.toContain('Transporte');
    expect(stored._encrypted).not.toContain('500');
    console.log('✅ Gasto encrypted');
  });

  it('does NOT encrypt config store', async () => {
    const config = { id: 'theme', key: 'theme', value: 'dark' };

    await db.put('config', config);
    const stored = db.data.config.get('theme');

    expect(stored).toEqual(config);
    expect(stored._encrypted).toBeUndefined();
    console.log('✅ Config stored plaintext (not encrypted)');
  });

  it('falls back to plaintext when license unavailable', async () => {
    db.licenseCode = null;

    const perfume = { id: 1, nombre: 'Haramain Gold', precioCompra: 2700, precioVenta: 3900, stock: 8 };
    await db.put('perfumes', perfume);

    const stored = db.data.perfumes.get(1);
    expect(stored._encrypted).toBeUndefined();
    expect(stored.nombre).toBe('Haramain Gold');
    console.log('✅ Falls back to plaintext when license unavailable');
  });

  it('handles getAll() with multiple encrypted records', async () => {
    const perfumes = [
      { id: 1, nombre: 'Haramain Gold', precioCompra: 2700, precioVenta: 3900, stock: 8 },
      { id: 2, nombre: 'Yara EDT', precioCompra: 3200, precioVenta: 4400, stock: 3 },
      { id: 3, nombre: 'Bharara King', precioCompra: 2700, precioVenta: 3900, stock: 2 }
    ];

    for (const p of perfumes) {
      await db.put('perfumes', p);
    }

    const retrieved = await db.getAll('perfumes');

    expect(retrieved).toHaveLength(3);
    expect(retrieved[0].nombre).toBe('Haramain Gold');
    expect(retrieved[1].nombre).toBe('Yara EDT');
    expect(retrieved[2].nombre).toBe('Bharara King');
    console.log('✅ getAll() decrypts multiple records correctly');
  });

  it('preserves data integrity after encrypt/decrypt cycle', async () => {
    const original = {
      id: 1,
      nombre: 'Test Perfume',
      precioCompra: 2500,
      precioVenta: 3600,
      stock: 5,
      foto: 'data:image/png;base64,iVBORw0KG...',
      creado: Date.now(),
      extras: { rating: 4.5, notas: 'Fragancia floral' }
    };

    await db.put('perfumes', original);
    const retrieved = await db.get('perfumes', 1);

    expect(retrieved).toEqual(original);
    expect(retrieved.extras.rating).toBe(4.5);
    console.log('✅ Data integrity preserved through encryption cycle');
  });

  it('handles encryption errors gracefully', async () => {
    const badDB = new MockDB();
    badDB.licenseCode = 'PT-TEST';
    // Break encryption temporarily
    badDB.ENCRYPTION.encryptDataWithVersion = async () => {
      throw new Error('Encryption failed');
    };

    const perfume = { id: 1, nombre: 'Test', precioCompra: 100, precioVenta: 200, stock: 1 };
    await badDB.put('perfumes', perfume);

    // Should fall back to plaintext when encryption fails
    const stored = badDB.data.perfumes.get(1);
    expect(stored.nombre).toBe('Test');
    console.log('✅ Encryption errors handled gracefully');
  });

  it('handles decryption errors gracefully', async () => {
    const original = { id: 1, nombre: 'Test', precioCompra: 100, precioVenta: 200, stock: 1 };
    await db.put('perfumes', original);

    // Corrupt the encrypted data
    const stored = db.data.perfumes.get(1);
    stored._encrypted = stored._encrypted.slice(0, -4) + 'XXXX';

    // Should return as-is when decryption fails
    const retrieved = await db.get('perfumes', 1);
    expect(retrieved._encrypted).toBeTruthy();
    console.log('✅ Decryption errors handled gracefully');
  });

  it('supports encrypted backup/restore cycle', async () => {
    const perfume = { id: 1, nombre: 'Haramain Gold', precioCompra: 2700, precioVenta: 3900, stock: 8 };
    await db.put('perfumes', perfume);

    // Simulate backup (get raw encrypted data)
    const backup = db.data.perfumes.get(1);
    expect(backup._encrypted).toBeTruthy();

    // Restore by putting the encrypted data back
    const newDB = new MockDB();
    newDB.licenseCode = 'PT-TEST-LICENSE-CODE';
    newDB.data.perfumes = new Map(db.data.perfumes);

    // Retrieve should decrypt correctly
    const restored = await newDB.get('perfumes', 1);
    expect(restored.nombre).toBe('Haramain Gold');
    console.log('✅ Encrypted backup/restore works');
  });
});
