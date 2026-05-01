const blessed = require("blessed");
const contrib = require("blessed-contrib");
const { spawn } = require("child_process");
const fs = require("fs");

//////////////////////////////
// CONFIG
//////////////////////////////

const CONCURRENCY = 5;
const SAFE_LIMIT = 2;

const Forever = true;
const Shuffle = true;

const SearchForPlaylists = 5;
const MAX_DURATION = 3000;

const DOWNLOAD_DIR = "./mp3";
const AUDIO_QUALITY = 128;

// UI CONTROL
const ENABLE_TAGS = true;
const ENABLE_SCROLL = true;

// 🔥 FAILURE HARNESS CONTROL
const MAX_ERROR_STREAK = 3;

// 🔁 RESPAWN CONTROL
const ENABLE_RESPAWN = true;

const INPUT_URLS = [];

const searchPlaylistName = [
  "gospel worship playlist",
  "top gospel songs playlist",
  "nonstop christian church mix",
  "gospel praise and worship mix",
  "christian worship playlist",
  "best christian worship songs playlist",
  "chrstian worship 2025",
  "praise and worship songs mix",
  "gospel hits playlist",
  "african gospel mix",
  "deep worship songs playlist",
  "morning worship gospel playlist",
  "spirit filled worship songs",
  "christian music playlist 2025",
  "live worship songs mix",
  "r and b soul worship mix",
  "worship psalm r and b playlist",
  "pentecostal worship songs playlist",
  "church worship songs mix",
  "ultimate gospel playlist"
];

//////////////////////////////
// STATE
//////////////////////////////

let queue = [];
let index = 0;

let active = 0;
let done = 0;
let failed = 0;
let loopCount = 0;

let errorStreak = 0;
let restarting = false;

let startTime = Date.now();
let systemState = "INIT";

//////////////////////////////
// INIT FS
//////////////////////////////

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR);
}

//////////////////////////////
// UI
//////////////////////////////

const screen = blessed.screen({ smartCSR: true, title: "YT GRID PRO MAX" });
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

const statsBox = grid.set(0, 0, 5, 6, blessed.box, {
  label: "SYSTEM",
  border: "line",
  tags: ENABLE_TAGS,
  scrollable: ENABLE_SCROLL
});

const downloadBox = grid.set(0, 6, 5, 6, blessed.log, {
  label: "DOWNLOAD",
  border: "line",
  tags: ENABLE_TAGS,
  scrollable: ENABLE_SCROLL
});

const convertBox = grid.set(5, 6, 5, 6, blessed.log, {
  label: "CONVERT",
  border: "line",
  tags: ENABLE_TAGS,
  scrollable: ENABLE_SCROLL
});

const workerTable = grid.set(5, 0, 5, 6, contrib.table, {
  label: "WORKERS",
  columnWidth: [8, 12, 12],
  tags: ENABLE_TAGS
});

const logBox = grid.set(10, 0, 2, 12, blessed.log, {
  label: "LOGS",
  border: "line",
  scrollable: ENABLE_SCROLL,
  tags: ENABLE_TAGS
});

screen.key(['q','C-c'],()=>process.exit(0));

//////////////////////////////
// COLORS
//////////////////////////////

const C = {
  red: (t)=>`{#ff4d4d-fg}${t}{/}`,
  green: (t)=>`{#00ff99-fg}${t}{/}`,
  yellow: (t)=>`{#ffd11a-fg}${t}{/}`
};

//////////////////////////////
// RESPAWN
//////////////////////////////

function respawnSelf(reason){

  if(!ENABLE_RESPAWN) return;

  log("WARN", `Respawning (${reason})`);

  const child = spawn(process.argv[0], process.argv.slice(1), {
    stdio: "inherit",
    detached: true
  });

  child.unref();

  process.exit(0);
}

//////////////////////////////
// FAILURE HARNESS
//////////////////////////////

function triggerRestart(reason){

  if(restarting) return;
  restarting = true;

  log("ERRO", `⚠️ FAILURE HARNESS TRIGGERED (${reason})`);
  systemState = "RESTARTING";

  setTimeout(()=>{

    if(ENABLE_RESPAWN){
      respawnSelf("HARNESS");
      return;
    }

    // fallback soft restart
    log("WARN", "Soft restart");

    queue = [];
    index = 0;
    active = 0;
    done = 0;
    failed = 0;
    errorStreak = 0;

    restarting = false;
    main();

  }, 2000);
}

//////////////////////////////
// LOGGING
//////////////////////////////

function log(type,msg){

  let prefix = "";

  if(type==="INFO"){
    prefix = C.green("[INFO]");
    errorStreak = 0;
  }

  if(type==="WARN"){
    prefix = C.yellow("[WARN]");
  }

  if(type==="ERRO"){
    prefix = C.red("[ERRO]");
    errorStreak++;

    if(errorStreak >= MAX_ERROR_STREAK){
      triggerRestart("ERROR STREAK LIMIT");
    }
  }

  logBox.log(`${prefix} ${msg}`);
}

//////////////////////////////
// UTIL
//////////////////////////////

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

function countMP3(){
  return fs.readdirSync(DOWNLOAD_DIR).filter(f=>f.endsWith(".mp3")).length;
}

function uptime(){
  return Math.floor((Date.now() - startTime)/1000);
}

//////////////////////////////
// SEARCH
//////////////////////////////

function search(query){
  return new Promise((resolve)=>{

    log("INFO",`Searching: ${query}`);

    const yt = spawn("yt-dlp",[
      "--flat-playlist","-J",
      `ytsearch${SearchForPlaylists}:${query}`
    ]);

    let out="";

    yt.stdout.on("data",d=>out+=d.toString());

    yt.on("close",()=>{
      try{
        const json = JSON.parse(out);
        const urls = (json.entries||[]).map(e=>e.url);
        log("INFO",`Found ${urls.length}`);
        resolve(urls);
      }catch{
        log("ERRO","Search parse failed");
        resolve([]);
      }
    });
  });
}

//////////////////////////////
// DOWNLOAD
//////////////////////////////

function download(url,id){

  active++;

  const yt = spawn("yt-dlp",[
    "-v",
    "-f","bestaudio",
    "--extract-audio",
    "--audio-format","mp3",
    "--audio-quality","5",
    "--match-filter",`duration < ${MAX_DURATION}`,
    "--no-playlist",
    "--newline",
    "--paths", DOWNLOAD_DIR,
    url
  ]);

  yt.stdout.on("data",d=>{
    const s = d.toString();

    if(s.includes("[download]")) downloadBox.log(s.trim());
    if(s.includes("ETA") || s.includes("KiB/s") || s.includes("MiB/s")) downloadBox.log(s.trim());
    if(s.includes("[ExtractAudio]") || s.includes("ffmpeg")) convertBox.log(s.trim());

    if(s.toLowerCase().includes("warning")) log("WARN",s.trim());
  });

  yt.stderr.on("data",d=>{
    const s = d.toString();
    if(s.toLowerCase().includes("error")) log("ERRO",s.trim());
  });

  yt.on("close",(code)=>{
    active--;

    if(code === 0){
      done++;
      log("INFO",`W${id} DONE`);
    }else{
      failed++;
      log("ERRO",`W${id} FAILED`);
    }
  });
}

//////////////////////////////
// SIGNAL HANDLERS
//////////////////////////////

process.on("SIGINT", ()=>{
  log("WARN","SIGINT received");
  respawnSelf("SIGINT");
});

process.on("SIGTERM", ()=>{
  log("WARN","SIGTERM received");
  respawnSelf("SIGTERM");
});

//////////////////////////////
// UI LOOP
//////////////////////////////

setInterval(()=>{

  statsBox.setContent(
`State          : ${systemState}

Active Threads : ${active}/${CONCURRENCY}
Queue Remaining: ${queue.length - index}
Completed      : ${done}
Failed         : ${failed}

Error Streak   : ${errorStreak}/${MAX_ERROR_STREAK}

Download Files : ${countMP3()}
Loop Iteration : ${loopCount}

Uptime (sec)   : ${uptime()}`
  );

  const rows = [];
  for(let i=0;i<CONCURRENCY;i++){
    rows.push([
      `W${i+1}`,
      i < active ? "ACTIVE" : "IDLE",
      i < active ? "RUNNING" : "-"
    ]);
  }

  workerTable.setData({
    headers:["Worker","State","Status"],
    data:rows
  });

  screen.render();

},300);

//////////////////////////////
// POOL
//////////////////////////////

async function runPool(){

  systemState = "DOWNLOADING";

  while(true){

    if(index >= queue.length) return;

    while(active >= SAFE_LIMIT){
      await sleep(200);
    }

    const url = queue[index++];
    download(url,index);

    await sleep(100);
  }
}

//////////////////////////////
// MAIN
//////////////////////////////

async function main(){

  log("INFO","SYSTEM START");

  while(true){

    systemState = "SEARCHING";

    queue = [...INPUT_URLS];

    for(const q of searchPlaylistName){
      const r = await search(q);
      queue.push(...r);
    }

    log("INFO",`Total Tracks: ${queue.length}`);

    if(Shuffle){
      queue = shuffle(queue);
      log("INFO","Shuffle enabled");
    }

    index = 0;
    active = 0;
    done = 0;
    failed = 0;

    loopCount++;

    await runPool();

    if(!Forever) break;

    systemState = "IDLE";
    await sleep(3000);
  }
}

main();
