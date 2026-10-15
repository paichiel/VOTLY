/**
 * VOTLY Client-Side Cryptographic Service (WebCrypto API)
 * Implements Zero-Knowledge AES-GCM (256-bit) client-side encryption.
 * Key derived via PBKDF2 with 100,000 iterations and SHA-256.
 */

const VotlyWebCrypto = {
  // Convert String to ArrayBuffer
  strToBuffer(str) {
    return new TextEncoder().encode(str);
  },

  // Convert ArrayBuffer to Hex String
  bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },

  // Derive AES-GCM 256-bit key from user passphrase using PBKDF2
  async deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  },

  // Client-side encrypt file ArrayBuffer
  async encryptBuffer(buffer, passphrase) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(passphrase, salt);

    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      key,
      buffer
    );

    // Pack salt (16B) + iv (12B) + ciphertext
    const packed = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
    packed.set(salt, 0);
    packed.set(iv, salt.byteLength);
    packed.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

    return packed.buffer;
  },

  // Client-side decrypt packed ArrayBuffer
  async decryptBuffer(packedBuffer, passphrase) {
    const packed = new Uint8Array(packedBuffer);
    const salt = packed.slice(0, 16);
    const iv = packed.slice(16, 28);
    const ciphertext = packed.slice(28);

    const key = await this.deriveKey(passphrase, salt);

    return window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      key,
      ciphertext
    );
  },

  // Compute SHA-256 hash client-side
  async computeSHA256(buffer) {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
    return this.bufferToHex(hashBuffer);
  }
};

window.VotlyWebCrypto = VotlyWebCrypto;
