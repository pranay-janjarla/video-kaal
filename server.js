// server.js
require("dotenv").config();
const express = require("express");
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server);
const { v4: uuidV4 } = require("uuid");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const MongoStore = require("connect-mongo");

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 24 hours
  })
);

// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
  members: [{ type: String }],
  activeRoom: { type: String },
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

const roomSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
    required: true,
  },
  name: { type: String, required: true },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Group = mongoose.model("Group", groupSchema);
const Room = mongoose.model("Room", roomSchema);

// Middleware
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth Middleware
const requireLogin = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  const user = await User.findById(req.session.userId);
  if (!user || !user.isAdmin) {
    return res
      .status(403)
      .render("error", { message: "Admin access required" });
  }
  next();
};

// Auth Routes
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      email,
      password: hashedPassword,
    });
    await user.save();
    req.session.userId = user._id;
    res.redirect("/");
  } catch (error) {
    res.render("register", { error: "Registration failed" });
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render("login", { error: "Invalid credentials" });
    }
    req.session.userId = user._id;
    res.redirect("/");
  } catch (error) {
    res.render("login", { error: "Login failed" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Main Routes
app.get("/", requireLogin, async (req, res) => {
  try {
    const groups = await Group.find({}).populate("createdBy", "username");
    const user = await User.findById(req.session.userId);
    res.render("index", { groups, user });
  } catch (error) {
    res.status(500).render("error", { message: "Error loading groups" });
  }
});

// Group Routes
app.post("/groups", requireLogin, async (req, res) => {
  try {
    const { name, description } = req.body;
    const group = new Group({
      name,
      description,
      createdBy: req.session.userId,
      activeRoom: uuidV4(),
      admins: [req.session.userId],
    });
    await group.save();
    res.redirect("/");
  } catch (error) {
    res.status(400).send(error.message);
  }
});

app.get("/group/:groupId", requireLogin, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).populate(
      "createdBy"
    );
    const user = await User.findById(req.session.userId);
    if (!group) return res.redirect("/");

    res.render("room", {
      roomId: group.activeRoom,
      groupName: group.name,
      groupId: group._id,
      isAdmin: group.admins.includes(req.session.userId) || user.isAdmin,
      user,
    });
  } catch (error) {
    res.redirect("/");
  }
});

app.post("/groups/:groupId/delete", requireLogin, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    const user = await User.findById(req.session.userId);

    if (!group) return res.status(404).send("Group not found");
    if (!group.admins.includes(req.session.userId) && !user.isAdmin) {
      return res.status(403).send("Not authorized");
    }

    await Group.findByIdAndDelete(req.params.groupId);
    res.redirect("/");
  } catch (error) {
    res.status(500).send("Error deleting group");
  }
});

// Room Management
app.post("/groups/:groupId/rooms", requireLogin, async (req, res) => {
  try {
    const { name } = req.body;
    const room = new Room({
      groupId: req.params.groupId,
      name,
      createdBy: req.session.userId,
    });
    await room.save();
    res.redirect(`/group/${req.params.groupId}`);
  } catch (error) {
    res.status(400).send(error.message);
  }
});

// Socket.IO
io.on("connection", (socket) => {
  socket.on("join-room", async (roomId, userId, groupId) => {
    try {
      const group = await Group.findById(groupId);
      if (group && !group.members.includes(userId)) {
        group.members.push(userId);
        await group.save();
      }

      socket.join(roomId);
      socket.to(roomId).emit("user-connected", userId);
      io.to(roomId).emit("update-participants", group.members);

      socket.on("disconnect", async () => {
        socket.to(roomId).emit("user-disconnected", userId);
        if (group) {
          group.members = group.members.filter((id) => id !== userId);
          await group.save();
          io.to(roomId).emit("update-participants", group.members);
        }
      });
    } catch (error) {
      console.error("Socket error:", error);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
