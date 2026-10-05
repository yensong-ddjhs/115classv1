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

// 摩斯密碼字典
const MORSE_MAP = {
  'A': '.-',    'B': '-...',  'C': '-.-.',  'D': '-..',   'E': '.',
  'F': '..-.',  'G': '--.',   'H': '....',  'I': '..',    'J': '.---',
  'K': '-.-',   'L': '.-..',  'M': '--',    'N': '-.',    'O': '---',
  'P': '.--.',  'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
  'U': '..-',   'V': '...-',  'W': '.--',   'X': '-..-',  'Y': '-.--',
  'Z': '--..'
};

// 凱撒位移 +2 (A->C, Z->B, 大小寫統一為大寫)
function caesarShift2Char(ch) {
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return String.fromCharCode(((code - 65 + 2) % 26) + 65);
  }
  return ch.toUpperCase();
}

function caesarShift2Str(str) {
  return str.split('').map(caesarShift2Char).join('');
}

function textToMorse(str) {
  return str.toUpperCase().split('').map(c => MORSE_MAP[c] || '').filter(Boolean).join(' ');
}

function charToMorse(ch) {
  return MORSE_MAP[ch.toUpperCase()] || '';
}

// 取得當前在線學生座號清單
function getOnlineStudentIds() {
  if (!gameState || !gameState.students) return [];
  return Object.values(gameState.students)
    .filter(s => s && s.online)
    .map(s => s.id)
    .sort((a, b) => parseInt(a.replace(/\D/g, '') || 0) - parseInt(b.replace(/\D/g, '') || 0));
}

// 輔助函式：同步並更新 activeStudents 陣列 (真實連線名單)
function syncActiveStudents() {
  if (!gameState || !gameState.students) {
    if (gameState) gameState.activeStudents = [];
    return [];
  }
  const activeList = Object.values(gameState.students)
    .filter(s => s && s.online)
    .map(s => ({
      id: s.id,
      seatNumber: s.seatNumber || parseInt(s.id.replace(/\D/g, '') || 0),
      groupId: s.groupId,
      socketId: s.socketId,
      online: true,
      lastHeartbeat: s.lastHeartbeat || Date.now()
    }))
    .sort((a, b) => a.seatNumber - b.seatNumber);

  gameState.activeStudents = activeList;
  return activeList;
}

// 組別 ID 正規化輔助函式
function normalizeGroupId(id) {
  if (id === null || id === undefined) return 1;
  const num = parseInt(String(id).replace(/\D/g, ''));
  return isNaN(num) ? 1 : num;
}

// 綁定遊戲三房間輔助函式
function joinStage3Room(socket, studentId) {
  if (!socket || !studentId) return 'stage3_room_1';
  const seatNum = parseInt(studentId.replace(/\D/g, '') || 1);
  const roomIndex = Math.ceil(seatNum / 2) || 1;
  const roomName = `stage3_room_${roomIndex}`;
  socket.stage3Room = roomName;
  socket.join(roomName);
  socket.join('stage3_all');
  return roomName;
}

// 系統核心狀態
// 狀態機包含: 'LOBBY' (等待大廳) -> 'GROUPED' (完成分組/準備階段) -> 'GAME_START' | 'STAGE2_ACTIVE' (遊戲進行中) -> 'GAME_OVER' (結算)
let gameState = {
  status: 'LOBBY',      // 'LOBBY' | 'GROUPED' | 'GAME_START' | 'STAGE2_ACTIVE' | 'GAME_OVER'
  currentGame: 1,       // 目前發布的遊戲模組編號 (1 = game1, 2 = game2, 3 = game3, 4 = game4)
  currentStage: 1,      // 目前關卡編號
  numStudents: 30,
  numGroups: 5,
  activeStudents: [],   // 動態在線學生清單
  groups: {},   // { 1: { id: 'group_1', groupId: 1, name: '第 1 組', ... }, 'group_1': ... }
  students: {}, // { s01: { id: 's01', seatNumber: 1, groupId: 1, socketId: ..., online: true, ... } }
  stage3: {
    questionBank: binaryQuestionBank,
    players: {},
    scores: {},
    activeEncounters: {},
    activeBattles: {},
    cooldowns: {},
    ended: false
  },
  game4: {
    round: 1,
    totalRounds: 5,
    turnGroupIndex: 0,
    turnGroup: 1,
    phase: 'submitting_words', // 'submitting_words' | 'decrypting' | 'round_result' | 'game_over'
    groupInputs: {}, // { 's01': { letter: 'A', shifted: 'C', morse: '-.-.' } }
    originalWord: '',
    shiftedWord: '',
    morseCode: '',
    submissions: {},
    groupScores: {},
    history: []
  }
};

// 格式化發送給客戶端的狀態包 (附帶在線統計與 activeStudents)
function getSyncPayload() {
  const activeList = syncActiveStudents();
  const onlineIds = activeList.map(s => s.id);
  return {
    ...gameState,
    activeStudents: activeList,
    onlineCount: onlineIds.length,
    onlineStudents: onlineIds,
    // 提供相容欄位給各版客戶端比對
    isLobby: gameState.status === 'LOBBY' || gameState.status === 'waiting',
    isGrouped: gameState.status === 'GROUPED',
    isStarted: gameState.status === 'GAME_START' || gameState.status === 'STAGE2_ACTIVE' || gameState.status === 'in_progress'
  };
}

// 輔助函式：取得實際不重複組別清單
function getDistinctGroupIds() {
  const numG = gameState.numGroups || 5;
  const list = [];
  for (let g = 1; g <= numG; g++) {
    list.push(g);
  }
  return list;
}

// 輔助函式：取得遊戲四最大回合數 (Max Rounds Limit Guard: maxRounds = currentGroups.length)
function getGame4MaxRounds() {
  const distinctIds = getDistinctGroupIds();
  return distinctIds.length > 0 ? distinctIds.length : (gameState.numGroups || 5);
}

// 初始化遊戲四狀態
function initGame4State(resetScores = false) {
  const numGroups = gameState.numGroups || 5;
  const maxRounds = getGame4MaxRounds();

  const prevScores = (gameState.game4 && !resetScores) ? gameState.game4.groupScores : {};
  const groupScores = {};
  for (let g = 1; g <= numGroups; g++) {
    groupScores[g] = prevScores[g] || prevScores[`group_${g}`] || 0;
    groupScores[`group_${g}`] = groupScores[g];
  }

  // 取得第 1 組成員
  const g1 = gameState.groups[1] || gameState.groups['group_1'];
  let g1Members = (g1 && Array.isArray(g1.members)) ? [...g1.members] : [];
  if (g1Members.length === 0) {
    g1Members = (gameState.activeStudents || []).filter(s => normalizeGroupId(s.groupId) === 1).map(s => s.id);
  }
  if (g1Members.length === 0) g1Members = ['s01'];

  gameState.game4 = {
    round: 1,
    totalRounds: maxRounds,
    maxRounds: maxRounds,
    turnGroupIndex: 0,
    turnGroup: 1,
    turnGroupMembers: g1Members,
    turnMemberIndex: 0,
    currentTurnPlayerId: g1Members[0] || 's01',
    currentWords: [],
    phase: 'submitting_words',
    groupInputs: {},
    typingStatus: {},
    originalWord: '',
    shiftedWord: '',
    morseCode: '',
    submissions: {},
    groupScores: groupScores,
    history: []
  };
}

// 初始化遊戲三玩家與狀態
function initStage3Players() {
  if (!gameState.stage3) {
    gameState.stage3 = {
      questionBank: binaryQuestionBank,
      players: {},
      scores: {},
      activeEncounters: {},
      activeBattles: {},
      cooldowns: {},
      ended: false
    };
  } else {
    gameState.stage3.players = {};
    gameState.stage3.activeEncounters = {};
    gameState.stage3.activeBattles = {};
    gameState.stage3.cooldowns = {};
    gameState.stage3.ended = false;
  }

  if (gameState.students) {
    Object.values(gameState.students).forEach(s => {
      const gId = s.groupId || 1;
      const gIdx = (parseInt(String(gId).replace('group_', '')) - 1) || 0;
      const meta = GROUP_META[gIdx % GROUP_META.length] || GROUP_META[0];
      gameState.stage3.players[s.id] = {
        id: s.id,
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
    });
  }
}

// 初始化預設分組
function initializeDefaultGroups(numStudents = 30, numGroups = 5) {
  gameState.numStudents = numStudents;
  gameState.numGroups = numGroups;
  gameState.groups = {};
  gameState.students = {};
  gameState.activeStudents = [];

  for (let g = 1; g <= numGroups; g++) {
    const groupObj = {
      id: `group_${g}`,
      groupId: g,
      name: `第 ${g} 組`,
      members: [],
      score: 0
    };
    gameState.groups[g] = groupObj;
    gameState.groups[`group_${g}`] = groupObj;
  }

  initStage3Players();
  initGame4State(true);
}

// 全域強制重置機制 (Hard State Reset)
function executeHardStateReset(newNumStudents = null) {
  gameState.status = 'LOBBY';
  if (newNumStudents && Number.isInteger(newNumStudents)) {
    gameState.numStudents = newNumStudents;
  }
  gameState.activeStudents = [];
  gameState.students = {};
  gameState.groups = {};
  gameState.currentGroups = {};

  const numG = gameState.numGroups || 5;
  for (let g = 1; g <= numG; g++) {
    const groupObj = {
      id: `group_${g}`,
      groupId: g,
      name: `第 ${g} 組`,
      members: [],
      score: 0
    };
    gameState.groups[g] = groupObj;
    gameState.groups[`group_${g}`] = groupObj;
  }

  gameState.stage3 = {
    questionBank: binaryQuestionBank,
    players: {},
    scores: {},
    activeEncounters: {},
    activeBattles: {},
    cooldowns: {},
    ended: false
  };
  initGame4State(true);

  // 斷開所有舊有 socket 房間綁定與學生綁定
  for (const [id, s] of io.sockets.sockets) {
    if (s.studentId) {
      delete s.studentId;
    }
    delete s.stage3Room;
    for (const room of s.rooms) {
      if (room !== s.id && room !== 'teachers') {
        s.leave(room);
      }
    }
  }

  // 全域廣播 FORCE_RESET_LOBBY
  io.emit('FORCE_RESET_LOBBY', {
    status: 'LOBBY',
    message: '全域重置大廳，請重新登入座號'
  });
  io.emit('game_reset');
  io.emit('state_sync', getSyncPayload());
  io.to('teachers').emit('student_status_changed', {
    students: {},
    activeStudents: [],
    onlineStudents: []
  });
}

// 初始化預設分組結構
initializeDefaultGroups(30, 5);

// API: 取得當前伺服器 IP / 狀態
app.get('/api/info', (req, res) => {
  res.json({
    status: gameState.status,
    numStudents: gameState.numStudents,
    numGroups: gameState.numGroups,
    activeStudents: gameState.activeStudents
  });
});

// 心跳包超時檢測 (每 5 秒檢查一次，若超過 15 秒無心跳或 socket 已斷開則即時剔除)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  Object.keys(gameState.students).forEach(sId => {
    const st = gameState.students[sId];
    if (st && st.socketId) {
      const sock = io.sockets.sockets.get(st.socketId);
      if (!sock || (now - (st.lastHeartbeat || now) > 15000)) {
        delete gameState.students[sId];
        Object.values(gameState.groups).forEach(g => {
          if (g && Array.isArray(g.members)) {
            g.members = g.members.filter(m => m !== sId);
          }
        });
        changed = true;
      }
    }
  });
  if (changed) {
    syncActiveStudents();
    io.to('teachers').emit('student_status_changed', {
      students: gameState.students,
      activeStudents: gameState.activeStudents,
      onlineStudents: getOnlineStudentIds()
    });
    io.emit('state_sync', getSyncPayload());
  }
}, 5000);

io.on('connection', (socket) => {
  // 發送目前狀態給新連線的客戶端
  socket.emit('state_sync', getSyncPayload());

  // 老師登入驗證
  socket.on('teacher_auth', (data, callback) => {
    if (data.username === 't01' && data.password === 't01') {
      socket.join('teachers');
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, message: '帳號或密碼錯誤' });
    }
  });

  // 學生端心跳包監聽 (Heartbeat / Ping-Pong)
  socket.on('student_heartbeat', (data) => {
    const sId = (data?.studentId || socket.studentId || '').trim().toLowerCase();
    if (sId && gameState.students[sId]) {
      gameState.students[sId].lastHeartbeat = Date.now();
      gameState.students[sId].online = true;
      socket.emit('student_heartbeat_ack', { timestamp: Date.now() });
    }
  });

  // 學生加入 / 換號登入
  socket.on('student_join', (data) => {
    const studentId = (data.studentId || '').trim().toLowerCase();
    if (!studentId) return;

    // 若同一 socket 之前使用其他號碼登入（例如從 2 號換成 3 號），即時移除舊號碼
    if (socket.studentId && socket.studentId !== studentId) {
      const oldId = socket.studentId;
      delete gameState.students[oldId];
      Object.values(gameState.groups).forEach(g => {
        if (g && Array.isArray(g.members)) {
          g.members = g.members.filter(m => m !== oldId);
        }
      });
      if (gameState.stage3 && gameState.stage3.players[oldId]) {
        delete gameState.stage3.players[oldId];
      }
    }

    // 若該學生號碼之前綁定在其他 socketId，解綁舊 socket
    if (gameState.students[studentId] && gameState.students[studentId].socketId !== socket.id) {
      const prevSockId = gameState.students[studentId].socketId;
      if (prevSockId) {
        const prevSock = io.sockets.sockets.get(prevSockId);
        if (prevSock) delete prevSock.studentId;
      }
    }

    const seatNum = parseInt(studentId.replace(/\D/g, '') || 1);
    const numG = gameState.numGroups || 5;
    const groupNum = ((seatNum - 1) % numG) + 1;
    const groupId = groupNum;

    // 登記學生狀態
    gameState.students[studentId] = {
      id: studentId,
      seatNumber: seatNum,
      groupId: groupId,
      socketId: socket.id,
      online: true,
      lastHeartbeat: Date.now(),
      stage1Score: null,
      stage2Score: null,
      totalScore: 0,
      finished: false
    };

    // 加入所屬組別
    if (gameState.groups[groupId] && !gameState.groups[groupId].members.includes(studentId)) {
      gameState.groups[groupId].members.push(studentId);
    }
    if (gameState.groups[`group_${groupId}`] && !gameState.groups[`group_${groupId}`].members.includes(studentId)) {
      gameState.groups[`group_${groupId}`].members.push(studentId);
    }

    socket.studentId = studentId;
    socket.join('students');
    socket.join(String(groupId));
    socket.join(`group_${groupId}`);

    // 自動加入 stage3 連線頻道 (stage3_room_X)
    joinStage3Room(socket, studentId);

    syncActiveStudents();

    // 回傳該學生的完整狀態
    const assignedGroup = gameState.groups[groupId] || gameState.groups[`group_${groupId}`];
    socket.emit('student_ready', {
      student: gameState.students[studentId],
      group: assignedGroup,
      gameState: getSyncPayload()
    });

    // 廣播最新在線狀態給全體
    io.emit('state_sync', getSyncPayload());

    // 廣播給老師端更新連線名單 (即時移除已離線的號碼，僅渲染真實連線 activeStudents)
    io.to('teachers').emit('student_status_changed', {
      studentId: studentId,
      online: true,
      students: gameState.students,
      activeStudents: gameState.activeStudents,
      onlineStudents: getOnlineStudentIds()
    });
  });

  // 老師控制：進入等待大廳 (LOBBY)
  socket.on('teacher_enter_lobby', () => {
    gameState.status = 'LOBBY';
    io.emit('state_sync', getSyncPayload());
    io.emit('lobby_ready');
  });

  // 老師控制：進入控制主頁 / 準備階段 (GROUPED)
  socket.on('teacher_enter_grouped', () => {
    gameState.status = 'GROUPED';
    io.emit('state_sync', getSyncPayload());
    io.emit('groups_prepared', {
      groups: gameState.groups,
      students: gameState.students
    });
  });

  // 老師點擊「隨機分組」(正確分組分配：當 2 人分 2 組時，確保 1 號取得 groupId: 1，2 號取得 groupId: 2，禁止將兩人同時指派入同一組)
  socket.on('generate_groups', (data) => {
    const numGroups = Math.max(2, Math.min(12, parseInt(data.numGroups) || 5));

    // 取得目前在線學生座號清單，按座號排序
    const onlineStudents = Object.values(gameState.students)
      .filter(s => s.online)
      .sort((a, b) => {
        const numA = parseInt(a.id.replace(/\D/g, '') || 0);
        const numB = parseInt(b.id.replace(/\D/g, '') || 0);
        return numA - numB;
      });

    // 若在線學生充足則以在線名單分組；若不足則依現有名單分組
    const studentIds = onlineStudents.length >= 2 
      ? onlineStudents.map(s => s.id) 
      : Object.keys(gameState.students).sort((a, b) => parseInt(a.replace(/\D/g, '') || 0) - parseInt(b.replace(/\D/g, '') || 0));

    const actualNumGroups = Math.min(numGroups, Math.max(1, studentIds.length));

    // 分組後狀態進入 GROUPED 準備階段
    gameState.status = 'GROUPED';
    gameState.numStudents = Math.max(studentIds.length, parseInt(data.numStudents) || studentIds.length);
    gameState.numGroups = actualNumGroups;
    gameState.groups = {};

    // 建立組別 (同時支援數字鍵與 group_X 鍵)
    for (let g = 1; g <= actualNumGroups; g++) {
      const groupObj = {
        id: `group_${g}`,
        groupId: g,
        name: `第 ${g} 組`,
        members: [],
        score: 0
      };
      gameState.groups[g] = groupObj;
      gameState.groups[`group_${g}`] = groupObj;
    }

    // 依照學生座號順序均勻分配至各組
    // 當 2 人分 2 組時：1 號 (idx 0) 分配至組別 1 (groupId: 1)，2 號 (idx 1) 分配至組別 2 (groupId: 2)
    // 嚴格禁止兩人被分入同一組！
    const newStudents = {};
    studentIds.forEach((studentId, idx) => {
      const groupNum = (idx % actualNumGroups) + 1;
      const prev = gameState.students[studentId] || {};
      const seatNum = prev.seatNumber || parseInt(studentId.replace(/\D/g, '') || 0);
      newStudents[studentId] = {
        ...prev,
        id: studentId,
        seatNumber: seatNum,
        groupId: groupNum,
        socketId: prev.socketId || null,
        online: prev.online !== undefined ? prev.online : true,
        lastHeartbeat: prev.lastHeartbeat || Date.now(),
        stage1Score: null,
        stage2Score: null,
        totalScore: 0,
        finished: false
      };
      gameState.groups[groupNum].members.push(studentId);
      if (!gameState.groups[`group_${groupNum}`].members.includes(studentId)) {
        gameState.groups[`group_${groupNum}`].members.push(studentId);
      }
    });
    gameState.students = newStudents;

    // 重新加入對應 socket room
    Object.values(gameState.students).forEach(s => {
      if (s.socketId && s.online) {
        const sSocket = io.sockets.sockets.get(s.socketId);
        if (sSocket) {
          sSocket.join(String(s.groupId));
          sSocket.join(`group_${s.groupId}`);
        }
      }
    });

    syncActiveStudents();
    initStage3Players();
    initGame4State(true);

    // 全體廣播新狀態與分組通知
    io.emit('groups_updated', {
      groups: gameState.groups,
      students: gameState.students
    });
    io.emit('state_sync', getSyncPayload());
  });

  // 老師點擊「開始遊戲」（支援遊戲二 STAGE2_ACTIVE 與遊戲四 START_STAGE_4）
  socket.on('start_game', (data) => {
    // 若老師指定了遊戲模組 / 關卡，則更新；否則沿用目前設定
    if (data && data.game)  gameState.currentGame  = parseInt(data.game)  || 1;
    if (data && data.stage) gameState.currentStage = parseInt(data.stage) || 1;

    if (gameState.currentGame === 2) {
      gameState.status = 'STAGE2_ACTIVE';
    } else {
      gameState.status = 'GAME_START';
    }

    // 遊戲二修復：關卡切換狀態廣播 STAGE2_ACTIVE
    if (gameState.currentGame === 2) {
      io.emit('STAGE2_ACTIVE', {
        currentGame: 2,
        currentStage: gameState.currentStage,
        status: 'STAGE2_ACTIVE'
      });
    }

    // 遊戲四修復：解鎖學生端輸入框廣播 START_STAGE_4
    if (gameState.currentGame === 4) {
      setupGame4Turn(1);
      io.emit('START_STAGE_4', {
        currentGame: 4,
        turnGroup: gameState.game4.turnGroup,
        round: gameState.game4.round,
        maxRounds: gameState.game4.maxRounds,
        currentTurnPlayerId: gameState.game4.currentTurnPlayerId,
        phase: gameState.game4.phase,
        groups: gameState.groups
      });
      broadcastStage4StateUpdate();
    }

    io.emit('game_started', {
      currentGame:  gameState.currentGame,
      currentStage: gameState.currentStage,
      status: gameState.status
    });
    io.emit('state_sync', getSyncPayload());
  });

  // 老師手動切換關卡
  socket.on('select_stage', (data) => {
    const stage = parseInt(data.stage) || 1;
    gameState.currentStage = stage;
    if (gameState.status !== 'in_progress' && gameState.status !== 'STAGE2_ACTIVE') {
      gameState.status = gameState.currentGame === 2 ? 'STAGE2_ACTIVE' : 'in_progress';
    }

    if (gameState.currentGame === 2) {
      io.emit('STAGE2_ACTIVE', {
        currentGame: 2,
        currentStage: gameState.currentStage,
        status: 'STAGE2_ACTIVE'
      });
    } else if (gameState.currentGame === 4) {
      io.emit('START_STAGE_4', {
        currentGame: 4,
        turnGroup: gameState.game4.turnGroup,
        round: gameState.game4.round,
        phase: gameState.game4.phase,
        groups: gameState.groups
      });
    }

    io.emit('stage_changed', {
      currentGame:  gameState.currentGame,
      currentStage: gameState.currentStage
    });
    io.emit('state_sync', getSyncPayload());
  });

  // 老師切換遊戲模組
  socket.on('switch_game', (data) => {
    const game = parseInt(data.game) || 1;
    gameState.currentGame  = game;
    gameState.currentStage = 1;

    io.emit('game_switched', {
      currentGame:  gameState.currentGame,
      currentStage: gameState.currentStage
    });
    io.emit('state_sync', getSyncPayload());
  });

  // 強制全域重置功能 (Hard State Reset)：
  // 當教師點擊【重置】、【變更班級人數】或【重新遊戲】時，後端發送全域廣播事件 FORCE_RESET_LOBBY
  socket.on('force_reset_lobby', () => {
    executeHardStateReset();
  });

  socket.on('reset_game', () => {
    executeHardStateReset();
  });

  socket.on('teacher_restart_game', () => {
    executeHardStateReset();
  });

  socket.on('change_num_students', (data) => {
    const num = parseInt(data?.numStudents) || 30;
    executeHardStateReset(num);
  });

  // ====================================================
  // 遊戲四 (凱撒摩斯密碼小隊對決 Caesar-Morse Duel) Socket 事件與核心邏輯
  // ====================================================

  // 輔助函式：廣播遊戲四全域狀態 (Bug 1: STAGE_4_STATE_UPDATE 廣播)
  function broadcastStage4StateUpdate() {
    if (!gameState.game4) return;
    const g4 = gameState.game4;
    const tg = normalizeGroupId(g4.turnGroup);
    const grp = gameState.groups[tg] || gameState.groups[`group_${tg}`];
    const turnMembers = g4.turnGroupMembers || (grp && Array.isArray(grp.members) ? grp.members : []);

    const payload = {
      round: g4.round,
      totalRounds: g4.totalRounds || g4.maxRounds || 5,
      maxRounds: g4.maxRounds || 5,
      turnGroup: tg,
      turnGroupName: grp?.name || `第 ${tg} 組`,
      currentTurnPlayerId: g4.currentTurnPlayerId || null,
      turnGroupMembers: turnMembers,
      turnMemberIndex: g4.turnMemberIndex || 0,
      currentWords: g4.currentWords || [],
      expectedLength: turnMembers.length || 1,
      phase: g4.phase,
      groupInputs: g4.groupInputs || {},
      typingStatus: g4.typingStatus || {},
      originalWord: g4.originalWord || '',
      shiftedWord: g4.shiftedWord || '',
      morseCode: g4.morseCode || '',
      submissions: g4.submissions || {},
      groupScores: g4.groupScores || {},
      status: gameState.status
    };

    io.emit('STAGE_4_STATE_UPDATE', payload);
  }

  // 輔助函式：輪次切換時的輸入長度與組別 State 清空 (Bug 4: RESET_TURN_INPUT)
  function setupGame4Turn(round = 1) {
    const g4 = gameState.game4;
    if (!g4) return;
    const groupIds = getDistinctGroupIds();
    const maxRounds = groupIds.length || 5;
    g4.maxRounds = maxRounds;
    g4.totalRounds = maxRounds;
    g4.round = round;

    g4.turnGroupIndex = (round - 1) % groupIds.length;
    const turnGroupId = groupIds[g4.turnGroupIndex];
    g4.turnGroup = turnGroupId;
    g4.phase = 'submitting_words';

    // 重新根據「當前出題組的真實人數」計算本輪應輸入的字母欄位數量
    const grp = gameState.groups[turnGroupId] || gameState.groups[`group_${turnGroupId}`];
    let members = (grp && Array.isArray(grp.members)) ? [...grp.members] : [];
    if (members.length === 0) {
      members = (gameState.activeStudents || [])
        .filter(s => normalizeGroupId(s.groupId) === turnGroupId)
        .map(s => s.id);
    }
    if (members.length === 0) {
      members = [`s0${turnGroupId}`];
    }

    g4.turnGroupMembers = members;
    g4.turnMemberIndex = 0;
    g4.currentTurnPlayerId = members[0] || null;

    // 清空上一輪暫存的 currentWords 陣列與字串長度
    g4.currentWords = [];
    g4.groupInputs = {};
    g4.typingStatus = {};
    g4.submissions = {};
    g4.originalWord = '';
    g4.shiftedWord = '';
    g4.morseCode = '';

    // 發送 RESET_TURN_INPUT 指令
    io.emit('RESET_TURN_INPUT', {
      round: g4.round,
      totalRounds: maxRounds,
      maxRounds: maxRounds,
      turnGroup: turnGroupId,
      turnGroupName: grp?.name || `第 ${turnGroupId} 組`,
      currentTurnPlayerId: g4.currentTurnPlayerId,
      turnGroupMembers: members,
      expectedLength: members.length
    });

    broadcastStage4StateUpdate();
  }

  // 輔助函式：觸發遊戲四結束與排行榜廣播 (Bug 3: Auto End Game)
  function triggerGame4GameOver() {
    if (!gameState.game4) return;
    gameState.game4.phase = 'game_over';
    gameState.status = 'GAME_OVER';

    const groupIds = getDistinctGroupIds();
    const rankings = groupIds.map(gId => {
      const score = (gameState.game4.groupScores && (gameState.game4.groupScores[gId] || gameState.game4.groupScores[`group_${gId}`])) || 0;
      return {
        groupId: gId,
        name: gameState.groups[gId]?.name || `第 ${gId} 組`,
        score: score,
        binaryScore: score.toString(2)
      };
    }).sort((a, b) => b.score - a.score);

    const winner = rankings[0] || null;

    io.emit('game4_game_over', {
      rankings: rankings,
      winner: winner,
      totalScores: gameState.game4.groupScores
    });
    broadcastStage4StateUpdate();
    io.emit('state_sync', getSyncPayload());
  }

  // 輔助函式：結算遊戲四當前回合 (Bug 3: Round Bound Limit Guard)
  function finishGame4Round() {
    if (!gameState.game4 || gameState.game4.phase === 'round_result' || gameState.game4.phase === 'game_over') return;

    gameState.game4.phase = 'round_result';

    // 結算各解密組得分
    const roundScores = {};
    const submissions = gameState.game4.submissions || {};

    Object.keys(submissions).forEach(gId => {
      const sub = submissions[gId];
      const pts = sub.scoreEarned || 0;
      roundScores[gId] = pts;

      gameState.game4.groupScores[gId] = (gameState.game4.groupScores[gId] || 0) + pts;
      gameState.game4.groupScores[normalizeGroupId(gId)] = (gameState.game4.groupScores[normalizeGroupId(gId)] || 0) + pts;
      if (gameState.groups[gId]) {
        gameState.groups[gId].score += pts;
      }
    });

    const roundRecord = {
      round: gameState.game4.round,
      turnGroup: gameState.game4.turnGroup,
      turnGroupName: gameState.groups[gameState.game4.turnGroup]?.name || gameState.game4.turnGroup,
      originalWord: gameState.game4.originalWord,
      shiftedWord: gameState.game4.shiftedWord,
      morseCode: gameState.game4.morseCode,
      submissions: submissions,
      roundScores: roundScores,
      totalScores: { ...gameState.game4.groupScores }
    };
    gameState.game4.history.push(roundRecord);

    io.emit('game4_round_settled', roundRecord);
    broadcastStage4StateUpdate();
    io.emit('state_sync', getSyncPayload());

    // 回合上限檢查 (Bug 3: Max Rounds Limit Guard)
    const currentRound = gameState.game4.round;
    const maxRounds = gameState.game4.maxRounds || getGame4MaxRounds();

    if (currentRound >= maxRounds) {
      // 若 currentRound >= maxRounds：立即強制停止遊戲，切換全域狀態至 GAME_OVER，並向所有人廣播最終總結算排行榜
      triggerGame4GameOver();
    } else {
      // 若 currentRound < maxRounds：currentRound++ 並切換至下一組出題
      gameState.game4.round = currentRound + 1;
      setupGame4Turn(gameState.game4.round);
      io.emit('game4_new_round', {
        round: gameState.game4.round,
        totalRounds: maxRounds,
        maxRounds: maxRounds,
        turnGroup: gameState.game4.turnGroup,
        turnGroupName: gameState.groups[gameState.game4.turnGroup]?.name || `第 ${gameState.game4.turnGroup} 組`,
        currentTurnPlayerId: gameState.game4.currentTurnPlayerId,
        phase: 'submitting_words'
      });
      broadcastStage4StateUpdate();
      io.emit('state_sync', getSyncPayload());
    }
  }

  // 輔助函式：切換至遊戲四下一回合或結束遊戲
  function advanceGame4NextRound() {
    if (!gameState.game4) return;
    const maxRounds = gameState.game4.maxRounds || getGame4MaxRounds();

    if (gameState.game4.round >= maxRounds) {
      triggerGame4GameOver();
    } else {
      gameState.game4.round++;
      setupGame4Turn(gameState.game4.round);
      io.emit('game4_new_round', {
        round: gameState.game4.round,
        totalRounds: maxRounds,
        maxRounds: maxRounds,
        turnGroup: gameState.game4.turnGroup,
        turnGroupName: gameState.groups[gameState.game4.turnGroup]?.name || `第 ${gameState.game4.turnGroup} 組`,
        currentTurnPlayerId: gameState.game4.currentTurnPlayerId,
        phase: 'submitting_words'
      });
      broadcastStage4StateUpdate();
      io.emit('state_sync', getSyncPayload());
    }
  }

  // 請求遊戲四初始化狀態
  socket.on('game4_init', (data, callback) => {
    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    const student = gameState.students[studentId] || null;
    const myGroupId = student ? student.groupId : null;

    const payload = {
      game4: gameState.game4,
      studentId: studentId,
      groupId: myGroupId,
      groups: gameState.groups,
      isTurnGroup: myGroupId === gameState.game4.turnGroup,
      onlineCount: getOnlineStudentIds().length
    };

    if (typeof callback === 'function') callback(payload);
    socket.emit('game4_ready', payload);
    socket.emit('STAGE_4_STATE_UPDATE', {
      round: gameState.game4.round,
      totalRounds: gameState.game4.totalRounds,
      maxRounds: gameState.game4.maxRounds,
      turnGroup: gameState.game4.turnGroup,
      turnGroupName: gameState.groups[gameState.game4.turnGroup]?.name || `第 ${gameState.game4.turnGroup} 組`,
      currentTurnPlayerId: gameState.game4.currentTurnPlayerId,
      turnGroupMembers: gameState.game4.turnGroupMembers,
      turnMemberIndex: gameState.game4.turnMemberIndex,
      currentWords: gameState.game4.currentWords,
      expectedLength: (gameState.game4.turnGroupMembers && gameState.game4.turnGroupMembers.length) || 1,
      phase: gameState.game4.phase,
      groupInputs: gameState.game4.groupInputs,
      typingStatus: gameState.game4.typingStatus,
      originalWord: gameState.game4.originalWord,
      shiftedWord: gameState.game4.shiftedWord,
      morseCode: gameState.game4.morseCode,
      submissions: gameState.game4.submissions,
      groupScores: gameState.game4.groupScores,
      status: gameState.status
    });
  });

  // Bug 2: 學生端打字狀態即時廣播 (student_typing)
  socket.on('student_typing', (data) => {
    const sId = (data?.studentId || socket.studentId || '').toLowerCase();
    if (!sId) return;

    const seatNum = parseInt(sId.replace(/\D/g, '') || 0);
    const typingPayload = {
      studentId: sId,
      seatNumber: seatNum,
      input: data.input !== undefined ? data.input : '',
      letter: data.letter || (data.input ? String(data.input)[0] : ''),
      shifted: data.shifted || '',
      morse: data.morse || '',
      isSubmitted: !!data.isSubmitted,
      type: data.type || 'letter',
      timestamp: Date.now()
    };

    if (gameState.game4) {
      if (!gameState.game4.typingStatus) gameState.game4.typingStatus = {};
      gameState.game4.typingStatus[sId] = typingPayload;
    }

    // 後端將該事件即時轉發給教師端 Socket
    io.to('teachers').emit('student_typing', typingPayload);
  });

  // 出題組組員輸入 1 個英文字母 (Bug 1 & Bug 4 狀態更新)
  socket.on('game4_submit_letter', (data) => {
    if (!gameState.game4 || gameState.game4.phase !== 'submitting_words') return;

    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    const student = gameState.students[studentId];
    if (!student) return;

    // 檢查是否為當前出題組
    if (normalizeGroupId(student.groupId) !== normalizeGroupId(gameState.game4.turnGroup)) {
      return;
    }

    const rawLetter = (data.letter || '').toString().trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (!rawLetter) return;
    const letter = rawLetter[0];

    const shifted = caesarShift2Char(letter);
    const morse = charToMorse(shifted);

    gameState.game4.groupInputs[studentId] = {
      studentId: studentId,
      letter: letter,
      shifted: shifted,
      morse: morse,
      updatedAt: Date.now()
    };

    // 更新 currentWords
    const members = gameState.game4.turnGroupMembers || [];
    gameState.game4.currentWords = members.map(m => gameState.game4.groupInputs[m]?.letter).filter(Boolean);

    // 切換至組內下一位出題者 (Bug 1: currentTurnPlayerId 推進)
    const nextMember = members.find(m => !gameState.game4.groupInputs[m]?.letter);
    if (nextMember) {
      gameState.game4.currentTurnPlayerId = nextMember;
      gameState.game4.turnMemberIndex = members.indexOf(nextMember);
    } else {
      gameState.game4.currentTurnPlayerId = null; // 全體組員皆已鍵入完畢
    }

    // 廣播 student_typing 標記已送出
    const typingPayload = {
      studentId: studentId,
      seatNumber: parseInt(studentId.replace(/\D/g, '') || 0),
      input: letter,
      letter: letter,
      shifted: shifted,
      morse: morse,
      isSubmitted: true,
      timestamp: Date.now()
    };
    if (!gameState.game4.typingStatus) gameState.game4.typingStatus = {};
    gameState.game4.typingStatus[studentId] = typingPayload;
    io.to('teachers').emit('student_typing', typingPayload);

    // 廣播給全體 (出題組全員及教師端即時查看)
    io.emit('game4_inputs_updated', {
      turnGroup: gameState.game4.turnGroup,
      inputs: gameState.game4.groupInputs,
      currentWords: gameState.game4.currentWords
    });

    broadcastStage4StateUpdate();
  });

  // 出題組確認完成題目（或教師代為確認發布）
  socket.on('game4_confirm_word', (data) => {
    if (!gameState.game4 || gameState.game4.phase !== 'submitting_words') return;

    const turnGroupMembers = gameState.groups[gameState.game4.turnGroup]?.members || [];
    let composedLetters = [];

    // 若有自訂或指定單字 (供教師端或測試使用)
    if (data && data.customWord) {
      composedLetters = data.customWord.toUpperCase().replace(/[^A-Z]/g, '').split('');
    } else {
      // 依成員順序提取輸入的字母
      turnGroupMembers.forEach(mId => {
        if (gameState.game4.groupInputs[mId]?.letter) {
          composedLetters.push(gameState.game4.groupInputs[mId].letter);
        }
      });
    }

    // 若依然為空（如單人測試或組員未打字），隨機產生 4 個字母單字
    if (composedLetters.length === 0) {
      const fallbackWords = ['CODE', 'DATA', 'BYTE', 'JAVA', 'NODE', 'WIRE', 'CAMP', 'TEAM', 'WIFI'];
      const chosen = fallbackWords[Math.floor(Math.random() * fallbackWords.length)];
      composedLetters = chosen.split('');
    }

    const originalWord = composedLetters.join('');
    const shiftedWord = caesarShift2Str(originalWord);
    const morseCode = textToMorse(shiftedWord);

    gameState.game4.originalWord = originalWord;
    gameState.game4.shiftedWord = shiftedWord;
    gameState.game4.morseCode = morseCode;
    gameState.game4.phase = 'decrypting';
    gameState.game4.submissions = {};

    const broadcastPayload = {
      round: gameState.game4.round,
      turnGroup: gameState.game4.turnGroup,
      turnGroupName: gameState.groups[gameState.game4.turnGroup]?.name || gameState.game4.turnGroup,
      letterCount: originalWord.length,
      morseCode: morseCode,
      phase: 'decrypting'
    };

    io.emit('game4_word_broadcast', broadcastPayload);
    broadcastStage4StateUpdate();
    io.emit('state_sync', getSyncPayload());
  });

  // 解密組組員提交解密答案
  socket.on('game4_submit_decryption', (data, callback) => {
    if (!gameState.game4 || gameState.game4.phase !== 'decrypting') {
      if (typeof callback === 'function') callback({ success: false, message: '目前非答題階段' });
      return;
    }

    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    const student = gameState.students[studentId];
    if (!student) return;

    // 出題組不能答題
    if (student.groupId === gameState.game4.turnGroup) {
      if (typeof callback === 'function') callback({ success: false, message: '出題組不可作答' });
      return;
    }

    const rawAns = (data.answer || '').toString().trim().toUpperCase().replace(/[^A-Z]/g, '');
    const targetWord = gameState.game4.originalWord || '';
    const targetLen = targetWord.length;

    // 逐字比對計算正確字母數
    let correctCount = 0;
    for (let i = 0; i < targetLen; i++) {
      if (i < rawAns.length && rawAns[i] === targetWord[i]) {
        correctCount++;
      }
    }
    const scoreEarned = correctCount; // 全對得 N 分，對 k 個得 k 分，全錯 0 分

    const timeTaken = parseFloat(data.timeTaken) || 0;
    const groupId = student.groupId;
    const groupName = gameState.groups[groupId]?.name || groupId;

    const submissionData = {
      groupId: groupId,
      groupName: groupName,
      studentId: studentId,
      answer: rawAns,
      targetLen: targetLen,
      correctCount: correctCount,
      scoreEarned: scoreEarned,
      timeTaken: timeTaken,
      submittedAt: Date.now()
    };

    // 取該組最高分或更新作答
    if (!gameState.game4.submissions[groupId] || scoreEarned > gameState.game4.submissions[groupId].scoreEarned) {
      gameState.game4.submissions[groupId] = submissionData;
    }

    if (typeof callback === 'function') {
      callback({
        success: true,
        correctCount: correctCount,
        totalCount: targetLen,
        scoreEarned: scoreEarned
      });
    }

    // 廣播提交更新至教師端與解密組
    io.emit('game4_submission_received', {
      groupId: groupId,
      groupName: groupName,
      studentId: studentId,
      correctCount: correctCount,
      totalCount: targetLen,
      scoreEarned: scoreEarned,
      submissions: gameState.game4.submissions
    });

    // 檢查是否所有「目前在線」的解密組都已提交答案
    const allGroupKeys = Object.keys(gameState.groups);
    const onlineDecoderGroups = allGroupKeys.filter(gId => {
      if (gId === gameState.game4.turnGroup) return false; // 出題組不算
      // 該組是否有任何在線成員
      const members = gameState.groups[gId]?.members || [];
      return members.some(mId => gameState.students[mId]?.online);
    });
    const decryptGroupCount = Math.max(1, onlineDecoderGroups.length);
    const submittedCount = Object.keys(gameState.game4.submissions).length;

    if (submittedCount >= decryptGroupCount) {
      finishGame4Round();
    }
  });

  // 教師手動提早結算本回合
  socket.on('game4_teacher_settle_round', () => {
    finishGame4Round();
  });

  // 教師進入下一輪出題
  socket.on('game4_teacher_next_round', () => {
    advanceGame4NextRound();
  });

  // 教師強制推進：跳過未提交直接進入結算
  socket.on('game4_force_advance', () => {
    if (!gameState.game4) return;
    if (gameState.game4.phase === 'submitting_words') {
      // 強制以現有字母確認出題
      socket.emit('game4_confirm_word', {});
    } else if (gameState.game4.phase === 'decrypting') {
      // 強制結算本回合
      finishGame4Round();
    } else if (gameState.game4.phase === 'round_result') {
      advanceGame4NextRound();
    }
    io.to('teachers').emit('game4_teacher_log', { text: '⚡ 教師已強制推進至下一階段' });
  });

  // 教師跳過未回應學生：強制結算（同 settle_round）
  socket.on('game4_skip_absent', () => {
    if (!gameState.game4) return;
    if (gameState.game4.phase === 'submitting_words') {
      // 用現有字母強制確認出題，無字母則隨機
      const turnGroupMembers = gameState.groups[gameState.game4.turnGroup]?.members || [];
      let composedLetters = [];
      turnGroupMembers.forEach(mId => {
        if (gameState.game4.groupInputs[mId]?.letter) {
          composedLetters.push(gameState.game4.groupInputs[mId].letter);
        }
      });
      if (composedLetters.length === 0) {
        const fallbackWords = ['CODE', 'DATA', 'BYTE', 'NODE'];
        composedLetters = fallbackWords[Math.floor(Math.random() * fallbackWords.length)].split('');
      }
      const originalWord = composedLetters.join('');
      const shiftedWord = caesarShift2Str(originalWord);
      const morseCode = textToMorse(shiftedWord);
      gameState.game4.originalWord = originalWord;
      gameState.game4.shiftedWord = shiftedWord;
      gameState.game4.morseCode = morseCode;
      gameState.game4.phase = 'decrypting';
      gameState.game4.submissions = {};
      const broadcastPayload = {
        round: gameState.game4.round,
        turnGroup: gameState.game4.turnGroup,
        turnGroupName: gameState.groups[gameState.game4.turnGroup]?.name || gameState.game4.turnGroup,
        letterCount: originalWord.length,
        morseCode: morseCode,
        phase: 'decrypting'
      };
      io.emit('game4_word_broadcast', broadcastPayload);
      io.emit('state_sync', getSyncPayload());
    } else if (gameState.game4.phase === 'decrypting') {
      finishGame4Round();
    }
    io.to('teachers').emit('game4_teacher_log', { text: '🚫 教師跳過未回應學生，強制推進' });
  });

  // 教師示範模擬：一鍵模擬出題組輸入與解密組答題
  socket.on('game4_simulate_round', () => {
    if (!gameState.game4) return;

    if (gameState.game4.phase === 'submitting_words') {
      const turnGroup = gameState.game4.turnGroup;
      const members = gameState.groups[turnGroup]?.members || ['s01', 's02', 's03', 's04'];
      const sampleLetters = ['B', 'I', 'T', 'E'];
      members.forEach((mId, idx) => {
        const letChar = sampleLetters[idx % sampleLetters.length];
        const shifted = caesarShift2Char(letChar);
        gameState.game4.groupInputs[mId] = {
          studentId: mId,
          letter: letChar,
          shifted: shifted,
          morse: charToMorse(shifted)
        };
      });

      // 自動送出確認
      const original = sampleLetters.slice(0, Math.min(members.length, 5)).join('');
      const shiftedStr = caesarShift2Str(original);
      gameState.game4.originalWord = original;
      gameState.game4.shiftedWord = shiftedStr;
      gameState.game4.morseCode = textToMorse(shiftedStr);
      gameState.game4.phase = 'decrypting';
      gameState.game4.submissions = {};

      io.emit('game4_word_broadcast', {
        round: gameState.game4.round,
        turnGroup: turnGroup,
        turnGroupName: gameState.groups[turnGroup]?.name || turnGroup,
        letterCount: original.length,
        morseCode: gameState.game4.morseCode,
        phase: 'decrypting'
      });
      io.emit('state_sync', getSyncPayload());
    } else if (gameState.game4.phase === 'decrypting') {
      // 模擬解密組作答
      const allGroupKeys = Object.keys(gameState.groups);
      allGroupKeys.forEach(gId => {
        if (gId === gameState.game4.turnGroup) return;
        const target = gameState.game4.originalWord;
        const isFull = Math.random() > 0.3;
        const simulatedAns = isFull ? target : (target.slice(0, -1) + 'X');
        let corr = 0;
        for (let i = 0; i < target.length; i++) {
          if (i < simulatedAns.length && simulatedAns[i] === target[i]) corr++;
        }
        gameState.game4.submissions[gId] = {
          groupId: gId,
          groupName: gameState.groups[gId]?.name || gId,
          studentId: (gameState.groups[gId]?.members || [])[0] || 's99',
          answer: simulatedAns,
          targetLen: target.length,
          correctCount: corr,
          scoreEarned: corr,
          timeTaken: parseFloat((5 + Math.random() * 8).toFixed(1)),
          submittedAt: Date.now()
        };
      });

      finishGame4Round();
    } else if (gameState.game4.phase === 'round_result') {
      advanceGame4NextRound();
    }
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

  // 學生端進入遊戲三請求初始化資料 (多人連線頻道綁定：Join 入 stage3_room_X)
  socket.on('stage3_init', (data, callback) => {
    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    const roomName = joinStage3Room(socket, studentId);

    let player = gameState.stage3.players[studentId];
    if (!player && gameState.students[studentId]) {
      const gId = gameState.students[studentId].groupId;
      const gIdx = (parseInt(String(gId).replace('group_', '')) - 1) || 0;
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
      mapSize: { width: 1000, height: 700 },
      room: roomName
    };
    if (typeof callback === 'function') callback(payload);
    socket.emit('stage3_ready', payload);
  });

  // 學生端實時座標傳送與廣播 (支援 player_movement 與 player_move)
  function handleStage3Movement(sock, data) {
    const studentId = (data?.studentId || sock.studentId || '').toLowerCase();
    if (!studentId || !gameState.stage3.players[studentId]) return;

    const player = gameState.stage3.players[studentId];
    if (player.activeEncounter || player.activeBattle) return; // 鎖定行動

    player.x = Math.max(20, Math.min(980, parseFloat(data.x) || player.x));
    player.y = Math.max(20, Math.min(680, parseFloat(data.y) || player.y));

    const roomName = sock.stage3Room || 'stage3_room_1';

    // 實時廣播給同房另一位玩家 (包含座標與狀態)
    sock.to(roomName).emit('player_movement', {
      studentId: player.id,
      x: player.x,
      y: player.y,
      code: player.code,
      groupId: player.groupId,
      color: player.color,
      hp: player.hp
    });
    sock.to(roomName).emit('stage3_player_moved', {
      studentId: player.id,
      x: player.x,
      y: player.y
    });

    // 上帝視角：同步位置給所有在 teachers 房間的教師端
    io.to('teachers').emit('stage3_player_moved', {
      studentId: player.id,
      x: player.x,
      y: player.y
    });

    // 進行「玩家 A 與 玩家 B」的 Hitbox 碰撞檢測事件
    if (player.competeCount < 3) {
      checkEncounter(player);
    }
  }

  socket.on('player_movement', (data) => handleStage3Movement(socket, data));
  socket.on('player_move', (data) => handleStage3Movement(socket, data));

  // 學生端觸發 Hitbox 碰撞檢測事件
  socket.on('player_collision', (data) => {
    const studentId = (data?.studentId || socket.studentId || '').toLowerCase();
    if (studentId && gameState.stage3.players[studentId]) {
      checkEncounter(gameState.stage3.players[studentId]);
    }
  });

  // 遭遇偵測判定函式 (修正 Hitbox 碰撞偵測邏輯，確保玩家 A 與 玩家 B 重疊/交疊時正確觸發對戰與得分機制)
  function checkEncounter(p1) {
    if (p1.activeEncounter || p1.activeBattle || p1.competeCount >= 3) return;

    const otherIds = Object.keys(gameState.stage3.players);
    for (const p2Id of otherIds) {
      if (p2Id === p1.id) continue;
      const p2 = gameState.stage3.players[p2Id];
      if (!p2) continue;

      // 必須是不同組別 (組別不同視為對手)
      if (normalizeGroupId(p2.groupId) === normalizeGroupId(p1.groupId)) continue;

      // 對手也必須未達 3 次上限
      if (p2.competeCount >= 3) continue;

      // 雙方皆未處於其他遭遇或對決中
      if (p2.activeEncounter || p2.activeBattle) continue;

      // 玩家不可與同一位對手重複觸發對決
      if (p1.battledOpponents.includes(p2.id) || p2.battledOpponents.includes(p1.id)) continue;

      // 冷卻時間檢查
      const pairKey = [p1.id, p2.id].sort().join('_');
      if (gameState.stage3.cooldowns[pairKey] && Date.now() < gameState.stage3.cooldowns[pairKey]) continue;

      // Hitbox 碰撞判定 (半徑 25px 碰撞盒重疊，距離 <= 50px 視為交疊)
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 50) {
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

  // 斷線處理 (即時移除已離線的號碼，維持真實上線名單 activeStudents)
  socket.on('disconnect', () => {
    if (socket.studentId) {
      const sId = socket.studentId;
      if (gameState.students[sId] && gameState.students[sId].socketId === socket.id) {
        delete gameState.students[sId];
        Object.values(gameState.groups).forEach(g => {
          if (g && Array.isArray(g.members)) {
            g.members = g.members.filter(m => m !== sId);
          }
        });
        if (gameState.stage3 && gameState.stage3.players[sId]) {
          delete gameState.stage3.players[sId];
        }
        syncActiveStudents();
        io.to('teachers').emit('student_status_changed', {
          studentId: sId,
          online: false,
          students: gameState.students,
          activeStudents: gameState.activeStudents,
          onlineStudents: getOnlineStudentIds()
        });
        io.emit('state_sync', getSyncPayload());
      }
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
