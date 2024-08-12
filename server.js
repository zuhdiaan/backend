const express = require('express');
const mysql = require('mysql');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const port = 3000;
const multer  = require('multer');
const upload = multer({ dest: 'public/uploads/' });
const path = require('path');
const fs = require('fs').promises;
const moment = require('moment');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

app.use(bodyParser.json());
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL: ' + err.stack);
    return;
  }
  console.log('Connected to MySQL as id ' + connection.threadId);
});

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.post('/api/register', (req, res) => {
  const { name, email, username, password } = req.body;

  // Check if email format is valid using regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid Email Format' });
  }

  // Check if username or email already exists
  const checkSql = 'SELECT * FROM members WHERE email = ? OR username = ?';
  connection.query(checkSql, [email, username], (err, results) => {
    if (err) {
      console.error('Error checking existing user:', err);
      return res.status(500).json({ error: 'Failed to register' });
    }

    if (results.length > 0) {
      if (results[0].email === email) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      if (results[0].username === username) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    // Generate email verification token
    const token = crypto.randomBytes(20).toString('hex');

    // Insert the new user into the database
    const sql = 'INSERT INTO members (name, email, username, password, email_verification_token, email_verified) VALUES (?, ?, ?, ?, ?, false)';
    connection.query(sql, [name, email, username, password, token], (err, result) => {
      if (err) {
        console.error('Error registering:', err);
        return res.status(500).json({ error: 'Failed to register' });
      }

      const mailOptions = {
        to: email,
        from: process.env.EMAIL_USER,
        subject: 'Email Verification',
        text: `Thank you for registering. Please verify your email by clicking the link below:\n\n
          http://${req.headers.host}/api/verify-email/${token}\n\n
          If you did not request this, please ignore this email.\n`,
      };

      transporter.sendMail(mailOptions, (sendErr) => {
        if (sendErr) {
          console.error('Error sending email:', sendErr);
          return res.status(500).json({ error: 'Failed to send email' });
        }

        res.status(200).json({ message: 'Registration successful, verification email sent' });
      });
    });
  });
});

// User login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM members WHERE username = ? AND password = ?';
  connection.query(sql, [username, password], (err, results) => {
    if (err) {
      console.error('Error logging in:', err);
      res.status(500).json({ error: 'Failed to login' });
    } else {
      if (results.length > 0) {
        const user = results[0];
        res.json({ success: true, message: 'Login successful', userId: user.member_id, name: user.name, balance: user.balance });
      } else {
        res.status(401).json({ success: false, message: 'Invalid username or password' });
      }
    }
  });
});

// Fetch balance endpoint
app.get('/api/balance', (req, res) => {
  const userId = req.query.userId;
  const sql = 'SELECT balance FROM members WHERE member_id = ?';
  connection.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching balance:', err);
      res.status(500).json({ error: 'Failed to fetch balance' });
    } else {
      if (results.length > 0) {
        res.json({ balance: results[0].balance });
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    }
  });
});

app.post('/api/updateBalance', async (req, res) => {
  const { memberId, newBalance } = req.body;

  try {
    const sql = 'UPDATE members SET balance = ? WHERE member_id = ?';
    await new Promise((resolve, reject) => {
      connection.query(sql, [newBalance, memberId], (err, result) => {
        if (err) {
          console.error('Error updating balance:', err);
          reject(err);
        } else {
          res.json({ message: 'Balance updated successfully' });
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Error updating balance:', error);
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

app.post('/api/forgot-password', (req, res) => {
  const { email, username } = req.body;

  // Cari user berdasarkan email dan username
  const sql = 'SELECT * FROM members WHERE email = ? AND username = ?';
  connection.query(sql, [email, username], (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      return res.status(500).json({ error: 'Failed to fetch user' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = results[0];
    const token = crypto.randomBytes(20).toString('hex');
    const tokenExpiration = Date.now() + 3600000; // 1 jam dari sekarang

    // Update user dengan token reset password
    const updateSql = 'UPDATE members SET reset_password_token = ?, reset_password_expires = ? WHERE email = ? AND username = ?';
    connection.query(updateSql, [token, tokenExpiration, email, username], (updateErr) => {
      if (updateErr) {
        console.error('Error setting reset token:', updateErr);
        return res.status(500).json({ error: 'Failed to set reset token' });
      }

      // Kirim email dengan token reset password
      const mailOptions = {
        to: user.email,
        from: process.env.EMAIL_USER,
        subject: 'Password Reset',
        text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n
          Please click on the following link, or paste this into your browser to complete the process:\n\n
          http://${req.headers.host}/reset-password/${token}\n\n
          If you did not request this, please ignore this email and your password will remain unchanged.\n`,
      };

      transporter.sendMail(mailOptions, (sendErr) => {
        if (sendErr) {
          console.error('Error sending email:', sendErr);
          return res.status(500).json({ error: 'Failed to send email' });
        }

        res.status(200).json({ message: 'Password reset email sent successfully' });
      });
    });
  });
});

app.get('/reset-password/:token', (req, res) => {
  const { token } = req.params;

  const sql = 'SELECT * FROM members WHERE reset_password_token = ? AND reset_password_expires > ?';
  connection.query(sql, [token, Date.now()], (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      return res.status(500).json({ error: 'Failed to fetch user' });
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired' });
    }

    // Redirect ke halaman frontend reset password dengan token
    res.redirect(`http://10.0.2.2:3000/reset-password?token=${token}`);
  });
});

app.post('/api/reset-password/:token', (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  // Cari user berdasarkan token reset password
  const sql = 'SELECT * FROM members WHERE reset_password_token = ? AND reset_password_expires > ?';
  connection.query(sql, [token, Date.now()], (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      return res.status(500).json({ error: 'Failed to fetch user' });
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired' });
    }

    const user = results[0];
    const updateSql = 'UPDATE members SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE email = ?';
    connection.query(updateSql, [password, user.email], (updateErr) => {
      if (updateErr) {
        console.error('Error resetting password:', updateErr);
        return res.status(500).json({ error: 'Failed to reset password' });
      }

      res.status(200).json({ message: 'Password has been reset successfully' });
    });
  });
});

app.get('/api/verify-email/:token', (req, res) => {
  const { token } = req.params;

  const sql = 'SELECT * FROM members WHERE email_verification_token = ?';
  connection.query(sql, [token], (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      return res.status(500).json({ error: 'Failed to fetch user' });
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    const user = results[0];
    const updateSql = 'UPDATE members SET email_verified = true, email_verification_token = NULL WHERE email = ?';
    connection.query(updateSql, [user.email], (updateErr) => {
      if (updateErr) {
        console.error('Error verifying email:', updateErr);
        return res.status(500).json({ error: 'Failed to verify email' });
      }

      res.status(200).json({ message: 'Email verified successfully' });
    });
  });
});

app.put('/api/menu_items/:item_id/availability', (req, res) => {
  const itemId = req.params.item_id;
  const { is_active } = req.body;

  const sql = 'UPDATE menu_items SET is_active = ? WHERE item_id = ?';
  connection.query(sql, [is_active, itemId], (err, result) => {
    if (err) {
      console.error('Error updating item availability:', err);
      res.status(500).json({ error: 'Failed to update item availability' });
    } else {
      res.json({ message: 'Item availability updated successfully' });
    }
  });
});

app.post('/api/order_details', (req, res) => {
  const { items } = req.body;  // Ensure we're only receiving items in the request body

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items are required' });
  }

  // Prepare order details values
  const orderDetailsValues = items.map(item => [
    item.item_id,
    item.item_amount,
    item.total_price
  ]);

  const orderDetailsSql = 'INSERT INTO order_details (item_id, item_amount, total_price) VALUES ?';

  // Log the query for debugging
  console.log(connection.format(orderDetailsSql, [orderDetailsValues]));

  connection.query(orderDetailsSql, [orderDetailsValues], (err, result) => {
    if (err) {
      console.error('Error inserting order details:', err);
      return res.status(500).json({ error: 'Failed to insert order details' });
    }

    res.json({ message: 'Order details inserted successfully' });
  });
});

app.post('/api/place_order', async (req, res) => {
  const { orderDate, orderedItems, memberId, tableId, paymentId } = req.body;

  if (!orderedItems || orderedItems.length === 0) {
    return res.status(400).json({ error: 'No items in the order' });
  }

  try {
    const formattedOrderDate = moment(orderDate).format('YYYY-MM-DD HH:mm:ss');

    connection.beginTransaction(async (err) => {
      if (err) {
        throw err;
      }

      try {
        // Insert ke tabel order
        const orderSql = 'INSERT INTO `order` (order_status_id, payment_status_id, table_id, order_date, payment_id, member_id) VALUES (?, ?, ?, ?, ?, ?)';
        const orderResult = await new Promise((resolve, reject) => {
          connection.query(orderSql, [0, 0, tableId, formattedOrderDate, paymentId, memberId], (err, result) => {
            if (err) {
              return reject(err);
            }
            resolve(result);
          });
        });

        const orderId = orderResult.insertId;

        const orderDetailsValues = orderedItems.map(item => [
          orderId,
          item.item_id,
          item.item_amount,
          item.total_price
        ]);

        const orderDetailsSql = 'INSERT INTO order_details (order_id, item_id, item_amount, total_price) VALUES ?';

        await new Promise((resolve, reject) => {
          connection.query(orderDetailsSql, [orderDetailsValues], (err, result) => {
            if (err) {
              return reject(err);
            }
            resolve(result);
          });
        });

        connection.commit((err) => {
          if (err) {
            return connection.rollback(() => {
              throw err;
            });
          }
          res.status(200).json({ message: 'Order placed successfully', orderId });
        });
      } catch (error) {
        connection.rollback(() => {
          console.error('Error placing order:', error);
          res.status(500).json({ error: 'Failed to place order' });
        });
      }
    });
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

app.post('/api/order', async (req, res) => {
  const { orderDate, orderedItems, memberId, tableId, paymentId } = req.body;

  if (!orderedItems || orderedItems.length === 0) {
    return res.status(400).json({ error: 'No items in the order' });
  }

  try {
    const formattedOrderDate = moment(orderDate).format('YYYY-MM-DD HH:mm:ss');

    connection.beginTransaction(async (err) => {
      if (err) {
        throw err;
      }

      try {
        // Insert into `order` table
        const orderSql = 'INSERT INTO `order` (order_status_id, payment_status_id, table_id, order_date, payment_id, member_id) VALUES (?, ?, ?, ?, ?, ?)';
        const orderResult = await new Promise((resolve, reject) => {
          connection.query(orderSql, [0, 0, tableId, formattedOrderDate, paymentId, memberId], (err, result) => {
            if (err) {
              return reject(err);
            }
            resolve(result);
          });
        });

        const orderId = orderResult.insertId;

        // Insert into `order_details` table
        const orderDetailsValues = orderedItems.map(item => [
          orderId,
          item.item_id,
          item.item_amount,
          item.total_price
        ]);

        const orderDetailsSql = 'INSERT INTO order_details (order_id, item_id, item_amount, total_price) VALUES ?';

        await new Promise((resolve, reject) => {
          connection.query(orderDetailsSql, [orderDetailsValues], (err, result) => {
            if (err) {
              return reject(err);
            }
            resolve(result);
          });
        });

        // Commit the transaction
        connection.commit((err) => {
          if (err) {
            return connection.rollback(() => {
              throw err;
            });
          }
          res.status(200).json({ message: 'Order placed successfully', orderId });
        });
      } catch (error) {
        connection.rollback(() => {
          console.error('Error placing order:', error);
          res.status(500).json({ error: 'Failed to place order' });
        });
      }
    });
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

app.post('/api/cancelOrder', (req, res) => {
  const { orderId } = req.body;

  // Langkah 1: Ubah status pesanan menjadi 'canceled'
  const updateOrderStatusSql = "UPDATE `order` SET order_status_id = 2 WHERE order_id = ?";

  connection.beginTransaction((err) => {
    if (err) {
      console.error('Error starting transaction:', err);
      return res.status(500).json({ error: 'Failed to start transaction' });
    }

    connection.query(updateOrderStatusSql, [orderId], (err, results) => {
      if (err) {
        console.error('Error updating order status:', err);
        return connection.rollback(() => {
          res.status(500).json({ error: 'Failed to update order status' });
        });
      }

      // Langkah 2: Ambil total harga order dan member_id dari order_details dan order
      const getOrderDetailsSql = `
        SELECT SUM(od.total_price) AS total_refund, o.member_id 
        FROM order_details od 
        JOIN \`order\` o ON od.order_id = o.order_id 
        WHERE od.order_id = ?
        GROUP BY o.member_id`;

      connection.query(getOrderDetailsSql, [orderId], (err, orderDetails) => {
        if (err) {
          console.error('Error fetching order details:', err);
          return connection.rollback(() => {
            res.status(500).json({ error: 'Failed to fetch order details' });
          });
        }

        if (orderDetails.length === 0) {
          return connection.rollback(() => {
            res.status(404).json({ error: 'Order not found' });
          });
        }

        const totalRefund = orderDetails[0].total_refund;
        const memberId = orderDetails[0].member_id;

        // Langkah 3: Update saldo anggota
        const updateMemberBalanceSql = `
          UPDATE members 
          SET balance = balance + ? 
          WHERE member_id = ?`;

        connection.query(updateMemberBalanceSql, [totalRefund, memberId], (err, results) => {
          if (err) {
            console.error('Error updating member balance:', err);
            return connection.rollback(() => {
              res.status(500).json({ error: 'Failed to update member balance' });
            });
          }

          // Langkah 4: Commit transaction
          connection.commit((err) => {
            if (err) {
              console.error('Error committing transaction:', err);
              return connection.rollback(() => {
                res.status(500).json({ error: 'Failed to commit transaction' });
              });
            }

            res.json({ message: 'Order canceled and refunded successfully' });
          });
        });
      });
    });
  });
});

app.post('/api/complete_order', async (req, res) => {
  const { orderId, orderDate, memberId } = req.body;

  try {
    const orderSql = 'INSERT INTO `order` (order_id, order_date, member_id) VALUES (?, ?, ?)';

    connection.query(orderSql, [orderId, orderDate, memberId], (err, result) => {
      if (err) {
        console.error('Error completing order:', err);
        return res.status(500).json({ error: 'Failed to complete order' });
      } else {
        console.log('Order completed successfully');
        res.status(200).json({ message: 'Order completed successfully', orderId: orderId });
      }
    });
  } catch (error) {
    console.error('Error completing order:', error);
    res.status(500).json({ error: 'Failed to complete order' });
  }
});

app.get('/api/order', (req, res) => {
  const orderId = req.query.orderId; 
  const status = req.query.status; // Pastikan status didefinisikan jika akan digunakan

  let sql = `
    SELECT
      o.order_id,
      CONVERT_TZ(o.order_date, '+00:00', '+07:00') AS order_time,
      GROUP_CONCAT(CONCAT(od.item_id, ':', mi.item_name, ':', od.item_amount, ':', od.total_price)) AS items,
      SUM(od.total_price) AS total_price,
      m.name AS user_name,
      ps.payment_status,
      t.table_name AS table_number,
      p.payment_description AS payment_method
    FROM
      \`order\` o
    JOIN
      order_details od ON o.order_id = od.order_id
    JOIN
      menu_items mi ON od.item_id = mi.item_id
    JOIN
      members m ON o.member_id = m.member_id
    JOIN
      payment_status ps ON o.payment_status_id = ps.payment_status_id
    JOIN
      \`table\` t ON o.table_id = t.table_id
    JOIN
      payment p ON o.payment_id = p.payment_id
  `;

  // Hanya tambahkan filter berdasarkan status jika status didefinisikan
  if (orderId) {
    sql += `WHERE o.order_id = ?`;
  } else if (status === 'pending') {
    sql += "WHERE o.order_status_id = (SELECT order_status_id FROM order_status WHERE order_status = 'pending')";
  } else if (status === 'completed') {
    sql += "WHERE o.order_status_id = (SELECT order_status_id FROM order_status WHERE order_status = 'completed')";
  }

  sql += "GROUP BY o.order_id, o.order_date, m.name, ps.payment_status, t.table_name, p.payment_description";

  connection.query(sql, [orderId], (err, results) => {
    if (err) {
      console.error('Error fetching orders from database:', err);
      res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
    } else {
      if (results.length === 0) {
        res.status(404).json({ error: 'Order not found' });
      } else {
        res.json(results[0]); 
      }
    }
  });
});

app.get('/api/menu_items', (req, res) => {
  const sql = 'SELECT item_id, item_name, price, image_source, category_id, is_active FROM menu_items';
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching menu items:', err);
      res.status(500).json({ error: 'Failed to fetch menu items' });
    } else {
      res.json(results);
    }
  });
});

app.post('/api/menu_items', upload.single('avatar'), async (req, res) => {
  try {
    const { item_name, price, category_id } = req.body;
    const uploadedFile = req.file;

    const sanitizedFilename = item_name.toLowerCase().replace(/\s+/g, '-');
    const originalExtension = path.extname(uploadedFile.originalname);

    const targetDirectory = path.join(__dirname, 'public', 'uploads');
    await fs.mkdir(targetDirectory, { recursive: true });

    const targetPath = path.join(targetDirectory, sanitizedFilename + originalExtension);
    await fs.rename(uploadedFile.path, targetPath);

    console.log('File moved successfully');

    const sql = 'INSERT INTO menu_items (item_name, price, image_source, category_id) VALUES (?, ?, ?, ?)';
    connection.query(sql, [item_name, price, sanitizedFilename + originalExtension, category_id], (err, result) => {
      if (err) {
        console.error('Error inserting into database:', err);
        res.status(500).json({ error: 'Failed to add menu item' });
      } else {
        res.json({ id: result.insertId });
      }
    });
  } catch (err) {
    console.error('Error handling request:', err);
    res.status(500).json({ error: 'Failed to process the request' });
  }
});

app.get('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const fileUrl = `${baseUrl}/uploads/${filename}`;
  res.json({ url: fileUrl });
});

app.get('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  const sql = 'SELECT name, balance FROM members WHERE member_id = ?';
  connection.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      res.status(500).json({ error: 'Failed to fetch user' });
    } else {
      if (results.length > 0) {
        res.json({ name: results[0].name, balance: results[0].balance });
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    }
  });
});

app.post('/api/topup', (req, res) => {
  const { member_id, amount } = req.body;

  if (!member_id || !amount) {
    return res.status(400).json({ error: 'Member ID and amount are required' });
  }

  const sqlSelect = 'SELECT * FROM members WHERE member_id = ?';
  connection.query(sqlSelect, [member_id], (err, results) => {
    if (err) {
      console.error('Error fetching user data:', err);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = results[0];
    const newBalance = parseFloat(user.balance) + parseFloat(amount);

    const sqlUpdate = 'UPDATE members SET balance = ? WHERE member_id = ?';
    connection.query(sqlUpdate, [newBalance, member_id], (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error updating balance:', updateErr);
        return res.status(500).json({ error: 'Failed to update balance' });
      }

      const sqlInsertTopUp = 'INSERT INTO top_up (topup_amount, member_id) VALUES (?, ?)';
      connection.query(sqlInsertTopUp, [amount, member_id], (insertErr, insertResult) => {
        if (insertErr) {
          console.error('Error inserting top-up record:', insertErr);
          return res.status(500).json({ error: 'Failed to record top-up' });
        }

        return res.json({ success: true, message: 'Balance updated successfully', balance: newBalance });
      });
    });
  });
});

app.post('/api/updateOrderStatus', (req, res) => {
  const { orderId, status } = req.body;
  
  // Convert status to order_status_id
  let status_id = status === 'completed' ? 1 : 0;

  const sql = "UPDATE `order` SET order_status_id = ? WHERE order_id = ?";
  connection.query(sql, [status_id, orderId], (err, results) => {
    if (err) {
      console.error('Error updating order status:', err);
      res.status(500).json({ error: 'Failed to update order status' });
    } else {
      res.json({ message: 'Order status updated successfully' });
    }
  });
});

app.get('/api/categories/:id', (req, res) => {
  const categoryId = req.params.id;
  const sql = 'SELECT * FROM categories WHERE category_id = ?';
  connection.query(sql, [categoryId], (err, results) => {
    if (err) {
      res.status(500).json({ error: 'Failed to fetch category' });
    } else {
      if (results.length > 0) {
        res.json(results[0]);
      } else {
        res.status(404).json({ error: 'Category not found' });
      }
    }
  });
});

app.get('/api/categories', (req, res) => {
  const sql = 'SELECT * FROM categories';
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching categories from database:', err);
      res.status(500).json({ error: 'Failed to fetch categories' });
    } else {
      res.json(results);
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});