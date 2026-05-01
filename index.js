const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
// Webhook ke liye raw data chahiye hota hai signature verify karne ke liye
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔥 Ye humara secret password hai jo sirf humein aur Razorpay ko pata hoga
const RAZORPAY_WEBHOOK_SECRET = "NgcEats_XyZ987#Secure$2026!WqL_Alpha";

// 1. Basic Test Route (Check karne ke liye ki server zinda hai ya nahi)
app.get('/', (req, res) => {
    res.send("NGCEats Backend Engine is LIVE! 🚀");
});

// 2. 🔥 THE HACKPROOF WEBHOOK ROUTE
app.post('/webhook', (req, res) => {
    // Razorpay ne jo signature bheja hai
    const razorpaySignature = req.headers['x-razorpay-signature'];

    // Hum apne secret se apna signature banayenge
    const shasum = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET);
    shasum.update(JSON.stringify(req.body));
    const expectedSignature = shasum.digest('hex');

    // Asli Jadoo: Agar dono match ho gaye, matlab payment 100% REAL hai!
    if (expectedSignature === razorpaySignature) {
        console.log("✅ Payment Verified 100% Securely!");
        
        const event = req.body.event;

        // Jab payment successful hoti hai
        if (event === 'payment.captured' || event === 'order.paid') {
            const paymentDetails = req.body.payload.payment.entity;
            const amountPaid = paymentDetails.amount / 100; // Paise to Rupees
            
            console.log(`💰 Ekdum Asli Payment Received: ₹${amountPaid}`);
            
            // TODO: Next step mein hum yahan Firebase ko connect karenge 
            // taaki Order status "Paid" ho jaye!
        }
        
        // Razorpay ko bata do ki "Bhai message mil gaya, thank you!"
        res.status(200).send("OK");
    } else {
        // Agar koi hacker fake request bhejega toh ye yahan pakda jayega!
        console.log("❌ Hacker Alert! Fake Payment Request Blocked.");
        res.status(403).send("Invalid Signature");
    }
});

app.listen(PORT, () => {
    console.log(`NGCEats Server running on port ${PORT} 🚀`);
});