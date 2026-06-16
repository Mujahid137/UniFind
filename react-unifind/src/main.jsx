import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
import { HashRouter, Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Bell, Boxes, Calendar, Check, CheckCircle, ClipboardCheck, ClipboardList, Clock, ExternalLink, Eye, EyeOff, FileText, ListFilter, LogOut, Mail, MapPin, Moon, Search, Settings, Shield, ShieldCheck, Sparkles, Sun, Upload, User, UserCheck, Users, X, Zap,
} from "lucide-react";
import { useAppStore } from "./store";
import "./styles.css";

const categoryOptions = ["Accessories", "Electronics", "Documents", "Bags", "Clothing", "Keys", "Other"];
const locationOptions = ["Main Library", "Student Center", "Recreation Center", "Science Hall", "Business Building", "Engineering Block", "Parking Lot C"];
const claimStatuses = ["submitted", "under-review", "approved", "rejected", "returned"];
const statusOptions = ["All Statuses", "reported", "returned"];
const sortOptions = ["Newest", "Oldest", "Title A-Z"];
const UIU_DOMAIN = "uiu.ac.bd";
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api/mysql";
const SESSION_TOKEN_KEY = "unifind-mysql-token";
const defaultBrowseFilters = {
  lost: { query: "", category: "All Categories", location: "All Locations", status: "All Statuses", sort: "Newest" },
  found: { query: "", category: "All Categories", location: "All Locations", status: "All Statuses", sort: "Newest" },
};
const adminMenuSections = [
  { key: "dashboard", label: "Dashboard", icon: Boxes },
  { key: "lost", label: "Manage Lost Items", icon: ClipboardList },
  { key: "found", label: "Manage Found Items", icon: CheckCircle },
  { key: "categories", label: "Item Categories", icon: ListFilter },
  { key: "users", label: "User Management", icon: Users },
  { key: "claims", label: "Claims Management", icon: ClipboardCheck },
  { key: "messages", label: "Messages", icon: Mail },
  { key: "complaints", label: "Reports & Complaints", icon: Shield },
  { key: "locations", label: "Location Management", icon: MapPin },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "search", label: "Search & Filter", icon: Search },
  { key: "matching", label: "Matching System", icon: Zap },
  { key: "status", label: "Status Management", icon: Settings },
  { key: "analytics", label: "Reports / Analytics", icon: FileText },
  { key: "settings", label: "Settings", icon: ShieldCheck },
];
const adminItemStatuses = ["reported", "pending", "approved", "claimed", "returned", "rejected", "expired"];

function getSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY) || "";
}

function setSessionToken(token = "") {
  if (!token) return;
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

async function requestMysql(path, options = {}) {
  const token = getSessionToken();
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not complete database request.");
  return data;
}

function isUiuEmail(value) {
  return value.trim().toLowerCase().includes(UIU_DOMAIN);
}

function isAdminSession(user) {
  return user?.role === "Admin";
}

function accountLabel(user) {
  return isAdminSession(user) ? "Administrator" : user.email;
}

function safeEmail(email) {
  return email;
}

function isAdminAlert(notification = {}) {
  return notification.audience === "admin" || notification.source === "admin-review" || notification.type === "alert";
}

function notificationAudienceForUser(user) {
  return isAdminSession(user) ? "admin" : "user";
}

function visibleNotificationsForUser(notifications = [], user) {
  return notifications.filter((notification) => (
    isAdminSession(user) ? isAdminAlert(notification) : !isAdminAlert(notification)
  ));
}

function isApprovedClaimStatus(status) {
  return ["approved", "returned"].includes(status);
}

function canViewItemDetails(item, user, claims = []) {
  if (!item || item.kind !== "lost") return true;
  if (isAdminSession(user)) return true;
  if (item.email && user?.email && item.email === user.email) return true;
  return claims.some((claim) => (
    String(claim.itemId) === String(item.id) &&
    claim.submittedBy === user?.email &&
    isApprovedClaimStatus(claim.status)
  ));
}

function itemDetailsLocked(item, user, claims = []) {
  return item?.kind === "lost" && !canViewItemDetails(item, user, claims);
}

function pathSegment(pathname, index) {
  return pathname.split("/").filter(Boolean)[index] || "";
}

function App() {
  return (
    <HashRouter>
      <MysqlSessionSync />
      <MysqlItemsSync />
      <MysqlWorkflowSync />
      <RouterView />
    </HashRouter>
  );
}

function MysqlSessionSync() {
  const loginWithUser = useAppStore((s) => s.loginWithUser);
  const logout = useAppStore((s) => s.logout);

  useEffect(() => {
    let cancelled = false;
    const token = getSessionToken();
    if (!token) return undefined;

    requestMysql("/auth/me")
      .then((data) => {
        if (!cancelled && data.user) loginWithUser(data.user);
      })
      .catch(() => {
        clearSessionToken();
        if (!cancelled) logout();
      });

    return () => {
      cancelled = true;
    };
  }, [loginWithUser, logout]);

  return null;
}

function MysqlItemsSync() {
  const replaceItems = useAppStore((s) => s.replaceItems);

  useEffect(() => {
    let cancelled = false;
    requestMysql("/items")
      .then((data) => {
        if (!cancelled) replaceItems(data.items || []);
      })
      .catch(() => {
        // The app can still run from local state if the backend is not open yet.
      });
    return () => {
      cancelled = true;
    };
  }, [replaceItems]);

  return null;
}

function MysqlWorkflowSync() {
  const user = useAppStore((s) => s.user);
  const replaceClaims = useAppStore((s) => s.replaceClaims);
  const replaceMessages = useAppStore((s) => s.replaceMessages);
  const replaceComplaints = useAppStore((s) => s.replaceComplaints);

  useEffect(() => {
    let cancelled = false;
    const token = getSessionToken();

    if (!user || !token) {
      replaceClaims([]);
      replaceMessages([]);
      replaceComplaints([]);
      return undefined;
    }

    const claimPath = isAdminSession(user) ? "/admin/claims" : "/claims/my";
    const messageRequest = isAdminSession(user) ? requestMysql("/admin/messages") : Promise.resolve({ messages: [] });
    const reportRequest = isAdminSession(user) ? requestMysql("/admin/reports") : Promise.resolve({ reports: [] });

    Promise.all([requestMysql(claimPath), messageRequest, reportRequest])
      .then(([claimData, messageData, reportData]) => {
        if (cancelled) return;
        replaceClaims(claimData.claims || []);
        replaceMessages(messageData.messages || []);
        replaceComplaints(reportData.reports || []);
      })
      .catch(() => {
        if (cancelled) return;
        replaceClaims([]);
        replaceMessages([]);
        replaceComplaints([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user, replaceClaims, replaceMessages, replaceComplaints]);

  return null;
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem("unifind-theme") || "light");
  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("unifind-theme", theme);
  }, [theme]);

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <span className="theme-toggle-track">
        <span className="theme-toggle-thumb">{isDark ? <Moon size={15} /> : <Sun size={15} />}</span>
      </span>
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}

function RouterView() {
  const location = useLocation();
  const { pathname: path } = location;
  let element = <Navigate to="/" replace />;
  if (path === "/") element = <HomePage />;
  else if (path === "/login") element = <LoginPage />;
  else if (path === "/signup") element = <SignUpPage />;
  else if (path === "/dashboard") element = <Protected><DashboardPage /></Protected>;
  else if (path.startsWith("/report/")) element = <Protected><ReportPage /></Protected>;
  else if (path.startsWith("/browse/")) element = <Protected><BrowsePage /></Protected>;
  else if (path.startsWith("/items/")) element = <Protected><ItemPage /></Protected>;
  else if (path === "/matches") element = <Protected><MatchesPage /></Protected>;
  else if (path === "/claims") element = <Protected><ClaimsPage /></Protected>;
  else if (path === "/admin") element = <AdminPage />;
  else if (path === "/profile") element = <Protected><ProfilePage /></Protected>;
  else if (path === "/notifications") element = <Protected><NotificationsPage /></Protected>;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={path}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
      >
        {element}
      </motion.div>
    </AnimatePresence>
  );
}

function Protected({ children }) {
  const user = useAppStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function HomePage() {
  return (
    <main className="shell home-shell clean-home">
      <section className="home-nav">
        <div className="brand"><Boxes size={20} /> UniFind</div>
        <div className="home-nav-actions">
          <ThemeToggle />
          <Link className="btn btn-light small" to="/login">Sign In</Link>
          <Link className="btn btn-dark small" to="/signup">Sign Up</Link>
          <Link className="btn btn-light small" to="/admin"><Settings size={13} /> Admin Panel</Link>
          <GuestStart className="btn btn-light small" />
        </div>
      </section>

      <motion.section id="hero" className="home-hero hero-premium" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="logo-circle"><Boxes size={30} /></div>
        <h1>Campus Lost &amp; Found</h1>
        <p>A modern matching system that helps students report, discover, and recover items with speed and trust.</p>
        <div className="home-actions">
          <MagneticLink className="btn btn-dark" to="/login">Get Started</MagneticLink>
          <MagneticLink className="btn btn-light" to="/signup">Create Account</MagneticLink>
          <MagneticLink className="btn btn-light" to="/admin">Admin Portal</MagneticLink>
          <GuestStart />
        </div>
        <div className="proof-row">
          <span>2,500+ Reports</span>
          <span>93% Recovery Rate</span>
          <span>7 Campus Zones</span>
        </div>
      </motion.section>

      <FeatureBlocks />
      <HowItWorks />
    </main>
  );
}

function GuestStart({ className = "btn btn-light" }) {
  const login = useAppStore((s) => s.login);
  const nav = useNavigate();
  return <button className={className} type="button" onClick={() => { login("guest"); nav("/dashboard"); }}>Login as Guest</button>;
}

function PasswordInput({ value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="input-wrap password-wrap">
      <Shield size={16} />
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        className="password-toggle"
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((current) => !current)}
      >
        <Icon size={16} />
      </button>
    </div>
  );
}

function LoginPage() {
  const loginWithUser = useAppStore((s) => s.loginWithUser);
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const strength = passwordStrength(password);

  async function submitLogin() {
    if (!isUiuEmail(email)) {
      setError("Use an email that contains uiu.ac.bd.");
      return;
    }
    if (password.trim().length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const data = await requestMysql("/auth/signin", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setSessionToken(data.token);
      loginWithUser(data.user);
      nav("/dashboard");
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell shell-center">
      <section className="auth-head">
        <div className="logo-circle"><Boxes size={30} /></div>
        <h1>Lost &amp; Found</h1>
        <p>Sign in with your UIU account</p>
      </section>
      <section className="card auth-card">
        <h2>Sign In</h2>
        <p className="subtle">Use an email that contains uiu.ac.bd</p>
        <div className="field"><label>UIU Email *</label><div className="input-wrap"><Mail size={16} /><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@uiu.ac.bd" /></div></div>
        <div className="field"><label>Password *</label><PasswordInput value={password} onChange={setPassword} placeholder="Enter password" /></div>
        <div className="strength-wrap"><div className={`strength-fill ${strength.tone}`} style={{ width: `${strength.score}%` }} /><span>{strength.label}</span></div>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn btn-dark" type="button" onClick={submitLogin} disabled={submitting}>{submitting ? "Signing In..." : "Sign In"}</button>
        <div className="separator"><span>Or</span></div>
        <GuestStart />
        <Link className="link" to="/signup">Don&apos;t have an account? Sign up</Link>
        <Link className="ghost-link" to="/">Back to Home</Link>
      </section>
    </main>
  );
}

function SignUpPage() {
  const loginWithUser = useAppStore((s) => s.loginWithUser);
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const strength = passwordStrength(form.password);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitSignUp() {
    if (form.name.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    if (!isUiuEmail(form.email)) {
      setError("Sign up requires an email that contains uiu.ac.bd.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const data = await requestMysql("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), password: form.password }),
      });
      setSessionToken(data.token);
      loginWithUser(data.user);
      nav("/dashboard");
    } catch (err) {
      setError(`${err.message} Make sure the backend is running with npm.cmd run server.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell shell-center">
      <section className="auth-head">
        <div className="logo-circle"><Boxes size={30} /></div>
        <h1>Create UIU Account</h1>
        <p>Join UniFind with your campus email</p>
      </section>
      <section className="card auth-card">
        <h2>Sign Up</h2>
        <p className="subtle">Register using an email that contains uiu.ac.bd</p>
        <div className="field"><label>Full Name *</label><div className="input-wrap"><User size={16} /><input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Your full name" /></div></div>
        <div className="field"><label>UIU Email *</label><div className="input-wrap"><Mail size={16} /><input value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="example@uiu.ac.bd" /></div></div>
        <div className="field"><label>Password *</label><div className="input-wrap"><Shield size={16} /><input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} placeholder="Set password" /></div></div>
        <div className="strength-wrap"><div className={`strength-fill ${strength.tone}`} style={{ width: `${strength.score}%` }} /><span>{strength.label}</span></div>
        <div className="field"><label>Confirm Password *</label><div className="input-wrap"><Shield size={16} /><input type="password" value={form.confirm} onChange={(e) => update("confirm", e.target.value)} placeholder="Confirm password" /></div></div>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn btn-dark" type="button" onClick={submitSignUp} disabled={submitting}>{submitting ? "Creating..." : "Create Account"}</button>
        <Link className="link" to="/login">Already have an account? Sign in</Link>
        <Link className="ghost-link" to="/">Back to Home</Link>
      </section>
      <section className="banner"><strong>UIU Policy:</strong> Access requires an email containing `uiu.ac.bd`.</section>
    </main>
  );
}

function AppHeader({ active = "dashboard" }) {
  const { user, notifications, logout } = useAppStore();
  const nav = useNavigate();
  const visibleNotifications = visibleNotificationsForUser(notifications, user);
  const unread = visibleNotifications.filter((notification) => !notification.read).length;
  const noticeLabel = isAdminSession(user) ? "Alerts" : "Notifications";
  const handleLogout = () => {
    clearSessionToken();
    logout();
    nav("/");
  };
  const links = [
    { key: "dashboard", label: "Dashboard", to: "/dashboard", icon: <Boxes size={14} /> },
    { key: "claims", label: "Claims", to: "/claims", icon: <ClipboardCheck size={14} /> },
    { key: "notifications", label: noticeLabel, to: "/notifications", icon: <Bell size={14} />, badge: unread },
    { key: "profile", label: "Profile", to: "/profile", icon: <User size={14} /> },
  ];

  if (isAdminSession(user)) {
    links.splice(2, 0, { key: "admin", label: "Admin", to: "/admin", icon: <Settings size={14} /> });
  }

  return (
    <header className="topbar app-header">
      <Link className="brand" to="/dashboard"><Boxes size={22} /> Lost &amp; Found</Link>
      <nav className="app-nav">
        {links.map((link) => (
          <Link className={`nav-pill ${active === link.key ? "active" : ""}`} to={link.to} key={link.key}>
            {link.icon}
            <span>{link.label}</span>
            {link.badge ? <b>{link.badge}</b> : null}
          </Link>
        ))}
      </nav>
      <div className="top-actions">
        <ThemeToggle />
        <div className="user-chip"><User size={14} /><div><div className="name-row">{user.name} <span>{user.role}</span></div><small>{accountLabel(user)}</small></div></div>
        <button type="button" className="btn btn-light small" onClick={handleLogout}><LogOut size={14} /> Logout</button>
      </div>
    </header>
  );
}

function DashboardPage() {
  const { user, items, matches, notifications, claims } = useAppStore();
  const visibleNotifications = visibleNotificationsForUser(notifications, user);
  const noticeLabel = isAdminSession(user) ? "Admin Alerts" : "Notifications";
  const lostCount = items.filter((x) => x.kind === "lost").length;
  const foundCount = items.filter((x) => x.kind === "found").length;
  const myClaims = claims.filter((claim) => claim.submittedBy === user.email);
  const pendingClaims = claims.filter((claim) => ["submitted", "under-review"].includes(claim.status)).length;
  const myReports = items.filter((item) => item.email === user.email);
  const returnedCount = items.filter((item) => item.status === "returned").length;
  const unreadNotices = visibleNotifications.filter((notification) => !notification.read).length;
  const recoveryRate = items.length ? Math.round((returnedCount / items.length) * 100) : 0;
  const recentItems = [...items]
    .sort((a, b) => reportTimeValue(b) - reportTimeValue(a))
    .slice(0, 4);
  const topMatch = matches[0];
  const matchedLost = topMatch ? items.find((item) => item.id === topMatch.lostId) : null;
  const matchedFound = topMatch ? items.find((item) => item.id === topMatch.foundId) : null;
  return (
    <main className="shell dashboard-shell">
      <AppHeader active="dashboard" />
      <section className="welcome dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="eyebrow"><Sparkles size={14} /> UIU Recovery Workspace</span>
          <h1>Welcome back, {user.role === "Guest" ? "Guest" : user.name.split(" ")[0]}.</h1>
          <p>Track reports, review matches, and move lost items back to their owners from one organized dashboard.</p>
        </div>
        <div className="dashboard-focus-card">
          <span>Today&apos;s Focus</span>
          <strong>{matches.length ? `${matches.length} active match${matches.length === 1 ? "" : "es"}` : "No active matches"}</strong>
          <p>{topMatch && matchedLost && matchedFound ? `${matchedLost.title} may match ${matchedFound.title}.` : "New reports will appear here when UniFind finds a strong connection."}</p>
          <Link className="ghost-link inline-link" to="/matches">Open matches <ExternalLink size={13} /></Link>
        </div>
      </section>
      <section className="stats-grid dashboard-stats">
        <StatCard label="Lost Reports" value={lostCount} icon={<ClipboardList size={18} />} />
        <StatCard label="Found Reports" value={foundCount} icon={<CheckCircle size={18} />} />
        <StatCard label="Active Matches" value={matches.length} badge={matches.length ? "New" : ""} icon={<Zap size={18} />} />
        <StatCard label="Recovery Rate" value={`${recoveryRate}%`} icon={<ShieldCheck size={18} />} />
        <StatCard label="My Claims" value={myClaims.length} icon={<ClipboardCheck size={18} />} />
        <StatCard label={isAdminSession(user) ? "Unread Alerts" : "Notifications"} value={unreadNotices} icon={<Bell size={18} />} />
      </section>

      <section className="dashboard-workspace">
        <section className="action-grid report-actions">
          <ActionCard color="red" title="Report Lost Item" text="Add item details, location, date, photo, and contact info so the system can search for matches." button="Start Lost Report" link="/report/lost" icon={<Upload size={22} />} />
          <ActionCard color="green" title="Report Found Item" text="Submit a found item safely and let verified claimants prove ownership before pickup." button="Start Found Report" link="/report/found" icon={<Check size={22} />} />
        </section>
        <section className="dashboard-insights-grid">
          <section className="card dashboard-command-card">
            <div className="section-heading compact-heading">
              <h3>Quick Actions</h3>
              <Sparkles size={16} />
            </div>
            <Link className="command-row" to="/matches"><Bell size={15} /><span>Potential Matches</span><b>{matches.length}</b></Link>
            <Link className="command-row" to="/claims"><ClipboardCheck size={15} /><span>My Claims</span><b>{myClaims.length}</b></Link>
            <Link className="command-row" to="/notifications"><Bell size={15} /><span>{noticeLabel}</span><b>{unreadNotices}</b></Link>
            {isAdminSession(user) ? <Link className="command-row" to="/admin"><Settings size={15} /><span>Review Center</span><b>{pendingClaims}</b></Link> : null}
          </section>
          <section className="card recent-card">
            <div className="section-heading compact-heading">
              <h3>Recent Reports</h3>
              <Link className="ghost-link inline-link" to="/browse/lost">View all</Link>
            </div>
            <div className="recent-list">
              {recentItems.map((item) => (
                <Link className="recent-row" to={`/items/${item.id}`} key={item.id}>
                  <span className={`status-dot ${item.kind}`} />
                  <div>
                    <strong>{item.title}</strong>
                    {canViewItemDetails(item, user, claims) ? <small>{item.category} - {formatDate(item.createdAt || item.date)}</small> : null}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </section>
        <section className="browse-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow"><ListFilter size={14} /> Browse Center</span>
              <h2>Find the right report faster</h2>
            </div>
            <p>Switch between lost and found lists, use filters, then open the item detail page to claim or verify.</p>
          </div>
          <div className="action-grid compact browse-grid">
            <ActionCard color="red" title="Browse Lost Items" text="Review items reported as missing by UIU students." button={`View Lost Items (${lostCount})`} link="/browse/lost" outline icon={<Search size={22} />} />
            <ActionCard color="green" title="Browse Found Items" text="Scan found reports that may already be waiting for an owner." button={`View Found Items (${foundCount})`} link="/browse/found" outline icon={<Eye size={22} />} />
          </div>
        </section>
      </section>
    </main>
  );
}

function ReportPage() {
  const location = useLocation();
  const kind = pathSegment(location.pathname, 1);
  const addItem = useAppStore((s) => s.addItem);
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const categories = useAppStore((s) => s.categories);
  const locations = useAppStore((s) => s.locations);
  const nav = useNavigate();
  const isLost = kind !== "found";
  const [form, setForm] = useState({
    category: "",
    title: "",
    description: "",
    color: "",
    location: "",
    date: new Date().toISOString().slice(0, 10),
    map: "",
    photo: "",
    reporter: user?.name || "John Doe",
    email: user?.email || "john@example.com",
    phone: profile?.phone || "",
    uiuId: profile?.uiuId || "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update("photo", reader.result);
    reader.readAsDataURL(file);
  }

  async function submitReport(event) {
    event.preventDefault();
    const required = ["category", "title", "description", "location", "date", "reporter", "email"];
    const missing = required.some((key) => !String(form[key] || "").trim());
    if (missing) {
      setError("Complete all required fields before submitting.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const data = await requestMysql("/items", {
        method: "POST",
        body: JSON.stringify({ ...form, kind: isLost ? "lost" : "found" }),
      });
      const item = addItem(data.item);
      nav(`/items/${item.id}`, { state: { submittedItem: item } });
    } catch (err) {
      setError(`${err.message} Make sure XAMPP MySQL is running and start the backend with npm.cmd run server.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <Link className="ghost-link left" to="/dashboard"><ArrowLeft size={14} /> Back to Dashboard</Link>
      <section className="card form-card">
        <h1>{isLost ? "Report Lost Item" : "Report Found Item"}</h1>
        <p className="subtle">Fill in the details below to help us {isLost ? "find your item" : "return this item to its owner"}</p>
        <form className="report-form" onSubmit={submitReport}>
          <LabeledSelect label="Category *" value={form.category} onChange={(v) => update("category", v)} options={categories || categoryOptions} />
          <LabeledInput label="Item Title *" value={form.title} onChange={(v) => update("title", v)} placeholder="e.g., Black iPhone 13 Pro" />
          <LabeledTextarea label="Description *" value={form.description} onChange={(v) => update("description", v)} placeholder="Provide detailed description including brand, model, distinctive features..." />
          <LabeledInput label="Color (Optional)" value={form.color} onChange={(v) => update("color", v)} placeholder="e.g., Black, Blue, Red" />
          <LabeledSelect label="Location *" value={form.location} onChange={(v) => update("location", v)} options={locations || locationOptions} />
          <LabeledInput label={`Date ${isLost ? "Lost" : "Found"} *`} type="date" value={form.date} onChange={(v) => update("date", v)} />
          <LabeledInput label="Google Maps Link (Optional)" value={form.map} onChange={(v) => update("map", v)} placeholder="https://maps.app.goo.gl/..." />
          <small className="hint">Share the exact location where the item was {isLost ? "lost" : "found"}</small>
          {form.map ? (
            <a className="map-preview" href={form.map} target="_blank" rel="noreferrer">
              <MapPin size={14} /> Preview Location Link <ExternalLink size={13} />
            </a>
          ) : null}
          <label className="upload">
            <span>Photo (Optional)</span>
            <input className="visually-hidden" type="file" accept="image/*" onChange={handlePhotoChange} />
            <div className={form.photo ? "upload-preview" : ""}>
              {form.photo ? <img src={form.photo} alt="Item preview" /> : <Upload size={32} />}
              <b>{form.photo ? "Photo ready" : "Click to upload a photo"}</b>
              <small>PNG, JPG up to 10MB</small>
            </div>
          </label>
          <h3>Your Contact Information</h3>
          <LabeledInput label="Your Name *" value={form.reporter} onChange={(v) => update("reporter", v)} />
          <LabeledInput label="Your Email *" value={form.email} onChange={(v) => update("email", v)} />
          <LabeledInput label="UIU ID (Optional)" value={form.uiuId} onChange={(v) => update("uiuId", v)} placeholder="e.g., 011223004" />
          <LabeledInput label="Your Phone (Optional)" value={form.phone} onChange={(v) => update("phone", v)} />
          {error ? <p className="form-error">{error}</p> : null}
          <button className={`btn ${isLost ? "btn-red" : "btn-dark"}`} type="submit" disabled={submitting}>{submitting ? "Saving..." : `Submit ${isLost ? "Lost" : "Found"} Report`}</button>
        </form>
      </section>
    </main>
  );
}

function BrowsePage() {
  const routeLocation = useLocation();
  const kind = pathSegment(routeLocation.pathname, 1);
  const user = useAppStore((s) => s.user);
  const items = useAppStore((s) => s.items);
  const claims = useAppStore((s) => s.claims);
  const categories = useAppStore((s) => s.categories);
  const locations = useAppStore((s) => s.locations);
  const savedFilters = useAppStore((s) => s.savedFilters);
  const saveFilter = useAppStore((s) => s.saveFilter);
  const filteredKind = kind === "found" ? "found" : "lost";
  const initial = { ...defaultBrowseFilters[filteredKind], ...(savedFilters?.[filteredKind] || {}) };
  const [query, setQuery] = useState(initial.query);
  const [category, setCategory] = useState(initial.category);
  const [location, setLocation] = useState(initial.location);
  const [status, setStatus] = useState(initial.status);
  const [sort, setSort] = useState(initial.sort);
  const [selectedItem, setSelectedItem] = useState(null);
  const restrictedLostBrowse = filteredKind === "lost" && !isAdminSession(user);
  const list = useMemo(() => (items || []).filter((i) => i.kind === filteredKind), [items, filteredKind]);
  const filtered = useMemo(() => list.filter((item) => {
    const q = query.toLowerCase();
    const searchableFields = restrictedLostBrowse ? [item.title] : [item.title, item.description, item.location, item.reporter, item.color];
    const queryMatch = searchableFields
      .some((value) => String(value || "").toLowerCase().includes(q));
    const categoryMatch = restrictedLostBrowse || category === "All Categories" || item.category === category;
    const locationMatch = restrictedLostBrowse || location === "All Locations" || item.location === location;
    const statusMatch = restrictedLostBrowse || status === "All Statuses" || item.status === status;
    return queryMatch && categoryMatch && locationMatch && statusMatch;
  }).sort((a, b) => {
    if (sort === "Title A-Z") return a.title.localeCompare(b.title);
    if (sort === "Oldest") return reportTimeValue(a) - reportTimeValue(b);
    return reportTimeValue(b) - reportTimeValue(a);
  }), [list, query, category, location, status, sort, restrictedLostBrowse]);
  const resetFilters = () => {
    setQuery("");
    setCategory("All Categories");
    setLocation("All Locations");
    setStatus("All Statuses");
    setSort("Newest");
  };
  return (
    <main className="shell">
      <Link className="ghost-link left" to="/dashboard"><ArrowLeft size={14} /> Back to Dashboard</Link>
      <section className="list-head"><h1>{filteredKind === "lost" ? "Lost Items" : "Found Items"}</h1><p>Browse all {filteredKind} items reported by students</p></section>
      <section className="card filter-card">
        <h3><ListFilter size={16} /> Filter Items</h3>
        <div className="filter-row">
          <div className="field"><label>Search</label><div className="input-wrap"><Search size={14} /><input placeholder={restrictedLostBrowse ? "Search by item name..." : "Search by title, description, or location..."} value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
          {!restrictedLostBrowse ? <div className="field"><label>Category</label><select value={category} onChange={(e) => setCategory(e.target.value)}><option>All Categories</option>{(categories || categoryOptions).map((opt) => <option key={opt}>{opt}</option>)}</select></div> : null}
          {!restrictedLostBrowse ? <div className="field"><label>Location</label><select value={location} onChange={(e) => setLocation(e.target.value)}><option>All Locations</option>{(locations || locationOptions).map((opt) => <option key={opt}>{opt}</option>)}</select></div> : null}
          {!restrictedLostBrowse ? <div className="field"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}>{statusOptions.map((opt) => <option key={opt}>{opt}</option>)}</select></div> : null}
          <div className="field"><label>Sort</label><select value={sort} onChange={(e) => setSort(e.target.value)}>{sortOptions.map((opt) => <option key={opt}>{opt}</option>)}</select></div>
        </div>
        {restrictedLostBrowse ? <p className="privacy-note">Lost-item details are hidden until an admin approves a submitted claim.</p> : null}
        <div className="home-actions filters-actions">
          <button type="button" className="btn btn-light small" onClick={() => saveFilter(filteredKind, { query, category, location, status, sort })}>Save Filter</button>
          <button type="button" className="btn btn-light small" onClick={resetFilters}>Reset</button>
        </div>
      </section>
      <p className="showing">Showing {filtered.length} {filteredKind} items</p>
      <section className="items-grid">{filtered.map((item) => <ItemCard key={item.id} item={item} kind={filteredKind} detailsVisible={canViewItemDetails(item, user, claims)} onClick={() => setSelectedItem(item)} />)}</section>
      {selectedItem ? <ItemDetailsModal item={selectedItem} kind={filteredKind} onClose={() => setSelectedItem(null)} /> : null}
    </main>
  );
}

function ItemPage() {
  const location = useLocation();
  const id = pathSegment(location.pathname, 1);
  const user = useAppStore((s) => s.user);
  const items = useAppStore((s) => s.items);
  const claims = useAppStore((s) => s.claims);
  const submittedItem = location.state?.submittedItem;
  const item = items.find((entry) => String(entry.id) === String(id)) ||
    (String(submittedItem?.id) === String(id) ? submittedItem : null);
  const itemClaims = claims.filter((claim) => String(claim.itemId) === String(id));
  const detailsVisible = canViewItemDetails(item, user, claims);

  if (!item) {
    return (
      <main className="shell dashboard-shell">
        <AppHeader active="dashboard" />
        <section className="card empty-state">
          <Boxes size={34} />
          <h1>Item not found</h1>
          <p>This item may have been removed or returned.</p>
          <Link className="btn btn-dark" to="/dashboard">Back to Dashboard</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shell detail-shell">
      <AppHeader active="dashboard" />
      <Link className="ghost-link left" to={`/browse/${item.kind}`}><ArrowLeft size={14} /> Back to {item.kind === "lost" ? "Lost" : "Found"} Items</Link>
      <section className={`item-detail-grid ${detailsVisible ? "" : "protected-detail-grid"}`}>
        <article className="card detail-main">
          <div className={item.photo ? "detail-photo has-photo" : "detail-photo"}>
            {item.photo ? <img src={item.photo} alt={item.title} /> : <Boxes size={58} />}
          </div>
          <h1>{item.title}</h1>
          {detailsVisible ? (
            <>
              <div className="meta-row">
                <span className={`pill ${item.kind}`}>{item.kind === "lost" ? "Lost" : "Found"}</span>
                <span className={`status-pill ${item.status}`}>{prettyStatus(item.status)}</span>
              </div>
              <p className="desc detail-desc">{item.description}</p>
              <div className="detail-grid">
                <DetailRow label="Category" value={item.category} icon={<ClipboardList size={14} />} />
                <DetailRow label="Color" value={item.color || "Not specified"} icon={<span className="dot" style={{ background: colorFromName(item.color) }} />} />
                <DetailRow label="Location" value={item.location} icon={<MapPin size={14} />} />
                <DetailRow label="Date" value={item.date} icon={<Calendar size={14} />} />
              </div>
              {item.map ? (
                <a className="map-preview" href={item.map} target="_blank" rel="noreferrer">
                  <MapPin size={14} /> Open Map Link <ExternalLink size={13} />
                </a>
              ) : null}
              <div className="divider" />
              <ReporterBlock item={item} />
            </>
          ) : <ProtectedDetailsNotice />}
          <ClaimWorkflow item={item} kind={item.kind} detailsVisible={detailsVisible} />
        </article>
        {detailsVisible ? <aside className="card detail-side">
          <h3>Recovery Details</h3>
          <DetailRow label="Report ID" value={`#${item.id}`} icon={<FileText size={14} />} />
          <DetailRow label="Created" value={formatDate(item.createdAt || item.date)} icon={<Clock size={14} />} />
          <DetailRow label="Claims" value={`${itemClaims.length} submitted`} icon={<ClipboardCheck size={14} />} />
          <div className="divider" />
          <h3>Claim Activity</h3>
          {itemClaims.length ? itemClaims.slice(0, 4).map((claim) => (
            <div className="activity-row" key={claim.id}>
              <StatusBadge status={claim.status} />
              <strong>{claim.name}</strong>
              <small>{formatDate(claim.createdAt)}</small>
            </div>
          )) : <p className="showing">No claims have been submitted yet.</p>}
        </aside> : null}
      </section>
    </main>
  );
}

function ClaimsPage() {
  const { user, claims, items } = useAppStore();
  const [scope, setScope] = useState("mine");
  const [status, setStatus] = useState("All Statuses");
  const myReportIds = new Set(items.filter((item) => item.email === user.email).map((item) => item.id));
  const visibleClaims = claims.filter((claim) => {
    const scopeMatch = scope === "mine"
      ? claim.submittedBy === user.email
      : scope === "reports"
        ? myReportIds.has(claim.itemId)
        : isAdminSession(user);
    const statusMatch = status === "All Statuses" || claim.status === status;
    return scopeMatch && statusMatch;
  });

  return (
    <main className="shell dashboard-shell">
      <AppHeader active="claims" />
      <section className="list-head"><h1>Claim Center</h1><p>Track ownership requests, verification progress, and return status.</p></section>
      <section className="card filter-card claim-toolbar">
        <div className="segmented">
          <button className={scope === "mine" ? "active" : ""} type="button" onClick={() => setScope("mine")}>My Claims</button>
          <button className={scope === "reports" ? "active" : ""} type="button" onClick={() => setScope("reports")}>On My Reports</button>
          {isAdminSession(user) ? <button className={scope === "all" ? "active" : ""} type="button" onClick={() => setScope("all")}>All Claims</button> : null}
        </div>
        <div className="field compact-field">
          <label>Status</label>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>All Statuses</option>
            {claimStatuses.map((entry) => <option key={entry} value={entry}>{prettyStatus(entry)}</option>)}
          </select>
        </div>
      </section>
      <section className="claim-list">
        {visibleClaims.length ? visibleClaims.map((claim) => (
          <ClaimCard key={claim.id} claim={claim} item={items.find((item) => item.id === claim.itemId)} showReview={isAdminSession(user)} />
        )) : <EmptyState title="No claims here yet" text="Submitted claims and claims on your reports will appear in this workspace." />}
      </section>
    </main>
  );
}

function AdminPage() {
  const { user, claims, items, loginWithUser, logout } = useAppStore();
  const [status, setStatus] = useState("submitted");
  const [activeSection, setActiveSection] = useState("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [adminStats, setAdminStats] = useState(null);
  const pendingCount = adminStats?.openClaims ?? claims.filter((claim) => ["submitted", "under-review"].includes(claim.status)).length;
  const returnedCount = adminStats?.resolvedCases ?? items.filter((item) => item.status === "returned").length;
  const openReports = adminStats
    ? (Number(adminStats.totalLostItems || 0) + Number(adminStats.totalFoundItems || 0) - Number(adminStats.resolvedCases || 0))
    : items.filter((item) => item.status !== "returned").length;
  const recentAdminReports = adminStats?.recentReports?.length
    ? adminStats.recentReports.slice(0, 4)
    : [...items].sort((a, b) => reportTimeValue(b) - reportTimeValue(a)).slice(0, 4);
  const activeMeta = adminMenuSections.find((section) => section.key === activeSection) || adminMenuSections[0];

  useEffect(() => {
    let cancelled = false;
    if (!isAdminSession(user)) {
      setAdminStats(null);
      return undefined;
    }

    requestMysql("/admin/dashboard")
      .then((data) => {
        if (!cancelled) setAdminStats(data.stats || null);
      })
      .catch(() => {
        if (!cancelled) setAdminStats(null);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function submitAdminLogin() {
    setError("");
    try {
      const data = await requestMysql("/auth/signin", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!isAdminSession(data.user)) {
        clearSessionToken();
        throw new Error("This account does not have admin access.");
      }
      setSessionToken(data.token);
      loginWithUser(data.user);
    } catch (err) {
      setError(err.message || "Could not open the admin panel.");
    }
  }

  function handleAdminLogout() {
    clearSessionToken();
    logout();
  }

  if (!isAdminSession(user)) {
    return (
      <main className="admin-portal-shell">
        <header className="admin-public-nav">
          <Link className="brand" to="/"><Boxes size={22} /> UniFind</Link>
          <div className="home-nav-actions">
            <ThemeToggle />
            <Link className="btn btn-light small" to="/">Main Site</Link>
            <Link className="btn btn-light small" to="/login">Student Sign In</Link>
          </div>
        </header>
        <section className="admin-login-layout">
          <motion.article className="admin-login-copy" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
            <span className="eyebrow"><ShieldCheck size={14} /> Admin Panel</span>
            <h1>Dedicated review workspace for UniFind admins.</h1>
            <p>Review claims, verify ownership details, approve returns, reject weak requests, and monitor the full lost-and-found pipeline without entering the student dashboard.</p>
            <div className="admin-proof-grid">
              <div><strong>{pendingCount}</strong><span>Pending claims</span></div>
              <div><strong>{items.length}</strong><span>Total reports</span></div>
              <div><strong>{returnedCount}</strong><span>Returned items</span></div>
            </div>
          </motion.article>
          <section className="card auth-card admin-login-card">
            <div className="soft-icon red"><Shield size={22} /></div>
            <h2>Admin Sign In</h2>
            <p className="subtle">Sign in with a MySQL-backed account that has the `admin` role.</p>
            {user ? <p className="admin-note">A non-admin session is active. Sign out first, then use the registered administrator account.</p> : null}
            <div className="field"><label>Admin Email *</label><div className="input-wrap"><Mail size={16} /><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@uiu.ac.bd" /></div></div>
            <div className="field"><label>Password *</label><PasswordInput value={password} onChange={setPassword} placeholder="Enter admin password" /></div>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="btn btn-dark" type="button" onClick={submitAdminLogin}>Open Admin Panel</button>
            {user ? <button className="btn btn-light" type="button" onClick={handleAdminLogout}>Sign Out Current User</button> : null}
            <Link className="ghost-link" to="/">Back to Main Page</Link>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-console-shell">
      <AdminHeader user={user} onLogout={handleAdminLogout} />
      <section className="admin-console-hero">
        <div>
          <span className="eyebrow"><Settings size={14} /> Admin Console</span>
          <h1>{activeMeta.label}</h1>
          <p>Manage reports, claims, users, locations, notifications, matching, analytics, and platform settings from one dedicated page.</p>
        </div>
        <Link className="btn btn-light" to="/dashboard">Open Student Dashboard</Link>
      </section>
      <section className="stats-grid dashboard-stats admin-stats">
        <StatCard label="Pending Claims" value={pendingCount} />
        <StatCard label="Total Claims" value={claims.length} />
        <StatCard label="Open Reports" value={openReports} />
        <StatCard label="Returned Items" value={returnedCount} />
      </section>
      <section className="admin-workbench">
        <aside className="card admin-side-panel">
          <h3>Admin Options</h3>
          <p>Choose a management area to review and update.</p>
          <div className="admin-module-menu">
            {adminMenuSections.map((section) => {
              const Icon = section.icon;
              return (
                <button className={activeSection === section.key ? "active" : ""} type="button" key={section.key} onClick={() => setActiveSection(section.key)}>
                  <Icon size={14} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
          <div className="divider" />
          <h3>Recent Reports</h3>
          {recentAdminReports.map((item) => (
            <Link className="admin-report-link" to={`/items/${item.id}`} key={item.id}>
              <span>{item.title}</span>
              <small>{item.kind} - {prettyStatus(item.status)}</small>
            </Link>
          ))}
        </aside>
        <section className="admin-queue">
          <AdminModulePanel activeSection={activeSection} claimStatus={status} setClaimStatus={setStatus} />
        </section>
      </section>
    </main>
  );
}

function AdminHeader({ user, onLogout }) {
  return (
    <header className="admin-console-header">
      <Link className="brand" to="/"><Boxes size={22} /> UniFind Admin</Link>
      <nav className="admin-console-nav">
        <Link to="/">Main Page</Link>
        <Link to="/dashboard">Student App</Link>
        <Link to="/claims">Claims</Link>
      </nav>
      <div className="top-actions">
        <ThemeToggle />
        <div className="user-chip"><ShieldCheck size={14} /><div><div className="name-row">{user.name} <span>Admin</span></div><small>Authorized admin account</small></div></div>
        <button className="btn btn-light small" type="button" onClick={onLogout}><LogOut size={14} /> Logout</button>
      </div>
    </header>
  );
}

function AdminModulePanel({ activeSection, claimStatus, setClaimStatus }) {
  if (activeSection === "dashboard") return <AdminDashboardPanel />;
  if (activeSection === "lost") return <AdminItemManager kind="lost" />;
  if (activeSection === "found") return <AdminItemManager kind="found" />;
  if (activeSection === "categories") return <AdminCategoriesPanel />;
  if (activeSection === "users") return <AdminUsersPanel />;
  if (activeSection === "claims") return <AdminClaimsPanel status={claimStatus} setStatus={setClaimStatus} />;
  if (activeSection === "messages") return <AdminMessagesPanel />;
  if (activeSection === "complaints") return <AdminComplaintsPanel />;
  if (activeSection === "locations") return <AdminLocationsPanel />;
  if (activeSection === "notifications") return <AdminNotificationsPanel />;
  if (activeSection === "search") return <AdminSearchPanel />;
  if (activeSection === "matching") return <AdminMatchingPanel />;
  if (activeSection === "status") return <AdminStatusPanel />;
  if (activeSection === "analytics") return <AdminAnalyticsPanel />;
  if (activeSection === "settings") return <AdminSettingsPanel />;
  return <AdminDashboardPanel />;
}

function AdminSection({ title, text, children, actions = null }) {
  return (
    <section className="admin-section">
      <div className="section-heading admin-queue-head">
        <div>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function AdminMetric({ label, value, detail }) {
  return (
    <article className="card admin-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function AdminDashboardPanel() {
  const { items, claims, users, messages, complaints } = useAppStore();
  const latestReports = [...items].sort((a, b) => reportTimeValue(b) - reportTimeValue(a)).slice(0, 6);
  const lostCount = items.filter((item) => item.kind === "lost").length;
  const foundCount = items.filter((item) => item.kind === "found").length;
  const pendingPosts = items.filter((item) => ["reported", "pending"].includes(item.status)).length;
  const resolved = items.filter((item) => item.status === "returned").length;

  return (
    <AdminSection title="Dashboard Overview" text="Monitor total reports, pending work, users, claims, and recent activity.">
      <div className="admin-metric-grid">
        <AdminMetric label="Lost Items" value={lostCount} detail="All lost reports" />
        <AdminMetric label="Found Items" value={foundCount} detail="All found reports" />
        <AdminMetric label="Pending Posts" value={pendingPosts} detail="Need review" />
        <AdminMetric label="Resolved Cases" value={resolved} detail="Returned items" />
        <AdminMetric label="Users" value={users.length} detail="Registered accounts" />
        <AdminMetric label="Open Claims" value={claims.filter((claim) => ["submitted", "under-review"].includes(claim.status)).length} detail="Ownership checks" />
      </div>
      <div className="admin-two-column">
        <article className="card admin-panel-card">
          <h3>Latest Student Reports</h3>
          {latestReports.length ? latestReports.map((item) => <AdminTinyItem item={item} key={item.id} />) : <p className="showing">Submitted lost and found reports will appear here.</p>}
        </article>
        <article className="card admin-panel-card">
          <h3>Attention Needed</h3>
          <p className="showing">{messages.filter((message) => message.status === "open").length} open messages</p>
          <p className="showing">{complaints.filter((complaint) => complaint.status === "open").length} open complaints</p>
          <p className="showing">{claims.filter((claim) => claim.status === "submitted").length} newly submitted claims</p>
        </article>
      </div>
    </AdminSection>
  );
}

function AdminItemManager({ kind }) {
  const { items, categories, locations, updateItemStatus, updateItemDetails, deleteItem } = useAppStore();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [actionError, setActionError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const filtered = items
    .filter((item) => item.kind === kind && [item.title, item.description, item.category, item.location, item.reporter]
      .some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => reportTimeValue(b) - reportTimeValue(a));

  function startEdit(item) {
    setEditingId(item.id);
    setDraft({ title: item.title, category: item.category, location: item.location, status: item.status });
  }

  async function runItemAction(key, action) {
    setActionError("");
    setBusyKey(key);
    try {
      await action();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyKey("");
    }
  }

  function saveEdit(item) {
    runItemAction(`save-${item.id}`, async () => {
      const data = await requestMysql(`/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      updateItemDetails(item.id, data.item);
      setEditingId(null);
    });
  }

  function changeStatus(itemId, status) {
    runItemAction(`status-${itemId}-${status}`, async () => {
      const data = await requestMysql(`/items/${itemId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      updateItemStatus(itemId, data.item.status);
    });
  }

  function removeItem(itemId) {
    runItemAction(`delete-${itemId}`, async () => {
      await requestMysql(`/items/${itemId}`, {
        method: "DELETE",
      });
      deleteItem(itemId);
    });
  }

  return (
    <AdminSection
      title={kind === "lost" ? "Manage Lost Items" : "Manage Found Items"}
      text={kind === "lost" ? "View, edit, approve, reject, delete, or resolve lost item posts." : "Verify found item reports before publishing and manage their return status."}
      actions={<div className="input-wrap admin-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts..." /></div>}
    >
      {actionError ? <p className="form-error">{actionError}</p> : null}
      <div className="admin-record-list">
        {filtered.map((item) => (
          <article className="card admin-record-card" key={item.id}>
            {editingId === item.id ? (
              <div className="admin-edit-grid">
                <LabeledInput label="Title" value={draft.title} onChange={(value) => setDraft((prev) => ({ ...prev, title: value }))} />
                <label className="field"><span>Category</span><select value={draft.category} onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label className="field"><span>Location</span><select value={draft.location} onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))}>{locations.map((location) => <option key={location}>{location}</option>)}</select></label>
                <label className="field"><span>Status</span><select value={draft.status} onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}>{adminItemStatuses.map((entry) => <option key={entry} value={entry}>{prettyStatus(entry)}</option>)}</select></label>
                <div className="admin-row-actions">
                  <button className="btn btn-dark small" type="button" onClick={() => saveEdit(item)} disabled={busyKey === `save-${item.id}`}>{busyKey === `save-${item.id}` ? "Saving..." : "Save"}</button>
                  <button className="btn btn-light small" type="button" onClick={() => setEditingId(null)} disabled={busyKey === `save-${item.id}`}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="admin-record-main">
                  <div>
                    <div className="meta-row compact-meta"><span className={`pill ${kind}`}>{kind === "lost" ? "Lost" : "Found"}</span><StatusBadge status={item.status} /></div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <small>{item.category} - {item.location} - {formatDate(item.date)}</small>
                    <small>Reported by {item.reporter} ({safeEmail(item.email)}) - Submitted {formatDate(item.submittedAt || item.createdAt)}</small>
                  </div>
                  <div className="admin-row-actions">
                    <Link className="btn btn-light small" to={`/items/${item.id}`}><Eye size={13} /> View</Link>
                    <button className="btn btn-light small" type="button" onClick={() => startEdit(item)}>Edit</button>
                    <button className="btn btn-light small" type="button" onClick={() => changeStatus(item.id, "approved")} disabled={busyKey.startsWith(`status-${item.id}`)}>Approve</button>
                    <button className="btn btn-red small" type="button" onClick={() => changeStatus(item.id, "rejected")} disabled={busyKey.startsWith(`status-${item.id}`)}>Reject</button>
                    <button className="btn btn-dark small" type="button" onClick={() => changeStatus(item.id, "returned")} disabled={busyKey.startsWith(`status-${item.id}`)}>Returned</button>
                    <button className="btn btn-light small" type="button" onClick={() => removeItem(item.id)} disabled={busyKey === `delete-${item.id}`}>{busyKey === `delete-${item.id}` ? "Deleting..." : "Delete"}</button>
                  </div>
                </div>
              </>
            )}
          </article>
        ))}
        {!filtered.length ? <EmptyState title="No matching posts" text="Try a different search term or status." /> : null}
      </div>
    </AdminSection>
  );
}

function AdminCategoriesPanel() {
  const { categories, addCategory, removeCategory } = useAppStore();
  const [name, setName] = useState("");
  return (
    <AdminSection title="Item Categories" text="Add and manage categories like Mobile, Wallet, ID Card, Bag, Keys, Documents, Pets, and more.">
      <div className="card admin-inline-form">
        <LabeledInput label="New Category" value={name} onChange={setName} placeholder="e.g., Wallet" />
        <button className="btn btn-dark" type="button" onClick={() => { addCategory(name); setName(""); }}>Add Category</button>
      </div>
      <div className="admin-chip-grid">{categories.map((category) => <span className="admin-chip" key={category}>{category}<button type="button" onClick={() => removeCategory(category)}><X size={12} /></button></span>)}</div>
    </AdminSection>
  );
}

function AdminUsersPanel() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    requestMysql("/admin/users")
      .then((data) => {
        if (!cancelled) setUsers(data.users || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runUserAction(key, userId, payload) {
    setError("");
    setBusyKey(key);
    try {
      const data = await requestMysql(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setUsers((current) => current.map((entry) => (String(entry.id) === String(userId) ? data.user : entry)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey("");
    }
  }

  return (
    <AdminSection title="User Management" text="View users, verify accounts, block suspicious activity, and manage roles.">
      {error ? <p className="form-error">{error}</p> : null}
      <div className="admin-record-list">
        {users.map((entry) => (
          <article className="card admin-record-card" key={entry.id}>
            <div className="admin-record-main">
              <div>
                <h3>{entry.name}</h3>
                <p>{safeEmail(entry.email)}</p>
                <small>Joined {formatDate(entry.joinedAt)} - {entry.role}</small>
              </div>
              <div className="admin-row-actions">
                <StatusBadge status={entry.status} />
                <button className="btn btn-light small" type="button" disabled={busyKey === `verify-${entry.id}`} onClick={() => runUserAction(`verify-${entry.id}`, entry.id, { status: "verified" })}>Verify</button>
                <button className="btn btn-red small" type="button" disabled={busyKey === `block-${entry.id}`} onClick={() => runUserAction(`block-${entry.id}`, entry.id, { status: "blocked" })}>Block</button>
                <button className="btn btn-light small" type="button" disabled={busyKey === `role-${entry.id}`} onClick={() => runUserAction(`role-${entry.id}`, entry.id, { role: entry.role === "Moderator" ? "student" : "moderator" })}>Toggle Role</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

function AdminClaimsPanel({ status, setStatus }) {
  const { claims, items } = useAppStore();
  const visibleClaims = claims.filter((claim) => status === "all" || claim.status === status);
  return (
    <AdminSection title="Claims Management" text="Check claim requests, review ownership proof, and approve or reject claims.">
      <div className="card filter-card claim-toolbar">
        <div className="segmented wide-segment">
          {["submitted", "under-review", "approved", "rejected", "returned", "all"].map((entry) => (
            <button className={status === entry ? "active" : ""} type="button" key={entry} onClick={() => setStatus(entry)}>{entry === "all" ? "All" : prettyStatus(entry)}</button>
          ))}
        </div>
      </div>
      <div className="claim-list">
        {visibleClaims.length ? visibleClaims.map((claim) => <ClaimCard key={claim.id} claim={claim} item={items.find((item) => item.id === claim.itemId)} showReview />) : <EmptyState title="No claims for this status" text="Change the queue filter to review another stage." />}
      </div>
    </AdminSection>
  );
}

function AdminMessagesPanel() {
  const { messages, updateMessageStatus } = useAppStore();
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  async function changeStatus(messageId, status) {
    setError("");
    setBusyKey(`${messageId}-${status}`);
    try {
      const data = await requestMysql(`/admin/messages/${messageId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      updateMessageStatus(messageId, data.message.status);
    } catch (requestError) {
      setError(requestError.message || "Could not update the message.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <AdminSection title="Messages / Contact Requests" text="Monitor finder-owner communication and respond to user queries.">
      {error ? <p className="form-error">{error}</p> : null}
      <div className="admin-record-list">
        {messages.map((message) => (
          <article className="card admin-record-card" key={message.id}>
            <div className="admin-record-main">
              <div><h3>{message.subject}</h3><p>{message.message}</p><small>{message.name} - {safeEmail(message.email)} - {formatDate(message.createdAt)}</small></div>
              <div className="admin-row-actions"><StatusBadge status={message.status} /><button className="btn btn-light small" type="button" onClick={() => changeStatus(message.id, "answered")} disabled={Boolean(busyKey)}>{busyKey === `${message.id}-answered` ? "Saving..." : "Mark Answered"}</button><button className="btn btn-dark small" type="button" onClick={() => changeStatus(message.id, "closed")} disabled={Boolean(busyKey)}>{busyKey === `${message.id}-closed` ? "Saving..." : "Close"}</button></div>
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

function AdminComplaintsPanel() {
  const { complaints, updateComplaintStatus } = useAppStore();
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  async function changeStatus(complaintId, status) {
    setError("");
    setBusyKey(`${complaintId}-${status}`);
    try {
      const data = await requestMysql(`/admin/reports/${complaintId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      updateComplaintStatus(complaintId, data.report.status);
    } catch (requestError) {
      setError(requestError.message || "Could not update the report.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <AdminSection title="Reports & Complaints" text="Handle fake posts, fraud reports, spam, and inappropriate content.">
      {error ? <p className="form-error">{error}</p> : null}
      <div className="admin-record-list">
        {complaints.map((complaint) => (
          <article className="card admin-record-card" key={complaint.id}>
            <div className="admin-record-main">
              <div><h3>{complaint.type}: {complaint.target}</h3><p>{complaint.detail}</p><small>Reported by {complaint.reporter} - {formatDate(complaint.createdAt)}</small></div>
              <div className="admin-row-actions"><StatusBadge status={complaint.status} /><button className="btn btn-light small" type="button" onClick={() => changeStatus(complaint.id, "reviewing")} disabled={Boolean(busyKey)}>{busyKey === `${complaint.id}-reviewing` ? "Saving..." : "Review"}</button><button className="btn btn-red small" type="button" onClick={() => changeStatus(complaint.id, "action-taken")} disabled={Boolean(busyKey)}>{busyKey === `${complaint.id}-action-taken` ? "Saving..." : "Action Taken"}</button><button className="btn btn-dark small" type="button" onClick={() => changeStatus(complaint.id, "closed")} disabled={Boolean(busyKey)}>{busyKey === `${complaint.id}-closed` ? "Saving..." : "Close"}</button></div>
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

function AdminLocationsPanel() {
  const { locations, addLocation, removeLocation } = useAppStore();
  const [name, setName] = useState("");
  return (
    <AdminSection title="Location Management" text="Add or manage campus, city, station, office, and specific area locations.">
      <div className="card admin-inline-form">
        <LabeledInput label="New Location" value={name} onChange={setName} placeholder="e.g., UIU Cafeteria" />
        <button className="btn btn-dark" type="button" onClick={() => { addLocation(name); setName(""); }}>Add Location</button>
      </div>
      <div className="admin-chip-grid">{locations.map((location) => <span className="admin-chip" key={location}>{location}<button type="button" onClick={() => removeLocation(location)}><X size={12} /></button></span>)}</div>
    </AdminSection>
  );
}

function AdminNotificationsPanel() {
  const { notifications, sendAdminNotification } = useAppStore();
  const adminAlerts = notifications.filter(isAdminAlert);
  const studentNotifications = notifications.filter((notification) => !isAdminAlert(notification));
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState("App");
  return (
    <AdminSection title="Notifications" text="Send student notifications and monitor admin-only alerts separately.">
      <div className="card admin-inline-form admin-notify-form">
        <label className="field"><span>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value)}><option>App</option><option>Email</option><option>SMS</option></select></label>
        <LabeledInput label="Message" value={message} onChange={setMessage} placeholder="Write notification text..." />
        <button className="btn btn-dark" type="button" onClick={() => { sendAdminNotification(`${channel}: ${message}`); setMessage(""); }}>Send Notification</button>
      </div>
      <div className="admin-two-column">
        <article className="card admin-panel-card">
          <h3>Admin Alerts</h3>
          {adminAlerts.length ? adminAlerts.slice(0, 6).map((notification) => <div className="activity-link" key={notification.id}><div><span>{notification.text}</span><small>{formatDate(notification.date)}</small></div><StatusBadge status="pending" /></div>) : <p className="showing">No admin alerts yet.</p>}
        </article>
        <article className="card admin-panel-card">
          <h3>Student Notifications</h3>
          {studentNotifications.length ? studentNotifications.slice(0, 6).map((notification) => <div className="activity-link" key={notification.id}><div><span>{notification.text}</span><small>{formatDate(notification.date)}</small></div></div>) : <p className="showing">No student notifications yet.</p>}
        </article>
      </div>
    </AdminSection>
  );
}

function AdminSearchPanel() {
  const { items, claims, users, categories, locations } = useAppStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [location, setLocation] = useState("All Locations");
  const [status, setStatus] = useState("All Statuses");
  const itemResults = items.filter((item) => {
    const q = query.toLowerCase();
    const queryMatch = [item.title, item.description, item.reporter, item.location].some((value) => String(value || "").toLowerCase().includes(q));
    return queryMatch && (category === "All Categories" || item.category === category) && (location === "All Locations" || item.location === location) && (status === "All Statuses" || item.status === status);
  });
  const claimResults = claims.filter((claim) => [claim.itemTitle, claim.name, claim.uiuId].some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())));
  const userResults = users.filter((entry) => [entry.name, entry.email, entry.role].some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())));
  return (
    <AdminSection title="Search & Filter" text="Search by item name, category, date, location, status, claim, or user.">
      <section className="card filter-card">
        <div className="filter-row">
          <div className="field"><label>Search</label><div className="input-wrap"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search admin data..." /></div></div>
          <div className="field"><label>Category</label><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All Categories</option>{categories.map((entry) => <option key={entry}>{entry}</option>)}</select></div>
          <div className="field"><label>Location</label><select value={location} onChange={(event) => setLocation(event.target.value)}><option>All Locations</option>{locations.map((entry) => <option key={entry}>{entry}</option>)}</select></div>
          <div className="field"><label>Status</label><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All Statuses</option>{adminItemStatuses.map((entry) => <option key={entry} value={entry}>{prettyStatus(entry)}</option>)}</select></div>
        </div>
      </section>
      <div className="admin-two-column">
        <SearchResultCard title={`Items (${itemResults.length})`} items={itemResults.map((item) => ({ id: item.id, title: item.title, detail: `${item.kind} - ${item.category} - ${prettyStatus(item.status)}`, to: `/items/${item.id}` }))} />
        <SearchResultCard title={`Claims (${claimResults.length})`} items={claimResults.map((claim) => ({ id: claim.id, title: claim.itemTitle, detail: `${claim.name} - ${prettyStatus(claim.status)}` }))} />
        <SearchResultCard title={`Users (${userResults.length})`} items={userResults.map((entry) => ({ id: entry.id, title: entry.name, detail: `${safeEmail(entry.email)} - ${entry.role}` }))} />
      </div>
    </AdminSection>
  );
}

function AdminMatchingPanel() {
  const { matches, items, updateMatchStatus } = useAppStore();
  const itemById = (id) => items.find((item) => item.id === id);
  return (
    <AdminSection title="Matching System" text="Review possible matches based on category, date, location, color, and description similarity.">
      <div className="claim-list">
        {matches.length ? matches.map((match) => {
          const lost = itemById(match.lostId);
          const found = itemById(match.foundId);
          if (!lost || !found) return null;
          return (
            <article className="card admin-record-card" key={match.id}>
              <div className="admin-record-main">
                <div><h3>{lost.title} matched with {found.title}</h3><p>{lost.location} / {found.location}</p><small>Category: {lost.category} - Score: {match.score}% - Status: {prettyStatus(match.status)}</small></div>
                <div className="admin-row-actions"><button className="btn btn-light small" type="button" onClick={() => updateMatchStatus(match.id, "verified")}>Verify</button><button className="btn btn-dark small" type="button" onClick={() => updateMatchStatus(match.id, "returned")}>Returned</button></div>
              </div>
            </article>
          );
        }) : <EmptyState title="No strong matches yet" text="Matches appear when lost and found reports share enough similarity." />}
      </div>
    </AdminSection>
  );
}

function AdminStatusPanel() {
  const { items, updateItemStatus } = useAppStore();
  return (
    <AdminSection title="Status Management" text="Mark items as Pending, Approved, Claimed, Returned, Rejected, or Expired.">
      <div className="admin-status-summary">{adminItemStatuses.map((status) => <AdminMetric key={status} label={prettyStatus(status)} value={items.filter((item) => item.status === status).length} />)}</div>
      <div className="admin-record-list">
        {items.map((item) => (
          <article className="card admin-record-card" key={item.id}>
            <div className="admin-record-main">
              <div><h3>{item.title}</h3><p>{item.kind} - {item.category} - {item.location}</p></div>
              <label className="field compact-field"><span>Status</span><select value={item.status} onChange={(event) => updateItemStatus(item.id, event.target.value)}>{adminItemStatuses.map((entry) => <option key={entry} value={entry}>{prettyStatus(entry)}</option>)}</select></label>
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

function AdminAnalyticsPanel() {
  const { items, claims } = useAppStore();
  const returned = items.filter((item) => item.status === "returned").length;
  const resolutionRate = items.length ? Math.round((returned / items.length) * 100) : 0;
  const categoryCounts = items.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {});
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const monthCounts = items.reduce((acc, item) => {
    const key = String(item.date || item.createdAt || "Unknown").slice(0, 7);
    return { ...acc, [key]: (acc[key] || 0) + 1 };
  }, {});
  return (
    <AdminSection title="Reports / Analytics" text="Generate reports on total items, resolved cases, common lost items, and monthly activity.">
      <div className="admin-metric-grid">
        <AdminMetric label="Total Items" value={items.length} />
        <AdminMetric label="Resolved Cases" value={returned} />
        <AdminMetric label="Resolution Rate" value={`${resolutionRate}%`} />
        <AdminMetric label="Total Claims" value={claims.length} />
      </div>
      <div className="admin-two-column">
        <AdminBarCard title="Most Common Categories" entries={topCategories} />
        <AdminBarCard title="Monthly Activity" entries={Object.entries(monthCounts).sort()} />
      </div>
    </AdminSection>
  );
}

function AdminSettingsPanel() {
  const { settings, updateSettings, user, loginWithUser } = useAppStore();
  const [form, setForm] = useState(settings);
  const [accountForm, setAccountForm] = useState({
    email: user?.email || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [accountError, setAccountError] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    setAccountForm((prev) => ({ ...prev, email: user?.email || "" }));
  }, [user]);

  function updateAccount(key, value) {
    setAccountError("");
    setAccountSuccess("");
    setAccountForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitAdminAccount(event) {
    event.preventDefault();
    const nextEmail = accountForm.email.trim();
    const currentEmail = user?.email || "";
    const emailChanged = nextEmail.toLowerCase() !== currentEmail.toLowerCase();
    const passwordChanged = Boolean(accountForm.newPassword);

    if (!nextEmail) {
      setAccountError("Admin email is required.");
      return;
    }
    if (!isUiuEmail(nextEmail)) {
      setAccountError("Admin email must contain uiu.ac.bd.");
      return;
    }
    if (!accountForm.currentPassword) {
      setAccountError("Current password is required.");
      return;
    }
    if (passwordChanged && accountForm.newPassword.length < 6) {
      setAccountError("New password must be at least 6 characters.");
      return;
    }
    if (passwordChanged && accountForm.newPassword !== accountForm.confirmPassword) {
      setAccountError("New password and confirm password do not match.");
      return;
    }
    if (!emailChanged && !passwordChanged) {
      setAccountError("Change the admin email or enter a new password first.");
      return;
    }

    setSavingAccount(true);
    try {
      const payload = {
        currentPassword: accountForm.currentPassword,
        ...(emailChanged ? { email: nextEmail } : {}),
        ...(passwordChanged ? { newPassword: accountForm.newPassword } : {}),
      };
      const data = await requestMysql("/admin/account", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSessionToken(data.token);
      loginWithUser(data.user);
      setAccountSuccess(data.message || "Admin account updated successfully.");
      setAccountForm({
        email: data.user.email || nextEmail,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error) {
      setAccountError(error.message || "Could not update the admin account.");
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <AdminSection title="Settings" text="Manage website name, logo label, admin profile, privacy policy, contact details, and security settings.">
      <section className="card form-card">
        <form className="report-form" onSubmit={(event) => { event.preventDefault(); updateSettings(form); }}>
          <div className="claim-grid">
            <LabeledInput label="Website Name" value={form.siteName} onChange={(value) => update("siteName", value)} />
            <LabeledInput label="Contact Phone" value={form.contactPhone} onChange={(value) => update("contactPhone", value)} />
          </div>
          <LabeledInput label="Contact Email" value={form.contactEmail} onChange={(value) => update("contactEmail", value)} />
          <LabeledInput label="Security Settings" value={form.securityMode} onChange={(value) => update("securityMode", value)} />
          <LabeledTextarea label="Privacy Policy" value={form.privacyPolicy} onChange={(value) => update("privacyPolicy", value)} />
          <label className="toggle-line"><input type="checkbox" checked={form.notificationsEnabled} onChange={(event) => update("notificationsEnabled", event.target.checked)} /> Enable platform notifications</label>
          <button className="btn btn-dark" type="submit">Save Settings</button>
        </form>
      </section>
      <section className="card form-card">
        <form className="report-form" onSubmit={submitAdminAccount}>
          <h3>Admin Account</h3>
          <p className="subtle">Change the admin email and password for the MySQL-backed administrator account.</p>
          <div className="claim-grid">
            <LabeledInput label="Admin Email" value={accountForm.email} onChange={(value) => updateAccount("email", value)} placeholder="admin@uiu.ac.bd" />
            <LabeledInput label="Current Password" type="password" value={accountForm.currentPassword} onChange={(value) => updateAccount("currentPassword", value)} placeholder="Enter current password" />
          </div>
          <div className="claim-grid">
            <LabeledInput label="New Password" type="password" value={accountForm.newPassword} onChange={(value) => updateAccount("newPassword", value)} placeholder="Leave blank to keep current password" />
            <LabeledInput label="Confirm New Password" type="password" value={accountForm.confirmPassword} onChange={(value) => updateAccount("confirmPassword", value)} placeholder="Re-enter new password" />
          </div>
          {accountError ? <p className="form-error">{accountError}</p> : null}
          {accountSuccess ? <p className="showing">{accountSuccess}</p> : null}
          <button className="btn btn-dark" type="submit" disabled={savingAccount}>{savingAccount ? "Saving..." : "Update Admin Login"}</button>
        </form>
      </section>
    </AdminSection>
  );
}

function AdminTinyItem({ item }) {
  return (
    <Link className="activity-link" to={`/items/${item.id}`}>
      <div>
        <span>{item.title}</span>
        <small>{item.kind === "lost" ? "Lost" : "Found"} - submitted {formatDate(item.submittedAt || item.createdAt)}</small>
      </div>
      <StatusBadge status={item.status} />
    </Link>
  );
}

function SearchResultCard({ title, items }) {
  return (
    <article className="card admin-panel-card">
      <h3>{title}</h3>
      {items.length ? items.slice(0, 8).map((item) => (
        item.to ? <Link className="activity-link" to={item.to} key={item.id}><span>{item.title}</span><small>{item.detail}</small></Link> : <div className="activity-link" key={item.id}><span>{item.title}</span><small>{item.detail}</small></div>
      )) : <p className="showing">No results found.</p>}
    </article>
  );
}

function AdminBarCard({ title, entries }) {
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return (
    <article className="card admin-panel-card">
      <h3>{title}</h3>
      {entries.length ? entries.map(([label, count]) => (
        <div className="admin-bar-row" key={label}>
          <span>{label}</span>
          <div><b style={{ width: `${(count / max) * 100}%` }} /></div>
          <strong>{count}</strong>
        </div>
      )) : <p className="showing">No analytics yet.</p>}
    </article>
  );
}

function ProfilePage() {
  const { user, profile, items, claims, updateProfile } = useAppStore();
  const [form, setForm] = useState({
    name: user.name,
    uiuId: profile.uiuId,
    phone: profile.phone,
    department: profile.department,
    semester: profile.semester,
  });
  const [saved, setSaved] = useState(false);
  const myReports = items.filter((item) => item.email === user.email);
  const myClaims = claims.filter((claim) => claim.submittedBy === user.email);
  const update = (key, value) => {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <main className="shell dashboard-shell">
      <AppHeader active="profile" />
      <section className="profile-grid">
        <article className="card profile-card">
          <div className="profile-avatar"><UserCheck size={30} /></div>
          <h1>{user.name}</h1>
          <p>{accountLabel(user)}</p>
          <div className="claim-summary profile-summary">
            <div><span>Role</span><strong>{user.role}</strong></div>
            <div><span>Reports</span><strong>{myReports.length}</strong></div>
            <div><span>Claims</span><strong>{myClaims.length}</strong></div>
            <div><span>UIU ID</span><strong>{profile.uiuId || "Not set"}</strong></div>
          </div>
        </article>
        <article className="card form-card">
          <h1>Profile Details</h1>
          <p className="subtle">These details prefill reports and claim verification forms.</p>
          <form className="report-form" onSubmit={(event) => { event.preventDefault(); updateProfile(form); setSaved(true); }}>
            <LabeledInput label="Full Name" value={form.name} onChange={(v) => update("name", v)} />
            <LabeledInput label="UIU ID" value={form.uiuId} onChange={(v) => update("uiuId", v)} placeholder="e.g., 011223004" />
            <LabeledInput label="Phone" value={form.phone} onChange={(v) => update("phone", v)} placeholder="+880..." />
            <div className="claim-grid">
              <LabeledInput label="Department" value={form.department} onChange={(v) => update("department", v)} placeholder="CSE, BBA, EEE..." />
              <LabeledInput label="Semester" value={form.semester} onChange={(v) => update("semester", v)} placeholder="Spring 2026" />
            </div>
            {saved ? <p className="claim-success">Profile saved successfully.</p> : null}
            <button className="btn btn-dark" type="submit">Save Profile</button>
          </form>
        </article>
      </section>
      <section className="browse-panel">
        <div className="section-heading">
          <h2>My Activity</h2>
          <p>Your recent reports and claims are collected here for quick access.</p>
        </div>
        <div className="activity-grid">
          <ActivityPanel title="My Reports" items={myReports.map((item) => ({ id: item.id, title: item.title, status: item.status, to: `/items/${item.id}` }))} />
          <ActivityPanel title="My Claims" items={myClaims.map((claim) => ({ id: claim.id, title: claim.itemTitle, status: claim.status, to: "/claims" }))} />
        </div>
      </section>
    </main>
  );
}

function NotificationsPage() {
  const { user, notifications, markNotificationRead, markAllNotificationsRead, clearNotifications } = useAppStore();
  const visibleNotifications = visibleNotificationsForUser(notifications, user);
  const audience = notificationAudienceForUser(user);
  const label = isAdminSession(user) ? "Admin Alerts" : "Notifications";

  return (
    <main className="shell dashboard-shell">
      <AppHeader active="notifications" />
      <section className="section-heading notifications-heading">
        <div>
          <h2>{label}</h2>
          <p>{isAdminSession(user) ? "Admin-only review alerts and queue updates appear here." : "Important claim, match, and report updates appear here."}</p>
        </div>
        <div className="home-actions no-margin">
          <button className="btn btn-light small" type="button" onClick={() => markAllNotificationsRead(audience)}><Check size={14} /> Mark read</button>
          <button className="btn btn-light small" type="button" onClick={() => clearNotifications(audience)}>Clear</button>
        </div>
      </section>
      <section className="claim-list">
        {visibleNotifications.length ? visibleNotifications.map((notification) => (
          <article className={`card notification-card ${notification.read ? "read" : ""}`} key={notification.id}>
            <button type="button" className="notification-dot" onClick={() => markNotificationRead(notification.id)} aria-label="Mark notification read" />
            <div>
              <h3>{notification.text}</h3>
              <p>{formatDate(notification.date)}</p>
            </div>
            {notification.actionTo ? <Link className="btn btn-light small" to={notification.actionTo} onClick={() => markNotificationRead(notification.id)}>Open</Link> : null}
          </article>
        )) : <EmptyState title={`No ${label.toLowerCase()}`} text="You are all caught up." />}
      </section>
    </main>
  );
}

function MatchesPage() {
  const { matches, items, claims, user, updateMatchStatus } = useAppStore();
  const itemById = (id) => items.find((x) => x.id === id);
  return (
    <main className="shell">
      <Link className="ghost-link left" to="/dashboard"><ArrowLeft size={14} /> Back to Dashboard</Link>
      <section className="list-head"><h1>Potential Matches</h1><p>Auto-matched items using category, color, location, and description similarity</p></section>
      <section className="items-grid">
        {matches.map((m) => {
          const lost = itemById(m.lostId);
          const found = itemById(m.foundId);
          if (!lost || !found) return null;
          const canSeeLost = canViewItemDetails(lost, user, claims);
          return (
            <article className="card item-card" key={m.id}>
              <div className="item-body">
                <div className="meta-row"><span className="pill lost">Lost</span><span className="pill found">Found</span></div>
                <h3>{lost.title} ↔ {found.title}</h3>
                <p className="desc">Confidence Score: <strong>{m.score}%</strong></p>
                {canSeeLost ? (
                  <>
                    <p className="mini"><MapPin size={13} /> {lost.location} / {found.location}</p>
                    <p className="mini"><Calendar size={13} /> {lost.date} / {found.date}</p>
                  </>
                ) : <ProtectedDetailsNotice compact />}
                <div className="divider" />
                <p className="mini">Status: {m.status}</p>
                <div className="home-actions">
                  <button type="button" className="btn btn-light small" onClick={() => updateMatchStatus(m.id, "claim requested")}>Claim Request</button>
                  <button type="button" className="btn btn-red small" onClick={() => updateMatchStatus(m.id, "verified")}>Verify</button>
                  <button type="button" className="btn btn-dark small" onClick={() => updateMatchStatus(m.id, "returned")}>Returned</button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function ClaimCard({ claim, item, showReview = false }) {
  const user = useAppStore((s) => s.user);
  const [expanded, setExpanded] = useState(false);
  const itemTitle = item?.title || claim.itemTitle;
  const itemKind = item?.kind || claim.itemKind;
  const detailItem = item || { id: claim.itemId, kind: itemKind };
  const detailsVisible = showReview || canViewItemDetails(detailItem, user, [claim]);

  return (
    <article className="card claim-card">
      <div className="claim-card-head">
        <div>
          <div className="meta-row compact-meta">
            <span className={`pill ${itemKind}`}>{itemKind === "lost" ? "Lost" : "Found"}</span>
            <StatusBadge status={claim.status} />
          </div>
          <h3>{itemTitle}</h3>
          <p>Submitted by {claim.name} on {formatDate(claim.createdAt)}</p>
        </div>
        <div className="claim-card-actions">
          {item ? <Link className="btn btn-light small" to={`/items/${item.id}`}><Eye size={13} /> Item</Link> : null}
          <button className="btn btn-light small" type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide Details" : "Details"}
          </button>
        </div>
      </div>

      <ClaimTimeline status={claim.status} />

      <div className="claim-summary claim-card-summary">
        <div><span>UIU ID</span><strong>{claim.uiuId}</strong></div>
        <div><span>Email</span><strong>{claim.email || "Not shared"}</strong></div>
        <div><span>Phone</span><strong>{claim.phone || "Not shared"}</strong></div>
        <div><span>Preferred Return</span><strong>{claim.preferredReturnLocation || (detailsVisible ? claim.itemLocation : "Hidden until approval")}</strong></div>
      </div>

      {expanded ? (
        <div className="claim-details">
          {detailsVisible ? (
            <>
              <DetailRow label="Category" value={claim.itemCategory} icon={<ClipboardList size={14} />} />
              <DetailRow label="Item Location" value={claim.itemLocation} icon={<MapPin size={14} />} />
              <DetailRow label="Item Date" value={claim.itemDate} icon={<Calendar size={14} />} />
              <DetailRow label="Reported By" value={claim.itemReporter || "Unknown"} icon={<User size={14} />} />
            </>
          ) : <ProtectedDetailsNotice compact />}
          <DetailRow label="Unique Mark" value={claim.uniqueMark || "Not provided"} icon={<CheckCircle size={14} />} />
          <DetailRow label="Last Seen" value={claim.lastSeen || "Not provided"} icon={<Eye size={14} />} />
          <div className="detail-note"><span>Verification Details</span><p>{claim.proof || "No extra verification note provided."}</p></div>
          {claim.adminNote ? <div className="detail-note"><span>Admin Note</span><p>{claim.adminNote}</p></div> : null}
        </div>
      ) : null}

      {showReview ? <ReviewControls claim={claim} /> : null}
    </article>
  );
}

function ReviewControls({ claim }) {
  const updateClaimStatus = useAppStore((s) => s.updateClaimStatus);
  const [note, setNote] = useState(claim.adminNote || "");
  const [error, setError] = useState("");
  const [busyStatus, setBusyStatus] = useState("");

  async function setStatus(status) {
    setError("");
    setBusyStatus(status);
    try {
      const data = await requestMysql(`/admin/claims/${claim.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, adminNote: note }),
      });
      updateClaimStatus(claim.id, data.claim.status, data.claim.adminNote || "");
    } catch (requestError) {
      setError(requestError.message || "Could not update claim status.");
    } finally {
      setBusyStatus("");
    }
  }

  return (
    <div className="review-box">
      <LabeledTextarea label="Admin Review Note" value={note} onChange={setNote} placeholder="Add verification decision, pickup instruction, or rejection reason..." />
      {error ? <p className="form-error">{error}</p> : null}
      <div className="review-actions">
        <button className="btn btn-light small" type="button" onClick={() => setStatus("under-review")} disabled={Boolean(busyStatus)}><Clock size={13} /> {busyStatus === "under-review" ? "Saving..." : "Review"}</button>
        <button className="btn btn-light small" type="button" onClick={() => setStatus("approved")} disabled={Boolean(busyStatus)}><CheckCircle size={13} /> {busyStatus === "approved" ? "Saving..." : "Approve"}</button>
        <button className="btn btn-red small" type="button" onClick={() => setStatus("rejected")} disabled={Boolean(busyStatus)}><X size={13} /> {busyStatus === "rejected" ? "Saving..." : "Reject"}</button>
        <button className="btn btn-dark small" type="button" onClick={() => setStatus("returned")} disabled={Boolean(busyStatus)}><ShieldCheck size={13} /> {busyStatus === "returned" ? "Saving..." : "Returned"}</button>
      </div>
    </div>
  );
}

function ClaimTimeline({ status }) {
  const activeIndex = Math.max(0, claimStatuses.indexOf(status));
  return (
    <div className="claim-timeline">
      {claimStatuses.map((entry, index) => (
        <div className={index <= activeIndex ? "done" : ""} key={entry}>
          <span>{index < activeIndex ? <Check size={12} /> : index + 1}</span>
          <p>{prettyStatus(entry)}</p>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`status-pill ${status}`}>{prettyStatus(status)}</span>;
}

function DetailRow({ label, value, icon }) {
  return (
    <div className="detail-row">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value || "Not provided"}</strong>
      </div>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <section className="card empty-state">
      <ClipboardCheck size={34} />
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function ActivityPanel({ title, items }) {
  return (
    <article className="card activity-panel">
      <h3>{title}</h3>
      {items.length ? items.slice(0, 5).map((item) => (
        <Link className="activity-link" to={item.to} key={item.id}>
          <span>{item.title}</span>
          <StatusBadge status={item.status} />
        </Link>
      )) : <p className="showing">No activity yet.</p>}
    </article>
  );
}

function FeatureBlocks() {
  return (
    <section id="features" className="home-feature-grid">
      <article className="card home-feature-card">
        <div className="soft-icon blue"><Zap size={22} /></div>
        <h3>AI-Assisted Matching</h3>
        <p>Similarity scoring compares category, color, location, and text context to surface the strongest potential matches.</p>
      </article>
      <article className="card home-feature-card">
        <div className="soft-icon green"><ShieldCheck size={22} /></div>
        <h3>Trust and Verification</h3>
        <p>Claim workflow with verification statuses keeps ownership checks structured and safe.</p>
      </article>
      <article className="card home-feature-card">
        <div className="soft-icon violet"><Users size={22} /></div>
        <h3>Student-Centered UX</h3>
        <p>Fast report forms, saved filters, map links, and notifications built for real campus behavior.</p>
      </article>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="flow" className="card home-steps premium-steps">
      <h2><Sparkles size={18} /> How It Works</h2>
      <div className="home-step-grid">
        <div><span>1</span><h4>Report Item</h4><p>Submit details about your lost or found item with photos</p></div>
        <div><span>2</span><h4>Auto-Match</h4><p>System finds potential matches based on smart algorithms</p></div>
        <div><span>3</span><h4>Get Notified</h4><p>Receive instant notifications when matches are found</p></div>
        <div><span>4</span><h4>Claim &amp; Verify</h4><p>Verify ownership and arrange for item return</p></div>
      </div>
    </section>
  );
}

function StatCard({ label, value, badge, icon }) {
  return (
    <article className="card stat-card">
      <div className="stat-card-head">
        <p>{label}</p>
        {icon ? <span className="stat-icon">{icon}</span> : null}
      </div>
      <h2>{value} {badge && <span>{badge}</span>}</h2>
    </article>
  );
}

function ActionCard({ color, title, text, button, link, outline, icon }) {
  return (
    <article className="card action-card">
      <div className={`soft-icon ${color}`}>{icon || <Boxes size={22} />}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      <Link className={`btn ${outline ? "btn-light" : color === "red" ? "btn-red" : "btn-dark"} small wide`} to={link}>{button}</Link>
    </article>
  );
}

function ItemCard({ item, kind, detailsVisible = true, onClick }) {
  return (
    <article className={`card item-card ${detailsVisible ? "" : "protected-item-card"}`} onClick={onClick} onKeyDown={(event) => { if (event.key === "Enter") onClick(); }} role="button" tabIndex={0}>
      <div className={item.photo ? "thumb has-photo" : "thumb"}>
        {item.photo ? <img src={item.photo} alt={item.title} /> : <Boxes size={52} />}
      </div>
      <div className="item-body">
        <h3>{item.title}</h3>
        {detailsVisible ? (
          <>
            <div className="meta-row"><span className={`pill ${kind}`}>{kind === "lost" ? "Lost" : "Found"}</span><span className="chip">{item.category}</span></div>
            <p className="desc">{item.description}</p>
            <p className="mini"><span className="dot" style={{ background: colorFromName(item.color) }} /> {item.color || "Not specified"}</p>
            <p className="mini"><MapPin size={13} /> {item.location}</p>
            <p className="mini"><Calendar size={13} /> {item.date}</p>
            <div className="divider" />
            <ReporterBlock item={item} />
          </>
        ) : null}
        <div className="item-card-actions">
          {detailsVisible ? <span className={`status-pill ${item.status}`}>{prettyStatus(item.status)}</span> : null}
          <Link className="ghost-link inline-link" to={`/items/${item.id}`} onClick={(event) => event.stopPropagation()}><Eye size={13} /> {detailsVisible ? "Details" : "Submit Claim"}</Link>
        </div>
      </div>
    </article>
  );
}

function ItemDetailsModal({ item, kind, onClose }) {
  const user = useAppStore((s) => s.user);
  const claims = useAppStore((s) => s.claims);
  const detailsVisible = canViewItemDetails(item, user, claims);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.section
        className="card modal-card"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose}><X size={16} /></button>
        {item.photo ? <img className="modal-photo" src={item.photo} alt={item.title} /> : null}
        <h3>{item.title}</h3>
        {detailsVisible ? (
          <>
            <div className="meta-row"><span className={`pill ${kind}`}>{kind === "lost" ? "Lost" : "Found"}</span><span className="chip">{item.category}</span></div>
            <p className="desc">{item.description}</p>
            <p className="mini"><span className="dot" /> {item.color || "Not specified"}</p>
            <p className="mini"><MapPin size={13} /> {item.location}</p>
            <p className="mini"><Calendar size={13} /> {item.date}</p>
            {item.map ? (
              <a className="map-preview" href={item.map} target="_blank" rel="noreferrer">
                <MapPin size={14} /> Open Map Link <ExternalLink size={13} />
              </a>
            ) : null}
            <div className="divider" />
            <ReporterBlock item={item} />
          </>
        ) : <ProtectedDetailsNotice />}
        <ClaimWorkflow item={item} kind={kind} detailsVisible={detailsVisible} />
      </motion.section>
    </div>
  );
}

function ClaimWorkflow({ item, kind, detailsVisible: detailsVisibleProp = null }) {
  const user = useAppStore((s) => s.user);
  const claims = useAppStore((s) => s.claims);
  const profile = useAppStore((s) => s.profile);
  const submitClaim = useAppStore((s) => s.submitClaim);
  const existingClaim = (claims || []).find((claim) => claim.itemId === item.id && claim.submittedBy === user?.email);
  const detailsVisible = detailsVisibleProp ?? canViewItemDetails(item, user, claims);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimSubmitted, setClaimSubmitted] = useState(Boolean(existingClaim));
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimForm, setClaimForm] = useState({
    uiuId: profile?.uiuId || "",
    name: user?.name || "",
    email: user?.email || "",
    phone: profile?.phone || "",
    proof: "",
    uniqueMark: "",
    lastSeen: "",
    preferredReturnLocation: detailsVisible ? item.location || "" : "",
  });
  const claimCopy = kind === "lost"
    ? {
        title: "Found this lost item?",
        text: "Submit a claim with your UIU ID so the reporter can verify and arrange return.",
      }
    : {
        title: "Is this your item?",
        text: "Submit a claim with your UIU ID so the finder can verify ownership.",
      };
  const isOwnReport = item.email && user?.email && item.email === user.email;

  function updateClaim(key, value) {
    setClaimForm((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    setClaimSubmitted(Boolean(existingClaim));
  }, [existingClaim]);

  async function handleClaimSubmit(event) {
    event.preventDefault();
    if (!claimForm.uiuId.trim()) {
      setClaimError("UIU ID is required.");
      return;
    }
    if (!claimForm.name.trim()) {
      setClaimError("Name is required.");
      return;
    }

    setSubmittingClaim(true);
    try {
      const data = await requestMysql("/claims", {
        method: "POST",
        body: JSON.stringify({
          itemId: item.id,
          uiuId: claimForm.uiuId.trim(),
          name: claimForm.name.trim(),
          phone: claimForm.phone.trim(),
          proof: claimForm.proof.trim(),
          uniqueMark: claimForm.uniqueMark.trim(),
          lastSeen: claimForm.lastSeen.trim(),
          preferredReturnLocation: claimForm.preferredReturnLocation.trim(),
        }),
      });
      submitClaim(data.claim);
      setClaimError("");
      setClaimSubmitted(true);
      setShowClaimForm(false);
    } catch (error) {
      setClaimError(error.message || "Could not submit your claim.");
    } finally {
      setSubmittingClaim(false);
    }
  }

  if (isOwnReport) {
    return (
      <div className="claim-panel">
        <div className="claim-panel-head">
          <div>
            <h4>This is your report</h4>
            <p>Claims from other students will appear in your Claim Center for review and follow-up.</p>
          </div>
          <Link className="btn btn-light small" to="/claims">Open Claims</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="claim-panel">
      <div className="claim-panel-head">
        <div>
          <h4>{claimCopy.title}</h4>
          <p>{claimCopy.text}</p>
        </div>
        {claimSubmitted ? <span className="claim-status"><ShieldCheck size={13} /> {prettyStatus(existingClaim?.status || "submitted")}</span> : null}
      </div>

      {detailsVisible ? <div className="claim-summary">
        <div><span>Item</span><strong>{item.title}</strong></div>
        <div><span>Category</span><strong>{item.category}</strong></div>
        <div><span>Location</span><strong>{item.location}</strong></div>
        <div><span>Date</span><strong>{item.date}</strong></div>
      </div> : null}

      {claimSubmitted ? (
        <p className="claim-success">{detailsVisible ? "Your claim has been submitted. The item details above were attached automatically." : "Your claim has been submitted. Admin will review it and reveal item details only after approval."}</p>
      ) : null}

      {!claimSubmitted && !showClaimForm ? (
        <button className="btn btn-red wide" type="button" onClick={() => setShowClaimForm(true)}>Submit Claim</button>
      ) : null}

      {!claimSubmitted && showClaimForm ? (
        <form className="claim-form" onSubmit={handleClaimSubmit}>
          <div className="claim-grid">
            <LabeledInput label="UIU ID *" value={claimForm.uiuId} onChange={(v) => updateClaim("uiuId", v)} placeholder="e.g., 011223004" />
            <LabeledInput label="Name *" value={claimForm.name} onChange={(v) => updateClaim("name", v)} placeholder="Your name" />
          </div>
          <LabeledInput label="Contact Email" value={claimForm.email} onChange={(v) => updateClaim("email", v)} placeholder="you@uiu.ac.bd" />
          <LabeledInput label="Phone (Optional)" value={claimForm.phone} onChange={(v) => updateClaim("phone", v)} placeholder="+880..." />
          <LabeledInput label="Preferred Return Location" value={claimForm.preferredReturnLocation} onChange={(v) => updateClaim("preferredReturnLocation", v)} placeholder="e.g., Student Center help desk" />
          <div className="claim-grid">
            <LabeledInput label="Unique Mark / Identifier" value={claimForm.uniqueMark} onChange={(v) => updateClaim("uniqueMark", v)} placeholder="e.g., sticker, scratch, initials" />
            <LabeledInput label="Where You Last Saw It" value={claimForm.lastSeen} onChange={(v) => updateClaim("lastSeen", v)} placeholder="e.g., Library 3rd floor" />
          </div>
          <LabeledTextarea label="Verification Details (Optional)" value={claimForm.proof} onChange={(v) => updateClaim("proof", v)} placeholder="Add anything that helps verify this claim..." />
          {claimError ? <p className="form-error">{claimError}</p> : null}
          <div className="claim-actions">
            <button className="btn btn-red" type="submit" disabled={submittingClaim}>{submittingClaim ? "Submitting..." : "Submit Claim"}</button>
            <button className="btn btn-light" type="button" onClick={() => { setShowClaimForm(false); setClaimError(""); }} disabled={submittingClaim}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ReporterBlock({ item }) {
  const email = item.email || "No email shared";
  const phone = item.phone || "No phone shared";

  return (
    <div className="reporter-block">
      <span>Reported by</span>
      <strong>{item.reporter || "Unknown reporter"}</strong>
      <div className="reporter-contact">
        {item.email ? <a href={`mailto:${item.email}`}>{email}</a> : <small>{email}</small>}
        <small>{phone}</small>
      </div>
    </div>
  );
}

function ProtectedDetailsNotice({ compact = false }) {
  return (
    <div className={`protected-details-notice ${compact ? "compact" : ""}`}>
      <ShieldCheck size={compact ? 16 : 20} />
      <div>
        <strong>Details hidden until admin approval</strong>
        {!compact ? <p>Students can only see the item name and picture before claiming. Submit a claim with your UIU ID, then an admin will review and reveal the details if approved.</p> : null}
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder = "", type = "text" }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}

function LabeledTextarea({ label, value, onChange, placeholder = "" }) {
  return <label className="field"><span>{label}</span><textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}

function LabeledSelect({ label, value, onChange, options }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select a category</option>{options.map((opt) => <option key={opt}>{opt}</option>)}</select></label>;
}

function prettyStatus(status = "reported") {
  return String(status)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function reportTimeValue(item) {
  const date = new Date(item?.submittedAt || item?.createdAt || item?.date || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function colorFromName(value = "") {
  const normalized = value.toLowerCase();
  if (normalized.includes("blue")) return "#2458e6";
  if (normalized.includes("black")) return "#10131b";
  if (normalized.includes("gray") || normalized.includes("grey")) return "#9aa0aa";
  if (normalized.includes("red")) return "#d93f31";
  if (normalized.includes("white")) return "#ffffff";
  if (normalized.includes("green")) return "#2f9e53";
  if (normalized.includes("yellow")) return "#e9b72e";
  return "#d9842b";
}

function passwordStrength(value) {
  let score = 0;
  if (value.length >= 6) score += 30;
  if (/[A-Z]/.test(value)) score += 20;
  if (/[0-9]/.test(value)) score += 20;
  if (/[^A-Za-z0-9]/.test(value)) score += 20;
  if (value.length >= 10) score += 10;
  if (score <= 30) return { score: Math.max(score, 8), tone: "weak", label: "Weak password" };
  if (score <= 70) return { score, tone: "mid", label: "Medium password" };
  return { score, tone: "strong", label: "Strong password" };
}

function MagneticLink({ to, className, children }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18 });
  const sy = useSpring(y, { stiffness: 220, damping: 18 });

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = e.clientX - (rect.left + rect.width / 2);
    const ry = e.clientY - (rect.top + rect.height / 2);
    x.set(rx * 0.14);
    y.set(ry * 0.14);
  }

  function onLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div className="mag-wrap" style={{ x: sx, y: sy }} onMouseMove={onMove} onMouseLeave={onLeave}>
      <Link className={className} to={to}>{children}</Link>
    </motion.div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
