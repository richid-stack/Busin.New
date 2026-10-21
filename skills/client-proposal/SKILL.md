---
name: client-proposal
description: Draft a clear client proposal, quote or reply email from a brief or a client message. Use when the user needs to respond to a prospect, write a proposal, scope a project, or turn rough notes into something they can send.
---

Goal: a proposal the client can say yes to in one read, with nothing invented on the user's behalf.

**Steps**
1. Gather what you have: the client's message or brief, anything the user told you about the offer, price, timeline and their own style.
2. Check what is missing: scope, price, timeline, payment terms, what the client must provide. If the user gave none of the price or timeline, do not invent them. Draft the proposal with clearly marked placeholders such as [price] and [start date], and list the placeholders at the end so the user can fill them in.
3. If the client wrote an email, answer what they actually asked, in the order they asked it, before adding anything else.
4. If the user connected Gmail and asks you to look up earlier messages with this client, first call `integration_status`. If Gmail is connected, use `integration_execute` to find them. If not, tell the user to connect it from the Integrations page. Never claim to have read an inbox you did not read.
5. Write the draft. Do not send anything. Offer to save it or send it only if the user asks, and only through a connected app.

**Output**
- **Subject line**, if it is an email.
- **The draft**, in this shape: one opening sentence showing you understood their goal; the proposed approach in 3 to 5 plain bullets (what will be delivered); timeline; price and payment terms; what you need from them; one clear next step with a date or action.
- **Placeholders to fill**, as a short list, only if there are any.
- **One line of options**: offer a shorter version or a more formal or friendlier tone.

**Rules**
- Plain language. No filler such as "I hope this email finds you well".
- Never state prices, dates, guarantees, results or past clients unless the user gave them.
- Match the user's voice if they shared writing samples.
- The user decides what is sent. Drafting is not sending.
