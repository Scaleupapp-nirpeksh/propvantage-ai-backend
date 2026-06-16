// File: models/workspaceLayoutModel.js
// Description: One personal board layout per user — the ordered, sized list of
//   cards a user has pinned. Always personal, even when it references a shared
//   card. See workspace design spec §5.

import mongoose from 'mongoose';

export const CARD_SIZES = ['sm', 'md', 'lg'];

const layoutItemSchema = new mongoose.Schema(
  {
    cardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkspaceCard',
      required: [true, 'cardId is required'],
    },
    order: { type: Number, default: 0 },
    size: { type: String, enum: CARD_SIZES, default: 'md' },
  },
  { _id: false }
);

const workspaceLayoutSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      unique: true, // one layout per user
    },
    items: { type: [layoutItemSchema], default: [] },
  },
  { timestamps: true }
);

const WorkspaceLayout = mongoose.model('WorkspaceLayout', workspaceLayoutSchema);

export default WorkspaceLayout;
