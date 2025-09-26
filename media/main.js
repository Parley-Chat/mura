// Messages
const messageInput = document.getElementById('input');
const messageSned = document.getElementById('sned');
const fileButton = document.getElementById('addfilebutton');
const fileInput = document.getElementById('addfile');
const imageicon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 40C0 28.9543 8.95431 20 20 20H236C247.046 20 256 28.9543 256 40V215C256 226.046 247.046 235 236 235H20C8.95431 235 0 226.046 0 215V40ZM78 68C78 81.8071 66.8071 93 53 93C39.1929 93 28 81.8071 28 68C28 54.1929 39.1929 43 53 43C66.8071 43 78 54.1929 78 68ZM150.135 91.8679C153.266 86.7107 160.734 86.7107 163.865 91.8679L234.817 208.76C238.075 214.127 234.22 221 227.952 221H142.029H86.048H26.9705C20.3787 221 16.6463 213.367 20.6525 208.08L78.1821 132.152C81.3664 127.949 87.6335 127.949 90.8179 132.152L110.176 157.7L150.135 91.8679Z"/></svg>';
window.messages = {};
let files = [];
let reply = null;
messageInput.oninput = messageInput.onchange = function() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight-4, 16 * 10) + 'px';
};
let sending = false;
function afterSend() {
  sending = false;
  messageInput.value = '';
  files = [];
  reply = null;
  messageInput.oninput();
  filePreview();
  window.closereply();
  document.getElementById('messages').scrollTop = 0;
}
function BasicSend(msg, channel, key=null, iv=null) {
  let formData = new FormData();
  formData.append('content', msg);
  if (key) {
    formData.append('key', key);
    formData.append('iv', iv);
  }
  if (reply) {
    formData.append('replied_to', reply);
  }
  files.forEach(file=>{
    formData.append('files', file, file.name);
  });
  setTimeout(()=>{sending=false}, 500);
  backendfetch('/api/v1/channel/'+channel+'/messages', {
    method: 'POST',
    body: formData
  })
    .then(()=>{
      sending = false;
      afterSend();
    })
    .catch(err=>{
      sending = false;
    });
}
async function CryptSend(msg, channel) {
  getCurrentKeyChannel(channel, async()=>{
    let last = Object.keys(window.keys[channel]).reduce((a, b) => window.keys[channel][a]?.expires_at > window.keys[channel][b]?.expires_at ? a : b, '');
    if (!last || Date.now()>window.keys[channel][last].expires_at) {
      backendfetch('/api/v1/channel/'+channel+'/members?pb=true')
        .then(async(members)=>{
        let nkey = await newAESKey();
        let newKey = await AESKeyToBase64(nkey);
        let body = {};
        for (let i=0; i<members.length; i++) {
          const publicKey = await getRSAKeyFromPublic64(members[i].public);
          body[members[i].username] = await encryptRSAString(newKey, publicKey);
        }
        backendfetch('/api/v1/channel/'+channel+'/key', {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        })
          .then(async(pkey)=>{
            getKeyContents(channel, pkey.key_id);
            let enc = await encryptAESString(msg, nkey);
            BasicSend(enc.txt, channel, pkey.key_id, enc.iv);
          })
          .catch(err=>{
            sending = false;
          });
      })
    } else {
      const privateKey = (await getRSAKeyPair()).privateKey;
      let nkey = await base64ToAESKey(await decryptRSAString(window.keys[channel][last].key, privateKey));
      let enc = await encryptAESString(msg, nkey);
      BasicSend(enc.txt, channel, last, enc.iv);
    }
  });
}
async function MessageSend() {
  if (sending) return;
  let msg = messageInput.value.trim()
  messageInput.value = msg;
  if (msg.length<1&&files.length<1) return;
  sending = true;
  if (window.currentChannelType===3) {
    BasicSend(msg, window.currentChannel);
  } else {
    CryptSend(msg, window.currentChannel);
  }
}
messageInput.onkeydown = function(event) {
  if (sending) event.preventDefault();
  if (event.key!=='Enter'||event.shiftKey) return;
  event.preventDefault();
  MessageSend();
};
messageSned.onclick = function() {
  MessageSend();
};
function elemfilepreview(file) {
  let url = URL.createObjectURL(file);
  switch(file.type.split('/')[0]) {
    case 'image':
      return `<img src="${url}" loading="lazy">`;
    case 'video':
      return `<video src="${url}" controls loading="lazy"></video>`;
    case 'audio':
      return `<audio src="${url}" controls loading="lazy"></audio>`;
    default:
      return `<div class="file">${file.name} · ${file.size}B</div>`;
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
fileInput.onchange = async(event)=>{
  files = files.concat(Array.from(event.target.files));
  fileInput.value = '';
  files = files.filter(file=>{
    if (file.size>window.serverData[window.currentServer].max_file_size.attachments) {
      notice('message.attachment.toobig', file.name);
      return false;
    }
    return true;
  });
  if (files.length>window.serverData[window.currentServer].messages.max_attachments) {
    files = files.slice(0, window.serverData[window.currentServer].messages.max_attachments);
    notice('message.attachment.toomany', window.serverData[window.currentServer].messages.max_attachments);
  }
  filePreview()
};


function EditMessage(channel, msg, content, iv=null) {
  let formData = new FormData();
  formData.append('content', content);
  if (iv) formData.append('iv', iv);
  backendfetch('/api/v1/channel/'+channel+'/message/'+msg, {
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
    EditMessage(channel, msg, enc.txt, enc.iv);
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
window.pinMessage = (msg)=>{
  backendfetch('/api/v1/channel/'+window.currentChannel+'/message/'+msg+'/pin', {
    method: 'POST'
  });
};
window.unpinMessage = (msg)=>{
  backendfetch('/api/v1/channel/'+window.currentChannel+'/message/'+msg+'/pin', {
    method: 'DELETE'
  });
};
window.editMessage = (msg, key, elem, cont)=>{
  elem.querySelector('.content').outerHTML = `<textarea name="message" class="content" maxlength="${window.serverData[window.currentServer]?.messages?.max_message_length??2000}"></textarea>
<div>
  <button class="save" lang="message.edit.save">Save</button>
  <button class="cancel" lang="message.edit.cancel">Cancel</button>
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
      EditMessage(window.currentChannel, msg, textarea.value);
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

class TxtLoader extends HTMLElement {
  constructor() {
    super();
  }
  connectedCallback() {
    fetch(`${window.currentServer}/attachment/${this.getAttribute('data-id')}`)
      .then(res=>{
        if (!res.ok) throw new Error('non ok');
        return res.text();
      })
      .then(res=>this.innerHTML=sanitizeHTML(res))
      .catch(err=>this.remove());
  }
}
customElements.define('txt-loader', TxtLoader);

window.downloadfile = (id, name)=>{
  fetch(`${window.currentServer}/attachment/${id}`)
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

const textdisplay = ['text/plain','text/html','text/css','text/csv','text/tab-separated-values','text/markdown','text/x-markdown','text/xml','application/xhtml+xml','text/javascript','text/ecmascript','text/x-python','text/x-c','text/x-c++','text/x-java','text/x-java-source','text/x-rustsrc','text/x-go','text/x-php','text/x-perl','text/x-ruby','text/x-lua','text/vcard','text/vcalendar','text/calendar','text/x-vcard','text/x-vcalendar','application/json','application/ld+json','application/xml','application/javascript','application/ecmascript','application/x-www-form-urlencoded','application/yaml','application/x-yaml','text/x-yaml','application/graphql','application/sql','application/toml','application/x-toml','text/x-toml','application/ini','text/x-ini','application/x-sh','application/x-httpd-php']
function attachToElem(att) {
  if (textdisplay.includes(att.mimetype)) {
    return `<div class="file">
  <span>${sanitizeHTML(att.filename)} · ${sanitizeMinimChars(att.size.toString())}B <button onclick="window.downloadfile('${sanitizeMinimChars(att.id)}', '${sanitizeAttr(att.filename)}')" aria-label="Download" lang="message.download"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M128 190V20" stroke-width="40" stroke-linecap="round" fill="none"/><path d="M127.861 212.999C131.746 213.035 135.642 211.571 138.606 208.607L209.317 137.896C212.291 134.922 213.753 131.011 213.708 127.114C213.708 127.076 213.71 127.038 213.71 127C213.71 118.716 206.994 112 198.71 112H57C48.7157 112 42 118.716 42 127C42 127.045 42.0006 127.089 42.001 127.134C41.961 131.024 43.4252 134.927 46.3936 137.896L117.104 208.607L117.381 208.876C120.312 211.662 124.092 213.037 127.861 212.999Z"/><rect y="226" width="256" height="30" rx="15"/></svg></button></span>
  <txt-loader data-id="${sanitizeMinimChars(att.id)}">...</txt-loader>
</div>`;
  }
  switch(att.mimetype.split('/')[0]) {
    case 'image':
      return `<img src="${window.currentServer}/attachment/${sanitizeMinimChars(att.id)}" loading="lazy">`;
    case 'video':
      return `<video src="${window.currentServer}/attachment/${sanitizeMinimChars(att.id)}" controls loading="lazy"></video>`;
    case 'audio':
      return `<audio src="${window.currentServer}/attachment/${sanitizeMinimChars(att.id)}" controls loading="lazy"></audio>`;
    default:
      return `<div class="file"><span>${sanitizeHTML(att.filename)} · ${sanitizeMinimChars(att.size.toString())}B <button onclick="window.downloadfile('${sanitizeMinimChars(att.id)}', '${sanitizeAttr(att.filename)}')" aria-label="Download" lang="message.download"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M128 190V20" stroke-width="40" stroke-linecap="round" fill="none"/><path d="M127.861 212.999C131.746 213.035 135.642 211.571 138.606 208.607L209.317 137.896C212.291 134.922 213.753 131.011 213.708 127.114C213.708 127.076 213.71 127.038 213.71 127C213.71 118.716 206.994 112 198.71 112H57C48.7157 112 42 118.716 42 127C42 127.045 42.0006 127.089 42.001 127.134C41.961 131.024 43.4252 134.927 46.3936 137.896L117.104 208.607L117.381 208.876C120.312 211.662 124.092 213.037 127.861 212.999Z"/><rect y="226" width="256" height="30" rx="15"/></svg></button></span></div>`;
  }
}
function decodeMessage(msg, ch=window.currentChannel) {
  return new Promise((resolve, reject)=>{
    getKeyContents(ch, msg.key, async()=>{
      const privateKey = (await getRSAKeyPair()).privateKey;
      let nkey = await base64ToAESKey(await decryptRSAString(window.keys[ch][msg.key].key, privateKey));
      let dec = await decryptAESString(msg.content, nkey, msg.iv);
      resolve(dec);
    });
  });
}
const TimeSeparation = 10 * 60 * 1000;
const messagesContainer = document.getElementById('messages');
async function showMessages(messages) {
  let ch = window.channels.find(ch=>ch.id===window.currentChannel);
  // Pre
  let decrypt = false;
  for (let i=0; i<messages.length; i++) {
    if (!messages[i].user) {
      if (window.currentChannelType!==3) {
        messages[i].user = DummyUser;
      } else {
        messages[i].user = {
          display: ch.name,
          username: 'b',
          pfp: ch.pfp
        };
      }
    }
    messages[i].user.hide = false;
    if (!messages[i].replied_to && messages[i+1] && messages[i+1].user.username===messages[i].user.username) {
      messages[i].user.hide = (messages[i].timestamp-messages[i+1].timestamp)<TimeSeparation; // Only hide is smaller than time separation
    }
    if (messages[i].key&&messages[i].iv) {
      decrypt = true;
      messages[i].content = await decodeMessage(messages[i]);
      messages[i].iv = null;
    }
    if (messages[i].replied_to) {
      messages[i].reply = messages.find(msg=>msg.id===messages[i].replied_to);
    }
  }
  if (decrypt) showChannels(window.channels);
  // Show
  let sendm = hasPerm(ch.permission,Permissions.SEND_MESSAGES);
  let mangm = hasPerm(ch.permission,Permissions.MANAGE_MESSAGES);
  messagesContainer.innerHTML = messages
    .map(msg=>{
      return `<div class="message" id="m-${sanitizeMinimChars(msg.id)}">
  ${msg.user.hide?`<span class="time">${formatHour(msg.timestamp)}</span>`:`<div class="avatar"><img src="${msg.user.pfp?pfpById(msg.user.pfp):userToDefaultPfp(msg.user)}" width="42" height="42" aria-hidden="true"></div>`}
  <div class="inner">
    <div class="actions">
      ${sendm?`<button onclick="window.replyMessage('${sanitizeMinimChars(msg.id)}', '${sanitizeHTML(msg.user.display??sanitizeMinimChars(msg.user.username))}')" aria-label="Reply" lang="message.reply"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M42 108H196V108C229.137 108 256 134.863 256 168V168V199.85C256 210.896 247.046 219.85 236 219.85V219.85C224.954 219.85 216 210.896 216 199.85V168V168C216 156.954 207.046 148 196 148V148H42V108Z"/><path d="M79.746 41.1778C83.0613 37.8625 87.5578 36 92.2464 36V36C107.996 36 115.883 55.0415 104.747 66.1782L47.2462 123.681C44.9032 126.024 44.9032 129.823 47.2462 132.166L104.747 189.67C115.883 200.806 107.996 219.848 92.2464 219.848V219.848C87.5579 219.848 83.0614 217.985 79.7461 214.67L5.72793 140.652C-1.30151 133.622 -1.30151 122.225 5.72793 115.196L79.746 41.1778Z"/></svg></button>`:''}
      ${msg.user.username===window.username?`<button onclick="window.editMessage('${sanitizeMinimChars(msg.id)}', '${sanitizeMinimChars(msg.key??'')}', this.parentElement.parentElement, '${sanitizeAttr(msg.content)}')" aria-label="Edit" lang="message.edit"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M36 198L87 239L213.98 78.9249L162.073 38.0226L36 198ZM170.11 27.8251L222.067 68.7297L239.674 46.5333C241.391 44.3698 241.028 41.2246 238.864 39.5086L194.819 4.5744C192.651 2.85464 189.498 3.22334 187.785 5.397L170.11 27.8251Z M35.1323 255.15C33.0948 255.784 31.0651 254.148 31.252 252.023L36 198L87.0001 239L35.1323 255.15Z"/></svg></button>`:''}
      ${ch.type===1||mangm?`<button onclick="window.pinMessage('${sanitizeMinimChars(msg.id)}')" aria-label="Pin" lang="message.pin"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M117.4 6.28699C118.758 0.114336 126.401 -2.11969 130.87 2.34949L253.649 125.126C258.118 129.595 255.883 137.239 249.71 138.597L206.755 148.044C204.89 148.454 203.182 149.39 201.832 150.74L181.588 170.983C180.637 171.934 179.889 173.067 179.386 174.313L154.115 236.957C151.434 243.603 142.838 245.354 137.771 240.287L95.5138 198.03L10.2823 254.884C7.65962 256.633 4.16588 256.288 1.93663 254.058C-0.292345 251.829 -0.63778 248.336 1.11143 245.714L57.964 160.48L15.7091 118.225C10.642 113.158 12.3932 104.562 19.0392 101.881L81.6827 76.6112C82.9295 76.1083 84.0621 75.3587 85.0128 74.4081L105.257 54.1649C106.607 52.8149 107.542 51.1066 107.952 49.2421L117.4 6.28699Z"/></svg></button>`:''}
      ${msg.user.username===window.username||mangm?`<button onclick="window.deleteMessage('${sanitizeMinimChars(msg.id)}')" aria-label="Delete" lang="message.delete" style="color:var(--invalid)"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M77.0892 18.9306C79.4013 18.9306 81.5077 17.6021 82.5038 15.5156L88.281 3.41493C89.2771 1.32846 91.3835 0 93.6956 0H162.304C164.617 0 166.723 1.32847 167.719 3.41494L173.496 15.5156C174.492 17.6021 176.599 18.9306 178.911 18.9306H222C226.418 18.9306 230 22.5123 230 26.9306V39C230 43.4183 226.418 47 222 47H34C29.5817 47 26 43.4183 26 39V26.9306C26 22.5123 29.5817 18.9306 34 18.9306H77.0892Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M42.4949 62.0605C39.7335 62.0605 37.4949 64.2991 37.4949 67.0605V241C37.4949 249.284 44.2106 256 52.4949 256H203.505C211.789 256 218.505 249.284 218.505 241V67.0605C218.505 64.2991 216.266 62.0605 213.505 62.0605H42.4949ZM78.8686 87.9194C71.728 87.9194 65.9393 93.708 65.9393 100.849V215.919C65.9393 223.06 71.728 228.849 78.8686 228.849C86.0093 228.849 91.7979 223.06 91.7979 215.919V100.849C91.7979 93.708 86.0093 87.9194 78.8686 87.9194ZM128 87.9194C120.859 87.9194 115.071 93.708 115.071 100.849V215.919C115.071 223.06 120.859 228.849 128 228.849C135.141 228.849 140.929 223.06 140.929 215.919V100.849C140.929 93.708 135.141 87.9194 128 87.9194ZM164.202 100.849C164.202 93.708 169.991 87.9194 177.131 87.9194C184.272 87.9194 190.061 93.708 190.061 100.849V215.919C190.061 223.06 184.272 228.849 177.131 228.849C169.991 228.849 164.202 223.06 164.202 215.919V100.849Z"/></svg></button>`:''}
      <button class="more" username="${sanitizeMinimChars(msg.user.username)}" id="${sanitizeMinimChars(msg.id)}"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M128 158C111.431 158 98 144.569 98 128C98 111.431 111.431 98 128 98C144.569 98 158 111.431 158 128C158 144.569 144.569 158 128 158ZM128 60C111.432 60 98.0001 46.5685 98.0001 30C98.0001 13.4315 111.432 -5.87112e-07 128 -1.31135e-06C144.569 -2.03558e-06 158 13.4315 158 30C158 46.5685 144.569 60 128 60ZM98 226C98 242.569 111.431 256 128 256C144.569 256 158 242.569 158 226C158 209.431 144.569 196 128 196C111.431 196 98 209.431 98 226Z"/></svg></button>
    </div>
    ${msg.replied_to?`<span class="reply" onclick="document.getElementById('m-${sanitizeMinimChars(msg.reply?.id??'')}').scrollIntoView({behavior:'smooth'})"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256"><path d="M256 132C256 120.954 247.046 112 236 112H60V112C26.8629 112 0 138.863 0 172V172V236C0 247.046 8.95431 256 20 256V256C31.0457 256 40 247.046 40 236V172V172C40 160.954 48.9543 152 60 152V152H236C247.046 152 256 143.046 256 132V132Z"/></svg>${msg.reply?`${sanitizeHTML(msg.reply.user.display??sanitizeMinimChars(msg.reply.user.username))}: ${sanitizeHTML(msg.reply.content)}`:'Cannot load message'}</span>`:''}
    ${msg.user.hide?'':`<span class="author">${sanitizeHTML(msg.user.display??sanitizeMinimChars(msg.user.username))}</span><span class="time">${formatTime(msg.timestamp)}</span>`}
    <span class="content">${window.MDParse(msg.content)}${msg.edited_at?`<span class="edited" title="${formatTime(msg.edited_at)}" lang="message.edited">(Edited)</span>`:''}</span>
    <div class="fileList">
      ${msg.attachments.map(att=>attachToElem(att)).join('')}
    </div>
  </div>
</div>`;
    })
    .join('');
  Array.from(document.querySelectorAll('.message .more')).forEach(btn=>{
    tippy(btn, {
      allowHTML: true,
      content: (window.username!==btn.getAttribute('username')?`<button onclick="window.blockmember('${btn.getAttribute('username')}')" onclick lang="member.block">Block</button>`:'')+
`<button onclick="navigator.clipboard.writeText('${btn.getAttribute('id')}')" lang="settings.copyid">Copy id</button>`,
      interactive: true,
      trigger: 'click',
      placement: 'bottom-end',
      sticky: true
    });
  });
  // Load more listener
  let more = false;
  function setList() {
    messagesContainer.onscroll = ()=>{
      if (!more && (messagesContainer.scrollHeight-messagesContainer.clientHeight+messagesContainer.scrollTop)<101) {
        more = true;
        backendfetch('/api/v1/channel/'+window.currentChannel+'/messages?before_message_id='+window.messages[window.currentChannel].slice(-1)[0].id)
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
  // Ack
  let idx = window.channels.findIndex(ch=>ch.id===window.currentChannel);
  if (messages.length>0&&window.channels[idx].unread_count>0) {
    window.channels[idx].unread_count = 0;
    showChannels(window.channels);
    backendfetch('/api/v1/channel/'+window.currentChannel+'/messages/ack', { method: 'POST' });
  }
}

window.onkeydown = (evt)=>{
  if (['body'].includes(document.activeElement.tagName.toLowerCase())) {
    messageInput.focus();
  }
};

// Channels
window.channels = [];
function showChannels(channels) {
  if (channels.length<1) {
    document.getElementById('channels').innerHTML = '<p lang="channel.listempty"></p>';
    window.translate();
    return;
  }
  document.getElementById('channels').innerHTML = channels
    .map(ch=>{
      let lstmsgcnt;
      if (ch.last_message) {
        lstmsgcnt = ch.last_message.content;
        if (ch.last_message.key&&window.keys[ch.id]&&window.keys[ch.id][ch.last_message.key]) {
          let msg = messages[ch.id].find(msg=>msg.id===ch.last_message.id);
          if (msg) lstmsgcnt = msg.content;
        }
      }
      return `<span>
  <button onclick="window.loadChannel('${ch.id}')">
    <img src="${ch.pfp?pfpById(ch.pfp):userToDefaultPfp(ch)}" width="30" height="30" aria-hidden="true" loading="lazy">
    <span class="div">
      <span class="name"${ch.name.length>7?` title="${sanitizeHTML(ch.name)}"`:''}>${sanitizeHTML(ch.name)}</span>
      ${ch.last_message?`<span class="msg">${ch.last_message.author}: ${lstmsgcnt}</span>`:''}
    </span>
    ${(ch.unread_count??0)>0?`<span class="unread">${ch.unread_count}</span>`:''}
  </button>
  ${ch.type!==1&&hasPerm(ch.permission,Permissions.MANAGE_CHANNEL)?`<button class="other" onclick="window.changeChannel('${ch.id}')" aria-label="Edit" lang="channel.edit"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M128.601 218.743C178.384 218.743 218.742 178.385 218.742 128.602C218.742 78.8184 178.384 38.4609 128.601 38.4609C78.8175 38.4609 38.4601 78.8184 38.4601 128.602C38.4601 178.385 78.8175 218.743 128.601 218.743ZM128.601 167.062C149.842 167.062 167.061 149.843 167.061 128.602C167.061 107.361 149.842 90.1415 128.601 90.1415C107.36 90.1415 90.1408 107.361 90.1408 128.602C90.1408 149.843 107.36 167.062 128.601 167.062Z"></path><path d="M101.001 11.0292C101.507 4.79869 106.711 0 112.962 0H143.038C149.289 0 154.493 4.79868 154.999 11.0292L158 48H98L101.001 11.0292Z"></path><path d="M101.001 244.971C101.507 251.201 106.711 256 112.962 256H143.038C149.289 256 154.493 251.201 154.999 244.971L158 208H98L101.001 244.971Z"></path><path d="M244.971 101.001C251.201 101.507 256 106.711 256 112.962L256 143.038C256 149.289 251.201 154.493 244.971 154.999L208 158L208 98L244.971 101.001Z"></path><path d="M11.0292 101.001C4.79869 101.507 -3.80751e-07 106.711 -6.5399e-07 112.962L-1.96869e-06 143.038C-2.24193e-06 149.289 4.79868 154.493 11.0292 154.999L48 158L48 98L11.0292 101.001Z"></path><path d="M192.883 25.8346C197.645 21.7687 204.733 22.0477 209.16 26.4753L229.71 47.025C234.137 51.4526 234.416 58.5404 230.351 63.3023L205.964 91.8642L164.321 50.2213L192.883 25.8346Z"></path><path d="M26.135 192.008C22.0807 196.77 22.3646 203.849 26.7873 208.271L47.7285 229.212C52.1512 233.635 59.2294 233.919 63.9921 229.865L92.2857 205.78L50.2198 163.714L26.135 192.008Z"></path><path d="M229.879 191.979C233.94 196.742 233.658 203.825 229.233 208.25L208.673 228.811C204.247 233.236 197.164 233.517 192.402 229.457L164.137 205.358L205.78 163.715L229.879 191.979Z"></path><path d="M63.9921 26.1356C59.2293 22.0813 52.1512 22.3652 47.7284 26.7879L26.7874 47.7289C22.3647 52.1517 22.0808 59.2298 26.1351 63.9926L50.22 92.2862L92.2857 50.2205L63.9921 26.1356Z"></path></svg></button>`:''}
  ${window.serverData[window.currentServer]?.disable_channel_deletion?'':`<button class="other" onclick="window.leaveChannel('${ch.id}')" aria-label="Leave" lang="channel.leave"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256"><path d="M219.856 5.85765C227.666 -1.95251 240.33 -1.95258 248.14 5.85765L250.141 7.85961C257.951 15.6701 257.951 28.3334 250.141 36.1438L158.285 127.999L250.141 219.857C257.952 227.667 257.952 240.33 250.141 248.141L248.14 250.142C240.33 257.952 227.666 257.952 219.856 250.142L127.999 158.285L36.143 250.142C28.3326 257.952 15.6693 257.952 7.85884 250.142L5.85786 248.141C-1.95262 240.33 -1.95262 227.667 5.85786 219.857L97.7133 127.999L5.85786 36.1438C-1.95262 28.3333 -1.95261 15.6701 5.85786 7.85961L7.85884 5.85765C15.6693 -1.95245 28.3327 -1.95266 36.143 5.85765L127.999 97.7141L219.856 5.85765Z"/></svg></button>`}
</span>`;
    })
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
      pfp: ch.pfp?sanitizeMinimChars(ch.pfp):null,
      permission: perm,
      base_permissions: chperm,
      unread_count: Number(ch.unread_count)??0,
      member_count: Number(ch.member_count)??1,
      last_message: ch.last_message?{
        id: sanitizeMinimChars(ch.last_message?.id||''),
        content: sanitizeHTML(ch.last_message?.content||'')||imageicon,
        author: sanitizeHTML(ch.last_message?.user?.display??sanitizeMinimChars(ch.last_message?.user?.username||'Unknown')),
        key: ch.last_message.key?sanitizeMinimChars(ch.last_message.key):null,
        iv: ch.last_message.iv?sanitizeMinimChars(ch.last_message.iv):null
      }:null
    };
  });
  window.channels = res;
  if (!window.currentChannel && res[0]) {
    loadChannel(res[0].id);
  }
  showChannels(res);
}
window.channelMembers = {};
function showMembers(id) {
  if (!channelMembers[id]) channelMembers[id] = [];
  let ch = window.channels.find(ch=>ch.id===id);
  document.querySelector('.lateral').innerHTML = `<button class="mobile" onclick="document.querySelector('main').style.display='';document.querySelector('side').style.display='none';document.querySelector('.lateral').style.display='none';" aria-label="Close member list"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="12" y="21" width="88" height="216"></rect><rect width="232" height="232" rx="20" stroke-width="24" fill="none" x="12" y="12"></rect></svg></button>`+
  channelMembers[id]
    .toSorted((a,b)=>{
      if ((a.display??a.username)!==(b.display??b.username)) return (a.display??a.username).localeCompare(b.display??b.username);
      return b.joined_at - a.joined_at;
    })
    .map(mem=>`<button username="${sanitizeMinimChars(mem.username)}"><img src="${mem.pfp?pfpById(mem.pfp):userToDefaultPfp(mem)}" width="30" height="30" aria-hidden="true" loading="lazy"><span>${sanitizeHTML(mem.display??mem.username)}</span></button>`)
    .join('');
  document.querySelectorAll('.lateral button:not(.mobile)').forEach(btn=>{
    if (window.username === btn.getAttribute('username')) return;
    tippy(btn, {
      allowHTML: true,
      content: (window.serverData[window.currentServer]?.disable_channel_creation?'':`<button onclick="window.createChannel(1, '${btn.getAttribute('username')}')" lang="member.message">Message</button>`)+
`<button onclick="window.blockmember('${btn.getAttribute('username')}')" onclick lang="member.block">Block</button>`+
(hasPerm(ch.permission,Permissions.MANAGE_PERMISSION)||hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)?`<hr style="width:90%">`:'')+
(hasPerm(ch.permission,Permissions.MANAGE_PERMISSION)?`<button onclick="window.permmember('${btn.getAttribute('username')}')" lang="member.changeperms">Change permissions</button>`:'')+
(hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)?`<button onclick="window.kickmember('${btn.getAttribute('username')}')" lang="member.kick">Kick</button>
<button onclick="window.banmember('${btn.getAttribute('username')}')" lang="member.ban">Ban</button>`:''),
      interactive: true,
      trigger: 'click',
      placement: 'left-start',
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
  let perm = Number(window.channelMembers[window.currentChannel].find(mem=>mem.username===id).permissions)??0;
  if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
  if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
  let ch = window.channels.find(ch=>ch.id===window.currentChannel);
  let modal = document.getElementById('permModal');
  modal.showModal();
  modal.querySelector('div').innerHTML = Object.entries(Permissions)
    .map(k=>`<label for="pu-${k[0]}" lang="permission.${k[0].toLowerCase()}">${k[0].toLowerCase()}</label><input id="pu-${k[0]}" data-weight="${k[1]}" type="checkbox"${hasPerm(ch.permission,k[1])?'':' disabled'}${hasPerm(perm,k[1])?' checked':''}><br>`)
    .join('');
  modal.querySelector('button.set').onclick = ()=>{
    backendfetch( '/api/v1/channel/'+window.currentChannel+'/member/'+id, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json'
      },
      body: `{
  "permissions": ${Array.from(modal.querySelectorAll('input')).map(i=>i.checked?Number(i.getAttribute('data-weight')):0).reduce((a, b)=>a+b,0)}
}`
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
      body: `{
  "permissions": null
}`
    })
      .then(()=>{modal.close()});
  };
};
window.kickmember = (id)=>{
  backendfetch('/api/v1/channel/'+window.currentChannel+'/member/'+id, {
    method: 'DELETE'
  })
    .then(res=>{
      channelMembers[window.currentChannel] = [];
    });
};
window.banmember = async(id)=>{
  let formData = new FormData();
  formData.append('reason', await ask('member.ban.reason', 0, 100)??'');
  backendfetch('/api/v1/channel/'+window.currentChannel+'/bans/'+id, {
    method: 'POST',
    body: formData
  })
    .then(res=>{
      channelMembers[window.currentChannel] = [];
    });
};
window.unbanmember = async(id)=>{
  backendfetch('/api/v1/channel/'+window.currentChannel+'/bans/'+id, {
    method: 'DELETE'
  })
    .then(()=>{window.bansPanel()});
};
function getMembers(id, page=1) {
  if (!channelMembers[id]) channelMembers[id] = [];
  if (channelMembers[id].length>0&&page===1) {
    showMembers(id);
    return;
  }
  let ch = window.channels.find(ch=>ch.id===id);
  backendfetch('/api/v1/channel/'+id+'/members?page='+page)
    .then(res=>{
      if (!Array.isArray(res)) return;
      channelMembers[id] = channelMembers[id].concat(res);
      if (ch.member_count>channelMembers[id].length&&res.length>0) getMembers(id, page+1);
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
  sending = false;
  let ch = window.channels.find(ch=>ch.id===id);
  window.currentChannel = id;
  window.currentChannelType = ch.type;
  document.querySelector('.lateraltoggle').style.display = 'none';
  if (smallScreen()) {
    document.querySelector('side').style.display = 'none';
    document.querySelector('main').style.display = '';
  }
  // Labels & Buttons
  document.querySelector('.top .name').innerText = ch.name;
  document.querySelector('.top .type').outerHTML = TypeIcons[ch.type];
  document.getElementById('inviteButton').style.display = 'none';
  document.getElementById('bansButton').style.display = 'none';
  document.querySelector('.lateral').style.display = 'none';
  if (ch.type===2||(ch.type===3&&(hasPerm(ch.permission,Permissions.MANAGE_CHANNEL)||hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)))) {
    if (smallScreen()) {
      document.querySelector('.lateraltoggle').style.display = '';
    } else {
      document.querySelector('.lateral').style.display = '';
    }
    showMembers(id);
    getMembers(id);
    if (hasPerm(ch.permission,Permissions.MANAGE_CHANNEL)) document.getElementById('inviteButton').style.display = '';
    if (hasPerm(ch.permission,Permissions.MANAGE_MEMBERS)) document.getElementById('bansButton').style.display = '';
  }
  // Messages
  let canSendMsgs = hasPerm(ch.permission,Permissions.SEND_MESSAGES);
  document.querySelector('.bar').style.display = canSendMsgs?'':'none';
  document.querySelector('.bar.fake').style.display = canSendMsgs?'none':'';
  if (window.messages[id]) {
    showMessages(window.messages[id]);
  } else {
    showMessages([]);
    backendfetch('/api/v1/channel/'+id+'/messages')
      .then(res=>{
        window.messages[id] = res;
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
    .map(k=>`<label for="pu-${k[0]}" lang="permission.${k[0].toLowerCase()}">${k[0].toLowerCase()}</label><input id="pu-${k[0]}" data-weight="${k[1]}" type="checkbox"${hasPerm(ch.permission,k[1])?'':' disabled'}${hasPerm(perm,k[1])?' checked':''}><br>`)
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
window.bansPanel = ()=>{
  document.getElementById('bansModal').showModal();
  backendfetch('/api/v1/channel/'+window.currentChannel+'/bans')
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
  backendfetch('/api/v1/channel/'+window.currentChannel+'/invite')
    .then(res=>{
      document.querySelector('#inviteModal .cur').innerText = sanitizeMinimChars(res.invite_code??'None');
    });
  document.querySelector('#inviteModal .rand').onclick = ()=>{
    backendfetch('/api/v1/channel/'+window.currentChannel+'/invite', {
      method: 'POST'
    })
      .then(res=>window.invitePanel());
  };
  document.querySelector('#inviteModal .rem').onclick = ()=>{
    backendfetch('/api/v1/channel/'+window.currentChannel+'/invite', {
      method: 'DELETE'
    })
      .then(res=>window.invitePanel());
  };
  document.querySelector('#inviteModal .set').onclick = ()=>{
    let formData = new FormData();
    formData.append('invite_code', document.getElementById('invitenew').value);

    backendfetch('/api/v1/channel/'+window.currentChannel+'/invite', {
      method: 'POST',
      body: formData
    })
      .then(res=>window.invitePanel());
  };
};
window.pinsPanel = ()=>{
  let modal = document.getElementById('pinsModal');
  modal.show();
  let button = document.getElementById('pinsButton');
  let bb = button.getBoundingClientRect();
  modal.style.top = bb.bottom+10+'px';
  modal.style.left = 'calc('+bb.right+'px - 25vw)';
  backendfetch('/api/v1/channel/'+window.currentChannel+'/pins')
    .then(async(messages)=>{
      if (messages.length<1) {
        document.querySelector('#pinsModal div').innerText = '';
        document.querySelector('#pinsModal div').setAttribute('lang','message.nopins');
        return;
      }
      document.querySelector('#pinsModal div').removeAttribute('lang');
      let ch = window.channels.find(ch=>ch.id===window.currentChannel);
      // Pre
      for (let i=0; i<messages.length; i++) {
        messages[i].content = messages[i].key?(await decodeMessage(messages[i])):messages[i].content;
      }
      // Show
      document.querySelector('#pinsModal div').innerHTML = messages
        .map(msg=>{
          return `<div class="message">
  <div class="avatar"><img src="${msg.user.pfp?pfpById(msg.user.pfp):userToDefaultPfp(msg.user)}" width="42" height="42" aria-hidden="true"></div>
  <div class="inner">
    ${ch.type===1||hasPerm(ch.permission,Permissions.MANAGE_MESSAGES)?`<div class="actions">
      <button onclick="window.unpinMessage('${sanitizeMinimChars(msg.id)}');window.pinsPanel()" aria-label="Unpin" lang="message.unpin" style="color:var(--invalid)"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M117.925 15.287C119.283 9.11438 126.925 6.88031 131.394 11.3495L244.087 124.041C248.556 128.51 246.321 136.153 240.148 137.511L201.418 146.029C199.553 146.439 197.845 147.375 196.495 148.724L177.921 167.299C176.97 168.249 176.222 169.382 175.719 170.629L152.677 227.748C149.996 234.394 141.4 236.146 136.332 231.078L97.7987 192.545L18.5585 245.401C16.1203 247.027 12.8731 246.706 10.8007 244.634C8.72831 242.561 8.40702 239.314 10.0331 236.876L62.8886 157.636L24.3564 119.103C19.2888 114.036 21.0402 105.44 27.6864 102.759L84.8066 79.7167C86.0533 79.2137 87.186 78.465 88.1366 77.5145L106.71 58.9403C108.06 57.5903 108.996 55.882 109.406 54.0174L117.925 15.287Z"/><path d="M20 20L236 236" stroke-width="40" stroke-linecap="round"/></svg></button>
    </div>`:''}
    <span class="author">${sanitizeHTML(msg.user.display??sanitizeMinimChars(msg.user.username))}</span><span class="time">${formatTime(msg.timestamp)}</span>
    <span class="content">${window.MDParse(msg.content)}${msg.edited_at?`<span class="edited" title="${formatTime(msg.edited_at)}" lang="message.edited">(Edited)</span>`:''}</span>
    <div class="fileList">
      ${msg.attachments.map(att=>attachToElem(att)).join('')}
    </div>
  </div>
</div>`;
        })
        .join('');
    });
};

// Stream
window.stream = null;
function startStrem() {
  if (window.stream) return;
  window.stream = new EventSource(`${window.currentServer}/api/v1/stream?authorization=Bearer ${localStorage.getItem(window.currentServer+'-sessionToken')}`);
  window.stream.addEventListener('error', (event)=>{
    if (!event.data) return;
    let data = JSON.parse(event.data);
    console.log('Stream error:', data.error);
    window.stream.close();
    window.stream = null;
    startStrem();
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
    window.loadChannel(sanitizeMinimChars(data.channel.id));
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
    delete window.channelMembers[data.channel_id];
    showChannels(window.channels);
  });
  // Members
  window.stream.addEventListener('member_join', (event)=>{
    let data = JSON.parse(event.data);
    if (window.keys[data.channel_id]) {
      let last = Object.keys(window.keys[data.channel_id]).reduce((a, b) => window.keys[data.channel_id][a]?.expires_at > window.keys[data.channel_id][b]?.expires_at ? a : b, '');
      if (last) window.keys[data.channel_id][last].expires_at = Date.now();
    }
    if (!window.channelMembers[data.channel_id]) return;
    window.channelMembers[data.channel_id].push(data.user);
    let idx = window.channelMembers[data.channel_id].length-1;
    let perm = Number(data.permissions)&OwnerAlt;
    if (hasPerm(perm,Permissions.OWNER)) perm = OwnerAlt;
    if (hasPerm(perm,Permissions.ADMIN)&&!hasPerm(perm,Permissions.OWNER)) perm = AdminAlt;
    window.channelMembers[data.channel_id][idx].permissions = perm;
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
    if (!window.channelMembers[data.channel_id]||window.channelMembers[data.channel_id].length<1) return;
    let idx = window.channelMembers[data.channel_id].findIndex(mem=>mem.username===data.username);
    window.channelMembers[data.channel_id][idx].permissions = data.permissions;
  });
  window.stream.addEventListener('member_leave', (event)=>{
    let data = JSON.parse(event.data);
    if (data.user.username===window.username) {
      window.channels = window.channels.filter(ch=>ch.id!==data.channel_id);
      delete window.channelMembers[data.channel_id];
      showChannels(window.channels);
      return;
    }
    if (window.keys[window.currentChannel]) {
      let last = Object.keys(window.keys[channel]).reduce((a, b) => window.keys[channel][a]?.expires_at > window.keys[channel][b]?.expires_at ? a : b, '');
      if (last) window.keys[channel][last].expires_at = Date.now();
    }
    if (!window.channelMembers[data.channel_id]) return;
    window.channelMembers[data.channel_id] = window.channelMembers[data.channel_id].filter(mem=>mem.username!==data.user.username);
    if (window.currentChannel===data.channel_id) showMembers(data.channel_id);
  });
  // Messages
  window.stream.addEventListener('message_sent', async(event)=>{
    let data = JSON.parse(event.data);
    if (window.messages[data.channel_id]) window.messages[data.channel_id].unshift(data.message);
    let idx = window.channels.findIndex(ch=>ch.id===data.channel_id);
    window.channels.unshift(window.channels.splice(idx,1)[0]);
    if (window.currentChannel===data.channel_id) {
      if (window.messages[data.channel_id]) showMessages(window.messages[data.channel_id]);
      window.channels[0].unread_count = 0;
      if (data.message.user.username!==window.username) backendfetch('/api/v1/channel/'+data.channel_id+'/messages/ack', { method: 'POST' });
    } else {
      if (data.message.user.username===window.username) {
        window.channels[0].unread_count = 0;
      } else {
        window.channels[0].unread_count += 1;
      }
      if (data.message.key&&data.message.iv) {
        let idx2 = window.messages[data.channel_id].findIndex(msg=>msg.id===data.message.id);
        window.messages[data.channel_id][idx2].content = await decodeMessage(data.message, data.channel_id);
        window.messages[data.channel_id][idx2].iv = null;
      }
    }
    window.channels[0].last_message = {
      id: sanitizeMinimChars(data.message.id),
      content: sanitizeHTML(data.message.content||'')||imageicon,
      author: sanitizeHTML(data.message.user.display??sanitizeMinimChars(data.message.user.username||'Unknown')),
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
}

// User
window.deletesession = (id)=>{
  backendfetch('/api/v1/me/session/'+id, {
    method: 'DELETE'
  })
    .then(res=>window.viewsessions());
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
  <span>${ses.browser} · ${ses.device}</span>
  ${ses.current?'<span lang="user.currentsession">(current)</span>':`<button onclick="window.deletesession('${sanitizeMinimChars(ses.id)}')">x</button>`}
</div>`)
        .join('');
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
  <span>${sanitizeHTML(usr.display??sanitizeMinimChars(usr.username))}</span>
  <button onclick="window.unblockmember('${sanitizeMinimChars(usr.username)}')">x</button>
</div>`)
        .join('')||'<span lang="user.noblocks">No blocked users</span>';
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
      .then(res=>{window.useredit()});
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
      .then(res=>{window.useredit()});
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
    window.username = sanitizeMinimChars(me.username);
    localStorage.setItem(window.currentServer+'-username', sanitizeMinimChars(me.username));
    document.querySelector('#user img').src = me.pfp?pfpById(me.pfp):userToDefaultPfp(me);
    document.querySelector('#user img').setAttribute('title', me.username);
    document.getElementById('ue-display').value = me.display??'';
    document.getElementById('ue-display').placeholder = me.username??'';
    document.querySelector('#edit-user img').src = me.pfp?pfpById(me.pfp):userToDefaultPfp(me);
  }
  getChannels();
};

// Split
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
  backendfetch('/api/v1/me', { passstatus: true })
    .then(me=>{showuserdata(me)});

  // Channel list
  getChannels();

  // Stream
  startStrem();
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
function postLogin() {
  // Tippy
  tippy(document.getElementById('user'), {
    allowHTML: true,
    content: `<button onclick="window.useredit()" lang="user.edit">Edit</button>
<button onclick="window.viewblocks()" lang="user.blocks">Blocks</button>
<button onclick="window.viewsessions()" lang="user.sessions">Sessions</button>
<button onclick="logout()" lang="user.logout">Log out</button>`,
    interactive: true,
    trigger: 'click',
    placement: 'bottom-start',
    sticky: true
  });
  tippy(document.getElementById('channel-add'), {
    allowHTML: true,
    content: (window.serverData[window.currentServer]?.disable_channel_creation?'':`<button onclick="window.createChannel(1)" lang="channel.newdm">Message User</button>
<button onclick="window.createChannel(2)" lang="channel.newgroup">Create Group</button>
<button onclick="window.createChannel(3)" lang="channel.newbroadcast">Create Broadcast</button>`)+
`<button onclick="window.joinChannel()" lang="channel.joingroup">Join Group</button>`,
    interactive: true,
    trigger: 'click',
    placement: 'bottom-end',
    sticky: true
  });
  tippy(document.getElementById('btn-settings'), {
    allowHTML: true,
    content: `<span>
  <label for="s-theme" lang="settings.theme">Theme:</label>
  <input type="color" id="s-theme" oninput="document.querySelector('body').style.setProperty('--accent',this.value);localStorage.setItem('ptheme',this.value)" value="${localStorage.getItem('ptheme')??'#221111'}">
</span>
<span>
  <label for="s-font" lang="settings.font">Font:</label>
  <select id="s-font">
    <option value="lexend">Lexend</option>
    <option value="arial">Arial</option>
    <option value="dyslexic">Open Dyslexic</option>
    <option value="system">System</option>
  </select>
</span>
<span>
  <label for="s-rtl" lang="settings.rtl">RTL:</label>
  <input id="s-rtl" type="checkbox" onchange="document.querySelector('body').style.setProperty('direction',this.checked?'rtl':'');localStorage.setItem('rtl',this.checked)"${localStorage.getItem('prtl')==='true'?' checked':''}>
</span>`,
    interactive: true,
    trigger: 'click',
    placement: 'top-start',
    sticky: true,
    onMount: ()=>{
      document.getElementById('s-font').value = localStorage.getItem('pfont')??'lexend';
      document.getElementById('s-font').onchange = (evt)=>{
        document.querySelector('body').style.setProperty('--font',vts[evt.target.value]??vts.lexend);
        localStorage.setItem('pfont', evt.target.value);
      };
    }
  });
  tippy(document.getElementById('btn-languages'), {
    allowHTML: true,
    content: '<span lang="lang.change">Change language</span>'+Array.from(new Set(Object.values(languages)))
      .map(lang=>`<button onclick="localStorage.setItem('language','${lang}');window.translate()">${getLanguageName(lang)}</button>`)
      .join('')+'<span><label lang="lang.timeuilang" for="timeuilang">Time uses ui locale</label><input id="timeuilang" type="checkbox" onchange="localStorage.setItem(`timeUILang`,this.checked)"></span>',
    interactive: true,
    trigger: 'click',
    placement: 'top-end',
    sticky: true,
    onMount: ()=>{document.getElementById('timeuilang').checked=localStorage.getItem('timeUILang')==='true'}
  });

  // Stuff that needs to run before other stuff
  fetch('./media/default-pfp.svg')
    .then(img=>img.text())
    .then(async(img)=>{
      window.defaultpfp = img;
      if (!window.serverData[window.currentServer]) {
        let dat = await fetch(window.currentServer+'/api/v1');
        dat = await dat.json();
        window.serverData[window.currentServer] = dat;
      }
      messageInput.setAttribute('maxlength', window.serverData[window.currentServer]?.messages?.max_message_length??2000);
      loadMain();
    });
}
window.postLogin = postLogin;