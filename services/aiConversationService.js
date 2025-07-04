// File: services/aiConversationService.js
// Description: AI-powered conversation analysis and insights
// Version: 1.0 - Complete conversation intelligence
// Location: services/aiConversationService.js

import OpenAI from 'openai';
import mongoose from 'mongoose';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Import models dynamically
let Interaction, Lead, Sale;

const initializeModels = async () => {
  if (!Interaction) {
    try {
      const { default: InteractionModel } = await import('../models/interactionModel.js');
      const { default: LeadModel } = await import('../models/leadModel.js');
      const { default: SaleModel } = await import('../models/salesModel.js');
      
      Interaction = InteractionModel;
      Lead = LeadModel;
      Sale = SaleModel;
      
      console.log('✅ AI Conversation models initialized');
    } catch (error) {
      console.error('❌ Failed to initialize AI Conversation models:', error.message);
      throw error;
    }
  }
};

/**
 * Analyze conversation sentiment and extract insights
 * @param {String} conversationText - The conversation text
 * @param {Object} context - Additional context (lead info, project details)
 * @returns {Object} Analysis results
 */
const analyzeConversation = async (conversationText, context = {}) => {
  try {
    console.log('🤖 Analyzing conversation with AI...');
    
    const prompt = `
You are an expert sales conversation analyst for real estate. Analyze the following conversation and provide structured insights.

CONVERSATION:
${conversationText}

CONTEXT:
- Lead Name: ${context.leadName || 'N/A'}
- Project: ${context.projectName || 'N/A'}
- Budget Range: ${context.budgetRange || 'N/A'}
- Timeline: ${context.timeline || 'N/A'}

ANALYZE AND RESPOND IN JSON FORMAT:
{
  "sentiment": {
    "overall": "positive|neutral|negative",
    "confidence": 0-100,
    "reasoning": "brief explanation"
  },
  "buyingSignals": [
    "list of positive buying signals detected"
  ],
  "objections": [
    "list of objections or concerns raised"
  ],
  "nextSteps": [
    "recommended immediate follow-up actions"
  ],
  "leadTemperature": "hot|warm|cold",
  "conversionProbability": 0-100,
  "keyTopics": [
    "main topics discussed"
  ],
  "riskFactors": [
    "potential deal risks identified"
  ],
  "opportunities": [
    "upselling or cross-selling opportunities"
  ],
  "summary": "brief 2-3 sentence summary of the conversation"
}

IMPORTANT: Respond ONLY with valid JSON. No additional text.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const analysisText = response.choices[0].message.content.trim();
    
    // Parse JSON response
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch (parseError) {
      console.warn('⚠️ Failed to parse AI response as JSON, using fallback');
      analysis = createFallbackAnalysis(conversationText);
    }
    
    // Enhance with additional metadata
    analysis.metadata = {
      analyzedAt: new Date(),
      tokensUsed: response.usage?.total_tokens || 0,
      processingTime: Date.now(),
      version: '1.0'
    };
    
    return analysis;
    
  } catch (error) {
    console.error('🤖 AI Conversation analysis failed:', error);
    return createFallbackAnalysis(conversationText);
  }
};

/**
 * Generate follow-up recommendations based on conversation analysis
 * @param {Object} analysis - Conversation analysis results
 * @param {Object} leadData - Lead information
 * @returns {Object} Follow-up recommendations
 */
const generateFollowUpRecommendations = async (analysis, leadData) => {
  try {
    // Safely handle potentially undefined arrays
    const objections = Array.isArray(analysis.objections) ? analysis.objections : [];
    const buyingSignals = Array.isArray(analysis.buyingSignals) ? analysis.buyingSignals : [];
    const sentiment = analysis.sentiment || { overall: 'neutral', confidence: 50 };
    
    const prompt = `
Based on this conversation analysis and lead data, generate specific follow-up recommendations:

CONVERSATION ANALYSIS:
- Sentiment: ${sentiment.overall} (${sentiment.confidence}% confidence)
- Lead Temperature: ${analysis.leadTemperature || 'warm'}
- Conversion Probability: ${analysis.conversionProbability || 50}%
- Key Objections: ${objections.join(', ') || 'None identified'}
- Buying Signals: ${buyingSignals.join(', ') || 'None identified'}

LEAD DATA:
- Current Status: ${leadData.status || 'Unknown'}
- Budget: ${leadData.budget?.min || 'N/A'} - ${leadData.budget?.max || 'N/A'}
- Timeline: ${leadData.requirements?.timeline || 'N/A'}
- Source: ${leadData.source || 'N/A'}

Generate actionable recommendations in JSON format:
{
  "immediateActions": [
    {
      "action": "specific action to take",
      "priority": "high|medium|low",
      "timeline": "when to do it",
      "reasoning": "why this action"
    }
  ],
  "longTermStrategy": [
    {
      "strategy": "long-term approach",
      "timeline": "timeframe",
      "expectedOutcome": "what to expect"
    }
  ],
  "communicationPlan": {
    "nextContactDate": "YYYY-MM-DD",
    "preferredMethod": "call|email|whatsapp|meeting",
    "keyMessaging": ["main points to communicate"],
    "materialsNeeded": ["brochures, floor plans, etc."]
  },
  "riskMitigation": [
    {
      "risk": "identified risk",
      "mitigation": "how to address it"
    }
  ]
}

Respond ONLY with valid JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 800,
    });

    const recommendationsText = response.choices[0].message.content.trim();
    
    try {
      return JSON.parse(recommendationsText);
    } catch (parseError) {
      return createFallbackRecommendations(analysis, leadData);
    }
    
  } catch (error) {
    console.error('🤖 Follow-up recommendations failed:', error);
    return createFallbackRecommendations(analysis, leadData);
  }
};

/**
 * Analyze lead interaction patterns and predict conversion likelihood
 * @param {String} leadId - Lead ID
 * @returns {Object} Interaction pattern analysis
 */
const analyzeInteractionPatterns = async (leadId) => {
  try {
    await initializeModels();
    
    console.log('📊 Analyzing interaction patterns for lead:', leadId);
    
    // Get all interactions for the lead
    const interactions = await Interaction.find({ lead: leadId })
      .sort({ createdAt: 1 })
      .populate('createdBy', 'firstName lastName role');
    
    if (interactions.length === 0) {
      return {
        status: 'no_data',
        message: 'No interactions found for analysis',
        conversionProbability: 10
      };
    }
    
    // Analyze interaction patterns
    const analysis = {
      totalInteractions: interactions.length,
      timespan: calculateTimespan(interactions),
      frequency: calculateInteractionFrequency(interactions),
      engagement: analyzeEngagementLevel(interactions),
      progression: analyzeStatusProgression(interactions),
      responsePattern: analyzeResponsePattern(interactions),
      conversionProbability: 0
    };
    
    // Calculate conversion probability using AI
    const conversionProbability = await predictConversionLikelihood(analysis, interactions);
    analysis.conversionProbability = conversionProbability;
    
    return analysis;
    
  } catch (error) {
    console.error('📊 Interaction pattern analysis failed:', error);
    throw error;
  }
};

/**
 * Generate conversation summary for a lead
 * @param {String} leadId - Lead ID
 * @param {Number} days - Number of days to look back (default: 30)
 * @returns {Object} Conversation summary
 */
const generateConversationSummary = async (leadId, days = 30) => {
  try {
    await initializeModels();
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get recent interactions
    const interactions = await Interaction.find({
      lead: leadId,
      createdAt: { $gte: startDate }
    }).sort({ createdAt: -1 });
    
    if (interactions.length === 0) {
      return {
        status: 'no_recent_activity',
        message: `No interactions in the last ${days} days`
      };
    }
    
    // Compile conversation text
    const conversationText = interactions
      .map(interaction => `[${interaction.type}] ${interaction.content || interaction.notes || interaction.summary || 'No content'}`)
      .join('\n\n');
    
    // Generate AI summary
    const prompt = `
Summarize this lead's conversation history over the last ${days} days:

${conversationText}

Provide a concise summary in JSON format:
{
  "overallProgress": "improving|stable|declining",
  "keyDevelopments": ["major updates or changes"],
  "leadStatus": "hot|warm|cold|dead",
  "mainConcerns": ["primary objections or concerns"],
  "positiveSignals": ["encouraging developments"],
  "recommendedActions": ["immediate next steps"],
  "summary": "3-sentence summary of the lead's journey"
}

Respond ONLY with valid JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 600,
    });

    const summaryText = response.choices[0].message.content.trim();
    
    try {
      const summary = JSON.parse(summaryText);
      summary.metadata = {
        interactionsAnalyzed: interactions.length,
        periodDays: days,
        generatedAt: new Date()
      };
      return summary;
    } catch (parseError) {
      return createFallbackSummary(interactions, days);
    }
    
  } catch (error) {
    console.error('📝 Conversation summary generation failed:', error);
    throw error;
  }
};

// ====================================================================
// HELPER FUNCTIONS
// ====================================================================

const createFallbackAnalysis = (conversationText) => {
  const wordCount = conversationText.split(' ').length;
  const hasPositiveWords = /\b(interested|good|yes|like|want|need|when|how|price)\b/i.test(conversationText);
  const hasNegativeWords = /\b(no|not|cant|expensive|think|maybe|later)\b/i.test(conversationText);
  
  return {
    sentiment: {
      overall: hasPositiveWords && !hasNegativeWords ? 'positive' : hasNegativeWords ? 'negative' : 'neutral',
      confidence: 60,
      reasoning: 'Basic keyword analysis'
    },
    buyingSignals: hasPositiveWords ? ['Expressed interest', 'Asked questions'] : [],
    objections: hasNegativeWords ? ['Showed hesitation'] : [],
    nextSteps: ['Follow up within 24 hours'],
    leadTemperature: hasPositiveWords ? 'warm' : 'cold',
    conversionProbability: hasPositiveWords ? 65 : 25,
    keyTopics: ['General inquiry'],
    riskFactors: hasNegativeWords ? ['Price sensitivity'] : [],
    opportunities: ['Product demonstration'],
    summary: `Conversation of ${wordCount} words showing ${hasPositiveWords ? 'some' : 'limited'} interest.`
  };
};

const createFallbackRecommendations = (analysis, leadData) => {
  return {
    immediateActions: [
      {
        action: 'Follow up within 24 hours',
        priority: 'high',
        timeline: 'Today',
        reasoning: 'Maintain engagement momentum'
      }
    ],
    longTermStrategy: [
      {
        strategy: 'Regular touchpoints',
        timeline: 'Weekly',
        expectedOutcome: 'Build relationship and trust'
      }
    ],
    communicationPlan: {
      nextContactDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      preferredMethod: 'call',
      keyMessaging: ['Value proposition', 'Address concerns'],
      materialsNeeded: ['Project brochure', 'Price sheet']
    },
    riskMitigation: [
      {
        risk: 'Lost interest',
        mitigation: 'Provide relevant information and maintain regular contact'
      }
    ]
  };
};

const createFallbackSummary = (interactions, days) => {
  return {
    overallProgress: 'stable',
    keyDevelopments: [`${interactions.length} interactions in ${days} days`],
    leadStatus: 'warm',
    mainConcerns: ['Follow-up needed'],
    positiveSignals: ['Ongoing engagement'],
    recommendedActions: ['Continue regular follow-up'],
    summary: `Lead has had ${interactions.length} interactions over ${days} days showing moderate engagement.`,
    metadata: {
      interactionsAnalyzed: interactions.length,
      periodDays: days,
      generatedAt: new Date(),
      fallback: true
    }
  };
};

const calculateTimespan = (interactions) => {
  if (interactions.length < 2) return { days: 0, weeks: 0 };
  
  const first = interactions[0].createdAt;
  const last = interactions[interactions.length - 1].createdAt;
  const diffMs = last - first;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  return { days, weeks: Math.floor(days / 7) };
};

const calculateInteractionFrequency = (interactions) => {
  const timespan = calculateTimespan(interactions);
  const frequency = timespan.days > 0 ? interactions.length / timespan.days : 0;
  
  return {
    perDay: Number(frequency.toFixed(2)),
    perWeek: Number((frequency * 7).toFixed(2)),
    category: frequency > 0.5 ? 'high' : frequency > 0.2 ? 'medium' : 'low'
  };
};

const analyzeEngagementLevel = (interactions) => {
  const responseInteractions = interactions.filter(i => 
    (i.type === 'Call' && i.outcome === 'connected') || 
    (i.type === 'Email' && i.outcome === 'replied') ||
    i.type === 'Meeting'
  );
  
  const engagementRate = interactions.length > 0 ? responseInteractions.length / interactions.length : 0;
  
  return {
    responseRate: Number((engagementRate * 100).toFixed(1)),
    level: engagementRate > 0.7 ? 'high' : engagementRate > 0.4 ? 'medium' : 'low',
    responsiveInteractions: responseInteractions.length,
    totalInteractions: interactions.length
  };
};

const analyzeStatusProgression = (interactions) => {
  const statusChanges = interactions.filter(i => i.type === 'status_change');
  return {
    hasProgression: statusChanges.length > 0,
    statusChanges: statusChanges.length,
    direction: statusChanges.length > 0 ? 'forward' : 'stable'
  };
};

const analyzeResponsePattern = (interactions) => {
  const callInteractions = interactions.filter(i => i.type === 'Call');
  const connected = callInteractions.filter(i => i.outcome === 'connected');
  
  return {
    callAttempts: callInteractions.length,
    successfulCalls: connected.length,
    callSuccessRate: callInteractions.length > 0 ? Number(((connected.length / callInteractions.length) * 100).toFixed(1)) : 0,
    pattern: connected.length > callInteractions.length * 0.7 ? 'responsive' : 'difficult_to_reach'
  };
};

const predictConversionLikelihood = async (analysis, interactions) => {
  // Simple scoring algorithm - can be enhanced with ML models
  let score = 30; // Base score
  
  // Engagement boost
  if (analysis.engagement.level === 'high') score += 25;
  else if (analysis.engagement.level === 'medium') score += 15;
  
  // Frequency boost
  if (analysis.frequency.category === 'high') score += 20;
  else if (analysis.frequency.category === 'medium') score += 10;
  
  // Response pattern boost
  if (analysis.responsePattern.pattern === 'responsive') score += 15;
  
  // Status progression boost
  if (analysis.progression.hasProgression) score += 10;
  
  return Math.min(95, Math.max(5, score));
};

// Export all functions
export {
  analyzeConversation,
  generateFollowUpRecommendations,
  analyzeInteractionPatterns,
  generateConversationSummary
};