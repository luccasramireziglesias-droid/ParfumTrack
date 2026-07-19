// ====== KEY MANAGEMENT (Phase 5: F-33 + F-34) ======

// F-34: PIN-protected master key management
  async _setupEncryptionWithPIN() {
    if (!this._account?.license) return false;

    const pin = localStorage.getItem('pt_pin');
    if (!pin) return false;

    // F-34: Unlock master key with PIN if available
    const isPINSet = localStorage.getItem('pt_master_key_encrypted');
    if (isPINSet && ENCRYPTION.isMasterKeyUnlocked()) {
      return true;
    }

    // Derive key from license and set as PIN-protected
    const key = await ENCRYPTION.deriveKeyFromLicense(this._account.license);
    if (key) {
      await ENCRYPTION.setPINProtectedKey(pin, key);
      return true;
    }

    return false;
  },

  async _ensureEncryptionUnlocked() {
    // F-34: Check if PIN lock is enabled and key is unlocked
    const isPINLocked = localStorage.getItem('pt_master_key_encrypted');
    if (!isPINLocked) return true;

    if (ENCRYPTION.isMasterKeyUnlocked()) return true;

    // PIN lock enabled but master key not unlocked
    const pin = prompt('Ingresá tu PIN de seguridad para continuar:');
    if (!pin) return false;

    const unlocked = await ENCRYPTION.unlockMasterKeyWithPIN(pin);
    if (!unlocked) {
      this.toast('PIN inválido', 'error');
    }
    return unlocked;
  },

  // F-33: Automated key rotation check and execution
  async _checkAndRotateKeyIfNeeded() {
    const lastRotation = localStorage.getItem('pt_last_key_rotation');
    const now = Date.now();

    if (lastRotation) {
      const daysSince = Math.floor((now - parseInt(lastRotation)) / (1000 * 60 * 60 * 24));
      if (daysSince < 7) return false; // Not time yet
    }

    // Time to rotate
    try {
      const rotated = await ENCRYPTION.rotateKey();
      if (rotated) {
      }
      return rotated;
    } catch (e) {
      console.warn('Key rotation failed:', e.message);
      return false;
    }
  },

  // Initialize encryption on app startup
  async _initializeEncryption() {
    if (!this._account?.license) return;

    // Check and rotate key if needed (background task)
    setTimeout(() => this._checkAndRotateKeyIfNeeded(), 2000);

    // Setup PIN protection if enabled
    await this._setupEncryptionWithPIN();
  },

  // F-33: Initialize rotation check on app load
  async _initDOMContentLoaded() {
    if (App && App._account) {
      await App._checkAndRotateKeyIfNeeded().catch(() => {});
    }
  },
