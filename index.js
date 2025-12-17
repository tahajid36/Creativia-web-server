require('dotenv').config()
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
// middlewares
app.use(cors());
app.use(express.json());
const port = 5000;

const uri =
  "mongodb+srv://creativia:87ZkEagnb7TxuOnJ@bruce.s9kj5xo.mongodb.net/?appName=Bruce";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("creativia");
    const contestCollection = db.collection("contests");
    const userCollection = db.collection('users')
    const paymentCollection = db.collection('payments')
    //user api endpoints 
    app.post('/users', async (req, res) =>{
      const userData  = req.body
      userData.role = 'user'
      const query = {email: userData.email}
      const alreadyExist = await userCollection.findOne(query)
      if(alreadyExist){
        return res.send({message: 'user already exists'})
      }
      const result = await userCollection.insertOne(userData)
    })

    // to create a contest data
    app.post("/contests", async (req, res) => {
      const contestData = req.body;
      const result = await contestCollection.insertOne(contestData);
      res.send(result);
    });
    //  to get all the contest datas and show them
    app.get("/contests", async (req, res) => {
      const result = await contestCollection.find().toArray();
      res.send(result);
    });
    // to get single contest data for details page
    app.get('/contests/:id', async (req, res)=>{
      const id = req.params.id
      const query = {_id: new ObjectId(id)}
      const result = await contestCollection.findOne(query)
      res.send(result)
    })
  // payment getway apis
    app.post('/create-checkout-session', async (req, res)=>{
      const paymentInfo = req.body
      console.log(paymentInfo)
      const CLIENT_URL =process.env.CLIENT_DOMAIN || 'http://localhost:5174'
      const session = await stripe.checkout.sessions.create({
        
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: paymentInfo?.title,
                description: paymentInfo?.description,
                images: [paymentInfo?.banner]
              },
              unit_amount: paymentInfo?.price*10
          }, quantity: 1}
          
        ],
        customer_email: paymentInfo.participant?.email,
        mode: 'payment',
        metadata: {
          contestId: String(paymentInfo?.contestId),
          participant:paymentInfo?.participant.email
        },
        success_url: `http://localhost:5173/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/contests/${paymentInfo?.contestId}`
      })
      res.send({url: session.url})
    })

    app.post('/payment-success', async (req, res)=>{
      
      const {sessionId} = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      console.log(session.status)
      const contest = await contestCollection.findOne({
        _id: new ObjectId(session.metadata.contestId)
      })
      if(session.status === 'complete' && contest){

        const contestInfo = {
          contestId: session.metadata.contestId,
          transactionId: session.payment_intent,
          participant: session.metadata.participant,
          status: 'pending',
          owner: contest.owner,
          title: contest.title,
          category: contest.category,
          participantCount: 1,
          price: session.amount_total / 100,
          image: contest?.banner,
        }
        console.log(contestInfo)
        await paymentCollection.insertOne(contestInfo)

        await contestCollection.updateOne({
          _id: new ObjectId(session.metadata.contestId)
        },
      {
        $inc: {participantCount: +1}
      })
      return res.send({
        transactionId: session.payment_intent,
        orderId: result.insertedId,
      })
      }
      
    })

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});
app.listen(port, () => {
  console.log(`this server running on port ${port}`);
});
