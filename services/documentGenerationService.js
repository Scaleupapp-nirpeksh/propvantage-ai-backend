// File: services/documentGenerationService.js
// Description: Service for generating documents from templates

import DocumentTemplate from '../models/documentTemplateModel.js';
import File from '../models/fileModel.js';
import { uploadFileToS3 } from './s3Service.js';
import mongoose from 'mongoose';

/**
 * Generate document from template
 * @param {string} templateId - Template ID
 * @param {Object} data - Data to populate template
 * @param {Object} user - User generating the document
 * @param {string} associatedResource - Associated resource ID
 * @param {string} resourceType - Resource type
 * @returns {Object} Generated document information
 */
export const generateDocumentFromTemplate = async (templateId, data, user, associatedResource, resourceType) => {
  const startTime = Date.now();
  
  try {
    // Get template
    const template = await DocumentTemplate.findOne({
      _id: templateId,
      organization: user.organization,
      isActive: true
    }).populate('templateFile').populate('category');
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    // Check if user can use this template
    if (!template.canUserUse(user)) {
      throw new Error('You do not have permission to use this template');
    }
    
    // Validate template data
    const validation = template.validateTemplateData(data);
    if (!validation.isValid) {
      throw new Error(`Template data validation failed: ${validation.errors.join(', ')}`);
    }
    
    // Generate document based on template type
    let generatedDocument;
    switch (template.configuration.engine) {
      case 'handlebars':
        generatedDocument = await generateHandlebarsDocument(template, data, user);
        break;
      case 'mustache':
        generatedDocument = await generateMustacheDocument(template, data, user);
        break;
      case 'ejs':
        generatedDocument = await generateEjsDocument(template, data, user);
        break;
      default:
        generatedDocument = await generateSimpleDocument(template, data, user);
    }
    
    // Upload generated document to S3
    const folder = `generated-documents/${resourceType.toLowerCase()}s/${associatedResource}`;
    const fileName = `${template.name}-${Date.now()}.${template.configuration.outputFormat}`;
    
    const { url, s3Key } = await uploadFileToS3({
      buffer: generatedDocument.buffer,
      originalname: fileName,
      mimetype: generatedDocument.mimeType
    }, folder);
    
    // Create file record
    const fileRecord = await File.create({
      organization: user.organization,
      uploadedBy: user._id,
      category: template.category._id,
      associatedResource,
      resourceType,
      originalName: fileName,
      fileName,
      title: `${template.name} - Generated Document`,
      description: `Generated from template: ${template.name}`,
      tags: ['generated', 'template', template.type.toLowerCase()],
      mimeType: generatedDocument.mimeType,
      size: generatedDocument.buffer.length,
      url,
      s3Key,
      accessLevel: 'organization',
      customFields: new Map([
        ['templateId', templateId],
        ['templateName', template.name],
        ['generatedAt', new Date().toISOString()],
        ['templateData', JSON.stringify(data)]
      ]),
      approvalStatus: template.usage.requiresApproval ? 'pending' : 'not_required'
    });
    
    // Update template usage statistics
    const generationTime = Date.now() - startTime;
    await template.incrementUsage(generationTime);
    
    return {
      success: true,
      document: fileRecord,
      template: template.name,
      generationTime,
      message: 'Document generated successfully'
    };
    
  } catch (error) {
    throw new Error(`Document generation failed: ${error.message}`);
  }
};

/**
 * Generate document using simple text replacement
 * @param {Object} template - Template object
 * @param {Object} data - Data to populate
 * @param {Object} user - User generating document
 * @returns {Object} Generated document
 */
const generateSimpleDocument = async (template, data, user) => {
  try {
    // This is a simplified implementation
    // In a real application, you would use proper template engines
    
    let content = generateSimpleHtmlContent(template, data, user);
    
    // Convert to PDF if needed
    if (template.configuration.outputFormat === 'pdf') {
      const buffer = await convertHtmlToPdf(content, template.configuration.pageSettings);
      return {
        buffer,
        mimeType: 'application/pdf'
      };
    }
    
    // Return as HTML
    return {
      buffer: Buffer.from(content, 'utf8'),
      mimeType: 'text/html'
    };
    
  } catch (error) {
    throw new Error(`Simple document generation failed: ${error.message}`);
  }
};

/**
 * Generate simple HTML content from template
 * @param {Object} template - Template object
 * @param {Object} data - Data to populate
 * @param {Object} user - User generating document
 * @returns {string} HTML content
 */
const generateSimpleHtmlContent = (template, data, user) => {
  const currentDate = new Date().toLocaleDateString();
  const currentTime = new Date().toLocaleTimeString();
  
  // Basic HTML structure
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${template.name}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .title { font-size: 24px; font-weight: bold; color: #333; }
        .section { margin: 20px 0; }
        .field-group { margin: 15px 0; }
        .field-label { font-weight: bold; color: #555; }
        .field-value { margin-left: 10px; }
        .footer { border-top: 1px solid #ccc; padding-top: 20px; margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">${template.name}</div>
        <div>Generated on: ${currentDate} at ${currentTime}</div>
        <div>Generated by: ${user.firstName} ${user.lastName}</div>
      </div>
      
      <div class="content">
  `;
  
  // Group fields by sections
  const sections = template.sections.length > 0 ? template.sections : [{ 
    sectionName: 'default', 
    sectionLabel: 'Information', 
    fields: template.fields.map(f => f.fieldName) 
  }];
  
  sections.forEach(section => {
    html += `<div class="section">`;
    html += `<h3>${section.sectionLabel}</h3>`;
    
    section.fields.forEach(fieldName => {
      const field = template.fields.find(f => f.fieldName === fieldName);
      if (field && data[fieldName] !== undefined) {
        const value = formatFieldValue(data[fieldName], field.fieldType);
        html += `
          <div class="field-group">
            <span class="field-label">${field.fieldLabel}:</span>
            <span class="field-value">${value}</span>
          </div>
        `;
      }
    });
    
    html += `</div>`;
  });
  
  html += `
      </div>
      
      <div class="footer">
        <div>Document generated from template: ${template.name}</div>
        <div>Template ID: ${template._id}</div>
        <div>Organization: ${user.organization}</div>
      </div>
    </body>
    </html>
  `;
  
  return html;
};

/**
 * Format field value based on field type
 * @param {any} value - Field value
 * @param {string} fieldType - Field type
 * @returns {string} Formatted value
 */
const formatFieldValue = (value, fieldType) => {
  if (value === null || value === undefined) return '';
  
  switch (fieldType) {
    case 'date':
      return new Date(value).toLocaleDateString();
    case 'currency':
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR'
      }).format(value);
    case 'number':
      return new Intl.NumberFormat('en-IN').format(value);
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'email':
      return `<a href="mailto:${value}">${value}</a>`;
    case 'phone':
      return `<a href="tel:${value}">${value}</a>`;
    default:
      return String(value);
  }
};

/**
 * Convert HTML to PDF (simplified implementation)
 * @param {string} html - HTML content
 * @param {Object} pageSettings - Page settings
 * @returns {Buffer} PDF buffer
 */
const convertHtmlToPdf = async (html, pageSettings) => {
  // This is a placeholder implementation
  // In a real application, you would use libraries like puppeteer, html-pdf, or similar
  
  try {
    // For now, return HTML as buffer with PDF mime type
    // In production, implement actual PDF conversion
    return Buffer.from(html, 'utf8');
  } catch (error) {
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
};

/**
 * Generate document using Handlebars template engine
 * @param {Object} template - Template object
 * @param {Object} data - Data to populate
 * @param {Object} user - User generating document
 * @returns {Object} Generated document
 */
const generateHandlebarsDocument = async (template, data, user) => {
  // Placeholder for Handlebars implementation
  // Would require handlebars package: npm install handlebars
  return generateSimpleDocument(template, data, user);
};

/**
 * Generate document using Mustache template engine
 * @param {Object} template - Template object
 * @param {Object} data - Data to populate
 * @param {Object} user - User generating document
 * @returns {Object} Generated document
 */
const generateMustacheDocument = async (template, data, user) => {
  // Placeholder for Mustache implementation
  // Would require mustache package: npm install mustache
  return generateSimpleDocument(template, data, user);
};

/**
 * Generate document using EJS template engine
 * @param {Object} template - Template object
 * @param {Object} data - Data to populate
 * @param {Object} user - User generating document
 * @returns {Object} Generated document
 */
const generateEjsDocument = async (template, data, user) => {
  // Placeholder for EJS implementation
  // Would require ejs package: npm install ejs
  return generateSimpleDocument(template, data, user);
};

/**
 * Get template fields with data pre-filled from resource
 * @param {string} templateId - Template ID
 * @param {string} resourceId - Resource ID
 * @param {string} resourceType - Resource type
 * @param {Object} user - User requesting template
 * @returns {Object} Template with pre-filled data
 */
export const getTemplateWithPrefilledData = async (templateId, resourceId, resourceType, user) => {
  try {
    const template = await DocumentTemplate.findOne({
      _id: templateId,
      organization: user.organization,
      isActive: true
    }).populate('category');
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    if (!template.canUserUse(user)) {
      throw new Error('You do not have permission to use this template');
    }
    
    // Get resource data
    const ResourceModel = mongoose.model(resourceType);
    const resource = await ResourceModel.findOne({
      _id: resourceId,
      organization: user.organization
    }).populate('assignedTo project');
    
    if (!resource) {
      throw new Error(`${resourceType} not found`);
    }
    
    // Pre-fill template fields with resource data
    const prefilledData = {};
    
    template.fields.forEach(field => {
      // Map common field names to resource properties
      switch (field.fieldName.toLowerCase()) {
        case 'name':
        case 'fullname':
          if (resource.firstName) {
            prefilledData[field.fieldName] = `${resource.firstName} ${resource.lastName || ''}`.trim();
          }
          break;
        case 'firstname':
          if (resource.firstName) prefilledData[field.fieldName] = resource.firstName;
          break;
        case 'lastname':
          if (resource.lastName) prefilledData[field.fieldName] = resource.lastName;
          break;
        case 'email':
          if (resource.email) prefilledData[field.fieldName] = resource.email;
          break;
        case 'phone':
          if (resource.phone) prefilledData[field.fieldName] = resource.phone;
          break;
        case 'project':
        case 'projectname':
          if (resource.project?.name) prefilledData[field.fieldName] = resource.project.name;
          break;
        case 'date':
        case 'currentdate':
          prefilledData[field.fieldName] = new Date().toISOString().split('T')[0];
          break;
        case 'assignedto':
          if (resource.assignedTo) {
            prefilledData[field.fieldName] = `${resource.assignedTo.firstName} ${resource.assignedTo.lastName || ''}`.trim();
          }
          break;
        default:
          // Try to map field name directly to resource property
          if (resource[field.fieldName] !== undefined) {
            prefilledData[field.fieldName] = resource[field.fieldName];
          }
      }
    });
    
    return {
      template,
      prefilledData,
      resource
    };
    
  } catch (error) {
    throw new Error(`Failed to get template with prefilled data: ${error.message}`);
  }
};

/**
 * Get available templates for a resource type
 * @param {string} resourceType - Resource type
 * @param {Object} user - User requesting templates
 * @returns {Array} Available templates
 */
export const getAvailableTemplates = async (resourceType, user) => {
  try {
    const templates = await DocumentTemplate.getTemplatesByResourceType(
      user.organization,
      resourceType,
      user
    );
    
    return templates.map(template => ({
      _id: template._id,
      name: template.name,
      description: template.description,
      type: template.type,
      category: template.category,
      complexity: template.complexity,
      fieldsCount: template.fields.length,
      timesUsed: template.statistics.timesUsed,
      lastUsed: template.statistics.lastUsed
    }));
    
  } catch (error) {
    throw new Error(`Failed to get available templates: ${error.message}`);
  }
};

export default {
  generateDocumentFromTemplate,
  getTemplateWithPrefilledData,
  getAvailableTemplates
};