const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 遊戲三專用：16 題二進位題庫 (包含 bin2dec 與 dec2bin，數字 <= 100)
const binaryQuestionBank = [
  { id: 1, type: 'bin2dec', question: '1101_2', answer: '13', hint: '8 + 4 + 1' },
  { id: 2, type: 'dec2bin', question: '25', answer: '11001', hint: '16 + 8 + 1' },
  { id: 3, type: 'bin2dec', question: '101010_2', answer: '42', hint: '32 + 8 + 2' },
  { id: 4, type: 'dec2bin', question: '63', answer: '111111', hint: '32 + 16 + 8 + 4 + 2 + 1' },
  { id: 5, type: 'bin2dec', question: '10011_2', answer: '19', hint: '16 + 2 + 1' },
  { id: 6, type: 'dec2bin', question: '36', answer: '100100', hint: '32 + 4' },
  { id: 7, type: 'bin2dec', question: '111000_2', answer: '56', hint: '32 + 16 + 8' },
  { id: 8, type: 'dec2bin', question: '77', answer: '1001101', hint: '64 + 8 + 4 + 1' },
  { id: 9, type: 'bin2dec', question: '101101_2', answer: '45', hint: '32 + 8 + 4 + 1' },
  { id: 10, type: 'dec2bin', question: '50', answer: '110010', hint: '32 + 16 + 2' },
  { id: 11, type: 'bin2dec', question: '11110_2', answer: '30', hint: '16 + 8 + 4 + 2' },
  { id: 12, type: 'dec2bin', question: '85', answer: '1010101', hint: '64 + 16 + 4 + 1' },
  { id: 13, type: 'bin2dec', question: '1000101_2', answer: '69', hint: '64 + 4 + 1' },
  { id: 14, type: 'dec2bin', question: '99', answer: '1100011', hint: '64 + 32 + 2 + 1' },
  { id: 15, type: 'bin2dec', question: '101111_2', answer: '47', hint: '32 + 8 + 4 + 2 + 1' },
  { id: 16, type: 'dec2bin', question: '18', answer: '10010', hint: '16 + 2' }
];

const GROUP_META = [
  { name: '第 1 組', code: 'A', color: '#06b6d4', spawn: { x: 180, y: 180 } },
  { name: '第 2 組', code: 'B', color: '#f59e0b', spawn: { x: 820, y: 180 } },
  { name: '第 3 組', code: 'C', color: '#10b981', spawn: { x: 180, y: 520 } },
  { name: '第 4 組', code: 'D', color: '#8b5cf6', spawn: { x: 820, y: 520 } },
  { name: '第 5 組', code: 'E', color: '#f43f5e', spawn: { x: 500, y: 180 } },
  { name: '第 6 組', code: 'F', color: '#ec4899', spawn: { x: 500, y: 520 } }
];

// 系統核心狀態
let gameState = {
  status: 'waiting',    // 'waiting' | 'in_progress' | 'ended'
  currentGame: 1,       // 目前發布的遊戲模組編號 (1 = game1.html, 2 = game2.html, 3 = game3.html)
  currentStage: 1,      // 目前關卡編號 (給同一遊戲內的多關卡使用)
  numStudents: 30,
  numGroups: 5,
  groups: {},   // { group_1: { id: 'group_1', name: '第 1 組', members: ['s01', ...], score: 0 }, ... }
  students: {}, // { s01: { id: 's01', groupId: 'group_1', socketId: null, online: false, stage1Score: null, stage2Score: null, totalScore: 0, finished: false } }
  stage3: {
    questionBank: binaryQuestionBank,
    players: {},
    scores: {},
    activeEncounters: {},
    activeBattles: {},
    cooldowns: {},
    ended: false
  }
};

// 初始化預設分組
function initializeDefaultGroups(numStudents = 30, numGroups = 5) {
  gameState.numStudents = numStudents;
  gameState.numGroups = numGroups;
  gameState.groups = {};
  gameState.students = {};

  for (let g = 1; g <= numGroups; g++) {
    const groupId = `group_${g}`;
    gameState.groups[groupId] = {
      id: groupId,
      name: `第 ${g} 組`,
      members: [],
      score: 0
    };
  }

  for (let i = 1; i <= numStudents; i++) {
    const studentId = `s${String(i).padStart(2, '0')}`;
    const groupNum = ((i - 1) % numGroups) + 1;
    const groupId = `group_${groupNum}`;
    
    gameState.students[studentId] = {
      id: studentId,
      groupId: groupId,
      socketId: null,
      online: false,
      stage1Score: null,
      stage2Score: null,
      totalScore: 0,
      finished: false
    };
    gameState.groups[groupId].members.push(studentId);
  }

  initStage3Players();
}

// 初始化遊戲三地圖角色與狀態
function initStage3Players() {
  gameState.stage3.players = {};
  gameState.stage3.scores = {};
  gameState.stage3.activeEncounters = {};
  gameState.stage3.activeBattles = {};
  gameState.stage3.cooldowns = {};
  gameState.stage3.ended = false;

  Object.keys(gameState.groups).forEach(gId => {
    gameState.stage3.scores[gId] = 0;
  });

  const groupKeys = Object.keys(gameState.groups);
  groupKeys.forEach((gId, gIdx) => {
    const meta = GROUP_META[gIdx % GROUP_META.length];
    const members = gameState.groups[gId].members || [];
    members.forEach((sId, mIdx) => {
      const angle = (mIdx / Math.max(1, members.length)) * Math.PI * 2;
      const dist = 32 + (mIdx % 2) * 18;
      const x = Math.round(Math.max(50, Math.min(950, meta.spawn.x + Math.cos(angle) * dist)));
      const y = Math.round(Math.max(50, Math.min(650, meta.spawn.y + Math.sin(angle) * dist)));

      gameState.stage3.players[sId] = {
        id: sId,
        groupId: gId,
        code: `${meta.code}${mIdx + 1}`,
        color: meta.color,
        x: x,
        y: y,
        hp: 100,
        competeCount: 0,
        battledOpponents: [],
        activeEncounter: null,
        activeBattle: null
      };
    });
  });
}

// 預先產生預設 30 人 5 組
initializeDefaultGroups(30, 5);

// API: 取得當前伺服器 IP / 狀態 (方便教室投影顯示連線網址)
app.get('/api/info', (req, res) => {
  res.json({
    status: gameState.status,
    numStudents: gameState.numStudents,
    numGroups: gameState.numGroups
  });
});

io.on('connection', (socket) => {
  // 發送目前狀態給新連線的客戶端
  socket.emit('state_sync', gameState);

  // 老師登入驗證
  socket.on('teacher_auth', (data, callback) => {
    if (data.username === 't01' && data.password === 't01') {
      socket.join('teachers');
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, message: '帳號或密碼錯誤' });
    }
  });

  // 學生加入
  socket.on('student_join', (data) => {
    const studentId = (data.studentId || '').trim().toLowerCase();
    if (!studentId) return;

    // 若學生不在既有名單內，自動登記
    if (!gameState.students[studentId]) {
      const groupKeys = Object.keys(gameState.groups);
      const randomGroup = groupKeys.length > 0 ? groupKeys[0] : 'group_1';
      gameState.students[studentId] = {
        id: studentId,
        groupId: randomGroup,
        socketId: socket.id,
        online: true,
        stage1Score: null,
        stage2Score: null,
        totalScore: 0,
        finished: false
      };
      if (gameState.groups[randomGroup]) {
        gameState.groups[randomGroup].members.push(studentId);
      }
    } else {
      gameState.students[studentId].socketId = socket.id;
      gameState.students[studentId].online = true;
    }

    socket.studentId = studentId;
    socket.join('students');
    socket.join(gameState.students[studentId].groupId);

    // 回傳該學生的完整狀態
    socket.emit('student_ready', {
      student: gameState.students[studentId],
      group: gameState.groups[gameState.students[studentId].groupId],
      gameState: gameState
    });

    // 廣播給老師端更新連線名單
    io.to('teachers').emit('student_status_changed', {
      studentId: studentId,
      online: true,
      students: gameState.students
    });
  });

  // 老師點擊「隨機分組」
  socket.on('generate_groups', (data) => {
    const numStudents = Math.max(2, Math.min(60, parseInt(data.numStudents) || 30));
    const numGroups = Math.max(2, Math.min(12, parseInt(data.numGroups) || 5));

    gameState.status = 'waiting';
    gameState.numStudents = numStudents;
    gameState.numGroups = numGroups;
    gameState.groups = {};
    gameState.students = {};

    // 產生 s01 到 sN 學號並打散
    const studentIds = [];
    for (let i = 1; i <= numStudents; i++) {
      studentIds.push(`s${String(i).padStart(2, '0')}`);
    }

    // Fisher-Yates 洗牌
    for (let i = studentIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [studentIds[i], studentIds[j]] = [studentIds[j], studentIds[i]];
    }

    // 建立組別
    for (let g = 1; g <= numGroups; g++) {
      const groupId = `group_${g}`;
      gameState.groups[groupId] = {
        id: groupId,
        name: `第 ${g} 組`,
        members: [],
        score: 0
      };
    }

    // 分配學生
    studentIds.forEach((studentId, idx) => {
      const groupNum = (idx % numGroups) + 1;
      const groupId = `group_${groupNum}`;

      gameState.students[studentId] = {
        id: studentId,
        groupId: groupId,
        socketId: null,
        online: false,
        stage1Score: null,
        stage2Score: null,
        totalScore: 0,
        finished: false
      };
      gameState.groups[groupId].members.push(studentId);
    });

    initStage3Players();

    // 全體廣播新狀態
    io.emit('state_sync', gameState);
  });

  // 老師點擊「開始遊戲」（可帶入指定 game 與 stage）
  socket.on('start_game', (data) => {
    gameState.status = 'in_progress';
    // 若老師指定了遊戲模組 / 關卡，則更新；否則沿用目前設定
    if (data && data.game)  gameState.currentGame  = parseInt(data.game)  || 1;
    if (data && data.stage) gameState.currentStage = parseInt(data.stage) || 1;

    io.emit('game_started', {
      currentGame:  gameState.currentGame,
      currentStage: gameState.currentStage
    });
    io.emit('state_sync', gameState);
  });

  // 老師手動切換關卡（不重置進度，直接跳至指定 stage）
  socket.on('select_stage', (data) => {
    const stage = parseInt(data.stage) || 1;
    gameState.currentStage = stage;
    // 確保狀態為進行中
    if (gameState.status !== 'in_progress') gameState.status = 'in_progress';

    io.emit('stage_changed', {
      currentGame:  gameState.currentGame,
      currentStage: gameState.currentStage
    });
    io.emit('state_sync', gameState);
  });

  // 老師切換遊戲模組（game1 ↔ game2 ...）
  socket.on('switch_game', (data) => {
    const game = parseInt(data.game) || 1;
    gameState.currentGame  = game;
    gameState.currentStage = 1;   // 切換新遊戲時重置關卡為第 1 關
    // 狀態維持原樣，讓老師能預先挑選遊戲，待按下「開始遊戲」時才正式啟動

    io.emit('game_switched', {
      currentGame:  gameState.currentGame,
      currentStage: gameState.currentStage
    });
    io.emit('state_sync', gameState);
  });

  // 老師點擊「重置遊戲」
  socket.on('reset_game', () => {
    gameState.status = 'waiting';
    Object.keys(gameState.groups).forEach(gId => {
      gameState.groups[gId].score = 0;
    });
    Object.keys(gameState.students).forEach(sId => {
      gameState.students[sId].stage1Score = null;
      gameState.students[sId].stage2Score = null;
      gameState.students[sId].totalScore = 0;
      gameState.students[sId].finished = false;
    });

    initStage3Players();

    io.emit('game_reset');
    io.emit('state_sync', gameState);
  });

  // 學生提交第一關分數 (字母輸入速度挑戰)
  socket.on('submit_stage1', (data) => {
    const studentId = data.studentId;
    const score = Math.max(0, Math.min(3, parseInt(data.score) || 0));
    const timeTaken = parseFloat(data.timeTaken) || 0;

    const student = gameState.students[studentId];
    if (student && student.stage1Score === null) {
      student.stage1Score = score;
      student.totalScore += score;
      
      const group = gameState.groups[student.groupId];
      if (group) {
        group.score += score;
        
        io.emit('update_teacher_score', {
          groupId: group.id,
          totalScore: group.score,
          binaryScore: group.score.toString(2),
          studentId: studentId,
          stage: 1,
          earnedScore: score,
          timeTaken: timeTaken
        });
      }
    }
  });

  // 學生提交第二關分數 (硬體配對知識)
  socket.on('submit_stage2', (data) => {
    const studentId = data.studentId;
    const score = Math.max(0, Math.min(5, parseInt(data.score) || 0));

    const student = gameState.students[studentId];
    if (student && student.stage2Score === null) {
      student.stage2Score = score;
      student.totalScore += score;
      student.finished = true;

      const group = gameState.groups[student.groupId];
      if (group) {
        group.score += score;

        io.emit('update_teacher_score', {
          groupId: group.id,
          totalScore: group.score,
          binaryScore: group.score.toString(2),
          studentId: studentId,
          stage: 2,
          earnedScore: score
        });
      }
    }
  });

  // 老師專用模擬測試：模擬隨機學生送出分數
  socket.on('teacher_simulate_score', () => {
    const studentKeys = Object.keys(gameState.students);
    if (studentKeys.length === 0) return;

    const randomStudentId = studentKeys[Math.floor(Math.random() * studentKeys.length)];
    const student = gameState.students[randomStudentId];
    const group = gameState.groups[student.groupId];
    if (!group) return;

    const randomPoints = [1, 2, 3, 5][Math.floor(Math.random() * 4)];
    group.score += randomPoints;
    student.totalScore += randomPoints;

    io.emit('update_teacher_score', {
      groupId: group.id,
      totalScore: group.score,
      binaryScore: group.score.toString(2),
      studentId: randomStudentId,
      stage: Math.random() > 0.5 ? 1 : 2,
      earnedScore: randomPoints,
      simulated: true
    });
  });

  // ====================================================
  // 遊戲三 (迷霧探索與二進位對決) Socket 事件與核心邏輯
  // ====================================================

  // 學生端進入遊戲三請求初始化資料
  socket.on('stage3_init', (data, callback) => {
    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    let player = gameState.stage3.players[studentId];
    if (!player && gameState.students[studentId]) {
      const gId = gameState.students[studentId].groupId;
      const gIdx = parseInt(gId.replace('group_', '')) - 1;
      const meta = GROUP_META[gIdx % GROUP_META.length] || GROUP_META[0];
      player = {
        id: studentId,
        groupId: gId,
        code: `${meta.code}?`,
        color: meta.color,
        x: meta.spawn.x + (Math.random() - 0.5) * 40,
        y: meta.spawn.y + (Math.random() - 0.5) * 40,
        hp: 100,
        competeCount: 0,
        battledOpponents: [],
        activeEncounter: null,
        activeBattle: null
      };
      gameState.stage3.players[studentId] = player;
    }

    const payload = {
      player: player || null,
      allPlayers: gameState.stage3.players,
      groupScores: gameState.stage3.scores,
      mapSize: { width: 1000, height: 700 }
    };
    if (typeof callback === 'function') callback(payload);
    socket.emit('stage3_ready', payload);
  });

  // 學生端傳送移動位置
  socket.on('player_move', (data) => {
    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    if (!studentId || !gameState.stage3.players[studentId]) return;

    const player = gameState.stage3.players[studentId];
    if (player.activeEncounter || player.activeBattle) return; // 鎖定行動

    player.x = Math.max(20, Math.min(980, parseFloat(data.x) || player.x));
    player.y = Math.max(20, Math.min(680, parseFloat(data.y) || player.y));

    // 上帝視角：同步位置給所有在 teachers 房間的教師端
    io.to('teachers').emit('stage3_player_moved', {
      studentId: player.id,
      x: player.x,
      y: player.y
    });

    // 若遊戲三進行中且該玩家未達 3 次上限，進行碰撞偵測
    if (gameState.currentGame === 3 && gameState.status === 'in_progress' && player.competeCount < 3) {
      checkEncounter(player);
    }
  });

  // 遭遇偵測判定函式
  function checkEncounter(p1) {
    if (p1.activeEncounter || p1.activeBattle || p1.competeCount >= 3) return;

    const otherIds = Object.keys(gameState.stage3.players);
    for (const p2Id of otherIds) {
      if (p2Id === p1.id) continue;
      const p2 = gameState.stage3.players[p2Id];
      if (!p2) continue;

      // 必須是不同組別
      if (p2.groupId === p1.groupId) continue;

      // 對手也必須未達 3 次上限
      if (p2.competeCount >= 3) continue;

      // 雙方皆未處於其他遭遇或對決中
      if (p2.activeEncounter || p2.activeBattle) continue;

      // 玩家不可與同一位對手重複觸發對決
      if (p1.battledOpponents.includes(p2.id) || p2.battledOpponents.includes(p1.id)) continue;

      // 冷卻時間檢查
      const pairKey = [p1.id, p2.id].sort().join('_');
      if (gameState.stage3.cooldowns[pairKey] && Date.now() < gameState.stage3.cooldowns[pairKey]) continue;

      // 距離判定 (45px 內視為碰撞)
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 45) {
        const encId = 'enc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        gameState.stage3.activeEncounters[encId] = {
          id: encId,
          p1: p1.id,
          p2: p2.id,
          choices: {},
          timestamp: Date.now()
        };
        p1.activeEncounter = encId;
        p2.activeEncounter = encId;

        const s1Socket = gameState.students[p1.id]?.socketId;
        const s2Socket = gameState.students[p2.id]?.socketId;

        if (s1Socket) {
          io.to(s1Socket).emit('encounter_triggered', {
            encounterId: encId,
            opponent: {
              id: p2.id,
              code: p2.code,
              groupId: p2.groupId,
              groupName: gameState.groups[p2.groupId]?.name || p2.groupId,
              color: p2.color,
              hp: p2.hp,
              competeCount: p2.competeCount
            }
          });
        }

        if (s2Socket) {
          io.to(s2Socket).emit('encounter_triggered', {
            encounterId: encId,
            opponent: {
              id: p1.id,
              code: p1.code,
              groupId: p1.groupId,
              groupName: gameState.groups[p1.groupId]?.name || p1.groupId,
              color: p1.color,
              hp: p1.hp,
              competeCount: p1.competeCount
            }
          });
        }

        io.to('teachers').emit('stage3_log', {
          time: new Date().toLocaleTimeString(),
          text: `⚡ 遭遇觸發：${p1.id} (${p1.code}) 與 ${p2.id} (${p2.code}) 相遇！請選擇行動。`
        });
        io.to('teachers').emit('stage3_encounter_active', { p1: p1.id, p2: p2.id, encId });
        break;
      }
    }
  }

  // 學生送出行動抉擇：[🤝 合作補血] 或 [⚔️ 競爭對決]
  socket.on('submit_action', (data) => {
    const encId = data?.encounterId;
    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    const action = data?.action === 'compete' ? 'compete' : 'cooperate';

    const encounter = gameState.stage3.activeEncounters[encId];
    if (!encounter) return;

    encounter.choices[studentId] = action;

    const opponentId = encounter.p1 === studentId ? encounter.p2 : encounter.p1;
    const oppSocket = gameState.students[opponentId]?.socketId;
    if (oppSocket) {
      io.to(oppSocket).emit('opponent_action_waiting', { opponentId: studentId });
    }

    // 雙方皆已做出選擇
    if (encounter.choices[encounter.p1] && encounter.choices[encounter.p2]) {
      const p1 = gameState.stage3.players[encounter.p1];
      const p2 = gameState.stage3.players[encounter.p2];
      const choice1 = encounter.choices[encounter.p1];
      const choice2 = encounter.choices[encounter.p2];

      const s1Socket = gameState.students[p1.id]?.socketId;
      const s2Socket = gameState.students[p2.id]?.socketId;

      delete gameState.stage3.activeEncounters[encId];

      if (choice1 === 'cooperate' && choice2 === 'cooperate') {
        // 雙方合作補血
        const prevHp1 = p1.hp;
        const prevHp2 = p2.hp;
        p1.hp = Math.min(100, p1.hp + 20);
        p2.hp = Math.min(100, p2.hp + 20);
        p1.activeEncounter = null;
        p2.activeEncounter = null;

        // 設定 8 秒冷卻避免重複連續觸發
        const pairKey = [p1.id, p2.id].sort().join('_');
        gameState.stage3.cooldowns[pairKey] = Date.now() + 8000;

        const p1Msg = prevHp1 >= 100
          ? '雙方達成 [🤝 合作]！由於您目前已滿血，未獲得血量恢復與分數。'
          : `雙方達成 [🤝 合作]！血量成功恢復 +20 (目前 HP: ${p1.hp})！`;
        const p2Msg = prevHp2 >= 100
          ? '雙方達成 [🤝 合作]！由於您目前已滿血，未獲得血量恢復與分數。'
          : `雙方達成 [🤝 合作]！血量成功恢復 +20 (目前 HP: ${p2.hp})！`;

        if (s1Socket) io.to(s1Socket).emit('encounter_result', { type: 'cooperate', message: p1Msg, hp: p1.hp, opponentChoice: 'cooperate' });
        if (s2Socket) io.to(s2Socket).emit('encounter_result', { type: 'cooperate', message: p2Msg, hp: p2.hp, opponentChoice: 'cooperate' });

        io.to('teachers').emit('stage3_log', {
          time: new Date().toLocaleTimeString(),
          text: `🤝 合作補血成功：${p1.id} 與 ${p2.id} 皆選擇合作，各自恢復 20 HP！`
        });
        io.to('teachers').emit('stage3_sync_players', { players: gameState.stage3.players });
      } else {
        // 任一方或雙方選擇競爭 -> 觸發二進位搶答對決！
        p1.activeEncounter = null;
        p2.activeEncounter = null;

        // 伺服器題庫隨機抽出 2 道不重複題目派發
        const shuffled = [...binaryQuestionBank].sort(() => 0.5 - Math.random());
        const battleQuestions = [shuffled[0], shuffled[1]];
        // 派發給前端時不包含答案
        const clientQuestions = battleQuestions.map(q => ({ id: q.id, type: q.type, question: q.question }));

        const battleId = 'bat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        gameState.stage3.activeBattles[battleId] = {
          id: battleId,
          p1: p1.id,
          p2: p2.id,
          questions: battleQuestions,
          submissions: {},
          startTime: Date.now()
        };

        p1.activeBattle = battleId;
        p2.activeBattle = battleId;
        p1.battledOpponents.push(p2.id);
        p2.battledOpponents.push(p1.id);
        p1.competeCount++;
        p2.competeCount++;

        if (s1Socket) {
          io.to(s1Socket).emit('start_quiz_battle', {
            battleId,
            opponent: { id: p2.id, code: p2.code, groupId: p2.groupId, groupName: gameState.groups[p2.groupId]?.name, color: p2.color },
            questions: clientQuestions,
            opponentChoice: choice2
          });
        }
        if (s2Socket) {
          io.to(s2Socket).emit('start_quiz_battle', {
            battleId,
            opponent: { id: p1.id, code: p1.code, groupId: p1.groupId, groupName: gameState.groups[p1.groupId]?.name, color: p1.color },
            questions: clientQuestions,
            opponentChoice: choice1
          });
        }

        io.to('teachers').emit('stage3_log', {
          time: new Date().toLocaleTimeString(),
          text: `⚔️ 二進位對決：${p1.id} (${p1.code}) VS ${p2.id} (${p2.code}) 展開！(對決進度: ${p1.competeCount}/3 與 ${p2.competeCount}/3)`
        });
        io.to('teachers').emit('stage3_battle_started', { p1: p1.id, p2: p2.id, battleId });
        io.to('teachers').emit('stage3_sync_players', { players: gameState.stage3.players });
      }
    }
  });

  // 學生提交二進位對決答案
  socket.on('submit_quiz_answer', (data) => {
    const battleId = data?.battleId;
    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    const answers = data?.answers || {};
    const timeTaken = Math.max(0.5, parseFloat(data?.timeTaken) || 10);

    const battle = gameState.stage3.activeBattles[battleId];
    if (!battle) return;

    // 核對答案
    let correctCount = 0;
    battle.questions.forEach(q => {
      const userAns = (answers[q.id] || '').toString().trim();
      if (userAns === q.answer.trim()) {
        correctCount++;
      }
    });

    battle.submissions[studentId] = {
      answers,
      timeTaken,
      correctCount
    };

    const opponentId = battle.p1 === studentId ? battle.p2 : battle.p1;
    const oppSocket = gameState.students[opponentId]?.socketId;
    if (oppSocket) {
      io.to(oppSocket).emit('opponent_quiz_submitted', { opponentId: studentId });
    }

    // 雙方皆已提交，進行勝負與計分結算
    if (battle.submissions[battle.p1] && battle.submissions[battle.p2]) {
      finishQuizBattle(battleId);
    }
  });

  // 結算二進位對決
  function finishQuizBattle(battleId) {
    const battle = gameState.stage3.activeBattles[battleId];
    if (!battle) return;

    delete gameState.stage3.activeBattles[battleId];

    const p1 = gameState.stage3.players[battle.p1];
    const p2 = gameState.stage3.players[battle.p2];
    if (!p1 || !p2) return;

    p1.activeBattle = null;
    p2.activeBattle = null;

    const sub1 = battle.submissions[p1.id] || { correctCount: 0, timeTaken: 99 };
    const sub2 = battle.submissions[p2.id] || { correctCount: 0, timeTaken: 99 };

    let p1Score = 0;
    let p2Score = 0;
    let p1HpLoss = 0;
    let p2HpLoss = 0;
    let winner = null;

    // 根據正確率與解題耗時計算：
    // 速度快且答對者：2分，並扣除對方少量 HP (-15 HP)
    // 速度較慢但答對者：1分
    // 答錯或超時者：0分
    if (sub1.correctCount > sub2.correctCount) {
      p1Score = 2;
      p2Score = sub2.correctCount > 0 ? 1 : 0;
      p2HpLoss = 15;
      winner = p1.id;
    } else if (sub2.correctCount > sub1.correctCount) {
      p2Score = 2;
      p1Score = sub1.correctCount > 0 ? 1 : 0;
      p1HpLoss = 15;
      winner = p2.id;
    } else {
      // 答對題數相同
      if (sub1.correctCount === 0) {
        p1Score = 0;
        p2Score = 0;
        winner = 'draw';
      } else {
        if (sub1.timeTaken < sub2.timeTaken) {
          p1Score = 2;
          p2Score = 1;
          p2HpLoss = 15;
          winner = p1.id;
        } else if (sub2.timeTaken < sub1.timeTaken) {
          p2Score = 2;
          p1Score = 1;
          p1HpLoss = 15;
          winner = p2.id;
        } else {
          p1Score = 2;
          p2Score = 2;
          winner = 'tie';
        }
      }
    }

    p1.hp = Math.max(0, p1.hp - p1HpLoss);
    p2.hp = Math.max(0, p2.hp - p2HpLoss);

    // 團隊得分累加
    if (gameState.groups[p1.groupId]) gameState.groups[p1.groupId].score += p1Score;
    if (gameState.groups[p2.groupId]) gameState.groups[p2.groupId].score += p2Score;
    gameState.stage3.scores[p1.groupId] = (gameState.stage3.scores[p1.groupId] || 0) + p1Score;
    gameState.stage3.scores[p2.groupId] = (gameState.stage3.scores[p2.groupId] || 0) + p2Score;

    const questionsReview = battle.questions.map(q => ({
      id: q.id,
      type: q.type,
      question: q.question,
      answer: q.answer
    }));

    const s1Socket = gameState.students[p1.id]?.socketId;
    const s2Socket = gameState.students[p2.id]?.socketId;

    if (s1Socket) {
      io.to(s1Socket).emit('battle_result', {
        winner,
        isWinner: winner === p1.id,
        isDraw: winner === 'draw' || winner === 'tie',
        earnedScore: p1Score,
        hpLoss: p1HpLoss,
        myHp: p1.hp,
        myCorrect: sub1.correctCount,
        myTime: sub1.timeTaken,
        myCompeteCount: p1.competeCount,
        opponentId: p2.id,
        opponentCode: p2.code,
        opponentScore: p2Score,
        opponentCorrect: sub2.correctCount,
        opponentTime: sub2.timeTaken,
        questions: questionsReview
      });
    }

    if (s2Socket) {
      io.to(s2Socket).emit('battle_result', {
        winner,
        isWinner: winner === p2.id,
        isDraw: winner === 'draw' || winner === 'tie',
        earnedScore: p2Score,
        hpLoss: p2HpLoss,
        myHp: p2.hp,
        myCorrect: sub2.correctCount,
        myTime: sub2.timeTaken,
        myCompeteCount: p2.competeCount,
        opponentId: p1.id,
        opponentCode: p1.code,
        opponentScore: p1Score,
        opponentCorrect: sub1.correctCount,
        opponentTime: sub1.timeTaken,
        questions: questionsReview
      });
    }

    // 廣播給教師大螢幕更新得分
    if (gameState.groups[p1.groupId]) {
      io.emit('update_teacher_score', {
        groupId: p1.groupId,
        totalScore: gameState.groups[p1.groupId].score,
        binaryScore: gameState.groups[p1.groupId].score.toString(2),
        studentId: p1.id,
        stage: 3,
        earnedScore: p1Score,
        timeTaken: sub1.timeTaken
      });
    }
    if (gameState.groups[p2.groupId]) {
      io.emit('update_teacher_score', {
        groupId: p2.groupId,
        totalScore: gameState.groups[p2.groupId].score,
        binaryScore: gameState.groups[p2.groupId].score.toString(2),
        studentId: p2.id,
        stage: 3,
        earnedScore: p2Score,
        timeTaken: sub2.timeTaken
      });
    }

    const winDesc = winner === 'draw' ? '雙方答錯平手' : (winner === 'tie' ? '同分同速平手' : `${winner} 獲勝！`);
    io.to('teachers').emit('stage3_log', {
      time: new Date().toLocaleTimeString(),
      text: `🏆 對決結果：${winDesc} ｜ ${p1.id}(+${p1Score}分, 剩餘HP ${p1.hp}) VS ${p2.id}(+${p2Score}分, 剩餘HP ${p2.hp})`
    });
    io.to('teachers').emit('stage3_sync_players', {
      players: gameState.stage3.players,
      groupScores: gameState.stage3.scores
    });

    // 檢查遊戲結束條件
    checkGame3End();
  }

  // 檢查遊戲三結束條件 (任一組全員滿 3 次 或 全班滿 3 次)
  function checkGame3End(force = false) {
    if (gameState.stage3.ended) return;

    let anyGroupFinished = false;
    let allFinished = true;
    let finishedGroupId = null;

    Object.keys(gameState.groups).forEach(gId => {
      const group = gameState.groups[gId];
      if (group.members && group.members.length > 0) {
        const groupMembersAllDone = group.members.every(mId => {
          const p = gameState.stage3.players[mId];
          return p && p.competeCount >= 3;
        });
        if (groupMembersAllDone) {
          anyGroupFinished = true;
          finishedGroupId = gId;
        }
      }
    });

    const studentKeys = Object.keys(gameState.students);
    if (studentKeys.length > 0) {
      allFinished = studentKeys.every(sId => {
        const p = gameState.stage3.players[sId];
        return p && p.competeCount >= 3;
      });
    }

    if (force || anyGroupFinished || allFinished) {
      gameState.stage3.ended = true;

      // 結算小組排行
      const groupList = Object.keys(gameState.groups).map(gId => {
        const g = gameState.groups[gId];
        return {
          id: g.id,
          name: g.name,
          score: g.score,
          binaryScore: g.score.toString(2),
          members: g.members
        };
      }).sort((a, b) => b.score - a.score);

      const winner = groupList[0];
      const runnerUp = groupList.length > 1 ? groupList[1] : null;

      io.emit('game_3_ended', {
        reason: force ? '教師手動宣布結算！' : (anyGroupFinished ? `${gameState.groups[finishedGroupId]?.name || finishedGroupId} 全組成員完成 3 次競爭對決！` : '全班所有學生完成 3 次競爭對決！'),
        winner,
        runnerUp,
        rankings: groupList
      });

      io.to('teachers').emit('stage3_log', {
        time: new Date().toLocaleTimeString(),
        text: `🎉【遊戲三結算】冠軍：${winner?.name} (二進位總分: ${winner?.binaryScore} / 十進位: ${winner?.score}分)！`
      });
    }
  }

  // 教師端請求完整 stage3 狀態
  socket.on('teacher_stage3_get_state', (callback) => {
    if (typeof callback === 'function') {
      callback({
        players: gameState.stage3.players,
        scores: gameState.stage3.scores,
        ended: gameState.stage3.ended,
        mapSize: { width: 1000, height: 700 }
      });
    }
  });

  // 教師端模擬隨機對決 (方便單人教學示範)
  socket.on('teacher_simulate_game3_battle', () => {
    const studentKeys = Object.keys(gameState.stage3.players).filter(sId => {
      const p = gameState.stage3.players[sId];
      return p && p.competeCount < 3;
    });

    if (studentKeys.length < 2) return;

    // 隨機選一位
    const s1Id = studentKeys[Math.floor(Math.random() * studentKeys.length)];
    const p1 = gameState.stage3.players[s1Id];

    // 選不同組的一位
    const opponents = studentKeys.filter(sId => {
      const p = gameState.stage3.players[sId];
      return p.groupId !== p1.groupId && !p1.battledOpponents.includes(sId);
    });

    if (opponents.length === 0) return;
    const s2Id = opponents[Math.floor(Math.random() * opponents.length)];
    const p2 = gameState.stage3.players[s2Id];

    // 隨機抽 2 題
    const shuffled = [...binaryQuestionBank].sort(() => 0.5 - Math.random());
    const battleQuestions = [shuffled[0], shuffled[1]];
    const battleId = 'bat_sim_' + Date.now();

    gameState.stage3.activeBattles[battleId] = {
      id: battleId,
      p1: p1.id,
      p2: p2.id,
      questions: battleQuestions,
      submissions: {
        [p1.id]: {
          correctCount: Math.floor(Math.random() * 3), // 0, 1, 2
          timeTaken: parseFloat((8 + Math.random() * 10).toFixed(1))
        },
        [p2.id]: {
          correctCount: Math.floor(Math.random() * 3),
          timeTaken: parseFloat((8 + Math.random() * 10).toFixed(1))
        }
      },
      startTime: Date.now()
    };

    p1.battledOpponents.push(p2.id);
    p2.battledOpponents.push(p1.id);
    p1.competeCount++;
    p2.competeCount++;

    finishQuizBattle(battleId);
  });

  // 教師手動結束遊戲三結算
  socket.on('teacher_end_game3', () => {
    checkGame3End(true);
  });

  // 斷線處理
  socket.on('disconnect', () => {
    if (socket.studentId && gameState.students[socket.studentId]) {
      gameState.students[socket.studentId].online = false;
      io.to('teachers').emit('student_status_changed', {
        studentId: socket.studentId,
        online: false,
        students: gameState.students
      });
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n====================================================`);
    console.error(`[提示] 連接埠 ${PORT} 已經在運行中！`);
    console.error(`伺服器目前已在背景運作，請直接開啟瀏覽器：`);
    console.error(`http://localhost:${PORT}`);
    console.error(`====================================================\n`);
    process.exit(0);
  } else {
    throw err;
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`   classroom Binary Game Server is running!`);
  console.log(`   本地瀏覽器網址: http://localhost:${PORT}`);
  console.log(`   教師端入口:     http://localhost:${PORT}/teacher.html`);
  console.log(`   學生端入口:     http://localhost:${PORT}/student.html`);
  console.log(`====================================================`);
});
