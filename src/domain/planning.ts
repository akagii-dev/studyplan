import { AppState, Settings, today, uid } from './model';
import { PlanningContext } from './planner/context';
import { generatePlan as generate } from './planner/generate';
import * as proposals from './planner/proposal';

export * from './planner/intervals';
export * from './planner/capacity';
export * from './planner/validation';
export { undoPlan } from './planner/proposal';

/** The only planning entry point that reads time/randomness. No persistence or UI here. */
function context(): PlanningContext {
  const now = new Date();
  return {
    timestamp: now.toISOString(),
    date: today(),
    minute: now.getHours() * 60 + now.getMinutes(),
    idPrefix: uid(),
  };
}
export function generatePlan(
  state: AppState,
  from: string,
  preserve = true,
  notBefore = 0,
  allocation: 'balanced' | 'earliest' = 'balanced',
) {
  return generate(state, from, preserve, notBefore, allocation, context());
}
export function propose(state: AppState, from: string, reason: string) {
  return proposals.propose(state, from, reason, context());
}
export function proposeSettings(state: AppState, settings: Settings, from: string) {
  return proposals.proposeSettings(state, settings, from, context());
}
export function proposalAfterRecord(
  state: AppState,
  reason: string,
  previousProposal = state.proposal,
) {
  return proposals.proposalAfterRecord(state, reason, previousProposal, context());
}
export function approve(state: AppState, acknowledge = false) {
  return proposals.approve(state, acknowledge, context());
}
