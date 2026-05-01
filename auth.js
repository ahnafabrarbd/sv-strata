// SV STRATA — local-only authentication. No external services, no email,
// no SSO. Username + password live entirely in this browser's
// localStorage, hashed with SHA-256 + a per-user salt via SubtleCrypto.
//
// Two storage keys:
//   sv-strata.users    { [username]: { salt, hash, createdAt } }
//   sv-strata.session  { username, loginAt }
//
// On every page that loads this script (other than login.html) the IIFE
// auto-gates: if there's no session, the page is replaced with
// login.html?next=<original-url>. After login the user lands back where
// they started.
//
// Header injection: once the DOM is ready, find the page's <header>'s
// .actions container and append a username pill + sign-out button so the
// signed-in identity is always visible.
//
// Public surface (window.SVAuth):
//   currentUser()                -> { username, loginAt } | null
//   ensureGate()                 -> redirects to login.html if not signed in
//   signUp(username, password)   -> Promise<void>
//   signIn(username, password)   -> Promise<void>
//   signOut()                    -> clears session, redirects to login.html

(function () {
    'use strict';

    const USERS_KEY   = 'sv-strata.users';
    const SESSION_KEY = 'sv-strata.session';

    // ---------- crypto ----------
    function bytesToHex(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    function randomSalt() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return bytesToHex(bytes);
    }
    async function hashPassword(salt, password) {
        const buf = new TextEncoder().encode(salt + ':' + password);
        const digest = await crypto.subtle.digest('SHA-256', buf);
        return bytesToHex(new Uint8Array(digest));
    }

    // ---------- storage ----------
    function loadUsers() {
        try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}') || {}; }
        catch (e) { return {}; }
    }
    function saveUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }
    function loadSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            return s && s.username ? s : null;
        } catch (e) { return null; }
    }
    function saveSession(s) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    }
    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
    }

    // ---------- public API ----------
    function currentUser() { return loadSession(); }

    async function signUp(username, password) {
        username = (username || '').trim();
        if (username.length < 2) throw new Error('Username must be at least 2 characters.');
        if (!password || password.length < 4) throw new Error('Password must be at least 4 characters.');
        const users = loadUsers();
        if (users[username]) throw new Error('That username is already taken on this device.');
        const salt = randomSalt();
        const hash = await hashPassword(salt, password);
        users[username] = { salt, hash, createdAt: new Date().toISOString() };
        saveUsers(users);
        saveSession({ username, loginAt: new Date().toISOString() });
    }

    async function signIn(username, password) {
        username = (username || '').trim();
        if (!username) throw new Error('Username is required.');
        if (!password) throw new Error('Password is required.');
        const u = loadUsers()[username];
        if (!u) throw new Error('Unknown username.');
        const hash = await hashPassword(u.salt, password);
        if (hash !== u.hash) throw new Error('Wrong password.');
        saveSession({ username, loginAt: new Date().toISOString() });
    }

    function signOut() {
        clearSession();
        window.location.href = 'login.html';
    }

    function ensureGate() {
        const u = currentUser();
        if (u) return u;
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace('login.html?next=' + next);
        return null;
    }

    // ---------- header injection ----------
    function injectUserPill() {
        const u = currentUser();
        if (!u) return;
        const actions = document.querySelector('header .actions');
        if (!actions) return;

        const pill = document.createElement('span');
        pill.className = 'user-pill';
        pill.textContent = '@' + u.username;
        actions.insertBefore(pill, actions.firstChild);

        const out = document.createElement('button');
        out.className = 'user-signout';
        out.type = 'button';
        out.textContent = 'Sign out';
        out.addEventListener('click', signOut);
        actions.appendChild(out);
    }

    // ---------- auto-gate ----------
    // Skip the gate on the login page itself (otherwise it'd loop).
    const path = window.location.pathname;
    const isLoginPage = /\/login\.html$/.test(path) || path.endsWith('login.html');

    if (!isLoginPage) {
        if (!ensureGate()) return; // redirected; don't bother wiring the rest

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectUserPill);
        } else {
            injectUserPill();
        }
    }

    window.SVAuth = { currentUser, ensureGate, signUp, signIn, signOut };
})();
