/** LAN is a transport for the shared SQLite store, never an offline study-data store. */
export const lanMode = import.meta.env.MODE === 'lan';
export const lanBase = '/studyplan-lan/';
