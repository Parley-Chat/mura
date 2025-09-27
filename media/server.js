document.getElementById('server').onchange = function(){
  let _this = document.getElementById('server');
  _this.setAttribute('invalid', true)
  fetch(_this.value+'/api/v1')
    .then(res=>res.json())
    .then(res=>{
      window.serverData[_this.value] = res;
      if (res.running==='Parley'&&backendVersions.includes(res.version)){
        _this.removeAttribute('invalid')
      } else {
        throw new Error('Missmatch');
      }
    })
    .catch(_err=>_this.setAttribute('invalid', true));
};

let onlineServers = {};
let extraServers = {};
function showServerList() {
  const serverList = JSON.parse(localStorage.getItem('servers'))??[];
  if (!document.querySelector('#server-list > span[selected]')) document.getElementById('server-select').setAttribute('disabled', true);
  document.getElementById('server-list').innerHTML = serverList
    .map(srv=>`<span data-url="${encodeURIComponent(srv)}"${onlineServers[srv]?' online':''}${document.querySelector('#server-list > span[selected]')?.getAttribute('data-url')===encodeURIComponent(srv)?' selected':''}>
  <button${document.querySelector(`#server-list > span[data-url="${encodeURIComponent(srv)}"][selected]`)?' selected':''}>
    <span>${sanitizeHTML(srv)}</span>
    <span>
      ${localStorage.getItem(srv+'-username')?`<span style="font-size:90%"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 256 256"><path fill-rule="evenodd" clip-rule="evenodd" d="M128 128C163.346 128 192 99.3462 192 64C192 28.6538 163.346 0 128 0C92.6538 0 64 28.6538 64 64C64 99.3462 92.6538 128 128 128ZM151 146H148H108H105C49.7715 146 5 190.772 5 246V256H108H148H251V246C251 190.772 206.228 146 151 146Z"/></svg>${sanitizeMinimChars(localStorage.getItem(srv+'-username'))}</span>`:''}
      ${extraServers[srv]?.dev?'<span title="This is a dev server">⚠️</span>':''}
      ${extraServers[srv]?.vermiss?'<span title="There is a version missmatch">❌</span>':''}
    </span>
  </button>
  <button class="del">x</button>
</span>`)
    .join('');
  document.querySelectorAll('#server-list > span').forEach(spn=>{
    spn.querySelector('button').onclick = ()=>{
      document.querySelector('#server-list > span[selected]')?.removeAttribute('selected');
      spn.setAttribute('selected', true);
      document.getElementById('server-select').removeAttribute('disabled');
    };
    spn.querySelector('button.del').onclick = ()=>{
      let sl = JSON.parse(localStorage.getItem('servers'));
      let url = decodeURIComponent(spn.getAttribute('data-url'));
      sl = sl.filter(s=>s!==url);
      localStorage.setItem('servers', JSON.stringify(sl));
      showServerList();
    };
  });
}
let checkOnlineInter = setInterval(()=>{
  const serverList = JSON.parse(localStorage.getItem('servers'))??[];
  let con = false;
  serverList.forEach(srv=>{
    if (con) return;
    if (onlineServers[srv]===undefined) {
      con = true;
      onlineServers[srv] = false;
      fetch(srv+'/api/v1', {
        redirect: 'follow'
      })
        .then(res=>res.json())
        .then(res=>{
          window.serverData[srv] = res;
          onlineServers[srv] = (res.running==='Parley'&&backendVersions.includes(res.version));
          extraServers[srv] = { dev: res.dev??false, vermiss: !backendVersions.includes(res.version) };
          showServerList();
        });
      return;
    }
  });
}, 200);
document.getElementById('server-add').onclick = function(){
  if (typeof document.getElementById('server').getAttribute('invalid')==='string') return;
  let sl = JSON.parse(localStorage.getItem('servers'));
  let val = document.getElementById('server').value;
  if (sl.includes(val)) return;
  sl.push(val);
  document.getElementById('server-add').value = '';
  localStorage.setItem('servers', JSON.stringify(sl));
  showServerList();
};
document.getElementById('server-select').onclick = function(){
  if (typeof document.getElementById('server-select').getAttribute('disabled')==='string') return;
  window.currentServer = decodeURIComponent(document.querySelector('#server-list > span[selected]').getAttribute('data-url'));
  document.getElementById('server-modal').close();
  clearInterval(checkOnlineInter);
  window.postServerSelect();
};

document.getElementById('server-modal').addEventListener('cancel', (evt) => {
  evt.preventDefault();
  setTimeout(()=>{document.getElementById('server-modal').showModal()}, 0);
});

window.currentServer = '';
(async()=>{
  if (!localStorage.getItem('servers')) {
    try {
      let path = (window.location.pathname.split('/').filter(p=>p.length).length===1)?window.location.pathname:'';
      let testFetchSelf = await fetch(location.protocol+'//'+window.location.host+path+'/api/v1');
      testFetchSelf = await testFetchSelf.json();
      if (testFetchSelf.running!=='Parley'||!backendVersions.includes(testFetchSelf.version)) throw new Error('Result is false');
      localStorage.setItem('servers', JSON.stringify([location.protocol+'//'+window.location.host+path]));
    } catch(err) {
      localStorage.setItem('servers', '[]');
    }
  }
  showServerList();
  document.getElementById('server-modal').showModal();
})();