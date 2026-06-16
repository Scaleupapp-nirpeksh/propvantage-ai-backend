// tests/unit/tasksCatalog.test.js
import mongoose from 'mongoose';
import tasksCatalog from '../../services/workspace/catalogs/tasksCatalog.js';
import { TASK_STATUSES, TASK_PRIORITIES, TASK_CATEGORIES } from '../../models/taskModel.js';

const field = (key) => tasksCatalog.fields.find((f) => f.key === key);
const userId = new mongoose.Types.ObjectId();
const viewerCtx = { organization: new mongoose.Types.ObjectId(), userId, accessibleProjectIds: null, isOwner: true, permissions: [] };

describe('tasksCatalog', () => {
  it('module=tasks, baseModel=Task', () => {
    expect(tasksCatalog.module).toBe('tasks');
    expect(tasksCatalog.baseModel).toBe('Task');
  });

  it('status/priority/category enums are sourced from the Task model', () => {
    expect(field('status').enumValues).toEqual(TASK_STATUSES);
    expect(field('priority').enumValues).toEqual(TASK_PRIORITIES);
    expect(field('category').enumValues).toEqual(TASK_CATEGORIES);
  });

  describe('toMatch', () => {
    it('priority in → $in', () => {
      expect(field('priority').toMatch('in', ['Critical', 'High'], viewerCtx))
        .toEqual({ priority: { $in: ['Critical', 'High'] } });
    });
    it('category is → equality', () => {
      expect(field('category').toMatch('is', 'Payment & Collection', viewerCtx))
        .toEqual({ category: 'Payment & Collection' });
    });
    it('dueDate lastNDays → $gte cutoff', () => {
      expect(field('dueDate').toMatch('lastNDays', 3, viewerCtx).dueDate.$gte).toBeInstanceOf(Date);
    });
  });

  describe('derived assignedToMe', () => {
    const f = () => field('assignedToMe');
    it('is derived and boolean-typed', () => {
      expect(f().derived).toBe(true);
      expect(f().type).toBe('boolean');
    });
    it('is true → assignedTo == viewer userId', () => {
      expect(f().toMatch('is', true, viewerCtx)).toEqual({ assignedTo: new mongoose.Types.ObjectId(userId.toString()) });
    });
    it('is false → assignedTo != viewer userId', () => {
      expect(f().toMatch('is', false, viewerCtx)).toEqual({ assignedTo: { $ne: new mongoose.Types.ObjectId(userId.toString()) } });
    });
  });

  describe('derived daysOverdue', () => {
    const f = () => field('daysOverdue');
    it('addFields() is 0 for Completed/Cancelled or no dueDate, else days past dueDate', () => {
      const expr = f().addFields().$addFields.daysOverdue;
      expect(expr).toHaveProperty('$cond');
      expect(expr.$cond.then).toBe(0);
      expect(expr.$cond.else.$max[0]).toBe(0);
      expect(expr.$cond.else.$max[1].$dateDiff).toMatchObject({ startDate: '$dueDate', endDate: '$$NOW', unit: 'day' });
    });
    it('toMatch gt 0 → overdue filter', () => {
      expect(f().toMatch('gt', 0, viewerCtx)).toEqual({ daysOverdue: { $gt: 0 } });
    });
  });

  it('scope: owner → org only', () => {
    expect(tasksCatalog.scope(viewerCtx)).toEqual({ organization: viewerCtx.organization });
  });
});
