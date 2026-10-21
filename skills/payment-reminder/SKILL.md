---
name: payment-reminder
description: Write polite payment reminders for overdue invoices that suit Ghanaian small businesses, by SMS, WhatsApp or email, optionally with a payment link. Use when the user has customers who owe money, asks for a reminder or chaser, or wants to follow up on an unpaid invoice.
---

Goal: get paid without losing the customer, in a tone that fits how people actually do business here.

**Steps**
1. Find out what is owed: customer, amount in GH₵, the invoice date and due date, and how late it is. Ask for what is missing in one message.
2. Choose the tone by lateness: a friendly nudge just after the due date, a clear reminder after a week, a firm final notice after a month. Offer one step up from what the user asks for, not two.
3. Write the message for the channel. SMS: under 160 characters where possible, no links unless asked. WhatsApp: warm, short, one clear ask. Email: a subject line and three short paragraphs.
4. If the user has Paystack connected and wants a payment link, use `integration_execute` with provider paystack to create one for the exact amount. A Paystack link needs the customer's email address: ask for it if you do not have it, and never make one up. Without an email, give the payment details in the message instead. If they want it texted and Arkesel is connected, offer to send it, and show the final text before sending.
5. Never send to more numbers than the user named. Always show the message and the recipients and wait for a yes before anything is sent.

**Output**
- The reminder text, ready to copy, with the amount, the invoice reference and how to pay.
- If useful, a softer and a firmer version.

**Rules**
- No threats, no mention of legal action or shaming. If the user wants that, suggest they speak to a lawyer.
- Do not invent amounts or dates.
- Keep names exactly as given.
