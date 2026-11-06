// Node.js 20+ public-data-only adapter. No cookies, no private account access.
// This Roblox endpoint may deny requests, restrict visibility or change.
// Deploy to an HTTPS host; set BACKEND_URL in the Roblox server script.
const http = require('node:http');
const PORT = Number(process.env.PORT || 3000);
const server = http.createServer(async (req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const url=new URL(req.url,'http://localhost');
  if(url.pathname!=='/outfits'){res.writeHead(404);return res.end(JSON.stringify({ok:false,error:'Not found'}));}
  const userId=url.searchParams.get('userId');
  if(!/^\d{1,16}$/.test(userId||'')){res.writeHead(400);return res.end(JSON.stringify({ok:false,error:'Invalid userId'}));}
  try {
    let page=1, outfits=[];
    while(page<=5){
      const endpoint=`https://avatar.roblox.com/v1/users/${userId}/outfits?page=${page}&itemsPerPage=100&isEditable=true`;
      const r=await fetch(endpoint,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(!r.ok){res.writeHead(502);return res.end(JSON.stringify({ok:false,error:`Roblox public outfit API unavailable (HTTP ${r.status})`}));}
      const data=await r.json();
      const items=Array.isArray(data.data)?data.data:[];
      outfits.push(...items.filter(x=>Number.isSafeInteger(x.id)&&typeof x.name==='string').map(x=>({id:x.id,name:x.name})));
      if(items.length<100||outfits.length>=100)break;
      page++;
    }
    res.end(JSON.stringify({ok:true,outfits:outfits.slice(0,100)}));
  }catch(e){res.writeHead(502);res.end(JSON.stringify({ok:false,error:'Unable to access public Roblox outfit data'}));}
});
server.listen(PORT,'0.0.0.0');
