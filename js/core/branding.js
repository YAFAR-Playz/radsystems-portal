import { api } from './api.js';
import { state, DEFAULT_LOGO_DATAURI } from './state.js';

export function applyBranding(branding){
  if (!branding) return;
  state.branding = { ...state.branding, ...branding };
  const root = document.documentElement;
  if (branding.primaryColor){ root.style.setProperty('--brand-blue', branding.primaryColor); }
  if (branding.accentColor){ root.style.setProperty('--brand-green', branding.accentColor); }
  const logo = document.getElementById('brandLogo');
  const src = state.branding.logoUrl || DEFAULT_LOGO_DATAURI;
  if (logo && src){ logo.src = src; logo.style.background='none'; }
  const titleEl = document.querySelector('.brand .title');
  if (titleEl){
    titleEl.textContent = state.branding.teamName || 'RadSystems Portal';
  }
  if (branding.customLoginModelUrl) state.branding.customLoginModelUrl = branding.customLoginModelUrl;
}

export async function loadBranding(){
  try{
    const r = await api('admin.branding.get',{});
    const b = r.branding || {};
    state.branding = {...state.branding, ...b};
    applyBranding({ logoUrl: b.logoUrl || DEFAULT_LOGO_DATAURI, primaryColor:b.primaryColor, accentColor:b.accentColor });
  }catch(e){
    try{
      const pub = await api('public.config', {});
      if (pub && pub.branding) applyBranding({ ...pub.branding, logoUrl: pub.branding.logoUrl || DEFAULT_LOGO_DATAURI });
      else applyBranding({ logoUrl: DEFAULT_LOGO_DATAURI });
    }catch(_){
      applyBranding({ logoUrl: DEFAULT_LOGO_DATAURI });
    }
  }
}
