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

        app.get('/users/all',async(req,res)=>{
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
