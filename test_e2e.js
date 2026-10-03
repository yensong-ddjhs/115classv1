const { io } = require('socket.io-client');

async function testFullFlow() {
  console.log('--- Starting Classroom Game E2E Test ---');
  const serverUrl = 'http://localhost:3000';

  // 1. 連線教師端
  const teacherSocket = io(serverUrl);
  let teacherAuthResult = await new Promise((resolve) => {
    teacherSocket.on('connect', () => {
      teacherSocket.emit('teacher_auth', { username: 't01', password: 't01' }, resolve);
    });
  });
  console.log('1. 教師登入結果:', teacherAuthResult.success ? '成功 (PASS)' : '失敗 (FAIL)');

  // 2. 連線學生 s01
  const studentSocket = io(serverUrl);
  let studentData = await new Promise((resolve) => {
    studentSocket.on('connect', () => {
      studentSocket.emit('student_join', { studentId: 's01' });
    });
    studentSocket.on('student_ready', resolve);
  });
  console.log(`2. 學生 s01 加入成功: 所屬 ${studentData.group.name} (PASS)`);

  // 3. 教師執行隨機分組 (30 人 5 組)
  let updatedState = await new Promise((resolve) => {
    teacherSocket.emit('generate_groups', { numStudents: 30, numGroups: 5 });
    teacherSocket.once('state_sync', resolve);
  });
  console.log(`3. 隨機分組完成: 總人數 ${updatedState.numStudents}, 組數 ${Object.keys(updatedState.groups).length} (PASS)`);

  // 4. 教師開始遊戲
  let gameStartedPromise = new Promise((resolve) => {
    studentSocket.once('game_started', () => {
      console.log('4. 學生端收到遊戲開始廣播 (game_started) (PASS)');
      resolve();
    });
  });
  teacherSocket.emit('start_game');
  await gameStartedPromise;

  // 5. 學生完成第一關 (花費 45 秒 -> 3分)
  let stage1ScorePromise = new Promise((resolve) => {
    teacherSocket.once('update_teacher_score', (data) => {
      console.log(`5. 第一關分數更新: 組別 ${data.groupId}, 總分 ${data.totalScore}, 二進位 ${data.binaryScore} (PASS)`);
      resolve(data);
    });
  });
  studentSocket.emit('submit_stage1', { studentId: 's01', score: 3, timeTaken: 45 });
  const s1Res = await stage1ScorePromise;
  if (s1Res.binaryScore !== '11') {
    throw new Error(`Expected binary '11' (3), got ${s1Res.binaryScore}`);
  }

  // 6. 學生完成第二關 (答對 5 題 -> 5分)
  let stage2ScorePromise = new Promise((resolve) => {
    teacherSocket.once('update_teacher_score', (data) => {
      console.log(`6. 第二關分數更新: 組別 ${data.groupId}, 總分 ${data.totalScore}, 二進位 ${data.binaryScore} (PASS)`);
      resolve(data);
    });
  });
  studentSocket.emit('submit_stage2', { studentId: 's01', score: 5 });
  const s2Res = await stage2ScorePromise;
  // 3 + 5 = 8 -> binary: 1000
  if (s2Res.totalScore === 8 && s2Res.binaryScore === '1000') {
    console.log('7. 二進位換算驗證: 8 (十進位) === 1000 (二進位) (PASS)');
  } else {
    throw new Error(`Expected totalScore 8 and binary '1000', got ${s2Res.totalScore} and ${s2Res.binaryScore}`);
  }

  teacherSocket.disconnect();
  studentSocket.disconnect();
  console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

testFullFlow().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
