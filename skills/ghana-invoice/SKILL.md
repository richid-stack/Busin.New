---
name: ghana-invoice
description: Prepare an invoice or quotation in cedis for a Ghanaian business, with payment details for mobile money, bank transfer or a Paystack link. Use when the user wants to bill a customer, send a quote, or turn a job description into a document they can send.
---

Goal: a clear invoice or quote the customer can pay without calling to ask how.

**Steps**
1. Collect what is missing: the seller's business name and contact, the customer's name, the items with quantity and price, the date, and when payment is due. Ask in one short message, and only for what you cannot find in the chat.
2. Work in Ghana cedis (GH₵). Use `calculator` for every line total, the subtotal and the grand total. Never add up by eye.
3. Taxes: only add VAT or other levies if the user says the business charges them. Do not assume a rate. If they want it included, follow the `ghana-tax-lookup` skill to find the current rate and say where it came from.
4. Payment details: list the ways the customer can pay that the user gave you (mobile money number and network, bank account, or a payment link). Never invent account or wallet numbers.
5. If the user has Paystack connected and wants a payment link, use `integration_execute` with provider paystack and the exact amount and the customer's email. Put the link on the invoice.
6. Produce the file with `create_document` (PDF is best for sending) or `create_spreadsheet` if they want to edit the numbers.

**Output**
- Header with business name, TIN if the user gave one, invoice or quote number, date and due date.
- A table of items, quantities, unit prices and totals, then the grand total in GH₵.
- Payment instructions and the terms the user stated.
- Mark quotes with a validity period, for example "valid for 14 days", only if the user agrees.

**Rules**
- Do not invent a TIN, bank details or numbers. Leave a clear blank instead.
- Show amounts with two decimals and a thousands separator.
- This is a business document, not tax advice.
