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

const Razorpay = require('razorpay');

// 🔥 RAZORPAY INITIALIZE KARO 
// (Apni Live ya Test Key aur Secret yahan daalna)
const razorpay = new Razorpay({
  key_id: "rzp_live_SZSVcD6UFK4igr", 
  key_secret: "Hq8bLKEGsdiaGq1YN03sn1Yl"
});

// 🔥 THE MANUAL PAYOUT ENGINE (Admin App isko call karegi) 🔥
app.post('/api/payout', async (req, res) => {
    try {
        const { linkedAccountId, amount, orderId } = req.body;

        if (!linkedAccountId || !amount) {
            return res.status(400).json({ error: "Linked Account ID aur Amount zaroori hai!" });
        }

        // Razorpay ko amount PAISE (paise) mein chahiye hota hai (e.g., 104.70 * 100 = 10470)
        const transferAmount = Math.round(amount * 100);

        // Razorpay Transfer API ko call karo (Direct transfer from your balance to Vendor)
        const transfer = await razorpay.transfers.create({
            account: linkedAccountId, // Restaurant ki 'acc_...' wali ID
            amount: transferAmount,
            currency: "INR",
            notes: {
                reason: "Manual Payout by Admin",
                orderId: orderId || "Manual_Transfer"
            }
        });

        console.log(`✅ Payout Successful: ₹${amount} sent to ${linkedAccountId}`);
        
        // Admin app ko batao ki success ho gaya
        res.status(200).json({ success: true, transfer: transfer });

    } catch (error) {
        console.error("❌ Payout Failed:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// 🔥 THE MANUAL REFUND ENGINE (Admin App isko call karegi) 🔥
app.post('/api/refund', async (req, res) => {
    try {
        const { paymentId, amount, orderId, reason } = req.body;

        // Payment ID (razorpayId) hona sabse zaroori hai
        if (!paymentId) {
            return res.status(400).json({ error: "Payment ID (razorpayId) zaroori hai!" });
        }

        const refundOptions = {
            notes: {
                order_id: orderId || "Unknown",
                reason: reason || "Manual Refund by Admin"
            }
        };

        // Agar specific amount bheja hai (Partial Refund), toh usko paise mein convert karo
        // Agar amount nahi bheja, toh Razorpay automatically POORA paisa (Full Refund) wapas kar dega
        if (amount) {
            refundOptions.amount = Math.round(amount * 100); 
        }

        // Razorpay API ko Refund karne ka command do
        const refund = await razorpay.payments.refund(paymentId, refundOptions);

        console.log(`✅ Refund Successful: ₹${amount || "Full Amount"} refunded for Payment ID: ${paymentId}`);
        
        // Admin app ko batao ki refund initiate ho gaya hai
        res.status(200).json({ success: true, refund: refund });

    } catch (error) {
        console.error("❌ Refund Failed:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});