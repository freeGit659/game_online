const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Phục vụ tệp tĩnh
app.use(express.static(path.join(__dirname, 'public')));

// Chuyển hướng đến trang index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cấu hình game
const CONFIG = {
  playerRadius: 20,
  bulletRadius: 5,
  playerSpeed: 5,
  bulletSpeed: 10,
  fireRate: 1000, // 1 giây giữa các lần bắn
  mapWidth: 800,
  mapHeight: 600,
  respawnTime: 10000 // 10 giây
};

// Lưu trữ dữ liệu trò chơi
const players = {};
const bullets = [];
let lastBulletId = 0;

// Xử lý kết nối socket
io.on('connection', (socket) => {
  console.log('Người chơi đã kết nối:', socket.id);
  
  // Người chơi tham gia trò chơi
  socket.on('player-join', (playerName) => {
    // Tạo vị trí ngẫu nhiên cho người chơi
    const x = Math.random() * (CONFIG.mapWidth - 100) + 50;
    const y = Math.random() * (CONFIG.mapHeight - 100) + 50;
    
    // Lưu thông tin người chơi
    players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: x,
      y: y,
      direction: 0,
      radius: CONFIG.playerRadius,
      kills: 0,
      lastFireTime: 0
    };
    
    // Gửi trạng thái game cho người chơi mới
    socket.emit('game-state', {
      playerId: socket.id,
      players: players,
      bullets: bullets
    });
    
    // Thông báo cho tất cả người chơi về người chơi mới
    io.emit('update-players', players);
  });
  
  // Người chơi di chuyển
  socket.on('player-move', (direction) => {
    const player = players[socket.id];
    if (!player) return;
    
    // Cập nhật vị trí
    let newX = player.x + direction.dirX * CONFIG.playerSpeed;
    let newY = player.y + direction.dirY * CONFIG.playerSpeed;
    
    // Giới hạn trong phạm vi bản đồ
    newX = Math.max(player.radius, Math.min(CONFIG.mapWidth - player.radius, newX));
    newY = Math.max(player.radius, Math.min(CONFIG.mapHeight - player.radius, newY));
    
    // Cập nhật vị trí người chơi
    player.x = newX;
    player.y = newY;
    
    // Gửi cập nhật cho tất cả người chơi
    io.emit('update-players', players);
  });
  
  // Người chơi xoay
  socket.on('player-rotate', (direction) => {
    const player = players[socket.id];
    if (!player) return;
    
    player.direction = direction;
    
    // Gửi cập nhật cho tất cả người chơi
    io.emit('update-players', players);
  });
  
  // Người chơi bắn
  socket.on('player-shoot', () => {
    const player = players[socket.id];
    if (!player) return;
    
    const currentTime = Date.now();
    
    // Kiểm tra tốc độ bắn
    if (currentTime - player.lastFireTime < CONFIG.fireRate) return;
    
    // Cập nhật thời gian bắn cuối
    player.lastFireTime = currentTime;
    
    // Tạo viên đạn mới
    const bullet = {
      id: ++lastBulletId,
      playerId: socket.id,
      x: player.x + Math.cos(player.direction) * (player.radius + 10),
      y: player.y + Math.sin(player.direction) * (player.radius + 10),
      direction: player.direction,
      radius: CONFIG.bulletRadius,
      speed: CONFIG.bulletSpeed
    };
    
    bullets.push(bullet);
    
    // Gửi cập nhật đạn cho tất cả người chơi
    io.emit('update-bullets', bullets);
  });
  
  // Người chơi hồi sinh
  socket.on('player-respawn', () => {
    const player = players[socket.id];
    if (!player) return;
    
    // Tạo vị trí ngẫu nhiên cho người chơi
    const x = Math.random() * (CONFIG.mapWidth - 100) + 50;
    const y = Math.random() * (CONFIG.mapHeight - 100) + 50;
    
    // Cập nhật vị trí người chơi
    player.x = x;
    player.y = y;
    
    // Gửi cập nhật cho tất cả người chơi
    io.emit('update-players', players);
  });
  
  // Người chơi ngắt kết nối
  socket.on('disconnect', () => {
    console.log('Người chơi đã ngắt kết nối:', socket.id);
    
    // Xóa người chơi khỏi danh sách
    delete players[socket.id];
    
    // Gửi cập nhật cho tất cả người chơi
    io.emit('update-players', players);
  });
});

// Cập nhật trạng thái game
function updateGame() {
  // Di chuyển các viên đạn
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    
    // Cập nhật vị trí đạn
    bullet.x += Math.cos(bullet.direction) * bullet.speed;
    bullet.y += Math.sin(bullet.direction) * bullet.speed;
    
    // Kiểm tra đạn ra khỏi bản đồ
    if (
      bullet.x < 0 || 
      bullet.x > CONFIG.mapWidth || 
      bullet.y < 0 || 
      bullet.y > CONFIG.mapHeight
    ) {
      bullets.splice(i, 1);
      continue;
    }
    
    // Kiểm tra va chạm với người chơi
    for (const playerId in players) {
      const player = players[playerId];
      
      // Bỏ qua đạn của chính người chơi
      if (bullet.playerId === playerId) continue;
      
      // Tính khoảng cách giữa đạn và người chơi
      const dx = bullet.x - player.x;
      const dy = bullet.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Nếu có va chạm
      if (distance < bullet.radius + player.radius) {
        // Tăng điểm cho người bắn
        if (players[bullet.playerId]) {
          players[bullet.playerId].kills++;
        }
        
        // Thông báo người chơi bị tiêu diệt
        io.emit('player-died', {
          playerId: playerId,
          killerId: bullet.playerId
        });
        
        // Xóa đạn
        bullets.splice(i, 1);
        break;
      }
    }
  }
  
  // Gửi cập nhật đạn cho tất cả người chơi
  io.emit('update-bullets', bullets);
}

// Cập nhật game 60 lần mỗi giây
setInterval(updateGame, 1000 / 60);

// Bắt đầu server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy trên cổng ${PORT}`);
});