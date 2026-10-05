const { io } = require('socket.io-client');
const http = require('http');

async function runAllFixesTest() {
  console.log('====================================================');
  console.log('   開始全面驗證四大修復項目 (All Fixes Verification)');
  console.log('====================================================\n');
  const serverUrl = 'http://localhost:3000';

  // --- 教師端連線 ---
  const teacherSocket = io(serverUrl);
  await new Promise((resolve) => {
    const doAuth = () => {
      teacherSocket.emit('teacher_auth', { username: 't01', password: 't01' }, resolve);
    };
    if (teacherSocket.connected) doAuth();
    else teacherSocket.once('connect', doAuth);
  });
  console.log('✅ [教師端] 連線與身分驗證成功');

  // ====================================================
  // 一、 大廳與教師端控制台 (Lobby & Teacher Control Fixes)
  // ====================================================
  console.log('\n--- 測試項目一：學生登入與座號更新錯亂修正 (Dynamic Student ID Sync) ---');
  // 1. 學生 1 (s01) 登入
  const s1 = io(serverUrl);
  await new Promise(r => {
    s1.emit('student_join', { studentId: 's01' });
    s1.once('student_ready', r);
  });
  console.log('✅ 學生 1 (s01) 加入大廳');

  // 2. 學生 2 (s02) 登入
  const s2 = io(serverUrl);
  await new Promise(r => {
    s2.emit('student_join', { studentId: 's02' });
    s2.once('student_ready', r);
  });
  console.log('✅ 學生 2 (s02) 加入大廳');

  // 3. 學生 2 改座號為 3 號 (s03) 重新登入，驗證伺服器即時移除已離線的 2 號
  const statusUpdatePromise = new Promise(r => {
    const handler = (data) => {
      if (data.studentId === 's03') {
        teacherSocket.off('student_status_changed', handler);
        r(data);
      }
    };
    teacherSocket.on('student_status_changed', handler);
  });
  s2.emit('student_join', { studentId: 's03' });
  const statusData = await statusUpdatePromise;
  
  const activeIds = (statusData.activeStudents || []).map(s => s.id);
  console.log(`✅ 座號動態更新後的在線清單: [${activeIds.join(', ')}]`);
  if (activeIds.includes('s02')) {
    throw new Error('❌ 失敗：已離線的 s02 未被移除！');
  }
  if (!activeIds.includes('s01') || !activeIds.includes('s03')) {
    throw new Error('❌ 失敗：真實連線的 s01 與 s03 未完整保留！');
  }
  console.log('✅ 成功：2 號已被移除，僅保留當前真實連線的 1 號與 3 號！');

  // 4. 強制全域重置功能 (Hard State Reset) 測試
  console.log('\n--- 測試項目一：強制全域重置功能 (Hard State Reset) ---');
  const resetReceivedS1 = new Promise(r => s1.once('FORCE_RESET_LOBBY', r));
  const resetReceivedS2 = new Promise(r => s2.once('FORCE_RESET_LOBBY', r));
  teacherSocket.emit('force_reset_lobby');

  await Promise.all([resetReceivedS1, resetReceivedS2]);
  console.log('✅ 成功：學生端 s1 與 s2 皆收到 FORCE_RESET_LOBBY 全域廣播事件！');

  // 檢查重置後伺服器 activeStudents 是否清空
  const stateAfterReset = await new Promise(r => teacherSocket.once('state_sync', r));
  if (stateAfterReset.activeStudents.length !== 0) {
    throw new Error('❌ 失敗：重置後 activeStudents 未被清空！');
  }
  console.log('✅ 成功：重置後伺服器記憶體中 activeStudents 陣列已完全清空！');

  // ====================================================
  // 二、 遊戲四修復：分組分配與輸入鎖定 (Stage 4 Grouping & Input Lock Fix)
  // ====================================================
  console.log('\n--- 測試項目二：遊戲四分組分配 (Correct Group ID Assignment) ---');
  // 讓 1 號 (s01) 與 2 號 (s02) 重新加入
  await new Promise(r => {
    s1.emit('student_join', { studentId: 's01' });
    s1.once('student_ready', r);
  });
  await new Promise(r => {
    s2.emit('student_join', { studentId: 's02' });
    s2.once('student_ready', r);
  });

  // 2 人分 2 組
  const groupsUpdatedPromise = new Promise(r => teacherSocket.once('groups_updated', r));
  teacherSocket.emit('generate_groups', { numStudents: 2, numGroups: 2 });
  const groupsData = await groupsUpdatedPromise;

  const s01Group = groupsData.students['s01'].groupId;
  const s02Group = groupsData.students['s02'].groupId;
  console.log(`✅ 分組結果: s01 -> groupId: ${s01Group}, s02 -> groupId: ${s02Group}`);
  if (s01Group !== 1 || s02Group !== 2) {
    throw new Error(`❌ 失敗：預期 1 號取得 groupId: 1，2 號取得 groupId: 2，實際為 s01=${s01Group}, s02=${s02Group}`);
  }
  console.log('✅ 成功：2 人分 2 組時，1 號取得 groupId: 1，2 號取得 groupId: 2，兩人被正確分入不同組！');

  console.log('\n--- 測試項目二：解鎖學生端輸入框 (START_STAGE_4) ---');
  const startStage4Promise = new Promise(r => s1.once('START_STAGE_4', r));
  teacherSocket.emit('start_game', { game: 4, stage: 1 });
  const stage4EventData = await startStage4Promise;
  console.log(`✅ 成功：學生端成功監聽到 START_STAGE_4 事件 (當前出題組: 第 ${stage4EventData.turnGroup} 組)`);

  // ====================================================
  // 三、 遊戲三修復：多人在線碰撞與座標同步 (Stage 3 Multiplayer Position & Collision Sync)
  // ====================================================
  console.log('\n--- 測試項目三：多人連線頻道綁定 (stage3_room_X) ---');
  const s1Init3 = await new Promise(r => {
    s1.emit('stage3_init', { studentId: 's01' });
    s1.once('stage3_ready', r);
  });
  const s2Init3 = await new Promise(r => {
    s2.emit('stage3_init', { studentId: 's02' });
    s2.once('stage3_ready', r);
  });
  console.log(`✅ s01 加入房間: ${s1Init3.room}, s02 加入房間: ${s2Init3.room}`);
  if (s1Init3.room !== 'stage3_room_1' || s2Init3.room !== 'stage3_room_1') {
    throw new Error('❌ 失敗：兩人未分入同一個 Socket Room (stage3_room_1)！');
  }
  console.log('✅ 成功：兩位玩家成功 Join 入同一個 Socket Room (stage3_room_1)！');

  console.log('\n--- 測試項目三：實時座標廣播與碰撞偵測 (player_movement & Hitbox Collision) ---');
  // s1 移動，驗證 s2 能否即時接收到 player_movement
  const s2ReceiveMovePromise = new Promise(r => s2.once('player_movement', r));
  s1.emit('player_movement', { studentId: 's01', x: 300, y: 300 });
  const s2ReceivedPos = await s2ReceiveMovePromise;
  console.log(`✅ 成功：s2 實時收到 s01 的座標廣播: x=${s2ReceivedPos.x}, y=${s2ReceivedPos.y}`);

  // 兩人移動至碰撞距離 (<= 50px Hitbox)
  const encounterTriggerPromise = new Promise(r => s1.once('encounter_triggered', r));
  s1.emit('player_movement', { studentId: 's01', x: 450, y: 450 });
  s2.emit('player_movement', { studentId: 's02', x: 470, y: 460 }); // 距離約 22px <= 50px
  const encounterData = await encounterTriggerPromise;
  console.log(`✅ 成功：玩家 A 與 玩家 B 的 Hitbox 碰撞檢測正確觸發遭遇對決！(遭遇 ID: ${encounterData.encounterId}, 對手: ${encounterData.opponent.id})`);

  // ====================================================
  // 四、 遊戲二修復：解除等待卡死狀態 (Stage 2 Wait Lock Fix)
  // ====================================================
  console.log('\n--- 測試項目四：遊戲二關卡切換狀態廣播 (STAGE2_ACTIVE) ---');
  const stage2ActivePromise = new Promise(r => s1.once('STAGE2_ACTIVE', r));
  teacherSocket.emit('start_game', { game: 2, stage: 1 });
  const stage2EventData = await stage2ActivePromise;
  console.log(`✅ 成功：學生端正確監聽到 STAGE2_ACTIVE 事件 (狀態: ${stage2EventData.status})！`);

  // 清理連線
  s1.disconnect();
  s2.disconnect();
  teacherSocket.disconnect();

  console.log('\n====================================================');
  console.log('🎉 所有四大區塊驗證全部順利通過 (ALL TESTS PASSED)!');
  console.log('====================================================');
  process.exit(0);
}

runAllFixesTest().catch(err => {
  console.error('\n❌ 測試過程發生錯誤:', err);
  process.exit(1);
});
