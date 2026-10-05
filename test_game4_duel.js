const { io } = require('socket.io-client');
const http = require('http');

async function runGame4Test() {
  console.log('=== 開始測試：大廳等待狀態機 與 凱撒摩斯密碼小隊對決 ===');
  const serverUrl = 'http://localhost:3000';

  // 1. 教師登入連線
  const teacherSocket = io(serverUrl);
  await new Promise((resolve) => {
    teacherSocket.on('connect', () => {
      teacherSocket.emit('teacher_auth', { username: 't01', password: 't01' }, resolve);
    });
  });
  console.log('✅ 1. 教師端連線與登入驗證成功');

  // 2. 學生 s01 (預計 group_1) 與 s06 (預計 group_2) 連線登入大廳
  const student1Socket = io(serverUrl);
  const s1Ready = new Promise(resolve => student1Socket.on('student_ready', resolve));
  student1Socket.emit('student_join', { studentId: 's01' });
  const s1Init = await s1Ready;
  console.log(`✅ 2-1. 學生 s01 加入大廳: 初始組別 ${s1Init.group.name}`);

  const student2Socket = io(serverUrl);
  const s2Ready = new Promise(resolve => student2Socket.on('student_ready', resolve));
  student2Socket.emit('student_join', { studentId: 's06' });
  const s2Init = await s2Ready;
  console.log(`✅ 2-2. 學生 s06 加入大廳: 初始組別 ${s2Init.group.name}`);

  // 檢查大廳狀態是否包含在線學生座號與人數
  let stateSync = await new Promise(resolve => teacherSocket.once('state_sync', resolve));
  console.log(`✅ 2-3. 大廳等待在線人數: ${stateSync.onlineCount} 人, 在線名單: ${stateSync.onlineStudents.join(', ')}`);
  if (!stateSync.onlineStudents.includes('s01') || !stateSync.onlineStudents.includes('s06')) {
    throw new Error('線上學生名單未正確包含 s01 或 s06');
  }

  // 3. 教師端執行隨機分組並進入準備階段 (GROUPED)
  console.log('3. 教師端執行隨機分組 (5 組)...');
  const groupUpdatePromise = new Promise(resolve => student1Socket.once('groups_updated', resolve));
  teacherSocket.emit('generate_groups', { numStudents: 30, numGroups: 5 });
  const groupUpdate = await groupUpdatePromise;
  console.log(`✅ 3-1. 學生端成功接收到分組廣播: 共有 ${Object.keys(groupUpdate.groups).length} 組`);

  // 教師點擊「廣播分組 / 準備階段」
  const groupedSignalPromise = new Promise(resolve => student1Socket.once('groups_prepared', resolve));
  teacherSocket.emit('teacher_enter_grouped');
  await groupedSignalPromise;
  console.log('✅ 3-2. 學生端成功同步接收到準備階段訊號 (GROUPED)');

  // 4. 教師點擊「開始遊戲」，發布「遊戲四：凱撒摩斯密碼小隊對決」
  console.log('4. 教師點擊開始遊戲四...');
  const startPromise = new Promise(resolve => student1Socket.once('game_started', resolve));
  teacherSocket.emit('start_game', { game: 4, stage: 1 });
  const startData = await startPromise;
  console.log(`✅ 4. 全體學生端同步收到 game_started: 遊戲編號 ${startData.currentGame}, 狀態 ${startData.status}`);
  if (startData.currentGame !== 4) {
    throw new Error(`預期 currentGame 為 4，實際為 ${startData.currentGame}`);
  }

  // 5. 遊戲四初始化：連線至遊戲四
  const s1G4Ready = new Promise(resolve => student1Socket.once('game4_ready', resolve));
  student1Socket.emit('game4_init', { studentId: 's01' });
  const s1G4 = await s1G4Ready;

  const s2G4Ready = new Promise(resolve => student2Socket.once('game4_ready', resolve));
  student2Socket.emit('game4_init', { studentId: 's06' });
  const s2G4 = await s2G4Ready;

  console.log(`✅ 5. 遊戲四初始化成功: 當前回合 Round ${s1G4.game4.round}, 當前出題組為 ${s1G4.game4.turnGroup}`);

  // 6. 出題組組員輸入英文字母 (以 HELLO 為例，或出題組輸入字母)
  const turnGroupId = s1G4.game4.turnGroup;
  console.log(`6. 當前出題組為 ${turnGroupId}。由該組成員輸入英文字母並進行凱撒位移 (+2) 與摩斯編碼...`);

  // 找出屬於 turnGroupId 的組員
  const turnGroupMembers = s1G4.groups[turnGroupId].members;
  console.log(`出題組組員清單: ${turnGroupMembers.slice(0, 5).join(', ')}`);

  // 出題組第一位輸入字母 'H'
  const inputUpdatePromise = new Promise(resolve => teacherSocket.once('game4_inputs_updated', resolve));
  student1Socket.emit('game4_submit_letter', {
    studentId: turnGroupMembers[0],
    letter: 'H'
  });
  const inputUpdate = await inputUpdatePromise;
  const hInput = inputUpdate.inputs[turnGroupMembers[0]];
  console.log(`✅ 6-1. 組員 ${turnGroupMembers[0]} 輸入 'H': 凱撒位移 (+2) -> '${hInput.shifted}', 摩斯編碼 -> '${hInput.morse}'`);
  if (hInput.shifted !== 'J') {
    throw new Error(`預期 H + 2 = J，實際為 ${hInput.shifted}`);
  }
  if (hInput.morse !== '.---') {
    throw new Error(`預期 J 的摩斯密碼為 .---，實際為 ${hInput.morse}`);
  }

  // 7. 出題組確認完成題目並推播摩斯密碼
  console.log('7. 出題組確認完成題目 (使用自訂單字 "CODE" 進行標準化驗證)...');
  const broadcastPromise = new Promise(resolve => student2Socket.once('game4_word_broadcast', resolve));
  teacherSocket.emit('game4_confirm_word', { customWord: 'CODE' });
  const broadcast = await broadcastPromise;

  console.log(`✅ 7. 解密組成功收到題目廣播:`);
  console.log(`   題目長度: ${broadcast.letterCount} 個字母`);
  console.log(`   推播的摩斯密碼: ${broadcast.morseCode}`);

  // 驗證 "CODE" 凱撒 +2: C->E, O->Q, D->F, E->G  (EQFG)
  // E: '.', Q: '--.-', F: '..-.', G: '--.'
  // 摩斯: . --.- ..-. --.
  if (broadcast.morseCode !== '. --.- ..-. --.') {
    throw new Error(`預期 CODE 凱撒位移後 EQFG 的摩斯碼為 '. --.- ..-. --.'，實際為 '${broadcast.morseCode}'`);
  }

  // 8. 解密組進行解密作答並提交答案
  console.log('8. 解密組進行還原解密並送出答案...');
  // 解密組成員收到摩斯碼 . --.- ..-. --.
  // 查表得 EQFG，逆向位移 -2 得原始答案 CODE
  const decryptStudentId = 's06';

  const submitRes = await new Promise(resolve => {
    student2Socket.emit('game4_submit_decryption', {
      studentId: decryptStudentId,
      answer: 'CODE',
      timeTaken: 10.5
    }, resolve);
  });

  console.log(`✅ 8. 解密作答評分結果: 答對 ${submitRes.correctCount}/${submitRes.totalCount} 字, 獲得得分: +${submitRes.scoreEarned} 分`);
  if (submitRes.scoreEarned !== 4) {
    throw new Error(`全對應得 4 分，實際得 ${submitRes.scoreEarned} 分`);
  }

  // 9. 回合結算驗證
  console.log('9. 教師端觸發本回合結算...');
  const settlePromise = new Promise(resolve => student1Socket.once('game4_round_settled', resolve));
  teacherSocket.emit('game4_teacher_settle_round');
  const settleResult = await settlePromise;

  console.log(`✅ 9. 回合結算完成:`);
  console.log(`   原始單字: ${settleResult.originalWord}`);
  console.log(`   凱撒加密: ${settleResult.shiftedWord}`);
  console.log(`   各組總分:`, settleResult.totalScores);

  // 10. 教師端切換至下一輪
  console.log('10. 教師端切換至下一輪出題...');
  const newRoundPromise = new Promise(resolve => student1Socket.once('game4_new_round', resolve));
  teacherSocket.emit('game4_teacher_next_round');
  const newRound = await newRoundPromise;

  console.log(`✅ 10. 成功輪替至第 ${newRound.round} 回合，由 ${newRound.turnGroupName} 擔任出題組！`);

  // 斷線清理
  teacherSocket.disconnect();
  student1Socket.disconnect();
  student2Socket.disconnect();

  console.log('\n=============================================');
  console.log('🎉 恭喜！凱撒摩斯密碼小隊對決與狀態機全部測試通過！');
  console.log('=============================================\n');
  process.exit(0);
}

runGame4Test().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
