import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { User, roles } from "../models/index.js";
import { writeAudit } from "../utils/audit.js";
import { isAllowedRedirect } from "../utils/origins.js";

const router = Router();
const FALLBACK_REDIRECT = "https://genzura-ububiko-bwawe.vercel.app";

const providers = {
  google: {
    label: "Google",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorization: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    profile: "https://www.googleapis.com/oauth2/v3/userinfo",
    scope: "openid email profile",
    extra: { prompt: "select_account" }
  },
  github: {
    label: "GitHub",
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    authorization: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    profile: "https://api.github.com/user",
    emails: "https://api.github.com/user/emails",
    scope: "read:user user:email",
    extra: {}
  }
};

const callbackURL = (provider, req) => {
  const base = process.env.OAUTH_CALLBACK_BASE || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/+$/, "")}/api/auth/oauth/${provider}/callback`;
};

const safeRedirectFor = (state) => (isAllowedRedirect(state?.redirect) ? state.redirect : FALLBACK_REDIRECT);

const signState = (provider, redirect) => jwt.sign(
  { provider, redirect, nonce: crypto.randomBytes(16).toString("hex") },
  process.env.JWT_SECRET,
  { expiresIn: "10m" }
);

function redirectWithError(res, redirect, message) {
  return res.redirect(`${redirect.replace(/\/+$/, "")}/#oauth_error=${encodeURIComponent(message)}`);
}

// Step 1: the frontend asks for a provider authorization URL.
router.get("/:provider/url", (req, res, next) => {
  try {
    const name = String(req.params.provider || "");
    const provider = providers[name];
    if (!provider) return res.status(404).json({ message: "Unknown OAuth provider." });
    if (!provider.clientId || !provider.clientSecret) {
      return res.status(503).json({ message: `${provider.label} sign-in is not configured yet. Ask the administrator to add its client ID and secret.` });
    }
    const redirect = String(req.query.redirect || "");
    if (!isAllowedRedirect(redirect)) {
      return res.status(400).json({ message: "That sign-in origin is not allowed." });
    }

    const url = new URL(provider.authorization);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", callbackURL(name, req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", provider.scope);
    url.searchParams.set("state", signState(name, redirect));
    Object.entries(provider.extra || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    return res.json({ url: url.toString(), available: true });
  } catch (error) {
    return next(error);
  }
});

// Step 2: the provider returns here. Exchange the code, issue a short-lived ticket and
// send the browser back to the allowed frontend origin.
router.get("/:provider/callback", async (req, res) => {
  const name = String(req.params.provider || "");
  const provider = providers[name];
  let state = null;

  try {
    if (!provider) return redirectWithError(res, FALLBACK_REDIRECT, "Unknown OAuth provider.");

    try {
      state = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET);
    } catch {
      return redirectWithError(res, FALLBACK_REDIRECT, "OAuth state is invalid or expired. Please try again.");
    }
    if (state.provider !== name) {
      return redirectWithError(res, safeRedirectFor(state), "OAuth provider mismatch.");
    }
    const redirect = safeRedirectFor(state);
    const code = String(req.query.code || "");
    if (!code) return redirectWithError(res, redirect, "The provider did not return an authorization code.");
    if (!provider.clientId || !provider.clientSecret) {
      return redirectWithError(res, redirect, `${provider.label} sign-in is not configured.`);
    }

    const tokenResponse = await fetch(provider.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackURL(name, req)
      })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    const accessToken = tokenData.access_token;
    if (!tokenResponse.ok || !accessToken) {
      return redirectWithError(res, redirect, tokenData.error_description || "Could not complete OAuth sign-in.");
    }

    const profileResponse = await fetch(provider.profile, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
    const profile = await profileResponse.json().catch(() => ({}));

    let subject = "";
    let email = "";
    let verified = false;
    let displayName = "";

    if (name === "google") {
      subject = String(profile.sub || "");
      email = String(profile.email || "").toLowerCase();
      verified = profile.email_verified === true;
      displayName = String(profile.name || email.split("@")[0] || "User");
    } else {
      subject = String(profile.id || "");
      displayName = String(profile.name || profile.login || "User");
      const emailResponse = await fetch(provider.emails, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
      const emails = await emailResponse.json().catch(() => []);
      const primary = (Array.isArray(emails) ? emails : []).find((item) => item.primary && item.verified);
      email = String(primary?.email || "").toLowerCase();
      verified = Boolean(primary?.verified);
    }

    if (!subject) return redirectWithError(res, redirect, "The OAuth profile was incomplete.");
    if (!email || !verified) {
      return redirectWithError(res, redirect, "A verified email address is required for OAuth sign-in.");
    }

    const oauthField = `oauthIds.${name}`;
    let user = await User.findOne({ [oauthField]: subject });
    if (!user) user = await User.findOne({ email });

    if (user?.blocked) {
      return redirectWithError(res, redirect, "This account is unavailable.");
    }

    let linked = false;
    if (!user) {
      if (process.env.OAUTH_ALLOW_SIGNUP !== "true") {
        return redirectWithError(res, redirect, "This account is not linked to a UBUBIKO user. Ask an administrator to add your email.");
      }
      const role = roles.includes(process.env.OAUTH_DEFAULT_ROLE) ? process.env.OAUTH_DEFAULT_ROLE : "Storekeeper";
      const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 18) || "oauthuser";
      let username = base.length >= 3 ? base : `u${base}`;
      let suffix = 0;
      while (await User.exists({ username })) {
        username = `${base.slice(0, 18 - String(++suffix).length)}${suffix}`;
      }
      try {
        user = await User.create({
          username,
          name: displayName.slice(0, 80),
          email,
          role,
          oauthIds: { [name]: subject }
        });
      } catch {
        return redirectWithError(res, redirect, "Could not create the OAuth account. Ask an administrator to check your email.");
      }
    } else {
      const updates = {};
      if (!user.oauthIds?.[name]) updates[oauthField] = subject;
      if (!user.email) updates.email = email;
      if (Object.keys(updates).length) {
        await User.findByIdAndUpdate(user._id, { $set: updates });
      }
      linked = Object.keys(updates).length > 0;
    }

    const safeUser = {
      id: user._id.toString(),
      username: user.username,
      name: user.name,
      role: user.role
    };
    const token = jwt.sign(
      { sub: safeUser.id, role: safeUser.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );
    await writeAudit(safeUser, `OAUTH_${name.toUpperCase()}_LOGIN`, linked ? `${email} (linked)` : email);

    // The ticket is short-lived; the frontend exchanges it for the JWT via POST.
    const ticket = jwt.sign({ sub: safeUser.id, token }, process.env.JWT_SECRET, { expiresIn: "60s" });
    return res.redirect(`${redirect.replace(/\/+$/, "")}/#ticket=${encodeURIComponent(ticket)}`);
  } catch (error) {
    return redirectWithError(res, safeRedirectFor(state), error.message || "OAuth sign-in failed.");
  }
});

// Step 3: frontend exchanges the one-time ticket for the application JWT.
router.post("/exchange", (req, res, next) => {
  try {
    let payload;
    try {
      payload = jwt.verify(String(req.body?.ticket || ""), process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ message: "OAuth session expired. Please try again." });
    }
    if (!payload.sub || !payload.token) {
      return res.status(400).json({ message: "Invalid OAuth session." });
    }
    return res.json({ token: payload.token });
  } catch (error) {
    return next(error);
  }
});

export default router;
