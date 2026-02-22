// File: utils/encryption.js
// Description: AES-256-GCM encrypt/decrypt utilities for field-level encryption of PII data.

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCODING = 'hex';

// Encrypted format: iv:authTag:ciphertext (all hex-encoded)

/**
 * Get the encryption key from environment variable.
 * @returns {Buffer} 32-byte encryption key.
 */
const getKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
};

/**
 * Check if a value looks like it's already encrypted (iv:authTag:ciphertext format).
 * @param {string} value - The value to check.
 * @returns {boolean}
 */
const isEncrypted = (value) => {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  return parts[0].length === IV_LENGTH * 2 && parts[1].length === AUTH_TAG_LENGTH * 2;
};

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Each call generates a unique IV, so the same input produces different ciphertext.
 * Returns the value unchanged if it's already encrypted or not a string.
 *
 * @param {string} plaintext - The value to encrypt.
 * @returns {string} Encrypted string in format iv:authTag:ciphertext.
 */
const encrypt = (plaintext) => {
  if (!plaintext || typeof plaintext !== 'string') return plaintext;

  // Don't double-encrypt
  if (isEncrypted(plaintext)) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', ENCODING);
  ciphertext += cipher.final(ENCODING);
  const authTag = cipher.getAuthTag().toString(ENCODING);

  return `${iv.toString(ENCODING)}:${authTag}:${ciphertext}`;
};

/**
 * Decrypt an encrypted string using AES-256-GCM.
 * Gracefully handles unencrypted legacy data by returning it unchanged.
 *
 * @param {string} encryptedText - The encrypted value (iv:authTag:ciphertext).
 * @returns {string} Decrypted plaintext, or original value if not encrypted.
 */
const decrypt = (encryptedText) => {
  if (!encryptedText || typeof encryptedText !== 'string') return encryptedText;

  // Not in encrypted format — return as-is (legacy plaintext data)
  if (!isEncrypted(encryptedText)) return encryptedText;

  try {
    const key = getKey();
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], ENCODING);
    const authTag = Buffer.from(parts[1], ENCODING);
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(ciphertext, ENCODING, 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (err) {
    // If decryption fails, it might be unencrypted legacy data
    return encryptedText;
  }
};

export { encrypt, decrypt, isEncrypted };
