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
  const { userId, newBalance } = req.body;

  try {
    const sql = 'UPDATE users SET balance = ? WHERE id = ?';
    await new Promise((resolve, reject) => {
      connection.query(sql, [newBalance, userId], (err, result) => {
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
  const { orderTime, orderedItems, userId, name } = req.body;

  try {
    // Generate orderId
    const currentDate = moment(orderTime).format('DDMMYY');
    const maxOrderIdSql = 'SELECT MAX(order_id) AS maxOrderId FROM orders WHERE DATE(order_time) = CURDATE()';
    const maxOrderIdResult = await new Promise((resolve, reject) => {
      connection.query(maxOrderIdSql, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    let orderIdSuffix = 1;
    if (maxOrderIdResult[0].maxOrderId) {
      const maxOrderIdParts = maxOrderIdResult[0].maxOrderId.split('-');
      orderIdSuffix = parseInt(maxOrderIdParts[1]) + 1;
    }

    const orderId = `OR${currentDate}-${orderIdSuffix}`;

    // Format orderTime to the correct format
    const formattedOrderTime = moment(orderTime).format('YYYY-MM-DD HH:mm:ss');

    // Begin transaction
    connection.beginTransaction(async (err) => {
      if (err) {
        throw err;
      }

      try {
        // Insert order items into the database
        const values = orderedItems.map(item => [
          orderId,
          formattedOrderTime,
          item.item_id,
          item.item_name,
          item.quantity,
          item.item_price,
          item.total_price,
          userId,
          name // Include the user's name
        ]);

        const sql = 'INSERT INTO orders (order_id, order_time, item_id, item_name, quantity, item_price, total_price, user_id, user_name) VALUES ?';

        await new Promise((resolve, reject) => {
          connection.query(sql, [values], (err, result) => {
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

app.get('/api/order', (req, res) => {
  const status = req.query.status;
  let sql = `
      SELECT
          order_id,
          CONVERT_TZ(order_time, '+00:00', '+07:00') AS order_time,
          GROUP_CONCAT(CONCAT(item_id, ':', item_name, ':', quantity, ':', item_price)) AS items,
          total_price,
          user_name
      FROM
          orders
      `;
  if (status === 'pending') {
    sql += "WHERE status = 'pending'";
  } else if (status === 'completed') {
    sql += "WHERE status = 'completed'";
  }
  sql += "GROUP BY order_id, order_time, total_price, user_name";
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
  let sql = 'SELECT * FROM menu_items';
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
    const { name, price, category } = req.body;
    const uploadedFile = req.file;

    // Sanitize the filename
    const sanitizedFilename = name.toLowerCase().replace(/\s+/g, '-');
    const originalExtension = path.extname(uploadedFile.originalname);

    // Create the target directory if it doesn't exist
    const targetDirectory = path.join(__dirname, 'public', 'uploads');
    await fs.mkdir(targetDirectory, { recursive: true });

    // Move the file to the target directory with the sanitized filename and original extension
    const targetPath = path.join(targetDirectory, sanitizedFilename + originalExtension);
    await fs.rename(uploadedFile.path, targetPath);

    console.log('File moved successfully');

    // Insert menu item into the database
    const sql = 'INSERT INTO menu_items (name, price, image_source, category) VALUES (?, ?, ?, ?)';
    connection.query(sql, [name, price, sanitizedFilename + originalExtension, category], (err, result) => {
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
  const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
  connection.query(sql, [username, password], (err, results) => {
    if (err) {
      console.error('Error logging in:', err);
      res.status(500).json({ error: 'Failed to login' });
    } else {
      if (results.length > 0) {
        const user = results[0];
        res.json({ success: true, message: 'Login successful', userId: user.id, name: user.name, balance: user.balance });
      } else {
        res.status(401).json({ success: false, message: 'Invalid username or password' });
      }
    }
  });
});

app.post('/api/register', (req, res) => {
  const { name, email, username, password } = req.body;
  const sql = 'INSERT INTO users (name, email, username, password) VALUES (?, ?, ?, ?)';
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
  const sql = 'SELECT name, balance FROM users WHERE id = ?';
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
  const sql = 'SELECT balance FROM users WHERE id = ?';
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
  const { username, amount } = req.body;

  // Contoh implementasi: Ambil saldo user dari database, tambahkan amount, dan update saldo user di database
  const sql = 'SELECT * FROM users WHERE username = ?';
  connection.query(sql, [username], (err, results) => {
    if (err) {
      console.error('Error fetching user data:', err);
      res.status(500).json({ error: 'Failed to fetch user data' });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = results[0];
    const newBalance = user.balance + parseInt(amount);

    const updateSql = 'UPDATE users SET balance = ? WHERE username = ?';
    connection.query(updateSql, [newBalance, username], (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error updating balance:', updateErr);
        res.status(500).json({ error: 'Failed to update balance' });
        return;
      }

      res.json({ success: true, message: 'Balance updated successfully', balance: newBalance });
    });
  });
});

app.post('/api/updateOrderStatus', async (req, res) => {
  const { orderId, status } = req.body;
  console.log(`Received request to update order status. orderId: ${orderId}, status: ${status}`);

  try {
    const sql = 'UPDATE orders SET status = ? WHERE order_id = ?';
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
