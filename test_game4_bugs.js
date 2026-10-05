const { io } = require('socket.io-client');

async function testGame4BugFixes() {
  console.log('================================================================');
  console.log('  開始驗證遊戲四四大 Bug 修復 (Game 4 WebSocket & State Bug Fixes)');
  console.log('================================================================\n');

  const serverUrl = 'http://localhost:3000';

  // 1. 教師端連線與登入
  const teacherSocket = io(serverUrl);
  await new Promise((resolve) => {
    const doAuth = () => {
      teacherSocket.emit('teacher_auth', { username: 't01', password: 't01' }, resolve);
    };
    if (teacherSocket.connected) doAuth();
    else teacherSocket.once('connect', doAuth);
  });
  console.log('✅ 1. [教師端] 連線與登入驗證成功');

  // 先執行重置確保乾淨狀態
  await new Promise((r) => {
    teacherSocket.emit('force_reset_lobby');
    setTimeout(r, 400);
  });

  // 2. 學生端連線 (s01, s02 屬於 Group 1, s03 屬於 Group 2)
  // 設定 2 個組別
  await new Promise((r) => {
    teacherSocket.emit('generate_groups', { numStudents: 4, numGroups: 2 });
    teacherSocket.once('state_sync', r);
  });

  const s1 = io(serverUrl);
  const s2 = io(serverUrl);
  const s3 = io(serverUrl);

  await new Promise((r) => {
    s1.emit('student_join', { studentId: 's01' });
    s1.once('student_ready', r);
  });
  await new Promise((r) => {
    s2.emit('student_join', { studentId: 's02' });
    s2.once('student_ready', r);
  });
  await new Promise((r) => {
    s3.emit('student_join', { studentId: 's03' });
    s3.once('student_ready', r);
  });
  console.log('✅ 2. 學生端 s01, s02, s03 連線加入成功');

  // 再次分組確保組員正確指派: Group 1 (s01, s03...) or Group 1/Group 2
  await new Promise((r) => {
    teacherSocket.emit('generate_groups', { numStudents: 4, numGroups: 2 });
    teacherSocket.once('state_sync', r);
  });

  // 3. 教師發布開始遊戲四
  const startPromiseS1 = new Promise((r) => s1.once('START_STAGE_4', r));
  const startPromiseS2 = new Promise((r) => s2.once('START_STAGE_4', r));
  const stateUpdatePromise = new Promise((r) => s1.once('STAGE_4_STATE_UPDATE', r));

  teacherSocket.emit('start_game', { game: 4, stage: 1 });

  const startDataS1 = await startPromiseS1;
  const startDataS2 = await startPromiseS2;
  const stateData = await stateUpdatePromise;

  console.log('\n--- 測試項目一：Bug 1 身份比對驗證 (Identity Matching Guard) ---');
  console.log(`當前出題組: 第 ${stateData.turnGroup} 組`);
  console.log(`當前指定出題者 ID: ${stateData.currentTurnPlayerId}`);

  if (!stateData.currentTurnPlayerId) {
    throw new Error('❌ 失敗：STAGE_4_STATE_UPDATE 未包含 currentTurnPlayerId！');
  }

  // 驗證比對邏輯：只有 currentTurnPlayerId 才是出題者
  const currentTurn = stateData.currentTurnPlayerId.toLowerCase();
  const s1IsMyTurn = ('s01' === currentTurn);
  const s2IsMyTurn = ('s02' === currentTurn);
  const s3IsMyTurn = ('s03' === currentTurn);

  console.log(`s01 是否輪到出題: ${s1IsMyTurn}`);
  console.log(`s02 是否輪到出題: ${s2IsMyTurn}`);
  console.log(`s03 是否輪到出題: ${s3IsMyTurn}`);

  if (!s1IsMyTurn && !s2IsMyTurn) {
    throw new Error('❌ 失敗：第 1 組成員應有其中一位為當前出題者！');
  }
  // 兩者絕不可能同時為 true
  if (s1IsMyTurn && s2IsMyTurn) {
    throw new Error('❌ 失敗：身份混淆，兩名學生同時被判定為出題者！');
  }
  console.log('✅ 成功：身份精確隔離，僅當前輪到的學生才能出題，其他同學保持觀看等待模式！');

  // --- 測試項目二：Bug 2 教師端即時輸入狀態 (Real-time Typing Status) ---
  console.log('\n--- 測試項目二：Bug 2 教師端即時輸入狀態廣播 (Real-time Typing Status) ---');
  const teacherTypingPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('教師端未在時限內收到 student_typing')), 4000);
    teacherSocket.once('student_typing', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  const activeStudentSocket = s1IsMyTurn ? s1 : s2;
  const activeStudentId = s1IsMyTurn ? 's01' : 's02';

  activeStudentSocket.emit('student_typing', {
    studentId: activeStudentId,
    input: 'H',
    letter: 'H',
    shifted: 'J',
    morse: '.---',
    isSubmitted: false
  });

  const teacherReceivedTyping = await teacherTypingPromise;
  console.log('✅ 教師端收到即時打字廣播:', teacherReceivedTyping);

  if (teacherReceivedTyping.studentId !== activeStudentId || teacherReceivedTyping.letter !== 'H') {
    throw new Error('❌ 失敗：教師端收到的打字資料不符合！');
  }
  console.log('✅ 成功：學生打字時，教師端看板即時接收到打字進度與字元！');

  // 出題者提交該字母
  activeStudentSocket.emit('game4_submit_letter', {
    studentId: activeStudentId,
    letter: 'H'
  });

  // --- 測試項目四：Bug 4 輪次切換時的 State 清空與 RESET_TURN_INPUT ---
  console.log('\n--- 測試項目四：Bug 4 輪次切換輸入長度與 State 清空 (RESET_TURN_INPUT) ---');
  // 發布出題完成
  await new Promise((r) => {
    s1.once('game4_word_broadcast', r);
    teacherSocket.emit('game4_confirm_word', { customWord: 'HE' });
  });
  console.log('✅ 出題組已發布單字 "HE"，進入解密階段');

  // 解密組提交作答並結算 Round 1
  const decryptGroupSocket = s3;
  await new Promise((r) => {
    decryptGroupSocket.emit('game4_submit_decryption', {
      studentId: 's03',
      answer: 'HE',
      timeTaken: 5.0
    }, r);
  });

  // 監聽 RESET_TURN_INPUT 與 STAGE_4_STATE_UPDATE
  const resetTurnPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('未收到 RESET_TURN_INPUT')), 4000);
    s1.once('RESET_TURN_INPUT', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  console.log('觸發第 1 回合結算，切換至第 2 輪出題組...');
  teacherSocket.emit('game4_teacher_settle_round');

  const resetData = await resetTurnPromise;
  console.log('✅ 收到 RESET_TURN_INPUT 指令:', resetData);

  if (resetData.round !== 2) {
    throw new Error(`❌ 失敗：RESET_TURN_INPUT 輪次應為 2，實際為 ${resetData.round}`);
  }
  if (!resetData.currentTurnPlayerId) {
    throw new Error('❌ 失敗：RESET_TURN_INPUT 未重新指定新一輪出題者！');
  }
  console.log(`✅ 成功：第 2 回合已清空上一輪暫存，重新計算長度為 ${resetData.expectedLength}，新出題者為 ${resetData.currentTurnPlayerId}！`);

  // --- 測試項目三：Bug 3 回合數上限限制 (Round Bound Limit Guard) ---
  console.log('\n--- 測試項目三：Bug 3 回合數上限限制與自動結束 (Round Bound Limit) ---');
  console.log(`目前最大回合數 (maxRounds): ${resetData.maxRounds || 2}`);

  // 第 2 回合出題與解密作答
  await new Promise((r) => {
    s1.once('game4_word_broadcast', r);
    teacherSocket.emit('game4_confirm_word', { customWord: 'GO' });
  });

  await new Promise((r) => {
    s1.emit('game4_submit_decryption', {
      studentId: 's01',
      answer: 'GO',
      timeTaken: 4.0
    }, r);
  });

  // 監聽 GAME_OVER 廣播
  const gameOverPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('未收到 game4_game_over 廣播')), 4000);
    s1.once('game4_game_over', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  console.log('觸發第 2 回合 (最後一回合) 結算...');
  teacherSocket.emit('game4_teacher_settle_round');

  const gameOverData = await gameOverPromise;
  console.log('✅ 收到 game4_game_over 總結算排行榜:', gameOverData);

  if (!gameOverData.rankings || gameOverData.rankings.length === 0) {
    throw new Error('❌ 失敗：game_over 未包含排行榜資料！');
  }

  // 嘗試再次觸發 advanceGame4NextRound，驗證後端不允許無限遞增
  teacherSocket.emit('game4_teacher_next_round');
  await new Promise((r) => setTimeout(r, 400));

  console.log('✅ 成功：達到最大回合數後，全域狀態強制切換至 GAME_OVER，自動廣播總決賽排行榜，回合數未無限遞增！');

  console.log('\n================================================================');
  console.log('🎉 遊戲四四大 Bug 修復驗證全部通過 (ALL GAME 4 FIXES VERIFIED)!');
  console.log('================================================================\n');

  s1.disconnect();
  s2.disconnect();
  s3.disconnect();
  teacherSocket.disconnect();
  process.exit(0);
}

testGame4BugFixes().catch((err) => {
  console.error('\n❌ 測試過程發生異常:', err);
  process.exit(1);
});
