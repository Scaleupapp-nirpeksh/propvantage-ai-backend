// File: config/db.js
// Description: Handles the connection logic to the MongoDB database using Mongoose.

import mongoose from 'mongoose';
import 'dotenv/config'; // Ensures environment variables are loaded

/**
 * Establishes a connection to the MongoDB database using Mongoose.
 * It retrieves the connection string from the environment variables.
 * On successful connection, it logs the host.
 * If the connection fails, it logs the error and exits the process.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1); // Exit process with failure
  }
};

export default connectDB;
