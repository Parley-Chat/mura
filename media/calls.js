let display;
let currentCallCh = '';
let mediaStream;
let peerConnection;
let queue = [];
let gc = [];

let answered = false;

const micIcons = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="83" y="0.00195312" width="90" height="150" rx="45"/><path d="M53 95.002V105.002C53 146.423 86.5786 180.002 128 180.002C169.421 180.002 203 146.423 203 105.002V95.002" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M128 180.002V240.002" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M153 241.002H103" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M58 235.002L198 20.002" stroke-width="40" stroke-linecap="round" fill="none"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="83" width="90" height="150" rx="45"/><path d="M53 95V105C53 146.421 86.5786 180 128 180C169.421 180 203 146.421 203 105V95" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M128 180V240" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M153 241H103" stroke-width="30" stroke-linecap="round" fill="none"/></svg>'
];
const camIcons = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M170 43.002C181.046 43.002 190 51.9563 190 63.002V81.4864C190 82.782 191.213 83.7357 192.472 83.4299L246.112 70.4033C251.148 69.1805 256 72.9955 256 78.1777V177.656C256 182.892 251.054 186.716 245.987 185.398L192.503 171.492C191.237 171.162 190 172.118 190 173.427V193.002C190 204.048 181.046 213.002 170 213.002H20C8.95431 213.002 4.02687e-08 204.048 0 193.002V63.002C0 51.9563 8.95431 43.002 20 43.002H170Z"/><path d="M58 235.002L198 20.002" stroke-width="40" stroke-linecap="round" fill="none"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><path d="M170 43C181.046 43 190 51.9543 190 63V81.4845C190 82.7801 191.213 83.7337 192.472 83.428L246.112 70.4014C251.148 69.1785 256 72.9935 256 78.1758V177.654C256 182.89 251.054 186.714 245.987 185.396L192.503 171.49C191.237 171.16 190 172.116 190 173.425V193C190 204.046 181.046 213 170 213H20C8.95431 213 4.02687e-08 204.046 0 193V63C0 51.9543 8.95431 43 20 43H170Z"/></svg>'
];

function showConnections() {
  if (!display) return;
  backendfetch(`/api/v1/channel/${window.currentChannel}/call`)
    .then(res=>{
      if (!res.active) return;
      display.querySelector('.grid').innerHTML = res.participants
        .map(m=>`<img src="${m.pfp?pfpById(m.pfp):userToDefaultPfp(m)}">`)
        .join('');
    });
}

async function connect(min=false) {
  if (peerConnection) return;
  // Connect
  let servers = [{urls: window.serverData[getCurrentServerUrl()].calls.stun_servers}];
  if (window.serverData[getCurrentServerUrl()].calls.turn_servers.length) servers.push({
    urls: window.serverData[getCurrentServerUrl()].calls.turn_servers,
    username: window.serverData[getCurrentServerUrl()].calls.turn_username,
    credential: window.serverData[getCurrentServerUrl()].calls.turn_password
  });
  peerConnection = new RTCPeerConnection({
    iceCandidatePoolSize: 8,
    iceServers: servers,
    iceTransportPolicy: 'all'
  });

  if (mediaStream) {
    mediaStream.getTracks().forEach(track=>{
      peerConnection.addTrack(track, mediaStream);
    });
  }

  peerConnection.onicecandidate = (evt)=>{
    if (!evt.candidate) return;
    backendfetch(`/api/v1/channel/${currentCallCh}/call/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ice', data: evt.candidate })
    });
  };
  peerConnection.ontrack = (evt)=>{
    switch(evt.track.kind) {
      case 'audio':
        if (!evt.streams||!evt.streams[0]) return;
        let audio = new Audio();
        audio.autoplay = true;
        audio.playsinline = true;
        audio.srcObject = evt.streams[0];
        gc.push(audio);
        break;
      case 'video':
        if (!evt.streams||!evt.streams[0]) return;
        let video = document.createElement('video');
        video.style.display = 'none';
        video.autoplay = true;
        video.playsinline = true;
        video.srcObject = evt.streams[0];
        document.body.appendChild(video);
        gc.push(video);
        break;
    }
  };
  peerConnection.onconnectionstatechange = ()=>{
    switch (peerConnection.connectionState) {
      case 'disconnected':
      case 'failed':
      case 'closed':
        leaveCall();
        break;
    }
  };

  for (let i=0;i<queue.length;i++) {
    await handleSignal(queue[i]);
  }
  queue = [];

  showConnections();

  // Offer
  if (min||peerConnection.currentRemoteDescription||peerConnection.signalingState!=='stable') return;
  let offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await backendfetch(`/api/v1/channel/${currentCallCh}/call/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'offer', data: offer })
  });
}

export async function startCall(channel, ans=false) {
  if (currentCallCh===channel) return;
  // Start
  currentCallCh = channel;
  answered = ans;
  display = document.getElementById('call-display');
  display.style.display = '';
  queue = [];
  showConnections();
  // Buttons and media stream
  let micButton = document.getElementById('micButton');
  micButton.setAttribute('tlang', 'channel.call.micro.off');
  micButton.innerHTML = micIcons[1];
  micButton.disabled = true;
  let camButton = document.getElementById('camButton');
  camButton.setAttribute('tlang', 'channel.call.camera.on');
  camButton.innerHTML = camIcons[0];
  camButton.disabled = true;
  try {
    // Audio
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    mediaStream.getAudioTracks()[0].enabled = true;
    micButton.disabled = false;
    // Video (optional)
    try {
      let video = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = video.getVideoTracks()[0];
      mediaStream.addTrack(track);
      mediaStream.getVideoTracks()[0].enabled = false;
      camButton.disabled = false;
    } catch(err) {
      // Ignore :3
    }
  } catch(err) {
    // Ignore :3
  }
  window.toggleMic = ()=>{
    if (!mediaStream) return;
    let audioTrack = mediaStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    micButton.setAttribute('tlang', 'channel.call.micro.'+(audioTrack.enabled?'off':'on'));
    micButton.innerHTML = micIcons[Number(audioTrack.enabled)];
  };
  window.toggleCam = ()=>{
    if (!mediaStream) return;
    let videoTrack = mediaStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    camButton.setAttribute('tlang', 'channel.call.camera.'+(videoTrack.enabled?'off':'on'));
    camButton.innerHTML = camIcons[Number(videoTrack.enabled)];
  };
  // Join call
  await backendfetch(`/api/v1/channel/${channel}/call`, {
    method: 'POST'
  });

  if (answered) {
    connect();
    return;
  }

  setTimeout(()=>{
    if (!answered||!peerConnection||currentCallCh==='') leaveCall();
  }, 2*60*1000); // 2 mins
};
export async function event(type, data) {
  if (data.started_by===window.username) return;
  switch(type) {
    case 'start':
      if (!document.hasFocus()) notify('call_start', data, data.started_by);
      let pick = await affirm('channel.callincoming', data.started_by);
      if (pick) startCall(data.channel_id, true);
      break;
    case 'join':
      showConnections();
      if (data.user.username!==window.username&&!answered) {
        answered = true;
        connect(true);
      }
      break;
    case 'left':
      showConnections();
      break;
  }
}
async function handleSignal(data) {
  switch(data.type) {
    case 'offer':
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.data));
      let answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await backendfetch(`/api/v1/channel/${currentCallCh}/call/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type:'answer', data: answer })
      });
      break;
    case 'answer':
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.data));
      } catch(err) {
        // Ignore :3
      }
      break;
    case 'ice':
      if (!data.data) return;
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.data));
      } catch(err) {
        // Ignore :3
      }
      break;
  }
}
export function signal(data) {
  if (!peerConnection) {
    queue.push(data);
    return;
  }
  handleSignal(data);
}
export function leaveCall() {
  if (currentCallCh==='') return;
  backendfetch(`/api/v1/channel/${currentCallCh}/call`, {
    method: 'DELETE',
    keepalive: true
  })
    .then(()=>{
      currentCallCh = '';
      display.style.display = 'none';
      peerConnection?.close();
      peerConnection = null;
      mediaStream?.getTracks().forEach(track=>track.stop());
      mediaStream = null;
      gc.forEach(garbage=>garbage.remove());
    });
}
window.addEventListener('pagehide', ()=>{
  if (currentCallCh==='') return;
  leaveCall();
});