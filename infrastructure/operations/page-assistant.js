(args => {
  const visible = e => {
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    return r.width>5&&r.height>5&&s.visibility==='visible'&&s.display!=='none'&&!e.closest('[hidden],[aria-hidden=true]');
  };
  const hintFor = e => [e.placeholder,e.getAttribute('data-placeholder'),e.getAttribute('aria-placeholder'),e.getAttribute('aria-label'),e.name,e.id,...Array.from(e.labels??[]).map(l=>l.innerText)].filter(Boolean).join(' ');
  const sensitive = /密码|验证码|手机|电话|邮箱|帐号|账号|password|captcha|verification|one-time-code|phone|email|username|account|token|secret/i;
  const locationLabel = /^(添加|修改|设置|选择|搜索)?(地点|位置|定位)(信息)?[：:]?$|^你在哪里[？?]?$/;
  if(args.mode==='scan') {
    const fields=[],actions=[],choices=[];
    const seen=new Set();
    for(const e of document.querySelectorAll('input,textarea,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]')) {
      if(!visible(e)||e.disabled||e.readOnly||sensitive.test(hintFor(e))||e.tagName==='INPUT'&&!['text','search','url'].includes(e.type))continue;
      if(e.isContentEditable&&e.parentElement?.closest('[contenteditable=true],[contenteditable=""],[contenteditable="plaintext-only"]'))continue;
      const hint=hintFor(e),rich=e.isContentEditable===true;
      let kind=/标题|title|给作品起个名字|添加作品名称/i.test(hint)?'title':/地点|位置|地址|定位|location|address/i.test(hint)?'location':rich||e.tagName==='TEXTAREA'||/正文|描述|内容|介绍|description|content|caption/i.test(hint)?'body':'text';
      // Site-wide search is not a publishing field.
      if(kind==='text'&&/搜索|search/i.test(hint))continue;
      if(kind==='text'&&!hint.trim())continue;
      const label=kind==='title'?'标题':kind==='body'?'正文':kind==='location'?'地点':hint.slice(0,70);
      const id=args.nonce+'-field-'+fields.length;
      e.setAttribute('data-kamen-editor-field',id);
      const limit=e.maxLength>0?Math.min(e.maxLength,20000):20000;
      fields.push({id,kind,label,rich,tag:e.tagName,type:e.type??null,maxLength:limit,value:(rich?e.innerText:e.value).slice(0,limit)});
      if(fields.length>=16)break;
    }
    for(const e of document.querySelectorAll('button,[role=button],[tabindex],label,[class*=location]')) {
      const text=(e.innerText??'').trim();
      if(!visible(e)||e.disabled||!locationLabel.test(text)||seen.has(text))continue;
      seen.add(text);const id=args.nonce+'-action-'+actions.length;e.setAttribute('data-kamen-editor-field',id);
      actions.push({id,label:text});if(actions.length>=3)break;
    }
    if(args.locationOpen&&fields.some(f=>f.kind==='location')) {
      for(const e of document.querySelectorAll('[role=listbox] [role=option],[role=option]')) {
        const label=(e.innerText??'').trim();
        if(!visible(e)||!label||label.length>100||/发布|提交|确认支付|登录|删除/.test(label))continue;
        const id=args.nonce+'-choice-'+choices.length;e.setAttribute('data-kamen-editor-field',id);choices.push({id,label});if(choices.length>=12)break;
      }
    }
    return {url:location.href,fields,actions,choices};
  }
  if(location.href!==args.url)throw Error('Page changed');
  const find = field => {
    const e=document.querySelector('[data-kamen-editor-field="'+field.id+'"]');
    if(!e||!visible(e)||e.disabled||e.readOnly||sensitive.test(hintFor(e)))throw Error('Field changed');
    return e;
  };
  if(args.mode==='verify') {
    const normalize=text=>String(text).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
    const failed=args.fields.filter(f=>{
      try {
        const e=find(f);
        if(e.tagName!==f.tag||(e.type??null)!==f.type||(e.isContentEditable===true)!==f.rich)return true;
        const actual=f.rich?e.innerText:e.value;
        return f.rich?normalize(actual)!==normalize(f.value):actual!==f.value;
      } catch {return true;}
    }).map(f=>({id:f.id,label:f.label}));
    return {ok:failed.length===0,count:args.fields.length-failed.length,failed};
  }
  if(args.mode==='prepare') {
    for(const field of args.fields) {
      const e=find(field);
      if(e.tagName!==field.tag||(e.type??null)!==field.type||(e.isContentEditable===true)!==field.rich||field.value.length>field.maxLength)throw Error('Field changed');
    }
    return {ok:true};
  }
  if(args.mode==='focus-field') {
    const field=args.field,e=find(field);
    if(e.tagName!==field.tag||(e.type??null)!==field.type||(e.isContentEditable===true)!==field.rich)throw Error('Field changed');
    e.scrollIntoView({block:'center',inline:'nearest'});e.focus({preventScroll:true});
    if(field.rich){const range=document.createRange();range.selectNodeContents(e);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
    else e.setSelectionRange(0,e.value.length);
    return {ok:document.activeElement===e||e.contains(document.activeElement)};
  }
  if(args.mode==='fill') {
    const prepared=args.fields.map(f=>{
      const e=find(f);
      if(e.tagName!==f.tag||(e.type??null)!==f.type||(e.isContentEditable===true)!==f.rich||f.value.length>f.maxLength)throw Error('Field changed');
      return [e,f];
    });
    for(const [e,f] of prepared) {
      if(f.rich)continue;
      Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,f.value);
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
    }
    return {ok:true,count:prepared.length};
  }
  if(args.mode==='focus-rich') {
    const e=find(args.field);
    if(!e.isContentEditable)throw Error('Field changed');
    e.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(e);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    return {ok:true};
  }
  if(args.mode==='location') {
    const e=find(args.action);
    if((e.innerText??'').trim()!==args.action.label||!locationLabel.test(args.action.label))throw Error('Location changed');
    e.scrollIntoView({block:'center'});e.click();return {ok:true};
  }
  if(args.mode==='choice') {
    const e=find(args.action);
    if(e.getAttribute('role')!=='option'||(e.innerText??'').trim()!==args.action.label)throw Error('Option changed');
    e.scrollIntoView({block:'center'});e.click();return {ok:true};
  }
  throw Error('Unsupported action');
})(__KAMEN_ARGS__)
