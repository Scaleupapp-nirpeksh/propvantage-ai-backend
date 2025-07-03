// File: services/backgroundJobService.js
// Description: Simple background job service for handling score updates without Redis/Bull

import { bulkUpdateLeadScores } from './leadScoringService.js';
import Lead from '../models/leadModel.js';
import cron from 'node-cron';

/**
 * Background job queue using simple JavaScript arrays
 * This is a lightweight alternative to Redis-based queues
 */
class BackgroundJobService {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.maxConcurrent = 5;
    this.currentJobs = 0;
    this.jobHistory = [];
    this.maxHistorySize = 100;
    
    // Start processing jobs
    this.startProcessing();
    
    // Schedule recurring jobs
    this.scheduleRecurringJobs();
  }

  /**
   * Add a job to the queue
   * @param {string} type - Job type
   * @param {Object} data - Job data
   * @param {Object} options - Job options
   */
  addJob(type, data, options = {}) {
    const job = {
      id: this.generateJobId(),
      type,
      data,
      options,
      status: 'pending',
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      delay: options.delay || 0
    };

    this.queue.push(job);
    console.log(`📋 Background job added: ${type} (ID: ${job.id})`);
    
    return job.id;
  }

  /**
   * Process jobs in the queue
   */
  async startProcessing() {
    setInterval(async () => {
      if (this.isProcessing || this.currentJobs >= this.maxConcurrent) {
        return;
      }

      const job = this.getNextJob();
      if (!job) {
        return;
      }

      this.currentJobs++;
      await this.processJob(job);
      this.currentJobs--;
    }, 1000); // Check every second
  }

  /**
   * Get the next job from the queue
   */
  getNextJob() {
    const now = new Date();
    
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i];
      const jobTime = new Date(job.createdAt.getTime() + job.delay);
      
      if (job.status === 'pending' && jobTime <= now) {
        return this.queue.splice(i, 1)[0];
      }
    }
    
    return null;
  }

  /**
   * Process an individual job
   */
  async processJob(job) {
    try {
      job.status = 'processing';
      job.startedAt = new Date();
      
      console.log(`🔄 Processing job: ${job.type} (ID: ${job.id})`);
      
      await this.executeJob(job);
      
      job.status = 'completed';
      job.completedAt = new Date();
      job.duration = job.completedAt - job.startedAt;
      
      console.log(`✅ Job completed: ${job.type} (ID: ${job.id}) in ${job.duration}ms`);
      
    } catch (error) {
      job.attempts++;
      job.lastError = error.message;
      job.lastAttemptAt = new Date();
      
      console.error(`❌ Job failed: ${job.type} (ID: ${job.id}) - ${error.message}`);
      
      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff
        job.delay = Math.pow(2, job.attempts) * 1000;
        job.status = 'pending';
        this.queue.push(job);
        console.log(`🔄 Job queued for retry: ${job.type} (ID: ${job.id}) in ${job.delay}ms`);
      } else {
        job.status = 'failed';
        job.failedAt = new Date();
        console.error(`💀 Job permanently failed: ${job.type} (ID: ${job.id})`);
      }
    }
    
    this.addToHistory(job);
  }

  /**
   * Execute job based on type
   */
  async executeJob(job) {
    switch (job.type) {
      case 'UPDATE_LEAD_SCORE':
        await this.updateLeadScore(job.data);
        break;
      case 'BULK_UPDATE_SCORES':
        await this.bulkUpdateScores(job.data);
        break;
      case 'CLEANUP_STALE_SCORES':
        await this.cleanupStaleScores(job.data);
        break;
      case 'UPDATE_ENGAGEMENT_METRICS':
        await this.updateEngagementMetrics(job.data);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  /**
   * Update single lead score
   */
  async updateLeadScore(data) {
    const { leadId } = data;
    const { updateLeadScore } = await import('./leadScoringService.js');
    await updateLeadScore(leadId);
  }

  /**
   * Bulk update lead scores
   */
  async bulkUpdateScores(data) {
    const { leadIds, organizationId } = data;
    
    if (leadIds && leadIds.length > 0) {
      await bulkUpdateLeadScores(leadIds);
    } else if (organizationId) {
      // Find leads needing score updates
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const staleLeads = await Lead.find({
        organization: organizationId,
        lastScoreUpdate: { $lt: sevenDaysAgo },
        status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
      }).select('_id').limit(50);
      
      if (staleLeads.length > 0) {
        const leadIds = staleLeads.map(lead => lead._id.toString());
        await bulkUpdateLeadScores(leadIds);
      }
    }
  }

  /**
   * Clean up stale score data
   */
  async cleanupStaleScores(data) {
    const { organizationId } = data;
    
    // Find leads with very old scores that might need reset
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const oldLeads = await Lead.find({
      organization: organizationId,
      lastScoreUpdate: { $lt: thirtyDaysAgo },
      status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
    }).select('_id').limit(25);
    
    if (oldLeads.length > 0) {
      const leadIds = oldLeads.map(lead => lead._id.toString());
      await bulkUpdateLeadScores(leadIds);
    }
  }

  /**
   * Update engagement metrics for leads
   */
  async updateEngagementMetrics(data) {
    const { leadId } = data;
    const lead = await Lead.findById(leadId);
    
    if (lead) {
      await lead.updateEngagementMetrics();
      await lead.save();
    }
  }

  /**
   * Add completed job to history
   */
  addToHistory(job) {
    this.jobHistory.unshift(job);
    
    if (this.jobHistory.length > this.maxHistorySize) {
      this.jobHistory = this.jobHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * Generate unique job ID
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      pending: this.queue.filter(job => job.status === 'pending').length,
      processing: this.currentJobs,
      completed: this.jobHistory.filter(job => job.status === 'completed').length,
      failed: this.jobHistory.filter(job => job.status === 'failed').length,
      totalInQueue: this.queue.length
    };
  }

  /**
   * Schedule recurring jobs using cron
   */
  scheduleRecurringJobs() {
    // Update stale scores every 6 hours
    cron.schedule('0 */6 * * *', () => {
      console.log('🕐 Scheduled job: Updating stale lead scores');
      this.addJob('CLEANUP_STALE_SCORES', {
        organizationId: 'all' // Process all organizations
      });
    });

    // Clean up completed jobs every day at midnight
    cron.schedule('0 0 * * *', () => {
      console.log('🧹 Scheduled job: Cleaning up job history');
      this.cleanupJobHistory();
    });
  }

  /**
   * Clean up old job history
   */
  cleanupJobHistory() {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    this.jobHistory = this.jobHistory.filter(job => {
      const jobDate = job.completedAt || job.failedAt || job.createdAt;
      return jobDate > oneDayAgo;
    });
    
    console.log(`🧹 Job history cleaned up. Remaining: ${this.jobHistory.length} jobs`);
  }
}

// Create singleton instance
const backgroundJobService = new BackgroundJobService();

// Helper functions to add specific job types
export const addLeadScoreUpdateJob = (leadId, options = {}) => {
  return backgroundJobService.addJob('UPDATE_LEAD_SCORE', { leadId }, options);
};

export const addBulkScoreUpdateJob = (leadIds, organizationId, options = {}) => {
  return backgroundJobService.addJob('BULK_UPDATE_SCORES', { leadIds, organizationId }, options);
};

export const addEngagementMetricsUpdateJob = (leadId, options = {}) => {
  return backgroundJobService.addJob('UPDATE_ENGAGEMENT_METRICS', { leadId }, options);
};

export const getJobQueueStatus = () => {
  return backgroundJobService.getQueueStatus();
};

export default backgroundJobService;