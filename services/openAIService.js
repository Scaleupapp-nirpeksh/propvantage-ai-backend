// File: services/openAIService.js
// Description: Centralized service for interacting with the OpenAI API.

import OpenAI from 'openai';

// Initialize the OpenAI client with the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates sales insights for a given lead by calling the OpenAI API.
 * It constructs a detailed prompt with the lead's information and asks the model
 * to provide actionable insights for a salesperson.
 *
 * @param {object} leadData - The lead object from the database.
 * @returns {Promise<string>} A string containing the AI-generated insights.
 */
const getSalesInsightsForLead = async (leadData) => {
  // Construct a detailed prompt for the AI model
  const prompt = `
    You are an expert real estate sales coach named "PropVantage AI Co-Pilot".
    Analyze the following real estate lead and provide concise, actionable insights for a sales executive.
    The response should be in simple, easy-to-read text, not JSON.

    **Lead Details:**
    - Name: ${leadData.firstName} ${leadData.lastName || ''}
    - Source: ${leadData.source}
    - Status: ${leadData.status}
    - Budget: ${leadData.budget?.min || 'N/A'} to ${leadData.budget?.max || 'N/A'}
    - Requirements: ${leadData.requirements?.notes || 'No specific notes.'}
    - Unit Types of Interest: ${leadData.requirements?.unitTypes?.join(', ') || 'N/A'}

    **Your Task:**
    Based on the details above, provide the following in bullet points:
    1.  **Key Buying Motivators:** What are the likely primary drivers for this lead's purchase?
    2.  **Potential Objections:** What are the most probable objections this lead might raise?
    3.  **Recommended Opening Line:** Suggest a specific, personalized opening line for the first call.
    4.  **Strategic Questions to Ask:** List 2-3 key questions to ask to better qualify and understand the lead's needs.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4', // Using a powerful model for better insights
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5, // A balance between creativity and determinism
      max_tokens: 500, // Limit the response length to keep it concise
    });

    // Return the content of the AI's response
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error fetching insights from OpenAI:', error);
    // In a real-world scenario, you might have more robust error handling or fallbacks
    throw new Error('Failed to generate AI insights.');
  }
};

export { getSalesInsightsForLead };
