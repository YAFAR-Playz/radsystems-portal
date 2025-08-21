export const DEFAULT_LOGO_DATAURI =
  'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E84545"/>
  <stop offset="0.6" stop-color="#1F3C88"/><stop offset="1" stop-color="#6BCB77"/></linearGradient></defs>
  <rect rx="22" ry="22" width="128" height="128" fill="url(#g)"/>
  <text x="50%" y="53%" font-family="Inter, Arial" font-size="54" font-weight="800" text-anchor="middle" fill="white">RS</text></svg>`);

export const state = {
  user:null,
  branding:{
  dateFormat:'yyyy-MM-dd',
  primaryColor:'#1F3C88',
  accentColor:'#6BCB77',
  logoUrl: DEFAULT_LOGO_DATAURI,
  teamName:'RadSystems Portal'  // NEW
},
  assistant:{ students:[], assignments:[], checks:[] },
  head:{ assistants:[], students:[], assignments:[], analytics:{}, editingId:null },
  admin:{ users:[], assistants:[], students:[], courses:[], enrollments:[], roles:[], perms:[], currentRole:'' }
};
