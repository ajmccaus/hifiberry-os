const {chromium}=require('playwright');
const OUT='/tmp/claude-0/-home-user-hifiberry-os/44bcaa47-cf01-555d-b7c0-a66b4b33ff65/scratchpad/ref/shots/';
const BASE='http://127.0.0.1:18080', ACR='http://127.0.0.1:11080';
const VPS=[['kiosk',800,480,true,false],['phone',390,844,true,true],['desktop',1280,800,false,false]];
const only=process.argv[2];
const post=(p,b)=>fetch(ACR+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});
async function setPlaying(){
  await post('/__test/player-state',{player:'mpd',state:'Stopped',is_active:false});
  await post('/__test/player-state',{player:'spotify',state:'Playing',is_active:true});
  await post('/__test/song',{title:'Mock Song Title',artist:'Mock Artist',album:'Mock Album',cover_art_url:'/api/imagecache/mock.png',stream_url:'spotify:track:mock123'});
  await post('/__test/volume',{percentage:40});
}
async function setIdle(){
  for (const k of ['title','artist','album','cover_art_url','artwork_url','stream_url']) await post('/__test/song',{[k]:null});
  await post('/__test/player-state',{player:'spotify',state:'Stopped',is_active:false});
  await post('/__test/player-state',{player:'mpd',state:'Stopped',is_active:false});
}
(async()=>{
 const b=await chromium.launch();
 for (const [n,w,h,touch,mobile] of VPS){
  if(only&&only!=n) continue;
  const ctx=await b.newContext({viewport:{width:w,height:h},hasTouch:touch,isMobile:mobile,colorScheme:'light',deviceScaleFactor:1});
  const open=async()=>{const p=await ctx.newPage(); await p.goto(BASE+'/',{waitUntil:'networkidle'});
    await p.waitForFunction(()=>document.body.classList.contains('connected'),null,{timeout:20000});
    await p.waitForTimeout(2500); return p;};
  const shot=async(p,name)=>{await p.evaluate(()=>document.fonts.ready); await p.waitForLoadState('networkidle'); await p.waitForTimeout(900);
    await p.screenshot({path:OUT+n+'-'+name+'.png'}); console.log(n,name);};
  const ext=async(p,e)=>{await p.evaluate(x=>beo.showExtension(x),e); await p.waitForTimeout(900);};
  // playing
  await setPlaying(); let p=await open();
  await ext(p,'product-information'); await shot(p,'bar-playing');
  await p.evaluate(()=>now_playing.showNowPlaying()); await p.waitForTimeout(1500); await shot(p,'nowplaying-playing');
  await p.evaluate(()=>now_playing.hideNowPlaying&&now_playing.hideNowPlaying()); await p.waitForTimeout(800);
  await ext(p,'product-information'); await shot(p,'home');
  await p.evaluate(()=>beo.toggleMainMenu()); await p.waitForTimeout(900); await shot(p,'menu');
  await p.evaluate(()=>beo.toggleMainMenu()); await p.waitForTimeout(600);
  await ext(p,'sources'); await shot(p,'sources');
  await ext(p,'sound'); await shot(p,'sound');
  await ext(p,'screen'); await shot(p,'screen');
  await ext(p,'general-settings'); await shot(p,'general');
  await p.evaluate(()=>beo.ask('product-shutdown-prompt')); await p.waitForTimeout(900); await shot(p,'general-power');
  await p.evaluate(()=>beo.ask()); await p.waitForTimeout(600);
  await ext(p,'product-information');
  await p.evaluate(()=>{const s=document.querySelector('#product-information .scroll-area'); if(s) s.scrollTop=s.scrollHeight;}); await p.waitForTimeout(600); await shot(p,'about');
  await p.evaluate(()=>{const s=document.querySelector('#product-information .scroll-area'); if(s) s.scrollTop=0;});
  await p.evaluate(()=>product_information.changeProductName()); await p.waitForTimeout(900); await shot(p,'name-edit');
  await p.evaluate(()=>beo.cancelText()); await p.waitForTimeout(600);
  // volume slider interaction: hold the handle mid-drag
  await ext(p,'product-information');
  const hd=await p.locator('#player-bar-volume-slider .ui-slider-handle').boundingBox();
  const tr=await p.locator('#player-bar-volume-slider').boundingBox();
  const y=hd.y+hd.height/2; await p.mouse.move(hd.x+hd.width/2,y); await p.mouse.down();
  await p.mouse.move(tr.x+tr.width*0.75,y,{steps:8}); await p.waitForTimeout(400);
  await shot(p,'volume-dragging'); await p.mouse.up(); await p.waitForTimeout(500);
  await p.close();
  // idle
  await setIdle(); p=await open();
  await shot(p,'bar-idle');
  await p.evaluate(()=>now_playing.showNowPlaying()); await p.waitForTimeout(1500); await shot(p,'nowplaying-idle');
  await p.close(); await ctx.close();
 }
 await setPlaying(); await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
