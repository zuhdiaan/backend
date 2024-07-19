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

app.post('/api/order', async (req, res) => {
  const { orderId, orderDate, orderedItems, memberId, tableId, paymentId, orderStatusId, paymentStatusId } = req.body;

  try {
    // Format orderDate to the correct format
    const formattedOrderDate = moment(orderDate).format('YYYY-MM-DD HH:mm:ss');

    // Begin transaction
    connection.beginTransaction(async (err) => {
      if (err) {
        throw err;
      }

      try {
        // Insert order into the database
        const orderSql = 'INSERT INTO order (order_id, order_date, table_id, payment_id, member_id, order_status_id, payment_status_id) VALUES (?, ?, ?, ?, ?, ?, ?)';
        await new Promise((resolve, reject) => {
          connection.query(orderSql, [orderId, formattedOrderDate, tableId, paymentId, memberId, orderStatusId, paymentStatusId], (err, result) => {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          });
        });

        // Insert order details into the database
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
              reject(err);
            } else {
              resolve(result);
            }
          });
        });

        // Commit transaction
        connection.commit((err) => {
          if (err) {
            throw err;
          } else {
            console.log('Order placed successfully');
            res.json({ message: 'Order placed successfully', orderId: orderId });
          }
        });
      } catch (error) {
        // Rollback transaction in case of error
        connection.rollback(() => {
          console.error('Error inserting order:', error);
          res.status(500).json({ error: 'Failed to place order' });
        });
      }
    });
  } catch (error) {
    console.error('Error generating orderId:', error);
    res.status(500).json({ error: 'Failed to generate orderId' });
  }
});

app.post('/api/addOrderDetails', async (req, res) => {
  const { orderId, orderedItems } = req.body;

  if (!orderId || !Array.isArray(orderedItems) || orderedItems.length === 0) {
    return res.status(400).json({ error: 'orderId and orderedItems are required' });
  }

  try {
    // Menyimpan data order details
    const orderDetailsValues = orderedItems.map(item => [
      orderId,
      item.item_id,
      item.item_amount,
      item.total_price
    ]);

    const sql = 'INSERT INTO order_details (order_id, item_id, item_amount, total_price) VALUES ?';

    await new Promise((resolve, reject) => {
      connection.query(sql, [orderDetailsValues], (err, result) => {
        if (err) {
          console.error('Error inserting order details:', err);
          reject(err);
        } else {
          res.json({ message: 'Order details added successfully' });
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Error adding order details:', error);
    res.status(500).json({ error: 'Failed to add order details' });
  }
});

app.get('/api/order', (req, res) => {
  const status = req.query.status;
  let sql = `
      SELECT
          o.order_id,
          CONVERT_TZ(o.order_date, '+00:00', '+07:00') AS order_time,
          GROUP_CONCAT(CONCAT(od.item_id, ':', mi.item_name, ':', od.item_amount, ':', od.total_price)) AS items,
          SUM(od.total_price) AS total_price,
          m.name AS user_name
      FROM
          \`order\` o
      JOIN
          order_details od ON o.order_id = od.order_id
      JOIN
          menu_items mi ON od.item_id = mi.item_id
      JOIN
          members m ON o.member_id = m.member_id
      `;
  if (status === 'pending') {
    sql += "WHERE o.order_status_id = (SELECT order_status_id FROM order_status WHERE order_status = 'pending')";
  } else if (status === 'completed') {
    sql += "WHERE o.order_status_id = (SELECT order_status_id FROM order_status WHERE order_status = 'completed')";
  }
  sql += "GROUP BY o.order_id, o.order_date, m.name";
  connection.query(sql, (err, results) => {
      if (err) {
          console.error('Error fetching orders from database:', err);
          res.status(500).json({ error: 'Failed to fetch orders' });
      } else {
          res.json(results);
      }
  });
});

app.get('/api/menu_items', (req, res) => {
  const sql = 'SELECT item_id, item_name, price, image_source, category_id FROM menu_items';
  connection.query(sql, (err, results) => {
    if (err) {
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

    // Sanitize the filename
    const sanitizedFilename = item_name.toLowerCase().replace(/\s+/g, '-');
    const originalExtension = path.extname(uploadedFile.originalname);

    // Create the target directory if it doesn't exist
    const targetDirectory = path.join(__dirname, 'public', 'uploads');
    await fs.mkdir(targetDirectory, { recursive: true });

    // Move the file to the target directory with the sanitized filename and original extension
    const targetPath = path.join(targetDirectory, sanitizedFilename + originalExtension);
    await fs.rename(uploadedFile.path, targetPath);

    console.log('File moved successfully');

    // Insert menu item into the database
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

app.post('/api/register', (req, res) => {
  const { name, email, username, password } = req.body;
  const sql = 'INSERT INTO members (name, email, username, password) VALUES (?, ?, ?, ?)';
  connection.query(sql, [name, email, username, password], (err, result) => {
    if (err) {
      console.error('Error registering:', err);
      res.status(500).json({ error: 'Failed to register' });
    } else {
      res.json({ success: true, message: 'Registration successful' });
    }
  });
});

// app.post('/api/forgotpassword', (req, res) => {
//   const { email } = req.body;
//   const sql = 'SELECT * FROM users WHERE email = ?';
//   connection.query(sql, [email], (err, results) => {
//     if (err) {
//       console.error('Error retrieving user data:', err);
//       res.status(500).json({ error: 'Failed to retrieve user data' });
//     } else {
//       if (results.length > 0) {
//         // Implement logic to send password reset link or code to the user's email
//         res.json({ success: true, message: 'Password reset instructions sent to your email' });
//       } else {
//         res.status(404).json({ success: false, message: 'Email not found' });
//       }
//     }
//   });
// });

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

app.post('/api/topup', (req, res) => {
  const { member_id, amount } = req.body;

  // Validasi input
  if (!member_id || !amount) {
    return res.status(400).json({ error: 'Member ID and amount are required' });
  }

  // Ambil saldo user dari database
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

    // Update saldo user di database
    const sqlUpdate = 'UPDATE members SET balance = ? WHERE member_id = ?';
    connection.query(sqlUpdate, [newBalance, member_id], (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error updating balance:', updateErr);
        return res.status(500).json({ error: 'Failed to update balance' });
      }

      // Simpan data top-up ke tabel top_up
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

app.post('/api/updateOrderStatus', async (req, res) => {
  const { orderId, status } = req.body;
  console.log(`Received request to update order status. orderId: ${orderId}, status: ${status}`);

  try {
    const sql = 'UPDATE `order` SET order_status_id = (SELECT order_status_id FROM order_status WHERE order_status = ?) WHERE order_id = ?';
    const result = await new Promise((resolve, reject) => {
      connection.query(sql, [status, orderId], (err, result) => {
        if (err) {
          console.error('Error updating order status:', err);
          reject(err);
        } else {
          console.log(`Order status updated successfully. Affected rows: ${result.affectedRows}`);
          resolve(result);
        }
      });
    });

    if (result.affectedRows > 0) {
      res.json({ message: 'Order status updated successfully' });
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
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
  const sql = 'SELECT * FROM categories'; // Pastikan nama tabel dan kolom sesuai dengan skema database
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
