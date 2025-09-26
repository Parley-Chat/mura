const Permissions = {
  OWNER: 1,
  ADMIN: 2,
  SEND_MESSAGES: 4,
  MANAGE_MESSAGES: 8,
  MANAGE_MEMBERS: 16,
  MANAGE_CHANNEL: 32,
  MANAGE_PERMISSION: 64
};
const OwnerAlt = 127;
const AdminAlt = 126;
const DummyUser = {
  display: 'Reserved',
  username: 'r',
  pfp: null
};

function loggedIn() {
  let options = [!!localStorage.getItem(window.currentServer+'-sessionToken'), !!localStorage.getItem(window.currentServer+'-publicKey'), !!localStorage.getItem(window.currentServer+'-privateKey')];
  return options.filter(o=>!o).length<1;
}
function logout() {
  backendfetch('/api/v1/me/logout', {
    method: 'DELETE'
  });
  localStorage.removeItem(window.currentServer+'-sessionToken');
  localStorage.removeItem(window.currentServer+'-username');
  location.reload();
}
function logoutall() {
  backendfetch('/api/v1/me/sessions', {
    method: 'DELETE'
  });
  localStorage.removeItem(window.currentServer+'-sessionToken');
  localStorage.removeItem(window.currentServer+'-username');
  location.reload();
}

function downloadKeys() {
  let a = document.createElement('a');
  a.download = window.username+'.keys';
  a.href = URL.createObjectURL(new Blob([JSON.stringify({
    publicKey: localStorage.getItem(window.currentServer+'-publicKey'),
    privateKey: localStorage.getItem(window.currentServer+'-privateKey')
  })], { type: 'text/plain' }));
  a.click();
  a.remove();
}

function hasPerm(bitfield, perm) {
  return (bitfield & (1 << Math.log2(perm))) !== 0;
}

function sanitizeHTML(html) {
  return html.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"', '&quot;');
}
function sanitizeMinimChars(text) {
  return text.replaceAll(/[^a-zA-Z0-9_\-]/g,'');
}
function sanitizeAttr(inp) {
  return inp.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('¬', '¬|').replaceAll('"', "¬'").replaceAll(/\r?\n/g, '\\n');
}
function desanitizeAttr(inp) {
  return inp.replaceAll("¬'", '"').replaceAll('¬|', '¬');
}

function bufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const AskModal = document.getElementById('ask');
function ask(title, min=0, max=20, def='') {
  let input = AskModal.querySelector('input');
  let button = AskModal.querySelector('button.set');
  AskModal.showModal();
  AskModal.querySelector('h2').setAttribute('lang', title);
  input.value = def;
  input.setAttribute('minlength', min);
  input.setAttribute('maxlength', max);
  input.focus();
  button.setAttribute('lang', title+'.next');
  return new Promise((resolve, reject)=>{
    AskModal.onclose = reject;
    button.onclick = ()=>{
      AskModal.close();
      resolve(input.value);
    };
    input.onkeyup = (evt)=>{
      if (evt.key!=='Enter') return;
      button.onclick();
    };
  });
}

const NoticeModal = document.getElementById('notice');
let NoticeBacklog = [];
function notice(title, rep='', bypass=false) {
  if (!bypass) {
    NoticeBacklog.push([title, rep]);
    if (NoticeBacklog.length>1) return;
  }
  NoticeModal.showModal();
  let h = NoticeModal.querySelector('h3');
  h.setAttribute('lang', title);
  window.translate();
  setTimeout(()=>{
    h.innerText = h.innerText.replace('{}',rep);
  },0);
  NoticeModal.onclose = ()=>{
    NoticeBacklog.shift();
    if (NoticeBacklog.length>0) {
      notice(NoticeBacklog[0][0], NoticeBacklog[0][1], true);
    }
  };
}

function smallScreen() {
  return window.matchMedia(`(max-width: 700px)`).matches;
}

function getLanguageName(iso) {
  const displayNames = new Intl.DisplayNames([iso], { type: 'language' });
  let display = displayNames.of(iso);
  return display==='tok'?'Toki Pona':display; // Tok not supported fully
}
function formatTime(date) {
  let now = new Date();
  date = new Date(date);
  let locale = localStorage.getItem('timeUILang')==='true'?localStorage.getItem('language'):navigator.language;

  let startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let diff = Math.round((startDate-startToday) / (24*60*60*1000));

  let time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);

  let prefix = '';
  if (Math.abs(diff)<=1) {
    prefix = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
      .format(diff, "day");
  } else {
    prefix = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
      .format(date);
  }
  return `${prefix} ${time}`;
}
function formatHour(date) {
  date = new Date(date);
  let locale = localStorage.getItem('timeUILang')?localStorage.getItem('language'):navigator.language;

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

const DefaultPFPRadix = 12;
function userToDefaultPfp(user) {
  user = (user.display??user.username??user.name).toLowerCase().replaceAll(/[^a-zA-Z0-9]/g,'');
  return 'data:image/svg+xml,'+encodeURIComponent(window.defaultpfp
    .replace('PFP',user.slice(0,1))
    .replace('074104',(parseInt(user, 36)%(DefaultPFPRadix**6)).toString(DefaultPFPRadix).padStart(6, '0')));
}
function pfpById(id) {
  return window.currentServer+'/pfp/'+sanitizeMinimChars(id);
}

async function newRSAKeys() {
  window.keyPair = null;
  const keyPair = await window.crypto.subtle.generateKey({
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']);

  let exportedPublicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  let exportedPrivateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  localStorage.setItem(window.currentServer+'-publicKey', bufferToBase64(exportedPublicKey));
  localStorage.setItem(window.currentServer+'-privateKey', bufferToBase64(exportedPrivateKey));
}
async function getRSAKeyFromPublic64(public) {
  return await window.crypto.subtle.importKey("spki",
    base64ToBuffer(public),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    true,
    ['encrypt']);
}
window.keyPair = undefined;
async function getRSAKeyPair() {
  if (window.keyPair) return window.keyPair;
  const publicKey = await getRSAKeyFromPublic64(localStorage.getItem(window.currentServer+'-publicKey'));
  const privateKey = await window.crypto.subtle.importKey("pkcs8",
    base64ToBuffer(localStorage.getItem(window.currentServer+'-privateKey')),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    true,
    ['decrypt']);

  window.keyPair = { publicKey, privateKey };
  return window.keyPair;
}
const RSAlabel = new TextEncoder().encode('parley');
async function encryptRSAString(string, key) {
  const encoder = new TextEncoder();
  let data = encoder.encode(string);
  return bufferToBase64(await window.crypto.subtle.encrypt({ name: 'RSA-OAEP', label: RSAlabel }, key, data))
}
async function decryptRSAString(string, key) {
  const decoder = new TextDecoder();
  return decoder.decode(await window.crypto.subtle.decrypt({ name: "RSA-OAEP", label: RSAlabel }, key, base64ToBuffer(string)));
}

async function newAESKey() {
  const key = await window.crypto.subtle.generateKey({
      name: 'AES-GCM',
      length: 128
    },
    true,
    ['encrypt', 'decrypt']);

  return key;
}
async function AESKeyToBase64(key) {
  return bufferToBase64(await window.crypto.subtle.exportKey('raw', key));
}
async function base64ToAESKey(key) {
  return await window.crypto.subtle.importKey(
    'raw',
    base64ToBuffer(key),
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
}
async function encryptAESString(string, key) {
  const encoder = new TextEncoder();
  let data = encoder.encode(string);
  let iv = window.crypto.getRandomValues(new Uint8Array(12));
  return { txt: bufferToBase64(await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)), iv: bufferToBase64(iv) };
}
async function decryptAESString(string, key, iv) {
  const decoder = new TextDecoder();
  return decoder.decode(await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBuffer(iv) }, key, base64ToBuffer(string)));
}

async function backendfetch(url, opts={}) {
  if (!opts.headers) opts.headers = {};
  opts.headers.authorization = 'Bearer '+localStorage.getItem(window.currentServer+'-sessionToken');
  let req = await fetch(window.currentServer+url, opts);
  let res = await req.json();
  if (req.status===419) {
    await solveChallenge(res.challenge, res.id, ()=>{});
    return await backendfetch(url, opts);
  } else {
    if (opts.passstatus) res.status = req.status;
    return res;
  }
}

async function solveChallenge(challenge, id, callback) {
  if (!challenge || !id) throw new Error('Missing data');
  let formData = new FormData();
  formData.append('id', id);
  let keys = await getRSAKeyPair();
  if (!keys) throw new Error('Missing keys');
  formData.append('solve', await decryptRSAString(challenge, keys.privateKey));

  let req = await fetch(window.currentServer+`/api/v1/solve`, {
    method: 'POST',
    body: formData
  });
  if (req.status===200) {
    let res = await req.json();
    localStorage.setItem(window.currentServer+'-sessionToken', res.session);
    callback(res);
    return;
  } else {
    // Uh, very temp
    console.log(id, challenge, keys.privateKey);
    alert('Failed decoding, private and public match?');
  }
}

window.keys = {};
function getKeyContents(id, key, callback=()=>{}) {
  if (!window.keys[id]) window.keys[id] = {};
  if (window.keys[id][key]) {
    callback();
    return;
  }
  backendfetch('/api/v1/key/'+key)
    .then(data=>{
      if (!data.success) {
        callback();
        return;
      }
      if (data.expires_at.toString().length===10) data.expires_at*=1000;
      window.keys[id][key] = data;
      callback();
    });
}
function getKeysBatch(id, keys, callback=()=>{}) {
  if (!keys || keys.filter(k=>typeof k!=='undefined').length<1) {
    callback();
    return;
  }
  if (!window.keys[id]) window.keys[id] = {};
  backendfetch('/api/v1/keys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(keys)
  })
    .then(data=>{
      data.forEach(key=>{
        window.keys[id][key.key_id] = key;
      });
      callback();
    });
}
function getCurrentKeyChannel(id, callback=()=>{}) {
  if (!window.keys[id]) window.keys[id] = {};
  backendfetch('/api/v1/channel/'+id+'/key')
    .then(async(key)=>{
      if (!key.key_id || window.keys[id][key.key_id]) {
        callback();
        return;
      }
      getKeyContents(id, key.key_id, callback);
    });
}

let pfpSize = 256;
let pfpFormat = 'image/webp';
let pfpQuality = 0.9;
function processImageToPfp(file) {
  return new Promise((resolve, reject) => {
    // Load image
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      // Create canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = pfpSize;
      canvas.height = pfpSize;

      let ratio = img.width / img.height;
      let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;

      // Ratio > 1 then width > height
      if (ratio > 1) {
        srcW = img.height;
        srcX = (img.width - srcW) / 2;
      } else {
        srcH = img.width;
        srcY = (img.height - srcH) / 2;
      }

      // Draw image
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, pfpSize, pfpSize);

      // Convert
      canvas.toBlob((blob) => {
        if (!blob) reject();
        URL.revokeObjectURL(img.src);
        canvas.remove();
        resolve(blob);
      }, pfpFormat, pfpQuality);
    };
  });
}