// File: services/people/demoSeedService.js
// Description: Owner-only demo-data seeder for the People & Performance module.
//   Creates realistic WeeklyReflections, Interactions, Tasks, Leads, and Sales
//   for demo environments so the performance dashboards show meaningful numbers.
//
//   seedDemoPeopleData(orgId, { weeks = 4 }) -> { reflections, interactions, morale, tasks, leadsConverted, salesCreated, activitySeeded, activitySkipReason }
//
//   Idempotent: reflections are skipped if they already exist for that user+week;
//   interactions are skipped if the member already has >= 10 in the last 14 days;
//   tasks are skipped if the member already has demo_seed tasks;
//   sales are skipped if the member already has sales recorded.
//   All AI calls (analyzeReflection, buildTeamMorale, buildOrgMorale) are best-effort
//   (errors are swallowed so a missing API key does not abort the seed).

import User             from '../../models/userModel.js';
import WeeklyReflection from '../../models/weeklyReflectionModel.js';
import Interaction      from '../../models/interactionModel.js';
import Lead             from '../../models/leadModel.js';
import Organization     from '../../models/organizationModel.js';
import Sale             from '../../models/salesModel.js';
import Unit             from '../../models/unitModel.js';
import Task             from '../../models/taskModel.js';
import Project          from '../../models/projectModel.js';
import {
  analyzeReflection,
  buildTeamMorale,
  buildOrgMorale,
} from './moraleService.js';
import { isoWeekOf, previousIsoWeek, boundsFromIsoWeek } from '../../utils/isoWeek.js';

// ─── COPY VARIANTS ────────────────────────────────────────────────────────────
// Three tone buckets ensure sentiment variety across members and weeks.
// Each bucket provides five answer fields (>= 500 chars each).

const TONE_UPBEAT = {
  wins: `This week was genuinely energising. I closed three deals with buyers who had been on the fence for months, and the personalised follow-up sequence I ran made a clear difference. The rapport I have built with channel partners is paying dividends — two of them referred clients to me unprompted. I also completed the CRM refresh on all my active leads, which gives me a much cleaner picture of the pipeline. The team energy has been high, and I feel like momentum is on our side heading into the next quarter. These results did not happen by accident — consistent effort over the past few weeks compounded into outcomes this week that I am proud of.`,
  areasToImprove: `I want to tighten the gap between initial enquiry and first site visit. Some leads waited longer than they should have because I was juggling too many tasks at once. I would also benefit from improving my product knowledge on the commercial inventory — a couple of questions from buyers caught me off-guard this week. Blocking focused deep-work time in my calendar and reducing ad-hoc interruptions would help me maintain quality across a larger portfolio without dropping the ball on any single lead. I plan to block two morning slots each week specifically for site briefings and product study to address this systematically.`,
  dislikes: `The manual data-entry burden between calls and the CRM is a real friction point. I end up spending 20-30 minutes every evening just logging call notes, which feels like time stolen from actual client engagement. The approval workflow for booking amendments is also slower than it needs to be — three rounds of emails for what should be a one-click process is demoralising when a client is waiting. Standardising approval SLAs and investing in voice-to-text logging would go a long way toward freeing up time for higher-value conversations. I have flagged these bottlenecks to the team lead and hope to see improvements next quarter.`,
  achievements: `Exceeded my monthly sales target by 15% and secured two referral introductions that are already progressing into qualified opportunities. I conducted a group site tour for six prospects simultaneously, which was efficient and generated positive word-of-mouth. I also mentored a junior team member on objection-handling techniques and watched them close their first independent deal, which was genuinely satisfying. The client satisfaction survey scores I received this week were the highest in the team. On top of all this, I completed all compliance documentation on time and without errors, which is always important for maintaining trust with the legal and finance teams.`,
  plansNextWeek: `I plan to schedule follow-up calls with eight warm leads from the last quarter who went quiet, using a new angle around the revised payment plan options. I will also prepare a comparative analysis of three projects for a high-intent buyer who is torn between options. Internally, I want to co-facilitate a short product knowledge session with the project team so the whole sales department feels more confident on technical questions. Finally, I will aim to reduce my average response time to inbound enquiries from four hours to under two, and track this metric daily so I can course-correct quickly if I slip.`,
};

const TONE_STRESSED = {
  wins: `Despite a challenging week, I managed to keep all active client conversations moving forward. I responded to every inbound enquiry within the same business day, even when the volume was unusually high. I coordinated with the legal team to unblock a documentation issue that had been holding up a booking, and the client was genuinely grateful for the persistence. I also updated all overdue CRM records, which had been accumulating for a couple of weeks because of the workload. Small wins, but they matter enormously when the week has been this demanding and every completed action feels like it was achieved against resistance.`,
  areasToImprove: `I need to find a more sustainable way to manage the workload spikes. This week I ended up skipping lunch three days running and working late most evenings, which is not a pattern I can maintain without burning out. Some of the pressure comes from unclear prioritisation signals from above — when everything is marked urgent, nothing really is. I want to have a direct conversation with my manager about setting realistic expectations and creating a buffer for unexpected tasks so that routine commitments do not fall through the cracks when volume increases. I also need to learn to delegate more confidently instead of trying to handle everything myself.`,
  dislikes: `I am genuinely frustrated by the inconsistency in lead allocation. Some team members seem to receive a disproportionate share of warm inbound leads while others, including me, are working almost entirely cold. The criteria for allocation are opaque, and the informal explanations I have received are not satisfying. I also found this week that a key piece of process documentation was out of date, which caused me to give a client incorrect information about a booking timeline. That situation should not be possible if our knowledge base were properly maintained and reviewed on a quarterly basis. Both issues need to be addressed at a structural level, not just case by case.`,
  achievements: `I managed to revive a deal that had stalled for six weeks by identifying a financing option the client had not considered. The deal is now very close to signing. I also delivered a product presentation to a group of corporate buyers on two days' notice, and the feedback from the lead was strong. On top of core work, I submitted the quarterly pipeline review on time and identified three leads that are unlikely to convert, freeing up capacity for higher-probability opportunities. Doing all of this during an unusually disruptive week makes these achievements feel meaningful. I also supported a colleague through a difficult client conversation, which helped them retain the relationship.`,
  plansNextWeek: `My priority next week is to close the revived deal and ensure the booking documentation is completed without delays. I also need to reconnect with five mid-pipeline leads that I was unable to reach this week due to the time pressure. I will prepare a structured weekly plan on Monday morning to reduce context-switching and protect time for deep work. I also intend to speak with my manager about the workload and lead allocation concerns — I want to approach it constructively and with specific suggestions rather than just raising the problem without solutions. Finally I will carve out two hours for self-care during the working day to avoid the burnout pattern repeating.`,
};

const TONE_NEUTRAL = {
  wins: `The week progressed at a steady pace. I completed all scheduled client calls and follow-ups without any slippage. The pipeline review meeting with the team was productive and gave me a clearer view of where bottlenecks are forming in the funnel. I updated the project specification documents for two leads who had requested additional information, and both acknowledged receipt and confirmed they are still actively evaluating their options. The administrative backlog from the previous week has been fully cleared, which sets me up better for the coming week and removes the background noise of pending tasks that had been affecting my focus.`,
  areasToImprove: `I want to spend more time on proactive outreach rather than reacting to incoming requests. My ratio of inbound-to-outbound activity has been skewing too far toward inbound this month, which limits the pipeline I am building independently. I also recognise that my follow-up notes in the CRM are sometimes too brief to be useful as a historical record, and I need to develop the discipline of writing richer summaries immediately after each interaction before the details fade. Small process improvements compounded over time will make a noticeable difference to my effectiveness and to the team's ability to cover for each other when needed.`,
  dislikes: `The project status updates distributed to the sales team are sometimes delayed or incomplete, which makes it harder to answer client questions accurately and confidently. A couple of times this week I had to ask the project team directly for information that should have been in the standard weekly update. The process for requesting marketing collateral is also more bureaucratic than it needs to be — it requires multiple approvals for what are often straightforward personalisation requests. Streamlining that workflow would help the sales team look more responsive to clients during the consideration phase and reduce wasted time chasing approvals internally.`,
  achievements: `Progressed three mid-stage leads closer to decision point by providing tailored comparisons and arranging virtual walkthroughs. Completed all mandatory compliance training modules that had been pending for a couple of weeks. Supported a colleague during their client presentation when technical issues arose, stepping in seamlessly so the client experience was not disrupted. These contributions may not all show up as direct metrics, but they keep the team functioning smoothly. I also maintained a response time under two hours for all client communications throughout the week, which I regard as a baseline standard I should consistently meet regardless of other pressures.`,
  plansNextWeek: `Next week I will focus on converting two leads that have shown consistent interest but have not yet committed to a decision. I will prepare tailored objection-response guides for each and schedule a decision-focused call that moves the conversation forward. I also plan to review my entire pipeline with fresh eyes and update the forecasted close dates — several are overdue for reassessment. I want to make time for at least two outbound prospecting sessions to rebuild the top of the funnel, which has been thin recently. Finally, I will catch up with a colleague to share notes on common objections, as cross-team knowledge sharing consistently improves our collective effectiveness and saves everyone time.`,
};

const TONE_BUCKETS = [TONE_UPBEAT, TONE_STRESSED, TONE_NEUTRAL];

// Interaction copy pool (short, realistic content strings)
const INTERACTION_COPY = [
  { type: 'Call',    direction: 'Outbound', content: 'Follow-up call to discuss revised payment plan options and address outstanding questions on possession timeline.' },
  { type: 'Email',   direction: 'Outbound', content: 'Sent personalised comparison document highlighting the unit specifications and investment returns for the shortlisted options.' },
  { type: 'Meeting', direction: 'Inbound',  content: 'In-person site visit at project location. Client brought family. Discussed floor plan preferences and parking allocation.' },
  { type: 'Call',    direction: 'Inbound',  content: 'Client called to clarify documentation requirements for home loan application. Provided checklist and offered to coordinate with finance team.' },
  { type: 'Email',   direction: 'Outbound', content: 'Shared updated project brochure and construction progress photographs as requested during last call.' },
];

// ─── HEAD ROLE SET ────────────────────────────────────────────────────────────
// Duplicated here to avoid a circular dependency with hierarchyService.
const HEAD_ROLES = new Set([
  'Sales Head', 'Finance Head', 'Legal Head',
  'CRM Head', 'Marketing Head', 'Project Director',
]);

// ─── SALES-CAPABLE ROLES ──────────────────────────────────────────────────────
const SALES_CAPABLE_ROLES = new Set([
  'Sales Head', 'Sales Manager', 'Sales Executive', 'Business Head',
]);

// ─── TASK CATEGORIES ─────────────────────────────────────────────────────────
const TASK_CATEGORIES = [
  'Lead & Sales',
  'Payment & Collection',
  'Construction',
  'Document & Compliance',
  'Customer Service',
  'Approval',
  'General',
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Pick a tone bucket based on user index and week offset for variety. */
function pickTone(userIndex, weekOffset) {
  return TONE_BUCKETS[(userIndex + weekOffset) % TONE_BUCKETS.length];
}

/** Swallow any error and return null. Used for best-effort AI calls. */
async function bestEffort(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** Return a random date within the last N days. */
function randomDateInLastDays(days) {
  const ms = Math.floor(Math.random() * days * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - ms);
}

/** Return a random integer between min and max (inclusive). */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Return a random date within the current calendar month (UTC).
 * Guarantees the date is not in the future.
 */
function randomDateInCurrentMonth() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const msIntoMonth = now.getTime() - monthStart.getTime();
  // random point from start-of-month up to (but not including) now
  return new Date(monthStart.getTime() + Math.floor(Math.random() * Math.max(msIntoMonth, 1)));
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Seed demo People & Performance data for an org. Idempotent.
 *
 * @param {import('mongoose').Types.ObjectId|string} orgId
 * @param {{ weeks?: number }} [options]
 * @returns {Promise<{ reflections: number, interactions: number, morale: number, tasks: number, leadsConverted: number, salesCreated: number, activitySeeded: boolean, activitySkipReason: string|null }>}
 */
export async function seedDemoPeopleData(orgId, { weeks = 4 } = {}) {
  const members = await User.find({
    organization:     orgId,
    isActive:         true,
    invitationStatus: 'accepted',
  }).lean();

  if (members.length === 0) {
    return {
      reflections:        0,
      interactions:       0,
      morale:             0,
      tasks:              0,
      leadsConverted:     0,
      salesCreated:       0,
      activitySeeded:     false,
      activitySkipReason: 'No active members',
    };
  }

  let reflectionsCreated = 0;
  let interactionsCreated = 0;

  // Build the ordered list of ISO weeks to seed (oldest → newest)
  let w = isoWeekOf(new Date());
  // Collect `weeks` prior weeks in reverse order, then reverse so oldest is first
  const weekList = [];
  for (let i = 0; i < weeks; i++) {
    w = previousIsoWeek(w);
    weekList.unshift(w); // prepend so oldest ends up first
  }
  // uniqueWeeks preserves order
  const uniqueWeeks = [...new Set(weekList)];

  // ── Reflections ──────────────────────────────────────────────────────────
  for (let ui = 0; ui < members.length; ui++) {
    const user = members[ui];

    for (let wi = 0; wi < uniqueWeeks.length; wi++) {
      const isoWeek = uniqueWeeks[wi];

      // Idempotency check: skip if already exists
      const existing = await WeeklyReflection.findOne({
        organization: orgId,
        user:         user._id,
        isoWeek,
      });
      if (existing) continue;

      const { weekStart, weekEnd } = boundsFromIsoWeek(isoWeek);
      const tone        = pickTone(ui, wi);
      const submittedAt = new Date(weekEnd.getTime() - 60 * 60 * 1000); // 1 hr before week end

      const doc = await WeeklyReflection.create({
        organization: orgId,
        user:         user._id,
        isoWeek,
        weekStart,
        weekEnd,
        status:       'submitted',
        submittedAt,
        answers: {
          wins:           tone.wins,
          areasToImprove: tone.areasToImprove,
          dislikes:       tone.dislikes,
          achievements:   tone.achievements,
          plansNextWeek:  tone.plansNextWeek,
        },
      });

      reflectionsCreated++;

      // Best-effort sentiment analysis
      await bestEffort(() => analyzeReflection(doc));
    }
  }

  // ── Interactions ──────────────────────────────────────────────────────────
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  for (const user of members) {
    // Look up an assigned lead
    const lead = await Lead.findOne({
      organization: orgId,
      assignedTo:   user._id,
    });
    if (!lead) continue; // skip if no assigned lead

    // Idempotency: skip if member already has >= 10 recent interactions
    const recentCount = await Interaction.countDocuments({
      organization: orgId,
      user:         user._id,
      createdAt:    { $gte: fourteenDaysAgo },
    });
    if (recentCount >= 10) continue;

    // Create up to (12 - recentCount) interactions spread over the last ~14 days
    const toCreate = Math.min(12 - recentCount, INTERACTION_COPY.length * 2);
    for (let i = 0; i < toCreate; i++) {
      const copy    = INTERACTION_COPY[i % INTERACTION_COPY.length];
      const daysAgo = (i + 1); // 1..12 days ago
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      await Interaction.create({
        organization: orgId,
        user:         user._id,
        lead:         lead._id,
        type:         copy.type,
        direction:    copy.direction,
        content:      copy.content,
        createdAt,
      });
      interactionsCreated++;
    }
  }

  // ── Morale build (best-effort) ─────────────────────────────────────────────
  // Use the most recent seeded week (last element in uniqueWeeks)
  const latestWeek = uniqueWeeks[uniqueWeeks.length - 1] ?? isoWeekOf(new Date());
  let moraleBuilt = 0;

  // Team morale for each head-level member
  for (const user of members) {
    if (HEAD_ROLES.has(user.role)) {
      const result = await bestEffort(() => buildTeamMorale(orgId, user, latestWeek));
      if (result) moraleBuilt++;
    }
  }

  // Org morale
  const orgResult = await bestEffort(() => buildOrgMorale(orgId, latestWeek));
  if (orgResult) moraleBuilt++;

  // ── Safety gate: only seed operational activity for demo orgs ─────────────
  const org = await Organization.findById(orgId);
  if (!org || !/demo/i.test(org.name)) {
    return {
      reflections:        reflectionsCreated,
      interactions:       interactionsCreated,
      morale:             moraleBuilt,
      tasks:              0,
      leadsConverted:     0,
      salesCreated:       0,
      activitySeeded:     false,
      activitySkipReason: org
        ? `Org name "${org.name}" does not match /demo/i`
        : `Organization ${orgId} not found`,
    };
  }

  // ── Resolve owner (Business Head or first member) ─────────────────────────
  const owner = members.find((m) => m.role === 'Business Head') ?? members[0];

  // ── Tasks seeding ─────────────────────────────────────────────────────────
  let tasksCreated = 0;

  for (const user of members) {
    // Idempotency: skip if this user already has demo_seed tasks
    const existingTaskCount = await Task.countDocuments({
      organization: orgId,
      assignedTo:   user._id,
      tags:         'demo_seed',
    });
    if (existingTaskCount > 0) continue;

    const now = Date.now();

    // Task 1: Completed, on-time (completedAt < dueDate)
    const completedAt1 = new Date(now - randInt(1, 20) * 24 * 60 * 60 * 1000);
    const dueDate1     = new Date(completedAt1.getTime() + 2 * 24 * 60 * 60 * 1000); // dueDate after completedAt → on-time
    await Task.create({
      organization: orgId,
      title:        'Follow up with site-visit prospects and update pipeline status',
      category:     TASK_CATEGORIES[0], // 'Lead & Sales'
      createdBy:    owner._id,
      assignedTo:   user._id,
      status:       'Completed',
      priority:     'High',
      dueDate:      dueDate1,
      completedAt:  completedAt1,
      sla:          { isOverdue: false },
      tags:         ['demo_seed'],
    });
    tasksCreated++;

    // Task 2: Completed, on-time (completedAt < dueDate)
    const completedAt2 = new Date(now - randInt(21, 35) * 24 * 60 * 60 * 1000);
    const dueDate2     = new Date(completedAt2.getTime() + 3 * 24 * 60 * 60 * 1000); // on-time
    await Task.create({
      organization: orgId,
      title:        'Prepare payment collection reminder for overdue instalments',
      category:     TASK_CATEGORIES[1], // 'Payment & Collection'
      createdBy:    owner._id,
      assignedTo:   user._id,
      status:       'Completed',
      priority:     'Medium',
      dueDate:      dueDate2,
      completedAt:  completedAt2,
      sla:          { isOverdue: false },
      tags:         ['demo_seed'],
    });
    tasksCreated++;

    // Task 3: Completed, SLA breach (completedAt > dueDate)
    const dueDate3     = new Date(now - randInt(10, 20) * 24 * 60 * 60 * 1000);
    const completedAt3 = new Date(dueDate3.getTime() + 2 * 24 * 60 * 60 * 1000); // completedAt after dueDate → breach
    await Task.create({
      organization: orgId,
      title:        'Complete compliance document review and submit to legal',
      category:     TASK_CATEGORIES[3], // 'Document & Compliance'
      createdBy:    owner._id,
      assignedTo:   user._id,
      status:       'Completed',
      priority:     'Critical',
      dueDate:      dueDate3,
      completedAt:  completedAt3,
      sla:          { isOverdue: true },
      tags:         ['demo_seed'],
    });
    tasksCreated++;

    // Task 4: Open
    const dueDate4 = new Date(now + 7 * 24 * 60 * 60 * 1000); // due next week
    await Task.create({
      organization: orgId,
      title:        'Coordinate site visit for new enquiry batch',
      category:     TASK_CATEGORIES[0], // 'Lead & Sales'
      createdBy:    owner._id,
      assignedTo:   user._id,
      status:       'Open',
      priority:     'Medium',
      dueDate:      dueDate4,
      tags:         ['demo_seed'],
    });
    tasksCreated++;

    // Task 5: In Progress
    const dueDate5 = new Date(now + 3 * 24 * 60 * 60 * 1000); // due in 3 days
    await Task.create({
      organization: orgId,
      title:        'Review and approve updated project floor plan documentation',
      category:     TASK_CATEGORIES[2], // 'Construction'
      createdBy:    owner._id,
      assignedTo:   user._id,
      status:       'In Progress',
      priority:     'High',
      dueDate:      dueDate5,
      tags:         ['demo_seed'],
    });
    tasksCreated++;
  }

  // ── Lead conversions ──────────────────────────────────────────────────────
  let leadsConverted = 0;
  // Running counter so every created demo lead gets a unique phone across all users
  let leadPhoneCounter = 0;

  const project = await Project.findOne({ organization: orgId });

  for (const user of members) {
    // Find existing assigned leads
    let userLeads = await Lead.find({ organization: orgId, assignedTo: user._id });

    // If no leads, create demo leads — requires a valid project ref
    if (!userLeads || userLeads.length === 0) {
      if (!project) continue; // cannot create valid Lead docs without a project
      const createdLeads = [];
      for (let i = 0; i < 4; i++) {
        const lead = await Lead.create({
          organization: orgId,
          project:      project._id,
          firstName:    'Demo',
          phone:        `90${String(leadPhoneCounter).padStart(8, '0')}`,
          assignedTo:   user._id,
          notes:        'demo_seed',
        });
        leadPhoneCounter++;
        createdLeads.push(lead);
      }
      userLeads = createdLeads;
    }

    // Idempotency: skip if already has a Booked lead with demo_seed note in statusHistory
    const alreadyConverted = userLeads.some(
      (l) =>
        l.status === 'Booked' &&
        Array.isArray(l.statusHistory) &&
        l.statusHistory.some((h) => h.status === 'Booked' && h.note === 'demo_seed'),
    );
    if (alreadyConverted) continue;

    // Convert ~35% of leads (at least 1)
    const openLeads      = userLeads.filter((l) => l.status !== 'Booked');
    const toConvertCount = Math.max(1, Math.floor(openLeads.length * 0.35));
    const toConvert      = openLeads.slice(0, toConvertCount);

    for (const lead of toConvert) {
      const conversionDate = randomDateInLastDays(42); // last 6 weeks
      await Lead.findByIdAndUpdate(lead._id, {
        $set:  { status: 'Booked', statusChangedAt: conversionDate },
        $push: { statusHistory: { status: 'Booked', changedAt: conversionDate, note: 'demo_seed' } },
      });
      leadsConverted++;
    }
  }

  // ── Sales seeding ─────────────────────────────────────────────────────────
  let salesCreated = 0;
  const usedUnitIds = new Set();

  for (const user of members) {
    if (!SALES_CAPABLE_ROLES.has(user.role)) continue;

    // Idempotency: skip if already has sales
    const existingSalesCount = await Sale.countDocuments({
      organization: orgId,
      salesPerson:  user._id,
    });
    if (existingSalesCount > 0) continue;

    // Find available units (up to 4), excluding already-used ones
    const availableUnits = (await Unit.find({ organization: orgId, status: 'available' }))
      .filter(u => !usedUnitIds.has(u._id.toString()))
      .slice(0, 4);
    if (!availableUnits || availableUnits.length === 0) continue;

    // Find a Booked lead for this user
    const bookedLead = await Lead.findOne({
      organization: orgId,
      assignedTo:   user._id,
      status:       'Booked',
    });
    if (!bookedLead) continue;
    if (!project) continue; // cannot create valid Sale docs without a project

    const salesToCreate = Math.min(availableUnits.length, randInt(2, 4));
    const saleStatuses  = ['Booked', 'Agreement Signed'];

    for (let i = 0; i < salesToCreate; i++) {
      const unit = availableUnits[i];
      // Bias first sale into the current calendar month so the default monthly
      // dashboard view is guaranteed to show at least one sale per member.
      const bookingDate = i === 0
        ? randomDateInCurrentMonth()
        : randomDateInLastDays(56); // last 8 weeks for variety
      const salePrice  = randInt(2, 30) * 1_00_00_000; // ₹2–30 Cr
      const saleStatus = saleStatuses[i % saleStatuses.length];

      await Sale.create({
        project:           project._id,
        unit:              unit._id,
        lead:              bookedLead._id,
        organization:      orgId,
        salesPerson:       user._id,
        salePrice,
        bookingDate,
        status:            saleStatus,
        costSheetSnapshot: {},
      });
      salesCreated++;
      usedUnitIds.add(unit._id.toString());

      // Mark unit as sold
      await Unit.findByIdAndUpdate(unit._id, { $set: { status: 'sold' } });
    }
  }

  return {
    reflections:        reflectionsCreated,
    interactions:       interactionsCreated,
    morale:             moraleBuilt,
    tasks:              tasksCreated,
    leadsConverted:     leadsConverted,
    salesCreated:       salesCreated,
    activitySeeded:     true,
    activitySkipReason: null,
  };
}
