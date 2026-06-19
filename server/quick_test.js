const { io: ioClient } = require('socket.io-client');
const http = require('http');

const API = 'http://localhost:3001';

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({ hostname: 'localhost', port: 3001, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, data: d }); } }); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function test() {
  console.log('=== 新功能快速验证 ===');

  const start = new Date(Date.now() + 3600000).toISOString();
  const end = new Date(Date.now() + 7200000).toISOString();
  const { data: meeting } = await post('/api/meetings', {
    title: 'Quick Test', organizer: 'Tester', participantCount: 3, startTime: start, endTime: end,
  });
  await post(`/api/meetings/${meeting.id}/start`, {});
  console.log('会议:', meeting.id);

  let passed = 0, total = 0;
  function check(name, cond) { total++; if (cond) { passed++; console.log('✅', name); } else { console.log('❌', name); } }

  const sockA = ioClient(API);
  const sockB = ioClient(API);
  const sockC = ioClient(API);

  let aUsers = [], bUsers = [], cElements = [];
  let bGotImg = false, bGotNote = false, bGotNotif = false;

  function join(sock, uid, uname) {
    return new Promise(r => {
      sock.on('connect', () => sock.emit('join-meeting', { meetingId: meeting.id, userId: uid, userName: uname }));
      sock.on('whiteboard-init', d => { r(d); });
    });
  }

  sockA.on('online-users', ({ users }) => { aUsers = users; });
  sockB.on('online-users', ({ users }) => { bUsers = users; });
  sockB.on('whiteboard-add', ({ element }) => {
    if (element.type === 'image') bGotImg = true;
    if (element.type === 'sticky' && element.mentionedUsers?.includes('UserB')) bGotNote = true;
  });
  sockB.on('notification', () => { bGotNotif = true; });

  const initA = await join(sockA, 'a', 'UserA');
  const initB = await join(sockB, 'b', 'UserB');

  await new Promise(r => setTimeout(r, 300));

  check('1. 在线用户列表-B看到2人', bUsers.length >= 2);
  check('2. 在线用户列表-A收到更新', aUsers.length >= 2);
  check('3. 初始化包含在线用户字段', initA.onlineUsers !== undefined);
  check('4. 初始化包含未读通知字段', initA.unreadNotifications !== undefined);

  const imgEl = { id: 'img-1', type: 'image', x: 100, y: 100, width: 200, height: 150,
    imageUrl: '/uploads/test.png', scale: 1, createdBy: 'UserA', mentionedUsers: [] };
  sockA.emit('whiteboard-add', { opId: 'op1', element: imgEl });
  await new Promise(r => setTimeout(r, 500));
  check('5. 图片元素实时同步', bGotImg);

  const noteEl = { id: 'note-1', type: 'sticky', x: 200, y: 200, width: 150, height: 120,
    color: '#ff0', text: 'hi', createdBy: 'UserA', mentionedUsers: ['UserB'] };
  sockA.emit('whiteboard-add', { opId: 'op2', element: noteEl });
  await new Promise(r => setTimeout(r, 500));
  check('6. @便签同步', bGotNote);
  check('7. @通知实时推送', bGotNotif);

  const scaled = { ...imgEl, scale: 2 };
  let bGotScale = false;
  sockB.on('whiteboard-update', ({ element }) => { if (element.id === 'img-1' && element.scale === 2) bGotScale = true; });
  sockA.emit('whiteboard-update', { opId: 'op3', element: scaled });
  await new Promise(r => setTimeout(r, 500));
  check('8. 图片缩放同步', bGotScale);

  let bGotUpdateNotif = false;
  sockB.on('notification', () => { bGotUpdateNotif = true; });
  const updatedNote = { ...noteEl, mentionedUsers: ['UserB', 'UserC'] };
  sockA.emit('whiteboard-update', { opId: 'op4', element: updatedNote });
  await new Promise(r => setTimeout(r, 500));
  check('9. 新增@时也触发通知(update场景)', bGotUpdateNotif);

  const initC = await join(sockC, 'c', 'UserC');
  cElements = initC.elements || [];
  check('10. 新人加入看到完整历史(有图有@)',
    cElements.some(e => e.type === 'image') && cElements.some(e => e.mentionedUsers?.length));
  check('11. 新人收到未读通知', initC.unreadNotifications?.length > 0);

  sockA.disconnect();
  sockB.disconnect();
  sockC.disconnect();

  console.log(`\n=== ${passed}/${total} 测试通过 ===`);
  if (passed === total) {
    console.log('🎉 所有功能验证成功!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

test().catch(e => { console.error(e); process.exit(1); });
