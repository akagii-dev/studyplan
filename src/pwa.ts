// The public demo deliberately keeps its separate localStorage adapter and no worker.
export const pwaMode = import.meta.env.MODE === 'pwa';
