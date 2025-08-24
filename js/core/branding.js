// js/core/branding.js
import { api } from './api.js';
import { state, DEFAULT_LOGO_DATAURI } from './state.js';

const BRANDING_CACHE_KEY = 'branding_cache_v1';

function getCachedBranding(){
  try { return JSON.parse(localStorage.getItem(BRANDING_CACHE_KEY) || 'null'); }
  catch { return null; }
}
function setCachedBranding(b){
  try { localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(b)); } catch {}
}

export function applyBranding(branding){
  if (!branding) return;
  state.branding = { ...state.branding, ...branding };

  const root = document.documentElement;
  if (branding.primaryColor) root.style.setProperty('--brand-blue', branding.primaryColor);
  if (branding.accentColor)  root.style.setProperty('--brand-green', branding.accentColor);

  // Header brand
  const logo = document.getElementById('brandLogo');
  const src = state.branding.logoUrl || DEFAULT_LOGO_DATAURI;
  if (logo && src){ logo.src = src; logo.style.background = 'none'; }

  const titleEl = document.querySelector('.brand .title');
  if (titleEl) titleEl.textContent = state.branding.teamName || 'RadSystems Portal';
}

/**
 * Load branding with smart fallbacks:
 * 1) If cache exists, apply it immediately (prevents flash on reload).
 * 2) Try public (unauth) branding first — works on login screen.
 * 3) If logged in, try admin branding.
 * 4) If nothing works and require===true, throw to keep splash.
 */
export async function loadBranding(require=false){
  // 1) Hydrate from cache first (instant, no flash)
  const cached = getCachedBranding();
  if (cached) applyBranding(cached);

  // 2) Try public config (works without auth)
  try{
    const pub = await api('public.config', {});
    if (pub && pub.branding){
      const b = {
        logoUrl:     pub.branding.logoUrl || cached?.logoUrl || DEFAULT_LOGO_DATAURI,
        primaryColor: pub.branding.primaryColor || cached?.primaryColor,
        accentColor:  pub.branding.accentColor  || cached?.accentColor,
        dateFormat:   pub.branding.dateFormat   || cached?.dateFormat,
        teamName:     pub.branding.teamName     || cached?.teamName || 'RadSystems Portal'
      };
      applyBranding(b);
      setCachedBranding(b);
      return true;
    }
  }catch(_){} // ignore, may not exist

  // 3) If we appear logged in, try admin endpoint
  const hasToken = !!(localStorage.getItem('token') || localStorage.getItem('auth_token'));
  if (hasToken){
    try{
      const r = await api('admin.branding.get', {});
      const b = r?.branding || {};
      const merged = {
        logoUrl:     b.logoUrl || cached?.logoUrl || DEFAULT_LOGO_DATAURI,
        primaryColor: b.primaryColor || cached?.primaryColor,
        accentColor:  b.accentColor  || cached?.accentColor,
        dateFormat:   b.dateFormat   || cached?.dateFormat,
        teamName:     b.teamName     || cached?.teamName || 'RadSystems Portal'
      };
      applyBranding(merged);
      setCachedBranding(merged);
      return true;
    }catch(_){}
  }

  // 4) If we had cache we already applied it; do not downgrade to defaults.
  if (cached) return true;

  // Nothing available
  if (require) throw new Error('Branding unavailable');
  // Optional: apply only a minimal default (keeps variables valid)
  applyBranding({ logoUrl: DEFAULT_LOGO_DATAURI });
  return false;
}
