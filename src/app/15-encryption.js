// ====== ENCRYPTION LAYER (Phase 5: F-31 to F-35) ======

const ENCRYPTION = {
  // Make ENCRYPTION globally accessible in browser (non-module context)
  _isGlobal: true,
  // AES-GCM constants
  ALGORITHM: 'AES-GCM',
  KEY_SIZE: 256,
  SALT_SIZE: 16,
  IV_SIZE: 12,
  TAG_SIZE: 128,
  ITERATIONS: 100000, // PBKDF2 iterations for key derivation

  // Encryption state
  masterKey: null,
  keyVersion: 1,
  lastKeyRotation: null,

  // F-35: PBKDF2 key derivation from license code
  async deriveKeyFromLicense(licenseCode) {
    if (!licenseCode) return null;

    const salt = await this.getSaltForKey(licenseCode);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(licenseCode + salt),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(salt),
        iterations: this.ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      this.KEY_SIZE
    );

    return await crypto.subtle.importKey(
      'raw',
      derivedBits,
      { name: this.ALGORITHM },
      false,
      ['encrypt', 'decrypt']
    );
  },

  // F-34: PIN-protected master key
  async setPINProtectedKey(pin, key) {
    if (!pin || !key) return false;

    const pinHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(pin)
    );

    const encrypted = await this.encryptData(key, Buffer.from(pinHash));

    localStorage.setItem('pt_master_key_encrypted', encrypted);
    localStorage.setItem('pt_pin_unlocked_at', String(Date.now()));

    return true;
  },

  async unlockMasterKeyWithPIN(pin) {
    const encrypted = localStorage.getItem('pt_master_key_encrypted');
    if (!encrypted) return false;

    const pinHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(pin)
    );

    try {
      const key = await this.decryptData(encrypted, Buffer.from(pinHash));
      this.masterKey = key;
      localStorage.setItem('pt_pin_unlocked_at', String(Date.now()));
      return true;
    } catch {
      return false;
    }
  },

  // F-33: Automated key rotation with version tracking
  async rotateKey() {
    const lastRotation = localStorage.getItem('pt_last_key_rotation');
    const now = Date.now();
    const daysSinceRotation = lastRotation
      ? Math.floor((now - parseInt(lastRotation)) / (1000 * 60 * 60 * 24))
      : 7;

    if (daysSinceRotation < 7) return false;

    // Generate new key version
    const newVersion = (parseInt(localStorage.getItem('pt_key_version') || '1')) + 1;

    // Re-encrypt all data with new key
    await this.reencryptAllData(newVersion);

    localStorage.setItem('pt_key_version', String(newVersion));
    localStorage.setItem('pt_last_key_rotation', String(now));

    return true;
  },

  async reencryptAllData(newVersion) {
    const oldVersion = parseInt(localStorage.getItem('pt_key_version') || '1');

    // Get all IndexedDB data
    const allVentas = await this.getAllFromDB('ventas');
    const allStock = await this.getAllFromDB('stock');
    const allCuotas = await this.getAllFromDB('cuotas');
    const allGastos = await this.getAllFromDB('gastos');

    // Decrypt with old key, encrypt with new key
    const reencryptData = async (data) => {
      const decrypted = await this.decryptDataWithVersion(data, oldVersion);
      return await this.encryptDataWithVersion(decrypted, newVersion);
    };

    // Update all records
    const tx = DB.db.transaction(['ventas', 'stock', 'cuotas', 'gastos'], 'readwrite');

    for (const venta of allVentas) {
      venta.encrypted = await reencryptData(venta.encrypted);
      tx.objectStore('ventas').put(venta);
    }
    for (const item of allStock) {
      item.encrypted = await reencryptData(item.encrypted);
      tx.objectStore('stock').put(item);
    }
    for (const cuota of allCuotas) {
      cuota.encrypted = await reencryptData(cuota.encrypted);
      tx.objectStore('cuotas').put(cuota);
    }
    for (const gasto of allGastos) {
      gasto.encrypted = await reencryptData(gasto.encrypted);
      tx.objectStore('gastos').put(gasto);
    }

    return reqP(tx);
  },

  // F-31: IndexedDB encryption with AES-GCM
  async encryptDataWithVersion(data, version = null, licenseCode = null) {
    const ver = version || parseInt(localStorage.getItem('pt_key_version') || '1');
    const code = licenseCode || localStorage.getItem('pt_license_code');
    const key = this.masterKey || (code ? await this.deriveKeyFromLicense(code) : null);
    if (!key) throw new Error('No encryption key available');

    const iv = crypto.getRandomValues(new Uint8Array(this.IV_SIZE));
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const dataBuffer = new TextEncoder().encode(dataStr);

    const encrypted = await crypto.subtle.encrypt(
      { name: this.ALGORITHM, iv },
      key,
      dataBuffer
    );

    // Format: version(2) + iv(12) + encrypted(variable)
    const result = new Uint8Array(2 + this.IV_SIZE + encrypted.byteLength);
    const view = new DataView(result.buffer);
    view.setUint16(0, ver);
    result.set(new Uint8Array(iv), 2);
    result.set(new Uint8Array(encrypted), 2 + this.IV_SIZE);

    return btoa(String.fromCharCode(...result));
  },

  async encryptData(data, keyOrCode = null) {
    let key = null;
    if (typeof keyOrCode === 'string') {
      key = await this.deriveKeyFromLicense(keyOrCode);
    } else if (keyOrCode) {
      key = keyOrCode;
    } else {
      key = this.masterKey;
      if (!key) {
        const code = localStorage.getItem('pt_license_code');
        if (code) key = await this.deriveKeyFromLicense(code);
      }
    }

    if (!key) throw new Error('No encryption key');

    const iv = crypto.getRandomValues(new Uint8Array(this.IV_SIZE));
    const dataBuffer = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);

    const encrypted = await crypto.subtle.encrypt(
      { name: this.ALGORITHM, iv },
      key,
      dataBuffer
    );

    const result = new Uint8Array(this.IV_SIZE + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), this.IV_SIZE);

    return btoa(String.fromCharCode(...result));
  },

  async decryptDataWithVersion(encrypted, version = null, licenseCode = null) {
    const data = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const view = new DataView(data.buffer);
    const ver = version || view.getUint16(0);

    const code = licenseCode || localStorage.getItem('pt_license_code');
    const key = this.masterKey || (code ? await this.deriveKeyFromLicense(code) : null);
    if (!key) throw new Error('No encryption key');

    const iv = data.slice(2, 2 + this.IV_SIZE);
    const encryptedData = data.slice(2 + this.IV_SIZE);

    const decrypted = await crypto.subtle.decrypt(
      { name: this.ALGORITHM, iv },
      key,
      encryptedData
    );

    try {
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
      return new TextDecoder().decode(decrypted);
    }
  },

  async decryptData(encrypted, keyOrCode = null) {
    const data = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

    let key = null;
    if (typeof keyOrCode === 'string') {
      key = await this.deriveKeyFromLicense(keyOrCode);
    } else if (keyOrCode) {
      key = keyOrCode;
    } else {
      key = this.masterKey;
      if (!key) {
        const code = localStorage.getItem('pt_license_code');
        if (code) key = await this.deriveKeyFromLicense(code);
      }
    }

    if (!key) throw new Error('No encryption key');

    const iv = data.slice(0, this.IV_SIZE);
    const encryptedData = data.slice(this.IV_SIZE);

    const decrypted = await crypto.subtle.decrypt(
      { name: this.ALGORITHM, iv },
      key,
      encryptedData
    );

    try {
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
      return new TextDecoder().decode(decrypted);
    }
  },

  // Helper: Get or create salt for key derivation
  async getSaltForKey(licenseCode) {
    let salt = localStorage.getItem(`pt_salt_${licenseCode}`);
    if (!salt) {
      const saltBytes = crypto.getRandomValues(new Uint8Array(this.SALT_SIZE));
      salt = btoa(String.fromCharCode(...saltBytes));
      localStorage.setItem(`pt_salt_${licenseCode}`, salt);
    }
    return salt;
  },

  // Helper: Get all items from a store for re-encryption
  getAllFromDB(storeName) {
    return new Promise((resolve, reject) => {
      const tx = DB.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const allReq = store.getAll();

      allReq.onsuccess = () => resolve(allReq.result || []);
      allReq.onerror = () => reject(allReq.error);
    });
  },

  // Check if master key is unlocked and not timed out
  isMasterKeyUnlocked() {
    const unlockedAt = localStorage.getItem('pt_pin_unlocked_at');
    if (!unlockedAt) return false;

    const elapsed = Date.now() - parseInt(unlockedAt);
    const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

    return elapsed < TIMEOUT_MS;
  },

  // Lock master key
  lockMasterKey() {
    this.masterKey = null;
    localStorage.removeItem('pt_pin_unlocked_at');
  },
};
