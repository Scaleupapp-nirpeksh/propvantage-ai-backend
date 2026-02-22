// File: services/csvImportService.js
// Description: CSV import/export service for competitor project data.
// Handles parsing, column mapping, validation, deduplication, and bulk upsert.

import { parse } from 'csv-parse/sync';
import mongoose from 'mongoose';

// ─── Default Column Mapping ──────────────────────────────────
// Maps common CSV header names (case-insensitive) to CompetitorProject fields.

const DEFAULT_COLUMN_MAP = {
  'project name': 'projectName',
  'project': 'projectName',
  'name': 'projectName',
  'developer': 'developerName',
  'developer name': 'developerName',
  'builder': 'developerName',
  'builder name': 'developerName',
  'rera number': 'reraNumber',
  'rera': 'reraNumber',
  'rera no': 'reraNumber',
  'city': 'location.city',
  'area': 'location.area',
  'locality': 'location.area',
  'location': 'location.area',
  'micromarket': 'location.micromarket',
  'state': 'location.state',
  'pincode': 'location.pincode',
  'pin code': 'location.pincode',
  'zip': 'location.pincode',
  'project type': 'projectType',
  'type': 'projectType',
  'project status': 'projectStatus',
  'status': 'projectStatus',
  'possession date': 'possessionTimeline.description',
  'possession': 'possessionTimeline.description',
  'expected possession': 'possessionTimeline.description',
  'total units': 'totalUnits',
  'units': 'totalUnits',
  'total towers': 'totalTowers',
  'towers': 'totalTowers',
  'total area acres': 'totalAreaAcres',
  'area acres': 'totalAreaAcres',
  'project area': 'totalAreaAcres',
  'min price per sqft': 'pricing.pricePerSqft.min',
  'max price per sqft': 'pricing.pricePerSqft.max',
  'avg price per sqft': 'pricing.pricePerSqft.avg',
  'price per sqft': 'pricing.pricePerSqft.avg',
  'rate per sqft': 'pricing.pricePerSqft.avg',
  'rate/sqft': 'pricing.pricePerSqft.avg',
  'price/sqft': 'pricing.pricePerSqft.avg',
  'min base price': 'pricing.basePriceRange.min',
  'max base price': 'pricing.basePriceRange.max',
  'base price': 'pricing.basePriceRange.min',
  'floor rise charge': 'pricing.floorRiseCharge',
  'floor rise': 'pricing.floorRiseCharge',
  'park facing premium': 'pricing.facingPremiums.parkFacing',
  'road facing premium': 'pricing.facingPremiums.roadFacing',
  'corner unit premium': 'pricing.facingPremiums.cornerUnit',
  'plc charges': 'pricing.plcCharges',
  'plc': 'pricing.plcCharges',
  'covered parking': 'pricing.parkingCharges.covered',
  'open parking': 'pricing.parkingCharges.open',
  'club membership': 'pricing.clubMembershipCharges',
  'maintenance deposit': 'pricing.maintenanceDeposit',
  'legal charges': 'pricing.legalCharges',
  'gst rate': 'pricing.gstRate',
  'gst': 'pricing.gstRate',
  'stamp duty': 'pricing.stampDutyRate',
  'stamp duty rate': 'pricing.stampDutyRate',
  'confidence': 'confidenceScore',
  'confidence score': 'confidenceScore',
  'notes': 'notes',
};

// Fields that should be parsed as numbers
const NUMERIC_FIELDS = new Set([
  'totalUnits', 'totalTowers', 'totalAreaAcres', 'confidenceScore',
  'pricing.pricePerSqft.min', 'pricing.pricePerSqft.max', 'pricing.pricePerSqft.avg',
  'pricing.basePriceRange.min', 'pricing.basePriceRange.max',
  'pricing.floorRiseCharge', 'pricing.facingPremiums.parkFacing',
  'pricing.facingPremiums.roadFacing', 'pricing.facingPremiums.cornerUnit',
  'pricing.plcCharges', 'pricing.parkingCharges.covered', 'pricing.parkingCharges.open',
  'pricing.clubMembershipCharges', 'pricing.maintenanceDeposit',
  'pricing.legalCharges', 'pricing.gstRate', 'pricing.stampDutyRate',
]);

// Valid enum values
const VALID_PROJECT_TYPES = ['residential', 'commercial', 'mixed_use', 'plotted_development'];
const VALID_PROJECT_STATUSES = ['pre_launch', 'newly_launched', 'under_construction', 'ready_to_move', 'completed'];

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Set a nested value on an object using dot-path notation.
 * e.g., setNested(obj, 'pricing.pricePerSqft.min', 8000)
 */
const setNested = (obj, path, value) => {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
};

/**
 * Parse a price string into a number (handles lakhs/crores notation).
 * "85 Lakhs" → 8500000, "1.2 Cr" → 12000000, "8500" → 8500
 */
const parsePrice = (val) => {
  if (val === null || val === undefined || val === '') return null;
  const str = String(val).trim().replace(/[₹,\s]/g, '');
  const lower = str.toLowerCase();

  const crMatch = lower.match(/^([\d.]+)\s*(cr|crore|crores)$/);
  if (crMatch) return Math.round(parseFloat(crMatch[1]) * 10000000);

  const lakhMatch = lower.match(/^([\d.]+)\s*(l|lakh|lakhs|lac|lacs)$/);
  if (lakhMatch) return Math.round(parseFloat(lakhMatch[1]) * 100000);

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
};

/**
 * Resolve column map: merge custom mapping with defaults.
 */
const resolveColumnMap = (customMap) => {
  const merged = { ...DEFAULT_COLUMN_MAP };
  if (customMap && typeof customMap === 'object') {
    for (const [csvHeader, fieldPath] of Object.entries(customMap)) {
      merged[csvHeader.toLowerCase().trim()] = fieldPath;
    }
  }
  return merged;
};

// ─── Core Import Function ────────────────────────────────────

/**
 * Parse and import CSV data into CompetitorProject records.
 *
 * @param {Object} params
 * @param {Buffer|string} params.csvData - Raw CSV content
 * @param {ObjectId} params.organizationId
 * @param {ObjectId} params.userId
 * @param {string} params.city - Default city if not in CSV
 * @param {string} params.area - Default area if not in CSV
 * @param {Object} [params.customColumnMap] - Custom CSV header → field mappings
 * @returns {Object} Import results
 */
const importCSV = async ({
  csvData,
  organizationId,
  userId,
  city,
  area,
  customColumnMap,
}) => {
  // Dynamically import to avoid circular dependencies
  const { default: CompetitorProject } = await import(
    '../models/competitorProjectModel.js'
  );

  const batchId = new mongoose.Types.ObjectId().toString();
  const columnMap = resolveColumnMap(customColumnMap);

  // ── Step 1: Parse CSV ──────────────────────────────────────
  let records;
  try {
    records = parse(csvData, {
      columns: true,       // Use first row as headers
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw new Error(`CSV parsing failed: ${err.message}`);
  }

  if (!records || records.length === 0) {
    throw new Error('CSV file is empty or contains only headers');
  }

  // ── Step 2: Map & Validate Each Row ────────────────────────
  const rowResults = [];
  const validRows = [];

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    const rowNum = i + 2; // +2 for 1-indexed + header row
    const errors = [];
    const doc = {};

    // Map CSV columns to fields
    for (const [csvHeader, rawValue] of Object.entries(raw)) {
      const normalizedHeader = csvHeader.toLowerCase().trim();
      const fieldPath = columnMap[normalizedHeader];

      if (!fieldPath) continue; // Unmapped column, skip

      let value = rawValue?.trim();
      if (!value) continue; // Empty value, skip

      // Parse numbers
      if (NUMERIC_FIELDS.has(fieldPath)) {
        value = parsePrice(value);
        if (value === null) {
          errors.push(`Column "${csvHeader}": "${rawValue}" is not a valid number`);
          continue;
        }
      }

      setNested(doc, fieldPath, value);
    }

    // Apply defaults for city/area if not provided in CSV
    if (!doc.location?.city && city) setNested(doc, 'location.city', city);
    if (!doc.location?.area && area) setNested(doc, 'location.area', area);

    // Validate project type
    if (doc.projectType && !VALID_PROJECT_TYPES.includes(doc.projectType)) {
      errors.push(`Invalid projectType: "${doc.projectType}". Must be one of: ${VALID_PROJECT_TYPES.join(', ')}`);
      doc.projectType = 'residential'; // fallback
    }

    // Validate project status
    if (doc.projectStatus && !VALID_PROJECT_STATUSES.includes(doc.projectStatus)) {
      errors.push(`Invalid projectStatus: "${doc.projectStatus}". Must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`);
      delete doc.projectStatus;
    }

    // Required fields check
    if (!doc.projectName) {
      errors.push('Missing required field: projectName');
      rowResults.push({ row: rowNum, status: 'skipped', errors });
      continue;
    }
    if (!doc.location?.city) {
      errors.push('Missing required field: city (not in CSV and no default provided)');
      rowResults.push({ row: rowNum, status: 'skipped', errors });
      continue;
    }
    if (!doc.location?.area) {
      errors.push('Missing required field: area (not in CSV and no default provided)');
      rowResults.push({ row: rowNum, status: 'skipped', errors });
      continue;
    }

    validRows.push({ rowNum, doc, errors });
  }

  // ── Step 3: Deduplicate & Upsert ──────────────────────────
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const savedProjects = [];

  for (const { rowNum, doc, errors } of validRows) {
    try {
      const existing = await CompetitorProject.findOne({
        organization: organizationId,
        projectName: new RegExp(`^${doc.projectName.trim()}$`, 'i'),
        'location.area': new RegExp(`^${doc.location.area.trim()}$`, 'i'),
      });

      if (existing) {
        // Merge: only update null/empty/0 fields
        let fieldsUpdated = 0;

        const mergeField = (path, value) => {
          if (value === null || value === undefined) return;
          const parts = path.split('.');
          let current = existing;
          for (let j = 0; j < parts.length - 1; j++) {
            if (!current[parts[j]]) return;
            current = current[parts[j]];
          }
          const lastKey = parts[parts.length - 1];
          if (
            current[lastKey] === null ||
            current[lastKey] === undefined ||
            current[lastKey] === 0 ||
            current[lastKey] === ''
          ) {
            current[lastKey] = value;
            fieldsUpdated++;
          }
        };

        // Merge all mapped fields
        const flattenAndMerge = (obj, prefix = '') => {
          for (const [key, val] of Object.entries(obj)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              flattenAndMerge(val, fullPath);
            } else {
              mergeField(fullPath, val);
            }
          }
        };

        flattenAndMerge(doc);

        if (fieldsUpdated > 0) {
          existing.updatedBy = userId;
          existing.dataProvenance.push({
            field: 'multiple',
            source: 'csv_import',
            collectedAt: new Date(),
            collectedBy: userId,
            confidence: 'estimated',
            notes: `CSV import enriched ${fieldsUpdated} fields (batch: ${batchId})`,
          });
          await existing.save();
          updated++;
          savedProjects.push(existing);
          rowResults.push({ row: rowNum, status: 'updated', fieldsUpdated, errors: errors.length ? errors : undefined });
        } else {
          skipped++;
          rowResults.push({ row: rowNum, status: 'unchanged', errors: errors.length ? errors : undefined });
        }
      } else {
        // Create new
        const newDoc = await CompetitorProject.create({
          organization: organizationId,
          ...doc,
          developerName: doc.developerName || 'Unknown',
          projectType: doc.projectType || 'residential',
          dataSource: 'csv_import',
          dataCollectionDate: new Date(),
          confidenceScore: doc.confidenceScore || 60,
          importBatchId: batchId,
          dataProvenance: [
            {
              field: 'all',
              source: 'csv_import',
              collectedAt: new Date(),
              collectedBy: userId,
              confidence: 'estimated',
              notes: `Imported from CSV (batch: ${batchId})`,
            },
          ],
          createdBy: userId,
        });

        created++;
        savedProjects.push(newDoc);
        rowResults.push({ row: rowNum, status: 'created', errors: errors.length ? errors : undefined });
      }
    } catch (err) {
      if (err.code === 11000) {
        skipped++;
        rowResults.push({ row: rowNum, status: 'skipped', errors: [...errors, 'Duplicate record'] });
      } else {
        rowResults.push({ row: rowNum, status: 'error', errors: [...errors, err.message] });
      }
    }
  }

  return {
    batchId,
    totalRows: records.length,
    created,
    updated,
    skipped: skipped + rowResults.filter((r) => r.status === 'skipped').length,
    errors: rowResults.filter((r) => r.errors?.length > 0),
    rowDetails: rowResults,
    summary: `Processed ${records.length} rows: ${created} created, ${updated} updated, ${skipped} unchanged/skipped`,
  };
};

// ─── CSV Export ──────────────────────────────────────────────

/**
 * Generate CSV string from competitor project records.
 */
const exportCSV = (competitors) => {
  const headers = [
    'Project Name', 'Developer Name', 'RERA Number',
    'City', 'Area', 'State', 'Pincode',
    'Project Type', 'Project Status', 'Possession Date',
    'Total Units', 'Total Towers', 'Total Area Acres',
    'Min Price Per Sqft', 'Max Price Per Sqft', 'Avg Price Per Sqft',
    'Min Base Price', 'Max Base Price',
    'Floor Rise Charge',
    'Park Facing Premium', 'Road Facing Premium', 'Corner Unit Premium',
    'PLC Charges',
    'Covered Parking', 'Open Parking',
    'Club Membership', 'Maintenance Deposit', 'Legal Charges',
    'GST Rate', 'Stamp Duty Rate',
    'Confidence Score', 'Data Source', 'Notes',
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = competitors.map((c) => [
    c.projectName,
    c.developerName,
    c.reraNumber,
    c.location?.city,
    c.location?.area,
    c.location?.state,
    c.location?.pincode,
    c.projectType,
    c.projectStatus,
    c.possessionTimeline?.description,
    c.totalUnits,
    c.totalTowers,
    c.totalAreaAcres,
    c.pricing?.pricePerSqft?.min,
    c.pricing?.pricePerSqft?.max,
    c.pricing?.pricePerSqft?.avg,
    c.pricing?.basePriceRange?.min,
    c.pricing?.basePriceRange?.max,
    c.pricing?.floorRiseCharge,
    c.pricing?.facingPremiums?.parkFacing,
    c.pricing?.facingPremiums?.roadFacing,
    c.pricing?.facingPremiums?.cornerUnit,
    c.pricing?.plcCharges,
    c.pricing?.parkingCharges?.covered,
    c.pricing?.parkingCharges?.open,
    c.pricing?.clubMembershipCharges,
    c.pricing?.maintenanceDeposit,
    c.pricing?.legalCharges,
    c.pricing?.gstRate,
    c.pricing?.stampDutyRate,
    c.confidenceScore,
    c.dataSource,
    c.notes,
  ]);

  const csvLines = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ];

  return csvLines.join('\n');
};

/**
 * Generate a blank CSV template with headers only.
 */
const generateCSVTemplate = () => {
  const headers = [
    'Project Name', 'Developer Name', 'RERA Number',
    'City', 'Area', 'State', 'Pincode',
    'Project Type', 'Project Status', 'Possession Date',
    'Total Units', 'Total Towers', 'Total Area Acres',
    'Min Price Per Sqft', 'Max Price Per Sqft', 'Avg Price Per Sqft',
    'Min Base Price', 'Max Base Price',
    'Floor Rise Charge',
    'Park Facing Premium', 'Road Facing Premium', 'Corner Unit Premium',
    'PLC Charges',
    'Covered Parking', 'Open Parking',
    'Club Membership', 'Maintenance Deposit', 'Legal Charges',
    'GST Rate', 'Stamp Duty Rate',
    'Confidence Score', 'Notes',
  ];

  const exampleRow = [
    'Prestige Lake Side', 'Prestige Group', 'PRM/KA/RERA/1250/2024',
    'Bangalore', 'Whitefield', 'Karnataka', '560066',
    'residential', 'under_construction', 'Dec 2027',
    '500', '5', '12',
    '7500', '9500', '8500',
    '50 Lakhs', '1.2 Cr',
    '50',
    '200000', '100000', '150000',
    '100000',
    '500000', '200000',
    '200000', '100000', '50000',
    '5', '5.6',
    '70', 'Major project near ITPL',
  ];

  return [
    headers.join(','),
    exampleRow.join(','),
  ].join('\n');
};

export { importCSV, exportCSV, generateCSVTemplate };
