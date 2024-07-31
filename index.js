const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xnvb7mx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();
        const database = client.db("arthoDB");
        const usersCollection = database.collection("users");
        const transactionsCollection = database.collection("transactions");

        const JWT_SECRET = process.env.JWT_SECRET;

        // Middleware to verify JWT
        const verifyToken = (req, res, next) => {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) return res.status(401).json({ error: 'Unauthorized' });

            jwt.verify(token, JWT_SECRET, (err, decoded) => {
                if (err) return res.status(403).json({ error: 'Invalid token' });
                req.userId = decoded.id;
                next();
            });
        };


        // User Registration
        app.post('/users/register', async (req, res) => {
            const { name, pin, mobile, email, role } = req.body;
            const hashedPin = await bcrypt.hash(pin, 10);
            const newUser = {
                name,
                pin: hashedPin,
                mobile,
                email,
                role,
                balance: role === 'agent' ? 10000 : 40,
                status: 'pending'
            };

            try {
                const result = await usersCollection.insertOne(newUser);
                res.status(201).json({ message: 'User registered successfully. Awaiting admin approval.' });
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        // User Login
        app.post('/users/login', async (req, res) => {
            const { emailOrMobile, pin } = req.body;

            try {
                const user = await usersCollection.findOne({
                    $or: [{ email: emailOrMobile }, { mobile: emailOrMobile }]
                });
                if (!user) return res.status(404).json({ error: 'User not found' });

                const isMatch = await bcrypt.compare(pin, user.pin);
                if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

                if (user.status !== 'approved') return res.status(403).json({ error: 'Account not approved by admin. Try again 1h later' });

                const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
                res.json({ token, user });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // admin 
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            let admin = false;
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin })
        })

        // Check if user is agent
        app.get('/users/agent/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email });
            let isAgent = false;
            if (user) {
                isAgent = user.role === 'agent';
            }
            res.send({ agent: isAgent });
        });

        app.get('/users/all', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result)
        })

        // Approve user
        app.patch('/users/approve/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: 'approved'
                }
            };
            const result = await usersCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // Block user
        app.patch('/users/block/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: 'blocked'
                }
            };
            const result = await usersCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });


        // Delete user
        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(filter);
            res.send(result);
        });

        // Send Money Endpoint
        app.post('/transactions/send', verifyToken, async (req, res) => {
            const { receiverMobile, amount, pin } = req.body;

            if (amount < 50) return res.status(400).json({ error: 'Minimum transaction amount is 50 Taka' });

            try {
                const sender = await usersCollection.findOne({ _id: new ObjectId(req.userId) });

                if (!sender) return res.status(404).json({ error: 'Sender not found' });
                const isPinMatch = await bcrypt.compare(pin, sender.pin);
                if (!isPinMatch) return res.status(400).json({ error: 'Invalid PIN' });

                const receiver = await usersCollection.findOne({ mobile: receiverMobile });
                if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

                const transactionFee = amount > 100 ? 5 : 0;
                const totalAmount = amount + transactionFee;
                if (sender.balance < totalAmount) return res.status(400).json({ error: 'Insufficient balance' });

                const updatedSenderBalance = sender.balance - totalAmount;
                const updatedReceiverBalance = receiver.balance + amount;

                await usersCollection.updateOne({ _id: sender._id }, { $set: { balance: updatedSenderBalance } });
                await usersCollection.updateOne({ _id: receiver._id }, { $set: { balance: updatedReceiverBalance } });

                // Log the transaction
                const transaction = {
                    type: 'send',
                    senderId: sender._id,
                    receiverId: receiver._id,
                    amount,
                    fee: transactionFee,
                    date: new Date()
                };
                await transactionsCollection.insertOne(transaction);

                res.status(200).json({ message: 'Transaction successful' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        // Cash In

        app.post('/cashIn', async (req, res) => {
            const cashInDetails = req.body;
            const result = await transactionsCollection.insertOne(cashInDetails);
            res.send(result)

        })

        // Fetch cash-in requests by agent mobile and type
        app.get('/cashInRequest/:mobile', async (req, res) => {
            const mobile = req.params.mobile;
            const result = await transactionsCollection.find({
                agentMobile: mobile,
                type: "Cash In"
            }).toArray();
            res.send(result)
        });


        // Accept Cash-In Request
        app.post('/cashIn/accept', verifyToken, async (req, res) => {
            try {
                const { requestId, agentMobile, userMobile, amount } = req.body;

                // Fetch the cash-in request by ID
                const request = await transactionsCollection.findOne({ _id: new ObjectId(requestId) });
                if (!request) return res.status(404).json({ error: 'Cash-in request not found' });
                if (request.status === 'accepted') return res.status(400).json({ error: 'Request already accepted' });

                // Fetch the user and agent involved in the transaction
                const user = await usersCollection.findOne({ mobile: userMobile });
                const agent = await usersCollection.findOne({ mobile: agentMobile });

                // Check if agent has sufficient balance
                if (agent.balance < amount) {
                    return res.status(400).json({ error: 'Insufficient balance in agent account' });
                }

                // Update user and agent balances
                const updatedUserBalance = user.balance + amount;
                const updatedAgentBalance = agent.balance - amount;

                await usersCollection.updateOne({ _id: user._id }, { $set: { balance: updatedUserBalance } });
                await usersCollection.updateOne({ _id: agent._id }, { $set: { balance: updatedAgentBalance } });

                // Update request status to 'accepted'
                await transactionsCollection.updateOne(
                    { _id: new ObjectId(requestId) },
                    { $set: { status: 'accepted' } }
                );

                res.status(200).json({ message: 'Cash-in request accepted successfully' });
            } catch (error) {
                console.error('Error accepting cash-in request:', error);
                res.status(500).json({ error: 'Server error' });
            }
        });


        // Cash Out
        app.post('/cashOut', verifyToken, async (req, res) => {
            const { userMobile, agentMobile, amount, pin, userName, balance } = req.body;

            try {
                const user = await usersCollection.findOne({ mobile: userMobile });

                if (!user) return res.status(404).json({ error: 'User not found' });
                const isPinMatch = await bcrypt.compare(pin, user.pin);
                if (!isPinMatch) return res.status(400).json({ error: 'Invalid PIN' });

                const agent = await usersCollection.findOne({ mobile: agentMobile });
                if (!agent) return res.status(404).json({ error: 'Agent not found' });

                const cashOutFee = amount * 0.015;
                const totalAmount = amount + cashOutFee;
                if (user.balance < totalAmount) return res.status(400).json({ error: 'Insufficient balance' });

                const updatedUserBalance = user.balance - totalAmount;
                const updatedAgentBalance = agent.balance + amount;

                await usersCollection.updateOne({ _id: user._id }, { $set: { balance: updatedUserBalance } });
                await usersCollection.updateOne({ _id: agent._id }, { $set: { balance: updatedAgentBalance } });

                // Log the transaction
                const transaction = {
                    type: 'Cash Out',
                    userMobile: userMobile,
                    agentMobile: agentMobile,
                    amount,
                    userName,
                    balance,
                    fee: cashOutFee,
                    date: new Date()
                };
                await transactionsCollection.insertOne(transaction);

                res.status(200).json({ message: 'Cash out successful' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Fetch transaction history by user mobile
        app.get('/transactions/history/:mobile', verifyToken, async (req, res) => {
            const mobile = req.params.mobile;

            try {
                const user = await usersCollection.findOne({ mobile });
                if (!user) return res.status(404).json({ error: 'User not found' });

                const transactions = await transactionsCollection.find({ userMobile: mobile }).sort({ date: -1 }).limit(10).toArray();
                res.json(transactions);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        // Logout endpoint (optional)
        app.post('/users/logout', (req, res) => {
            // Here you could handle any server-side cleanup if necessary
            res.status(200).json({ message: 'Logged out successfully' });
        });

        // Get current user info
        app.get('/users/me', async (req, res) => {
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) return res.status(401).json({ error: 'Unauthorized' });

            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await usersCollection.findOne({ _id: new ObjectId(decoded.id) });
                if (!user) return res.status(404).json({ error: 'User not found' });

                res.json(user);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Amar Artho is running');
});

app.listen(port, () => {
    console.log(`Amar Artho is running on port ${port}`);
});
