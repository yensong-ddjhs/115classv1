// 學生端闖關邏輯
const socket = io();

// 取得學號
const urlParams = new URLSearchParams(window.location.search);
let myStudentId = urlParams.get('id') || sessionStorage.getItem('studentId') || 's01';
myStudentId = myStudentId.trim().toLowerCase();

// DOM 元素
const studentIdDisplay = document.getElementById('studentIdDisplay');
const studentAvatar = document.getElementById('studentAvatar');
const groupBadge = document.getElementById('groupBadge');
const waitingGroupText = document.getElementById('waitingGroupText');
const teammatesList = document.getElementById('teammatesList');
const memberCountText = document.getElementById('memberCountText');

const stageWaiting = document.getElementById('stageWaiting');
const stage1 = document.getElementById('stage1');
const stage2 = document.getElementById('stage2');
const stageVictory = document.getElementById('stageVictory');

let myGroup = null;
let myStudentData = null;

// 第一關相關變數
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
let stage1StartTime = null;
let stage1TimerInterval = null;
let stage1Score = 0;
let stage1TimeSpent = 0;
let stage1Completed = false;

// 第二關硬體題目定義
const HARDWARE_QUESTIONS = [
  {
    id: 'cpu',
    name: '1. CPU (中央處理器)',
    icon: '🔲',
    correctId: 'desc_cpu',
    description: '負責電腦運算與控制'
  },
  {
    id: 'ram',
    name: '2. RAM (隨機存取記憶體)',
    icon: '⚡',
    correctId: 'desc_ram',
    description: '執行中程式的暫存快取'
  },
  {
    id: 'storage',
    name: '3. SSD / 硬碟 (儲存裝置)',
    icon: '💾',
    correctId: 'desc_storage',
    description: '永久存放檔案與系統'
  },
  {
    id: 'gpu',
    name: '4. GPU (顯示卡 / 繪圖處理器)',
    icon: '🎮',
    correctId: 'desc_gpu',
    description: '影像渲染與螢幕訊號輸出'
  },
  {
    id: 'motherboard',
    name: '5. 主機板 (Motherboard)',
    icon: '🔌',
    correctId: 'desc_motherboard',
    description: '各硬體溝通與供電基座'
  }
];

const HARDWARE_OPTIONS = [
  { id: 'desc_cpu', text: '電腦的大腦，負責執行算術運算、邏輯判斷與指令解讀 (Brain of PC)' },
  { id: 'desc_ram', text: '高速揮發性記憶體，電腦重開機後資料會消失，暫存執行中程式' },
  { id: 'desc_storage', text: '長期永久存放作業系統、軟體程式與檔案資料的非揮發性儲存設備' },
  { id: 'desc_gpu', text: '專門負責 3D 遊戲繪圖運算、影像編解碼並輸出視訊訊號給螢幕' },
  { id: 'desc_motherboard', text: '連接並整合所有內部組件（CPU/記憶體/硬碟），提供通訊匯流排' }
];

// 初始化連線
studentIdDisplay.innerText = myStudentId.toUpperCase();
studentAvatar.innerText = myStudentId.toUpperCase();

socket.emit('student_join', { studentId: myStudentId });

// 接收初始化或同步
socket.on('student_ready', (data) => {
  myStudentData = data.student;
  myGroup = data.group;
  updateLobbyUI(data.gameState);

  // 判斷關卡進度
  checkGameState(data.gameState);
});

socket.on('state_sync', (state) => {
  if (state.students && state.students[myStudentId]) {
    myStudentData = state.students[myStudentId];
    myGroup = state.groups[myStudentData.groupId];
  }
  updateLobbyUI(state);
  checkGameState(state);
});

// 老師點擊「遊戲開始」廣播
socket.on('game_started', () => {
  sound.playVictory();
  showStage1();
});

// 老師重置廣播
socket.on('game_reset', () => {
  stage1Completed = false;
  clearInterval(stage1TimerInterval);
  showWaitingLobby();
});

// 更新大廳 UI
function updateLobbyUI(gameState) {
  if (!myGroup) return;

  groupBadge.innerText = myGroup.name;
  groupBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40';
  waitingGroupText.innerHTML = `您已被分配到 <span class="text-cyan-400 font-extrabold text-lg">${myGroup.name}</span>`;

  // 隊友清單
  teammatesList.innerHTML = '';
  const members = myGroup.members || [];
  memberCountText.innerText = `${members.length} 人`;

  members.forEach(mId => {
    const isMe = mId === myStudentId;
    const isOnline = gameState.students[mId] && gameState.students[mId].online;
    const span = document.createElement('span');
    span.className = `px-2 py-1 rounded-lg border flex items-center gap-1.5 ${isMe ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500/50 font-bold' : (isOnline ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-950 text-slate-500 border-slate-800')}`;
    span.innerHTML = `
      <span class="w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
      <span>${mId}${isMe ? ' (我)' : ''}</span>
    `;
    teammatesList.appendChild(span);
  });
}

// 根據後端狀態切換顯示畫面
function checkGameState(gameState) {
  if (!myStudentData) return;

  if (myStudentData.finished) {
    showVictoryScreen();
  } else if (myStudentData.stage1Score !== null && myStudentData.stage2Score === null) {
    showStage2();
  } else if (gameState.status === 'in_progress') {
    if (!stage1Completed && myStudentData.stage1Score === null) {
      showStage1();
    }
  } else {
    showWaitingLobby();
  }
}

function showWaitingLobby() {
  stageWaiting.classList.remove('hidden');
  stage1.classList.add('hidden');
  stage2.classList.add('hidden');
  stageVictory.classList.add('hidden');
}

// ==========================================
// 第一關：英文字母極速挑戰 (Alphabet Speedrun)
// ==========================================
function showStage1() {
  stageWaiting.classList.add('hidden');
  stage1.classList.remove('hidden');
  stage2.classList.add('hidden');
  stageVictory.classList.add('hidden');

  renderLettersGuide();
  startStage1Timer();

  const input = document.getElementById('alphabetInput');
  input.value = '';
  input.disabled = false;
  setTimeout(() => input.focus(), 200);

  input.addEventListener('input', handleAlphabetInput);
}

// 產生 a-z 26 個字母卡片
function renderLettersGuide() {
  const container = document.getElementById('lettersContainer');
  container.innerHTML = '';
  for (let i = 0; i < ALPHABET.length; i++) {
    const char = ALPHABET[i];
    const span = document.createElement('span');
    span.id = `char_${char}`;
    span.className = `w-7 h-8 sm:w-8 sm:h-9 flex items-center justify-center font-mono font-bold text-sm sm:text-base rounded-md border border-slate-800 bg-slate-900 text-slate-400 letter-char ${i === 0 ? 'current' : ''}`;
    span.innerText = char;
    container.appendChild(span);
  }
}

// 啟動 3 分鐘倒數計時器
function startStage1Timer() {
  stage1StartTime = Date.now();
  let remainingSeconds = 180; // 3 分鐘

  const timerDisplay = document.getElementById('timerDisplay');
  clearInterval(stage1TimerInterval);

  stage1TimerInterval = setInterval(() => {
    remainingSeconds--;
    const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const secs = String(remainingSeconds % 60).padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;

    if (remainingSeconds <= 30) {
      timerDisplay.className = 'font-mono text-2xl font-black text-rose-500 tracking-wider animate-pulse';
      sound.playTick();
    } else if (remainingSeconds <= 60) {
      timerDisplay.className = 'font-mono text-2xl font-black text-amber-400 tracking-wider';
    }

    if (remainingSeconds <= 0) {
      clearInterval(stage1TimerInterval);
      handleStage1Timeout();
    }
  }, 1000);
}

// 監聽鍵入事件
function handleAlphabetInput(e) {
  const input = e.target;
  const val = input.value.toLowerCase().replace(/[^a-z]/g, '');
  input.value = val;

  const len = val.length;
  document.getElementById('typingProgressText').innerText = `${len} / 26`;

  // 即時標記字母狀態
  for (let i = 0; i < 26; i++) {
    const char = ALPHABET[i];
    const el = document.getElementById(`char_${char}`);
    if (!el) continue;

    if (i < len) {
      if (val[i] === char) {
        el.className = 'w-7 h-8 sm:w-8 sm:h-9 flex items-center justify-center font-mono font-bold text-sm sm:text-base rounded-md border letter-char typed';
      } else {
        el.className = 'w-7 h-8 sm:w-8 sm:h-9 flex items-center justify-center font-mono font-bold text-sm sm:text-base rounded-md border border-rose-500 bg-rose-500/20 text-rose-300 letter-char';
      }
    } else if (i === len) {
      el.className = 'w-7 h-8 sm:w-8 sm:h-9 flex items-center justify-center font-mono font-bold text-sm sm:text-base rounded-md border letter-char current';
    } else {
      el.className = 'w-7 h-8 sm:w-8 sm:h-9 flex items-center justify-center font-mono font-bold text-sm sm:text-base rounded-md border border-slate-800 bg-slate-900 text-slate-400 letter-char';
    }
  }

  sound.playKey();

  // 檢查是否完全匹配 a-z
  if (val === ALPHABET) {
    clearInterval(stage1TimerInterval);
    const timeTaken = Math.round((Date.now() - stage1StartTime) / 1000);
    stage1TimeSpent = timeTaken;
    input.disabled = true;

    // 計算分數：<=60s 得3分, <=120s 得2分, <=180s 得1分
    if (timeTaken <= 60) stage1Score = 3;
    else if (timeTaken <= 120) stage1Score = 2;
    else if (timeTaken <= 180) stage1Score = 1;
    else stage1Score = 0;

    finishStage1(stage1Score, timeTaken);
  }
}

// 第一關超時
function handleStage1Timeout() {
  const input = document.getElementById('alphabetInput');
  input.disabled = true;
  stage1Score = 0;
  stage1TimeSpent = 180;
  finishStage1(0, 180);
}

// 送出第一關分數並銜接第二關
function finishStage1(score, timeTaken) {
  stage1Completed = true;
  sound.playVictory();

  // 透過 WebSocket 送出分數
  socket.emit('submit_stage1', {
    studentId: myStudentId,
    score: score,
    timeTaken: timeTaken
  });

  const banner = document.getElementById('stage1SuccessBanner');
  const scoreText = document.getElementById('stage1ScoreText');
  scoreText.innerHTML = `花費時間：<span class="font-bold font-mono text-white">${timeTaken} 秒</span>，為小組奪得 <span class="font-black font-mono text-xl text-amber-300">+${score} 分</span>！`;
  banner.classList.remove('hidden');

  // 2.5 秒後平滑切換至第二關
  setTimeout(() => {
    showStage2();
  }, 2500);
}

// ==========================================
// 第二關：電腦硬體核心知識配對
// ==========================================
function showStage2() {
  stageWaiting.classList.add('hidden');
  stage1.classList.add('hidden');
  stage2.classList.remove('hidden');
  stageVictory.classList.add('hidden');

  renderHardwareQuestions();
}

function renderHardwareQuestions() {
  const container = document.getElementById('hardwareListContainer');
  container.innerHTML = '';

  // 題目渲染：左邊硬體名稱，右邊下拉選單
  HARDWARE_QUESTIONS.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'bg-slate-950/80 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-slate-700 transition-all';

    // 打亂選項順序以避免死背
    const shuffledOptions = [...HARDWARE_OPTIONS].sort(() => Math.random() - 0.5);

    card.innerHTML = `
      <div class="flex items-center gap-3 min-w-[220px]">
        <span class="text-2xl">${q.icon}</span>
        <div>
          <div class="font-bold text-white text-base">${q.name}</div>
          <div class="text-[11px] text-purple-300 font-mono">${q.description}</div>
        </div>
      </div>
      <div class="flex-1">
        <select id="select_${q.id}" class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-purple-500 cursor-pointer">
          <option value="">-- 請選擇最匹配的功能敘述 --</option>
          ${shuffledOptions.map(opt => `
            <option value="${opt.id}">${opt.text}</option>
          `).join('')}
        </select>
      </div>
    `;

    container.appendChild(card);
  });
}

// 送出第二關答案
function submitStage2() {
  sound.playKey();
  let correctCount = 0;
  let allAnswered = true;

  HARDWARE_QUESTIONS.forEach(q => {
    const select = document.getElementById(`select_${q.id}`);
    if (!select || !select.value) {
      allAnswered = false;
    }
  });

  if (!allAnswered) {
    if (!confirm('您還有題目未完成配對，確定現在送出嗎？未填寫視為不得分。')) {
      return;
    }
  }

  // 計算正確數量
  HARDWARE_QUESTIONS.forEach(q => {
    const select = document.getElementById(`select_${q.id}`);
    if (select && select.value === q.correctId) {
      correctCount++;
      select.parentElement.parentElement.classList.add('border-emerald-500/60', 'bg-emerald-950/20');
    } else if (select) {
      select.parentElement.parentElement.classList.add('border-rose-500/40', 'bg-rose-950/10');
    }
  });

  const stage2Score = correctCount; // 滿分 5 分
  document.getElementById('submitStage2Btn').disabled = true;
  document.getElementById('submitStage2Btn').innerText = '作答完成，成績已回傳！';

  // 透過 WebSocket 送出第二關分數
  socket.emit('submit_stage2', {
    studentId: myStudentId,
    score: stage2Score
  });

  sound.playVictory();

  setTimeout(() => {
    showVictoryScreen(stage1Score, stage2Score);
  }, 1500);
}

// ==========================================
// 狀態 4: 結算勝利畫面
// ==========================================
function showVictoryScreen(s1Score, s2Score) {
  stageWaiting.classList.add('hidden');
  stage1.classList.add('hidden');
  stage2.classList.add('hidden');
  stageVictory.classList.remove('hidden');

  const finalS1 = s1Score !== undefined ? s1Score : (myStudentData && myStudentData.stage1Score !== null ? myStudentData.stage1Score : 0);
  const finalS2 = s2Score !== undefined ? s2Score : (myStudentData && myStudentData.stage2Score !== null ? myStudentData.stage2Score : 0);
  const total = finalS1 + finalS2;

  document.getElementById('summaryS1Score').innerText = `${finalS1} 分`;
  document.getElementById('summaryS2Score').innerText = `${finalS2} 分`;
  document.getElementById('summaryTotalScore').innerText = `${total} / 8 分`;
}

// 音效開關
function toggleAudio() {
  sound.enabled = !sound.enabled;
  const btn = document.getElementById('audioBtn');
  btn.innerText = sound.enabled ? '🔊' : '🔇';
}
