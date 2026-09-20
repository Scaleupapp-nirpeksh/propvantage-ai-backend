// File: utils/ensureIndexes.js
// Description: One-off index migrations that Mongoose's autoIndex cannot do on its own
//   (it creates new indexes but never drops old ones). Safe to run on every boot.

import mongoose from 'mongoose';

/**
 * Sales: `unit` used to be globally unique, which made it impossible to re-book an
 * apartment after a cancellation. It is now unique only among ACTIVE sales
 * (`unit_active_unique`, a partial index). Drop the legacy `unit_1` unique index —
 * but only once the replacement exists, so there is never a window without protection.
 */
export async function migrateSaleUnitIndex() {
  const Sale = mongoose.model('Sale');
  let indexes;
  try { indexes = await Sale.collection.indexes(); } catch (err) { if (err.codeName === 'NamespaceNotFound' || err.code === 26) return 'no-collection'; throw err; }
  const legacy = indexes.find((i) => i.name === 'unit_1' && i.unique);
  if (!legacy) return 'already-migrated';
  const spec = Sale.schema.indexes().find(([, o]) => o.name === 'unit_active_unique');
  const createPartial = () => Sale.collection.createIndex({ unit: 1 }, { name: 'unit_active_unique', unique: true, partialFilterExpression: spec[1].partialFilterExpression });
  if (!indexes.some((i) => i.name === 'unit_active_unique')) {
    try { await createPartial(); } catch (err) {
      // Older servers refuse two indexes on the same key: swap them instead (a few milliseconds apart).
      if (![85, 86].includes(err.code)) throw err;
      await Sale.collection.dropIndex('unit_1'); await createPartial();
      return 'migrated';
    }
  }
  await Sale.collection.dropIndex('unit_1');
  return 'migrated';
}

export async function ensureIndexes() {
  try {
    const r = await migrateSaleUnitIndex();
    if (r === 'migrated') console.log('🔧 [indexes] sales.unit_1 (legacy unique) replaced by unit_active_unique (partial)');
  } catch (err) {
    console.warn('⚠️ [indexes] sale index migration skipped:', err.message);
  }
}

export default ensureIndexes;
