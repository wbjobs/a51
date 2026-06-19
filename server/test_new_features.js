const { io: ioClient } = require('socket.io-client');
const http = require('http');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const API_BASE = 'http://localhost:3001';

function apiPost(path, data, isFormData = false) {
  return new Promise((resolve, reject) => {
    if (isFormData) {
      data.submit(`${API_BASE}${path}`, (err, res) => {
        if (err) return reject(err);
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
          catch (e) { resolve({ status: res.statusCode, data: body }); }
        });
      });
    } else {
      const postData = JSON.stringify(data);
      const options = {
        hostname: 'localhost', port: 3001, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      };
      const req = http.request(options, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
          catch (e) { resolve({ status: res.statusCode, data: body }); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    }
  });
}

async function test() {
  console.log('=== 创建测试会议 ===');
  const startTime = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  const endTime = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const meetingRes = await apiPost('/api/meetings', {
    title: 'New Features Test', organizer: 'Tester', participantCount: 5, startTime, endTime,
  });
  const meetingId = meetingRes.data.id;
  console.log('会议ID:', meetingId);

  await apiPost(`/api/meetings/${meetingId}/start`, {});

  console.log('\n=== 连接2个用户 ===');
  const userA = ioClient(API_BASE);
  const userB = ioClient(API_BASE);

  let userBNotifications = [];
  let userAOnlineUsers = [];
  let userBOnlineUsers = [];

  function connectUser(socket, userId, userName) {
    return new Promise(resolve => {
      socket.on('connect', () => {
        socket.emit('join-meeting', { meetingId, userId, userName });
      });
      socket.on('whiteboard-init', (data) => {
        console.log(`${userName} 已连接，在线用户:`, data.onlineUsers?.map(u => u.userName).join(', '));
        if (data.onlineUsers) {
          if (userName === 'UserA') userAOnlineUsers = data.onlineUsers;
          else userBOnlineUsers = data.onlineUsers;
        }
        resolve();
      });
      socket.on('online-users', ({ users }) => {
        console.log(`${userName} 收到在线用户更新:`, users.map(u => u.userName).join(', '));
        if (userName === 'UserA') userAOnlineUsers = users;
        else userBOnlineUsers = users;
      });
    });
  }

  await connectUser(userA, 'user-a', 'UserA');
  await connectUser(userB, 'user-b', 'UserB');

  await new Promise(r => setTimeout(r, 500));

  console.log('\n=== 测试1: 在线用户列表 ===');
  console.log('UserA看到的在线人数:', userAOnlineUsers.length);
  console.log('UserB看到的在线人数:', userBOnlineUsers.length);
  const t1 = userAOnlineUsers.length >= 2 && userBOnlineUsers.length >= 2;
  console.log('在线用户列表正常:', t1 ? '✅' : '❌');

  console.log('\n=== 测试2: 图片上传API ===');
  const testImgPath = path.join(__dirname, 'test-image.png');
  if (!fs.existsSync(testImgPath)) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(testImgPath, png);
  }
  const form = new FormData();
  form.append('image', fs.createReadStream(testImgPath));

  const uploadRes = await apiPost('/api/uploads/image', form, true);
  console.log('上传状态:', uploadRes.status, 'URL:', uploadRes.data.url);
  const t2 = uploadRes.status === 200 && uploadRes.data.url;
  console.log('图片上传正常:', t2 ? '✅' : '❌');

  console.log('\n=== 测试3: 添加图片元素并同步 ===');
  const imgElement = {
    id: 'img-test-001',
    type: 'image',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    imageUrl: uploadRes.data.url,
    scale: 1,
    createdBy: 'UserA',
    mentionedUsers: [],
  };

  let userBGotImage = false;
  userB.on('whiteboard-add', ({ element }) => {
    if (element.type === 'image') {
      userBGotImage = true;
      console.log('UserB 收到图片:', element.id, element.imageUrl);
    }
  });

  userA.emit('whiteboard-add', { opId: 'op-img-1', element: imgElement });
  await new Promise(r => setTimeout(r, 1000));
  const t3 = userBGotImage;
  console.log('图片元素同步正常:', t3 ? '✅' : '❌');

  console.log('\n=== 测试4: @通知功能 ===');
  const mentionNote = {
    id: 'note-mention-001',
    type: 'sticky',
    x: 200,
    y: 200,
    width: 150,
    height: 120,
    color: '#f8bbd0',
    text: '@UserB 请看一下这个',
    createdBy: 'UserA',
    mentionedUsers: ['UserB'],
  };

  let userBGotNotification = false;
  userB.on('notification', (notif) => {
    console.log('UserB 收到通知:', notif.fromUser, notif.content);
    userBGotNotification = true;
  });

  userA.emit('whiteboard-add', { opId: 'op-mention-1', element: mentionNote });
  await new Promise(r => setTimeout(r, 1000));
  const t4 = userBGotNotification;
  console.log('@通知推送正常:', t4 ? '✅' : '❌');

  console.log('\n=== 测试5: 图片缩放更新同步 ===');
  const scaledImg = { ...imgElement, scale: 1.5 };
  let userBGotScaleUpdate = false;
  userB.on('whiteboard-update', ({ element }) => {
    if (element.id === 'img-test-001' && element.scale === 1.5) {
      userBGotScaleUpdate = true;
      console.log('UserB 收到缩放更新:', element.scale);
    }
  });
  userA.emit('whiteboard-update', { opId: 'op-scale-1', element: scaledImg });
  await new Promise(r => setTimeout(r, 1000));
  const t5 = userBGotScaleUpdate;
  console.log('图片缩放同步正常:', t5 ? '✅' : '❌');

  console.log('\n=== 测试6: 新人加入获取完整历史(含图片和@) ===');
  const userC = ioClient(API_BASE);
  let userCElements = [];
  await new Promise(resolve => {
    userC.on('connect', () => userC.emit('join-meeting', { meetingId, userId: 'user-c', userName: 'UserC' }));
    userC.on('whiteboard-init', (data) => {
      userCElements = data.elements || [];
      console.log('UserC 初始化元素数量:', userCElements.length);
      resolve();
    });
  });
  const hasImg = userCElements.some(e => e.type === 'image');
  const hasMentionNote = userCElements.some(e => e.mentionedUsers && e.mentionedUsers.includes('UserB'));
  const t6 = hasImg && hasMentionNote;
  console.log('历史数据完整(有图+有@):', t6 ? '✅' : '❌');

  userA.disconnect();
  userB.disconnect();
  userC.disconnect();

  if (fs.existsSync(testImgPath)) {
    fs.unlinkSync(testImgPath);
  }

  console.log('\n=========================');
  const allPass = t1 && t2 && t3 && t4 && t5 && t6;
  if (allPass) {
    console.log('✅✅✅ 所有新功能测试通过!');
    console.log('   1. 在线用户列表');
    console.log('   2. 图片上传API');
    console.log('   3. 图片元素实时同步');
    console.log('   4. @通知推送');
    console.log('   5. 图片缩放同步');
    console.log('   6. 历史数据完整性');
  } else {
    console.log('❌ 部分测试失败');
    console.log(`  t1在线用户:${t1?'✅':'❌'} t2上传:${t2?'✅':'❌'} t3图片同步:${t3?'✅':'❌'}`);
    console.log(`  t4@通知:${t4?'✅':'❌'} t5缩放同步:${t5?'✅':'❌'} t6历史:${t6?'✅':'❌'}`);
    process.exit(1);
  }
}

test().catch(e => { console.error(e); process.exit(1); });
