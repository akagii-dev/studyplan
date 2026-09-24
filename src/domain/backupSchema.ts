import { z } from 'zod';

const text = z.string().max(10000);
const id = z.string().max(200);
const count = z.number().int().min(0).max(1_000_000_000);
const date = z.iso.date();
const minute = z.number().min(0).max(1440);
const round = z.looseObject({ completed: count, minutes: z.number().positive().max(1440) });
const exam = z.looseObject({
  id,
  name: text,
  start: date,
  target: date,
  priority: z.number().int().min(1).max(3),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  reviewDays: count,
});
const material = z.looseObject({
  id,
  examId: id,
  name: text,
  unit: z.string().trim().min(1).max(40).optional(),
  total: count.min(1),
  order: count.min(1),
  rounds: z.array(round).min(1).max(1000),
});
const windowRule = z.looseObject({
  id,
  name: text,
  from: date,
  to: date,
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  start: minute,
  end: minute,
  kind: z.enum(['study', 'class', 'busy']),
});
const exception = z.looseObject({ id, name: text, date, start: minute, end: minute });
const settings = z.looseObject({
  exams: z.array(exam),
  materials: z.array(material),
  windows: z.array(windowRule),
  exceptions: z.array(exception),
  block: count.min(1).max(1440),
  minimumSessionMinutes: count.min(1).max(1440).optional(),
  preferredSessionMinutes: count.min(1).max(1440).optional(),
  rest: count.max(1440),
  buffer: z.number().min(0).lt(1),
  focus: count.optional(),
  periods: z.array(minute).min(1).max(100),
  classTransition: count.max(180).optional(),
  commute: z
    .object({
      enabled: z.boolean(),
      from: date,
      to: date,
      mode: z.enum(['classDays', 'weekdays']),
      weekdays: z.array(z.number().int().min(0).max(6)).max(7),
      outboundMinutes: count.max(360),
      returnMinutes: count.max(360),
      departureTimesConfirmed: z.boolean().optional(),
      outboundStart: count.max(1439),
      returnStart: count.max(1439),
    })
    .optional(),
  meals: z
    .object({
      breakfast: z.looseObject({ start: minute, duration: count.min(30).max(60) }).optional(),
      lunch: z.looseObject({ start: minute, duration: count.min(30).max(60) }).optional(),
      dinner: z.looseObject({ start: minute, duration: count.min(30).max(60) }).optional(),
    })
    .optional(),
  scheduleAnswers: z
    .record(
      z.enum(['class', 'busy', 'exception']),
      z.enum(['none', 'deferred', 'registered']).optional(),
    )
    .optional(),
});
const interval = z.tuple([minute, minute]);
const session = z.looseObject({
  id,
  date,
  start: minute,
  end: minute,
  examId: id,
  materialId: id,
  round: count,
  count,
  fixed: z.boolean(),
  kind: z.enum(['study', 'review']),
  allocationReason: z.enum(['final-remainder', 'deadline']).optional(),
});
const plan = z.looseObject({
  id,
  approvedAt: z.iso.datetime().optional(),
  createdAt: text,
  from: date,
  calculationVersion: count.optional(),
  notBefore: minute.optional(),
  settingsSnapshot: settings.optional(),
  settingsUpdatedAt: text.optional(),
  sessions: z.array(session),
  capacities: z.array(
    z.looseObject({
      date,
      free: minute,
      focus: minute,
      allocatable: minute,
      slots: z.array(interval),
      blocks: z.array(interval).optional(),
    }),
  ),
  shortfalls: z.array(
    z.looseObject({
      materialId: id,
      round: count,
      count,
      minutes: z.number().nonnegative(),
      reason: text,
    }),
  ),
  conflicts: z.array(text),
  progressBaseline: z
    .object({
      records: z.record(z.string(), count),
      sessions: z.record(z.string(), z.object({ count, end: minute })),
      shortfalls: z.record(
        z.string(),
        z.object({
          count,
          minutes: z.number().nonnegative().max(1_000_000_000),
          reason: text,
        }),
      ),
    })
    .optional(),
});
// Drafts may contain incomplete dates or blank names. Their containers and field types still
// need validation so a damaged draft cannot make an otherwise valid restore unrenderable.
const draftExam = exam.extend({ start: text, target: text });
const draftWindow = windowRule.extend({
  from: text,
  to: text,
  start: minute.nullable(),
  end: minute.nullable(),
});
const draftException = exception.extend({
  date: text,
  start: minute.nullable(),
  end: minute.nullable(),
});
const period = z.looseObject({ from: text, to: text });
const guidedDraft = z.looseObject({
  editScope: z
    .enum([
      'exam',
      'material',
      'window',
      'class',
      'busy',
      'exception',
      'meals',
      'outside',
      'focus',
      'buffer',
    ])
    .optional(),
  step: text,
  trail: z.array(z.looseObject({ step: text, roundIndex: count })),
  exam: draftExam,
  window: draftWindow,
  exception: draftException,
  material,
  roundIndex: count,
  classFrom: text,
  classTo: text,
  classEditingPeriod: period.optional(),
});
const outsideDraft = z.object({ phase: z.enum(['ask', 'start', 'end']), start: text, end: text });
const outsideRange = z.object({ start: count.max(1439), duration: count.min(1).max(1439) });
const draft = z.looseObject({
  'outside-sleep': outsideDraft.optional(),
  'outside-bath': outsideDraft.optional(),
  exam: draftExam.optional(),
  material: material.optional(),
  window: draftWindow.optional(),
  exception: draftException.optional(),
  classPeriod: period.optional(),
  progress: z
    .looseObject({ date: text, materialId: id, round: count, choice: text, custom: text })
    .optional(),
  numberEdits: z.record(z.string(), z.object({ text, base: text })).optional(),
  guided: guidedDraft.optional(),
  addExam: guidedDraft
    .extend({
      step: z.enum([
        'exam.name',
        'exam.target',
        'exam.start',
        'exam.priority',
        'exam.color',
        'exam.review',
        'exam.reviewDays',
        'exam.done',
        'addition.saved',
      ]),
    })
    .optional(),
  addMaterial: guidedDraft
    .extend({
      step: z.enum([
        'material.exam',
        'material.name',
        'material.total',
        'material.rounds',
        'material.completed',
        'material.minutes',
        'material.custom',
        'material.roundMinutes',
        'material.order',
        'material.done',
        'addition.saved',
      ]),
    })
    .optional(),
  revision: z
    .looseObject({
      id,
      base: settings,
      settings,
      stage: z.enum(['choose', 'item', 'question', 'review']),
      topic: z.enum([
        'exam',
        'material',
        'study',
        'class',
        'busy',
        'exception',
        'focus',
        'meal',
        'commute',
      ]),
      itemId: id,
      index: count,
    })
    .optional(),
  mealStep: count.max(5).optional(),
  mealClock: z.object({ index: count.max(5), text }).optional(),
  mealOpen: z.boolean().optional(),
  replanError: text.optional(),
});
const state = z.looseObject({
  studyDayBaselines: z
    .record(
      date,
      z.object({
        planId: id,
        rows: z.array(
          z.object({
            materialId: id,
            round: count,
            examId: id,
            name: text,
            unit: z.string().trim().min(1).max(40),
            count,
          }),
        ),
      }),
    )
    .optional(),
  outsideLabels: z
    .record(
      date,
      z.array(
        z.object({
          start: count.max(1439),
          end: count.min(1).max(1440),
          title: z.string().trim().min(1).max(120),
        }),
      ),
    )
    .optional(),
  outsideTime: z
    .object({ sleep: outsideRange.optional(), bath: outsideRange.optional() })
    .optional(),
  settings,
  draft,
  step: count,
  records: z.array(
    z.looseObject({
      id,
      date,
      materialId: id,
      round: count,
      count,
      cancelled: z.boolean(),
      createdAt: text,
      updatedAt: text,
    }),
  ),
  plan: plan.nullable(),
  history: z.array(plan),
  proposal: z
    .looseObject({
      plan,
      basedOn: id.nullable(),
      reason: text,
      unreported: z.array(id),
      settingsBase: settings.optional(),
    })
    .nullable(),
  theme: z.enum(['mint', 'sky', 'lime']).optional(),
  appearance: z.enum(['light', 'dark', 'system']).optional(),
  sidebarCollapsed: z.boolean().optional(),
  windowSize: z
    .object({
      width: z.number().int().positive().max(100_000),
      height: z.number().int().positive().max(100_000),
    })
    .optional(),
  calendarDensity: z
    .object({
      month: z.enum(['compact', 'standard', 'detailed']).optional(),
      week: z.enum(['compact', 'standard', 'detailed']).optional(),
      list: z.enum(['compact', 'standard', 'detailed']).optional(),
    })
    .optional(),
  ignoredWarnings: z
    .record(id, z.object({ title: text, version: text, ignoredAt: z.iso.datetime() }))
    .optional(),
  warningExpanded: z.record(id, z.boolean()).optional(),
  settingsUpdatedAt: text.optional(),
});
export const backupSchema = z.object({
  format: z.literal('StudyPlanBackup'),
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  appVersion: text,
  data: state.extend({ resetBackup: state.optional() }),
});
export const backupJsonSchema = () => z.toJSONSchema(backupSchema);
