// File: data/migrateEncryption.js
// Description: One-time migration script to encrypt existing plaintext PII data.
//
// Usage:
//   node data/migrateEncryption.js          — encrypt existing plaintext data
//   node data/migrateEncryption.js --dry-run — preview what would be encrypted (no writes)
//
// Prerequisites:
//   - ENCRYPTION_KEY must be set in .env (64-char hex string)
//   - MONGO_URI must be set in .env
//
// This script is idempotent: already-encrypted values are skipped.

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { encrypt, isEncrypted } from '../utils/encryption.js';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Models to migrate ──────────────────────────────────────

const MIGRATIONS = [
  {
    name: 'Contractor',
    collection: 'contractors',
    fields: [
      { path: 'businessInfo.panNumber', type: 'simple' },
      { path: 'financialInfo.bankDetails.accountNumber', type: 'simple' },
    ],
  },
  {
    name: 'PaymentTransaction',
    collection: 'paymenttransactions',
    fields: [
      { path: 'receivedInAccount.accountNumber', type: 'simple' },
    ],
  },
  {
    name: 'Project',
    collection: 'projects',
    fields: [
      {
        path: 'paymentConfiguration.bankAccountDetails',
        childField: 'accountNumber',
        type: 'array',
      },
    ],
  },
  {
    name: 'PartnerCommission',
    collection: 'partnercommissions',
    fields: [
      { path: 'paymentSchedule.bankAccountDetails.accountNumber', type: 'simple' },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function buildSetObject(path, value) {
  return { [path]: value };
}

// ─── Main ────────────────────────────────────────────────────

async function migrate() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  PII Field Encryption Migration${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${'='.repeat(60)}\n`);

  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
    console.error('ERROR: ENCRYPTION_KEY must be set in .env (64-char hex string)');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  let totalEncrypted = 0;
  let totalSkipped = 0;

  for (const migration of MIGRATIONS) {
    console.log(`--- ${migration.name} (${migration.collection}) ---`);

    const collection = mongoose.connection.collection(migration.collection);
    const docs = await collection.find({}).toArray();
    let modelEncrypted = 0;
    let modelSkipped = 0;

    for (const doc of docs) {
      const updateSet = {};

      for (const field of migration.fields) {
        if (field.type === 'simple') {
          const value = getNestedValue(doc, field.path);
          if (value && typeof value === 'string' && !isEncrypted(value)) {
            updateSet[field.path] = encrypt(value);
            modelEncrypted++;
          } else {
            modelSkipped++;
          }
        } else if (field.type === 'array') {
          const arr = getNestedValue(doc, field.path);
          if (Array.isArray(arr)) {
            let arrayModified = false;
            const newArr = arr.map((item, idx) => {
              const val = item?.[field.childField];
              if (val && typeof val === 'string' && !isEncrypted(val)) {
                arrayModified = true;
                modelEncrypted++;
                return { ...item, [field.childField]: encrypt(val) };
              }
              modelSkipped++;
              return item;
            });
            if (arrayModified) {
              updateSet[field.path] = newArr;
            }
          }
        }
      }

      if (Object.keys(updateSet).length > 0) {
        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would encrypt ${Object.keys(updateSet).length} field(s) in doc ${doc._id}`);
        } else {
          await collection.updateOne({ _id: doc._id }, { $set: updateSet });
        }
      }
    }

    console.log(`  Documents: ${docs.length} | Encrypted: ${modelEncrypted} | Skipped: ${modelSkipped}\n`);
    totalEncrypted += modelEncrypted;
    totalSkipped += modelSkipped;
  }

  console.log(`${'='.repeat(60)}`);
  console.log(`  Total encrypted: ${totalEncrypted} | Total skipped: ${totalSkipped}`);
  console.log(`${'='.repeat(60)}\n`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
