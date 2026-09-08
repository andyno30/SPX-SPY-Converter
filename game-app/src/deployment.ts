// Only the hosting preview can be released. Enabling play requires the separate
// gameplay release audit, licensed content and server-validated rewards.
export const deployment = {
  basePath: '/game',
  mode: 'hosting-preview',
  gameplayEnabled: false,
  cloudSavesEnabled: false,
} as const;

export function gameUrl(path = ''): string {
  if (path && (!path.startsWith('/') || path.startsWith('//') || /[?#%\\]/.test(path) || path.split('/').includes('..'))) {
    throw new Error('Expected a safe path relative to /game');
  }
  return `${deployment.basePath}${path}`;
}
