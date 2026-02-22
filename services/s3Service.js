// File: services/s3Service.js
// Description: Handles file uploads to and pre-signed downloads from Amazon S3.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
 * @returns {Promise<object>} An object containing the S3 Key of the uploaded file.
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

    // Construct the public URL (kept for backward compatibility with existing records)
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

/**
 * Generates a pre-signed GET URL for downloading a file from S3.
 * The URL expires after the specified duration (default 1 hour).
 *
 * @param {string} s3Key - The S3 object key.
 * @param {number} [expiresInSeconds=3600] - URL validity in seconds (default 1 hour).
 * @returns {Promise<string>} A time-limited pre-signed URL.
 */
const getPresignedDownloadUrl = async (s3Key, expiresInSeconds = 3600) => {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: s3Key,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });

  return url;
};

export { uploadFileToS3, getPresignedDownloadUrl };
