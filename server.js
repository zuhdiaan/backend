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
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');

require('dotenv').config();

const midtransClient = require('midtrans-client');

app.use(bodyParser.json());
app.use(cors({
  origin: '*', // Untuk testing, buka akses dari semua origin
}));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// console.log("Snap API initialized:", snap);

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

const authenticateUser = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  // Decode the token and extract user ID
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('Decoded user ID:', decoded.id); // Log the user ID

    // Find the user in the database
    connection.query('SELECT * FROM members WHERE member_id = ?', [decoded.id], (error, results) => {
      if (error || results.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      req.user = results[0]; // Attach the user to the request object
      next(); // Proceed to the next middleware
    });
  });
};

app.post('/api/register', (req, res) => {
  const { name, email, username, password } = req.body;
  
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

    // Insert the new user into the database with role set to 'member'
    const sql = 'INSERT INTO members (name, email, username, password, email_verification_token, email_verified, role) VALUES (?, ?, ?, ?, ?, false, "member")';
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

app.post('/api/registerAdmin', async (req, res) => {
  const { name, email, username, password } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid Email Format' });
  }

  try {
    // Log the plain password (for debugging purposes; remove in production)
    console.log("Plain Password:", password);

    // Automatically assign 'admin' role for admin-side registration
    const sql = 'INSERT INTO members (name, email, username, password, role) VALUES (?, ?, ?, ?, ?)';
    connection.query(sql, [name, email, username, password, 'admin'], (error, results) => {
      if (error) {
        console.error('Error registering admin:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }
      res.json({ success: true, message: 'Admin registered successfully' });
    });
  } catch (error) {
    console.error('Error processing registration:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

app.post('/api/loginAdmin', (req, res) => {
  const { username, password } = req.body;

  // Update the query to include email_verified in the selected fields
  connection.query('SELECT member_id, password, role, email_verified FROM members WHERE username = ?', [username], (error, results) => {
      if (error) {
          console.error('Database error:', error);
          return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }

      if (results.length > 0) {
          const user = results[0];

          // Check if the user is a member
          if (user.role === 'member') {
              return res.json({ success: false, message: 'Akun member tidak dapat login di web.' });
          }

          // Check if the user's email is verified
          if (user.role === 'admin' && user.email_verified === 0) {
              return res.json({ success: false, message: 'Email tidak terverifikasi. Silakan minta owner verifikasi email Anda sebelum login.' });
          }

          // Verify password
          if (password === user.password) {
              res.json({ success: true, member_id: user.member_id, role: user.role });
          } else {
              res.json({ success: false, message: 'Username atau password salah.' });
          }
      } else {
          res.json({ success: false, message: 'Username atau password salah.' });
      }
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

    const result = await new Promise((resolve, reject) => {
      connection.query(sql, [newBalance, memberId], (err, result) => {
        if (err) {
          console.error('Error updating balance:', err);
          return reject(err);
        }
        resolve(result);
      });
    });

    // Check if the update affected any rows
    if (result.affectedRows > 0) {
      res.json({ message: 'Balance updated successfully' });
    } else {
      res.status(404).json({ error: 'Member not found or balance unchanged' });
    }
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
  console.log(token)
  const sql = 'SELECT * FROM members WHERE reset_password_token = ? AND reset_password_expires > ?';
  connection.query(sql, [token, Date.now()], (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      return res.status(500).json({ error: 'Failed to fetch user' });
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired' });
    }

    res.redirect(`myapp://reset-password?token=${token}`);
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

app.put('/api/menu_items/:item_id', async (req, res) => {
  const itemId = req.params.item_id;
  const { item_name, price, category_id } = req.body; // Include category_id

  console.log(`Updating menu item ID: ${itemId} with name: ${item_name}, price: ${price}, category: ${category_id}`); // Debug log

  const validation = validateMenuItem({ item_name, price });
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const sql = 'UPDATE menu_items SET item_name = ?, price = ?, category_id = ? WHERE item_id = ?';
    const result = await queryDatabase(sql, [item_name, price, category_id, itemId]); // Include category_id

    console.log(result); // Check result from query
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    res.json({ message: 'Menu item updated successfully', item_id: itemId });
  } catch (err) {
    console.error('Error updating menu item:', err);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

// Helper function for database queries
const queryDatabase = (sql, params) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, result) => {
      if (err) {
        return reject(err);
      }
      resolve(result);
    });
  });
};

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

const validateMenuItem = (item) => {
  if (!item.item_name || typeof item.item_name !== 'string') {
    return { valid: false, message: 'Item name must be a non-empty string.' };
  }
  if (typeof item.price !== 'number' || item.price < 0) {
    return { valid: false, message: 'Price must be a non-negative number.' };
  }
  return { valid: true };
};

app.delete('/api/menu_items/:item_id', async (req, res) => {
  const itemId = req.params.item_id;
  console.log(`Deleting menu item with ID: ${itemId}`); // Debug log

  try {
    const sql = 'DELETE FROM menu_items WHERE item_id = ?';
    const result = await queryDatabase(sql, [itemId]);
    
    console.log(result); // Check result from query
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    res.status(204).send(); // No Content
  } catch (err) {
    console.error('Error deleting menu item:', err);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
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
  const { orderDate, orderedItems, memberId, tableId, paymentMethod, deferOrder } = req.body;

  if (!orderedItems || orderedItems.length === 0) {
    console.log("Order Error: No items in the order");
    return res.status(400).json({ error: 'No items in the order' });
  }

  try {
    const formattedOrderDate = moment(orderDate).format('YYYY-MM-DD HH:mm:ss');
    const orderAmount = orderedItems.reduce((total, item) => total + item.total_price, 0);
    const orderId = `order-${memberId}-${Date.now()}`;

    if (deferOrder) {
      console.log("Deferring order insertion, generating token only");

      const transactionDetails = {
        order_id: orderId,
        gross_amount: orderAmount,
      };

      const parameter = {
        transaction_details: transactionDetails,
        customer_details: {
          first_name: 'Customer',
          email: 'customer@example.com',
          phone: '08123456789',
        },
        credit_card: { secure: true },
      };

      const transaction = await snap.createTransaction(parameter);
      if (!transaction || !transaction.token) {
        console.log("Error: Failed to generate transaction token");
        return res.status(500).json({ error: 'Failed to generate transaction token' });
      }

      return res.status(200).json({
        paymentToken: transaction.token,
        message: 'Payment token generated. Order will be inserted upon successful payment.',
      });
    }

    console.log("Inserting order after successful payment");

    // Set payment ID and status based on payment method
    let finalPaymentId = null;
    let finalPaymentStatus = 1; // Default to unpaid
    if (paymentMethod !== 'cashier') {
      finalPaymentId = 2; // Cashless
      finalPaymentStatus = 0; // Paid
    }

    const orderSql = 'INSERT INTO `order` (order_status_id, payment_status_id, table_id, order_date, payment_id, member_id) VALUES (?, ?, ?, ?, ?, ?)';
    const orderResult = await new Promise((resolve, reject) => {
      connection.query(orderSql, [0, finalPaymentStatus, tableId, formattedOrderDate, finalPaymentId, memberId], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });

    const insertedOrderId = orderResult.insertId;
    const orderDetailsValues = orderedItems.map(item => [insertedOrderId, item.item_id, item.item_amount, item.total_price]);
    const orderDetailsSql = 'INSERT INTO order_details (order_id, item_id, item_amount, total_price) VALUES ?';

    await new Promise((resolve, reject) => {
      connection.query(orderDetailsSql, [orderDetailsValues], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });

    console.log("Order successfully inserted with ID:", insertedOrderId);
    res.status(200).json({
      message: 'Order placed successfully',
      orderId: insertedOrderId,
    });
  } catch (error) {
    console.error("Order Insertion Error:", error);
    res.status(500).json({ error: 'Failed to process order' });
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

app.get('/api/user/order', (req, res) => {
  const userId = req.query.userId;

  let sql = `
    SELECT
      o.order_id,
      CONVERT_TZ(o.order_date, '+00:00', '+07:00') AS order_time,
      JSON_ARRAYAGG(
        JSON_OBJECT(
          'item_id', od.item_id,
          'item_name', mi.item_name,
          'item_amount', od.item_amount,
          'item_price', od.total_price,
          'price', mi.price
        )
      ) AS items,
      SUM(od.total_price) AS total_price,
      ps.payment_status,
      t.table_name AS table_number,
      p.payment_description AS payment_method,
      o.order_status_id
    FROM
      \`order\` o
    LEFT JOIN
      order_details od ON o.order_id = od.order_id
    LEFT JOIN
      menu_items mi ON od.item_id = mi.item_id
    LEFT JOIN
      payment_status ps ON o.payment_status_id = ps.payment_status_id
    LEFT JOIN
      \`table\` t ON o.table_id = t.table_id
    LEFT JOIN
      payment p ON o.payment_id = p.payment_id
    WHERE
      o.member_id = ?
    GROUP BY
      o.order_id, o.order_date, ps.payment_status, t.table_name, p.payment_description, o.order_status_id
  `;

  connection.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching user orders from database:', err);
      return res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'No orders found for this user' });
    }

    const categorizedOrders = {
      pending: results.filter(order => order.order_status_id === 0),
      completed: results.filter(order => order.order_status_id === 1),
      cancelled: results.filter(order => order.order_status_id === 2)
    };

    res.json(categorizedOrders);
  });
});

app.post('/api/cancelOrder', (req, res) => {
  const { orderId } = req.body;

  // Step 1: Update the order status to 'canceled'
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

      // Step 2: Fetch total price, member_id, and payment_id from order_details and order
      const getOrderDetailsSql = `
        SELECT SUM(od.total_price) AS total_refund, o.member_id, o.payment_id 
        FROM order_details od 
        JOIN \`order\` o ON od.order_id = o.order_id 
        WHERE od.order_id = ?
        GROUP BY o.member_id, o.payment_id`;

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
        const paymentId = orderDetails[0].payment_id;

        // Step 3: Check if the payment method is "Pay at the Cashier" (represented by null)
        if (paymentId === null) {
          // Do not process refund for "Pay at the Cashier"
          return connection.commit((err) => {
            if (err) {
              console.error('Error committing transaction:', err);
              return connection.rollback(() => {
                res.status(500).json({ error: 'Failed to commit transaction' });
              });
            }

            res.json({ message: 'Order canceled without refund' });
          });
        } else {
          // Step 4: Update member balance for other payment methods
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

            // Step 5: Commit transaction
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
        }
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
  const status = req.query.status;

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
    LEFT JOIN
      order_details od ON o.order_id = od.order_id
    LEFT JOIN
      menu_items mi ON od.item_id = mi.item_id
    LEFT JOIN
      members m ON o.member_id = m.member_id
    LEFT JOIN
      payment_status ps ON o.payment_status_id = ps.payment_status_id
    LEFT JOIN
      \`table\` t ON o.table_id = t.table_id
    LEFT JOIN
      payment p ON o.payment_id = p.payment_id
  `;

  // Handle fetching specific order by orderId or by status
  if (orderId) {
    sql += `WHERE o.order_id = ? `;
  } else if (status) {
    sql += `
      WHERE o.order_status_id = (
        SELECT order_status_id FROM order_status WHERE order_status = ?
      ) `;
  }

  sql += `
    GROUP BY o.order_id, o.order_date, m.name, ps.payment_status, t.table_name, p.payment_description
  `;

  const params = orderId ? [orderId] : status ? [status] : [];

  connection.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching orders from database:', err);
      res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
    } else {
      if (results.length === 0) {
        res.status(404).json({ error: 'Order not found' });
      } else if (orderId) {
        // Return a single order for orderId queries
        res.json(results[0]); 
      } else {
        // Return all orders for status queries
        res.json(results);
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

    // Check if item_name already exists in the database
    const checkSql = 'SELECT COUNT(*) AS count FROM menu_items WHERE item_name = ?';
    connection.query(checkSql, [item_name], async (err, results) => {
      if (err) {
        console.error('Error checking for duplicates:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results[0].count > 0) {
        return res.status(400).json({ error: 'Menu item with the same name already exists' });
      }

      // Proceed if no duplicates
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

app.post('/api/topup', async (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({ error: 'User ID and amount are required' });
  }

  try {
    const transactionDetails = {
      order_id: `topup-${userId}-${Date.now()}`, // <-- Corrected here
      gross_amount: amount,
    };

    const parameter = {
      transaction_details: transactionDetails,
      customer_details: {
        first_name: 'Customer',
        email: 'customer@example.com',
        phone: '08123456789',
      },
      credit_card: {
        secure: true,
      },
    };

    const transaction = await snap.createTransaction(parameter);
    const transactionToken = transaction.token;

    res.json({ success: true, token: transactionToken });

  } catch (error) {
    console.error('Error creating Midtrans token:', error);
    res.status(500).json({ error: 'Failed to create payment token' });
  }
});

app.post('/api/topupAdmin', (req, res) => {
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

app.post('/api/insertTopUp', async (req, res) => {
  const { memberId, topUpAmount } = req.body;

  try {
    const sql = 'INSERT INTO top_up (member_id, topup_amount) VALUES (?, ?)';
    await new Promise((resolve, reject) => {
      connection.query(sql, [memberId, topUpAmount], (err, result) => {
        if (err) {
          console.error('Error inserting top-up record:', err);
          reject(err);
        } else {
          res.json({ message: 'Top-up record inserted successfully' });
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Error inserting top-up record:', error);
    res.status(500).json({ error: 'Failed to insert top-up record' });
  }
});

app.get('/api/getTopUpData', (req, res) => {
  const { member_id } = req.query; // Get member_id from query params to filter by user
  console.log("Received request for member_id:", member_id);
  if (!member_id) {
    return res.status(400).json({ error: 'Member ID is required' });
  }

  // Query to fetch top-up history for the given member_id
  const sqlSelect = 'SELECT * FROM top_up WHERE member_id = ? ORDER BY topup_id DESC';
  connection.query(sqlSelect, [member_id], (err, results) => {
    if (err) {
      console.error('Error fetching top-up data:', err);
      return res.status(500).json({ error: 'Failed to fetch top-up data' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No top-up data found' });
    }

    // Return top-up data to the client
    res.json({ success: true, topUpData: results });
  });
});

app.post('/api/midtrans-notification', async (req, res) => {
  const notification = req.body;

  try {
    const statusResponse = await snap.transaction.notification(notification);
    console.log('Midtrans Notification:', statusResponse);

    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    console.log(`Order ID: ${orderId}, Status: ${transactionStatus}, Fraud Status: ${fraudStatus}`);

    if (transactionStatus === 'settlement' && fraudStatus === 'accept') {
      // Extract userId and amount from orderId
      const [_, userId, timestamp] = orderId.split('-');
      const amount = statusResponse.gross_amount;

      // Update user balance in the database
      const updateBalanceQuery = 'UPDATE members SET balance = balance + ? WHERE member_id = ?';
      const insertTopUpQuery = 'INSERT INTO top_up (topup_amount, member_id) VALUES (?, ?)';

      await db.query(updateBalanceQuery, [amount, userId]);
      await db.query(insertTopUpQuery, [amount, userId]);

      console.log(`Balance updated for user ${userId}, amount: ${amount}`);

      res.status(200).send('Transaction successful and database updated');
    } else {
      console.log('Transaction not successful or fraud detected');
      res.status(400).send('Transaction not successful');
    }
  } catch (error) {
    console.error('Error handling Midtrans notification:', error);
    res.status(500).send('Internal server error');
  }
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
  console.log(`Fetching category with ID: ${categoryId}`);
  
  const sql = 'SELECT * FROM categories WHERE category_id = ?';
  
  connection.query(sql, [categoryId], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Failed to fetch category' });
    }
    
    if (results.length > 0) {
      res.json(results[0]);
    } else {
      res.status(404).json({ error: 'Category not found' });
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

app.get('/api/users', (req, res) => {
  // SQL query to select users who are either admin, excluding members and owners
  const sql = 'SELECT member_id, name, email, username, role, email_verified AS verified FROM members WHERE role != "member" AND role != "owner"';
  
  connection.query(sql, (error, results) => {
      if (error) {
          console.error('Error fetching users:', error);
          return res.status(500).json({ error: 'Internal Server Error' });
      }
      res.json(results); // Send the filtered user data as a JSON response
  });
});

app.post('/api/verifyUser', (req, res) => {
  const { user_id } = req.body;

  const sql = 'UPDATE members SET email_verified = 1 WHERE member_id = ?';
  connection.query(sql, [user_id], (error, results) => {
      if (error) {
          console.error('Error verifying user:', error);
          return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }
      if (results.affectedRows > 0) {
          res.json({ success: true, message: 'User verified successfully' });
      } else {
          res.status(404).json({ success: false, message: 'User not found' });
      }
  });
});

// API endpoint to delete user
app.delete('/api/deleteUser', (req, res) => {
  const { user_id } = req.body; // This should correspond to member_id in your DB

  const sql = 'DELETE FROM members WHERE member_id = ?';
  connection.query(sql, [user_id], (error, results) => {
      if (error) {
          console.error('Error deleting user:', error);
          return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }
      if (results.affectedRows > 0) {
          res.json({ success: true, message: 'User deleted successfully' });
      } else {
          console.log('No user found with ID:', user_id); // Log if no user was found
          res.status(404).json({ success: false, message: 'User not found' });
      }
  });
});

app.get('/api/exportOrders', (req, res) => {
  const sql = `
    SELECT 
      o.order_id, 
      CONVERT_TZ(o.order_date, '+00:00', '+07:00') AS order_time, 
      od.item_id, 
      mi.item_name, 
      od.item_amount, 
      od.total_price AS item_total_price, 
      SUM(od.total_price) OVER (PARTITION BY o.order_id) AS total_price, 
      m.name AS user_name, 
      ps.payment_status, 
      t.table_name AS table_number, 
      p.payment_description AS payment_method
    FROM \`order\` o
    LEFT JOIN order_details od ON o.order_id = od.order_id
    LEFT JOIN menu_items mi ON od.item_id = mi.item_id
    LEFT JOIN members m ON o.member_id = m.member_id
    LEFT JOIN payment_status ps ON o.payment_status_id = ps.payment_status_id
    LEFT JOIN \`table\` t ON o.table_id = t.table_id
    LEFT JOIN payment p ON o.payment_id = p.payment_id
    WHERE o.order_status_id = (
      SELECT order_status_id FROM order_status WHERE order_status = 'completed'
    )
    ORDER BY o.order_id, od.item_id;
  `;

  connection.query(sql, (error, results) => {
    if (error) {
      console.error('Error fetching orders:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Keep track of the last seen order_id to avoid repetition
    let previousOrderId = null;

    // Format data for Excel with empty cells for repeated fields
    const formattedData = results.map((order, index) => {
      const isFirstRowForOrder = order.order_id !== previousOrderId;
      previousOrderId = order.order_id;

      return {
        'Order ID': isFirstRowForOrder ? order.order_id : '',  // Show only in the first row
        'Order Date': isFirstRowForOrder ? order.order_time : '',
        'User Name': isFirstRowForOrder ? order.user_name || 'Unknown' : '',
        'Item Name': order.item_name || 'Unknown',
        'Quantity': order.item_amount || 0,
        'Item Total Price': `Rp. ${Number(order.item_total_price).toFixed(2)}`,
        'Total Price': isFirstRowForOrder ? `Rp. ${Number(order.total_price).toFixed(2)}` : '',
        'Payment Status': isFirstRowForOrder ? order.payment_status || 'Unknown' : '',
        'Table Number': isFirstRowForOrder ? order.table_number || 'Unknown' : '',
        'Payment Method': isFirstRowForOrder ? order.payment_method || 'Unknown' : ''
      };
    });

    // Create Excel workbook and sheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(formattedData);
    XLSX.utils.book_append_sheet(wb, ws, 'Order History');

    // Generate Excel file as buffer
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    // Set response headers and send the file
    res.setHeader('Content-Disposition', 'attachment; filename=order_history.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.end(excelBuffer);
  });
});

app.listen(port, '0.0.0.0', () => {
  // console.log(`Server running at http://0.0.0.0:${port}`);
});