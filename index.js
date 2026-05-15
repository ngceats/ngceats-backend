const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

// 🔥 1. Firebase Admin Setup
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json'); 

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
                    // 🔥 THE MAIN ENGINE: Global order dhoondo
                    const ordersSnapshot = await db.collection("orders").where("id", "==", orderId).limit(1).get();
                    
                    if (ordersSnapshot.empty) {
                        console.log("⚠️ Order not found in DB!");
                        return res.status(200).send("OK");
                    }

                    const orderDoc = ordersSnapshot.docs[0];
                    const orderData = orderDoc.data();
                    const userId = orderData.userId;
                    const resName = orderData.restaurantName;
                    const walletDiscount = orderData.walletDiscount || 0;

                    // 🔥 BATCH UPDATE SHURU
                    const batch = db.batch();

                    const updates = {
                        paymentStatus: 'Paid Online',
                        status: 'Order Received',
                        razorpayId: razorpayPaymentId
                    };

                    // 1. Update Global Order
                    batch.update(orderDoc.ref, updates);

                    // 2. Update User's Order List
                    if (userId) {
                        const userOrderRef = db.collection("users").doc(userId).collection("orders").doc(orderId);
                        batch.update(userOrderRef, updates);
                        
                        // 3. Wallet deduction (agar use kiya tha)
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
                    }

                    // 4. Update Restaurant's Order List
                    if (resName) {
                        const resOrderRef = db.collection("restaurants").doc(resName).collection("orders").doc(orderId);
                        batch.update(resOrderRef, updates);
                    }

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