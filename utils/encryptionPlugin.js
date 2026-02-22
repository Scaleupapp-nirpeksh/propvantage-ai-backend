// File: utils/encryptionPlugin.js
// Description: Mongoose plugin for transparent field-level encryption/decryption.
//
// Usage:
//   import encryptionPlugin from '../utils/encryptionPlugin.js';
//
//   contractorSchema.plugin(encryptionPlugin, {
//     fields: ['businessInfo.panNumber', 'financialInfo.bankDetails.accountNumber']
//   });
//
//   // For arrays of sub-documents, use [] notation:
//   projectSchema.plugin(encryptionPlugin, {
//     fields: ['paymentConfiguration.bankAccountDetails[].accountNumber']
//   });

import { encrypt, decrypt } from './encryption.js';

// ─── Nested path helpers ─────────────────────────────────────

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => current?.[key], obj);
  if (target && lastKey) target[lastKey] = value;
}

// ─── Encrypt/decrypt a single document for given field paths ─

function encryptFields(doc, fields) {
  for (const fieldPath of fields) {
    if (fieldPath.includes('[]')) {
      // Array sub-path: e.g. 'paymentConfiguration.bankAccountDetails[].accountNumber'
      const [arrayPath, childField] = fieldPath.split('[].');
      const arr = getNestedValue(doc, arrayPath);
      if (Array.isArray(arr)) {
        arr.forEach((item) => {
          const val = item?.[childField];
          if (val && typeof val === 'string') {
            item[childField] = encrypt(val);
          }
        });
      }
    } else {
      const val = getNestedValue(doc, fieldPath);
      if (val && typeof val === 'string') {
        setNestedValue(doc, fieldPath, encrypt(val));
      }
    }
  }
}

function decryptFields(doc, fields) {
  if (!doc) return doc;
  for (const fieldPath of fields) {
    if (fieldPath.includes('[]')) {
      const [arrayPath, childField] = fieldPath.split('[].');
      const arr = getNestedValue(doc, arrayPath);
      if (Array.isArray(arr)) {
        arr.forEach((item) => {
          const val = item?.[childField];
          if (val && typeof val === 'string') {
            item[childField] = decrypt(val);
          }
        });
      }
    } else {
      const val = getNestedValue(doc, fieldPath);
      if (val && typeof val === 'string') {
        setNestedValue(doc, fieldPath, decrypt(val));
      }
    }
  }
  return doc;
}

// ─── Plugin ──────────────────────────────────────────────────

const encryptionPlugin = (schema, options) => {
  const { fields = [] } = options;
  if (fields.length === 0) return;

  // Encrypt before save
  schema.pre('save', function (next) {
    encryptFields(this, fields);
    next();
  });

  // Decrypt after find operations
  schema.post('find', function (docs) {
    if (Array.isArray(docs)) {
      docs.forEach((doc) => decryptFields(doc, fields));
    }
  });

  schema.post('findOne', function (doc) {
    decryptFields(doc, fields);
  });

  schema.post('findOneAndUpdate', function (doc) {
    decryptFields(doc, fields);
  });

  schema.post('save', function (doc) {
    decryptFields(doc, fields);
  });
};

export default encryptionPlugin;
