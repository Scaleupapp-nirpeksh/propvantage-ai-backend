// File: services/s3Service.js
// Description: Handles file uploads to Amazon S3.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';

// Initialize the S3 client with credentials and region from environment variables
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads a file to the configured AWS S3 bucket.
 *
 * @param {object} file - The file object from multer (contains buffer, originalname, mimetype).
 * @param {string} folder - The folder within the S3 bucket to upload the file to (e.g., 'projects', 'kyc').
 * @returns {Promise<object>} An object containing the URL and S3 Key of the uploaded file.
 */
const uploadFileToS3 = async (file, folder) => {
  // Create a unique key for the file to prevent overwrites
  const key = `${folder}/${Date.now()}-${file.originalname}`;

  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    // Execute the upload command
    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    // Construct the public URL of the uploaded file
    const url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    return {
      url,
      s3Key: key,
    };
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    throw new Error('File upload failed.');
  }
};

export { uploadFileToS3 };
