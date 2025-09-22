// Try to get the best match
const default_lang = 'en-US';
const languages = {
  'en-US': 'en-US',
  'en-GB': 'en-US',
  'en': 'en-US',
  'es-ES': 'es-ES',
  'es-419': 'es-ES',
  'es': 'es-ES',
  'fa': 'fa'
};

// Try to get the user langs
function getUserLang() {
  return languages[localStorage.getItem('language')]??languages[navigator.language]??languages[navigator.language.split('-')[0]]??default_lang;
}

// Fallback if no caches support
if (!window.caches) {
  window._caches = {};
  window.caches = {
    open: async(id)=>{
      if (!window._caches[id]) window._caches[id] = {};
      return {
        match: async(di)=>{return window._caches[id][di]},
        put: async(di,req)=>{window._caches[id][di]=req}
      };
    },
    delete: (id)=>{
      delete window._caches[id];
    }
  };
}

// Fetch the translation file
let mcache = {};
async function getTranslationFile(lang) {
  if (mcache[lang]) return mcache[lang];

  const controller = new AbortController();
  const url = `./media/langs/${lang}.json`;

  const cachePromise = window.caches.open('lang-cache-'+lang).then(async(cache) => {
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
      controller.abort('Cache first');
      return cachedResponse.json();
    }
    return null;
  });

  const networkPromise = fetch(url, { signal: controller.signal })
    .then(async (response) => {
      if (response && response.ok) {
        const cache = await window.caches.open('lang-cache-'+lang);
        cache.put(url, response.clone());
      }
      return response.json();
    });

  const cacheResult = await cachePromise;
  if (cacheResult) {
    mcache[lang] = cacheResult;
    return cacheResult;
  }
  mcache[lang] = networkPromise;
  return networkPromise;
}

// Find all elements with lang attribute and translate
function translate(attempt=0) {
  document.querySelector('html').lang = getUserLang();
  getTranslationFile(getUserLang())
    .then(file=>{
      document.querySelectorAll('*:not(html)[lang]').forEach(elem=>{
        let trans = file[elem.getAttribute('lang')];
        if (trans===undefined) {
          console.log('Missing translation for '+elem.getAttribute('lang'), elem);
          if (attempt<5) translate(attempt+1);
          window.caches.delete('lang-cache-'+getUserLang());
          delete mcache[getUserLang()];
          return;
        }
        if (['input','textarea'].includes(elem.tagName.toLowerCase())) {
          let p = 'placeholder';
          if (elem.getAttribute(p)===trans) return;
          elem.setAttribute(p, trans);
          return;
        }
        if (elem.tagName.toLowerCase()==='img') {
          let p = 'alt';
          if (elem.getAttribute(p)===trans) return;
          elem.setAttribute(p, trans);
          return;
        }
        if (elem.tagName.toLowerCase()==='button'&&elem.querySelector('svg,img')) {
          if (elem.getAttribute('aria-label')===trans) return;
          elem.setAttribute('aria-label', trans);
          return;
        }
        if (elem.innerText===trans) return;
        elem.innerText = trans;
      })
    });
}
if (!localStorage.getItem('language')) localStorage.setItem('language', getUserLang());
window.translate = translate;

window.addEventListener('DOMContentLoaded', ()=>{
  translate();

  const observer = new MutationObserver(translate);
  observer.observe(document.body, {
    attributes: true,
    subtree: true
  });
});