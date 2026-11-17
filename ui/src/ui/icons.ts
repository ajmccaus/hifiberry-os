// Monochrome symbol SVGs (legacy MIT set + hbos-ui MIT set) as hashed asset URLs, coloured by CSS mask.
// Constraint: icons are referenced by file name; an unknown name falls back to the generic input icon.

const urls = import.meta.glob<string>('../assets/symbols/*.svg', { eager: true, query: '?url', import: 'default' });

const byName = new Map(
  Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url] as const),
);

export const iconUrl = (name: string): string => byName.get(name) ?? byName.get('input') ?? '';
