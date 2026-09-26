// 教師端大螢幕主控台邏輯
const socket = io();

let currentGameState  = null;
let showAllAnswers    = false;
let showBitWeights    = true;
let selectedGame      = 1;   // 老師目前選取的遊戲模組 (1 或 2)
let selectedStage     = 1;   // 老師目前選取的關卡

// 連線認證
socket.emit('teacher_auth', { username: 't01', password: 't01' }, (res) => {
  if (!res || !res.success) {
    console.warn('Teacher authentication fallback');
  }
});

// 顯示目前連線網址
document.getElementById('serverUrl').innerText = `${window.location.protocol}//${window.location.host}`;

// 監聽位元權重開關
document.getElementById('toggleBitWeights').addEventListener('change', (e) => {
  showBitWeights = e.target.checked;
  renderGroups();
});

// 全狀態同步
socket.on('state_sync', (state) => {
  currentGameState = state;
  // 同步老師端選取狀態
  if (state.currentGame)  selectedGame  = state.currentGame;
  if (state.currentStage) selectedStage = state.currentStage;
  updateStatusBadge(state.status);
  updateOnlineCount();
  updateGameStageBtns();
  renderGroups();
});

// 老師切換關卡後，伺服器廣播 stage_changed
socket.on('stage_changed', (data) => {
  selectedGame  = data.currentGame;
  selectedStage = data.currentStage;
  updateGameStageBtns();
  updateLiveFeedStageChange(data);
});

// 老師切換遊戲模組後，伺服器廣播 game_switched
socket.on('game_switched', (data) => {
  selectedGame  = data.currentGame;
  selectedStage = data.currentStage;
  updateGameStageBtns();
  updateLiveFeedStageChange(data);
});

// 學生連線狀態變更
socket.on('student_status_changed', (data) => {
  if (currentGameState) {
    currentGameState.students = data.students;
    updateOnlineCount();
    renderGroups();
  }
});

// 即時分數更新 (學生闖關完成時伺服器廣播)
socket.on('update_teacher_score', (data) => {
  if (!currentGameState) return;

  const group = currentGameState.groups[data.groupId];
  if (group) {
    group.score = data.totalScore;
  }

  // 播放加分提示音
  sound.playScoreGained();

  // 更新戰報
  const feed = document.getElementById('liveFeedText');
  const stageName = data.stage === 1 ? '第一關 (英文字母極速)' : '第二關 (電腦硬體配對)';
  const simTag = data.simulated ? '【模擬測試】' : '';
  feed.innerHTML = `<span class="text-cyan-400 font-bold font-mono">${simTag}${data.studentId}</span> 順利通過 <span class="text-emerald-400">${stageName}</span>，為 <span class="text-amber-400 font-bold">${group ? group.name : data.groupId}</span> 獲得 <span class="text-emerald-300 font-bold font-mono">+${data.earnedScore}</span> 分！`;

  // 隨機抽樣更新提問輔助文字
  document.getElementById('hintBinaryText').innerText = data.binaryScore || '1011';

  // 局部更新該組卡片並觸發跳動動畫
  updateGroupCardScore(data.groupId, data.totalScore, data.binaryScore);
});

// 更新遊戲狀態標籤
function updateStatusBadge(status) {
  const badge = document.getElementById('gameStatusBadge');
  const startBtn = document.getElementById('startGameBtn');
  if (status === 'in_progress') {
    badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse';
    badge.innerText = '⚡ 競賽進行中';
    startBtn.innerHTML = '<span>⚡ 遊戲進行中</span>';
    startBtn.classList.remove('from-emerald-500', 'to-teal-600');
    startBtn.classList.add('from-purple-600', 'to-indigo-600');
  } else {
    badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30';
    badge.innerText = '等待開始';
    startBtn.innerHTML = '<span>🚀 遊戲開始 (切換第一關)</span>';
    startBtn.classList.add('from-emerald-500', 'to-teal-600');
    startBtn.classList.remove('from-purple-600', 'to-indigo-600');
  }
}

// 更新在線人數
function updateOnlineCount() {
  if (!currentGameState || !currentGameState.students) return;
  const students = Object.values(currentGameState.students);
  const online = students.filter(s => s.online).length;
  const total = currentGameState.numStudents || students.length;
  document.getElementById('onlineCount').innerText = `${online} / ${total}`;
}

// 格式化二進位位元與權重標籤
function formatBinaryWithWeights(decimal) {
  const binaryStr = decimal.toString(2);
  const len = binaryStr.length;
  
  let html = `<div class="inline-flex flex-col items-center">`;
  
  // 權重行
  if (showBitWeights && decimal > 0) {
    html += `<div class="flex items-center gap-1.5 sm:gap-2 mb-1">`;
    for (let i = 0; i < len; i++) {
      const power = len - 1 - i;
      const weight = Math.pow(2, power);
      html += `<span class="w-7 sm:w-9 text-center text-[10px] sm:text-xs font-mono text-cyan-400/75 border-b border-cyan-500/30">${weight}</span>`;
    }
    html += `</div>`;
  }

  // 二進位數字行
  html += `<div class="flex items-center gap-1.5 sm:gap-2">`;
  for (let i = 0; i < len; i++) {
    const bit = binaryStr[i];
    const bitClass = bit === '1' 
      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50 shadow-sm shadow-cyan-500/30' 
      : 'bg-slate-800/40 text-slate-500 border-slate-700/50';
    html += `<span class="w-7 sm:w-9 h-10 sm:h-12 flex items-center justify-center rounded-lg border font-mono font-extrabold text-2xl sm:text-3xl ${bitClass}">${bit}</span>`;
  }
  html += `</div></div>`;
  return html;
}

// 渲染所有組別卡片
function renderGroups() {
  if (!currentGameState || !currentGameState.groups) return;
  const container = document.getElementById('groupsContainer');
  const groupList = Object.values(currentGameState.groups);

  container.innerHTML = '';

  groupList.forEach((group, index) => {
    const groupId = group.id;
    const decimalScore = group.score || 0;
    const members = group.members || [];
    const isAnswerShown = showAllAnswers || (window.revealedAnswers && window.revealedAnswers[groupId]);

    const card = document.createElement('div');
    card.id = `card_${groupId}`;
    card.className = `relative bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl transition-all hover:border-slate-700 flex flex-col justify-between`;

    // 計算小組完成率
    let finishedStage1Count = 0;
    let finishedStage2Count = 0;
    members.forEach(mId => {
      const st = currentGameState.students[mId];
      if (st) {
        if (st.stage1Score !== null) finishedStage1Count++;
        if (st.stage2Score !== null) finishedStage2Count++;
      }
    });

    card.innerHTML = `
      <!-- 卡片頂部：組別名稱與進度 -->
      <div>
        <div class="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-400 font-bold flex items-center justify-center text-sm border border-cyan-500/30 font-mono">
              G${index + 1}
            </span>
            <h3 class="text-lg font-bold text-white tracking-wide">${group.name}</h3>
          </div>
          <span class="text-xs text-slate-400 font-mono">
            組員：${members.length} 人
          </span>
        </div>

        <!-- 二進位分數展示核心區 -->
        <div class="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 text-center mb-4">
          <div class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-center gap-1.5">
            <span>二進位總分 (BINARY)</span>
            <span class="px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 text-[10px]">即時更新</span>
          </div>

          <!-- 二進位數字本體 -->
          <div id="binary_display_${groupId}" class="min-h-[58px] flex items-center justify-center">
            ${formatBinaryWithWeights(decimalScore)}
          </div>

          <!-- 十進位解答區塊 (預設可隱藏/展開) -->
          <div id="ans_${groupId}" class="mt-3 pt-3 border-t border-slate-800/70 transition-all ${isAnswerShown ? 'block' : 'hidden'}">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <span class="text-xs font-semibold">十進位答案：</span>
              <span id="decimal_text_${groupId}" class="text-xl font-extrabold font-mono text-amber-400 glow-text-gold">${decimalScore}</span>
              <span class="text-xs">分</span>
            </div>
          </div>
        </div>

        <!-- 顯示答案按鈕 -->
        <div class="flex gap-2 mb-4">
          <button onclick="toggleAnswer('${groupId}')" class="flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition-all ${isAnswerShown ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'}">
            ${isAnswerShown ? '🙈 隱藏答案' : '🔍 顯示答案 (十進位)'}
          </button>
        </div>
      </div>

      <!-- 卡片底部：組員狀態標籤列表 -->
      <div>
        <div class="text-[11px] font-medium text-slate-400 mb-2 flex items-center justify-between">
          <span>組員連線與闖關進度</span>
          <span class="text-[10px] text-slate-500 font-mono">
            關卡①: ${finishedStage1Count}/${members.length} | 關卡②: ${finishedStage2Count}/${members.length}
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${members.map(mId => {
            const st = currentGameState.students[mId];
            const isOnline = st && st.online;
            const hasS1 = st && st.stage1Score !== null;
            const hasS2 = st && st.stage2Score !== null;
            
            let statusBadge = '';
            if (hasS2) {
              statusBadge = '<span class="text-[9px] bg-emerald-500/30 text-emerald-300 px-1 rounded ml-1">全破</span>';
            } else if (hasS1) {
              statusBadge = '<span class="text-[9px] bg-blue-500/30 text-blue-300 px-1 rounded ml-1">過①</span>';
            }

            return `
              <span class="inline-flex items-center px-2 py-1 rounded-md text-xs font-mono border ${isOnline ? 'bg-slate-800/90 text-cyan-300 border-cyan-500/30' : 'bg-slate-950/60 text-slate-500 border-slate-800'}">
                <span class="w-1.5 h-1.5 rounded-full mr-1.5 ${isOnline ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : 'bg-slate-600'}"></span>
                ${mId}${statusBadge}
              </span>
            `;
          }).join('')}
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// 單獨更新組別卡片分數與跳動動畫
function updateGroupCardScore(groupId, decimalScore, binaryScore) {
  const binaryDiv = document.getElementById(`binary_display_${groupId}`);
  const decimalSpan = document.getElementById(`decimal_text_${groupId}`);
  const card = document.getElementById(`card_${groupId}`);

  if (binaryDiv) {
    binaryDiv.innerHTML = formatBinaryWithWeights(decimalScore);
    binaryDiv.classList.add('score-updated');
    setTimeout(() => binaryDiv.classList.remove('score-updated'), 600);
  }

  if (decimalSpan) {
    decimalSpan.innerText = decimalScore;
  }

  if (card) {
    card.classList.add('neon-border-gold');
    setTimeout(() => card.classList.remove('neon-border-gold'), 1200);
  }
}

// 單組切換十進位答案
window.revealedAnswers = window.revealedAnswers || {};
function toggleAnswer(groupId) {
  sound.playTick();
  window.revealedAnswers[groupId] = !window.revealedAnswers[groupId];
  renderGroups();
}

// 全部顯示 / 隱藏十進位答案
function toggleAllAnswers() {
  sound.playTick();
  showAllAnswers = !showAllAnswers;
  const btn = document.getElementById('toggleAllAnswersBtn');
  btn.innerHTML = showAllAnswers ? '<span>🙈 全部隱藏十進位</span>' : '<span>👁️ 全部顯示十進位</span>';
  renderGroups();
}

// 老師點擊「隨機分組」
function generateGroups() {
  sound.playKey();
  const numStudents = document.getElementById('numStudents').value;
  const numGroups = document.getElementById('numGroups').value;

  if (confirm(`確定要將 ${numStudents} 位學生隨機分配至 ${numGroups} 組嗎？\n這將重置目前組別名單與比分。`)) {
    window.revealedAnswers = {};
    socket.emit('generate_groups', { numStudents, numGroups });
  }
}

// 老師點擊「遊戲開始」（帶入目前選取的遊戲/關卡）
function startGame() {
  sound.playVictory();
  socket.emit('start_game', { game: selectedGame, stage: selectedStage });
}

// 老師切換「遊戲模組」(game1 / game2 / ...)
function switchGame(gameNum) {
  sound.playTick();
  selectedGame  = gameNum;
  selectedStage = 1;
  socket.emit('switch_game', { game: gameNum });
}

// 老師切換「關卡」(stage1 / stage2 / ...)
function switchStage(stageNum) {
  sound.playTick();
  selectedStage = stageNum;
  socket.emit('select_stage', { stage: stageNum });
}

// 同步更新遊戲/關卡選擇按鈕的視覺高亮
function updateGameStageBtns() {
  // 遊戲模組按鈕
  document.querySelectorAll('[data-game-btn]').forEach(btn => {
    const isActive = parseInt(btn.dataset.gameBtn) === selectedGame;
    btn.className = btn.className.replace(/\bbg-\S+\b/g, '').trim();
    if (isActive) {
      btn.classList.add('bg-cyan-600', 'text-white', 'border-cyan-500');
    } else {
      btn.classList.add('bg-slate-800', 'text-slate-300', 'border-slate-700');
    }
  });

  // 關卡按鈕
  document.querySelectorAll('[data-stage-btn]').forEach(btn => {
    const isActive = parseInt(btn.dataset.stageBtn) === selectedStage;
    btn.className = btn.className.replace(/\bbg-\S+\b/g, '').trim();
    if (isActive) {
      btn.classList.add('bg-amber-600', 'text-white', 'border-amber-500');
    } else {
      btn.classList.add('bg-slate-800', 'text-slate-300', 'border-slate-700');
    }
  });

  // 切換大螢幕視圖：遊戲三上帝視角 VS 遊戲一/二小組卡片
  const groupsContainer = document.getElementById('groupsContainer');
  const stage3Section = document.getElementById('stage3Section');
  if (selectedGame === 3) {
    if (groupsContainer) groupsContainer.classList.add('hidden');
    if (stage3Section) stage3Section.classList.remove('hidden');
    initTeacherStage3();
  } else {
    if (groupsContainer) groupsContainer.classList.remove('hidden');
    if (stage3Section) stage3Section.classList.add('hidden');
  }

  // 同步更新開始按鈕文字
  const startBtn = document.getElementById('startGameBtn');
  if (startBtn && currentGameState && currentGameState.status !== 'in_progress') {
    startBtn.querySelector('span').innerText =
      `🚀 發布遊戲 ${selectedGame} — 關卡 ${selectedStage}`;
  }
}

// 更新底部 Live Feed 顯示切換訊息
function updateLiveFeedStageChange(data) {
  const feed = document.getElementById('liveFeedText');
  if (!feed) return;
  feed.innerHTML = `老師切換至 <span class="text-cyan-400 font-bold font-mono">遊戲 ${data.currentGame}</span> — <span class="text-amber-400 font-bold">關卡 ${data.currentStage}</span>，學生端畫面已同步切換！`;
}

// 老師點擊「重置遊戲」
function resetGame() {
  sound.playTick();
  if (confirm('確定要重置所有小組的分數與闖關狀態嗎？')) {
    window.revealedAnswers = {};
    socket.emit('reset_game');
  }
}

// 模擬學生得分 (供老師備課測試)
function simulateScore() {
  socket.emit('teacher_simulate_score');
}

// 切換全螢幕模式
function toggleFullScreen() {
  sound.playTick();
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => alert(`無法進入全螢幕: ${err.message}`));
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

// 切換音效
function toggleAudio() {
  sound.enabled = !sound.enabled;
  const btn = document.getElementById('audioBtn');
  btn.innerText = sound.enabled ? '🔊' : '🔇';
}

// ====================================================
// 遊戲三 (迷霧探索與二進位對決) 教師端上帝視角 (God Mode)
// ====================================================
let teacherStage3Inited = false;
let teacherStage3AnimRunning = false;
let stage3Players = {};
let stage3Scores = {};
let stage3ActiveEffects = []; // [{ p1, p2, type: 'encounter'|'battle', expire }]

const T_MAP_WIDTH = 1000;
const T_MAP_HEIGHT = 700;

const GROUP_BASE_COLORS = {
  group_1: { name: '第 1 組 (A)', code: 'A', color: '#06b6d4', spawn: { x: 180, y: 180 } },
  group_2: { name: '第 2 組 (B)', code: 'B', color: '#f59e0b', spawn: { x: 820, y: 180 } },
  group_3: { name: '第 3 組 (C)', code: 'C', color: '#10b981', spawn: { x: 180, y: 520 } },
  group_4: { name: '第 4 組 (D)', code: 'D', color: '#8b5cf6', spawn: { x: 820, y: 520 } },
  group_5: { name: '第 5 組 (E)', code: 'E', color: '#f43f5e', spawn: { x: 500, y: 180 } },
  group_6: { name: '第 6 組 (F)', code: 'F', color: '#ec4899', spawn: { x: 500, y: 520 } }
};

function initTeacherStage3() {
  if (teacherStage3Inited) {
    renderStage3Scores();
    return;
  }
  teacherStage3Inited = true;

  // 向伺服器索取初始 stage3 狀態
  socket.emit('teacher_stage3_get_state', (res) => {
    if (res && res.players) {
      stage3Players = res.players;
      stage3Scores = res.scores || {};
      renderStage3Scores();
    }
  });

  if (!teacherStage3AnimRunning) {
    teacherStage3AnimRunning = true;
    requestAnimationFrame(renderTeacherCanvasLoop);
  }
}

// 學生位置更新
socket.on('stage3_player_moved', (data) => {
  if (stage3Players[data.studentId]) {
    stage3Players[data.studentId].x = data.x;
    stage3Players[data.studentId].y = data.y;
  }
});

// 全體 stage3 狀態同步
socket.on('stage3_sync_players', (data) => {
  if (data.players) {
    stage3Players = data.players;
  }
  if (data.groupScores) {
    stage3Scores = data.groupScores;
  }
  renderStage3Scores();
});

// 遭遇碰撞光環特效
socket.on('stage3_encounter_active', (data) => {
  stage3ActiveEffects.push({
    p1: data.p1,
    p2: data.p2,
    type: 'encounter',
    expire: Date.now() + 6000
  });
});

// 對決展開特效
socket.on('stage3_battle_started', (data) => {
  stage3ActiveEffects.push({
    p1: data.p1,
    p2: data.p2,
    type: 'battle',
    expire: Date.now() + 10000
  });
});

// 即時動態戰況 Logs 訊息
socket.on('stage3_log', (data) => {
  const container = document.getElementById('stage3LogsContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'py-1 border-b border-slate-900/60 flex items-start gap-1.5 animate-fade-in';
  row.innerHTML = `
    <span class="text-slate-500 font-mono text-[10px] shrink-0">[${data.time}]</span>
    <span class="text-slate-200 text-xs">${data.text}</span>
  `;

  // 若目前只有一條提示文字，先清空
  if (container.children.length === 1 && container.children[0].classList.contains('italic')) {
    container.innerHTML = '';
  }

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
});

// 遊戲三結束廣播
socket.on('game_3_ended', (data) => {
  sound.playVictory();
  showTeacherVictoryModal(data);
});

// 繪製上帝視角畫布主循環
function renderTeacherCanvasLoop() {
  const canvas = document.getElementById('teacherCanvas');
  if (!canvas) {
    requestAnimationFrame(renderTeacherCanvasLoop);
    return;
  }
  const ctx = canvas.getContext('2d');

  // 清空畫布
  ctx.clearRect(0, 0, T_MAP_WIDTH, T_MAP_HEIGHT);

  // 1. 繪製科技網格底圖 (上帝視角無迷霧，清楚投影)
  ctx.fillStyle = '#050b14';
  ctx.fillRect(0, 0, T_MAP_WIDTH, T_MAP_HEIGHT);

  // 網格線
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.5)';
  ctx.lineWidth = 1;
  const gridSize = 50;
  for (let x = 0; x < T_MAP_WIDTH; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, T_MAP_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < T_MAP_HEIGHT; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(T_MAP_WIDTH, y);
    ctx.stroke();
  }

  // 2. 繪製各組基地標記 (Spawn Areas)
  Object.keys(GROUP_BASE_COLORS).forEach(gId => {
    const info = GROUP_BASE_COLORS[gId];
    ctx.save();
    ctx.fillStyle = info.color + '15';
    ctx.strokeStyle = info.color + '55';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(info.spawn.x, info.spawn.y, 65, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = info.color;
    ctx.textAlign = 'center';
    ctx.fillText(`${info.name} 基地`, info.spawn.x, info.spawn.y - 45);
    ctx.restore();
  });

  // 3. 繪製遭遇與對決連線動態特效
  const now = Date.now();
  stage3ActiveEffects = stage3ActiveEffects.filter(eff => eff.expire > now);
  stage3ActiveEffects.forEach(eff => {
    const p1 = stage3Players[eff.p1];
    const p2 = stage3Players[eff.p2];
    if (p1 && p2) {
      ctx.save();
      const pulse = (now % 1000) / 1000;
      if (eff.type === 'battle') {
        // 對決：雙刀紅光交鋒線
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // 中點交戰圖示
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚔️', midX, midY);
      } else {
        // 遭遇：黃金警戒連結
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚠️', midX, midY);
      }
      ctx.restore();
    }
  });

  // 4. 繪製全班 30 位學生角色 Token
  const playerList = Object.values(stage3Players);
  playerList.forEach(p => {
    ctx.save();

    // 依組別顏色繪製外發光圓圈
    const color = p.color || (GROUP_BASE_COLORS[p.groupId]?.color || '#06b6d4');

    // 外光暈
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = color + '33';
    ctx.fill();

    // 圓點核心
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 學生代碼 (例如 A1, B2)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.code || p.id, p.x, p.y);

    // 頭頂 HP 生命條
    const barW = 26;
    const barH = 3;
    const hpRatio = Math.max(0, Math.min(100, p.hp)) / 100;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(p.x - barW / 2, p.y - 20, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? '#34d399' : '#f87171';
    ctx.fillRect(p.x - barW / 2, p.y - 20, barW * hpRatio, barH);

    // 底部文字標籤：學號 + 對決次數 (如 s01 [2/3])
    ctx.font = '9px sans-serif';
    ctx.fillStyle = p.competeCount >= 3 ? '#34d399' : '#cbd5e1';
    const tag = `${p.id} (${p.competeCount}/3)`;
    ctx.fillText(tag, p.x, p.y + 20);

    ctx.restore();
  });

  requestAnimationFrame(renderTeacherCanvasLoop);
}

// 渲染右側各組二進位積分板
function renderStage3Scores() {
  const container = document.getElementById('stage3GroupScoresList');
  if (!container || !currentGameState || !currentGameState.groups) return;

  container.innerHTML = '';
  const groupKeys = Object.keys(currentGameState.groups);

  groupKeys.forEach((gId, idx) => {
    const group = currentGameState.groups[gId];
    const score = group.score || 0;
    const binaryStr = score.toString(2);
    const meta = GROUP_BASE_COLORS[gId] || { name: group.name, color: '#38bdf8' };

    // 計算組員完成度 (幾位完成 3 次)
    const members = group.members || [];
    let completedMembers = 0;
    members.forEach(mId => {
      const p = stage3Players[mId];
      if (p && p.competeCount >= 3) completedMembers++;
    });

    const isFinished = members.length > 0 && completedMembers === members.length;

    const card = document.createElement('div');
    card.className = `p-3 rounded-xl border transition-all ${
      isFinished 
        ? 'bg-emerald-950/30 border-emerald-500/50' 
        : 'bg-slate-950 border-slate-800'
    }`;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${meta.color}"></span>
          <span class="font-bold text-xs text-white">${meta.name}</span>
          ${isFinished ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">全體完賽</span>' : ''}
        </div>
        <div class="text-[10px] font-mono text-slate-400">
          組員對決進度：<b class="${completedMembers === members.length ? 'text-emerald-400' : 'text-amber-400'}">${completedMembers}/${members.length}</b> 人完成
        </div>
      </div>
      <div class="flex items-center justify-between bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
        <div>
          <div class="text-[9px] text-slate-400 uppercase font-mono">二進位即時總分</div>
          <div class="font-mono text-lg font-black text-cyan-300 tracking-wider">${binaryStr}</div>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 block">十進位解答</span>
          <span class="font-mono font-bold text-sm text-yellow-400 ${showAllAnswers ? '' : 'hidden'}" id="s3_dec_${gId}">
            ${score} 分
          </span>
          <button onclick="toggleSingleAnswer('s3_dec_${gId}')" class="text-[10px] text-cyan-400 hover:text-cyan-300 underline block ${showAllAnswers ? 'hidden' : ''}">
            點擊查看
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function toggleSingleAnswer(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.toggle('hidden');
  }
}

// 教師模擬隨機對決
function simulateGame3Battle() {
  sound.playScoreGained();
  socket.emit('teacher_simulate_game3_battle');
}

// 教師手動結束遊戲三
function endGame3Manual() {
  if (confirm('確定要提前結算「遊戲三：迷霧對決」並宣布勝利小組嗎？')) {
    sound.playVictory();
    socket.emit('teacher_end_game3');
  }
}

// 教師勝利大彈窗顯示
function showTeacherVictoryModal(data) {
  const modal = document.getElementById('teacherVictoryModal');
  document.getElementById('tvmReason').innerText = data.reason || '競賽達成結算條件！';

  if (data.winner) {
    document.getElementById('tvmWinnerName').innerText = data.winner.name;
    document.getElementById('tvmWinnerBinary').innerText = data.winner.binaryScore;
    document.getElementById('tvmWinnerDecimal').innerText = `${data.winner.score} 分`;
  }
  if (data.runnerUp) {
    document.getElementById('tvmRunnerUpName').innerText = data.runnerUp.name;
    document.getElementById('tvmRunnerUpBinary').innerText = data.runnerUp.binaryScore;
    document.getElementById('tvmRunnerUpDecimal').innerText = `${data.runnerUp.score} 分`;
  }

  // 排行清單
  const list = document.getElementById('tvmRankingsList');
  list.innerHTML = '';
  if (data.rankings) {
    data.rankings.forEach((g, idx) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between items-center py-1 border-b border-slate-900';
      row.innerHTML = `
        <span class="${idx === 0 ? 'text-yellow-400 font-bold' : (idx === 1 ? 'text-slate-300 font-bold' : 'text-slate-400')}">
          第 ${idx + 1} 名：${g.name}
        </span>
        <div class="flex items-center gap-3">
          <span class="text-cyan-400 font-mono font-bold">二進位: ${g.binaryScore}</span>
          <span class="text-slate-500 font-mono text-[11px]">(十進位: ${g.score}分)</span>
        </div>
      `;
      list.appendChild(row);
    });
  }

  modal.classList.remove('hidden');
}

function toggleModalDecimal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}

function closeTeacherVictoryModal() {
  document.getElementById('teacherVictoryModal').classList.add('hidden');
}

