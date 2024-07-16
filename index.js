const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xnvb7mx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server
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
