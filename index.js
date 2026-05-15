const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

// 🔥 1. Firebase Admin Setup
const admin = require('firebase-admin');
let serviceAccount;
try {
    serviceAccount = require('/etc/secrets/firebase-key.json');
} catch (error) {
    serviceAccount = require('./firebase-key.json');
}
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(cors());

// 🔥 THE FIX: Raw Body capture karna zaroori hai Razorpay ke liye
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

const PORT = process.env.PORT || 3000;
const RAZORPAY_WEBHOOK_SECRET = "NgcEats_XyZ987#Secure$2026!WqL_Alpha"; 

app.get('/', (req, res) => {
    res.send("NGCEats Backend Engine is LIVE! 🚀");
});

app.post('/webhook', async (req, res) => { 
    try {
        const razorpaySignature = req.headers['x-razorpay-signature'];

        // 🔥 THE FIX: JSON.stringify ki jagah req.rawBody use kiya
        const shasum = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET);
        shasum.update(req.rawBody); 
        const expectedSignature = shasum.digest('hex');

        if (expectedSignature === razorpaySignature) {
            console.log("✅ Payment Verified!");
            
            const event = req.body.event;

            if (event === 'payment.captured' || event === 'payment.authorized' || event === 'order.paid') {
                const paymentDetails = req.body.payload.payment.entity;
                const razorpayPaymentId = paymentDetails.id;
                const orderId = paymentDetails.notes?.orderId || paymentDetails.notes?.ngc_order_id; 

                console.log(`💰 Payment Received for Order: ${orderId}`);

                if (orderId) {
                    // 🔥 THE FIX 1: Pehle root collection se order dhoondh kar uska userId nikalenge
                    const stubDoc = await db.collection("orders").doc(orderId).get();
                    
                    if (!stubDoc.exists) {
                        console.log("⚠️ Order not found in root DB!");
                        return res.status(200).send("OK");
                    }

                    const userId = stubDoc.data().userId;

                    // 🔥 THE FIX 2: Ab User ke andar se poora Asli order nikalenge
                    const userOrderRef = db.collection("users").doc(userId).collection("orders").doc(orderId);
                    const orderDoc = await userOrderRef.get();

                    if (!orderDoc.exists) {
                        console.log("⚠️ Full order not found in User's collection!");
                        return res.status(200).send("OK");
                    }

                    const orderData = orderDoc.data();
                    const resName = orderData.restaurantName;
                    const walletDiscount = orderData.walletDiscount || 0;

                    // 🔥 BATCH UPDATE SHURU
                    const batch = db.batch();

                    const updates = {
                        paymentStatus: 'Paid Online',
                        status: 'Order Received',
                        razorpayId: razorpayPaymentId
                    };

                    // 1. Update User's Order List
                    batch.update(userOrderRef, updates);
                    
                    // 2. Wallet deduction (agar use kiya tha)
                    if (walletDiscount > 0) {
                        const userRef = db.collection("users").doc(userId);
                        batch.update(userRef, {
                            walletBalance: admin.firestore.FieldValue.increment(-walletDiscount)
                        });

                        // Wallet Transaction Entry
                        const txRef = db.collection("users").doc(userId).collection("transactions").doc();
                        batch.set(txRef, {
                            title: `Paid for Order at ${resName}`,
                            amount: walletDiscount,
                            type: "DEBIT",
                            timestamp: Date.now(),
                            orderId: orderId
                        });
                    }

                    // 3. Update Restaurant's Order List
                    if (resName) {
                        const resOrderRef = db.collection("restaurants").doc(resName).collection("orders").doc(orderId);
                        batch.set(resOrderRef, { ...orderData, ...updates }, { merge: true });
                    }

                    // 4. Update Global Order (Pehle wali choti entry ko poore data se overwrite kar denge)
                    const globalOrderRef = db.collection("orders").doc(orderId);
                    batch.set(globalOrderRef, { ...orderData, ...updates });

                    // BATCH COMMIT KARO
                    await batch.commit();
                    console.log(`✅ All databases updated successfully for: ${orderId}`);

                } else {
                    console.log("⚠️ Order ID nahi mili Razorpay notes mein!");
                }
            }
            res.status(200).send("OK");

        } else {
            console.log("❌ Hacker Alert! Fake Payment Blocked.");
            res.status(403).send("Invalid Signature");
        }
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send("Server Error");
    }
});

app.listen(PORT, () => {
    console.log(`🚀 NGC Eats Backend running on port ${PORT}`);
});