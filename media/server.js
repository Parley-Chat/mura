document.getElementById('server').onchange = function(){
  let _this = document.getElementById('server');
  _this.setAttribute('invalid', true)
  fetch(_this.value+'/api/v1')
    .then(res=>res.json())
    .then(res=>{
      window.serverData[_this.value] = res;
      if (res.running==='Parley'&&res.version===version){
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
  const serverList = JSON.parse(localStorage.getItem('servers'));
  if (!document.querySelector('#server-list button[selected]')) document.getElementById('server-select').setAttribute('disabled', true);
  document.getElementById('server-list').innerHTML = serverList.map(srv=>`<button data-url="${encodeURIComponent(srv)}"${document.querySelector(`#server-list button[data-url="${encodeURIComponent(srv)}"][selected]`)?' selected':''}${onlineServers[srv]?' online':''}>${sanitizeHTML(srv)} ${extraServers[srv]?.dev?'<span title="This is a dev server">⚠️</span>':''}${extraServers[srv]?.vermiss?'<span title="There is a version missmatch">❌</span>':''}</button>`).join('');
  document.querySelectorAll('#server-list button').forEach(btn=>{
    btn.onclick = function(){
      document.querySelector('#server-list button[selected]')?.removeAttribute('selected');
      btn.setAttribute('selected', true);
      document.getElementById('server-select').removeAttribute('disabled');
    }
  })
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
          onlineServers[srv] = (res.running==='Parley'&&res.version===version);
          extraServers[srv] = { dev: res.dev??false, vermiss: res.version!==version };
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
  localStorage.setItem('servers', JSON.stringify(sl));
  showServerList();
};
document.getElementById('server-select').onclick = function(){
  if (typeof document.getElementById('server-select').getAttribute('disabled')==='string') return;
  window.currentServer = decodeURIComponent(document.querySelector('#server-list button[selected]').getAttribute('data-url'));
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
      if (testFetchSelf.running!=='Parley'||testFetchSelf.version!==window.version) throw new Error('Result is false');
      localStorage.setItem('servers', JSON.stringify([location.protocol+'//'+window.location.host+path]));
    } catch(err) {
      localStorage.setItem('servers', '[]');
    }
  }
  showServerList();
  document.getElementById('server-modal').showModal();
})();