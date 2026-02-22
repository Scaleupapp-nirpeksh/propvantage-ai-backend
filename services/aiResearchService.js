// File: services/aiResearchService.js
// Description: AI Web Research service using OpenAI GPT-4o Search Preview
// to automatically research competitor real estate pricing data from the web.

import OpenAI from 'openai';
import mongoose from 'mongoose';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model for web search — has built-in web browsing capability
const SEARCH_MODEL = 'gpt-4o-search-preview';
// Model for structured extraction — reliable JSON output
const EXTRACTION_MODEL = 'gpt-4';

// ─── Research Prompts ─────────────────────────────────────────

/**
 * Build the web search prompt for a given locality.
 */
const buildSearchPrompt = (city, area, projectType, additionalContext) => {
  const typeFilter = projectType ? `${projectType} ` : 'residential ';
  const extra = additionalContext ? `\n\nAdditional context: ${additionalContext}` : '';

  return `You are a real estate market research analyst specializing in Indian property markets.

Research and list ALL major ${typeFilter}real estate projects currently available for sale in ${area}, ${city}, India.

For EACH project you find, provide as much of the following as possible:
- Project name (exact)
- Developer/builder name
- RERA registration number (if available)
- Price per square foot (range: min to max, and average if known)
- Total base price range (for the cheapest to most expensive unit)
- Unit types available (1BHK, 2BHK, 3BHK, 4BHK, Penthouse, Studio, Villa, etc.)
- Carpet area / built-up area / super built-up area ranges for each unit type
- Floor rise charge per floor
- Facing premiums (park facing, road facing, corner unit)
- PLC (Preferential Location Charges)
- Parking charges (covered and open)
- Club membership charges
- Maintenance deposit
- Legal charges
- GST rate applicable
- Stamp duty rate
- Project status (Pre-launch, Newly Launched, Under Construction, Ready to Move, Completed)
- Expected possession date
- Total number of units and towers
- Total project area in acres
- Key amenities (gym, swimming pool, clubhouse, garden, etc.)
- Payment plan types offered (construction-linked, subvention, flexi, etc.)

Search across property portals (99acres, MagicBricks, Housing.com, Square Yards, CommonFloor), developer official websites, RERA portals, and any real estate news articles.

Be thorough — include both well-known developers and smaller local projects. Provide actual numbers, not estimates, wherever possible. If a data point is estimated rather than verified, note that explicitly.${extra}`;
};

/**
 * Build the structured extraction prompt.
 */
const buildExtractionPrompt = (rawResearch, city, area) => {
  return `You are a data extraction specialist. Parse the following real estate market research for ${area}, ${city} into a structured JSON array.

IMPORTANT RULES:
1. Return ONLY valid JSON — no markdown, no comments, no explanation.
2. Return an object with a "projects" key containing an array.
3. For numeric fields, use numbers (not strings). Use null for unknown values.
4. Price amounts should be in INR (not lakhs/crores — convert to absolute numbers).
   - 1 Lakh = 100000, 1 Crore = 10000000
   - "₹85 Lakhs" = 8500000, "₹1.2 Cr" = 12000000, "₹8,500/sqft" = 8500
5. For boolean amenities, use true/false.
6. confidence should be 30-80: 30 for estimated/guessed data, 50 for partially verified, 70-80 for data with clear sources.

Required JSON schema:
{
  "projects": [
    {
      "projectName": "string",
      "developerName": "string",
      "reraNumber": "string or null",
      "location": {
        "city": "${city}",
        "area": "${area}",
        "state": "string",
        "pincode": "string or null"
      },
      "projectType": "residential|commercial|mixed_use|plotted_development",
      "projectStatus": "pre_launch|newly_launched|under_construction|ready_to_move|completed",
      "possessionTimeline": {
        "description": "string, e.g. Dec 2027"
      },
      "totalUnits": "number or null",
      "totalTowers": "number or null",
      "totalAreaAcres": "number or null",
      "pricing": {
        "pricePerSqft": { "min": "number", "max": "number", "avg": "number" },
        "basePriceRange": { "min": "number", "max": "number" },
        "floorRiseCharge": "number (per floor, 0 if unknown)",
        "facingPremiums": {
          "parkFacing": "number (0 if unknown)",
          "roadFacing": "number (0 if unknown)",
          "cornerUnit": "number (0 if unknown)"
        },
        "plcCharges": "number (0 if unknown)",
        "parkingCharges": { "covered": "number", "open": "number" },
        "clubMembershipCharges": "number",
        "maintenanceDeposit": "number",
        "legalCharges": "number",
        "gstRate": "number (default 5)",
        "stampDutyRate": "number or null"
      },
      "unitMix": [
        {
          "unitType": "1BHK|2BHK|3BHK|4BHK|5BHK|Penthouse|Studio|Villa|Shop|Office",
          "carpetAreaRange": { "min": "number", "max": "number" },
          "builtUpAreaRange": { "min": "number", "max": "number" },
          "superBuiltUpAreaRange": { "min": "number", "max": "number" },
          "priceRange": { "min": "number", "max": "number" },
          "pricePerSqftRange": { "min": "number", "max": "number" },
          "totalCount": "number or null"
        }
      ],
      "amenities": {
        "gym": "boolean",
        "swimmingPool": "boolean",
        "clubhouse": "boolean",
        "garden": "boolean",
        "playground": "boolean",
        "powerBackup": "boolean",
        "security24x7": "boolean",
        "lifts": "boolean",
        "joggingTrack": "boolean",
        "indoorGames": "boolean",
        "multipurposeHall": "boolean",
        "rainwaterHarvesting": "boolean",
        "solarPanels": "boolean",
        "evCharging": "boolean",
        "concierge": "boolean",
        "coWorkingSpace": "boolean",
        "other": ["string"]
      },
      "paymentPlans": [
        {
          "planName": "string",
          "planType": "construction_linked|time_based|subvention|flexi|possession_linked|other",
          "bookingPercentage": "number or null"
        }
      ],
      "confidence": "number 30-80"
    }
  ]
}

RAW RESEARCH DATA:
${rawResearch}`;
};

// ─── Core Research Function ───────────────────────────────────

/**
 * Execute AI-powered web research for a locality.
 *
 * @param {Object} params
 * @param {ObjectId} params.organizationId
 * @param {string} params.city
 * @param {string} params.area
 * @param {string} [params.projectType] - Filter by project type
 * @param {string} [params.additionalContext] - Extra context for the search
 * @param {ObjectId} params.userId - Who triggered the research
 * @returns {Object} Research results
 */
const executeResearch = async ({
  organizationId,
  city,
  area,
  projectType,
  additionalContext,
  userId,
}) => {
  const startTime = Date.now();
  const researchId = new mongoose.Types.ObjectId().toString();
  const warnings = [];
  const sources = [];

  // Dynamically import CompetitorProject to avoid circular dependencies
  const { default: CompetitorProject } = await import(
    '../models/competitorProjectModel.js'
  );

  // ── Step 1: Web Search ──────────────────────────────────
  console.log(`[AI Research] Starting research for ${area}, ${city}...`);

  const searchPrompt = buildSearchPrompt(city, area, projectType, additionalContext);

  let rawResearch;
  try {
    const searchResponse = await openai.chat.completions.create({
      model: SEARCH_MODEL,
      messages: [{ role: 'user', content: searchPrompt }],
      temperature: 0.3,
      max_tokens: 4000,
    });

    rawResearch = searchResponse.choices[0].message.content;

    // Extract citations/URLs if present in the response
    const urlPattern = /https?:\/\/[^\s)"\]]+/g;
    const foundUrls = rawResearch.match(urlPattern) || [];
    foundUrls.forEach((url) => {
      sources.push({ url, title: url.split('/').pop() || url });
    });

    console.log(
      `[AI Research] Web search complete. Response length: ${rawResearch.length} chars, Sources found: ${sources.length}`
    );
  } catch (err) {
    console.error('[AI Research] Web search failed:', err.message);
    throw new Error(`AI web search failed: ${err.message}`);
  }

  // ── Step 2: Structured Extraction ───────────────────────
  console.log('[AI Research] Extracting structured data...');

  let parsedProjects;
  const extractionPrompt = buildExtractionPrompt(rawResearch, city, area);

  // Try extraction with retry on JSON parse failure
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const extractionResponse = await openai.chat.completions.create({
        model: EXTRACTION_MODEL,
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: attempt === 1 ? 0.2 : 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      });

      const content = extractionResponse.choices[0].message.content;
      const parsed = JSON.parse(content);
      parsedProjects = parsed.projects || parsed;

      if (!Array.isArray(parsedProjects)) {
        throw new Error('Expected an array of projects');
      }

      console.log(
        `[AI Research] Extracted ${parsedProjects.length} projects (attempt ${attempt})`
      );
      break;
    } catch (err) {
      if (attempt === 2) {
        console.error('[AI Research] Extraction failed after 2 attempts:', err.message);
        throw new Error(`Failed to extract structured data: ${err.message}`);
      }
      warnings.push(`Extraction attempt ${attempt} failed, retrying...`);
    }
  }

  // ── Step 3: Validate, Deduplicate, Upsert ──────────────
  console.log('[AI Research] Upserting into database...');

  let created = 0;
  let updated = 0;
  const savedProjects = [];

  for (const projectData of parsedProjects) {
    try {
      // Validate required fields
      if (!projectData.projectName || !projectData.developerName) {
        warnings.push(
          `Skipped project with missing name/developer: ${JSON.stringify(projectData.projectName)}`
        );
        continue;
      }

      // Check for existing record (deduplication)
      const existing = await CompetitorProject.findOne({
        organization: organizationId,
        projectName: new RegExp(`^${projectData.projectName.trim()}$`, 'i'),
        'location.area': new RegExp(`^${area.trim()}$`, 'i'),
      });

      if (existing) {
        // Merge: only update fields that are null/empty in existing record
        let fieldsUpdated = 0;

        // Helper to conditionally update a field
        const mergeField = (path, value) => {
          if (value === null || value === undefined) return;
          const parts = path.split('.');
          let current = existing;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) return;
            current = current[parts[i]];
          }
          const lastKey = parts[parts.length - 1];
          if (
            current[lastKey] === null ||
            current[lastKey] === undefined ||
            current[lastKey] === 0
          ) {
            current[lastKey] = value;
            fieldsUpdated++;
          }
        };

        // Merge pricing data
        if (projectData.pricing) {
          mergeField('pricing.pricePerSqft.min', projectData.pricing.pricePerSqft?.min);
          mergeField('pricing.pricePerSqft.max', projectData.pricing.pricePerSqft?.max);
          mergeField('pricing.pricePerSqft.avg', projectData.pricing.pricePerSqft?.avg);
          mergeField('pricing.floorRiseCharge', projectData.pricing.floorRiseCharge);
          mergeField('pricing.parkingCharges.covered', projectData.pricing.parkingCharges?.covered);
          mergeField('pricing.parkingCharges.open', projectData.pricing.parkingCharges?.open);
        }

        // Merge scale data
        mergeField('totalUnits', projectData.totalUnits);
        mergeField('totalTowers', projectData.totalTowers);
        mergeField('reraNumber', projectData.reraNumber);

        if (fieldsUpdated > 0) {
          existing.updatedBy = userId;
          existing.dataProvenance.push({
            field: 'multiple',
            source: 'ai_research',
            collectedAt: new Date(),
            collectedBy: userId,
            confidence: 'estimated',
            notes: `AI research enriched ${fieldsUpdated} fields`,
          });
          await existing.save();
          updated++;
          savedProjects.push(existing);
        }
      } else {
        // Create new record
        const newDoc = await CompetitorProject.create({
          organization: organizationId,
          projectName: projectData.projectName.trim(),
          developerName: projectData.developerName.trim(),
          reraNumber: projectData.reraNumber || null,
          location: {
            city,
            area,
            state: projectData.location?.state || null,
            pincode: projectData.location?.pincode || null,
          },
          projectType: projectData.projectType || 'residential',
          projectStatus: projectData.projectStatus || 'under_construction',
          possessionTimeline: projectData.possessionTimeline || {},
          totalUnits: projectData.totalUnits || null,
          totalTowers: projectData.totalTowers || null,
          totalAreaAcres: projectData.totalAreaAcres || null,
          pricing: projectData.pricing || {},
          unitMix: projectData.unitMix || [],
          amenities: projectData.amenities || {},
          paymentPlans: projectData.paymentPlans || [],
          dataSource: 'ai_research',
          dataCollectionDate: new Date(),
          confidenceScore: projectData.confidence || 50,
          dataProvenance: [
            {
              field: 'all',
              source: 'ai_research',
              collectedAt: new Date(),
              collectedBy: userId,
              confidence: 'estimated',
              notes: `Auto-researched via GPT-4 web search for ${area}, ${city}`,
            },
          ],
          createdBy: userId,
        });

        created++;
        savedProjects.push(newDoc);
      }
    } catch (err) {
      // Handle unique index violation gracefully
      if (err.code === 11000) {
        warnings.push(
          `Duplicate detected for "${projectData.projectName}" — skipped`
        );
      } else {
        warnings.push(
          `Error saving "${projectData.projectName}": ${err.message}`
        );
      }
    }
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[AI Research] Complete. Created: ${created}, Updated: ${updated}, Duration: ${durationMs}ms`
  );

  return {
    researchId,
    status: warnings.length > parsedProjects.length / 2 ? 'partial' : 'completed',
    projectsFound: parsedProjects.length,
    projectsCreated: created,
    projectsUpdated: updated,
    projects: savedProjects,
    sources: sources.slice(0, 20), // Limit to 20 sources
    researchSummary: `Found ${parsedProjects.length} projects in ${area}, ${city}. Created ${created} new records, enriched ${updated} existing records.`,
    warnings,
    cost: {
      searchQueries: 1,
      extractionQueries: 1,
      estimatedCost: '$0.15-0.25',
    },
    durationMs,
  };
};

export { executeResearch };
