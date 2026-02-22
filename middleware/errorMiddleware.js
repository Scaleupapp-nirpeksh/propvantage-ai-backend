// File: middleware/errorMiddleware.js
// Description: Centralized error handling middleware for the Express application.

/**
 * Middleware to handle 'Not Found' errors for routes that don't exist.
 * Creates a new Error object with a 404 status code and passes it to the next error handler.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
  };
  
  /**
   * General-purpose error handling middleware.
   * This catches all errors passed via next(error).
   * It sends a structured JSON response with the error message and, in development mode, the stack trace.
   * @param {object} err - The error object.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {function} next - Express next middleware function.
   */
  const errorHandler = (err, req, res, next) => {
    // Sometimes an error might come in with a 200 status code, so we set it to 500 if it's not an error status.
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    let message = err.message;

    // Specific check for Mongoose CastError (e.g., invalid ObjectId)
    if (err.name === 'CastError' && err.kind === 'ObjectId') {
      statusCode = 404;
      message = 'Resource not found';
    }

    // Mongoose validation errors — return field-level details without internals
    if (err.name === 'ValidationError') {
      statusCode = 400;
      message = Object.values(err.errors).map(e => e.message).join('; ');
    }

    // Never expose internal error details in production
    if (process.env.NODE_ENV === 'production' && statusCode === 500) {
      message = 'Internal server error';
    }

    res.status(statusCode).json({
      message: message,
      stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
  };
  
  export { notFound, errorHandler };
  