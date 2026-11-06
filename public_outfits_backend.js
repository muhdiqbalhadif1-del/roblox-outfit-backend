// Roblox saved outfit pages. No fixed overall outfit limit; fetch on demand.
const http=require('node:http');
const PORT=Number(process.env.PORT||3000);
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const url=new URL(req.url,'http://localhost');
  if(url.pathname!=='/outfits'){res.writeHead(404);return res.end(JSON.stringify({ok:false,error:'Not found'}));}
  const userId=url.searchParams.get('userId');
  const page=Number(url.searchParams.get('page')||1);
  if(!/^\d{1,16}$/.test(userId||'')||!Number.isSafeInteger(page)||page<1||page>1000000){res.writeHead(400);return res.end(JSON.stringify({ok:false,error:'Invalid userId or page'}));}
  try{
    const endpoint=`https://avatar.roblox.com/v1/users/${userId}/outfits?page=${page}&itemsPerPage=100&isEditable=true`;
    const response=await fetch(endpoint,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok){res.writeHead(502);return res.end(JSON.stringify({ok:false,error:`Roblox outfit API HTTP ${response.status}`}));}
    const data=await response.json();
    const rows=Array.isArray(data.data)?data.data:[];
    const outfits=rows.filter(x=>Number.isSafeInteger(x.id)&&typeof x.name==='string').map(x=>({id:x.id,name:x.name}));
    res.end(JSON.stringify({ok:true,outfits,hasMore:rows.length===100,page}));
  }catch(e){res.writeHead(502);res.end(JSON.stringify({ok:false,error:'Roblox outfit API unavailable'}));}
});
server.listen(PORT,'0.0.0.0');
