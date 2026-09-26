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

// 系統核心狀態
let gameState = {
  status: 'waiting',    // 'waiting' | 'in_progress' | 'ended'
  currentGame: 1,       // 目前發布的遊戲模組編號 (1 = game1.html, 2 = game2.html, ...)
  currentStage: 1,      // 目前關卡編號 (給同一遊戲內的多關卡使用)
  numStudents: 30,
  numGroups: 5,
  groups: {},   // { group_1: { id: 'group_1', name: '第 1 組', members: ['s01', ...], score: 0 }, ... }
  students: {}  // { s01: { id: 's01', groupId: 'group_1', socketId: null, online: false, stage1Score: null, stage2Score: null, totalScore: 0, finished: false } }
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
    if (gameState.status !== 'in_progress') gameState.status = 'in_progress';

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
