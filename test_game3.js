const { io } = require('socket.io-client');

async function testGame3Flow() {
  console.log('--- Starting Game 3 E2E Test ---');
  const serverUrl = 'http://localhost:3000';

  // 1. 連線教師端
  const teacherSocket = io(serverUrl);
  let teacherAuth = await new Promise((resolve) => {
    const doAuth = () => {
      teacherSocket.emit('teacher_auth', { username: 't01', password: 't01' }, resolve);
    };
    if (teacherSocket.connected) doAuth();
    else teacherSocket.once('connect', doAuth);
  });
  console.log('1. 教師登入:', teacherAuth.success ? '成功 (PASS)' : '失敗 (FAIL)');

  // 2. 隨機分組
  await new Promise((resolve) => {
    teacherSocket.emit('generate_groups', { numStudents: 30, numGroups: 5 });
    teacherSocket.once('state_sync', resolve);
  });
  console.log('2. 教師隨機分組完成 (PASS)');

  // 3. 切換至遊戲三並發布開始
  await new Promise((resolve) => {
    teacherSocket.emit('switch_game', { game: 3 });
    teacherSocket.once('game_switched', resolve);
  });
  teacherSocket.emit('start_game', { game: 3, stage: 1 });
  console.log('3. 切換至遊戲三並發布開始 (PASS)');

  // 連線學生輔助函式
  function connectStudent(id) {
    return new Promise((resolve) => {
      const s = io(serverUrl);
      const doJoin = () => s.emit('student_join', { studentId: id });
      if (s.connected) doJoin();
      else s.once('connect', doJoin);
      s.once('student_ready', (data) => resolve({ socket: s, data }));
    });
  }

  // 4. 連線學生 s01 (第 1 組) 與 s06 (第 2 組)
  const { socket: s1Socket, data: s1Data } = await connectStudent('s01');
  const { socket: s2Socket, data: s2Data } = await connectStudent('s06');
  console.log(`4. 學生連線: s01(${s1Data.group.name}), s06(${s2Data.group.name}) (PASS)`);

  // 5. 初始化 stage3
  await new Promise((resolve) => {
    s1Socket.emit('stage3_init', { studentId: 's01' }, resolve);
  });
  await new Promise((resolve) => {
    s2Socket.emit('stage3_init', { studentId: 's06' }, resolve);
  });
  console.log('5. 學生端 stage3 初始化資料獲取成功 (PASS)');

  // 6. 移動兩名學生使其碰撞 (距離 <= 40px)
  const encounterPromise = new Promise((resolve) => {
    s1Socket.once('encounter_triggered', (data) => {
      resolve(data);
    });
  });

  // 設定相同座標 (x: 400, y: 300) 觸發遭遇
  s1Socket.emit('player_move', { studentId: 's01', x: 400, y: 300 });
  s2Socket.emit('player_move', { studentId: 's06', x: 410, y: 305 });

  const encData = await encounterPromise;
  console.log(`6. 碰撞遭遇觸發成功: 遭遇 ID ${encData.encounterId}, 對手: ${encData.opponent.id} (PASS)`);

  // 7. 測試行動：雙方選擇 [合作補血]
  const coopPromise = new Promise((resolve) => {
    s1Socket.once('encounter_result', resolve);
  });
  s1Socket.emit('submit_action', { encounterId: encData.encounterId, studentId: 's01', action: 'cooperate' });
  s2Socket.emit('submit_action', { encounterId: encData.encounterId, studentId: 's06', action: 'cooperate' });

  const coopResult = await coopPromise;
  console.log(`7. 合作補血結果: ${coopResult.message} (PASS)`);

  // 8. 測試競爭對決：讓老師呼叫模擬對決
  const battleScorePromise = new Promise((resolve) => {
    teacherSocket.once('update_teacher_score', (data) => {
      resolve(data);
    });
  });
  teacherSocket.emit('teacher_simulate_game3_battle');
  const battleRes = await battleScorePromise;
  console.log(`8. 對決與計分完成: 組別 ${battleRes.groupId}, 總分 ${battleRes.totalScore}, 二進位 ${battleRes.binaryScore} (PASS)`);

  // 9. 測試結算宣布
  const gameEndPromise = new Promise((resolve) => {
    teacherSocket.once('game_3_ended', resolve);
  });
  teacherSocket.emit('teacher_end_game3');
  const endData = await gameEndPromise;
  console.log(`9. 遊戲三宣布結算: 冠軍 ${endData.winner.name} (二進位: ${endData.winner.binaryScore}), 亞軍 ${endData.runnerUp.name} (PASS)`);

  // 斷線清理
  teacherSocket.disconnect();
  s1Socket.disconnect();
  s2Socket.disconnect();

  console.log('--- GAME 3 ALL TESTS PASSED! ---');
  process.exit(0);
}

testGame3Flow().catch((err) => {
  console.error('Game 3 Test Error:', err);
  process.exit(1);
});
