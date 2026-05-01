const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

// 🔥 1. Firebase Admin Setup
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json'); // Ye file wahi honi chahiye

// Firebase ko God Mode mein start karo
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RAZORPAY_WEBHOOK_SECRET = "NgcEats_XyZ987#Secure$2026!WqL_Alpha"; // Yahan apna wala khatarnak password rakhna

app.get('/', (req, res) => {
    res.send("NGCEats Backend Engine is LIVE! 🚀");
});

// 🔥 DHYAN DE: Yahan (req, res) ke aage 'async' lagana zaroori hai Firebase chalane ke liye
app.post('/webhook', async (req, res) => { 
    const razorpaySignature = req.headers['x-razorpay-signature'];

    const shasum = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET);
    shasum.update(JSON.stringify(req.body));
    const expectedSignature = shasum.digest('hex');

    if (expectedSignature === razorpaySignature) {
        console.log("✅ Payment Verified!");
        
        const event = req.body.event;

        if (event === 'payment.captured' || event === 'payment.authorized') {
            const paymentDetails = req.body.payload.payment.entity;
            const amountPaid = paymentDetails.amount / 100;
            
            // 💡 THE MAGIC: Razorpay se Order ID nikalna
            // (Android app se payment karte time humein 'notes' me orderId bhejna hoga)
            const orderId = paymentDetails.notes.orderId; 

            console.log(`💰 Payment Received: ₹${amountPaid} for Order: ${orderId}`);

            if (orderId) {
                try {
                    // 🔥 2. Firebase mein us order ka status 'Paid' kar do!
                    await db.collection('orders').doc(orderId).update({
                        paymentStatus: 'Paid'
                    });
                    console.log(`✅ Order ${orderId} successfully marked as PAID in Firebase!`);
                } catch (error) {
                    console.log("❌ Firebase update error:", error);
                }
            } else {
                console.log("⚠️ Order ID nahi mili Razorpay notes mein!");
            }
        }
        res.status(200).send("OK");
    } else {
        console.log("❌ Hacker Alert! Fake Payment Blocked.");
        res.status(403).send("Invalid Signature");
    }
});

app.listen(PORT, () => {
    console.log(`NGCEats Server running on port ${PORT} 🚀`);
});