// js/core/branding.js
import { api } from './api.js';
import { state, DEFAULT_LOGO_DATAURI } from './state.js';

export function applyBranding(branding){
  if (!branding) return;
  state.branding = { ...state.branding, ...branding };
  const root = document.documentElement;
  if (branding.primaryColor){ root.style.setProperty('--brand-blue', branding.primaryColor); }
  if (branding.accentColor){  root.style.setProperty('--brand-green', branding.accentColor); }
  const logo = document.getElementById('brandLogo');
  const src = branding.logoUrl || state.branding.logoUrl || DEFAULT_LOGO_DATAURI;
  if (logo && src){ logo.src = src; logo.style.background='none'; }
  const titleEl = document.querySelector('.brand .title');
  if (titleEl){ titleEl.textContent = branding.teamName || state.branding.teamName || 'RadSystems Portal'; }
}

/**
 * strict=true:
 *  - resolve(true) only if branding exists and is applied
 *  - throw on network errors
 *  - do NOT fallback to defaults unless caller decides to
 */
export async function loadBranding(strict=false){
  try{
    const r = await api('admin.branding.get', {});
    const b = r?.branding || {};
    const hasBranding = Object.keys(b).some(k => b[k]);
    if (!hasBranding) {
      if (strict) return false;
      applyBranding({ logoUrl: DEFAULT_LOGO_DATAURI });
      return false;
    }
    state.branding = { ...state.branding, ...b };
    applyBranding(b);
    return true;
  }catch(err){
    if (strict) throw err;   // caller will decide what to do
    applyBranding({ logoUrl: DEFAULT_LOGO_DATAURI });
    return false;
  }
}
