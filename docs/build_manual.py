#!/usr/bin/env python3
"""Build the Techniline Ops master user manual (single PDF, organised by designation).

Usage:  python docs/build_manual.py
Output: docs/Techniline-Ops-User-Manual.pdf  (requires `pip install reportlab`)

Designations only — no personal names, no login/credential details.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, ListFlowable, ListItem,
    Table, TableStyle, HRFlowable,
)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Techniline-Ops-User-Manual.pdf")

INDIGO = colors.HexColor("#4f46e5")
SLATE = colors.HexColor("#334155")
LIGHT = colors.HexColor("#64748b")

ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontSize=20, textColor=INDIGO, spaceAfter=6, spaceBefore=2)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontSize=14, textColor=SLATE, spaceAfter=4, spaceBefore=12)
H3 = ParagraphStyle("H3", parent=ss["Heading3"], fontSize=11.5, textColor=INDIGO, spaceAfter=2, spaceBefore=8)
BODY = ParagraphStyle("Body", parent=ss["BodyText"], fontSize=10, leading=14, textColor=SLATE, spaceAfter=4)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=9, textColor=LIGHT)
LEAD = ParagraphStyle("Lead", parent=BODY, fontSize=11, leading=15)
TITLE = ParagraphStyle("Title", parent=ss["Title"], fontSize=28, textColor=INDIGO, spaceAfter=4)
SUB = ParagraphStyle("Sub", parent=BODY, fontSize=12, textColor=LIGHT, spaceAfter=2)

story = []

def p(t, style=BODY): story.append(Paragraph(t, style))
def h1(t): story.append(Paragraph(t, H1))
def h2(t): story.append(Paragraph(t, H2))
def h3(t): story.append(Paragraph(t, H3))
def gap(h=6): story.append(Spacer(1, h))
def rule(): story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#e2e8f0"), spaceBefore=6, spaceAfter=6))
def bullets(items):
    story.append(ListFlowable([ListItem(Paragraph(i, BODY), leftIndent=6) for i in items],
                              bulletType="bullet", start="•", leftIndent=14, bulletColor=INDIGO))
def steps(items):
    story.append(ListFlowable([ListItem(Paragraph(i, BODY), leftIndent=6) for i in items],
                              bulletType="1", leftIndent=16))

# ---------- Cover ----------
gap(120)
p("TECHNILINE OPERATIONS", TITLE)
p("User Manual", SUB)
gap(10)
p("A single guide for everyday use of the Techniline Ops app.", LEAD)
gap(30)
tbl = Table([
    ["Section", "For the designation"],
    ["1. Getting started & shared tools", "Everyone"],
    ["2. Operations Coordinator", "Stock, finance & purchasing"],
    ["3. Marketplace Specialist", "Cocoblu & Music Majlis"],
    ["4. Manager", "Oversight, scorecard & reporting"],
], colWidths=[70*mm, 90*mm])
tbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), INDIGO),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTSIZE", (0,0), (-1,-1), 10),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.HexColor("#f8fafc"), colors.white]),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
]))
story.append(tbl)
gap(20)
p("This manual uses designations only. Wherever it says “you”, it means the person holding that "
  "designation. Keep this copy at your desk.", SMALL)
story.append(PageBreak())

# ---------- 1. Getting started & shared tools ----------
h1("1. Getting started & shared tools")
p("These apply to everyone, regardless of designation.")
h2("Signing in & the layout")
bullets([
    "Open the app link in your web browser. Sign in with your work account; the menu on the "
    "left shows only the sections your designation is allowed to use.",
    "<b>Dashboard</b> is your home screen — module cards plus live performance bands.",
    "The left menu is sticky and the page heading stays on screen while you scroll.",
    "It works the same on phone and computer.",
])
h2("Dashboard")
bullets([
    "Shows cards for the sections you can open, and key-figure bands at the bottom.",
    "Open any card to go to that section. Bands refresh when you reload the page.",
])
h2("Checklist — your daily work, with proof")
p("The checklist is how daily duties are tracked. A task is only complete when you add "
  "<b>evidence</b> — not just a click.")
steps([
    "Open <b>Checklist</b>. Tasks are grouped by category and by how often they recur "
    "(daily / weekly / one-off). Completed sections collapse automatically.",
    "Do the task, then submit it with the proof it asks for: a short note, a count, an "
    "uploaded screenshot/PDF, or a “nothing to action” note where relevant.",
    "On success the task moves to done and your proof is saved to the work log. If something "
    "is wrong, you’ll see an error and the task stays open — it never silently marks done.",
])
bullets([
    "<b>Sundays</b> are skipped, and no tasks are generated on your approved leave days "
    "(leave register).",
    "Tasks not submitted by their cut-off time are logged as a breach (visible to the Manager).",
])
h2("Priorities")
bullets([
    "Objectives assigned to you with a level (P1/P2/P3) and a due date.",
    "Open one to update its progress and mark it complete.",
])
h2("Blockers — flag anything holding you up")
p("Use Blockers for anything stopping you (or a small reminder to-do). It captures who raised "
  "it and when, and shows how old it is.")
steps([
    "Open <b>Blockers</b> → <b>+ Add blocker</b>. Type what’s blocking you and an optional note.",
    "Each open blocker shows an ageing badge (green → blue → amber → red as it gets older).",
    "When it’s sorted, click <b>Resolve</b> to clear it from the list (it’s kept in history).",
])
story.append(PageBreak())

# ---------- 2. Operations Coordinator ----------
h1("2. Operations Coordinator")
p("Stock holding, purchasing and finance follow-up. You can use: Checklist, Priorities, "
  "Blockers, LP Tracker, and the Finance/Amazon screens.", LEAD)
h2("LP Tracker (Local Purchase / LPO stock)")
p("Local purchases have no return agreement, so old stock is real risk. LP Tracker shows what "
  "was bought, how old it is, and what’s still in hand.")
h3("Ageing overview (opens by default)")
bullets([
    "One row per LPO, grouped by vendor, with an ageing badge and remaining qty/value — "
    "<b>no line data is loaded</b> until you ask for it, so it stays fast.",
    "<b>Goods Received Date</b> drives ageing. Set/edit it per LPO; if blank, the LP date is used.",
    "Expand an LPO to load just its lines.",
])
h3("Add a new LPO")
steps([
    "Go to <b>Upload LP</b>, upload the LPO PDF — it’s read automatically into a draft.",
    "Check the header and every line in the verify step (edit anything misread; changing a "
    "quantity asks for a comment for the record). Set the Goods Received Date.",
    "Save — the LPO and its lines are stored, and the PDF is filed under <b>LP PDFs</b>.",
])
h3("Record a sale (draw-down)")
steps([
    "Open <b>Browse lines</b>, pick a date range and click <b>Load data</b>.",
    "On a line, choose <b>Record sale</b>: enter sold qty, invoice number, entity "
    "(Al Shoala / SLM / HQ / MM / CNL / Other), salesman and date.",
    "Remaining quantity and ageing update automatically; expand a line to see its sale history.",
])
h3("Search, filter & reports")
bullets([
    "Premium search across brand, vendor, LP number, date and SKU; per-column filters on "
    "Vendor / Brand / Model.",
    "<b>Reports</b> (each with CSV + PDF): current view, vendor + date range, and entity-wise "
    "sold (detail + totals per entity).",
    "<b>Send stock-in-hand</b> emails the current stock report to impex@techniline.org.",
    "A price-change badge flags when the same SKU was bought at a different price than before.",
])
h2("Finance & Amazon screens")
bullets([
    "<b>Amazon Actions</b> — your work queue of open Amazon issues (returns, shortages, "
    "disputes). Search, tabs and a Show-resolved toggle stay pinned while you scroll. Log "
    "reference numbers and drive each item to closure; resolved items drop off.",
    "<b>Disputes / Remittances / Returns</b> — the supporting finance screens for tracking "
    "those records.",
])
story.append(PageBreak())

# ---------- 3. Marketplace Specialist ----------
h1("3. Marketplace Specialist")
p("Marketplace stock and the Music Majlis online store. You can use: Checklist, Priorities, "
  "Blockers, Cocoblu, and the Music Majlis sales tools.", LEAD)
h2("Cocoblu (consignment stock ageing)")
p("Cocoblu stock starts incurring <b>storage charges after 90 days</b>, so it must be sold or "
  "returned before then. This screen makes the at-risk stock obvious.")
h3("Ageing overview (opens by default)")
bullets([
    "One row per invoice with an ageing badge and a prominent <b>90+ days storage-risk</b> "
    "figure. Key numbers reflect <b>all</b> open stock, not just what’s on screen.",
    "Expand an invoice to load its lines, then <b>Update Qty</b> or edit as needed.",
])
h3("Add / load stock & export")
steps([
    "<b>Upload Invoice</b> reads a supplier invoice PDF into a draft to verify and save; "
    "<b>Add record</b> enters one manually; stored PDFs live under <b>Invoices</b>.",
    "<b>Browse lines</b>: pick an invoice-date range, <b>Load data</b>, then <b>Clear</b> to unload.",
    "<b>Reports</b>: export the current view to CSV or PDF.",
])
h2("Music Majlis — sales target & abandoned carts")
p("Drives the monthly online-sales target and the recovery of abandoned checkouts. Find this as "
  "the green <b>MUSICMAJLIS</b> band on the Dashboard.")
h3("Reading the band")
bullets([
    "<b>Monthly Target</b> (set by the Manager) and <b>Achieved (net sales)</b> from the store.",
    "<b>% Achieved</b> and <b>Today’s Target</b> — today’s target is recalculated daily as "
    "(target − achieved) ÷ remaining working days (Mon–Sat).",
    "<b>Abandoned Carts (yesterday)</b> — your daily worklist. Monday covers Sat+Sun; Sunday "
    "shows nothing.",
    "<b>Recovered</b>, <b>Abandoned (this month)</b>, <b>Actioned·Deals</b>, and "
    "<b>Recovery Rate</b> — the monthly trend (resets on the 1st).",
])
h3("Action yesterday’s abandoned carts (do this daily)")
steps([
    "Click the <b>Abandoned Carts</b> tile to open the list of yesterday’s carts.",
    "For each cart, either <b>Create Zoho deal</b> (adds it to the <i>Back-to-Back Orders</i> "
    "pipeline as “… – MM Abandoned Cart”; it checks for a duplicate by email first and links "
    "the existing deal if found — then finish the details in Zoho CRM), or <b>Mark actioned</b> "
    "to clear it.",
    "Actioned carts drop off the count here. Older carts from earlier in the month are kept as "
    "history only — focus on fresh ones each day.",
])
h3("Log a recovered cart")
steps([
    "Click <b>Log recovered cart</b> and enter the recovered Shopify order number.",
    "It’s validated against the store as proof, then added to this month’s Recovered total.",
])
story.append(PageBreak())

# ---------- 4. Manager ----------
h1("4. Manager")
p("Full oversight of every section above, plus the tools below. The Manager is measured on team "
  "outcomes and risk reduction, not on daily checklist ticks.", LEAD)
h2("Manager Scorecard (Dashboard, monthly)")
p("The violet <b>MANAGER SCORECARD</b> band summarises the month (it resets on the 1st):")
bullets([
    "MM Target Attainment % and Recovery Rate.",
    "Cocoblu 90+ storage-risk and LP aged-90 — the holding-cost risks (lower is better).",
    "Amazon open actions.",
    "Open blockers (with the oldest age) and checklist breaches this month.",
])
h2("Monthly summary email to the Sales Head")
steps([
    "On the Scorecard band, click <b>Send monthly summary</b>.",
    "Enter the recipient’s email (e.g. the Sales Head). It’s saved as the default for next "
    "month and stays editable each time.",
    "Review the preview (sales vs target, holding-cost risk, team), then <b>Send email</b>.",
])
h2("Other manager-only controls")
bullets([
    "<b>Set MM target</b> on the Music Majlis band — set the new monthly target on the 1st.",
    "<b>Send weekly summary</b> on the Dashboard.",
    "<b>Priorities</b> — create and assign objectives to staff.",
    "<b>Blockers</b> — tick <b>Everyone’s</b> to see and resolve any staff member’s blockers.",
    "Full visibility across Checklist submissions, LP Tracker, Cocoblu, Amazon and finance screens.",
])
h2("Monthly rhythm (suggested)")
bullets([
    "<b>1st of month</b>: set the Music Majlis target; the monthly counters reset.",
    "<b>Daily</b>: confirm the Marketplace Specialist has cleared yesterday’s abandoned carts; "
    "watch Cocoblu 90+ and open blockers.",
    "<b>Month-end</b>: send the monthly summary to the Sales Head.",
])
gap(16)
rule()
p("Techniline Operations — internal use. Keep this manual at your desk; ask the Manager if a "
  "section you need isn’t visible to your designation.", SMALL)

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(LIGHT)
    canvas.drawString(20*mm, 12*mm, "Techniline Operations — User Manual")
    canvas.drawRightString(190*mm, 12*mm, f"Page {doc.page}")
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=20*mm,
                        title="Techniline Operations - User Manual")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("WROTE", OUT)
