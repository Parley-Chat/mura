document.getElementById('login-modal').onclose = document.getElementById('signup-modal').onclose = document.getElementById('signup-password').onclose = (evt) => {
  evt.preventDefault();
};
document.getElementById('instead-btn').onclick = function() {
  let errors = document.getElementById('l-errors');
  let logining = document.querySelector('[tlang="login.title"]');
  document.querySelector(`[tlang="${logining?'login':'signup'}.title"]`).setAttribute('tlang', `${logining?'signup':'login'}.title`);
  document.querySelector(`[tlang="${logining?'login':'signup'}.button"]`).setAttribute('tlang', `${logining?'signup':'login'}.button`);
  this.setAttribute('tlang', `${logining?'signup':'login'}.instead`);
  document.getElementById('s-hide').style.display = logining?'none':'';
  errors.setAttribute('tlang', 'empty');
  document.getElementById('l-username').removeAttribute('invalid');
}

let TypingTimer = null;
document.getElementById('l-username').oninput = function(evt) {
  clearTimeout(TypingTimer);
  evt.target.value = evt.target.value.toLowerCase();
  TypingTimer = setTimeout(()=>{
    if (document.querySelector('[tlang="login.title"]')) {
      evt.target.removeAttribute('invalid');
      return;
    }
    let errors = document.getElementById('l-errors');
    if (!(/^[a-z0-9_\-]{3,20}$/).test(evt.target.value)) {
      errors.setAttribute('tlang', 'error.username');
      evt.target.setAttribute('invalid', true);
      return;
    }
    fetch(getCurrentServerUrl()+'/api/v1/username_check?username='+evt.target.value)
      .then(res=>{
        if (res.status===200) {
          errors.setAttribute('tlang', 'empty');
          evt.target.removeAttribute('invalid');
        } else {
          errors.setAttribute('tlang', 'error.usernameuse');
          evt.target.setAttribute('invalid', true);
        }
      });
  }, 1000);
}

let LoginFileContents = {};
document.getElementById('l-keyfile').onchange = function(evt) {
  const file = evt.target.files[0];
  if (!file) {
    LoginFileContents = {};
    return;
  }

  const reader = new FileReader();
  reader.onload = function(res){
    try {
      LoginFileContents = JSON.parse(res.target.result);
    } catch(err) {
      LoginFileContents = {};
    }
  };
  reader.onerror = function(err){
    LoginFileContents = {};
  };
  reader.readAsText(file);
};

document.getElementById('login-btn').onclick = async function(){
  const errors = document.getElementById('l-errors');
  if (!document.getElementById('l-username').checkValidity() || document.getElementById('l-username').getAttribute('invalid')) {
    errors.setAttribute('tlang','error.username');
    return;
  }
  let logining = document.querySelector('[tlang="login.title"]');
  if (logining) {
    if (!document.getElementById('l-passkey').checkValidity()) {
      errors.setAttribute('tlang','error.passkey');
      return;
    }
    if (!document.getElementById('l-keyfile').checkValidity()) {
      errors.setAttribute('tlang','error.keyfile');
      return;
    }
    if (!LoginFileContents.publicKey||!LoginFileContents.privateKey) {
      errors.setAttribute('tlang','error.keyfile');
      return;
    }
    if (!(/^[a-zA-Z0-9\+\/=]+$/m).test(LoginFileContents.publicKey)) {
      errors.setAttribute('tlang','error.keyfile');
      return;
    }
    if (!(/^[a-zA-Z0-9\+\/=]+$/m).test(LoginFileContents.privateKey)) {
      errors.setAttribute('tlang','error.keyfile');
      return;
    }
    localStorage.setItem(window.currentServer+'-publicKey', LoginFileContents.publicKey);
    localStorage.setItem(window.currentServer+'-privateKey', LoginFileContents.privateKey);
  }
  errors.innerText = '';

  let publickey = '';
  if (logining) {
    publickey = LoginFileContents.publicKey;
  } else {
    await newRSAKeys();
    await getRSAKeyPair();
    publickey = localStorage.getItem(window.currentServer+'-publicKey');
  }

  let formData = new FormData();
  formData.append('username', document.getElementById('l-username').value);
  if (logining) formData.append('passkey', document.getElementById('l-passkey').value);
  formData.append('public', publickey);
  if (!logining&&(serverData[getCurrentServerUrl()]?.password_protected||false)) formData.append('password', localStorage.getItem(getCurrentServerUrl()+'-password'));

  fetch(getCurrentServerUrl()+`/api/v1/${logining?'login':'signup'}`, {
    method: 'POST',
    body: formData
  })
    .then(async(res) => {
      if (res.status===400) {
        errors.setAttribute('tlang','error.'+(logining?'publicmismatch':'usernameuse'));
        return;
      }
      if (res.status===401) {
        errors.setAttribute('tlang','error.'+(logining?'invalidcredentials':'usernameuse'));
        return;
      }
      if (res.status===403) {
        localStorage.removeItem(getCurrentServerUrl()+'-password');
        document.getElementById('login-modal').close();
        document.getElementById('signup-password').showModal();
        document.querySelector('#signup-password button').onclick = ()=>{
          localStorage.setItem(getCurrentServerUrl()+'-password', document.querySelector('#signup-password input').value);
          document.getElementById('signup-password').close();
          document.getElementById('login-modal').showModal();
        };
        return;
      }
      if (res.status!==200 || !res.ok) {
        errors.setAttribute('tlang','error.generic');
        return;
      }

      let body = await res.json();
      solveChallenge(body.challenge, body.id, (data)=>{
        document.getElementById('login-modal').close();

        if (data.passkey) {
          document.getElementById('s-passkey').value = data.passkey;
          document.getElementById('l-passkey').value = data.passkey;
          document.getElementById('s-passkey-copy').onclick = ()=>{
            document.getElementById('s-passkey').select();
            navigator.clipboard.writeText(data.passkey);
          };
          const blob = new Blob([JSON.stringify({
            publicKey: localStorage.getItem(window.currentServer+'-publicKey'),
            privateKey: localStorage.getItem(window.currentServer+'-privateKey')
          })], { type: 'text/plain' });
          document.getElementById('s-download').href = URL.createObjectURL(blob);
          document.getElementById('s-download').download = document.getElementById('l-username').value+'.keys';
          let modal = document.getElementById('signup-modal');
          modal.showModal();
          let doneBtn = document.getElementById('s-done');
          doneBtn.onclick = ()=>{};
          doneBtn.setAttribute('disabled','');
          doneBtn.removeAttribute('tlang');
          doneBtn.innerText = '...';
          setTimeout(()=>{doneBtn.innerText = '..';}, 1000);
          setTimeout(()=>{doneBtn.innerText = '.';}, 2000);
          setTimeout(()=>{
            doneBtn.setAttribute('tlang','signup.done');
            window.translate();
            doneBtn.removeAttribute('disabled');
            doneBtn.onclick = ()=>{
              modal.close();
              window.postLogin();
            };
          }, 3000);
        } else {
          window.postLogin();
        }
      })
    });
};

function postServerSelect() {
  if (loggedIn()) {
    getRSAKeyPair();
    window.postLogin();
  } else {
    if ((serverData[getCurrentServerUrl()]?.password_protected||false)&&!localStorage.getItem(getCurrentServerUrl()+'-password')) {
      document.getElementById('signup-password').showModal();
      document.querySelector('#signup-password button').onclick = ()=>{
        localStorage.setItem(getCurrentServerUrl()+'-password', document.querySelector('#signup-password input').value);
        document.getElementById('signup-password').close();
        document.getElementById('login-modal').showModal();
      };
    } else {
      document.getElementById('login-modal').showModal();
    }
  }
}
window.postServerSelect = postServerSelect;