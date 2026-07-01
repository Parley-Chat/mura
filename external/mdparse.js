// MDParse, Fsh-org 2026 ©
window.MDParse = (text, custom=(t)=>t)=>{
  // Reserve
  let reserve = {};
  function reservemd(txt) {
    let id = Math.floor(Math.random()*Math.pow(10,16)).toString(10).padStart(16, '0');
    reserve[id] = txt;
    return `¬r${id}¬r`;
  }
  // Basic escaping
  text = text
    .replaceAll('<', '~lt;')
    .replaceAll('"', '~quot;');
  // Elements that need reserve
  text = text
    .replaceAll(/```([^¬]|¬)*?```/g, (match)=>{
      match = match
        .slice(3,-3)
        .replaceAll('&', '&amp;')
        .replaceAll('~lt;', '&lt;')
        .replaceAll('~quot;', '&quot;');
      return reservemd(`<code class="block">${match}</code>`);
    })
    .replaceAll(/\[(.+?)\]\((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*))\)/g, (match,g1,g2)=>reservemd(`<a href="${g2}" target="_blank">${g1}</a>`))
    .replaceAll(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g, (match)=>reservemd(`<a href="${match}" target="_blank">${match}</a>`));
  // More escaping
  text = text
    .replaceAll('&', '&amp;')
    .replaceAll('~lt;', '&lt;')
    .replaceAll('~quot;', '&quot;')
    .replaceAll("'", '&apos;');
  // Custom
  text = custom(text);
  // General
  text = text
    .replaceAll(/\`.+?\`/g, (match)=>`<code>${reservemd(match.slice(1,-1))}</code>`) // Inline code
    .replaceAll(/\*\*.+?\*\*/g, (match)=>`<b>${match.slice(2,-2)}</b>`) // Bold
    .replaceAll(/\*.+?\*/g, (match)=>`<i>${match.slice(1,-1)}</i>`) // Italic 1
    .replaceAll(/\_\_.+?\_\_/g, (match)=>`<u>${match.slice(2,-2)}</u>`) // Underline
    .replaceAll(/\_.+?\_/g, (match)=>`<i>${match.slice(1,-1)}</i>`) // Italic 2
    .replaceAll(/\~\~.+?\~\~/g, (match)=>`<s>${match.slice(2,-2)}</s>`) // Strikethrough
    .replaceAll(/\=\=.+?\=\=/g, (match)=>`<mark>${match.slice(2,-2)}</mark>`) // Highlight
    .replaceAll(/\~.+?\~/g, (match)=>`<sub>${match.slice(1,-1)}</sub>`) // Subscript
    .replaceAll(/\^.+?\^/g, (match)=>`<sup>${match.slice(1,-1)}</sup>`) // Superscript
    .replaceAll(/^\> .*?$/gm, (match)=>`<blockquote>${match.slice(2)}</blockquote>`) // Blockquote
    .replaceAll(/^(-|\*) .+?$/gm, (match)=>`<li>${match.slice(2)}</li>`) // List
    .replaceAll(/^### .+?$/gm, (match)=>`<span style="font-size:110%">${match.slice(4)}</span>`) // 3rd heading
    .replaceAll(/^## .+?$/gm, (match)=>`<span style="font-size:125%">${match.slice(3)}</span>`) // 2nd heading
    .replaceAll(/^# .+?$/gm, (match)=>`<span style="font-size:150%">${match.slice(2)}</span>`) // 1st heading
    .replaceAll(/^-# .+?$/gm, (match)=>`<span style="font-size:80%;color:var(--text-2);">${match.slice(3)}</span>`); // -1st heading

  // Reserve
  text = text.replaceAll(/¬r[0-9]{16}¬r/g, function(match){
    let id = match.split('¬r')[1];
    if (reserve[id]) return reserve[id];
    return match;
  });

  return text;
};