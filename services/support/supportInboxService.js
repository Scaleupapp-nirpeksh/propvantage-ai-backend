// File: services/support/supportInboxService.js
// Description: Provisions + resolves an org's helpdesk inbox address on the shared
//   platform subdomain (helpdesk.prop-vantage.com is a catch-all, so any local-part
//   works the instant a SupportInbox row maps it to an org). Each org gets a unique
//   local-part derived from its name. No DNS / no AWS change per org.

import Organization from '../../models/organizationModel.js';
import SupportInbox from '../../models/supportInboxModel.js';

const HELPDESK_DOMAIN = process.env.HELPDESK_DOMAIN || 'helpdesk.prop-vantage.com';

// Local-part from an org name: lowercase alphanumerics, capped. Falls back to 'org'.
const slugify = (name) => {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  return s || 'org';
};

// Find a globally-unique address for a base slug (the subdomain is shared across
// all tenants, so the local-part must be unique). Appends 2,3,… on collision.
const uniqueAddress = async (baseSlug, excludeOrgId = null) => {
  let slug = baseSlug;
  let n = 1;
  /* eslint-disable no-await-in-loop */
  while (true) {
    const address = `${slug}@${HELPDESK_DOMAIN}`;
    const existing = await SupportInbox.findOne({ address }).select('organization');
    if (!existing || (excludeOrgId && String(existing.organization) === String(excludeOrgId))) {
      return address;
    }
    n += 1;
    slug = `${baseSlug}${n}`;
  }
  /* eslint-enable no-await-in-loop */
};

/**
 * Ensure an org has a helpdesk inbox; create one (unique <slug>@domain) if missing.
 * Idempotent — safe to call on org creation AND lazily on read. Returns the inbox.
 */
export async function provisionSupportInbox(orgId, orgName = null) {
  const existing = await SupportInbox.findOne({ organization: orgId });
  if (existing) return existing;

  let name = orgName;
  if (!name) {
    const org = await Organization.findById(orgId).select('name');
    name = org?.name;
  }
  const address = await uniqueAddress(slugify(name));
  return SupportInbox.create({ organization: orgId, address, active: true });
}

/** Get the org's inbox, provisioning it on first read. */
export async function getOrgInbox(orgId) {
  return provisionSupportInbox(orgId);
}

/**
 * Regenerate the org's helpdesk address from a new slug (or the org name).
 * Admin action. Returns the updated inbox.
 */
export async function regenerateOrgInbox(orgId, requestedSlug = null) {
  const inbox = await provisionSupportInbox(orgId);
  let base;
  if (requestedSlug) {
    base = slugify(requestedSlug);
  } else {
    const org = await Organization.findById(orgId).select('name');
    base = slugify(org?.name);
  }
  inbox.address = await uniqueAddress(base, orgId);
  await inbox.save();
  return inbox;
}

export { HELPDESK_DOMAIN };
export default { provisionSupportInbox, getOrgInbox, regenerateOrgInbox, HELPDESK_DOMAIN };
