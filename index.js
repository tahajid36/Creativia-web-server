require("dotenv").config();
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// middlewares
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN , 'http://localhost:5173'],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
const port = process.env.PORT || 5000;

const uri = process.env.MONGODB_USER;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// jwt middleawres
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

async function run() {
  try {
    const db = client.db("creativia");
    const contestCollection = db.collection("contests");
    const userCollection = db.collection("users");
    const paymentCollection = db.collection("payments");
    //user api endpoints
    app.post("/users", async (req, res) => {
      const userData = req.body;
      userData.role = "user";
      const query = { email: userData.email };
      const alreadyExist = await userCollection.findOne(query);
      if (alreadyExist) {
        return res.send({ message: "user already exists" });
      }
      const result = await userCollection.insertOne(userData);
      // res.send(result)
    });
    app.get("/users", async (req, res) => {
      try {
        const result = await userCollection.find().toArray();
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });
    // apis to change role of user
    app.patch("/user/:id/role", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = { $set: { role: roleInfo.role } };
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // apis to check users role
    app.get("/user/role", verifyJWT, async (req, res) => {
      const result = await userCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    // apis to get  all participated contests data of the current user
    app.get("/participations/:email", async (req, res) => {
      const email = req.params.email;
      const result = await paymentCollection
        .find({ participant: email })
        .toArray();
      res.send(result);
    });
    // get all contest posted by the looged in creator
    app.get("/postedcontest/:email", async (req, res) => {
      const email = req.params.email;
      const result = await contestCollection
        .find({ "owner.email": email})
        .toArray();
      res.send(result);
    });
    //  to get all the contest datas and show them
    app.get("/contests", async (req, res) => {
      const result = await contestCollection
        .find({ status: "active" })
        .toArray();
      res.send(result);
    });
    // to create a contest data
    app.post("/contests", async (req, res) => {
      const contestData = req.body;
      const result = await contestCollection.insertOne(contestData);
      res.send(result);
    });

    // to get single contest data for details page
    app.get("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await contestCollection.findOne(query);
      res.send(result);
    });
    // to delete contest data from admin panel
    app.delete("/contests/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const contest = await contestCollection.findOne({
        _id: new ObjectId(id),
      });
      await contestCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ deleted: true });
    });
    // to get all the datas for admin which has status pending
    app.get("/manage-contests", async (req, res) => {
      try {
        const result = await contestCollection.find().toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch pending contests" });
      }
    });
    //to update status of an contest from admin
    app.patch("/contest/:id/status", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedStatus = { $set: { status } };
      const result = await contestCollection.updateOne(query, updatedStatus);
      res.send(result);
    });
    // to get all the participants of an specific contest
    app.get("/payments/contest/:contestId", verifyJWT, async (req, res) => {
      const contestId = req.params.contestId;

      const result = await paymentCollection
        .find({
          contestId,
        })
        .toArray();

      res.send(result);
    });
    // to update main contest data with winner
    app.patch("/contest/:id/winner", verifyJWT, async (req, res) => {
      const contestId = req.params.id;
      const { WinnerName, WinnerEmail } = req.body;

      const result = await contestCollection.updateOne(
        { _id: new ObjectId(contestId) },
        {
          $set: {
            winner: {
              WinnerName,
              WinnerEmail,
              declaredAt: new Date(),
            },
            status: "completed",
          },
        }
      );

      res.send(result);
    });

    // payment getway apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const CLIENT_URL = process.env.CLIENT_DOMAIN || "http://localhost:5174";
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.title,
                description: paymentInfo?.description,
                images: [paymentInfo?.banner],
              },
              unit_amount: paymentInfo?.price * 10,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.participant?.email,
        mode: "payment",
        metadata: {
          contestId: String(paymentInfo?.contestId),
          participant: paymentInfo?.participant.email,
          participantName: paymentInfo?.participant.name,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/contests/${paymentInfo?.contestId}`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session.status);
      const contest = await contestCollection.findOne({
        _id: new ObjectId(session.metadata.contestId),
      });
      if (session.status === "complete" && contest) {
        const contestInfo = {
          contestId: session.metadata.contestId,
          transactionId: session.payment_intent,
          participant: session.metadata.participant,
          participantName: session.metadata.participantName,
          status: "pending",
          owner: contest.owner,
          title: contest.title,
          category: contest.category,
          participantCount: 1,
          price: session.amount_total / 100,
          image: contest?.banner,
        };
        console.log(contestInfo);
        const result = await paymentCollection.insertOne(contestInfo);

        await contestCollection.updateOne(
          {
            _id: new ObjectId(session.metadata.contestId),
          },
          {
            $inc: { participantCount: +1 },
          }
        );
        return res.send({
          transactionId: session.payment_intent,
          orderId: result.insertedId,
        });
      }
      res.send(res.send({}));
    });

    // await client.db("admin").command({ ping: 1 });
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
