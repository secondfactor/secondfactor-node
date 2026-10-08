"use strict";

/**
 * A minimal Express app verifying a phone number with secondfactor.ai.
 *
 *   npm install express express-session secondfactor
 *   SECONDFACTOR_API_KEY=sf_... SESSION_SECRET=... node examples/express.js
 *
 * List `http://localhost:3000` as a return origin under Settings → Hosted
 * verification first. Every code sent is charged; pressing "Not your number?"
 * on the hosted page ends a session at no cost.
 *
 * The phone number would normally come from your user's account; here a form
 * asks for it so the example runs on its own.
 */

const express = require("express");
const session = require("express-session");
const { SecondFactor, SecondFactorError } = require("secondfactor");

const sf = new SecondFactor({ apiKey: process.env.SECONDFACTOR_API_KEY });
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }),
);

app.get("/", (req, res) => {
  res.send(`
    <form method="post" action="/verify">
      <input name="phone" placeholder="+9779841000001" required>
      <button>Verify with the hosted page</button>
    </form>
    <form method="post" action="/headless/start">
      <input name="phone" placeholder="+9779841000001" required>
      <button>Start a headless session</button>
    </form>`);
});

// ── Hosted ──────────────────────────────────────────────────────────────────

app.post("/verify", async (req, res, next) => {
  try {
    const created = await sf.createSession({
      to: req.body.phone,
      returnUrl: `${req.protocol}://${req.get("host")}/verified`,
    });
    // The session id stays on the server, bound to this browser's session.
    req.session.sfSid = created.sid;
    res.redirect(303, created.url);
  } catch (error) {
    if (error instanceof SecondFactorError) return res.status(400).send(`Could not start (${error.code}).`);
    next(error);
  }
});

app.get("/verified", async (req, res, next) => {
  const storedSid = req.session.sfSid;
  delete req.session.sfSid;
  if (!storedSid) return res.status(400).send("No verification in progress.");
  try {
    // The stored id, never req.query.sf_session_id.
    const { phone } = await sf.verifySession(storedSid, req.query.sf_return_token);
    res.send(`Verified ${phone}.`);
  } catch (error) {
    if (error instanceof SecondFactorError) {
      return res.status(400).send(`Not verified (${error.code}). <a href="/">Try again</a>`);
    }
    next(error);
  }
});

// ── Headless ────────────────────────────────────────────────────────────────

app.post("/headless/start", async (req, res, next) => {
  try {
    const created = await sf.createSession({ to: req.body.phone, mode: "headless" });
    req.session.sfSid = created.sid;
    // Your frontend passes this token to @secondfactor/js's withSession().
    res.json({ clientToken: created.client_token });
  } catch (error) {
    next(error);
  }
});

app.post("/headless/done", async (req, res, next) => {
  const storedSid = req.session.sfSid;
  delete req.session.sfSid;
  if (!storedSid) return res.status(400).json({ verified: false });
  try {
    const { phone } = await sf.verifySession(storedSid);
    res.json({ verified: true, phone });
  } catch (error) {
    if (error instanceof SecondFactorError) return res.status(400).json({ verified: false, reason: error.code });
    next(error);
  }
});

app.listen(3000, () => console.log("http://localhost:3000"));
