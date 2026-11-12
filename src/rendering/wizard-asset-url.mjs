// Vite fills this map from the actual GLB bytes for production. Native tests
// and the dev server keep the existing public path; custom loaders still work.
const builtPaths = typeof __WIZARD_ASSET_PATHS__ === 'undefined' ? null : __WIZARD_ASSET_PATHS__;
export function wizardAssetURL(name, baseUrl, paths = builtPaths, moduleURL = import.meta.url) {
  if (baseUrl !== undefined) return `${baseUrl}${name}.glb`;
  if (paths?.[name]) return new URL(paths[name], moduleURL).href;
  return `${import.meta.env?.BASE_URL || '/'}assets/wizard-v4/${name}.glb`;
}
