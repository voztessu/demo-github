// server.js
// Set-ExecutionPolicy -Scope CurrentUser Unrestricted
const express = require("express");
const app = express();
const http = require("http");
const mysql = require("mysql2");
const { Server } = require("socket.io");

// Khởi tạo HTTP server và Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  reconnection: true,
  transport: ["websocket", "polling"],
  reconnectionAttempts: 5,
});

// Serve static files from the 'public' directory
app.use(express.static("public"));
app.use(express.json());

// ====START CONN DB====
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "chat_app",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
// ====END CONN DB====

// Cấu hình route để phục vụ các tệp HTML trực tiếp
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

// app.get('/messages', (req, res) => {
//     const senderName = req.query.name;
//     const role = req.query.role;

//     // Câu truy vấn cơ bản
//     let query = `
//         SELECT m.id, m.sender_name, m.message, m.reply_to_id, r.sender_name AS reply_to_username, r.message AS reply_to_content, r.date_send AS reply_to_date_send, m.date_send FROM messages m LEFT JOIN messages r ON m.reply_to_id = r.id
//     `;
//     // Nếu role là "nv", thêm điều kiện lọc tin nhắn
//     if (role === 'nv') {
//         query += `WHERE (m.sender_name = ?
//        OR m.sender_name IN (SELECT username FROM users WHERE role = 'kh')) AND (r.sender_name = ? OR r.sender_name IS NULL)`;
//     }
//     query+= `LIMIT 5`
//     // Thực thi truy vấn
//     pool.query(query, [senderName,senderName], (err, results) => {
//         if (err) {
//             console.error('Error fetching messages:', err);
//             return res.status(500).json({ error: 'Unable to fetch messages' });
//         }
//         res.json(results);
//     });
// });
app.get("/messages", (req, res) => {
  const senderName = req.query.name;
  const role = req.query.role;
  const lastMessageId = req.query.lastMessageId; // Lấy lastMessageId từ query params

  // Câu truy vấn cơ bản
  let query = `
        SELECT m.id, m.sender_name, m.message, m.reply_to_id, r.sender_name AS reply_to_username, r.message AS reply_to_content, r.date_send AS reply_to_date_send, m.date_send
        FROM messages m
        LEFT JOIN messages r ON m.reply_to_id = r.id
    `;

  // Điều kiện lọc cho role 'nv'
  if (role === "nv") {
    query += ` WHERE (m.sender_name = '${senderName}' 
           OR m.sender_name IN (SELECT username FROM users WHERE role = 'kh')) 
           AND (r.sender_name = '${senderName}' OR r.sender_name IS NULL)`;
  }

  // Điều kiện lọc cho lastMessageId
  if (lastMessageId) {
    if (role === "nv") {
      query += ` AND m.id < ${lastMessageId}`;
    } else if (role === "kh") {
      query += `WHERE m.id < ${lastMessageId}`;
    }
  }

  query += ` ORDER BY m.id DESC LIMIT 6`;

  // Thực thi truy vấn
  pool.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching messages:", err);
      return res.status(500).json({ error: "Unable to fetch messages" });
    }
    res.json(results);
  });
});

// Route tìm kiếm tin nhắn

app.get("/search", (req, res) => {
  const key = req.query.key;
  const senderName = req.query.name;
  const role = req.query.role;
  // Câu truy vấn cơ bản
  let query = `
        SELECT m.id, m.sender_name, m.message, m.reply_to_id, r.sender_name AS reply_to_username, r.message AS reply_to_content, r.date_send AS reply_to_date_send, m.date_send
        FROM messages m
        LEFT JOIN messages r ON m.reply_to_id = r.id
        WHERE m.message LIKE '%${key}%'
    `;

  // Điều kiện lọc cho role 'nv'
  if (role === "nv") {
    query += ` AND (m.sender_name = '${senderName}' 
           OR m.sender_name IN (SELECT username FROM users WHERE role = 'kh')) 
           AND (r.sender_name = '${senderName}' OR r.sender_name IS NULL)`;
  }
  query += ` ORDER BY m.id DESC LIMIT 6`;
  // Thực thi truy vấn
  pool.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching messages:", err);
      return res.status(500).json({ error: "Unable to fetch messages" });
    }
    res.json(results);
  });
});

// Route đếm tin nhắn chưa đọc
app.get("/unread-count", (req, res) => {
  const senderName = req.query.username;
  const role = req.query.role;
  const where = role == "kh" ? "" : `sender_name = ? AND`;
  const countQuery = `
        SELECT COUNT(*) AS unread_count
        FROM messages
        WHERE ${where} is_replied = 0 AND reply_to_id IS NULL
    `;
  pool.query(countQuery, [senderName], (err, results) => {
    if (err) {
      console.error("Error counting unread messages:", err);
      return res.status(500).json({ error: "Unable to count unread messages" });
    }
    const unreadCount = results[0] ? results[0].unread_count : 0;
    res.json({ unread_count: unreadCount });
  });
});

// Route xử lý đăng nhập
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const query = "SELECT * FROM users WHERE username = ? AND password = ?";
  pool.query(query, [username, password], (err, results) => {
    if (err) {
      console.error("Error querying the database:", err);
      return res.json({ success: false });
    }
    if (results.length > 0) {
      return res.json({
        success: true,
        username: results[0].username,
        role: results[0].role,
      });
    } else {
      return res.json({ success: false });
    }
  });
});

io.on("connection", (socket) => {
  socket.on("self-chat", (data) => {
    const insertQuery =
      "INSERT INTO messages (sender_name, message, reply_to_id) VALUES (?, ?, ?)";
    pool.query(
      insertQuery,
      [data.sender_name, data.message, data.reply_to_id],
      (err, results) => {
        if (err) {
          console.error("Error inserting message into database:", err);
          socket.emit("db_error", { error: "Unable to save message" });
          return;
        }
        data.id = results.insertId;

        if (data.reply_to_id) {
          const updateQuery = "UPDATE messages SET is_replied = 1 WHERE id = ?";
          pool.query(updateQuery, [data.reply_to_id], (updateErr) => {
            if (updateErr) {
              console.error("Error updating original message:", updateErr);
              socket.emit("db_error", {
                error: "Unable to update original message",
              });
              return;
            }
            io.emit("other-chat", data);
          });
        } else {
          io.emit("other-chat", data);
        }
      }
    );
  });
  socket.on("update-chat", (data) => {
    const updateQuery = "UPDATE messages SET message = ? WHERE id = ?";
    pool.query(updateQuery, [data.messageEdited, data.id], (err, results) => {
      if (err) {
        console.error("Error update message into database:", err);
        socket.emit("db_error", { error: "Unable to save message" });
        return;
      } else {
        io.emit("chat-updated", data);
      }
    });
  });
});

// Khởi chạy server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
