// Per-device view preferences (filters, selected company, etc.).
const KEY = 'studio-ui:v1';

const defaults = {
  company: 'all',
  projectsView: 'pipeline',
  projectStatus: 'live',
  taskScope: 'mine',
  taskShow: 'open',
  clientSearch: '',
  taskSearch: '',
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch (e) {
    return { ...defaults };
  }
}

export const ui = load();

export function setUi(patch) {
  Object.assign(ui, patch);
  try {
    const { clientSearch, taskSearch, ...persisted } = ui; // don't persist search text
    localStorage.setItem(KEY, JSON.stringify(persisted));
  } catch (e) { /* storage unavailable */ }
}

export const inScope = companyId => ui.company === 'all' || ui.company === companyId;
