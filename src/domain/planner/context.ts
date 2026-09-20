/** Supplied by the application boundary; calculations never read the device clock or randomness. */
export interface PlanningContext {
  timestamp: string;
  date: string;
  minute: number;
  idPrefix: string;
}
