// File: middleware/validationSchemas.js
// Description: Joi validation schemas for request input validation.

import Joi from 'joi';

// ─── Auth Schemas ──────────────────────────────────────────────────────────────

const registerSchema = Joi.object({
  orgName: Joi.string().trim().min(2).max(100).required()
    .messages({ 'string.min': 'Organization name must be at least 2 characters' }),
  country: Joi.string().trim().min(2).max(60).required(),
  city: Joi.string().trim().min(2).max(60).required(),
  firstName: Joi.string().trim().min(1).max(50).required(),
  lastName: Joi.string().trim().min(1).max(50).required(),
  email: Joi.string().trim().lowercase().email().required()
    .messages({ 'string.email': 'Please provide a valid email address' }),
  password: Joi.string().min(8).max(128).required()
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[a-z]/, 'lowercase')
    .pattern(/[0-9]/, 'digit')
    .pattern(/[!@#$%^&*(),.?":{}|<>]/, 'special character')
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.pattern.name': 'Password must contain at least one {#name}',
    }),

  // Organization type — selects the registration path; defaults to 'builder'.
  // The channel-partner fields below must be declared here so `validate()`'s
  // `stripUnknown` does not delete them before they reach registerUser, which
  // performs the authoritative CP validation (category enum, RERA presence +
  // uniqueness — see authController.registerUser / SP1 spec §6.2, §9).
  type: Joi.string().valid('builder', 'channel_partner').default('builder'),
  category: Joi.string().trim().max(40).optional(),
  reraRegistrationNumber: Joi.string().trim().max(120).optional(),

  // SP4 — when a builder org registers via an off-platform CP's invite link,
  // this token triggers claimExternalDeveloper (Partnership + ChannelPartner
  // reconciliation + Prospect retag) at the end of registerUser. Must be
  // declared here so `validate()`'s stripUnknown doesn't drop it before it
  // reaches the controller (same gotcha SP1 hit — see commit a2fb417).
  externalDeveloperInviteToken: Joi.string().hex().length(64).optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required()
    .messages({ 'string.email': 'Please provide a valid email address' }),
  password: Joi.string().required()
    .messages({ 'any.required': 'Password is required' }),
});

// ─── Validation Middleware Factory ─────────────────────────────────────────────

/**
 * Creates an Express middleware that validates req.body against a Joi schema.
 * @param {Joi.ObjectSchema} schema - The Joi schema to validate against
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,       // return all errors, not just the first
      stripUnknown: true,      // remove unknown fields
      allowUnknown: false,     // don't allow unknown fields
    });

    if (error) {
      const messages = error.details.map((d) => d.message).join('; ');
      res.status(400);
      throw new Error(`Validation error: ${messages}`);
    }

    // Replace body with validated & sanitized values
    req.body = value;
    next();
  };
};

export { registerSchema, loginSchema, validate };
