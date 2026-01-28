// Imports
import * as calls from './calls.js';

// Stores
const UserStore = new Map();
const MemberStore = new Map();
window.UserStore = UserStore;
window.MemberStore = MemberStore;

let ChannelNotifStore = new Map();
window.ChannelNotifStore = ChannelNotifStore;
let PinnedChannelsStore = new Map();
window.PinnedChannelsStore = PinnedChannelsStore;
let PKStore = new Map();
window.PKStore = PKStore;
const PKChannels = [];

async function saveToDB() {
  let tx = db.transaction(['servers'], 'readwrite');
  let store = tx.objectStore('servers');
  let req = store.get(window.currentServer);
  req.onsuccess = (e)=>{
    let val = e.target.value??{ notifs: {}, public: {}, pinned: {} };
    val.notifs = Object.fromEntries(ChannelNotifStore);
    val.public = Object.fromEntries(PKStore);
    val.pinned = Object.fromEntries(PinnedChannelsStore);
    store.put(val, window.currentServer);
  }
}
window.saveToDB = saveToDB;

const ValidSignature = Symbol('Valid signature');
const InvalidSignature = Symbol('Invalid signature');

// Messages
const messageInput = document.getElementById('input');
window.messageInput = messageInput;
const messageSned = document.getElementById('sned');
const fileButton = document.getElementById('addfilebutton');
const fileInput = document.getElementById('addfile');
const mentionMenu = document.getElementById('mentionmenu');
const imageicon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 40C0 28.9543 8.95431 20 20 20H236C247.046 20 256 28.9543 256 40V215C256 226.046 247.046 235 236 235H20C8.95431 235 0 226.046 0 215V40ZM78 68C78 81.8071 66.8071 93 53 93C39.1929 93 28 81.8071 28 68C28 54.1929 39.1929 43 53 43C66.8071 43 78 54.1929 78 68ZM150.135 91.8679C153.266 86.7107 160.734 86.7107 163.865 91.8679L234.817 208.76C238.075 214.127 234.22 221 227.952 221H142.029H86.048H26.9705C20.3787 221 16.6463 213.367 20.6525 208.08L78.1821 132.152C81.3664 127.949 87.6335 127.949 90.8179 132.152L110.176 157.7L150.135 91.8679Z"/></svg>';
window.messages = {};
let files = [];
let reply = null;
messageInput.oninput = messageInput.onchange = function() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight-4, 16 * 10) + 'px';
};
async function BasicSend(msg, sign, channel, akey=null, iv=null) {
  let formData = new FormData();
  // Data
  formData.append('content', msg);
  if (akey) {
    formData.append('key', akey);
    formData.append('iv', iv);
  }
  if (reply) formData.append('replied_to', reply);
  files.forEach(file=>formData.append('files', file, file.name));
  // Signature
  let sdate = Math.ceil(Date.now()/1000);
  let signat = `${sign}:${channel}:${sdate}`;
  let skey = await getRSAKeyPair();
  let signature = await signRSAString(signat, skey.privateKey);
  formData.append('timestamp', sdate);
  formData.append('signature', signature);
  // Ghost
  if (!window.messages[channel]) window.messages[channel] = [];
  let nonce = Math.floor(Math.random()*16**6).toString(16);
  formData.append('nonce', nonce);
  window.messages[channel].unshift({
    ghost: 1,
    id: 'nonce-'+nonce,
    timestamp: Date.now(),
    content: sign,
    signature,
    signed_timestamp: sdate,
    user: UserStore.get(window.username),
    attachments: files.map(f=>{return {
      id: '',
      filename: f.name,
      size: f.size,
      mimetype: f.type
    }}),
    key: null,
    iv: null,
    edited_at: null,
    replied_to: null,
  });
  window.messages[channel][0].user.hide = shouldHideUser(window.messages[channel], 0);
  messagesContainer.insertAdjacentHTML('afterbegin', await displayMessage(window.messages[channel][0], channel, 2));
  // Cleanup
  messageInput.value = '';
  messageInput.oninput();
  files = [];
  filePreview();
  reply = null;
  window.closereply();
  document.getElementById('messages').scrollTop = 0;
  // In case of fail
  let failed = async()=>{
    let o;
    window.messages[channel] = window.messages[channel]
      .map(msg=>{
        if (msg.id === 'nonce-'+nonce) {
          msg.ghost = 2;
          o = msg;
        }
        return msg;
      });
    if (window.currentChannel===channel) document.getElementById('m-nonce-'+nonce).outerHTML = await displayMessage(o, channel, 2);
  }
  // Send
  backendfetch(`/api/v1/channel/${channel}/messages`, {
    method: 'POST',
    body: formData,
    passstatus: true
  })
    .then(res=>{
      if (res.status.toString().startsWith('2')) return;
      failed();
    })
    .catch(()=>{
      failed();
    });
}
async function CryptSend(msg, channel) {
  getCurrentKeyChannel(channel, async()=>{
    let last = Object.keys(window.keys[channel]).reduce((a, b) => window.keys[channel][a]?.expires_at > window.keys[channel][b]?.expires_at ? a : b, '');
    if (!last || Date.now()>window.keys[channel][last].expires_at) {
      backendfetch(`/api/v1/channel/${channel}/members?pb=true`)
        .then(async(members)=>{
          let nkey = await newAESKey();
          let newKey = await AESKeyToBase64(nkey);
          let body = {};
          let discontinue = false;
          for (let i=0; i<members.length; i++) {
            let publicKey;
            if (PKStore.has(members[i].username)) {
              publicKey = PKStore.get(members[i].username);
              if (publicKey!==members[i].public) {
                let conf = await affirm('message.publicChange', members[i].username);
                if (!discontinue) discontinue = !conf;
                if (conf) {
                  PKStore.set(members[i].username, members[i].public);
                  publicKey = members[i].public;
                }
              }
            } else {
              publicKey = members[i].public;
              PKStore.set(members[i].username, publicKey);
              saveToDB();
            }
            publicKey = await getRSAKeyFromPublic64(publicKey);
            body[members[i].username] = await encryptRSAString(newKey, publicKey);
          }
          if (discontinue) return;
          backendfetch(`/api/v1/channel/${channel}/key`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify(body)
          })
            .then(async(pkey)=>{
              getKeyContents(channel, pkey.key_id);
              let enc = await encryptAESString(msg, nkey);
              BasicSend(enc.txt, msg, channel, pkey.key_id, enc.iv);
            });
        });
    } else {
      const privateKey = (await getRSAKeyPair()).privateKey;
      let nkey = await base64ToAESKey(await decryptRSAString(window.keys[channel][last].key, privateKey));
      let enc = await encryptAESString(msg, nkey);
      BasicSend(enc.txt, msg, channel, last, enc.iv);
    }
  });
}
async function MessageSend() {
  let msg = messageInput.value.trim()
  messageInput.value = msg;
  if (msg.length<1&&files.length<1) return;
  if (window.currentChannelType===3) {
    BasicSend(msg, msg, window.currentChannel);
  } else {
    CryptSend(msg, window.currentChannel);
  }
}
let lastMention = '';
let messageCursorStart = 0;
let messageCursorEnd = 0;
function handleMentionMenu() {
  mentionMenu.style.display = 'none';
  messageCursorStart = messageInput.selectionStart;
  messageCursorEnd = messageInput.selectionEnd;
  if (messageCursorStart===messageCursorEnd) {
    let content = messageInput.value;
    if (!content.includes('@')) return;
    content = content.slice(Math.max(messageCursorStart-20,0), messageCursorStart);
    if (!content.includes('@')) return;
    content = content.split('@').slice(-1)[0];
    if (!content || content.length<2 || !(/^[a-z0-9\-_]+?$/i).test(content)) return;
    if (lastMention===content) return;
    lastMention = content;
    mentionMenu.style.display = '';
    mentionMenu.innerHTML = (MemberStore.get(window.currentChannel)??[])
      .map(usr=>{
        let letters = content.split('');
        usr.sim = usr.username.split('').map(l=>letters.includes(l)).reduce((acc,cur)=>acc+cur,0);
        if (usr.username.includes(content)) usr.sim += content.length*1.5;
        return usr;
      })
      .filter(usr=>usr.sim>(usr.username.length/3))
      .toSorted((a,b)=>b.sim-a.sim)
      .map(usr=>`<div tabindex="0" role="button" onclick="let k=messageInput.value.slice(0,messageInput.selectionStart).split('@').slice(0,-1).join('@').length+1;messageInput.value=messageInput.value.slice(0,k)+'${sanitizeMinimChars(usr.username)} '+messageInput.value.slice(k+${content.length});messageInput.focus();messageInput.setSelectionRange(k+${sanitizeMinimChars(usr.username).length+1},k+${sanitizeMinimChars(usr.username).length+1});messageInput.onkeyup();">
  <img src="${usr.pfp?pfpById(usr.pfp):userToDefaultPfp(usr)}" width="42" height="42" aria-hidden="true" loading="lazy" alt="User pfp">
  <div>
    <span>${sanitizeHTML(usr.display??sanitizeMinimChars(usr.username))}</span>
    <span class="small">@${sanitizeMinimChars(usr.username)}</span>
  </div>
</div>`)
      .join('');
    if (mentionMenu.innerHTML.length<3) mentionMenu.style.display = 'none';
  }
}
messageInput.onkeydown = function(event) {
  if (event.key!=='Enter'||event.shiftKey) return;
  event.preventDefault();
  mentionMenu.style.display = 'none';
  MessageSend();
};
messageInput.onkeyup = handleMentionMenu;
messageInput.onmouseup = handleMentionMenu;
messageSned.onclick = MessageSend;
function elemfilepreview(file) {
  let url = URL.createObjectURL(file);
  let type = file.type.split('/')[0];
  switch(type) {
    case 'image':
    case 'video':
    case 'audio':
      return `<${type.replace('age','g')} src="${url}" alt="File preview: ${sanitizeAttr(file.name)}" controls loading="lazy"></${type.replace('age','g')}>`;
    default:
      return `<div class="file">${sanitizeHTML(file.name)} · ${formatBytes(file.size)}</div>`;
  }
}
window.removefile = (i)=>{
  files.splice(i, 1);
  filePreview();
};
function filePreview() {
  document.getElementById('filepreview').innerHTML = files
    .map((fil,i)=>`<div>
  <button onclick="window.removefile(${i})">x</button>
  ${elemfilepreview(fil)}
</div>`)
    .join('');
}
fileButton.onclick = ()=>{
  fileInput.click();
};
function addFiles(fils) {
  files = files.concat(fils);
  files = files.filter(file=>{
    if (file.size>window.serverData[getCurrentServerUrl()].max_file_size.attachments) {
      notice('message.attachment.toobig', file.name);
      return false;
    }
    return true;
  });
  if (files.length>window.serverData[getCurrentServerUrl()].messages.max_attachments) {
    files = files.slice(0, window.serverData[getCurrentServerUrl()].messages.max_attachments);
    notice('message.attachment.toomany', window.serverData[getCurrentServerUrl()].messages.max_attachments);
  }
  filePreview();
}
fileInput.onchange = (event)=>{
  addFiles(Array.from(event.target.files));
  fileInput.value = '';
};
messageInput.onpaste = (event)=>{
  let items = (event.clipboardData??event.originalEvent.clipboardData).items;
  items = Array.from(items).filter(item=>item.kind==='file').map(item=>item.getAsFile());
  if (items.length<1) return;
  addFiles(items);
};
document.body.ondrop = (evt)=>{
  if (document.querySelector('dialog[open]')) return;
  evt.stopPropagation();
  evt.preventDefault();

  if (evt.dataTransfer.items) {
    for (let i = 0; i<evt.dataTransfer.items.length; i++) {
      if (evt.dataTransfer.items[i].kind!=='file') continue;
      addFiles([evt.dataTransfer.items[i].getAsFile()]);
    }
  } else {
    addFiles(evt.dataTransfer.files);
  }
};
document.body.ondragover = (evt)=>{
  if (document.querySelector('dialog[open]')) return;
  evt.preventDefault();
};
const emojiButton = document.getElementById('emoj');
const emojiPicker = document.querySelector('emoji-picker');
emojiButton.onclick = ()=>{
  emojiPicker.style.display = emojiPicker.style.display===''?'none':'';
  let b = emojiButton.getBoundingClientRect();
  emojiPicker.style.right = window.innerWidth-b.right-(b.width/2)+'px';
};
emojiPicker.addEventListener('emoji-click', (evt)=>{
  let emoji = `:${evt.detail.emoji.shortcodes.toSorted((a,b)=>a.length-b.length)[0]}:${evt.detail.skinTone!==0&&evt.detail.emoji.skins?`:tone${evt.detail.skinTone}:`:''}`;
  let start = messageInput.value.substring(0, messageCursorStart);
  let end = messageInput.value.substring(messageCursorEnd, messageInput.value.length);
  messageInput.value = start+emoji+end;
  messageCursorStart += emoji.length;
  messageCursorEnd = messageCursorStart;
});

async function EditMessage(channel, msg, content, sign, iv=null) {
  let formData = new FormData();
  // Data
  formData.append('content', content);
  if (iv) formData.append('iv', iv);
  // Signature
  let sdate = Math.ceil(Date.now()/1000);
  let signat = `${sign}:${channel}:${sdate}`;
  let skey = await getRSAKeyPair();
  let signature = await signRSAString(signat, skey.privateKey);
  formData.append('timestamp', sdate);
  formData.append('signature', signature);
  // Send
  backendfetch(`/api/v1/channel/${channel}/message/${msg}`, {
    method: 'PATCH',
    body: formData
  })
    .then(()=>{showMessages(window.messages[channel])});
}
function CryptEditMessage(channel, msg, content, key) {
  getKeyContents(channel, key, async()=>{
    const privateKey = (await getRSAKeyPair()).privateKey;
    let nkey = await base64ToAESKey(await decryptRSAString(window.keys[channel][key].key, privateKey));
    let enc = await encryptAESString(content, nkey);
    EditMessage(channel, msg, enc.txt, content, enc.iv);
  });
}

window.replyMessage = (msg, usr)=>{
  reply = msg;
  document.getElementById('replypreview').style.display = '';
  document.querySelector('#replypreview .usr').innerText = usr;
  messageInput.focus();
};
window.closereply = ()=>{
  reply = null;
  document.getElementById('replypreview').style.display = 'none';
};
window.pinMessage = (msg, state=true)=>{
  backendfetch(`/api/v1/channel/${window.currentChannel}/message/${msg}/pin`, {
    method: state?'POST':'DELETE'
  });
};
window.editMessage = (msg, key, elem, cont)=>{
  elem.querySelector('.content').outerHTML = `<textarea name="message" class="content" maxlength="${window.serverData[getCurrentServerUrl()]?.messages?.max_message_length??2000}"></textarea>
<div>
  <button class="save" tlang="message.edit.save">Save</button>
  <button class="cancel" tlang="message.edit.cancel">Cancel</button>
</div>`;
  elem.querySelector('.actions').style.display = 'none';
  let textarea = elem.querySelector('textarea');
  textarea.value = desanitizeAttr(cont);
  textarea.focus();
  textarea.oninput = textarea.onchange = ()=>{
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight-4, 16 * 10) + 'px';
  };
  textarea.oninput();
  elem.querySelector('button.save').onclick = ()=>{
    if (window.currentChannelType===3) {
      EditMessage(window.currentChannel, msg, textarea.value, textarea.value);
    } else {
      CryptEditMessage(window.currentChannel, msg, textarea.value, key);
    }
  };
  elem.querySelector('button.cancel').onclick = ()=>{
    showMessages(window.messages[window.currentChannel]);
  };
};
window.deleteMessage = (msg)=>{
  backendfetch('/api/v1/channel/'+window.currentChannel+'/message/'+msg, {
    method: 'DELETE'
  });
};
window.previewMessage = (msg)=>{
  let m = document.getElementById(`m-${msg}`);
  m.scrollIntoView({ behavior: 'smooth' });
  m.classList.add('highlight');
  setTimeout(()=>{
    m.classList.remove('highlight');
  }, 500);
};

class MediaCom extends HTMLElement {
  constructor() {
    super();
  }
  static observedAttributes = ['load'];
  connectedCallback() {
    if (saveData()) {
      this.innerHTML = `<div class="file">
  <span>${sanitizeHTML(desanitizeAttr(this.getAttribute('data-name')))} · ${formatBytes(this.getAttribute('data-size'))}</span>
  <button onclick="this.parentElement.parentElement.setAttribute('load',true)" tlang="message.download" style="margin-top:10px;padding:5px;background-color:var(--bg-2);">Download</button>
</div>`;
    } else {
      this.setAttribute('load',true);
    }
  }
  attributeChangedCallback() {
    this.outerHTML = `<${this.getAttribute('type')} src="${this.getAttribute('data-src')}" alt="Message attachment: ${this.getAttribute('data-name')}" controls loading="lazy"></${this.getAttribute('type')}>`.replace('</img>','');
  }
}
class TxtLoader extends HTMLElement {
  constructor() {
    super();
  }
  connectedCallback() {
    fetch(`${getCurrentServerUrl()}/attachment/${this.getAttribute('data-id')}`)
      .then(res=>{
        if (!res.ok) throw new Error('non ok');
        return res.text();
      })
      .then(res=>this.innerHTML=sanitizeHTML(res))
      .catch(()=>this.remove());
  }
}
customElements.define('media-com', MediaCom);
customElements.define('txt-loader', TxtLoader);

window.downloadfile = (id, name)=>{
  fetch(`${getCurrentServerUrl()}/attachment/${id}`)
    .then(res=>res.blob())
    .then(res=>{
      let url = URL.createObjectURL(res);
      let down = document.createElement('a');
      down.href = url;
      down.download = desanitizeAttr(name);
      document.body.appendChild(down);
      down.click();
      URL.revokeObjectURL(url);
    });
};

let MDCustom = (txt)=>{
  // User mentions
  txt = txt
    .replaceAll(/@([a-zA-Z0-9_\-]{3,20}?|e)(?=$|\s|\*|\_|\~|<|@)/gi, function(match){return `<span class="mention">${match}</span>`});
  // Emoji
  txt = txt
    .replaceAll(/:([a-zA-Z0-9_<!%&\?\*\+\.\- ]+?):/g, (match,g1)=>window.emojiShort[g1.toLowerCase()]??match);
  txt = twemoji.parse(txt, twemojiConfig);
  return txt;
};

const textdisplay = ['text/plain','text/html','text/css','text/csv','text/tab-separated-values','text/markdown','text/x-markdown','text/xml','application/xhtml+xml','text/javascript','text/ecmascript','text/x-python','text/x-c','text/x-c++','text/x-java','text/x-java-source','text/x-rustsrc','text/x-go','text/x-php','text/x-perl','text/x-ruby','text/x-lua','text/vcard','text/vcalendar','text/calendar','text/x-vcard','text/x-vcalendar','application/json','application/ld+json','application/xml','application/javascript','application/ecmascript','application/x-www-form-urlencoded','application/yaml','application/x-yaml','text/x-yaml','application/graphql','application/sql','application/toml','application/x-toml','text/x-toml','application/ini','text/x-ini','application/x-sh','application/x-httpd-php']
function attachToElem(att) {
  if (textdisplay.includes(att.mimetype)) {
    return `<div class="file">
  <span>${sanitizeHTML(att.filename)} · ${formatBytes(att.size)} <button onclick="window.downloadfile('${sanitizeMinimChars(att.id)}', '${sanitizeAttr(att.filename).replaceAll("'", "\\'")}')" aria-label="Download" tlang="message.download"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M128 190V20" stroke-width="40" stroke-linecap="round" fill="none"/><path d="M127.861 212.999C131.746 213.035 135.642 211.571 138.606 208.607L209.317 137.896C212.291 134.922 213.753 131.011 213.708 127.114C213.708 127.076 213.71 127.038 213.71 127C213.71 118.716 206.994 112 198.71 112H57C48.7157 112 42 118.716 42 127C42 127.045 42.0006 127.089 42.001 127.134C41.961 131.024 43.4252 134.927 46.3936 137.896L117.104 208.607L117.381 208.876C120.312 211.662 124.092 213.037 127.861 212.999Z"/><rect y="226" width="256" height="30" rx="15"/></svg></button></span>
  <txt-loader data-id="${sanitizeMinimChars(att.id)}">...</txt-loader>
</div>`;
  }
  let type = att.mimetype.split('/')[0];
  switch(type) {
    case 'image':
    case 'video':
    case 'audio':
      return `<media-com type="${type.replace('age','g')}" data-src="${getCurrentServerUrl()}/attachment/${sanitizeMinimChars(att.id)}" data-name="${sanitizeAttr(att.filename)}" data-size="${sanitizeMinimChars(att.size.toString())}"></media-com>`;
    default:
      return `<div class="file"><span>${sanitizeHTML(att.filename)} · ${formatBytes(att.size)} <button onclick="window.downloadfile('${sanitizeMinimChars(att.id)}', '${sanitizeAttr(att.filename).replaceAll("'", "\\'")}')" aria-label="Download" tlang="message.download"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M128 190V20" stroke-width="40" stroke-linecap="round" fill="none"/><path d="M127.861 212.999C131.746 213.035 135.642 211.571 138.606 208.607L209.317 137.896C212.291 134.922 213.753 131.011 213.708 127.114C213.708 127.076 213.71 127.038 213.71 127C213.71 118.716 206.994 112 198.71 112H57C48.7157 112 42 118.716 42 127C42 127.045 42.0006 127.089 42.001 127.134C41.961 131.024 43.4252 134.927 46.3936 137.896L117.104 208.607L117.381 208.876C120.312 211.662 124.092 213.037 127.861 212.999Z"/><rect y="226" width="256" height="30" rx="15"/></svg></button></span></div>`;
  }
}
function decodeMessage(msg, ch=window.currentChannel) {
  return new Promise((resolve, reject)=>{
    getKeyContents(ch, msg.key, async()=>{
      try {
        const privateKey = (await getRSAKeyPair()).privateKey;
        let nkey = await base64ToAESKey(await decryptRSAString(window.keys[ch][msg.key].key, privateKey));
        let dec = await decryptAESString(msg.content, nkey, msg.iv);
        resolve(dec);
      } catch(err) {
        reject(err);
      }
    });
  });
}
const messagesContainer = document.getElementById('messages');
async function displayMessage(msg, ch, limited=0) {
  let sendm = hasPerm(ch.permission,Permissions.SEND_MESSAGES);
  let mangm = hasPerm(ch.permission,Permissions.MANAGE_MESSAGES);
  // Decrypt
  if (msg.key&&msg.iv) {
    msg.content = await decodeMessage(msg);
    msg.iv = null;
  }
  // Signature
  if (msg.signature&&PKStore.has(msg.user.username)&&![ValidSignature,InvalidSignature].includes(msg.signature)) {
    let valid = await verifyRSAString(`${msg.content}:${window.currentChannel}:${msg.signed_timestamp}`, msg.signature, (await getRSAKeyFromPublic64(PKStore.get(msg.user.username))));
    msg.signature = valid?ValidSignature:InvalidSignature;
  }
  // Replies
  if (msg.replied_to) {
    let reply = window.messages[ch.id].find(mes=>mes.id===msg.replied_to);
    msg.reply = reply.iv?Object.fromEntries(Object.entries(reply).concat([['content','...']])):reply;
  }
  return `<div class="message${msg.ghost?' ghost-'+msg.ghost:''}${(new RegExp('@('+window.username+'|e)($|\\s|\\*|\\_|\\~|<|@)','im')).test(msg.content)||(msg.replied_to&&msg.reply?.user?.username===window.username)?' mention':''}${window.username===msg.user.username?' self':''}" id="m-${sanitizeMinimChars(msg.id)}">
  ${msg.user.hide?`<span class="time">${formatHour(msg.timestamp)}</span>`:`<div class="avatar"><img src="${msg.user.pfp?pfpById(msg.user.pfp):userToDefaultPfp(msg.user)}" width="42" height="42" aria-hidden="true"></div>`}
  <div class="inner">
    <div class="actions">
      ${limited===0?`
      ${sendm?`<button onclick="window.replyMessage('${sanitizeMinimChars(msg.id)}', '${sanitizeHTML(msg.user.display??sanitizeMinimChars(msg.user.username))}')" aria-label="Reply" tlang="message.reply"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M42 108H196V108C229.137 108 256 134.863 256 168V168V199.85C256 210.896 247.046 219.85 236 219.85V219.85C224.954 219.85 216 210.896 216 199.85V168V168C216 156.954 207.046 148 196 148V148H42V108Z"/><path d="M79.746 41.1778C83.0613 37.8625 87.5578 36 92.2464 36V36C107.996 36 115.883 55.0415 104.747 66.1782L47.2462 123.681C44.9032 126.024 44.9032 129.823 47.2462 132.166L104.747 189.67C115.883 200.806 107.996 219.848 92.2464 219.848V219.848C87.5579 219.848 83.0614 217.985 79.7461 214.67L5.72793 140.652C-1.30151 133.622 -1.30151 122.225 5.72793 115.196L79.746 41.1778Z"/></svg></button>`:''}
      ${msg.user.username===window.username?`<button onclick="window.editMessage('${sanitizeMinimChars(msg.id)}', '${sanitizeMinimChars(msg.key??'')}', this.parentElement.parentElement, '${sanitizeAttr(msg.content).replaceAll("'", "\\'")}')" aria-label="Edit" tlang="message.edit"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M36 198L87 239L213.98 78.9249L162.073 38.0226L36 198ZM170.11 27.8251L222.067 68.7297L239.674 46.5333C241.391 44.3698 241.028 41.2246 238.864 39.5086L194.819 4.5744C192.651 2.85464 189.498 3.22334 187.785 5.397L170.11 27.8251Z M35.1323 255.15C33.0948 255.784 31.0651 254.148 31.252 252.023L36 198L87.0001 239L35.1323 255.15Z"/></svg></button>`:''}
      ${ch.type===1||mangm?`<button onclick="window.pinMessage('${sanitizeMinimChars(msg.id)}', true)" aria-label="Pin" tlang="message.pin"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M117.4 6.28699C118.758 0.114336 126.401 -2.11969 130.87 2.34949L253.649 125.126C258.118 129.595 255.883 137.239 249.71 138.597L206.755 148.044C204.89 148.454 203.182 149.39 201.832 150.74L181.588 170.983C180.637 171.934 179.889 173.067 179.386 174.313L154.115 236.957C151.434 243.603 142.838 245.354 137.771 240.287L95.5138 198.03L10.2823 254.884C7.65962 256.633 4.16588 256.288 1.93663 254.058C-0.292345 251.829 -0.63778 248.336 1.11143 245.714L57.964 160.48L15.7091 118.225C10.642 113.158 12.3932 104.562 19.0392 101.881L81.6827 76.6112C82.9295 76.1083 84.0621 75.3587 85.0128 74.4081L105.257 54.1649C106.607 52.8149 107.542 51.1066 107.952 49.2421L117.4 6.28699Z"/></svg></button>`:''}
      ${msg.user.username===window.username||mangm?`<button onclick="window.deleteMessage('${sanitizeMinimChars(msg.id)}')" aria-label="Delete" tlang="message.delete" style="color:var(--invalid)"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M77.0892 18.9306C79.4013 18.9306 81.5077 17.6021 82.5038 15.5156L88.281 3.41493C89.2771 1.32846 91.3835 0 93.6956 0H162.304C164.617 0 166.723 1.32847 167.719 3.41494L173.496 15.5156C174.492 17.6021 176.599 18.9306 178.911 18.9306H222C226.418 18.9306 230 22.5123 230 26.9306V39C230 43.4183 226.418 47 222 47H34C29.5817 47 26 43.4183 26 39V26.9306C26 22.5123 29.5817 18.9306 34 18.9306H77.0892Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M42.4949 62.0605C39.7335 62.0605 37.4949 64.2991 37.4949 67.0605V241C37.4949 249.284 44.2106 256 52.4949 256H203.505C211.789 256 218.505 249.284 218.505 241V67.0605C218.505 64.2991 216.266 62.0605 213.505 62.0605H42.4949ZM78.8686 87.9194C71.728 87.9194 65.9393 93.708 65.9393 100.849V215.919C65.9393 223.06 71.728 228.849 78.8686 228.849C86.0093 228.849 91.7979 223.06 91.7979 215.919V100.849C91.7979 93.708 86.0093 87.9194 78.8686 87.9194ZM128 87.9194C120.859 87.9194 115.071 93.708 115.071 100.849V215.919C115.071 223.06 120.859 228.849 128 228.849C135.141 228.849 140.929 223.06 140.929 215.919V100.849C140.929 93.708 135.141 87.9194 128 87.9194ZM164.202 100.849C164.202 93.708 169.991 87.9194 177.131 87.9194C184.272 87.9194 190.061 93.708 190.061 100.849V215.919C190.061 223.06 184.272 228.849 177.131 228.849C169.991 228.849 164.202 223.06 164.202 215.919V100.849Z"/></svg></button>`:''}
      <button class="more" username="${sanitizeMinimChars(msg.user.username)}" data-id="${sanitizeMinimChars(msg.id)}" aria-label="More" tlang="message.more"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M128 158C111.431 158 98 144.569 98 128C98 111.431 111.431 98 128 98C144.569 98 158 111.431 158 128C158 144.569 144.569 158 128 158ZM128 60C111.432 60 98.0001 46.5685 98.0001 30C98.0001 13.4315 111.432 -5.87112e-07 128 -1.31135e-06C144.569 -2.03558e-06 158 13.4315 158 30C158 46.5685 144.569 60 128 60ZM98 226C98 242.569 111.431 256 128 256C144.569 256 158 242.569 158 226C158 209.431 144.569 196 128 196C111.431 196 98 209.431 98 226Z"/></svg></button>
      `:(limited===1&&(ch.type===1||mangm)?`
      <button onclick="window.pinMessage('${sanitizeMinimChars(msg.id)}', false);window.pinsPanel()" aria-label="Unpin" tlang="message.unpin" style="color:var(--invalid)"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M117.925 15.287C119.283 9.11438 126.925 6.88031 131.394 11.3495L244.087 124.041C248.556 128.51 246.321 136.153 240.148 137.511L201.418 146.029C199.553 146.439 197.845 147.375 196.495 148.724L177.921 167.299C176.97 168.249 176.222 169.382 175.719 170.629L152.677 227.748C149.996 234.394 141.4 236.146 136.332 231.078L97.7987 192.545L18.5585 245.401C16.1203 247.027 12.8731 246.706 10.8007 244.634C8.72831 242.561 8.40702 239.314 10.0331 236.876L62.8886 157.636L24.3564 119.103C19.2888 114.036 21.0402 105.44 27.6864 102.759L84.8066 79.7167C86.0533 79.2137 87.186 78.465 88.1366 77.5145L106.71 58.9403C108.06 57.5903 108.996 55.882 109.406 54.0174L117.925 15.287Z"/><path d="M20 20L236 236" stroke-width="40" stroke-linecap="round"/></svg></button>
      `:'')}
    </div>
    ${msg.replied_to?`<span class="reply" onclick="previewMessage('${sanitizeMinimChars(msg.reply?.id??'')}')"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256"><path d="M256 132C256 120.954 247.046 112 236 112H60V112C26.8629 112 0 138.863 0 172V172V236C0 247.046 8.95431 256 20 256V256C31.0457 256 40 247.046 40 236V172V172C40 160.954 48.9543 152 60 152V152H236C247.046 152 256 143.046 256 132V132Z"/></svg>${msg.reply?`${sanitizeHTML(msg.reply.user?.display??sanitizeMinimChars(msg.reply.user?.username))}: ${sanitizeHTML(msg.reply.content)||imageicon}`:'Cannot load message'}</span>`:''}
    ${msg.user.hide?'':`<span class="topper"><span class="author">${sanitizeHTML(msg.user.display??sanitizeMinimChars(msg.user.username))}</span>${!msg.user.nockeck&&msg.signature!==ValidSignature?'<span style="display:inline-flex" aria-label="Could not verify the author of this message" title="Could not verify the author of this message" tlang="message.unverified"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M148.419 20.5C139.566 5.16667 117.434 5.16667 108.581 20.5L6.8235 196.75C-2.02921 212.083 9.03666 231.25 26.7421 231.25H230.258C247.963 231.25 259.029 212.083 250.177 196.75L148.419 20.5ZM116 72C116 65.9249 120.925 61 127 61H130C136.075 61 141 65.9249 141 72V147C141 153.075 136.075 158 130 158H127C120.925 158 116 153.075 116 147V72ZM141 182.5C141 189.404 135.404 195 128.5 195C121.596 195 116 189.404 116 182.5C116 175.596 121.596 170 128.5 170C135.404 170 141 175.596 141 182.5Z"/></svg></span>':''}<span class="time">${formatTime(msg.timestamp)}</span></span>`}
    <span class="content${(/^(?::[a-zA-Z0-9_<!%&\?\*\+\.\- ]+?:){1,3}$/).test(msg.content)?' big-emoji':''}">${window.MDParse(msg.content, MDCustom)}${msg.edited_at?`<span class="edited" title="${formatTime(msg.edited_at)}" tlang="message.edited">(Edited)</span>`:''}</span>
    <div class="fileList">
      ${msg.attachments.map(att=>attachToElem(att)).join('')}
    </div>
  </div>
</div>`;
}
async function showMessages(messages) {
  let ch = window.channels.find(ch=>ch.id===window.currentChannel);
  // Pre
  for (let i=0; i<messages.length; i++) {
    // Populate user
    if (!messages[i].user) {
      if (window.currentChannelType!==3) {
        messages[i].user = DummyUser;
      } else {
        messages[i].user = {
          display: ch.name,
          username: 'e',
          pfp: ch.pfp,
          nocheck: true
        };
      }
    } else {
      messages[i].user = Object.merge(messages[i].user, UserStore.get(messages[i].user.username));
    }
    // Hide author?
    messages[i].user.hide = shouldHideUser(messages, i);
  }
  // Show
  let message = '';
  for (let i=0; i<messages.length; i++) {
    message += await displayMessage(messages[i], ch);
  }
  messagesContainer.innerHTML = message;
  Array.from(document.querySelectorAll('.message .more')).forEach(btn=>{
    tippy(btn, {
      allowHTML: true,
      content: (window.username!==btn.getAttribute('username')?`<button onclick="window.blockmember('${btn.getAttribute('username')}')" class="danger" tlang="member.block">Block</button>`:'')+
`<button onclick="navigator.clipboard.writeText('${btn.getAttribute('data-id')}')" tlang="settings.copyid">Copy id</button>`,
      interactive: true,
      trigger: 'click',
      placement: 'bottom-end',
      sticky: true
    });
  });
  showChannels(window.channels);
  // Load more listener
  let more = false;
  function setList() {
    messagesContainer.onscroll = ()=>{
      if (!more && (messagesContainer.scrollHeight-messagesContainer.clientHeight+messagesContainer.scrollTop)<101) {
        more = true;
        backendfetch(`/api/v1/channel/${window.currentChannel}/messages?before_message_id=${(window.messages[window.currentChannel]??[]).slice(-1)[0]?.id}`)
          .then(res=>{
            if (res.length<1) return;
            window.messages[window.currentChannel] = window.messages[window.currentChannel].concat(res);
            let missingKeys = Array.from(new Set(window.messages[window.currentChannel].map(msg=>msg.key).filter(key=>!window.keys[window.currentChannel][key])));
            getKeysBatch(window.currentChannel, missingKeys, ()=>{
              showMessages(window.messages[window.currentChannel]);
              setList();
              more = false;
            });
          });
      }
    };
  }
  setList();
  messagesContainer.onscroll();
  // Ack
  let idx = window.channels.findIndex(ch=>ch.id===window.currentChannel);
  if (messages.length>0&&window.channels[idx].unread_count>0) {
    window.channels[idx].unread_count = 0;
    showChannels(window.channels);
    backendfetch(`/api/v1/channel/${window.currentChannel}/messages/ack`, { method: 'POST' });
  }
}

// Yes function keys go up to 24 and yes there a bunch of weird keys that exist
const NonFocusKeys = 'Alt,AltGraph,AudioVolumeDown,AudioVolumeMute,AudioVolumeUp,BrowserBack,BrowserFavorites,BrowserForward,BrowserHome,BrowserRefresh,BrowserSearch,BrowserStop,CapsLock,Clear,ContextMenu,Control,End,Escape,F1,F10,F11,F12,F13,F14,F15,F16,F17,F18,F19,F2,F20,F21,F22,F23,F24,F3,F4,F5,F6,F7,F8,F9,Help,Home,Insert,LaunchApplication1,LaunchApplication2,LaunchCalculator,LaunchMail,LaunchMediaPlayer,MediaPlayPause,MediaTrackNext,MediaTrackPrevious,Meta,NumLock,OS,PageDown,PageUp,PrintScreen,ScrollLock,Shift,Tab,Unidentified'.split(',');
window.onkeydown = (evt)=>{
  if (['body'].includes(document.activeElement.tagName.toLowerCase())) {
    if (NonFocusKeys.includes(evt.key)) return;
    if (evt.ctrlKey) return;
    messageInput.focus();
  }
};

// Channels
window.channels = [];
function displayChannel(ch) {
  let lstmsgcnt;
  if (ch.last_message) {
    lstmsgcnt = ch.last_message.content;
    if (ch.last_message.key) {
      if (window.keys[ch.id]&&window.keys[ch.id][ch.last_message.key]) {
        let msg = messages[ch.id].find(msg=>msg.id===ch.last_message.id);
        if (msg) lstmsgcnt = msg.content;
      } else {
        lstmsgcnt = '...';
      }
    }
  }
  let isPinned = PinnedChannelsStore.has(ch.id);
  return `<span>
  ${isPinned?'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 256 256" class="pin-indicator"><path d="M117.4 6.28699C118.758 0.114336 126.401 -2.11969 130.87 2.34949L253.649 125.126C258.118 129.595 255.883 137.239 249.71 138.597L206.755 148.044C204.89 148.454 203.182 149.39 201.832 150.74L181.588 170.983C180.637 171.934 179.889 173.067 179.386 174.313L154.115 236.957C151.434 243.603 142.838 245.354 137.771 240.287L95.5138 198.03L10.2823 254.884C7.65962 256.633 4.16588 256.288 1.93663 254.058C-0.292345 251.829 -0.63778 248.336 1.11143 245.714L57.964 160.48L15.7091 118.225C10.642 113.158 12.3932 104.562 19.0392 101.881L81.6827 76.6112C82.9295 76.1083 84.0621 75.3587 85.0128 74.4081L105.257 54.1649C106.607 52.8149 107.542 51.1066 107.952 49.2421L117.4 6.28699Z"/></svg>':''}
  <button onclick="window.loadChannel('${ch.id}')">
    <img src="${ch.pfp?pfpById(ch.pfp):userToDefaultPfp(ch)}" width="30" height="30" aria-hidden="true" loading="lazy">
    <span class="div">
      <span class="name"${ch.name.length>7||(ch.type===1&&ch.username)?` title="${sanitizeHTML(ch.username??ch.name)}"`:''}>${sanitizeHTML(ch.name)}</span>
      ${ch.last_message?`<span class="msg">${ch.last_message.author.length?ch.last_message.author+': ':''}${lstmsgcnt.replaceAll(/:([a-zA-Z0-9_<!%&\?\*\+\.\- ]+?):/g,(match,g1)=>window.emojiShort[g1.toLowerCase()]??match)}</span>`:''}
    </span>
    ${(ch.unread_count??0)>0?`<span class="unread">${ch.unread_count}</span>`:''}
  </button>
  ${ch.type!==1&&hasPerm(ch.permission,Permissions.MANAGE_CHANNEL)?`<button class="other" onclick="window.changeChannel('${sanitizeMinimChars(ch.id)}')" aria-label="Edit" tlang="channel.edit"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M128.601 218.743C178.384 218.743 218.742 178.385 218.742 128.602C218.742 78.8184 178.384 38.4609 128.601 38.4609C78.8175 38.4609 38.4601 78.8184 38.4601 128.602C38.4601 178.385 78.8175 218.743 128.601 218.743ZM128.601 167.062C149.842 167.062 167.061 149.843 167.061 128.602C167.061 107.361 149.842 90.1415 128.601 90.1415C107.36 90.1415 90.1408 107.361 90.1408 128.602C90.1408 149.843 107.36 167.062 128.601 167.062Z"></path><path d="M101.001 11.0292C101.507 4.79869 106.711 0 112.962 0H143.038C149.289 0 154.493 4.79868 154.999 11.0292L158 48H98L101.001 11.0292Z"></path><path d="M101.001 244.971C101.507 251.201 106.711 256 112.962 256H143.038C149.289 256 154.493 251.201 154.999 244.971L158 208H98L101.001 244.971Z"></path><path d="M244.971 101.001C251.201 101.507 256 106.711 256 112.962L256 143.038C256 149.289 251.201 154.493 244.971 154.999L208 158L208 98L244.971 101.001Z"></path><path d="M11.0292 101.001C4.79869 101.507 -3.80751e-07 106.711 -6.5399e-07 112.962L-1.96869e-06 143.038C-2.24193e-06 149.289 4.79868 154.493 11.0292 154.999L48 158L48 98L11.0292 101.001Z"></path><path d="M192.883 25.8346C197.645 21.7687 204.733 22.0477 209.16 26.4753L229.71 47.025C234.137 51.4526 234.416 58.5404 230.351 63.3023L205.964 91.8642L164.321 50.2213L192.883 25.8346Z"></path><path d="M26.135 192.008C22.0807 196.77 22.3646 203.849 26.7873 208.271L47.7285 229.212C52.1512 233.635 59.2294 233.919 63.9921 229.865L92.2857 205.78L50.2198 163.714L26.135 192.008Z"></path><path d="M229.879 191.979C233.94 196.742 233.658 203.825 229.233 208.25L208.673 228.811C204.247 233.236 197.164 233.517 192.402 229.457L164.137 205.358L205.78 163.715L229.879 191.979Z"></path><path d="M63.9921 26.1356C59.2293 22.0813 52.1512 22.3652 47.7284 26.7879L26.7874 47.7289C22.3647 52.1517 22.0808 59.2298 26.1351 63.9926L50.22 92.2862L92.2857 50.2205L63.9921 26.1356Z"></path></svg></button>`:''}
  <button class="other" onclick="window.togglePinChannel('${sanitizeMinimChars(ch.id)}')" tlang="channel.${isPinned?'un':''}pin"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M117.4 6.28699C118.758 0.114336 126.401 -2.11969 130.87 2.34949L253.649 125.126C258.118 129.595 255.883 137.239 249.71 138.597L206.755 148.044C204.89 148.454 203.182 149.39 201.832 150.74L181.588 170.983C180.637 171.934 179.889 173.067 179.386 174.313L154.115 236.957C151.434 243.603 142.838 245.354 137.771 240.287L95.5138 198.03L10.2823 254.884C7.65962 256.633 4.16588 256.288 1.93663 254.058C-0.292345 251.829 -0.63778 248.336 1.11143 245.714L57.964 160.48L15.7091 118.225C10.642 113.158 12.3932 104.562 19.0392 101.881L81.6827 76.6112C82.9295 76.1083 84.0621 75.3587 85.0128 74.4081L105.257 54.1649C106.607 52.8149 107.542 51.1066 107.952 49.2421L117.4 6.28699Z"/>${isPinned?'<path d="M20 20L236 236" stroke-width="40" stroke-linecap="round"/>':''}</svg></button>
  ${window.serverData[getCurrentServerUrl()]?.disable_channel_deletion?'':`<button class="other" onclick="window.leaveChannel('${sanitizeMinimChars(ch.id)}')" aria-label="Leave" tlang="channel.leave"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256"><path d="M219.856 5.85765C227.666 -1.95251 240.33 -1.95258 248.14 5.85765L250.141 7.85961C257.951 15.6701 257.951 28.3334 250.141 36.1438L158.285 127.999L250.141 219.857C257.952 227.667 257.952 240.33 250.141 248.141L248.14 250.142C240.33 257.952 227.666 257.952 219.856 250.142L127.999 158.285L36.143 250.142C28.3326 257.952 15.6693 257.952 7.85884 250.142L5.85786 248.141C-1.95262 240.33 -1.95262 227.667 5.85786 219.857L97.7133 127.999L5.85786 36.1438C-1.95262 28.3333 -1.95261 15.6701 5.85786 7.85961L7.85884 5.85765C15.6693 -1.95245 28.3327 -1.95266 36.143 5.85765L127.999 97.7141L219.856 5.85765Z"/></svg></button>`}
</span>`;
}
function showChannels(channels) {
  if (channels.length<1) {
    document.getElementById('channels').innerHTML = '<p tlang="channel.listempty"></p>';
    window.translate();
    return;
  }
  document.getElementById('channels').innerHTML = channels
    .toSorted((a,b)=>PinnedChannelsStore.has(b.id)-PinnedChannelsStore.has(a.id))
    .map(displayChannel)
    .join('');
}
async function getChannels() {
  let res = await backendfetch('/api/v1/channels');
  if (!Array.isArray(res)) return;
  res = res.map(ch=>{
    let perm = Number(ch.permissions)&OwnerAlt;
    if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
    if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
    let chperm = Number(ch.channel_permissions)&OwnerAlt;
    if (hasPerm(chperm,Permissions.OWNER)) chperm = OwnerAlt;
    if (hasPerm(chperm,Permissions.ADMIN)&&!hasPerm(chperm,Permissions.OWNER)) chperm = AdminAlt;
    return {
      id: sanitizeMinimChars(ch.id),
      type: Number(ch.type),
      name: ch.name??'',
      username: sanitizeMinimChars(ch.username??'')||null,
      pfp: ch.pfp?sanitizeMinimChars(ch.pfp):null,
      permission: perm,
      base_permissions: chperm,
      unread_count: Number(ch.unread_count)??0,
      member_count: Number(ch.member_count)??1,
      last_message: ch.last_message?{
        id: sanitizeMinimChars(ch.last_message?.id||''),
        content: sanitizeHTML(ch.last_message?.content||'')||imageicon,
        author: sanitizeHTML(ch.last_message?.user?.display??sanitizeMinimChars(ch.last_message?.user?.username||'')),
        key: ch.last_message.key?sanitizeMinimChars(ch.last_message.key):null,
        iv: ch.last_message.iv?sanitizeMinimChars(ch.last_message.iv):null
      }:null
    };
  });
  window.channels = res;
  if (!window.currentChannel && res[0]) {
    let lastCh = localStorage.getItem(window.currentServer+'-lc');
    if (lastCh&&res.find(ch=>ch.id===lastCh)) {
      loadChannel(lastCh);
    } else {
      loadChannel(res[0].id);
    }
  }
  showChannels(res);
}
function showMembers(id) {
  if (!MemberStore.has(id)) MemberStore.set(id, []);
  let ch = window.channels.find(ch=>ch.id===id);
  document.querySelector('.lateral').innerHTML = `<button class="mobile" onclick="document.querySelector('main').style.display='';document.querySelector('side').style.display='none';document.querySelector('.lateral').style.display='none';" aria-label="Close member list"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="12" y="21" width="88" height="216"></rect><rect width="232" height="232" rx="20" stroke-width="24" fill="none" x="12" y="12"></rect></svg></button>`+
  MemberStore.get(id)
    .map(usr=>Object.merge(usr, UserStore.get(usr.username)))
    .toSorted((a,b)=>{
      if ((a.display??a.username)!==(b.display??b.username)) return (a.display??a.username).localeCompare(b.display??b.username);
      return b.joined_at - a.joined_at;
    })
    .map(mem=>`<button username="${sanitizeMinimChars(mem.username)}"><img src="${mem.pfp?pfpById(mem.pfp):userToDefaultPfp(mem)}" width="30" height="30" aria-hidden="true" loading="lazy"><span title="${sanitizeMinimChars(mem.username)}">${sanitizeHTML(mem.display??mem.username)}</span></button>`)
    .join('');
  document.querySelectorAll('.lateral button:not(.mobile)').forEach(btn=>{
    tippy(btn, {
      allowHTML: true,
      content: (window.username===btn.getAttribute('username'))?
(hasPerm(ch.permission,Permissions.MANAGE_PERMISSION)?`<button onclick="window.permmember('${btn.getAttribute('username')}')" tlang="member.changeperms">Change permissions</button>`:''):
(window.serverData[getCurrentServerUrl()]?.disable_channel_creation?'':`<button onclick="window.createChannel(1, '${btn.getAttribute('username')}')" tlang="member.message">Message</button>`)+
`<button onclick="window.blockmember('${btn.getAttribute('username')}')" class="danger" tlang="member.block">Block</button>`+
(hasPerm(ch.permission,Permissions.MANAGE_PERMISSION)||hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)?`<hr style="width:90%">`:'')+
(hasPerm(ch.permission,Permissions.MANAGE_PERMISSION)?`<button onclick="window.permmember('${btn.getAttribute('username')}')" tlang="member.changeperms">Change permissions</button>`:'')+
(hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)?`<button onclick="window.kickmember('${btn.getAttribute('username')}')" tlang="member.kick">Kick</button>
<button onclick="window.banmember('${btn.getAttribute('username')}')" tlang="member.ban">Ban</button>`:''),
      interactive: true,
      trigger: 'click',
      placement: smallScreen()?'bottom-start':'left-start',
      sticky: true
    });
  });
}
window.blockmember = (id)=>{
  backendfetch('/api/v1/me/block/'+id, {
    method: 'POST'
  });
};
window.unblockmember = (id)=>{
  backendfetch('/api/v1/me/block/'+id, {
    method: 'DELETE'
  })
    .then(()=>{window.viewblocks()});
};
window.permmember = (id)=>{
  let perm = Number(MemberStore.get(window.currentChannel).find(mem=>mem.username===id).permissions)??0;
  if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
  if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
  let ch = window.channels.find(ch=>ch.id===window.currentChannel);
  let modal = document.getElementById('permModal');
  modal.showModal();
  modal.querySelector('div').innerHTML = Object.entries(Permissions)
    .map(k=>`<label for="pu-${k[0]}" tlang="permission.${k[0].toLowerCase()}">${k[0].toLowerCase()}</label><input id="pu-${k[0]}" data-weight="${k[1]}" type="checkbox"${hasPerm(ch.permission,k[1])?'':' disabled'}${hasPerm(perm,k[1])?' checked':''}><br>`)
    .join('');
  modal.querySelector('button.set').onclick = ()=>{
    backendfetch( '/api/v1/channel/'+window.currentChannel+'/member/'+id, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        permissions: Array.from(modal.querySelectorAll('input')).map(i=>i.checked?Number(i.getAttribute('data-weight')):0).reduce((a, b)=>a+b,0)
      })
    })
      .then(()=>{modal.close()});
  };
  modal.querySelector('button.sync').style.display = '';
  modal.querySelector('button.sync').onclick = ()=>{
    backendfetch( '/api/v1/channel/'+window.currentChannel+'/member/'+id, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ permissions: null })
    })
      .then(()=>{modal.close()});
  };
};
window.kickmember = (id)=>{
  backendfetch(`/api/v1/channel/${window.currentChannel}/member/${id}`, {
    method: 'DELETE'
  })
    .then(()=>{
      MemberStore.set(window.currentChannel, MemberStore.get(window.currentChannel).filter(usr=>usr.username!==id));
    });
};
window.banmember = async(id)=>{
  let formData = new FormData();
  formData.append('reason', await ask('member.ban.reason', 0, 100)??'');
  backendfetch(`/api/v1/channel/${window.currentChannel}/bans/${id}`, {
    method: 'POST',
    body: formData
  })
    .then(()=>{
      MemberStore.set(window.currentChannel, MemberStore.get(window.currentChannel).filter(usr=>usr.username!==id));
    });
};
window.unbanmember = async(id)=>{
  backendfetch(`/api/v1/channel/${window.currentChannel}/bans/${id}`, {
    method: 'DELETE'
  })
    .then(()=>{window.bansPanel()});
};
function getMembers(id, page=1) {
  if (!MemberStore.has(id)) MemberStore.set(id, []);
  if (MemberStore.get(id).length>0&&page===1) {
    showMembers(id);
    return;
  }
  let ch = window.channels.find(ch=>ch.id===id);
  backendfetch(`/api/v1/channel/${id}/members?page=${page}`)
    .then(res=>{
      if (!Array.isArray(res)) return;
      MemberStore.set(id, MemberStore.get(id).concat(res));
      res.forEach(mem=>{UserStore.set(mem.username, Object.merge(UserStore.get(mem.username), mem))});
      if (ch.member_count>MemberStore.get(id).length&&res.length>0) getMembers(id, page+1);
      showMembers(id);
    });
}
const TypeIcons = [
  '',
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256" class="type"><path fill-rule="evenodd" clip-rule="evenodd" d="M128 128C163.346 128 192 99.3462 192 64C192 28.6538 163.346 0 128 0C92.6538 0 64 28.6538 64 64C64 99.3462 92.6538 128 128 128ZM151 146H148H108H105C49.7715 146 5 190.772 5 246V256H108H148H251V246C251 190.772 206.228 146 151 146Z"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256" class="type"><circle cx="60" cy="102" r="34" filter="brightness(0.75)"/><path d="M0 196C0 177.222 15.2223 162 34 162V162H102V162C120.778 162 136 177.222 136 196V196.467V256H0V196.467V196Z" filter="brightness(0.75)"/><circle cx="169" cy="50" r="50"/><path d="M81 180C81 155.838 100.588 136 124.75 136H212.25C236.412 136 256 155.838 256 180V256H81V180Z"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256" class="type"><rect x="7" y="76" width="25" height="104" rx="12.5"/><path d="M160 207C160 232.405 139.853 253 115 253C90.1472 253 70 232.405 70 207C70 181.595 90.1472 161 115 161C139.853 161 160 181.595 160 207ZM88 207C88 222.243 100.088 234.6 115 234.6C129.912 234.6 142 222.243 142 207C142 191.757 129.912 179.4 115 179.4C100.088 179.4 88 191.757 88 207Z"/><path d="M219 12C219 5.37258 224.373 0 231 0H239C245.627 0 251 5.37258 251 12V244C251 250.627 245.627 256 239 256H231C224.373 256 219 250.627 219 244V12Z"/><path d="M41 90.9502C41 82.374 46.4679 74.7524 54.592 72.0045L232 12V244L54.592 183.995C46.4679 181.248 41 173.626 41 165.05V90.9502Z"/></svg>'
];
function loadChannel(id) {
  let ch = window.channels.find(ch=>ch.id===id);
  window.currentChannel = id;
  window.currentChannelType = ch.type;
  localStorage.setItem(window.currentServer+'-lc', id);
  // Lateral
  document.querySelector('.lateraltoggle').style.display = 'none';
  if (smallScreen()) {
    document.querySelector('side').style.display = 'none';
    document.querySelector('main').style.display = '';
  }
  // Labels & Buttons
  document.querySelector('.top .name').innerText = ch.name+(ch.type===1&&ch.username?` (${ch.username})`:'');
  document.querySelector('.top .type').outerHTML = TypeIcons[ch.type];
  document.getElementById('callsButton').style.display = (ch.type===1&&(window.serverData[getCurrentServerUrl()]?.calls?.enabled||false))?'':'none';
  document.getElementById('bansButton').style.display = 'none';
  document.getElementById('inviteButton').style.display = 'none';
  document.getElementById('notifButton').style.display = localStorage.getItem('pnotif')==='true'?'':'none';
  document.querySelector('.lateral').style.display = 'none';
  if (ch.type===2||(ch.type===3&&(hasPerm(ch.permission,Permissions.MANAGE_CHANNEL)||hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)))) {
    if (smallScreen()) {
      document.querySelector('.lateraltoggle').style.display = '';
    } else {
      document.querySelector('.lateral').style.display = '';
    }
    showMembers(id);
    getMembers(id);
    if (hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)) document.getElementById('bansButton').style.display = '';
    if (hasPerm(ch.permission,Permissions.MANAGE_CHANNEL)) document.getElementById('inviteButton').style.display = '';
  }
  // Get public keys
  if (!PKChannels.includes(id)) {
    PKChannels.push(id);
    backendfetch(`/api/v1/channel/${id}/members?pb=true`)
      .then(members=>{
        for (let i=0; i<members.length; i++) {
          if (!PKStore.has(members[i].username)) {
            PKStore.set(members[i].username, members[i].public);
            saveToDB();
          }
        }
      });
  }
  // Messages
  let canSendMsgs = hasPerm(ch.permission,Permissions.SEND_MESSAGES);
  document.querySelector('.bar').style.display = canSendMsgs?'':'none';
  document.querySelector('.bar.fake').style.display = canSendMsgs?'none':'';
  if (window.messages[id]) {
    showMessages(window.messages[id]);
  } else {
    showMessages([]);
    backendfetch(`/api/v1/channel/${id}/messages`)
      .then(res=>{
        if (!Array.isArray(res)) return;
        window.messages[id] = res;
        res.forEach(msg=>{
          if (!msg.user) return;
          UserStore.set(msg.user.username, Object.merge(UserStore.get(msg.user.username), msg.user))
        });
        if (!window.keys[id]) window.keys[id]={};
        let missingKeys = Array.from(new Set(window.messages[id].map(msg=>msg.key).filter(key=>!window.keys[id][key])));
        getKeysBatch(id, missingKeys, ()=>{
          showMessages(res);
        });
      });
  }
}
window.loadChannel = loadChannel;
function permchannel(id) {
  let ch = window.channels.find(ch=>ch.id===id);
  let perm = Number(ch.base_permissions)??0;
  if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
  if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
  let modal = document.getElementById('permModal');
  modal.showModal();
  modal.querySelector('div').innerHTML = Object.entries(Permissions)
    .map(k=>`<label for="pu-${k[0]}" tlang="permission.${k[0].toLowerCase()}">${k[0].toLowerCase()}</label><input id="pu-${k[0]}" data-weight="${k[1]}" type="checkbox"${hasPerm(ch.permission,k[1])?'':' disabled'}${hasPerm(perm,k[1])?' checked':''}><br>`)
    .join('');
  modal.querySelector('button.set').onclick = ()=>{
    let formData = new FormData();
    formData.append('permissions', Array.from(modal.querySelectorAll('input')).map(i=>i.checked?Number(i.getAttribute('data-weight')):0).reduce((a, b)=>a+b,0));
    backendfetch( '/api/v1/channel/'+id, {
      method: 'PATCH',
      body: formData
    })
      .then(()=>{modal.close()});
  };
  modal.querySelector('button.sync').style.display = 'none';
}
function changeChannel(id) {
  const modal = document.getElementById('edit-channel');
  modal.showModal();
  let channel = window.channels.find(ch=>ch.id===id);
  modal.querySelector('.name').innerText = channel.name;
  modal.querySelector('.name').setAttribute('title', channel.name);
  document.getElementById('ce-name').value = channel.name;
  modal.querySelector('.img').src = channel.pfp?pfpById(channel.pfp):userToDefaultPfp(channel);

  document.getElementById('cec-name').onclick = function(){
    let formData = new FormData();
    formData.append('name', document.getElementById('ce-name').value);
    backendfetch('/api/v1/channel/'+id, {
      method: 'PATCH',
      body: formData
    })
      .then(res=>{
        modal.querySelector('.name').innerText = res.updated_channel.name;
        modal.querySelector('.img').src = res.updated_channel.pfp?pfpById(res.updated_channel.pfp):userToDefaultPfp(res.updated_channel);
      });
  };
  document.getElementById('ce-imginp').onchange = async(evt)=>{
    if (!evt.target.files[0]) return;
    if (!evt.target.files[0].type.startsWith('image/')) return;
    let img = await processImageToPfp(evt.target.files[0]);
    let formData = new FormData();
    formData.append('pfp', img, 'pfp.webp');
    backendfetch('/api/v1/channel/'+id, {
      method: 'PATCH',
      body: formData
    })
      .then(res=>{
        modal.querySelector('.name').innerText = res.updated_channel.name;
        modal.querySelector('.img').src = res.updated_channel.pfp?pfpById(res.updated_channel.pfp):userToDefaultPfp(res.updated_channel);
      });
  }
  document.getElementById('cec-img').onclick = function(){
    document.getElementById('ce-imginp').click();
  };
  document.getElementById('cec-copyid').onclick = function(){
    navigator.clipboard.writeText(id);
  }
  document.getElementById('cec-editperms').onclick = function(){
    permchannel(id);
  }
  document.getElementById('cec-delete').onclick = function(){
    window.leaveChannel(id, true);
    modal.close();
  }
}
window.changeChannel = changeChannel;
function leaveChannel(id, del=false) {
  backendfetch('/api/v1/channel/'+id+(del?'?delete=true':''), {
    method: 'DELETE'
  });
}
window.leaveChannel = leaveChannel;
function togglePinChannel(id) {
  PinnedChannelsStore[PinnedChannelsStore.has(id)?'delete':'set'](id, true);
  saveToDB();
  showChannels(window.channels);
}
window.togglePinChannel = togglePinChannel;
async function createChannel(type, data) {
  if (!data) {
    try {
      data = await ask('channel.new.'+(type===1?'user':'name'), (type===1?3:1), (type===1?20:50));
      if (type===1) data = data.toLowerCase();
    } catch(err) {
      return;
    }
  }
  let formData = new FormData();
  formData.append('type', type);
  formData.append(type===1?'target_user':'name', data);

  let req = await backendfetch('/api/v1/channels', {
    method: 'POST',
    body: formData
  });
  return req.channel_id;
}
window.createChannel = createChannel;
async function joinChannel() {
  let code;
  try {
    code = await ask('channel.new.code', 1, 20);
  } catch(err) {
    return;
  }
  let req = await backendfetch('/api/v1/channels/invite/'+code.trim(), {
    method: 'POST',
    passstatus: true
  });
  if (req.status===403) {
    document.getElementById('bannedfrom').showModal();
    return null;
  }
  return req.channel_id;
}
window.joinChannel = joinChannel;
let last = '';
document.getElementById('search').onkeyup = function(evt) {
  let query = evt.target.value.toLowerCase();
  if (last===query) return;
  last = query;
  showChannels(window.channels.filter(ch=>ch.name.toLowerCase().includes(query)));
}
window.startCall = ()=>{
  backendfetch(`/api/v1/channel/${window.currentChannel}/call`)
    .then(res=>{
      calls.startCall(window.currentChannel, (res.participants?true:false));
    });
};
window.endCall = ()=>{
  calls.leaveCall();
}
window.bansPanel = ()=>{
  document.getElementById('bansModal').showModal();
  backendfetch(`/api/v1/channel/${window.currentChannel}/bans`)
    .then(res=>{
      document.querySelector('#bansModal div').innerHTML = res
        .map(ban=>`<div class="ban">
  <img src="${ban.pfp?pfpById(ban.pfp):userToDefaultPfp(ban)}" width="30" height="30" aria-hidden="true" loading="lazy">
  <span>
    <b>${sanitizeHTML(ban.display??sanitizeMinimChars(ban.username))}</b>
    <span class="by">by: ${sanitizeHTML(ban.banned_by_display??sanitizeMinimChars(ban.banned_by_username))}</span>
    <span>${sanitizeHTML(ban.reason??'')}</span>
  </span>
  <button onclick="window.unbanmember('${sanitizeMinimChars(ban.username)}')">x</button>
</div>`)
        .join('');
    });
};
window.invitePanel = ()=>{
  document.getElementById('inviteModal').showModal();
  backendfetch(`/api/v1/channel/${window.currentChannel}/invite`)
    .then(res=>{
      document.querySelector('#inviteModal .cur').innerText = sanitizeMinimChars(res.invite_code??'None');
    });
  document.querySelector('#inviteModal .rand').onclick = ()=>{
    backendfetch(`/api/v1/channel/${window.currentChannel}/invite`, {
      method: 'POST'
    })
      .then(()=>window.invitePanel());
  };
  document.querySelector('#inviteModal .rem').onclick = ()=>{
    backendfetch(`/api/v1/channel/${window.currentChannel}/invite`, {
      method: 'DELETE'
    })
      .then(()=>window.invitePanel());
  };
  document.querySelector('#inviteModal .set').onclick = ()=>{
    let formData = new FormData();
    formData.append('invite_code', document.getElementById('invitenew').value);

    backendfetch(`/api/v1/channel/${window.currentChannel}/invite`, {
      method: 'POST',
      body: formData
    })
      .then(()=>window.invitePanel());
  };
};
window.notifPanel = ()=>{
  let modal = document.getElementById('notifModal');
  modal.show();
  let button = document.getElementById('notifButton');
  let bb = button.getBoundingClientRect();
  modal.style.top = bb.bottom+10+'px';
  modal.style.setProperty('--left', bb.right+'px');
  let select = document.getElementById('ce-notifs');
  select.value = getNotifStateChannel(window.currentChannel, window.currentChannelType);
  select.onchange = ()=>{
    ChannelNotifStore.set(window.currentChannel, select.value);
    saveToDB();
  };
};
window.pinsPanel = ()=>{
  let modal = document.getElementById('pinsModal');
  modal.show();
  let button = document.getElementById('pinsButton');
  let bb = button.getBoundingClientRect();
  modal.style.top = bb.bottom+10+'px';
  modal.style.setProperty('--left', bb.right+'px');
  backendfetch(`/api/v1/channel/${window.currentChannel}/pins`)
    .then(async(messages)=>{
      if (messages.length<1) {
        document.querySelector('#pinsModal div').innerText = '';
        document.querySelector('#pinsModal div').setAttribute('tlang','message.nopins');
        return;
      }
      document.querySelector('#pinsModal div').removeAttribute('tlang');
      let ch = window.channels.find(ch=>ch.id===window.currentChannel);
      // Show
      let message = '';
      for (let i=0; i<messages.length; i++) {
        message += await displayMessage(messages[i], ch, 1);
      }
      document.querySelector('#pinsModal div').innerHTML = message;
    });
};

// Stream
window.stream = null;
function startStream() {
  if (window.stream) return;
  window.stream = new EventSource(`${getCurrentServerUrl()}/api/v1/stream?authorization=Bearer ${localStorage.getItem(window.currentServer+'-sessionToken')}`);
  window.stream.addEventListener('error', (event)=>{
    if (!event.data) return;
    let data = JSON.parse(event.data);
    console.log('Stream error:', data.error);
    window.stream.close();
    window.stream = null;
    startStream();
  });
  // Channels
  window.stream.addEventListener('channel_added', (event)=>{
    let data = JSON.parse(event.data);
    window.channels.unshift({});
    if (data.channel.created) data.channel.permissions = OwnerAlt;
    let perm = Number(data.channel.permissions)&OwnerAlt;
    if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
    if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
    let chperm = Number(data.channel.channel_permissions)&OwnerAlt;
    if (hasPerm(chperm,Permissions.OWNER)) chperm = OwnerAlt;
    if (hasPerm(chperm,Permissions.ADMIN)&&!hasPerm(chperm,Permissions.OWNER)) chperm = AdminAlt;
    window.channels[0].id = sanitizeMinimChars(data.channel.id);
    window.channels[0].type = Number(data.channel.type)??1;
    window.channels[0].name = data.channel.name??'';
    window.channels[0].pfp = data.channel.pfp?sanitizeMinimChars(data.channel.pfp):null;
    window.channels[0].permission = perm;
    window.channels[0].base_permissions = chperm;
    window.channels[0].last_message = null;
    window.channels[0].member_count = Number(data.channel.member_count)??1;
    window.channels[0].unread_count = 0;
    showChannels(window.channels);
    if (window.currentChannel==='') window.loadChannel(sanitizeMinimChars(data.channel.id));
  });
  window.stream.addEventListener('channel_edited', (event)=>{
    let data = JSON.parse(event.data);
    let idx = window.channels.findIndex(ch=>ch.id===data.channel_id);
    let chperm = Number(data.channel.channel_permissions)&OwnerAlt;
    if (hasPerm(chperm,Permissions.OWNER)) chperm = OwnerAlt;
    if (hasPerm(chperm,Permissions.ADMIN)&&!hasPerm(chperm,Permissions.OWNER)) chperm = AdminAlt;
    window.channels[idx].name = data.channel.name??'';
    window.channels[idx].pfp = data.channel.pfp?sanitizeMinimChars(data.channel.pfp):null;
    window.channels[idx].base_permissions = chperm;
    showChannels(window.channels);
  });
  window.stream.addEventListener('channel_deleted', (event)=>{
    let data = JSON.parse(event.data);
    window.channels = window.channels.filter(ch=>ch.id!==data.channel_id);
    MemberStore.delete(data.channel_id);
    showChannels(window.channels);
  });
  // Members
  window.stream.addEventListener('member_join', (event)=>{
    let data = JSON.parse(event.data);
    if (window.keys[data.channel_id]) {
      let last = Object.keys(window.keys[data.channel_id]).reduce((a, b) => window.keys[data.channel_id][a]?.expires_at > window.keys[data.channel_id][b]?.expires_at ? a : b, '');
      if (last) window.keys[data.channel_id][last].expires_at = Date.now();
    }
    if (!MemberStore.has(data.channel_id)) return;
    let prev = MemberStore.get(data.channel_id);
    prev.push(data.user);
    let perm = Number(data.permissions)&OwnerAlt;
    if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
    if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
    prev[prev.length-1].permissions = perm;
    MemberStore.set(data.channel_id, prev);
    if (window.currentChannel===data.channel_id) showMembers(data.channel_id);
  });
  window.stream.addEventListener('member_perms_changed', (event)=>{
    let data = JSON.parse(event.data);
    if (data.username===window.username) {
      let idx2 = window.channels.findIndex(ch=>ch.id===data.channel_id);
      let perm = Number(data.permissions)&OwnerAlt;
      if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
      if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
      window.channels[idx2].permission = perm;
      if (window.currentChannel===data.channel_id) loadChannel(data.channel_id);
    }
    let prev = MemberStore.get(data.channel_id);
    if (!prev||prev.length<1) return;
    let idx = prev.findIndex(mem=>mem.username===data.username);
    prev[idx].permissions = data.permissions;
    MemberStore.set(data.channel_id, prev);
  });
  window.stream.addEventListener('member_leave', (event)=>{
    let data = JSON.parse(event.data);
    if (data.user.username===window.username) {
      window.channels = window.channels.filter(ch=>ch.id!==data.channel_id);
      MemberStore.delete(data.channel_id);
      showChannels(window.channels);
      return;
    }
    if (window.keys[window.currentChannel]) {
      let last = Object.keys(window.keys[data.channel_id]).reduce((a, b) => window.keys[data.channel_id][a]?.expires_at > window.keys[data.channel_id][b]?.expires_at ? a : b, '');
      if (last) window.keys[data.channel_id][last].expires_at = Date.now();
    }
    if (!MemberStore.has(data.channel_id)) return;
    MemberStore.set(data.channel_id, MemberStore.get(data.channel_id).filter(usr=>usr.username!==data.user.username));
    if (window.currentChannel===data.channel_id) showMembers(data.channel_id);
  });
  // Messages
  window.stream.addEventListener('message_sent', async(event)=>{
    let data = JSON.parse(event.data);
    // Move channel
    let idx = window.channels.findIndex(ch=>ch.id===data.channel_id);
    window.channels.unshift(window.channels.splice(idx,1)[0]);
    // Handle message
    if (!window.messages[data.channel_id]) window.messages[data.channel_id] = [];
    window.messages[data.channel_id].unshift(data.message);
    if (data.message.key&&data.message.iv) {
      window.messages[data.channel_id][0].content = await decodeMessage(data.message, data.channel_id);
      window.messages[data.channel_id][0].iv = null;
    }
    // Unread, ghost and other
    if (data.message.user.username===window.username) {
      window.channels[0].unread_count = 0;
      window.messages[data.channel_id] = window.messages[data.channel_id]
        .filter(m=>m.id!=='nonce-'+data.message.nonce);
      if (window.currentChannel===data.channel_id) document.getElementById('m-nonce-'+data.message.nonce)?.remove();
    } else {
      window.channels[0].unread_count += 1;
      if (window.currentChannel===data.channel_id&&document.hasFocus()) {
        window.channels[0].unread_count = 0;
        backendfetch(`/api/v1/channel/${data.channel_id}/messages/ack`, { method: 'POST' });
      } else {
        let notifstate = getNotifStateChannel(window.channels[0].id, window.channels[0].type);
        if (notifstate==='all'||(notifstate==='mentions'&&(new RegExp('@('+window.username+'|e)($|\\s|\\*|\\_|\\~|<|@)','im')).test(window.messages[data.channel_id][0].content))) notify('message', window.messages[data.channel_id][0], data.channel_id);
      }
    }
    // Show
    window.messages[data.channel_id][0].user.hide = shouldHideUser(window.messages[data.channel_id], 0);
    if (window.currentChannel===data.channel_id) messagesContainer.insertAdjacentHTML('afterbegin', await displayMessage(window.messages[data.channel_id][0], window.channels[0]));
    // Save last
    window.channels[0].last_message = {
      id: sanitizeMinimChars(data.message.id),
      content: sanitizeHTML(data.message.content||'')||imageicon,
      author: sanitizeHTML(data.message.user.display??sanitizeMinimChars(data.message.user.username||'')),
      key: data.message.key?sanitizeMinimChars(data.message.key):null,
      iv: data.message.iv?sanitizeMinimChars(data.message.iv):null
    };
    showChannels(window.channels);
  });
  window.stream.addEventListener('message_edited', (event)=>{
    let data = JSON.parse(event.data);
    let idxc = window.channels.findIndex(ch=>ch.id===data.channel_id);
    if (window.channels[idxc].last_message?.id===data.message.id) {
      window.channels[idxc].last_message.content = sanitizeHTML(data.message.content||'')||imageicon;
      window.channels[idxc].last_message.iv = data.message.iv?sanitizeMinimChars(data.message.iv):null;
      showChannels(window.channels);
    }
    if (!window.messages[data.channel_id]) return;
    let idx = window.messages[data.channel_id].findIndex(msg=>msg.id===data.message.id);
    window.messages[data.channel_id][idx].content = data.message.content;
    window.messages[data.channel_id][idx].key = data.message.key;
    window.messages[data.channel_id][idx].iv = data.message.iv;
    window.messages[data.channel_id][idx].edited_at = data.message.edited_at;
    if (window.currentChannel===data.channel_id) showMessages(window.messages[data.channel_id]);
  });
  window.stream.addEventListener('message_deleted', (event)=>{
    let data = JSON.parse(event.data);
    let idxc = window.channels.findIndex(ch=>ch.id===data.channel_id);
    if (window.channels[idxc].last_message?.id===data.message_id) {
      window.channels[idxc].last_message = null;
      showChannels(window.channels);
    }
    if (!window.messages[data.channel_id]) return;
    window.messages[data.channel_id] = window.messages[data.channel_id].filter(msg=>msg.id!==data.message_id);
    if (window.currentChannel===data.channel_id) showMessages(window.messages[data.channel_id]);
  });
  window.stream.addEventListener('call_start', (event)=>{
    calls.event('start', JSON.parse(event.data));
  });
  window.stream.addEventListener('call_join', (event)=>{
    calls.event('join', JSON.parse(event.data));
  });
  window.stream.addEventListener('call_left', (event)=>{
    calls.event('left', JSON.parse(event.data));
  });
  window.stream.addEventListener('call_signal', (event)=>{
    let data = JSON.parse(event.data);
    if (data.from_user===window.username) return;
    calls.signal(data);
  });
}

// User
window.deletesession = (id)=>{
  backendfetch('/api/v1/me/session/'+id, {
    method: 'DELETE'
  })
    .then(()=>window.viewsessions());
};
window.viewsessions = ()=>{
  let modal = document.getElementById('sessions');
  modal.showModal();
  backendfetch('/api/v1/me/sessions')
    .then(async(res)=>{
      let key = (await getRSAKeyPair()).privateKey;
      res.sort((a,b)=>b.logged_in_at-a.logged_in_at);
      for (let i = 0; i<res.length; i++) {
        res[i].browser = await decryptRSAString(res[i].browser, key);
        res[i].device = await decryptRSAString(res[i].device, key);
      }
      modal.querySelector('div').innerHTML = res
        .map(ses=>`<div class="session">
  <span>
    <span>${ses.browser} · ${ses.device}</span>
    <span class="small">${formatTime(Math.floor(ses.logged_in_at*1000))}</span>
  </span>
  ${ses.current?'<span tlang="user.currentsession">(current)</span>':`<button onclick="window.deletesession('${sanitizeMinimChars(ses.id)}')">x</button>`}
</div>`)
        .join('');
      window.translate();
    });
};
window.viewblocks = ()=>{
  let modal = document.getElementById('blocks');
  modal.showModal();
  backendfetch('/api/v1/me/blocks')
    .then(res=>{
      modal.querySelector('div').innerHTML = res
        .map(usr=>`<div class="block">
  <img src="${usr.pfp?pfpById(usr.pfp):userToDefaultPfp(usr)}" width="30" height="30" aria-hidden="true" loading="lazy">
  <span>
    <span>${sanitizeHTML(usr.display??sanitizeMinimChars(usr.username))}</span>
    <span class="small">${formatTime(Math.floor(usr.blocked_at*1000))}</span>
  </span>
  <button onclick="window.unblockmember('${sanitizeMinimChars(usr.username)}')">x</button>
</div>`)
        .join('')||'<span tlang="user.noblocks">No blocked users</span>';
      window.translate();
    });
  modal.querySelector('button.add').onclick = async()=>{
    let mem = await ask('user.blockask', 3);
    if (!mem) return;
    window.blockmember(mem);
    setTimeout(()=>{window.viewblocks()}, 100);
  };
};
window.useredit = ()=>{
  let modal = document.getElementById('edit-user');
  modal.showModal();
  backendfetch('/api/v1/me', { passstatus: true })
    .then(me=>{showuserdata(me)});
  document.getElementById('uec-display').onclick = ()=>{
    let formData = new FormData();
    formData.append('display', document.getElementById('ue-display').value);
    backendfetch('/api/v1/me', {
      method: 'PATCH',
      body: formData
    })
      .then(()=>{window.useredit()});
  };
  document.getElementById('ue-imginp').onchange = async(evt)=>{
    if (!evt.target.files[0]) return;
    if (!evt.target.files[0].type.startsWith('image/')) return;
    let img = await processImageToPfp(evt.target.files[0]);
    let formData = new FormData();
    formData.append('pfp', img, 'pfp.webp');
    backendfetch('/api/v1/me', {
      method: 'PATCH',
      body: formData
    })
      .then(()=>{window.useredit()});
  }
  document.getElementById('ue-img').onclick = function(){
    document.getElementById('ue-imginp').click();
  };
};
window.showuserdata = (me)=>{
  if (me.status===401) {
    logout(); // Session is incorrect, re login
  } else if (me.status===500) {
    location.reload();
  } else if (me.success===false) {
    // Uh issue isn't the session or server but still failed, try to work without user data
  } else {
    UserStore.set(me.username, Object.merge(UserStore.get(me.username), me));
    window.username = sanitizeMinimChars(me.username);
    window.servers[window.servers.findIndex(srv=>srv.id===window.currentServer)].name = me.username;
    localStorage.setItem('servers', JSON.stringify(window.servers));
    document.querySelector('#user img').src = me.pfp?pfpById(me.pfp):userToDefaultPfp(me);
    document.querySelector('#user img').setAttribute('title', me.username);
    document.getElementById('ue-display').value = me.display??'';
    document.getElementById('ue-display').placeholder = me.username??'';
    document.querySelector('#edit-user img').src = me.pfp?pfpById(me.pfp):userToDefaultPfp(me);
    PKStore.set(window.username, localStorage.getItem(window.currentServer+'-publicKey'));
  }
  getChannels();
};

// Split & Layout
let splitinst;
function layout() {
  if (smallScreen()) {
    if (splitinst) {
      splitinst.destroy();
      splitinst = null;
    }
    document.querySelectorAll('side,main').forEach(elem=>elem.style.flex = '');
    if (document.querySelector('side').style.display==='none'&&document.querySelector('main').style.display==='none') return;
    document.querySelector('side').style.display = window.currentChannel?'none':'';
    document.querySelector('main').style.display = window.currentChannel?'':'none';
    document.querySelector('.lateral').style.display = 'none';
  } else {
    document.querySelector('side').style.display = '';
    document.querySelector('main').style.display = '';
    document.querySelectorAll('side,main').forEach(elem=>elem.style.flex = 'unset');
    if (!splitinst) {
      document.querySelector('.lateral').style.display = window.currentChannelType===2?'':'none';
      if (window.currentChannel.length) loadChannel(window.currentChannel);
      splitinst = Split(['side', 'main'], {
        sizes: [20, 80]
      });
    }
  }
}
layout();
window.onresize = ()=>{layout()};

window.username = '';
async function loadMain() {
  // User
  let me = await backendfetch('/api/v1/me', { passstatus: true })
  showuserdata(me);

  // Channel list
  getChannels();

  // Stream
  startStream();
}

const vts = {
  lexend: 'Lexend, Arial, sans-serif',
  arial: 'Arial, sans-serif',
  dyslexic: 'OpenDyslexic, Arial, sans-serif',
  system: 'system-ui, Arial, sans-serif'
};
document.querySelector('body').style.setProperty('--accent', localStorage.getItem('ptheme')??'#221111');
document.querySelector('body').style.setProperty('--font', vts[localStorage.getItem('pfont')??'lexend']??vts.lexend);
document.querySelector('body').style.setProperty('direction', localStorage.getItem('prtl')==='true'?'rtl':'');
document.querySelector('body').style.setProperty('--sbp', localStorage.getItem('psbp')??'');
document.querySelector('body').style.setProperty('--obp', localStorage.getItem('pobp')??'');
tippy([document.getElementById('btn-languages'),document.getElementById('srv-btn-languages')], {
  allowHTML: true,
  content: '<span tlang="lang.change">Change language</span>'+Array.from(new Set(Object.values(languages)))
    .map(lang=>`<button onclick="localStorage.setItem('language','${lang}');window.translate()">${getLanguageName(lang)}</button>`)
    .join('')+'<span><label tlang="lang.timeuilang" for="timeuilang">Time uses ui locale</label><input id="timeuilang" type="checkbox" onchange="localStorage.setItem(`timeUILang`,this.checked)"></span>',
  interactive: true,
  trigger: 'click',
  placement: 'top-end',
  sticky: true,
  onMount: ()=>{document.getElementById('timeuilang').checked=localStorage.getItem('timeUILang')==='true'}
});
function postLogin() {
  // DB
  let dbRequest = indexedDB.open('data', 2);
  dbRequest.onupgradeneeded = function(e) {
    let db = e.target.result;
    if (!db.objectStoreNames.contains('servers')) {
      db.createObjectStore('servers');
    }
  };
  dbRequest.onsuccess = async(e)=>{
    let db = e.target.result;
    window.db = db;
    let tx = db.transaction(['servers'], 'readwrite');
    let store = tx.objectStore('servers');
    let addreq = store.add({ notifs: {}, public: {}, pinned: {} }, window.currentServer);
    addreq.onerror = (evt)=>{evt.preventDefault()};
    let req = store.get(window.currentServer);
    req.onsuccess = (e)=>{
      let val = e.target.result;
      ChannelNotifStore = new Map(Object.entries(val.notifs));
      window.ChannelNotifStore = ChannelNotifStore;
      PinnedChannelsStore = new Map(Object.entries(val.pinned??{}));
      window.PinnedChannelsStore = PinnedChannelsStore;
      PKStore = new Map(Object.entries(val.public));
      window.PKStore = PKStore;
    };
  };

  // Tippy
  tippy(document.getElementById('user'), {
    allowHTML: true,
    content: `<button onclick="window.useredit()" tlang="user.edit">Edit</button>
<button onclick="window.viewblocks()" tlang="user.blocks">Blocks</button>
<button onclick="window.viewsessions()" tlang="user.sessions">Sessions</button>
<button onclick="localStorage.removeItem('pls');location.reload()" tlang="user.changeserver">Change server</button>
<button onclick="logout()" tlang="user.logout" style="color:var(--invalid)">Log out</button>`,
    interactive: true,
    trigger: 'click',
    placement: 'bottom-start',
    sticky: true
  });
  tippy(document.getElementById('channel-add'), {
    allowHTML: true,
    content: (window.serverData[getCurrentServerUrl()]?.disable_channel_creation?'':`<button onclick="window.createChannel(1)" tlang="channel.newdm">Message User</button>
<button onclick="window.createChannel(2)" tlang="channel.newgroup">Create Group</button>
<button onclick="window.createChannel(3)" tlang="channel.newbroadcast">Create Broadcast</button>`)+
`<button onclick="window.joinChannel()" tlang="channel.joingroup">Join Group</button>`,
    interactive: true,
    trigger: 'click',
    placement: 'bottom-end',
    sticky: true
  });
  tippy(document.getElementById('btn-settings'), {
    allowHTML: true,
    content: `<b tlang="settings.layout">Layout</b>
<span>
  <label for="s-theme" tlang="settings.theme">Theme:</label>
  <input type="color" id="s-theme" oninput="document.querySelector('body').style.setProperty('--accent',this.value);localStorage.setItem('ptheme',this.value)" value="${localStorage.getItem('ptheme')??'#221111'}">
</span>
<span>
  <label for="s-font" tlang="settings.font">Font:</label>
  <select id="s-font">
    <option value="lexend">Lexend</option>
    <option value="arial">Arial</option>
    <option value="dyslexic">Open Dyslexic</option>
    <option value="system">System</option>
  </select>
</span>
<span>
  <label for="s-rtl" tlang="settings.rtl">RTL:</label>
  <input id="s-rtl" type="checkbox" onchange="document.querySelector('body').style.setProperty('direction',this.checked?'rtl':'');localStorage.setItem('prtl',this.checked)"${localStorage.getItem('prtl')==='true'?' checked':''}>
</span>
<b tlang="settings.messages">Messages</b>
<span>
  <label for="s-sbp" tlang="settings.sbp">Self Position:</label>
  <select id="s-sbp">
    <option value="" tlang="settings.auto">Auto</option>
    <option value="ltr" tlang="settings.left">Left</option>
    <option value="rtl" tlang="settings.right">Right</option>
  </select>
</span>
<span>
  <label for="s-obp" tlang="settings.obp">Other Position:</label>
  <select id="s-obp">
    <option value="" tlang="settings.auto">Auto</option>
    <option value="ltr" tlang="settings.left">Left</option>
    <option value="rtl" tlang="settings.right">Right</option>
  </select>
</span>
<b tlang="settings.behavior">Behavior</b>
<span>
  <label for="s-notif" tlang="settings.notif">Notifications:</label>
  <input id="s-notif" type="checkbox" ${localStorage.getItem('pnotif')==='true'?' checked':''}>
</span>
<span>
  <label for="s-ma" tlang="settings.medialways">Load media on mobile data:</label>
  <input id="s-ma" type="checkbox" onchange="localStorage.setItem('pmedialways',this.checked)"${localStorage.getItem('pmedialways')==='true'?' checked':''}>
</span>
<span>
  <label for="s-rc" tlang="settings.rc">Remember channel:</label>
  <input id="s-rc" type="checkbox" onchange="localStorage.setItem('prc',this.checked)"${localStorage.getItem('prc')==='true'?' checked':''}>
</span>
<span>
  <label for="s-rs" tlang="settings.rs">Remember server:</label>
  <input id="s-rs" type="checkbox" onchange="localStorage.setItem('prs',this.checked)"${localStorage.getItem('prs')==='true'?' checked':''}>
</span>`,
    interactive: true,
    trigger: 'click',
    placement: 'top-start',
    sticky: true,
    onMount: ()=>{
      // Font
      document.getElementById('s-font').value = localStorage.getItem('pfont')??'lexend';
      document.getElementById('s-font').onchange = (evt)=>{
        document.querySelector('body').style.setProperty('--font', vts[evt.target.value]??vts.lexend);
        localStorage.setItem('pfont', evt.target.value);
      };
      // Notifs
      document.getElementById('s-notif').onchange = (evt)=>{
        localStorage.setItem('pnotif', evt.target.checked);
        if (Notification.permission !== 'granted') {
          Notification.requestPermission().then((permission) => {
            if (permission !== 'granted') {
              document.getElementById('s-notif').checked = false;
              localStorage.setItem('pnotif','false');
            }
          });
        }
      };
      // Self bubble pos
      document.getElementById('s-sbp').value = localStorage.getItem('psbp')??'';
      document.getElementById('s-sbp').onchange = (evt)=>{
        document.querySelector('body').style.setProperty('--sbp', evt.target.value);
        localStorage.setItem('psbp', evt.target.value);
      };
      // Other bubble pos
      document.getElementById('s-obp').value = localStorage.getItem('pobp')??'';
      document.getElementById('s-obp').onchange = (evt)=>{
        document.querySelector('body').style.setProperty('--obp', evt.target.value);
        localStorage.setItem('pobp', evt.target.value);
      };
    }
  });

  // Stuff that needs to run before other stuff
  fetch('./media/default-pfp.svg')
    .then(img=>img.text())
    .then(async(img)=>{
      window.defaultpfp = img;
      if (!window.serverData[getCurrentServerUrl()]) {
        let dat;
        try {
          dat = await fetch(getCurrentServerUrl()+'/api/v1');
          dat = await dat.json();
        } catch(err) {
          localStorage.removeItem('pls');
          location.reload();
          return;
        }
        window.serverData[getCurrentServerUrl()] = dat;
      }
      messageInput.setAttribute('maxlength', window.serverData[getCurrentServerUrl()]?.messages?.max_message_length??2000);
      loadMain();
    });
}
window.postLogin = postLogin;