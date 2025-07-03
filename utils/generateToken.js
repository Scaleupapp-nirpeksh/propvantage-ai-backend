// File: utils/generateToken.js
// Description: Utility function to generate a JSON Web Token (JWT) for user authentication.

import jwt from 'jsonwebtoken';

/**
 * Generates a JWT for a given user ID.
 * The token includes the user's ID as its payload and is signed with a secret key.
 * The token is set to expire in 30 days.
 * @param {object} res - The Express response object.
 * @param {string} userId - The MongoDB ObjectId of the user.
 */
const generateToken = (res, userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });

  // Note: In a production environment, you would set the cookie with
  // httpOnly: true, secure: true, and sameSite: 'strict' for security.
  // For now, we are just returning the token in the response body.
  return token;
};

export default generateToken;
