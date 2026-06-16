// tests/unit/channelPartnersCatalog.test.js
import mongoose from 'mongoose';
import cpCatalog from '../../services/workspace/catalogs/channelPartnersCatalog.js';

const field = (key) => cpCatalog.fields.find((f) => f.key === key);
const viewerCtx = { organization: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), accessibleProjectIds: [], isOwner: false, permissions: [] };

describe('channelPartnersCatalog', () => {
  it('module=channelPartners, baseModel=ChannelPartner', () => {
    expect(cpCatalog.module).toBe('channelPartners');
    expect(cpCatalog.baseModel).toBe('ChannelPartner');
  });

  it('category and status enums mirror the model', () => {
    expect(field('category').enumValues).toEqual(['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator']);
    expect(field('status').enumValues).toEqual(['active', 'suspended', 'blacklisted']);
  });

  describe('toMatch', () => {
    it('status is → equality', () => {
      expect(field('status').toMatch('is', 'active', viewerCtx)).toEqual({ status: 'active' });
    });
    it('category in → $in', () => {
      expect(field('category').toMatch('in', ['broker_firm', 'corporate'], viewerCtx))
        .toEqual({ category: { $in: ['broker_firm', 'corporate'] } });
    });
    it('firmName contains → case-insensitive regex', () => {
      const frag = field('firmName').toMatch('contains', 'realty', viewerCtx);
      expect(frag.firmName).toBeInstanceOf(RegExp);
      expect(frag.firmName.flags).toContain('i');
      expect('Prime Realty LLP').toMatch(frag.firmName);
    });
    it('approvedProjects is → membership match (cast ObjectId)', () => {
      const id = new mongoose.Types.ObjectId();
      expect(field('approvedProjects').toMatch('is', id.toString(), viewerCtx))
        .toEqual({ approvedProjects: new mongoose.Types.ObjectId(id.toString()) });
    });
    it('approvedProjects isEmpty → empty-array match', () => {
      expect(field('approvedProjects').toMatch('isEmpty', null, viewerCtx))
        .toEqual({ approvedProjects: { $size: 0 } });
    });
  });

  it('scope is org-only (CP registry is owned by the developer org)', () => {
    expect(cpCatalog.scope(viewerCtx)).toEqual({ organization: viewerCtx.organization });
  });
});
