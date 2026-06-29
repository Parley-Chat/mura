function backport(ls, nw, type='string') {
  if (localStorage.getItem(ls)) {
    let val = localStorage.getItem(ls);
    if (type==='boolean') val = val==='true';
    window.settings[nw] = val;
    localStorage.removeItem(ls);
  }
}

window.saveSettings = ()=>{
  localStorage.setItem('parleySettings', JSON.stringify(window.settings));
}

try {
  if (!localStorage.getItem('parleySettings')) localStorage.setItem('parleySettings', '{}');
  window.settings = JSON.parse(localStorage.getItem('parleySettings'));
  // Fill empty & backport
  window.settings.panelSizing ??= [20, 20];

  window.settings.theme ??= '#37005c';
  backport('ptheme', 'theme');
  window.settings.font ??= 'lexend';
  backport('pfont', 'font');
  window.settings.notifications ??= false;
  backport('pnotif', 'notifications', 'boolean');
  window.settings.mediaOnData ??= false;
  backport('pmedialways', 'mediaOnData', 'boolean');
  window.settings.rememberChannel ??= true;
  window.settings.rememberServer ??= false;
  window.settings.lastServer ??= '';
  backport('prc', 'rememberChannel', 'boolean');
  backport('prs', 'rememberServer', 'boolean');
  backport('pls', 'lastServer');
  window.saveSettings();
} catch(err) {
  window.settings = {};
}