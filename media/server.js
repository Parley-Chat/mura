let onlineServers = {};
let extraServers = {};
window.servers = JSON.parse(localStorage.getItem('servers'))??[];

function normalizeServer(url) {
  return url.replaceAll(/\/+$/g,'');
}
async function checkServer(url) {
  url = normalizeServer(url);
  if (onlineServers[url]!==undefined) return onlineServers[url];
  onlineServers[url] = false;

  let res;
  try {
    res = await fetch(url+'/api/v1', {
      redirect: 'follow'
    })
    res = await res.json();
  } catch(err) {
    res = {};
  }
  window.serverData[url] = res;
  onlineServers[url] = (res.running==='Parley'&&backendVersions.includes(res.version));
  extraServers[url] = { dev: res.dev??false, vermiss: !backendVersions.includes(res.version) };
  return onlineServers[url];
}

let curServerTime = null;
const ServerInput = document.getElementById('server');
ServerInput.onchange = ServerInput.oninput = function(){
  if (curServerTime) clearTimeout(curServerTime);
  ServerInput.setAttribute('invalid', true);
  if (ServerInput.value==='') return;
  curServerTime = setTimeout(()=>{
    checkServer(ServerInput.value)
      .then(valid=>{
        ServerInput[valid?'removeAttribute':'setAttribute']('invalid', true);
      });
  }, 10);
};

function showServerList() {
  if (!document.querySelector('#server-list > span[selected]')) document.getElementById('server-select').setAttribute('disabled', true);
  document.getElementById('server-list').innerHTML = window.servers
    .map(srv=>`<span data-id="${srv.id}" data-url="${encodeURIComponent(srv.url)}"${onlineServers[srv.url]?' online':''}${document.querySelector('#server-list > span[selected]')?.getAttribute('data-id')===srv.id?' selected':''}>
  <button${document.querySelector(`#server-list > span[data-url="${encodeURIComponent(srv.url)}"][selected]`)?' selected':''}>
    <span>${sanitizeHTML(srv.url)}</span>
    <span style="font-size:90%" class="extra">
      ${srv.name?`<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M128 128C163.346 128 192 99.3462 192 64C192 28.6538 163.346 0 128 0C92.6538 0 64 28.6538 64 64C64 99.3462 92.6538 128 128 128ZM151 146H148H108H105C49.7715 146 5 190.772 5 246V256H108H148H251V246C251 190.772 206.228 146 151 146Z"/></svg>${sanitizeMinimChars(srv.name)}`:''}
      ${extraServers[srv.url]?.dev?'<span tlang="servers.dev">⚠️ Dev server</span>':''}
      ${extraServers[srv.url]?.vermiss?'<span tlang="servers.mismatch">❌ Version mismatch</span>':''}
    </span>
  </button>
  <button class="del"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256"><path d="M42.6776 7.32227C32.9145 -2.44063 17.0852 -2.44077 7.32214 7.32227C-2.44082 17.0853 -2.44069 32.9146 7.32214 42.6777L92.2616 127.617L7.32214 212.557C-2.44091 222.32 -2.44083 238.149 7.32214 247.912C17.0852 257.675 32.9145 257.675 42.6776 247.912L127.617 162.973L212.557 247.912C222.32 257.675 238.149 257.675 247.912 247.912C257.675 238.149 257.675 222.32 247.912 212.557L162.973 127.617L247.912 42.6777C257.675 32.9146 257.675 17.0853 247.912 7.32227C238.149 -2.44079 222.32 -2.44068 212.557 7.32227L127.617 92.2617L42.6776 7.32227Z"/></svg></button>
</span>`)
    .join('');
  document.querySelectorAll('#server-list > span').forEach(spn=>{
    spn.querySelector('button').onclick = ()=>{
      document.querySelector('#server-list > span[selected]')?.removeAttribute('selected');
      spn.setAttribute('selected', true);
      document.getElementById('server-select').removeAttribute('disabled');
    };
    spn.querySelector('button.del').onclick = ()=>{
      let id = decodeURIComponent(spn.getAttribute('data-id'));
      window.servers = window.servers.filter(srv=>srv.id!==id);
      localStorage.setItem('servers', JSON.stringify(window.servers));
      localStorage.removeItem(id+'-publicKey');
      localStorage.removeItem(id+'-privateKey');
      localStorage.removeItem(id+'-sessionToken');
      localStorage.removeItem(id+'-lc');
      showServerList();
    };
  });
}
document.getElementById('server-add').onclick = function(){
  if (typeof ServerInput.getAttribute('invalid')==='string') return;
  window.servers.push({
    id: Math.floor(Math.random()*(16**8)).toString(16),
    name: null,
    url: normalizeServer(ServerInput.value)
  });
  ServerInput.value = '';
  localStorage.setItem('servers', JSON.stringify(window.servers));
  showServerList();
};
let checkOnlineInter;
document.getElementById('server-select').onclick = function(){
  if (typeof document.getElementById('server-select').getAttribute('disabled')==='string') return;
  window.currentServer = document.querySelector('#server-list > span[selected]').getAttribute('data-id');
  document.getElementById('server-modal').close();
  clearInterval(checkOnlineInter);
  localStorage.setItem('pls', window.currentServer);
  window.postServerSelect();
};

document.getElementById('server-modal').onclose = (evt) => {
  evt.preventDefault();
};

window.currentServer = '';
(async()=>{
  if (!localStorage.getItem('servers')) {
    try {
      let path = (window.location.pathname.split('/').filter(p=>p.length).length===1)?window.location.pathname:'';
      let testFetchSelf = await fetch(location.protocol+'//'+window.location.host+path+'/api/v1');
      testFetchSelf = await testFetchSelf.json();
      if (testFetchSelf.running!=='Parley'||!backendVersions.includes(testFetchSelf.version)) throw new Error('Result is false');
      window.servers = [{
        id: Math.floor(Math.random()*(16**8)).toString(16),
        name: null,
        url: normalizeServer(location.protocol+'//'+window.location.host+path)
      }];
    } catch(err) {
      window.servers = [];
    }
  } else {
    if (window.servers.length>0&&(typeof window.servers[0]==='string')) {
      window.servers = window.servers.map(srv=>{
        let n = {
          id: Math.floor(Math.random()*(16**8)).toString(16),
          name: localStorage.getItem(srv+'-username')??null,
          url: normalizeServer(srv)
        };
        if (localStorage.getItem(srv+'-publicKey')) localStorage.setItem(n.id+'-publicKey', localStorage.getItem(srv+'-publicKey'));
        if (localStorage.getItem(srv+'-privateKey')) localStorage.setItem(n.id+'-privateKey', localStorage.getItem(srv+'-privateKey'));
        if (localStorage.getItem(srv+'-sessionToken')) localStorage.setItem(n.id+'-sessionToken', localStorage.getItem(srv+'-sessionToken'));
        localStorage.removeItem(srv+'-publicKey');
        localStorage.removeItem(srv+'-privateKey');
        localStorage.removeItem(srv+'-sessionToken');
        localStorage.removeItem(srv+'-username');
        return n;
      });
    }
  }
  localStorage.setItem('servers', JSON.stringify(window.servers));
  let lastSrv = localStorage.getItem('pls');
  if (lastSrv&&localStorage.getItem('prs')==='true'&&window.servers[0]&&window.servers.find(srv=>srv.id===lastSrv)&&localStorage.getItem(lastSrv+'-sessionToken')) {
    window.currentServer = lastSrv;
    clearInterval(checkOnlineInter);
    window.postServerSelect();
    return;
  }
  showServerList();
  document.getElementById('server-modal').showModal();
})();

checkOnlineInter = setInterval(()=>{
  let con = false;
  window.servers.forEach(srv=>{
    if (con) return;
    if (onlineServers[srv.url]===undefined) {
      con = true;
      checkServer(srv.url)
        .then(online=>{
          document.querySelectorAll('#server-list span[data-url="'+encodeURIComponent(srv.url)+'"]')
            .forEach(entry=>{
              if (online) entry.setAttribute('online','');
              if (extraServers[srv.url]?.dev) entry.querySelector('.extra').insertAdjacentHTML('beforeend','<span tlang="servers.dev">⚠️ Dev server</span>');
              if (extraServers[srv.url]?.vermiss) entry.querySelector('.extra').insertAdjacentHTML('beforeend','<span tlang="servers.mismatch">❌ Version mismatch</span>');
              window.translate();
            });
        });
      return;
    }
  });
  if (!con) clearInterval(checkOnlineInter);
}, 200);