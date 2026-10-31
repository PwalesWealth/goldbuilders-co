require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'goldbuilders.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'sdclimited.ng@gmail.com';
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'admin',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contact_leads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 organization TEXT,
 email TEXT NOT NULL,
 phone TEXT,
 industry TEXT,
 timeline TEXT,
 service TEXT,
 message TEXT,
 consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS skeelup_registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 email TEXT NOT NULL,
 phone TEXT,
 location TEXT,
 status TEXT,
 course TEXT,
 goal TEXT,
 experience TEXT,
 consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assessment_results (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 token TEXT UNIQUE NOT NULL,
 organization TEXT,
 email TEXT,
 strategy INTEGER NOT NULL,
 people INTEGER NOT NULL,
 revenue INTEGER NOT NULL,
 finance INTEGER NOT NULL,
 technology INTEGER NOT NULL,
 operations INTEGER NOT NULL,
 brand INTEGER NOT NULL,
 score INTEGER NOT NULL,
 tier TEXT NOT NULL,
 recommendations_json TEXT,
 consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS nexora_leads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 email TEXT NOT NULL,
 phone TEXT NOT NULL,
 package TEXT NOT NULL,
 goals TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS luxestreams_club_leads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 email TEXT NOT NULL,
 phone TEXT NOT NULL,
 city TEXT,
 member_type TEXT NOT NULL,
 services_json TEXT NOT NULL,
 timeline TEXT NOT NULL,
 details TEXT,
 consent INTEGER NOT NULL DEFAULT 0,
 marketing_consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Small forward-only migrations make this safe for databases created by an earlier platform version.
function ensureColumn(table, column, declaration) {
  const columns = db.pragma(`table_info(${table})`);
  if (!columns.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
ensureColumn('contact_leads', 'consent', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('skeelup_registrations', 'consent', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('assessment_results', 'recommendations_json', 'TEXT');
ensureColumn('assessment_results', 'consent', 'INTEGER NOT NULL DEFAULT 0');

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'CHANGE_THIS_SESSION_SECRET',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 4 }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const leadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });

function requireAuth(req, res, next) {
  if (req.session?.adminId) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
function clean(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
function requestBase(req) {
  return APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

let transporter = null;
function emailTransport() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || user.startsWith('your-') || pass.startsWith('your-')) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  return transporter;
}
async function notifyInbox({ subject, text, replyTo }) {
  try {
    const mailer = emailTransport();
    if (!mailer) {
      console.warn('Email notification not sent: SMTP is not configured. Database submission will still be saved.');
      return false;
    }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await mailer.sendMail({ from, to: NOTIFY_EMAIL, replyTo: replyTo || undefined, subject, text });
    return true;
  } catch (error) {
    console.error('Email notification failed:', error.message);
    return false;
  }
}

const recommendations = {
  strategy: 'Clarify strategic priorities, competitive choices, operating objectives and the 90-day execution agenda.',
  people: 'Review leadership capability, role clarity, performance systems, talent planning and learning needs.',
  revenue: 'Map the customer-to-cash journey, pipeline quality, handoffs, KPIs and revenue operating rhythm.',
  finance: 'Strengthen management reporting, controls, cash visibility, budgeting and financial decision support.',
  technology: 'Assess process digitization, data quality, systems integration, automation and technology roadmap.',
  operations: 'Redesign critical workflows, decision ownership, service levels and execution routines.',
  brand: 'Strengthen brand narrative, corporate communications, content, stakeholder visibility and market positioning.'
};
const dimensionLabels = {
  strategy: 'Strategy & Direction', people: 'People & Leadership', revenue: 'Revenue Operations',
  finance: 'Finance & Controls', technology: 'Technology & Data', operations: 'Operations',
  brand: 'Brand & Communication'
};
function assessmentResult(scores) {
  const keys = Object.keys(dimensionLabels);
  const score = Math.round(keys.reduce((sum, key) => sum + scores[key], 0) / (keys.length * 10) * 100);
  const tier = score >= 80 ? 'High Performer' : score >= 60 ? 'Developing Performer' : 'Transformation Priority';
  const priorities = keys.map(key => ({ key, label: dimensionLabels[key], score: scores[key], recommendation: recommendations[key] }))
    .sort((a, b) => a.score - b.score).slice(0, 3);
  return { score, tier, priorities };
}
function assessmentEmailText(body, token, result, req) {
  const lines = [
    'A new GoldBuilders Co. High-Performance Assessment has been completed.', '',
    `Organization: ${body.organization || 'Not supplied'}`,
    `Respondent email: ${body.email || 'Not supplied'}`,
    `Score: ${result.score}/100`, `Tier: ${result.tier}`, '', 'Dimension scores:'
  ];
  for (const [key, label] of Object.entries(dimensionLabels)) lines.push(`- ${label}: ${body[key]}/10`);
  lines.push('', 'Priority recommendations:');
  result.priorities.forEach((p, i) => lines.push(`${i + 1}. ${p.label} (${p.score}/10): ${p.recommendation}`));
  lines.push('', `Result: ${requestBase(req)}/assessment-result.html?token=${token}`);
  lines.push(`Database result token: ${token}`);
  return lines.join('\n');
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', authLimiter, (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const password = clean(req.body.password, 300);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(password, admin.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.adminId = admin.id;
  req.session.role = admin.role;
  return res.json({ ok: true });
});
app.post('/api/logout', requireAuth, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/contact', leadLimiter, async (req, res) => {
  const body = req.body || {};
  // A honeypot field helps discard basic automated spam without troubling real users.
  if (clean(body.website, 300)) return res.status(201).json({ ok: true, notificationSent: false });
  const full_name = clean(body.full_name, 160);
  const email = clean(body.email, 254).toLowerCase();
  if (!full_name || !validEmail(email)) return res.status(400).json({ error: 'Please provide your name and a valid email address.' });
  const preferredDate = clean(body.preferred_date, 30);
  const preferredTime = clean(body.preferred_time, 80);
  const originalMessage = clean(body.message, 5000);
  const bookingNotes = [
    preferredDate ? `Preferred consultation date (not yet confirmed): ${preferredDate}` : '',
    preferredTime ? `Preferred consultation time (WAT, not yet confirmed): ${preferredTime}` : ''
  ].filter(Boolean).join('\n');
  const record = {
    full_name, organization: clean(body.organization, 200), email, phone: clean(body.phone, 80),
    industry: clean(body.industry, 140), timeline: clean(body.timeline, 100), service: clean(body.service, 180),
    message: [originalMessage, bookingNotes].filter(Boolean).join('\n\n').slice(0, 5000), consent: body.consent ? 1 : 0
  };
  db.prepare(`INSERT INTO contact_leads(full_name,organization,email,phone,industry,timeline,service,message,consent)
    VALUES(@full_name,@organization,@email,@phone,@industry,@timeline,@service,@message,@consent)`).run(record);
  const emailText = [
    'New consultation request from the GoldBuilders Co. website', '',
    `Name: ${record.full_name}`, `Organization: ${record.organization || 'Not supplied'}`,
    `Email: ${record.email}`, `Phone: ${record.phone || 'Not supplied'}`,
    `Industry: ${record.industry || 'Not supplied'}`, `Timeline: ${record.timeline || 'Not supplied'}`,
    `Service needed: ${record.service || 'Not supplied'}`,
    `Preferred date (request only): ${preferredDate || 'Not supplied'}`,
    `Preferred time (WAT, request only): ${preferredTime || 'Not supplied'}`,
    `Consent recorded: ${record.consent ? 'Yes' : 'No'}`,
    '', 'Message:', originalMessage || 'No message supplied'
  ].join('\n');
  const notificationSent = await notifyInbox({ subject: `GoldBuilders enquiry: ${record.service || 'Consultation request'}${preferredDate ? ' — preferred time requested' : ''}`, text: emailText, replyTo: record.email });
  return res.status(201).json({ ok: true, saved: true, notificationSent, message: 'Your request has been saved.' });
});

app.post('/api/nexora-leads', leadLimiter, async (req, res) => {
  const body = req.body || {};
  if (clean(body.website, 300)) return res.status(201).json({ ok: true, saved: true, notificationSent: false });
  const full_name = clean(body.full_name, 160);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 80);
  const packageName = clean(body.package, 100);
  const allowedPackages = ['Starter Infrastructure', 'Growth & Visibility', 'Enterprise Stack', 'Custom Implementation'];
  if (!full_name || !validEmail(email) || !phone || !allowedPackages.includes(packageName)) {
    return res.status(400).json({ error: 'Please provide your name, valid email, phone number and a valid setup package.' });
  }
  const record = { full_name, email, phone, package: packageName, goals: clean(body.goals, 5000) };
  db.prepare(`INSERT INTO nexora_leads(full_name,email,phone,package,goals)
    VALUES(@full_name,@email,@phone,@package,@goals)`).run(record);
  const emailText = [
    'New Nexora Business-In-A-Box setup consultation', '',
    `Name: ${record.full_name}`, `Email: ${record.email}`, `Phone / WhatsApp: ${record.phone}`,
    `Selected package: ${record.package}`, ...(record.package === 'Custom Implementation' ? ['Custom implementation requested: prepare discovery and a scoped quotation.'] : []), '', 'Business goals / setup needs:', record.goals || 'Not supplied'
  ].join('\n');
  const notificationSent = await notifyInbox({
    subject: `Nexora setup enquiry: ${record.package}`,
    text: emailText,
    replyTo: record.email
  });
  return res.status(201).json({ ok: true, saved: true, notificationSent, message: 'Your Nexora consultation request has been saved.' });
});

app.post('/api/skeelup', leadLimiter, async (req, res) => {
  const body = req.body || {};
  if (clean(body.website, 300)) return res.status(201).json({ ok: true, notificationSent: false });
  const full_name = clean(body.full_name, 160);
  const email = clean(body.email, 254).toLowerCase();
  const course = clean(body.course, 180);
  if (!full_name || !validEmail(email) || !course) return res.status(400).json({ error: 'Please provide your name, valid email and preferred course.' });
  const record = {
    full_name, email, phone: clean(body.phone, 80), location: clean(body.location, 160),
    status: clean(body.status, 100), course, goal: clean(body.goal, 5000),
    experience: clean(body.experience, 5000), consent: body.consent ? 1 : 0
  };
  db.prepare(`INSERT INTO skeelup_registrations(full_name,email,phone,location,status,course,goal,experience,consent)
    VALUES(@full_name,@email,@phone,@location,@status,@course,@goal,@experience,@consent)`).run(record);
  const emailText = [
    'New SkeelUP Africa course registration', '', `Name: ${record.full_name}`, `Email: ${record.email}`,
    `Phone / WhatsApp: ${record.phone || 'Not supplied'}`, `Location: ${record.location || 'Not supplied'}`,
    `Current status: ${record.status || 'Not supplied'}`, `Preferred course: ${record.course}`,
    `Consent recorded: ${record.consent ? 'Yes' : 'No'}`, '', 'Learning goal:', record.goal || 'Not supplied',
    '', 'Current skills / experience:', record.experience || 'Not supplied'
  ].join('\n');
  const notificationSent = await notifyInbox({ subject: `SkeelUP Africa registration: ${record.course}`, text: emailText, replyTo: record.email });
  return res.status(201).json({ ok: true, saved: true, notificationSent, message: 'Your registration has been saved.' });
});


app.post('/api/luxestreams-club', leadLimiter, async (req, res) => {
  const body = req.body || {};
  if (clean(body.website, 300)) return res.status(201).json({ ok: true, saved: true, notificationSent: false });
  const full_name = clean(body.full_name, 160);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 80);
  const city = clean(body.city, 160);
  const member_type = clean(body.member_type, 80);
  const timeline = clean(body.timeline, 80);
  const details = clean(body.details, 1200);
  const allowedMemberTypes = ['Personal', 'Family & Lifestyle', 'Corporate'];
  const allowedServices = ['Credit', 'Travel', 'Logistics'];
  const services = Array.isArray(body.services)
    ? [...new Set(body.services.map(x => clean(x, 30)).filter(x => allowedServices.includes(x)))]
    : [];
  if (!full_name || !validEmail(email) || phone.replace(/\D/g, '').length < 7 || !allowedMemberTypes.includes(member_type) || !services.length || !['As soon as practical', 'Within 30 days', 'In 1–3 months', 'Exploring for later'].includes(timeline) || !body.consent) {
    return res.status(400).json({ error: 'Please complete your contact details, choose a membership preference and at least one service, select a timeline and give enquiry consent.' });
  }
  const record = {
    full_name, email, phone, city, member_type, services_json: JSON.stringify(services), timeline, details,
    consent: 1, marketing_consent: body.marketing_consent ? 1 : 0
  };
  db.prepare(`INSERT INTO luxestreams_club_leads(full_name,email,phone,city,member_type,services_json,timeline,details,consent,marketing_consent)
    VALUES(@full_name,@email,@phone,@city,@member_type,@services_json,@timeline,@details,@consent,@marketing_consent)`).run(record);
  const emailText = [
    'New LuxeStreams Concierge Club enquiry', '', `Name: ${record.full_name}`, `Email: ${record.email}`,
    `Phone / WhatsApp: ${record.phone}`, `City: ${record.city || 'Not supplied'}`, `Membership preference: ${record.member_type}`,
    `Service pathways: ${services.join(', ')}`, `Requested timeline: ${record.timeline}`,
    `Marketing opt-in: ${record.marketing_consent ? 'Yes' : 'No'}`, '', 'Service note:', record.details || 'Not supplied', '',
    'Important: this is a request for contact, not credit approval, a confirmed booking or a service contract.'
  ].join('\n');
  const notificationSent = await notifyInbox({ subject: `LuxeStreams Club enquiry: ${record.member_type}`, text: emailText, replyTo: record.email });
  return res.status(201).json({ ok: true, saved: true, notificationSent, message: 'Your LuxeStreams Concierge Club enquiry has been saved.' });
});

app.post('/api/assessment', leadLimiter, async (req, res) => {
  const body = req.body || {};
  if (clean(body.website, 300)) return res.status(201).json({ ok: true, token: crypto.randomBytes(24).toString('hex') });
  const keys = Object.keys(dimensionLabels);
  const scores = {};
  for (const key of keys) {
    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      return res.status(400).json({ error: `Please enter a score from 1 to 10 for ${dimensionLabels[key]}.` });
    }
    scores[key] = value;
  }
  const email = clean(body.email, 254).toLowerCase();
  if (email && !validEmail(email)) return res.status(400).json({ error: 'Please provide a valid email address.' });
  const organization = clean(body.organization, 200);
  const consent = body.consent ? 1 : 0;
  const result = assessmentResult(scores);
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare(`INSERT INTO assessment_results(token,organization,email,strategy,people,revenue,finance,technology,operations,brand,score,tier,recommendations_json,consent)
   VALUES(@token,@organization,@email,@strategy,@people,@revenue,@finance,@technology,@operations,@brand,@score,@tier,@recommendations_json,@consent)`)
    .run({ token, organization, email, ...scores, score: result.score, tier: result.tier, recommendations_json: JSON.stringify(result.priorities), consent });
  // Save the scorecard first and return its token immediately. Email delivery is deliberately
  // non-blocking: a slow or misconfigured SMTP server must not cause the visitor's result request
  // to time out after the database record has already been saved.
  notifyInbox({
    subject: `GoldBuilders Assessment: ${result.score}/100 — ${result.tier}`,
    text: assessmentEmailText({ ...body, ...scores, organization, email }, token, result, req), replyTo: email || undefined
  }).then(sent => {
    if (!sent) console.warn(`Assessment ${token} saved successfully; notification email was not delivered.`);
  }).catch(error => {
    console.error('Assessment notification task failed:', error.message);
  });
  return res.status(201).json({ ok: true, token, score: result.score, tier: result.tier, saved: true });
});

app.get('/api/assessment/:token', (req, res) => {
  const token = clean(req.params.token, 100);
  if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).json({ error: 'Result not found' });
  const row = db.prepare(`SELECT token,organization,email,strategy,people,revenue,finance,technology,operations,brand,score,tier,created_at
    FROM assessment_results WHERE token = ?`).get(token);
  if (!row) return res.status(404).json({ error: 'Result not found' });
  return res.json(row);
});

// Scorecard consultation: the saved assessment is loaded server-side and included with the lead.
app.post('/api/assessment-consultation', leadLimiter, async (req, res) => {
  const body = req.body || {};
  if (clean(body.website, 300)) return res.status(201).json({ ok: true, saved: true, notificationSent: false });
  const token = clean(body.token, 100);
  if (!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({ error: 'Please open the consultation option from your saved assessment scorecard.' });
  const assessment = db.prepare(`SELECT token,organization,email,strategy,people,revenue,finance,technology,operations,brand,score,tier,created_at FROM assessment_results WHERE token = ?`).get(token);
  if (!assessment) return res.status(404).json({ error: 'The assessment scorecard could not be found. Please complete the assessment again.' });
  const full_name = clean(body.full_name, 160);
  const organization = clean(body.organization, 200) || clean(assessment.organization, 200);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 80);
  const role = clean(body.role, 120);
  const preferred_contact = clean(body.preferred_contact, 20);
  const timeline = clean(body.timeline, 80);
  const message = clean(body.message, 1800);
  if (!full_name || !organization || !validEmail(email)) return res.status(400).json({ error: 'Please provide your full name, organisation and a valid email address.' });
  if (!['Email', 'Phone', 'WhatsApp'].includes(preferred_contact)) return res.status(400).json({ error: 'Please choose a valid contact method.' });
  if (preferred_contact !== 'Email' && phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Please provide a valid phone / WhatsApp number for your chosen contact method.' });
  if (!body.consent) return res.status(400).json({ error: 'Please consent to sharing your assessment scorecard for this consultation request.' });
  const dimensionRows = Object.entries(dimensionLabels).map(([key, label]) => ({ key, label, score: Number(assessment[key]) }));
  const priorities = [...dimensionRows].sort((a,b) => a.score - b.score).slice(0,3);
  const cardUrl = `${requestBase(req)}/assessment-result.html?token=${assessment.token}`;
  const interpretationUrl = `${requestBase(req)}/assessment-interpretation.html?token=${assessment.token}`;
  const cardLines = [
    'ORGANISATIONAL HIGH-PERFORMANCE SCORECARD',
    `Organisation: ${organization || 'Not supplied'}`,
    `Overall High-Performance Index: ${assessment.score}/100`,
    `Maturity tier: ${assessment.tier}`,
    ...dimensionRows.map(d => `${d.label}: ${d.score}/10`),
    `Priority dimensions: ${priorities.map(d => `${d.label} (${d.score}/10)`).join(', ')}`,
    `Score analysis: ${cardUrl}`,
    `Detailed interpretation: ${interpretationUrl}`
  ].join('\n');
  const leadMessage = [
    'Requested consultation to discuss the attached organisational assessment scorecard.',
    `Role / position: ${role || 'Not supplied'}`,
    `Preferred contact method: ${preferred_contact}`,
    `Requested follow-up timeline: ${timeline || 'Not supplied'}`,
    message ? `Client context: ${message}` : '',
    '', cardLines
  ].filter(Boolean).join('\n\n').slice(0, 5000);
  const record = {
    full_name, organization, email, phone,
    industry: '', timeline, service: 'High-Performance Assessment Scorecard Consultation',
    message: leadMessage, consent: 1
  };
  db.prepare(`INSERT INTO contact_leads(full_name,organization,email,phone,industry,timeline,service,message,consent)
    VALUES(@full_name,@organization,@email,@phone,@industry,@timeline,@service,@message,@consent)`).run(record);
  const emailText = [
    'NEW GOLDBUILDERS SCORECARD CONSULTATION REQUEST', '',
    `Name: ${full_name}`, `Role / position: ${role || 'Not supplied'}`,
    `Organisation: ${organization || 'Not supplied'}`, `Email: ${email}`,
    `Phone / WhatsApp: ${phone || 'Not supplied'}`, `Preferred contact method: ${preferred_contact}`,
    `Preferred follow-up timeline: ${timeline || 'Not supplied'}`, `Client context: ${message || 'Not supplied'}`, '',
    cardLines, '', 'Consent to share assessment scorecard for this consultation: Yes'
  ].join('\n');
  const notificationSent = await notifyInbox({ subject: `Scorecard consultation: ${organization || full_name} — ${assessment.score}/100`, text: emailText, replyTo: email });
  return res.status(201).json({ ok: true, saved: true, notificationSent, message: 'Your consultation request and scorecard have been saved.' });
});

app.get('/api/leads', requireAuth, (req, res) => {
  const contacts = db.prepare('SELECT id,full_name,email,service AS interest,created_at FROM contact_leads ORDER BY id DESC LIMIT 100').all()
    .map(x => ({ type: 'Consultation', name: x.full_name, email: x.email, interest: x.interest, created_at: x.created_at }));
  const skeelup = db.prepare('SELECT id,full_name,email,course AS interest,created_at FROM skeelup_registrations ORDER BY id DESC LIMIT 100').all()
    .map(x => ({ type: 'SkeelUP', name: x.full_name, email: x.email, interest: x.interest, created_at: x.created_at }));
  const assessments = db.prepare('SELECT id,organization,email,score,created_at FROM assessment_results ORDER BY id DESC LIMIT 100').all()
    .map(x => ({ type: 'Assessment', name: x.organization || 'Assessment', email: x.email || '', interest: `Score ${x.score}/100`, created_at: x.created_at }));
  const nexora = db.prepare('SELECT id,full_name,email,package,created_at FROM nexora_leads ORDER BY id DESC LIMIT 100').all()
    .map(x => ({ type: 'Nexora Setup', name: x.full_name, email: x.email, interest: x.package, created_at: x.created_at }));
  const luxestreams = db.prepare('SELECT id,full_name,email,member_type,services_json,created_at FROM luxestreams_club_leads ORDER BY id DESC LIMIT 100')
    .all().map(x => ({ type: 'LuxeStreams Club', name: x.full_name, email: x.email, interest: `${x.member_type}: ${JSON.parse(x.services_json || '[]').join(', ')}`, created_at: x.created_at }));
  const leads = [...contacts, ...skeelup, ...assessments, ...nexora, ...luxestreams].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return res.json({ counts: {
    contacts: db.prepare('SELECT COUNT(*) c FROM contact_leads').get().c,
    skeelup: db.prepare('SELECT COUNT(*) c FROM skeelup_registrations').get().c,
    assessments: db.prepare('SELECT COUNT(*) c FROM assessment_results').get().c,
    nexora: db.prepare('SELECT COUNT(*) c FROM nexora_leads').get().c,
    luxestreams: db.prepare('SELECT COUNT(*) c FROM luxestreams_club_leads').get().c
  }, leads });
});

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    return res.json({ ok: true, service: 'GoldBuilders Growth Platform', api: 'online', database: 'connected' });
  } catch (error) {
    console.error('Health check database failure:', error.message);
    return res.status(503).json({ ok: false, service: 'GoldBuilders Growth Platform', api: 'online', database: 'unavailable' });
  }
});

app.listen(PORT, () => console.log(`GoldBuilders running on port ${PORT}; form notifications target ${NOTIFY_EMAIL}`));
