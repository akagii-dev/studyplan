import { ReactNode } from 'react';
import { Exam, Material, ScheduleAnswer, ScheduleKind, WindowRule } from '../../domain/model';
import { Props } from '../common';
import { Addition, Step, Wizard } from './model';
export type GuidedSetupProps = Props & {
  onGenerate: () => void;
  mode?: Addition;
  onClose?: () => void;
  onAddMaterial?: (id: string) => void;
  onReview?: () => void;
  onConfigure?: (kind: string) => void;
};
export type QuestionView = { title: string; content: ReactNode; valid: boolean };
export type StepContext = GuidedSetupProps & {
  w: Wizard;
  skip: () => void;
  exam: (p: Partial<Exam>) => void;
  win: (p: Partial<WindowRule>) => void;
  mat: (p: Partial<Material>) => void;
  patch: (p: Partial<Wizard>) => void;
  go: (s: Step, p?: Partial<Wizard>) => void;
  choice: (label: string, selected: boolean, action: () => void) => ReactNode;
  setting: (key: 'focus' | 'block' | 'rest' | 'buffer', value: number) => void;
  saveAndGo: (
    kind: 'exam' | 'window' | 'material' | 'exception',
    next: Step,
    partial?: Partial<Wizard>,
  ) => Promise<void>;
  answerAndGo: (kind: ScheduleKind, answer: ScheduleAnswer, step: Step) => void;
  editTimes: boolean;
  setEditTimes: (v: boolean) => void;
  otherBuffer: boolean;
  setOtherBuffer: (v: boolean) => void;
  savingItem: boolean;
  materialDraftPending: boolean;
};
