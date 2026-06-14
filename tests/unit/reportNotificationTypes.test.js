import mongoose from 'mongoose';
import Notification, { NOTIFICATION_TYPES, RELATED_ENTITY_TYPES } from '../../models/notificationModel.js';

describe('report notification types', () => {
  it('registers the report workflow types', () => {
    expect(NOTIFICATION_TYPES).toEqual(expect.arrayContaining([
      'report_ready_for_review', 'report_approved', 'report_changes_requested', 'report_flag_raised',
    ]));
    expect(RELATED_ENTITY_TYPES).toContain('ReportInstance');
  });
  it('a report notification validates', () => {
    const n = new Notification({
      organization: new mongoose.Types.ObjectId(),
      recipient: new mongoose.Types.ObjectId(),
      type: 'report_flag_raised',
      title: 'A value was flagged',
      relatedEntity: { entityType: 'ReportInstance', entityId: new mongoose.Types.ObjectId() },
    });
    expect(n.validateSync()).toBeUndefined();
  });
});
