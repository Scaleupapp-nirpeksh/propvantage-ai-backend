// File: models/fileModel.js
// Description: Defines the Mongoose schema for storing metadata about uploaded files.

import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    // The resource this file is associated with (e.g., a Project or a Lead)
    associatedResource: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'resourceType', // Dynamic reference based on the resourceType field
    },
    resourceType: {
      type: String,
      required: true,
      enum: ['Project', 'Lead', 'Unit'], // The model name of the associated resource
    },
    // Category of the file for organization
    category: {
      type: String,
      required: true,
      enum: ['Brochure', 'Floor Plan', 'Legal Document', 'Payment Receipt', 'Customer KYC', 'Other'],
    },
    // The original name of the file on the user's machine
    originalName: {
      type: String,
      required: true,
    },
    // The MIME type of the file (e.g., 'application/pdf', 'image/jpeg')
    mimeType: {
      type: String,
      required: true,
    },
    // The size of the file in bytes
    size: {
      type: Number,
      required: true,
    },
    // The URL where the file is stored (e.g., on AWS S3)
    url: {
      type: String,
      required: true,
    },
    // The key or path of the file in the storage bucket (useful for deletions)
    s3Key: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const File = mongoose.model('File', fileSchema);

export default File;
