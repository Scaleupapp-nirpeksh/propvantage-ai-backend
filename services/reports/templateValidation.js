// File: services/reports/templateValidation.js
// Description: Pure validation for report-template create/update payloads. No I/O.

import { getBlock } from './blockRegistry.js';
import {
  THEME_PRESETS, GATE_TYPES, DELIVERY_MODES, SCHEDULE_FREQUENCIES, PERIOD_PRESETS,
} from '../../models/reportTemplateModel.js';

/**
 * Validate a report-template payload.
 * @param {object} body
 * @param {{ partial?: boolean }} [opts] - partial=true skips required-field checks (for PATCH/PUT updates)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateTemplatePayload = (body = {}, { partial = false } = {}) => {
  const errors = [];

  // name — required on create
  if (!partial || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      errors.push('name is required');
    } else if (body.name.length > 200) {
      errors.push('name must be 200 characters or fewer');
    }
  }

  // blocks — optional, but if present must be an array of {id, known type}
  if (body.blocks !== undefined) {
    if (!Array.isArray(body.blocks)) {
      errors.push('blocks must be an array');
    } else {
      body.blocks.forEach((b, i) => {
        if (!b || typeof b !== 'object') { errors.push(`blocks[${i}] must be an object`); return; }
        if (!b.id || typeof b.id !== 'string') errors.push(`blocks[${i}].id is required`);
        if (!b.type || typeof b.type !== 'string') errors.push(`blocks[${i}].type is required`);
        else if (!getBlock(b.type)) errors.push(`blocks[${i}].type "${b.type}" is not a known block type`);
      });
    }
  }

  // enum fields — only checked when present
  const enumCheck = (value, allowed, label) => {
    if (value !== undefined && !allowed.includes(value)) {
      errors.push(`${label} must be one of: ${allowed.join(', ')}`);
    }
  };
  enumCheck(body.theme?.preset, THEME_PRESETS, 'theme.preset');
  enumCheck(body.access?.gate, GATE_TYPES, 'access.gate');
  enumCheck(body.delivery?.mode, DELIVERY_MODES, 'delivery.mode');
  enumCheck(body.schedule?.frequency, SCHEDULE_FREQUENCIES, 'schedule.frequency');
  enumCheck(body.scope?.period?.preset, PERIOD_PRESETS, 'scope.period.preset');

  return { valid: errors.length === 0, errors };
};
